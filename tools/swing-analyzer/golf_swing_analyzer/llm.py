"""Local LLM coaching summary (Ollama-style /api/generate)."""
from __future__ import annotations

import json
import logging
import base64
from pathlib import Path
from typing import Any, Dict, Optional

import requests

log = logging.getLogger(__name__)


REQUIRED_COACHING_FIELDS = (
    "priority_fault",
    "why_it_matters",
    "evidence",
    "drill",
    "confidence",
)


SYSTEM_PROMPT = (
    "You are my practical AI golf swing coach, not a generic sports commentator. "
    "Coach an amateur golfer using a home simulator. Be honest, constructive, and "
    "actionable. Prioritize contact, consistency, balance, distance, and ball flight. "
    "Do not over-diagnose from one swing: separate what is confirmed, what is likely, "
    "and what is uncertain. Treat NOVA launch monitor numbers as the primary evidence "
    "for ball flight, contact, face/path, spin, distance, and consistency. Use pose scores "
    "and overlay-derived body metrics only as secondary support. Do not choose a main issue "
    "from pose data unless it is also visible in the raw swing or supported by the launch "
    "numbers. Do not invent measurements. If pose markers jump or the camera angle/lighting "
    "limits the view, say so and do not treat overlays as truth. "
    "Prioritize the top 2 or 3 issues only, explain in plain English, and give simple "
    "home/simulator drills with what the golfer should feel. Reply with strict JSON only, "
    "matching the requested schema."
)


def _short_error(text: str, limit: int = 240) -> str:
    clean = " ".join(str(text or "").split())
    if len(clean) <= limit:
        return clean
    return clean[: limit - 3] + "..."


