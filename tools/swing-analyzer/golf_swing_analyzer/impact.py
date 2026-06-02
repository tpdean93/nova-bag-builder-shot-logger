"""Top-down camera impact analysis.

A second camera mounted directly above the hitting area sees the ball and the
clubhead from above, which is the best view for judging *where on the face*
and *where in the stance* contact happens, plus the club's approach direction
through the ball (in-to-out / out-to-in as seen from above).

This module is deliberately self-contained and defensive: every step degrades
to a "low confidence / not found" result instead of raising, so enabling the
top-down camera can never break the main down-the-line pipeline.

Pipeline:
  1. Open the top-down clip and read frames inside a window around the
     estimated impact time.
  2. Detect the (stationary) ball as the most stable bright circular blob near
     the configured hitting zone.
  3. Find impact = the frame with the largest motion energy right next to the
     ball (the clubhead arriving). Estimate the club's approach direction from
     the motion centroid just before that frame.
  4. Report ball + impact location in normalized (0..1) frame coordinates, an
     approach angle, and a calibratable contact offset, plus an annotated
     still saved next to the analyzed clips.

NOTE: contact offset (heel/toe, lead/trail) is a 2D proxy. It becomes a real
measurement only after you calibrate the hitting zone with a known reference
(see top_down.impact.* in config). Until then treat it as a directional hint.
"""
from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

log = logging.getLogger(__name__)


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, float(v)))


def _read_window(video_path: str, center_s: Optional[float], window_s: float):
    """Return (frames_bgr, fps, width, height, base_frame_index)."""
    import cv2

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open top-down video: {video_path}")
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 120.0) or 120.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    if center_s is None:
        # No DTL impact time - search around the middle of the clip.
        center_s = ((total / 2) / fps) if total > 0 else 0.0
    half = max(1, int(window_s * fps))
    center_f = int(center_s * fps)
    start_f = max(0, center_f - half)
    end_f = (center_f + half) if total <= 0 else min(total - 1, center_f + half)

    if start_f > 0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_f)

    frames: List[Any] = []
    idx = start_f
    while idx <= end_f:
        ok, frame = cap.read()
        if not ok or frame is None:
            break
        frames.append(frame)
        idx += 1
    cap.release()
    return frames, fps, width, height, start_f


