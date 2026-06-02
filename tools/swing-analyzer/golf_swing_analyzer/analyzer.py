"""Main golf swing analyzer service.

Driven entirely by MQTT (no HTTP shot trigger).

Flow:
  1. MQTTBridge subscribes to golf/shot/raw, golf/context/current,
     and golf/swing/analyzer/enabled.
  2. When the analyzer is enabled and a raw shot arrives, save shot JSON
     and ask OBS to flush the replay buffer.
  3. Watchdog sees the new MP4, queues it for processing.
  4. Worker matches video to shot JSON, runs MediaPipe pose, computes
     metrics, renders annotated video, optionally calls a local LLM,
     publishes the result over MQTT (with HA discovery).
  5. Old swings beyond keep_recent_swings are deleted.

Flask is still used, but only as a tiny static file server so HA can
fetch the annotated MP4s for playback in the dashboard.
"""
from __future__ import annotations

import json
import logging
import os
import queue
import shutil
import signal
import socket
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from flask import Flask, abort, jsonify, send_from_directory
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from .annotate import annotate_video
from .config import load_config
from .impact import analyze_top_down
from .llm import generate_summary
from .metrics import compute_advanced_metrics, compute_body_metrics, derive_faults, detect_phases
from .mqtt_bridge import MQTTBridge
from .obs_client import OBSClient
from .pose import detect_video_pose

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("analyzer")

VIDEO_EXTS = (".mp4", ".mkv", ".mov", ".flv")


def _safe_stamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _acquire_single_instance() -> socket.socket:
    lock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        lock.bind(("127.0.0.1", 47532))
        lock.listen(1)
        return lock
    except OSError as e:
        lock.close()
        raise RuntimeError("Golf Swing Analyzer is already running") from e


def _timestamp_from_filename(name: str) -> Optional[datetime]:
    base = Path(name).stem
    for token in base.replace("-", "_").split("_"):
        if len(token) == 14 and token.isdigit():
            try:
                return datetime.strptime(token, "%Y%m%d%H%M%S")
            except ValueError:
                pass
    parts = base.replace("-", "_").split("_")
    for i in range(len(parts) - 1):
        date = parts[i]
        clock = parts[i + 1]
        if len(date) == 8 and date.isdigit() and len(clock) == 6 and clock.isdigit():
            try:
                return datetime.strptime(date + clock, "%Y%m%d%H%M%S")
            except ValueError:
                pass
    return None


