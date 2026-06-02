"""Body metrics derived from pose frames."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np

from .pose import FramePose, angle_deg, midpoint

log = logging.getLogger(__name__)


@dataclass
class SwingPhases:
    address_idx: Optional[int]
    top_idx: Optional[int]
    impact_idx: Optional[int]
    finish_idx: Optional[int]


def _have(frame: FramePose, *names: str, min_vis: float = 0.4) -> bool:
    for n in names:
        if n not in frame.pixel_landmarks:
            return False
        if frame.visibility.get(n, 0.0) < min_vis:
            return False
    return True


def _wrist_xy(frame: FramePose) -> Optional[Tuple[float, float]]:
    """Return midpoint of available wrists in pixels."""
    if _have(frame, "left_wrist", "right_wrist"):
        return midpoint(
            frame.pixel_landmarks["left_wrist"],
            frame.pixel_landmarks["right_wrist"],
        )
    if _have(frame, "left_wrist"):
        return tuple(map(float, frame.pixel_landmarks["left_wrist"]))
    if _have(frame, "right_wrist"):
        return tuple(map(float, frame.pixel_landmarks["right_wrist"]))
    return None


def detect_phases(frames: List[FramePose]) -> SwingPhases:
    """Velocity-based phase detection.

    Replay buffer clips usually have many seconds of pre/post motion (walking
    in, addressing, swinging, walking out). A naive "min wrist y" or
    "first stable frame" approach picks up walking poses and gives absurd
    backswing:downswing ratios. Instead we:

      1. Compute smoothed wrist speed per sampled frame.
      2. Pick impact = argmax speed.
      3. Look backward inside a 1.5s pre-impact window for the top
         (smallest wrist Y or speed minimum just before impact).
      4. Walk further backward for the last "calm" segment - that's address.
    """
    if not frames:
        return SwingPhases(None, None, None, None)

    n = len(frames)
    finish_idx = n - 1
    if n < 3:
        return SwingPhases(0, None, None, finish_idx)

    # 1. Per-frame wrist position + speed
    wrists: List[Optional[tuple]] = [_wrist_xy(f) for f in frames]
    speeds: List[float] = [0.0] * n
    for i in range(1, n):
        a = wrists[i - 1]
        b = wrists[i]
        if a is None or b is None:
            speeds[i] = 0.0
        else:
            dx, dy = b[0] - a[0], b[1] - a[1]
            speeds[i] = (dx * dx + dy * dy) ** 0.5

    smoothed: List[float] = speeds[:]
    for i in range(2, n - 2):
        smoothed[i] = (
            speeds[i - 2] + speeds[i - 1] + speeds[i] + speeds[i + 1] + speeds[i + 2]
        ) / 5.0

    # The actual ball strike is much faster than walking, placing the ball,
    # or a practice waggle. Use a "stillness then peak" pattern:
    #   walk in -> setup -> *still at address* -> SWING -> done.
    # Find the LAST stillness run, then the peak speed after it.

    sorted_speeds = sorted(s for s in smoothed if s > 0)
    if not sorted_speeds:
        return SwingPhases(0, None, None, finish_idx)
    # 60th percentile is a reasonable "moving" floor; below 30% of that is
    # treated as "still".
    p60 = sorted_speeds[int(len(sorted_speeds) * 0.60)]
    still_threshold = max(1.5, p60 * 0.30)

    still_run_min = 4   # ~4 sampled frames at 30Hz sample = ~0.13s
    address_anchor: Optional[int] = None
    run_len = 0
    for i in range(n):
        if smoothed[i] <= still_threshold:
            run_len += 1
        else:
            if run_len >= still_run_min:
                address_anchor = i - 1   # last still frame in the run
            run_run_reset_marker = True   # noqa: F841 (clarity only)
            run_len = 0
    if run_len >= still_run_min and address_anchor is None:
        address_anchor = n - 1

    # 2. Impact = peak speed AFTER the last stillness run, with a safety
    #    margin against the very last frames.
    margin_end = max(1, n // 30)
    if address_anchor is not None and address_anchor < n - 2:
        impact_search_start = address_anchor + 1
    else:
        impact_search_start = max(2, n // 5)

    impact_search_end = n - margin_end
    if impact_search_end <= impact_search_start:
        impact_search_end = n - 1

    impact_idx = max(
        range(impact_search_start, impact_search_end),
        key=lambda i: smoothed[i],
        default=None,
    )
    if impact_idx is None or smoothed[impact_idx] <= still_threshold:
        # Fall back to global peak if the post-stillness search found nothing.
        impact_idx = max(range(n), key=lambda i: smoothed[i])

    # 3. Top of swing: highest wrist (smallest y) between address and impact.
    top_search_start = address_anchor if address_anchor is not None else max(
        0, impact_idx - 45
    )
    top_idx: Optional[int] = None
    top_y = float("inf")
    for i in range(top_search_start, impact_idx):
        w = wrists[i]
        if w is None:
            continue
        if w[1] < top_y:
            top_y = w[1]
            top_idx = i
    if top_idx is None:
        top_idx = max(top_search_start, impact_idx - 15)

    address_idx = (
        address_anchor if address_anchor is not None
        else max(0, top_idx - 30)
    )

    log.info(
        "Phases: address=%s top=%s impact=%s finish=%s "
        "(n=%d, still_thr=%.2f, peak=%.2f)",
        address_idx, top_idx, impact_idx, finish_idx,
        n, still_threshold, smoothed[impact_idx],
    )
    return SwingPhases(address_idx, top_idx, impact_idx, finish_idx)


def _severity(value: float, low: float, high: float) -> str:
    v = abs(value)
    if v < low:
        return "low"
    if v < high:
        return "moderate"
    return "high"


def _spine_angle_deg(frame: FramePose) -> Optional[float]:
    if not _have(
        frame,
        "left_shoulder", "right_shoulder",
        "left_hip", "right_hip",
        min_vis=0.3,
    ):
        return None
    sh = midpoint(
        frame.pixel_landmarks["left_shoulder"],
        frame.pixel_landmarks["right_shoulder"],
    )
    hp = midpoint(
        frame.pixel_landmarks["left_hip"],
        frame.pixel_landmarks["right_hip"],
    )
    return angle_deg(sh, hp)


def _shoulder_tilt_deg(frame: FramePose) -> Optional[float]:
    if not _have(frame, "left_shoulder", "right_shoulder", min_vis=0.3):
        return None
    ls = frame.pixel_landmarks["left_shoulder"]
    rs = frame.pixel_landmarks["right_shoulder"]
    return angle_deg(ls, rs)


def _knee_angle_deg(frame: FramePose, side: str) -> Optional[float]:
    hip = f"{side}_hip"
    knee = f"{side}_knee"
    ankle = f"{side}_ankle"
    if not _have(frame, hip, knee, ankle, min_vis=0.3):
        return None
    a = np.array(frame.pixel_landmarks[hip], dtype=float)
    b = np.array(frame.pixel_landmarks[knee], dtype=float)
    c = np.array(frame.pixel_landmarks[ankle], dtype=float)
    ba = a - b
    bc = c - b
    denom = (np.linalg.norm(ba) * np.linalg.norm(bc)) or 1.0
    cos_angle = float(np.dot(ba, bc) / denom)
    cos_angle = max(-1.0, min(1.0, cos_angle))
    return float(np.degrees(np.arccos(cos_angle)))


def _line_between(frame: FramePose, a: str, b: str) -> Optional[Dict[str, object]]:
    if not _have(frame, a, b, min_vis=0.3):
        return None
    p1 = frame.pixel_landmarks[a]
    p2 = frame.pixel_landmarks[b]
    return {
        "start": [int(p1[0]), int(p1[1])],
        "end": [int(p2[0]), int(p2[1])],
        "angle_deg": round(angle_deg(p1, p2), 1),
    }


def _midpoint_px(frame: FramePose, a: str, b: str) -> Optional[Tuple[float, float]]:
    if not _have(frame, a, b, min_vis=0.3):
        return None
    return midpoint(frame.pixel_landmarks[a], frame.pixel_landmarks[b])


def _spine_line(frame: FramePose) -> Optional[Dict[str, object]]:
    sh = _midpoint_px(frame, "left_shoulder", "right_shoulder")
    hp = _midpoint_px(frame, "left_hip", "right_hip")
    if sh is None or hp is None:
        return None
    return {
        "start": [int(sh[0]), int(sh[1])],
        "end": [int(hp[0]), int(hp[1])],
        "angle_deg": round(angle_deg(sh, hp), 1),
    }


def _label_score(score: float, good: float = 75.0, watch: float = 55.0) -> str:
    if score >= good:
        return "good"
    if score >= watch:
        return "watch"
    return "poor"


def _clamp_score(value: float) -> float:
    return round(max(0.0, min(100.0, value)), 1)


def _phase_frame(frames: List[FramePose], idx: Optional[int]) -> Optional[FramePose]:
    if idx is None or idx < 0 or idx >= len(frames):
        return None
    return frames[idx]


def _downsample(points: List[Dict[str, object]], limit: int = 80) -> List[Dict[str, object]]:
    if len(points) <= limit:
        return points
    step = max(1, int(np.ceil(len(points) / limit)))
    sampled = points[::step]
    if points[-1] is not sampled[-1]:
        sampled.append(points[-1])
    return sampled


def compute_advanced_metrics(
    frames: List[FramePose],
    phases: SwingPhases,
    body: Dict[str, object],
    width: int,
    height: int,
    camera_angle: str = "down_the_line",
) -> Dict[str, object]:
    """Return overlay geometry and camera-relative swing scores.

    These are 2D pose-derived trend metrics. In down-the-line video, hip depth
    is a frame-space proxy, not a calibrated 3D measurement.
    """
    if not frames or phases.address_idx is None or phases.impact_idx is None:
        return {
            "advanced": {},
            "scores": {},
            "score_summary": "Advanced swing metrics unavailable",
        }

    address = _phase_frame(frames, phases.address_idx)
    top = _phase_frame(frames, phases.top_idx)
    impact = _phase_frame(frames, phases.impact_idx)
    finish = _phase_frame(frames, phases.finish_idx)
    if address is None or impact is None:
        return {
            "advanced": {},
            "scores": {},
            "score_summary": "Advanced swing metrics unavailable",
        }

    px_unit = max(1.0, min(width, height) / 100.0)
    address_hip = _midpoint_px(address, "left_hip", "right_hip")
    impact_hip = _midpoint_px(impact, "left_hip", "right_hip")
    address_head = address.pixel_landmarks.get("nose") if _have(address, "nose") else None

    pelvis_reference = _line_between(address, "left_hip", "right_hip")
    pelvis_depth_line = None
    hip_depth_retention_pct = None
    hip_depth_delta_px = None
    if address_hip is not None and impact_hip is not None:
        hip_depth_delta_px = impact_hip[1] - address_hip[1]
        retained = 100.0 - min(100.0, abs(hip_depth_delta_px) / (px_unit * 6.0) * 100.0)
        hip_depth_retention_pct = _clamp_score(retained)
        pelvis_depth_line = {
            "reference": pelvis_reference,
            "address_center": [int(address_hip[0]), int(address_hip[1])],
            "impact_center": [int(impact_hip[0]), int(impact_hip[1])],
            "delta_px": round(float(hip_depth_delta_px), 1),
            "note": "2D down-the-line hip-depth proxy",
        }

    spine_lines = {
        "address": _spine_line(address),
        "impact": _spine_line(impact),
    }

    head_points: List[Tuple[int, int]] = []
    for frame in frames[phases.address_idx: phases.impact_idx + 1]:
        if _have(frame, "nose"):
            head_points.append(frame.pixel_landmarks["nose"])
    head_box = None
    if address_head and head_points:
        max_dx = max(abs(p[0] - address_head[0]) for p in head_points)
        max_dy = max(abs(p[1] - address_head[1]) for p in head_points)

        # Build a box that actually wraps the whole skull at address. The nose
        # alone sits low/front on the face, so we use the eyes and ears to find
        # the true head width and a vertical anchor near the middle of the head,
        # then extend well above (the crown) and below (the chin).
        def _addr(name: str):
            return address.pixel_landmarks.get(name) if _have(address, name) else None

        l_ear, r_ear = _addr("left_ear"), _addr("right_ear")
        l_eye, r_eye = _addr("left_eye"), _addr("right_eye")
        nose = _addr("nose") or address_head

        face_pts = [p for p in (nose, l_eye, r_eye, l_ear, r_ear) if p]

        # Head width: ear span is the most reliable; fall back to eye span, then
        # shoulders. The multipliers pad out to the outside of the skull/hair.
        if l_ear and r_ear:
            head_w = ((l_ear[0] - r_ear[0]) ** 2 + (l_ear[1] - r_ear[1]) ** 2) ** 0.5 * 1.6
        elif l_eye and r_eye:
            head_w = ((l_eye[0] - r_eye[0]) ** 2 + (l_eye[1] - r_eye[1]) ** 2) ** 0.5 * 2.8
        else:
            ls = _addr("left_shoulder")
            rs = _addr("right_shoulder")
            if ls and rs:
                shoulder_w = ((ls[0] - rs[0]) ** 2 + (ls[1] - rs[1]) ** 2) ** 0.5
            else:
                shoulder_w = width * 0.18
            head_w = shoulder_w * 0.62
        head_w = max(width * 0.07, head_w)
        head_h = head_w * 1.45  # skulls are taller than they are wide head-on

        cx = sum(p[0] for p in face_pts) / len(face_pts)
        # Anchor vertically on the ear/eye line (roughly the head's middle) so we
        # can push up to the crown; fall back to the nose when ears are hidden.
        if l_ear and r_ear:
            anchor_y = (l_ear[1] + r_ear[1]) / 2.0
        elif l_eye and r_eye:
            anchor_y = (l_eye[1] + r_eye[1]) / 2.0
        else:
            anchor_y = float(nose[1])

        x1 = max(0, int(cx - head_w * 0.55))
        x2 = min(width, int(cx + head_w * 0.55))
        y1 = max(0, int(anchor_y - head_h * 0.68))
        y2 = min(height, int(anchor_y + head_h * 0.62))
        head_box = {
            "rect": [x1, y1, x2, y2],
            "address_center": [int(cx), int(anchor_y)],
            "max_excursion_px": round(float((max_dx * max_dx + max_dy * max_dy) ** 0.5), 1),
            "max_horizontal_px": int(max_dx),
            "max_vertical_px": int(max_dy),
        }

    shoulder_plane_trace: List[Dict[str, object]] = []
    phase_lookup = {
        phases.address_idx: "address",
        phases.top_idx: "top",
        phases.impact_idx: "impact",
        phases.finish_idx: "finish",
    }
    for idx, frame in enumerate(frames):
        line = _line_between(frame, "left_shoulder", "right_shoulder")
        if line is None:
            continue
        shoulder_plane_trace.append({
            "frame_index": int(frame.frame_index),
            "phase": phase_lookup.get(idx),
            "angle_deg": line["angle_deg"],
            "start": line["start"],
            "end": line["end"],
        })
    shoulder_plane_trace = _downsample(shoulder_plane_trace)

    hand_path_trace: List[Dict[str, object]] = []
    start_idx = max(0, phases.address_idx)
    end_idx = phases.finish_idx if phases.finish_idx is not None else len(frames) - 1
    for idx, frame in enumerate(frames[start_idx:end_idx + 1], start=start_idx):
        wrist = _wrist_xy(frame)
        if wrist is None:
            continue
        hand_path_trace.append({
            "frame_index": int(frame.frame_index),
            "phase": phase_lookup.get(idx),
            "x": int(wrist[0]),
            "y": int(wrist[1]),
        })
    hand_path_trace = _downsample(hand_path_trace)

    transition_steepness_score = None
    transition_angle_deg = None
    if phases.top_idx is not None and hand_path_trace:
        top_frame = frames[phases.top_idx]
        top_wrist = _wrist_xy(top_frame)
        lookahead_idx = min(len(frames) - 1, phases.top_idx + max(2, (phases.impact_idx - phases.top_idx) // 3))
        early_wrist = _wrist_xy(frames[lookahead_idx])
        if top_wrist is not None and early_wrist is not None:
            dx = early_wrist[0] - top_wrist[0]
            dy = early_wrist[1] - top_wrist[1]
            transition_angle_deg = round(float(np.degrees(np.arctan2(abs(dy), abs(dx) or 1.0))), 1)
            # Very vertical first move gets flagged as steep; mid-range is neutral.
            transition_steepness_score = _clamp_score(100.0 - max(0.0, transition_angle_deg - 55.0) * 2.0)

    spine = body.get("spine_angle") if isinstance(body, dict) else None
    head = body.get("head_movement") if isinstance(body, dict) else None
    hip = body.get("hip_sway") if isinstance(body, dict) else None
    knees = body.get("knee_flex") if isinstance(body, dict) else None
    shoulder = body.get("shoulder_tilt") if isinstance(body, dict) else None

    spine_loss = abs(float(spine.get("loss_deg", 0.0))) if isinstance(spine, dict) else 0.0
    head_move_pct = abs(float(head.get("horizontal_pct", 0.0))) if isinstance(head, dict) else 0.0
    hip_move_units = abs(float(hip.get("horizontal_px", 0.0))) / px_unit if isinstance(hip, dict) else 0.0
    knee_change = 0.0
    if isinstance(knees, dict):
        changes = [
            abs(float(v.get("change_deg", 0.0)))
            for v in knees.values()
            if isinstance(v, dict) and v.get("change_deg") is not None
        ]
        knee_change = sum(changes) / len(changes) if changes else 0.0

    posture_penalty = spine_loss * 2.2 + head_move_pct * 6.0 + hip_move_units * 5.0 + knee_change * 0.8
    posture_delta_score = _clamp_score(100.0 - posture_penalty)
    shoulder_tilt_impact = (
        float(shoulder.get("impact_deg"))
        if isinstance(shoulder, dict) and shoulder.get("impact_deg") is not None
        else None
    )

    finish_stability = 0.0
    if finish is not None and impact_hip is not None and _have(finish, "left_hip", "right_hip"):
        finish_hip = _midpoint_px(finish, "left_hip", "right_hip")
        if finish_hip is not None:
            finish_stability = abs(finish_hip[0] - impact_hip[0]) / px_unit
    head_excursion = float(head_box.get("max_excursion_px", 0.0)) / px_unit if isinstance(head_box, dict) else 0.0
    visibility_values = [
        v
        for frame in (address, impact, finish)
        if frame is not None
        for v in frame.visibility.values()
    ]
    visibility_score = (sum(visibility_values) / len(visibility_values) * 100.0) if visibility_values else 70.0
    balance_score = _clamp_score(visibility_score - head_excursion * 2.5 - finish_stability * 2.0)

    scores = {
        "address_vs_impact_posture_delta": {
            "score": posture_delta_score,
            "label": _label_score(posture_delta_score),
            "spine_loss_deg": round(spine_loss, 1),
            "head_move_pct": round(head_move_pct, 2),
            "hip_move_units": round(hip_move_units, 2),
            "avg_knee_change_deg": round(knee_change, 1),
        },
        "hip_depth_retention_pct": {
            "score": hip_depth_retention_pct,
            "label": _label_score(float(hip_depth_retention_pct or 0.0)),
            "delta_px": hip_depth_delta_px,
            "camera_angle": camera_angle,
        },
        "shoulder_tilt_impact_deg": None if shoulder_tilt_impact is None else round(shoulder_tilt_impact, 1),
        "transition_steepness_score": {
            "score": transition_steepness_score,
            "label": _label_score(float(transition_steepness_score or 0.0)),
            "angle_deg": transition_angle_deg,
        },
        "balance_score": {
            "score": balance_score,
            "label": _label_score(balance_score),
            "head_excursion_units": round(head_excursion, 2),
            "finish_stability_units": round(finish_stability, 2),
        },
    }

    advanced = {
        "pelvis_depth_line": pelvis_depth_line,
        "spine_inclination_line": spine_lines,
        "head_box": head_box,
        "shoulder_plane_trace": shoulder_plane_trace,
        "hand_path_trace": hand_path_trace,
    }

    summary_parts = [
        f"posture {posture_delta_score:.0f}/{100}",
        f"hip depth {hip_depth_retention_pct:.0f}%" if hip_depth_retention_pct is not None else "hip depth n/a",
        f"transition {transition_steepness_score:.0f}/{100}" if transition_steepness_score is not None else "transition n/a",
        f"balance {balance_score:.0f}/{100}",
    ]
    return {
        "advanced": advanced,
        "scores": scores,
        "score_summary": ", ".join(summary_parts),
    }


def compute_body_metrics(
    frames: List[FramePose],
    phases: SwingPhases,
    fps: float,
    width: int,
    camera_angle: str = "down_the_line",
) -> Dict[str, object]:
    out: Dict[str, object] = {}

    if not frames or phases.address_idx is None or phases.impact_idx is None:
        return {
            "head_movement": None,
            "spine_angle": None,
            "hip_sway": None,
            "early_extension": None,
            "shoulder_tilt": None,
            "knee_flex": None,
            "tempo": None,
        }

    address = frames[phases.address_idx]
    impact = frames[phases.impact_idx]
    top = frames[phases.top_idx] if phases.top_idx is not None else None

    px_per_unit = max(1.0, width / 100.0)  # ~1% of frame width

    # Head movement
    if _have(address, "nose") and _have(impact, "nose"):
        ax, ay = address.pixel_landmarks["nose"]
        ix, iy = impact.pixel_landmarks["nose"]
        dx = ix - ax
        dy = iy - ay
        out["head_movement"] = {
            "horizontal_px": int(dx),
            "vertical_px": int(dy),
            "horizontal_pct": round(dx / max(width, 1) * 100, 2),
            "severity": _severity(abs(dx) / px_per_unit, 2.0, 5.0),
        }
    else:
        out["head_movement"] = None

    # Spine angle
    spine_address = _spine_angle_deg(address)
    spine_impact = _spine_angle_deg(impact)
    if spine_address is not None and spine_impact is not None:
        loss = spine_address - spine_impact
        out["spine_angle"] = {
            "address_deg": round(spine_address, 1),
            "impact_deg": round(spine_impact, 1),
            "loss_deg": round(loss, 1),
            "severity": _severity(loss, 5.0, 12.0),
        }
    else:
        out["spine_angle"] = None

    # Hip sway / early extension
    if _have(address, "left_hip", "right_hip") and _have(
        impact, "left_hip", "right_hip"
    ):
        a_hip = midpoint(
            address.pixel_landmarks["left_hip"],
            address.pixel_landmarks["right_hip"],
        )
        i_hip = midpoint(
            impact.pixel_landmarks["left_hip"],
            impact.pixel_landmarks["right_hip"],
        )
        sway_x = i_hip[0] - a_hip[0]
        sway_y = i_hip[1] - a_hip[1]
        out["hip_sway"] = {
            "horizontal_px": int(sway_x),
            "vertical_px": int(sway_y),
            "severity": _severity(abs(sway_x) / px_per_unit, 2.0, 5.0),
        }
        if camera_angle == "down_the_line":
            # In DTL, hips moving toward the ball = toward bottom of frame ~ y increases.
            out["early_extension"] = bool(sway_y < -px_per_unit * 1.5)
        else:
            out["early_extension"] = None
    else:
        out["hip_sway"] = None
        out["early_extension"] = None

    # Shoulder tilt
    tilt_address = _shoulder_tilt_deg(address)
    tilt_top = _shoulder_tilt_deg(top) if top is not None else None
    tilt_impact = _shoulder_tilt_deg(impact)
    if tilt_address is not None and tilt_impact is not None:
        out["shoulder_tilt"] = {
            "address_deg": round(tilt_address, 1),
            "top_deg": None if tilt_top is None else round(tilt_top, 1),
            "impact_deg": round(tilt_impact, 1),
        }
    else:
        out["shoulder_tilt"] = None

    # Knee flex change
    knee_data: Dict[str, object] = {}
    for side in ("left", "right"):
        a = _knee_angle_deg(address, side)
        i = _knee_angle_deg(impact, side)
        if a is not None and i is not None:
            knee_data[side] = {
                "address_deg": round(a, 1),
                "impact_deg": round(i, 1),
                "change_deg": round(i - a, 1),
            }
    out["knee_flex"] = knee_data or None

    # Tempo
    if (
        phases.address_idx is not None
        and phases.top_idx is not None
        and phases.impact_idx is not None
    ):
        bs = max(0, phases.top_idx - phases.address_idx)
        ds = max(0, phases.impact_idx - phases.top_idx)
        ratio = (bs / ds) if ds > 0 else None
        out["tempo"] = {
            "frames_address_to_top": int(bs),
            "frames_top_to_impact": int(ds),
            "backswing_to_downswing_ratio": None if ratio is None else round(ratio, 2),
        }
    else:
        out["tempo"] = None

    return out


def derive_faults(body: Dict[str, object], nova: Dict[str, object]) -> List[str]:
    faults: List[str] = []

    head = body.get("head_movement") if isinstance(body, dict) else None
    if isinstance(head, dict) and head.get("severity") in ("moderate", "high"):
        faults.append(f"{head['severity']} head movement")

    spine = body.get("spine_angle") if isinstance(body, dict) else None
    if isinstance(spine, dict) and spine.get("severity") in ("moderate", "high"):
        faults.append(f"{spine['severity']} spine angle loss")

    hip = body.get("hip_sway") if isinstance(body, dict) else None
    if isinstance(hip, dict) and hip.get("severity") == "high":
        faults.append("hip sway through impact")

    if body.get("early_extension"):
        faults.append("possible early extension")

    if isinstance(nova, dict):
        path = nova.get("club_path")
        face_to_path = nova.get("face_to_path")
        if isinstance(path, (int, float)) and path < -2:
            faults.append("out-to-in club path")
        elif isinstance(path, (int, float)) and path > 2:
            faults.append("in-to-out club path")
        if isinstance(face_to_path, (int, float)) and abs(face_to_path) > 4:
            direction = "open" if face_to_path > 0 else "closed"
            faults.append(f"face {direction} to path")

    return faults