def _detect_ball(
    frames: List[Any],
    width: int,
    height: int,
    cfg: Dict[str, Any],
) -> Optional[Tuple[float, float, float]]:
    """Return (cx, cy, radius) in pixels for the most consistent ball, or None."""
    import cv2
    import numpy as np

    if not frames:
        return None

    min_r = int(cfg.get("ball_min_radius_px", 6))
    max_r = int(cfg.get("ball_max_radius_px", 40))
    zone_cx = _clamp01(cfg.get("hitting_zone_x_pct", 0.5)) * width
    zone_cy = _clamp01(cfg.get("hitting_zone_y_pct", 0.5)) * height
    zone_r = _clamp01(cfg.get("hitting_zone_radius_pct", 0.35)) * max(width, height)

    candidates: List[Tuple[float, float, float]] = []
    # The ball is stationary before impact, so sample the earliest frames.
    for frame in frames[: min(len(frames), 12)]:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.medianBlur(gray, 5)
        circles = cv2.HoughCircles(
            gray,
            cv2.HOUGH_GRADIENT,
            dp=1.2,
            minDist=max(10, min_r * 2),
            param1=120,
            param2=18,
            minRadius=min_r,
            maxRadius=max_r,
        )
        if circles is None:
            continue
        for c in np.round(circles[0]).astype(int):
            cx, cy, r = float(c[0]), float(c[1]), float(c[2])
            if math.hypot(cx - zone_cx, cy - zone_cy) <= zone_r:
                candidates.append((cx, cy, r))

    if not candidates:
        return None

    # The real ball appears in nearly the same spot every frame; cluster by
    # rounded position and take the most frequent.
    import numpy as np  # noqa: F811

    buckets: Dict[Tuple[int, int], List[Tuple[float, float, float]]] = {}
    for cx, cy, r in candidates:
        key = (int(cx // 8), int(cy // 8))
        buckets.setdefault(key, []).append((cx, cy, r))
    best = max(buckets.values(), key=len)
    arr = np.array(best)
    return float(arr[:, 0].mean()), float(arr[:, 1].mean()), float(arr[:, 2].mean())


def _find_impact_frame(
    frames: List[Any],
    ball: Tuple[float, float, float],
) -> Tuple[int, Optional[Tuple[float, float]]]:
    """Return (impact_local_index, approach_vector) using motion near the ball.

    Impact = frame with the most pixel change inside a box around the ball
    (the clubhead sweeping through). The approach vector is the direction the
    motion centroid travels in the few frames leading up to that peak.
    """
    import cv2
    import numpy as np

    if len(frames) < 2:
        return 0, None

    cx, cy, r = ball
    pad = int(max(r * 4, 30))
    x1, y1 = max(0, int(cx - pad)), max(0, int(cy - pad))
    x2, y2 = int(cx + pad), int(cy + pad)

    energies: List[float] = []
    centroids: List[Optional[Tuple[float, float]]] = []
    prev_gray = None
    for frame in frames:
        roi = frame[y1:y2, x1:x2]
        if roi.size == 0:
            energies.append(0.0)
            centroids.append(None)
            prev_gray = None
            continue
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        if prev_gray is None or prev_gray.shape != gray.shape:
            energies.append(0.0)
            centroids.append(None)
        else:
            diff = cv2.absdiff(gray, prev_gray)
            _, mask = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
            energies.append(float(mask.sum()))
            m = cv2.moments(mask)
            if m["m00"] > 0:
                centroids.append((m["m10"] / m["m00"] + x1, m["m01"] / m["m00"] + y1))
            else:
                centroids.append(None)
        prev_gray = gray

    impact_idx = int(np.argmax(energies)) if energies else 0

    approach: Optional[Tuple[float, float]] = None
    pts = [c for c in centroids[max(0, impact_idx - 4): impact_idx + 1] if c]
    if len(pts) >= 2:
        dx = pts[-1][0] - pts[0][0]
        dy = pts[-1][1] - pts[0][1]
        if abs(dx) > 1e-3 or abs(dy) > 1e-3:
            approach = (dx, dy)
    return impact_idx, approach


def analyze_top_down(
    video_path: str,
    cfg: Dict[str, Any],
    impact_time_s: Optional[float] = None,
    out_image_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Analyze a top-down clip and return an impact-location summary.

    Always returns a dict with a ``status`` key; never raises for ordinary
    failure modes (missing ball, unreadable clip, etc.).
    """
    impact_cfg = cfg.get("impact", {}) or {}
    window_s = float(impact_cfg.get("search_window_s", 0.6))

    try:
        frames, fps, width, height, base_f = _read_window(
            video_path, impact_time_s, window_s
        )
    except Exception as e:
        log.warning("Top-down read failed: %s", e)
        return {"status": "read_failed", "error": str(e)}

    if not frames or width <= 0 or height <= 0:
        return {"status": "empty_clip"}

    ball = _detect_ball(frames, width, height, impact_cfg)
    if ball is None:
        return {
            "status": "no_ball",
            "note": "No ball found in the hitting zone. Tune top_down.impact "
            "hitting_zone_* and ball_*_radius_px for your camera height.",
            "frame_size": [width, height],
        }

    cx, cy, r = ball
    impact_local, approach = _find_impact_frame(frames, ball)

    approach_angle = None
    contact = None
    if approach is not None:
        dx, dy = approach
        # Angle of the club's path across the top-down image, measured from the
        # target line (configured X axis). Negative = out-to-in, positive =
        # in-to-out (calibrate the sign to your camera orientation).
        approach_angle = round(math.degrees(math.atan2(dy, dx)), 1)
        # Contact offset of the impact-motion centroid relative to the ball,
        # normalized by ball radius: a directional heel/toe + lead/trail hint.
        contact = {
            "offset_x_radii": round((approach[0]) / max(r, 1.0), 2),
            "offset_y_radii": round((approach[1]) / max(r, 1.0), 2),
        }

    result: Dict[str, Any] = {
        "status": "ok",
        "frame_size": [width, height],
        "fps": round(fps, 1),
        "ball_px": [round(cx, 1), round(cy, 1)],
        "ball_radius_px": round(r, 1),
        "ball_norm": [round(cx / width, 4), round(cy / height, 4)],
        "impact_frame_index": base_f + impact_local,
        "approach_vector_px": None if approach is None else [round(approach[0], 1), round(approach[1], 1)],
        "approach_angle_deg": approach_angle,
        "contact_offset": contact,
        "calibrated": bool(impact_cfg.get("calibrated", False)),
    }

    if out_image_path:
        try:
            _render_still(frames[impact_local], ball, approach, out_image_path)
            result["overlay_image"] = out_image_path
        except Exception as e:
            log.debug("Top-down still render skipped: %s", e)

    bits = [f"ball at {result['ball_norm'][0]:.2f},{result['ball_norm'][1]:.2f}"]
    if approach_angle is not None:
        bits.append(f"approach {approach_angle:+.0f} deg")
    if not result["calibrated"]:
        bits.append("(uncalibrated)")
    result["summary"] = "Top-down impact: " + ", ".join(bits)
    return result


def _render_still(
    frame: Any,
    ball: Tuple[float, float, float],
    approach: Optional[Tuple[float, float]],
    out_path: str,
) -> None:
    import cv2

    img = frame.copy()
    cx, cy, r = [int(round(v)) for v in ball]
    cv2.circle(img, (cx, cy), max(2, r), (80, 255, 255), 2)
    cv2.drawMarker(img, (cx, cy), (80, 255, 255), cv2.MARKER_CROSS, 18, 2)
    if approach is not None:
        ex = int(cx + approach[0] * 3)
        ey = int(cy + approach[1] * 3)
        cv2.arrowedLine(img, (cx, cy), (ex, ey), (255, 80, 255), 2, tipLength=0.3)
    cv2.putText(img, "IMPACT (top-down)", (12, 28),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (80, 255, 255), 2)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(out_path, img)