class Analyzer:
    def __init__(self, cfg: Dict[str, Any]) -> None:
        self.cfg = cfg
        self.raw_dir = Path(cfg["paths"]["raw_video_dir"])
        self.annotated_dir = Path(cfg["paths"]["annotated_video_dir"])
        self.shot_dir = Path(cfg["paths"]["shot_data_dir"])
        self.analysis_dir = Path(cfg["paths"]["analysis_dir"])

        self.queue: "queue.Queue[Path]" = queue.Queue()
        self.processed: set[str] = set()
        self.lock = threading.Lock()

        self.obs: Optional[OBSClient] = None
        if cfg.get("obs", {}).get("enabled"):
            self.obs = OBSClient(
                host=cfg["obs"].get("host", "127.0.0.1"),
                port=int(cfg["obs"].get("port", 4455)),
                password=cfg["obs"].get("password", ""),
            )

        self.mqtt = MQTTBridge(cfg.get("mqtt", {}))
        self.mqtt.set_callbacks(
            on_shot=self._on_mqtt_shot,
            on_context=self._on_mqtt_context,
            on_enable=self._on_mqtt_enable,
        )
        td_cfg = cfg.get("top_down", {}) or {}
        self.top_down_dir: Optional[Path] = None
        if td_cfg.get("enabled") and td_cfg.get("raw_video_dir"):
            self.top_down_dir = Path(td_cfg["raw_video_dir"])
            self.top_down_dir.mkdir(parents=True, exist_ok=True)
        self.context: Dict[str, Any] = {}
        # Default to off so a fresh install does not chew through CPU/disk
        # until the user clicks Swing Analyzer in HA.
        self.enabled: bool = False

    # ---------- MQTT handlers ----------
    def _on_mqtt_enable(self, on: bool) -> None:
        self.enabled = on
        log.info("Swing analyzer %s via MQTT", "ENABLED" if on else "disabled")

    def _on_mqtt_context(self, ctx: Dict[str, Any]) -> None:
        self.context = ctx or {}

    def _on_mqtt_shot(self, shot: Dict[str, Any]) -> None:
        if not self.enabled:
            log.debug("Shot ignored - analyzer disabled")
            return

        if "timestamp" not in shot:
            shot["timestamp"] = datetime.now().isoformat(timespec="seconds")

        # Range Matrix context wins for player/club/session - the user
        # actively picks the club there, while Nova's OpenAPI feed often
        # reports a stale default like "Driver".
        for key in ("player", "club", "session_id"):
            ctx_value = self.context.get(key)
            if ctx_value:
                shot[key] = ctx_value
            elif key not in shot:
                shot[key] = None

        stamp = _safe_stamp()
        shot_path = self.shot_dir / f"shot_{stamp}.json"
        try:
            with shot_path.open("w", encoding="utf-8") as f:
                json.dump(shot, f, indent=2)
            log.info("Stored shot data: %s", shot_path)
        except Exception as e:
            log.warning("Could not save shot json: %s", e)
            return

        if self.obs and self.cfg.get("obs", {}).get("save_replay_on_shot", True):
            ok = self.obs.save_replay()
            log.info("OBS SaveReplayBuffer requested: ok=%s", ok)
        else:
            log.info("OBS replay save skipped (disabled)")

    # ---------- Worker ----------
    def worker_loop(self) -> None:
        while True:
            video_path = self.queue.get()
            if video_path is None:
                break
            try:
                self.process_video(video_path)
            except Exception as e:
                log.exception("Failed to process %s: %s", video_path, e)
            finally:
                self.queue.task_done()

    def enqueue_video(self, path: Path) -> None:
        key = str(path.resolve())
        with self.lock:
            if key in self.processed:
                return
            self.processed.add(key)
        if not self.enabled:
            log.info("Video %s arrived but analyzer disabled; skipping", path.name)
            return
        log.info("Queued for analysis: %s", path)
        self.queue.put(path)

    def _wait_for_stable_file(self, path: Path, timeout: float = 20.0) -> bool:
        deadline = time.time() + timeout
        last_size = -1
        while time.time() < deadline:
            try:
                size = path.stat().st_size
            except FileNotFoundError:
                time.sleep(0.5)
                continue
            if size == last_size and size > 0:
                return True
            last_size = size
            time.sleep(0.5)
        return False

    def _find_matching_shot(self, video_path: Path) -> Optional[Tuple[Path, Dict[str, Any]]]:
        max_diff = float(self.cfg["matching"]["max_time_difference_seconds"])
        try:
            video_mtime = datetime.fromtimestamp(video_path.stat().st_mtime)
        except Exception:
            video_mtime = datetime.now()

        candidates: List[Tuple[float, Path, Dict[str, Any]]] = []
        for shot_file in self.shot_dir.glob("shot_*.json"):
            try:
                with shot_file.open("r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                continue
            ts_raw = data.get("timestamp")
            ts: Optional[datetime] = None
            if ts_raw:
                try:
                    ts = datetime.fromisoformat(str(ts_raw).replace("Z", ""))
                except Exception:
                    ts = None
            if ts is None:
                ts = _timestamp_from_filename(shot_file.name) or datetime.fromtimestamp(
                    shot_file.stat().st_mtime
                )
            diff = abs((ts - video_mtime).total_seconds())
            if diff <= max_diff:
                candidates.append((diff, shot_file, data))

        if not candidates:
            return None
        candidates.sort(key=lambda x: x[0])
        _, path, data = candidates[0]
        return path, data

    def _is_top_down_path(self, path: Path) -> bool:
        if not self.top_down_dir:
            return False
        try:
            path.resolve().relative_to(self.top_down_dir.resolve())
            return True
        except ValueError:
            return False

    def _find_top_down_video(self, reference: Path) -> Optional[Path]:
        if not self.top_down_dir or not self.top_down_dir.exists():
            return None
        try:
            ref_mtime = datetime.fromtimestamp(reference.stat().st_mtime)
        except Exception:
            ref_mtime = datetime.now()
        max_diff = float(self.cfg["matching"]["max_time_difference_seconds"])
        candidates: List[Tuple[float, Path]] = []
        for clip in self.top_down_dir.iterdir():
            if not clip.is_file() or clip.suffix.lower() not in VIDEO_EXTS:
                continue
            try:
                diff = abs(
                    (datetime.fromtimestamp(clip.stat().st_mtime) - ref_mtime).total_seconds()
                )
            except Exception:
                continue
            if diff <= max_diff:
                candidates.append((diff, clip))
        if not candidates:
            return None
        candidates.sort(key=lambda x: x[0])
        return candidates[0][1]

    def _find_analysis_near_video(
        self, video_path: Path
    ) -> Optional[Tuple[Path, Dict[str, Any]]]:
        max_diff = float(self.cfg["matching"]["max_time_difference_seconds"])
        try:
            vm = datetime.fromtimestamp(video_path.stat().st_mtime)
        except Exception:
            vm = datetime.now()
        best: Optional[Tuple[float, Path, Dict[str, Any]]] = None
        for analysis_file in self.analysis_dir.glob("*_analysis.json"):
            try:
                data = json.loads(analysis_file.read_text(encoding="utf-8"))
            except Exception:
                continue
            ts_raw = data.get("timestamp")
            try:
                ts = datetime.fromisoformat(str(ts_raw).replace("Z", ""))
            except Exception:
                ts = datetime.fromtimestamp(analysis_file.stat().st_mtime)
            diff = abs((ts - vm).total_seconds())
            if diff <= max_diff and (best is None or diff < best[0]):
                best = (diff, analysis_file, data)
        if best is None:
            return None
        return best[1], best[2]

    def _run_top_down_analysis(
        self,
        td_video: Path,
        impact_time_s: Optional[float],
        stamp: str,
    ) -> Dict[str, Any]:
        td_cfg = self.cfg.get("top_down", {}) or {}
        overlay_path = self.annotated_dir / f"{stamp}_topdown_impact.jpg"
        public = (
            td_cfg.get("public_base_url")
            or self.cfg.get("server", {}).get("public_base_url")
            or ""
        ).rstrip("/")
        result = analyze_top_down(
            str(td_video),
            td_cfg,
            impact_time_s=impact_time_s,
            out_image_path=str(overlay_path),
        )
        if public and result.get("overlay_image"):
            result["overlay_url"] = f"{public}/videos/annotated/{overlay_path.name}"
        return result

    def process_top_down(self, video_path: Path) -> None:
        """Process a top-down replay clip and merge into the nearest analysis."""
        log.info("Processing top-down clip %s", video_path)
        if not self._wait_for_stable_file(video_path, timeout=float(
            self.cfg["matching"].get("wait_for_video_seconds", 20)
        )):
            log.warning("Top-down file never stabilized: %s", video_path)
            return

        impact_time: Optional[float] = None
        match = self._find_analysis_near_video(video_path)
        if match is not None:
            _, data = match
            raw_ts = data.get("impact_timestamp_s")
            if isinstance(raw_ts, (int, float)):
                impact_time = float(raw_ts)

        stamp = video_path.stem
        td_result = self._run_top_down_analysis(video_path, impact_time, stamp)

        if match is not None:
            analysis_path, data = match
            data["top_down"] = td_result
            data["top_down_summary"] = td_result.get("summary", "")
            try:
                with analysis_path.open("w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2)
            except Exception as e:
                log.warning("Could not update analysis with top-down: %s", e)
            recent = self._enforce_retention()
            data["recent"] = recent
            self.mqtt.publish_result(data)
            log.info("Merged top-down into %s", analysis_path.name)
        else:
            log.info(
                "Top-down analyzed (%s) but no matching DTL analysis yet",
                td_result.get("status"),
            )

    def process_video(self, video_path: Path) -> None:
        if self._is_top_down_path(video_path):
            self.process_top_down(video_path)
            return

        log.info("Processing %s", video_path)
        if not self._wait_for_stable_file(video_path, timeout=float(
            self.cfg["matching"].get("wait_for_video_seconds", 20)
        )):
            log.warning("File never stabilized: %s", video_path)
            return

        shot_match = self._find_matching_shot(video_path)
        if shot_match is None:
            log.warning("No matching shot JSON for %s", video_path)
            shot: Dict[str, Any] = {}
        else:
            shot_file, shot = shot_match
            log.info("Matched shot file: %s", shot_file.name)

        tracking = self.cfg.get("tracking", {}) or {}
        try:
            frames, width, height, fps, total = detect_video_pose(
                str(video_path),
                sample_rate=int(self.cfg["camera"]["fps_sample_rate"]),
                model=str(tracking.get("pose_model", "heavy")),
                smoothing=str(tracking.get("smoothing", "one_euro")),
                one_euro=tracking.get("one_euro") or {},
                smoothing_alpha=float(tracking.get("smoothing_alpha", 0.35)),
                min_torso_visibility=float(tracking.get("min_torso_visibility", 0.6)),
                detection_confidence=float(tracking.get("detection_confidence", 0.6)),
                presence_confidence=float(tracking.get("presence_confidence", 0.6)),
                tracking_confidence=float(tracking.get("tracking_confidence", 0.6)),
            )
        except Exception as e:
            log.exception("Pose detection failed: %s", e)
            return

        phases = detect_phases(frames)
        body = compute_body_metrics(
            frames=frames,
            phases=phases,
            fps=fps,
            width=width,
            camera_angle=self.cfg["camera"]["angle"],
        )
        advanced_package = compute_advanced_metrics(
            frames=frames,
            phases=phases,
            body=body,
            width=width,
            height=height,
            camera_angle=self.cfg["camera"]["angle"],
        )
        faults = derive_faults(body, shot)

        clip_start, clip_end = self._swing_clip_range(frames, phases, fps)

        stamp = video_path.stem
        annotated_path = self.annotated_dir / f"{stamp}_annotated.mp4"
        annotated_ok = False
        try:
            annotated_ok = annotate_video(
                video_path=str(video_path),
                out_path=str(annotated_path),
                frames=frames,
                phases=phases,
                body_metrics=body,
                advanced_metrics=advanced_package,
                nova=shot,
                faults=faults,
                clip_start_frame=clip_start,
                clip_end_frame=clip_end,
                slow_motion_factor=float(
                    self.cfg.get("annotation", {}).get("slow_motion_factor", 1.0)
                ),
                overlay_options=self.cfg.get("annotation", {}).get("overlays", {}),
                side_by_side=bool(
                    self.cfg.get("annotation", {}).get("side_by_side", True)
                ),
            )
        except Exception as e:
            log.exception("Annotation failed: %s", e)

        public = (self.cfg.get("server", {}).get("public_base_url") or "").rstrip("/")
        annotated_url = (
            f"{public}/videos/annotated/{annotated_path.name}"
            if annotated_ok and public else None
        )
        raw_url = f"{public}/videos/raw/{video_path.name}" if public else None

        if annotated_ok:
            override_url, archive_messages = self._archive_annotated(annotated_path)
            for m in archive_messages:
                log.info(m)
            if override_url:
                annotated_url = override_url

        analysis: Dict[str, Any] = {
            "id": stamp,
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "player": shot.get("player") or self.context.get("player"),
            "club": shot.get("club"),
            "camera_angle": self.cfg["camera"]["angle"],
            "raw_video": str(video_path),
            "annotated_video": str(annotated_path) if annotated_ok else None,
            "raw_url": raw_url,
            "annotated_url": annotated_url,
            "shot": shot,
            "body": body,
            "advanced": advanced_package.get("advanced", {}),
            "scores": advanced_package.get("scores", {}),
            "score_summary": advanced_package.get("score_summary", ""),
            "faults": faults,
            "phases": {
                "address_idx": phases.address_idx,
                "top_idx": phases.top_idx,
                "impact_idx": phases.impact_idx,
                "finish_idx": phases.finish_idx,
            },
            "impact_timestamp_s": (
                frames[phases.impact_idx].timestamp_s
                if phases.impact_idx is not None
                and 0 <= phases.impact_idx < len(frames)
                else None
            ),
        }
        analysis["body_summary"] = _summarize_body(body)
        analysis["faults_text"] = ", ".join(faults) if faults else "none"

        td_cfg = self.cfg.get("top_down", {}) or {}
        if td_cfg.get("enabled"):
            td_video = self._find_top_down_video(video_path)
            if td_video:
                impact_time = analysis.get("impact_timestamp_s")
                td_result = self._run_top_down_analysis(
                    td_video,
                    float(impact_time) if impact_time is not None else None,
                    stamp,
                )
                analysis["top_down"] = td_result
                analysis["top_down_summary"] = td_result.get("summary", "")

        llm_result = generate_summary(self.cfg.get("llm", {}), analysis)
        if llm_result:
            evidence = llm_result.get("evidence") or []
            if isinstance(evidence, str):
                evidence_text = evidence
            elif isinstance(evidence, list):
                evidence_text = " | ".join(str(item) for item in evidence if item)
            else:
                evidence_text = ""
            analysis["summary"] = (
                llm_result.get("summary")
                or llm_result.get("priority_fault")
                or analysis["body_summary"]
            )
            analysis["llm_priority_fault"] = str(llm_result.get("priority_fault") or "")
            analysis["llm_why_it_matters"] = str(llm_result.get("why_it_matters") or "")
            analysis["llm_evidence"] = evidence_text
            analysis["llm_drill"] = str(llm_result.get("drill") or "")
            analysis["llm_confidence"] = str(llm_result.get("confidence") or "")
            analysis["llm_status"] = str(llm_result.get("llm_status") or "ok")
            analysis["llm_error"] = str(llm_result.get("llm_error") or "")
            analysis["llm"] = llm_result
        else:
            analysis["summary"] = analysis["body_summary"]
            analysis["llm_status"] = (
                "disabled" if not self.cfg.get("llm", {}).get("enabled") else "not_run"
            )
            analysis["llm_error"] = ""

        analysis_path = self.analysis_dir / f"{stamp}_analysis.json"
        try:
            with analysis_path.open("w", encoding="utf-8") as f:
                json.dump(analysis, f, indent=2)
            log.info("Analysis written: %s", analysis_path)
        except Exception as e:
            log.warning("Could not write analysis JSON: %s", e)

        recent = self._enforce_retention()
        analysis["recent"] = recent

        if self.mqtt.publish_result(analysis):
            log.info("Published analysis for %s to MQTT", stamp)

    def _swing_clip_range(
        self,
        frames: List[Any],
        phases: Any,
        fps: float,
    ) -> tuple[Optional[int], Optional[int]]:
        """Translate sampled-frame phase indices into a source-video frame
        window of roughly [address - 0.5s, impact + 2.5s], clamped to the
        actual swing motion. Returns (start, end) in source-frame coords,
        or (None, None) if we can't bound it (annotator will use full clip).
        """
        if not frames:
            return None, None
        try:
            fps_eff = float(fps) if fps > 0 else 30.0
            pre_pad = int(0.5 * fps_eff)
            post_pad = int(2.5 * fps_eff)

            start_idx = phases.address_idx if phases.address_idx is not None else 0
            end_idx = (
                phases.impact_idx
                if phases.impact_idx is not None
                else len(frames) - 1
            )
            if start_idx < 0:
                start_idx = 0
            if end_idx >= len(frames):
                end_idx = len(frames) - 1

            start_src = max(0, frames[start_idx].frame_index - pre_pad)
            end_src = frames[end_idx].frame_index + post_pad
            return start_src, end_src
        except Exception:
            return None, None

    # ---------- Archive ----------
    def _archive_annotated(
        self,
        annotated_path: Path,
    ) -> Tuple[Optional[str], List[str]]:
        """Copy the annotated MP4 into each configured destination and prune.

        Returns (override_annotated_url, log_messages). override_annotated_url
        comes from the first destination that defines public_url_prefix; if
        set, it is published in the analysis JSON in place of the local
        Flask server URL so the HA dashboard works locally and via Nabu Casa.
        """
        archive_cfg = self.cfg.get("archive", {}) or {}
        if not archive_cfg.get("enabled"):
            return None, []
        destinations = archive_cfg.get("destinations") or []
        if not destinations:
            return None, []
        if not annotated_path.exists():
            return None, [f"archive skipped: source {annotated_path} not found"]

        keep = int(archive_cfg.get("keep_last") or 5)
        template = str(
            archive_cfg.get("filename_template") or "swing_{timestamp}_{original}"
        )
        timestamp = time.strftime(
            "%Y%m%d_%H%M%S", time.localtime(annotated_path.stat().st_mtime)
        )
        target_name = template.format(
            timestamp=timestamp, original=annotated_path.name
        )

        override_url: Optional[str] = None
        messages: List[str] = []
        for dest in destinations:
            if not isinstance(dest, dict):
                continue
            path_raw = str(dest.get("path") or "").strip()
            if not path_raw:
                continue
            dest_dir = Path(path_raw)
            try:
                dest_dir.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                messages.append(f"archive {path_raw}: open failed: {e}")
                continue

            target = dest_dir / target_name
            tmp = target.with_suffix(target.suffix + ".part")
            try:
                shutil.copy2(annotated_path, tmp)
                os.replace(tmp, target)
            except Exception as e:
                try:
                    if tmp.exists():
                        tmp.unlink()
                except Exception:
                    pass
                messages.append(f"archive {path_raw}: copy failed: {e}")
                continue

            kept = self._prune_archive(dest_dir, keep)
            messages.append(
                f"archive {path_raw}: copied {target.name} (kept {kept})"
            )

            prefix = str(dest.get("public_url_prefix") or "").strip()
            if prefix and override_url is None:
                override_url = f"{prefix.rstrip('/')}/{target.name}"

        return override_url, messages

    def _prune_archive(self, folder: Path, keep: int) -> int:
        if keep <= 0:
            return 0
        extensions = {".mp4", ".mkv", ".mov", ".flv", ".ts"}
        try:
            clips = sorted(
                (
                    p
                    for p in folder.iterdir()
                    if p.is_file() and p.suffix.lower() in extensions
                ),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
        except Exception as e:
            log.warning("Could not enumerate %s: %s", folder, e)
            return 0
        for old in clips[keep:]:
            try:
                old.unlink()
            except OSError as e:
                log.warning("Could not remove old clip %s: %s", old, e)
        return min(len(clips), keep)

    # ---------- Retention ----------
    def _enforce_retention(self) -> List[Dict[str, Any]]:
        keep = int(self.cfg.get("retention", {}).get("keep_recent_swings", 5))
        if keep < 1:
            keep = 1

        analyses: List[Tuple[float, Path, Dict[str, Any]]] = []
        for f in self.analysis_dir.glob("*_analysis.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                continue
            analyses.append((f.stat().st_mtime, f, data))
        analyses.sort(key=lambda t: t[0], reverse=True)

        recent_summary: List[Dict[str, Any]] = []
        for _, _, data in analyses[:keep]:
            recent_summary.append({
                "id": data.get("id"),
                "timestamp": data.get("timestamp"),
                "player": data.get("player"),
                "club": data.get("club"),
                "annotated_url": data.get("annotated_url"),
                "summary": data.get("summary"),
                "faults_text": data.get("faults_text"),
                "score_summary": data.get("score_summary"),
            })

        for _, analysis_path, data in analyses[keep:]:
            self._delete_swing_files(analysis_path, data)
        return recent_summary

    def _delete_swing_files(self, analysis_path: Path, data: Dict[str, Any]) -> None:
        targets: List[Path] = [analysis_path]
        for k in ("raw_video", "annotated_video"):
            v = data.get(k)
            if v:
                targets.append(Path(v))
        stem = data.get("id")
        if isinstance(stem, str) and stem:
            targets.append(self.shot_dir / f"shot_{stem}.json")
            for sf in self.shot_dir.glob("shot_*.json"):
                if stem in sf.name:
                    targets.append(sf)
        for t in targets:
            try:
                if t.exists():
                    t.unlink()
                    log.info("Retention: deleted %s", t)
            except Exception as e:
                log.debug("Retention delete skipped for %s: %s", t, e)

    # ---------- HTTP video server ----------
    def build_app(self) -> Flask:
        app = Flask(__name__)

        roots = {
            "annotated": self.annotated_dir,
            "raw": self.raw_dir,
        }

        @app.route("/health", methods=["GET"])
        def health():
            return jsonify({
                "ok": True,
                "queued": self.queue.qsize(),
                "enabled": self.enabled,
                "context": self.context,
            })

        @app.route("/videos/<which>/<path:filename>", methods=["GET"])
        def videos(which: str, filename: str):
            root = roots.get(which)
            if root is None:
                abort(404)
            return send_from_directory(root, filename, as_attachment=False)

        @app.route("/recent", methods=["GET"])
        def recent():
            files = sorted(
                self.analysis_dir.glob("*_analysis.json"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            out = []
            for f in files[: int(self.cfg.get("retention", {}).get("keep_recent_swings", 5))]:
                try:
                    out.append(json.loads(f.read_text(encoding="utf-8")))
                except Exception:
                    continue
            return jsonify(out)

        return app

    # ---------- Folder watcher ----------
    def start_watcher(self) -> Observer:
        analyzer = self

        class Handler(FileSystemEventHandler):
            def on_created(self, event):
                if event.is_directory:
                    return
                p = Path(event.src_path)
                if p.suffix.lower() in VIDEO_EXTS:
                    analyzer.enqueue_video(p)

            def on_moved(self, event):
                if event.is_directory:
                    return
                p = Path(event.dest_path)
                if p.suffix.lower() in VIDEO_EXTS:
                    analyzer.enqueue_video(p)

        observer = Observer()
        observer.schedule(Handler(), str(self.raw_dir), recursive=False)
        log.info("Watching: %s", self.raw_dir)
        if self.top_down_dir:
            observer.schedule(Handler(), str(self.top_down_dir), recursive=False)
            log.info("Watching top-down: %s", self.top_down_dir)
        observer.start()
        return observer


def _summarize_body(body: Dict[str, Any]) -> str:
    parts: List[str] = []
    head = body.get("head_movement")
    if isinstance(head, dict):
        parts.append(f"head {head.get('severity')}")
    spine = body.get("spine_angle")
    if isinstance(spine, dict):
        parts.append(f"spine {spine.get('severity')} ({spine.get('loss_deg')}°)")
    if body.get("early_extension"):
        parts.append("early ext")
    tempo = body.get("tempo")
    if isinstance(tempo, dict) and tempo.get("backswing_to_downswing_ratio"):
        parts.append(f"tempo {tempo['backswing_to_downswing_ratio']}:1")
    return ", ".join(parts) if parts else "no body issues detected"


def main() -> int:
    instance_lock = _acquire_single_instance()
    cfg_path = os.environ.get("ANALYZER_CONFIG", "config.yaml")
    cfg = load_config(cfg_path)

    analyzer = Analyzer(cfg)
    analyzer.mqtt.start()

    worker = threading.Thread(target=analyzer.worker_loop, daemon=True, name="worker")
    worker.start()
    observer = analyzer.start_watcher()

    app = analyzer.build_app()

    def _shutdown(*_):
        log.info("Shutting down...")
        try:
            analyzer.mqtt.stop()
        except Exception:
            pass
        observer.stop()
        observer.join(timeout=2)
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    host = cfg["server"].get("host", "0.0.0.0")
    port = int(cfg["server"].get("port", 8765))
    log.info(
        "Video file server on http://%s:%d (MQTT=%s, broker=%s:%s, enable_topic=%s)",
        host, port,
        cfg.get("mqtt", {}).get("enabled"),
        cfg.get("mqtt", {}).get("host"),
        cfg.get("mqtt", {}).get("port"),
        cfg.get("mqtt", {}).get("enable_topic"),
    )
    try:
        app.run(host=host, port=port, threaded=True, use_reloader=False)
        return 0
    finally:
        instance_lock.close()


if __name__ == "__main__":
    raise SystemExit(main())