def _first_value(data: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = data.get(key)
        if value not in (None, "", [], {}):
            return value
    return ""


def _dashboard_text(value: Any, limit: int = 2000) -> str:
    if isinstance(value, list):
        text = " | ".join(str(item) for item in value if item)
    elif isinstance(value, dict):
        text = "; ".join(f"{key}: {val}" for key, val in value.items() if val)
    else:
        text = str(value or "")
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def _parse_json_object(text: str) -> Any:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            raise
        parsed = json.loads(text[start : end + 1])
    if isinstance(parsed, str):
        parsed = json.loads(parsed)
    return parsed


def _normalize_coaching_json(data: Dict[str, Any]) -> Dict[str, Any]:
    """Accept a few common model aliases, then force the dashboard schema."""
    return {
        "priority_fault": _dashboard_text(_first_value(
            data,
            "priority_fault",
            "priority",
            "main_issue",
            "most_important_fix",
            "overall_grade",
        )),
        "why_it_matters": _dashboard_text(_first_value(
            data,
            "why_it_matters",
            "quick_summary",
            "summary",
            "overall_summary",
        )),
        "evidence": _dashboard_text(_first_value(
            data,
            "evidence",
            "observations",
            "what_looks_good",
            "main_issues",
            "launch_monitor_interpretation",
        )),
        "drill": _dashboard_text(_first_value(
            data,
            "drill",
            "drills",
            "recommended_drills",
            "most_important_drill",
        )),
        "confidence": _dashboard_text(_first_value(
            data,
            "confidence",
            "camera_data_quality",
            "data_quality",
            "next_swing_checklist",
        )),
    }


def _has_required_coaching(data: Dict[str, Any]) -> bool:
    return all(data.get(key) not in (None, "", [], {}) for key in REQUIRED_COACHING_FIELDS)


def _rounded(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 2)
    if isinstance(value, dict):
        return {k: _rounded(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_rounded(v) for v in value[:12]]
    return value


def _compact_metrics(analysis: Dict[str, Any]) -> Dict[str, Any]:
    shot = analysis.get("nova") or analysis.get("shot", {})
    shot_keys = (
        "club",
        "carry",
        "total",
        "offline",
        "ball_speed",
        "clubhead_speed",
        "smash_factor",
        "launch_angle",
        "launch_direction",
        "total_spin",
        "backspin",
        "sidespin",
        "spin_axis",
        "peak_height",
        "descent_angle",
        "shot_name",
        "shot_rank",
    )
    advanced = analysis.get("advanced", {})
    advanced_summary = {
        "head_box": advanced.get("head_box"),
        "pelvis_depth_line": advanced.get("pelvis_depth_line"),
        "spine_inclination_line": advanced.get("spine_inclination_line"),
    }
    return {
        "launch_monitor": {k: _rounded(shot.get(k)) for k in shot_keys if k in shot},
        "pose_supporting_context": {
            "body": _rounded(analysis.get("body", {})),
            "advanced_summary": _rounded({k: v for k, v in advanced_summary.items() if v}),
            "scores": _rounded(analysis.get("scores", {})),
        },
        "score_summary": analysis.get("score_summary"),
        "faults": analysis.get("faults", []),
        "body_summary": analysis.get("body_summary"),
    }


def _sample_positions(frame_count: int, count: int) -> list[int]:
    if frame_count <= 0 or count <= 0:
        return []
    if count == 1:
        return [frame_count // 2]
    return sorted({round(i * (frame_count - 1) / (count - 1)) for i in range(count)})


def _video_frames(path: str, count: int, max_width: int, quality: int) -> list[str]:
    """Return base64 JPEG frames for Ollama vision models."""
    video = Path(path)
    if not video.exists() or count <= 0:
        return []
    try:
        import cv2
    except ImportError:
        log.warning("OpenCV is not available; LLM visual frames skipped")
        return []

    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        return []
    try:
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        images: list[str] = []
        for idx in _sample_positions(total, count):
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            height, width = frame.shape[:2]
            if width > max_width:
                scale = max_width / float(width)
                frame = cv2.resize(
                    frame,
                    (max_width, max(1, int(height * scale))),
                    interpolation=cv2.INTER_AREA,
                )
            ok, buf = cv2.imencode(
                ".jpg",
                frame,
                [int(cv2.IMWRITE_JPEG_QUALITY), max(35, min(95, quality))],
            )
            if ok:
                images.append(base64.b64encode(buf).decode("ascii"))
        return images
    finally:
        cap.release()


def _collect_visual_frames(cfg: Dict[str, Any], analysis: Dict[str, Any]) -> list[str]:
    if not cfg.get("send_video_frames", True):
        return []
    max_images = int(cfg.get("max_visual_frames", 8) or 0)
    if max_images <= 0:
        return []
    max_width = int(cfg.get("visual_frame_max_width", 960) or 960)
    quality = int(cfg.get("visual_frame_jpeg_quality", 72) or 72)

    raw_video = analysis.get("raw_video")
    annotated_video = analysis.get("annotated_video")
    paths = [p for p in (raw_video, annotated_video) if p and Path(str(p)).exists()]
    if not paths:
        return []
    if len(paths) == 1:
        return _video_frames(str(paths[0]), max_images, max_width, quality)

    first_count = max(1, max_images // 2)
    images = _video_frames(str(paths[0]), first_count, max_width, quality)
    images.extend(_video_frames(str(paths[1]), max_images - len(images), max_width, quality))
    return images[:max_images]


def generate_summary(cfg: Dict[str, Any], analysis: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not cfg.get("enabled"):
        return None

    endpoint = cfg.get("endpoint")
    model = cfg.get("model", "trinity")
    timeout = int(cfg.get("timeout_seconds", 60))
    if not endpoint:
        return {"llm_status": "not_configured", "llm_error": "LLM endpoint is empty"}

    images = _collect_visual_frames(cfg, analysis)

    compact_metrics = _compact_metrics(analysis)
    user_prompt = (
        "Review this golf swing like a practical golf instructor.\n\n"
        f"Club: {analysis.get('club')}\n"
        f"Camera angle: {analysis.get('camera_angle')}\n"
        f"Swing data: {json.dumps(compact_metrics)}\n\n"
        "Evidence priority:\n"
        "1. Use launch_monitor numbers first: carry/total, offline, launch angle, ball speed, "
        "club speed, smash, spin, spin axis, shot shape, peak height, and descent angle.\n"
        "2. Use raw visual frames second when available.\n"
        "3. Use pose_supporting_context last. Pose tracking and overlays can be shaky, especially "
        "legs/hips, so treat them as hints rather than proof.\n"
        "If launch numbers and pose hints disagree, trust the launch numbers and say the pose "
        "data is uncertain.\n\n"
        f"Visual frames attached: {len(images)}. When images are attached, they are sampled "
        "from the raw swing video and the annotated/marker video. Use the raw golfer motion "
        "as primary evidence; marker overlays may be approximate or temporarily inaccurate. "
        "Review the sequence across as many attached frames as needed before deciding the priority issue.\n"
        "Treat hip depth and balance as camera-specific trend metrics, not true 3D measurements.\n"
        "\nAnalyze, when visible, setup, takeaway, backswing, transition, downswing, impact, "
        "follow-through, tempo/balance, and especially the launch monitor numbers. Do not list every "
        "possible flaw. Pick the top 2 or 3 items that most affect the next swing, favoring "
        "issues that explain the measured ball flight.\n"
        "\nWrite the full coaching breakdown - do not abbreviate or cut yourself off. Use this "
        "mapping for each field:\n"
        "- priority_fault: Overall Grade plus the single most important fix.\n"
        "- why_it_matters: 3-5 sentence quick summary in plain English.\n"
        "- evidence: cover what looks good, confirmed issues, likely issues, "
        "launch-monitor interpretation, and data/camera quality notes.\n"
        "- drill: 2-3 drills; for each include what it fixes, how to do it, what to feel, and reps.\n"
        "- confidence: low|medium|high plus one short reason and a 3-item next swing checklist.\n"
        "Do not use alternate keys like priority, observations, drills, or summary. The required "
        "keys are exactly priority_fault, why_it_matters, evidence, drill, and confidence.\n"
        "Each value must be a single complete string (not an array). Be as thorough as needed, "
        "but do not repeat phrases, do not emit placeholders, and do not put schema/field names "
        "inside the values.\n"
        "\nReply with JSON only:\n"
        "{\n"
        '  "priority_fault": "Overall Grade: ... | Most Important Fix: ...",\n'
        '  "why_it_matters": "Quick Summary: ...",\n'
        '  "evidence": "Good: ... Issues: ... Data: ...",\n'
        '  "drill": "Recommended Drills: 1) ... 2) ... 3) ...",\n'
        '  "confidence": "medium - reason. Next: 1) ... 2) ... 3) ..."\n'
        "}"
    )

    body = {
        "model": model,
        "system": SYSTEM_PROMPT,
        "prompt": user_prompt,
        "stream": False,
        "format": "json",
        "options": {
            "temperature": float(cfg.get("temperature", 0.2)),
            "num_predict": int(cfg.get("max_tokens", 900)),
        },
    }
    if images:
        body["images"] = images
    sent_visual_frames = len(images)
    try:
        r = requests.post(endpoint, json=body, timeout=timeout)
        if r.status_code >= 400:
            error = _short_error(f"LLM {endpoint} returned HTTP {r.status_code}")
            log.warning(error)
            if images:
                log.warning("Retrying LLM without visual frames; model may not support vision")
                body.pop("images", None)
                r = requests.post(endpoint, json=body, timeout=timeout)
                if r.status_code >= 400:
                    error = _short_error(
                        f"LLM {endpoint} returned HTTP {r.status_code} without visual frames"
                    )
                    log.warning(error)
                    return {
                        "llm_status": "failed",
                        "llm_error": error,
                        "visual_frames_sent": sent_visual_frames,
                    }
            else:
                return {
                    "llm_status": "failed",
                    "llm_error": error,
                    "visual_frames_sent": 0,
                }
        data = r.json()
    except Exception as e:
        if images:
            error = _short_error(f"LLM visual call failed, retrying without images: {e}")
            log.warning(error)
            try:
                body.pop("images", None)
                images = []
                r = requests.post(endpoint, json=body, timeout=timeout)
                if r.status_code >= 400:
                    error = _short_error(
                        f"LLM {endpoint} returned HTTP {r.status_code} without visual frames"
                    )
                    log.warning(error)
                    return {
                        "llm_status": "failed",
                        "llm_error": error,
                        "visual_frames_sent": sent_visual_frames,
                    }
                data = r.json()
            except Exception as retry_error:
                error = _short_error(f"LLM call failed without visual frames: {retry_error}")
                log.warning(error)
                return {
                    "llm_status": "failed",
                    "llm_error": error,
                    "visual_frames_sent": sent_visual_frames,
                }
        else:
            error = _short_error(f"LLM call failed: {e}")
            log.warning(error)
            return {
                "llm_status": "failed",
                "llm_error": error,
                "visual_frames_sent": 0,
            }

    response = (
        data.get("response")
        or data.get("thinking")
        or data.get("message", {}).get("content")
    )
    if not response:
        return {
            "llm_status": "empty_response",
            "llm_error": "LLM response did not include response/message.content",
            "visual_frames_sent": sent_visual_frames,
        }

    try:
        parsed = _parse_json_object(response)
        if isinstance(parsed, dict):
            normalized = _normalize_coaching_json(parsed)
            if _has_required_coaching(normalized):
                normalized["llm_status"] = "ok"
                normalized["llm_error"] = ""
                normalized["visual_frames_sent"] = sent_visual_frames
                return normalized

            retry_prompt = (
                "Your previous JSON did not match the required dashboard schema:\n"
                f"{json.dumps(parsed)}\n\n"
                "Using the same swing context below, return JSON with exactly these keys: "
                "priority_fault, why_it_matters, evidence, drill, confidence. Every key must "
                "have useful non-empty coaching content. Do not add alternate key names.\n\n"
                f"{user_prompt}"
            )
            retry_body = dict(body)
            retry_body["prompt"] = retry_prompt
            retry_body.pop("images", None)
            try:
                retry = requests.post(endpoint, json=retry_body, timeout=timeout)
                retry.raise_for_status()
                retry_data = retry.json()
                retry_response = (
                    retry_data.get("response")
                    or retry_data.get("thinking")
                    or retry_data.get("message", {}).get("content")
                )
                retry_parsed = _parse_json_object(retry_response or "")
                if isinstance(retry_parsed, dict):
                    normalized = _normalize_coaching_json(retry_parsed)
                    if _has_required_coaching(normalized):
                        normalized["llm_status"] = "ok"
                        normalized["llm_error"] = ""
                        normalized["visual_frames_sent"] = sent_visual_frames
                        return normalized
            except Exception as e:
                log.info("LLM schema repair failed: %s", e)

            return {
                "llm_status": "invalid_response",
                "llm_error": "LLM JSON omitted required coaching fields",
                "visual_frames_sent": sent_visual_frames,
            }
    except Exception:
        log.info("LLM response was not valid JSON; returning raw text")
        return {
            "summary": response.strip(),
            "confidence": "low",
            "llm_status": "raw_text",
            "llm_error": "",
            "visual_frames_sent": sent_visual_frames,
        }
    return {
        "llm_status": "invalid_response",
        "llm_error": "LLM response parsed to a non-object JSON value",
        "visual_frames_sent": sent_visual_frames,
    }
