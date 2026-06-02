"""MediaPipe Tasks API pose detection across a video."""
from __future__ import annotations

import logging
import os
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

log = logging.getLogger(__name__)


# 33 BlazePose landmarks; we only care about the body ones below.
LANDMARK_NAMES = {
    0: "nose",
    11: "left_shoulder", 12: "right_shoulder",
    13: "left_elbow", 14: "right_elbow",
    15: "left_wrist", 16: "right_wrist",
    23: "left_hip", 24: "right_hip",
    25: "left_knee", 26: "right_knee",
    27: "left_ankle", 28: "right_ankle",
}


# lite is fastest/noisiest, heavy is slowest/steadiest. "heavy" tracks the
# body far more smoothly (fewer stutters), which is what we want now that the
# bay is well lit and we process clips offline.
MODEL_VARIANTS = ("lite", "full", "heavy")
DEFAULT_MODEL = "heavy"


def _model_filename(variant: str) -> str:
    return f"pose_landmarker_{variant}.task"


def _model_url(variant: str) -> str:
    return (
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
        f"pose_landmarker_{variant}/float16/latest/pose_landmarker_{variant}.task"
    )


def _models_dir() -> Path:
    here = Path(__file__).resolve().parent.parent
    d = here / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d


def ensure_model(variant: str = DEFAULT_MODEL) -> Path:
    """Download the requested Pose Landmarker model file if missing."""
    variant = variant if variant in MODEL_VARIANTS else DEFAULT_MODEL
    target = _models_dir() / _model_filename(variant)
    if target.exists() and target.stat().st_size > 0:
        return target
    log.info("Downloading MediaPipe pose model (%s) to %s ...", variant, target)
    tmp = target.with_suffix(".task.part")
    urllib.request.urlretrieve(_model_url(variant), tmp)
    os.replace(tmp, target)
    log.info("Pose model downloaded (%.1f MB)", target.stat().st_size / 1_000_000)
    return target


class _OneEuroFilter:
    """1-D One-Euro filter (Casiez et al.) for low-jitter, low-lag smoothing.

    This is the standard fix for the kind of marker "stutter" you get from a
    plain exponential average: it smooths hard when the joint is still and
    loosens up automatically during fast motion (the downswing) so the
    skeleton doesn't lag the body. One filter is kept per landmark axis.
    """

    def __init__(self, min_cutoff: float, beta: float, d_cutoff: float) -> None:
        self.min_cutoff = float(min_cutoff)
        self.beta = float(beta)
        self.d_cutoff = float(d_cutoff)
        self._x_prev: Optional[float] = None
        self._dx_prev: float = 0.0
        self._t_prev: Optional[float] = None

    @staticmethod
    def _alpha(cutoff: float, dt: float) -> float:
        tau = 1.0 / (2.0 * np.pi * max(cutoff, 1e-6))
        return 1.0 / (1.0 + tau / max(dt, 1e-6))

    def __call__(self, t: float, x: float) -> float:
        if self._x_prev is None or self._t_prev is None:
            self._x_prev = x
            self._t_prev = t
            return x
        dt = t - self._t_prev
        if dt <= 0:
            dt = 1e-3
        dx = (x - self._x_prev) / dt
        a_d = self._alpha(self.d_cutoff, dt)
        dx_hat = a_d * dx + (1.0 - a_d) * self._dx_prev
        cutoff = self.min_cutoff + self.beta * abs(dx_hat)
        a = self._alpha(cutoff, dt)
        x_hat = a * x + (1.0 - a) * self._x_prev
        self._x_prev = x_hat
        self._dx_prev = dx_hat
        self._t_prev = t
        return x_hat


@dataclass
class FramePose:
    frame_index: int
    timestamp_s: float
    landmarks: Dict[str, Tuple[float, float, float]]
    pixel_landmarks: Dict[str, Tuple[int, int]]
    visibility: Dict[str, float]


def detect_video_pose(
    video_path: str,
    sample_rate: int = 2,
    min_torso_visibility: float = 0.6,
    smoothing_alpha: float = 0.35,
    model: str = DEFAULT_MODEL,
    smoothing: str = "one_euro",
    one_euro: Optional[Dict[str, float]] = None,
    detection_confidence: float = 0.6,
    presence_confidence: float = 0.6,
    tracking_confidence: float = 0.6,
) -> Tuple[List[FramePose], int, int, float, int]:
    """Run MediaPipe Pose Landmarker on every Nth frame.

    Frames where the model latches on to background clutter (a bike, a
    chair, etc.) usually score low on torso visibility. We reject those
    so they don't pollute the velocity / metric calculations.

    ``model`` selects the landmarker variant ("lite"/"full"/"heavy"); heavy is
    the steadiest. ``smoothing`` chooses the jitter filter: "one_euro"
    (recommended), "ema" (legacy exponential average), or "none".

    Returns (frames, width, height, fps, total_frames).
    """
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_tasks
    from mediapipe.tasks.python import vision as mp_vision

    model_path = str(ensure_model(model))

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    sample_rate = max(1, int(sample_rate))
    frames: List[FramePose] = []
    rejected_low_vis = 0

    base_options = mp_tasks.BaseOptions(model_asset_path=model_path)
    options = mp_vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=mp_vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=float(detection_confidence),
        min_pose_presence_confidence=float(presence_confidence),
        min_tracking_confidence=float(tracking_confidence),
    )

    torso_keys = ("left_shoulder", "right_shoulder", "left_hip", "right_hip")

    with mp_vision.PoseLandmarker.create_from_options(options) as landmarker:
        idx = -1
        while True:
            ok, frame_bgr = cap.read()
            if not ok:
                break
            idx += 1
            if idx % sample_rate != 0:
                continue

            frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
            timestamp_ms = int((idx / fps) * 1000)
            result = landmarker.detect_for_video(mp_image, timestamp_ms)
            if not result.pose_landmarks:
                continue

            pose_landmarks = result.pose_landmarks[0]

            landmarks: Dict[str, Tuple[float, float, float]] = {}
            pixel_landmarks: Dict[str, Tuple[int, int]] = {}
            visibility: Dict[str, float] = {}

            for i, lm in enumerate(pose_landmarks):
                name = LANDMARK_NAMES.get(i)
                if not name:
                    continue
                landmarks[name] = (float(lm.x), float(lm.y), float(lm.z))
                pixel_landmarks[name] = (
                    int(lm.x * width),
                    int(lm.y * height),
                )
                visibility[name] = float(getattr(lm, "visibility", 1.0) or 1.0)

            torso_scores = [visibility.get(k, 0.0) for k in torso_keys]
            torso_vis = sum(torso_scores) / len(torso_scores) if torso_scores else 0.0
            if torso_vis < min_torso_visibility:
                rejected_low_vis += 1
                continue

            frames.append(
                FramePose(
                    frame_index=idx,
                    timestamp_s=idx / fps,
                    landmarks=landmarks,
                    pixel_landmarks=pixel_landmarks,
                    visibility=visibility,
                )
            )

    cap.release()
    mode = (smoothing or "one_euro").lower()
    if frames and mode == "one_euro":
        frames = _smooth_frames_one_euro(frames, width, height, one_euro or {})
    elif frames and mode == "ema" and smoothing_alpha > 0:
        frames = _smooth_frames(frames, width, height, smoothing_alpha)

    log.info(
        "Pose: %d kept frames, %d rejected (low torso vis), model=%s, "
        "smoothing=%s, %dx%d @ %.2f fps (total %d)",
        len(frames), rejected_low_vis, model, mode, width, height, fps, total,
    )
    return frames, width, height, fps, total


def _smooth_frames_one_euro(
    frames: List[FramePose],
    width: int,
    height: int,
    params: Dict[str, float],
) -> List[FramePose]:
    """One-Euro smoothing per landmark axis (normalized 0..1 coords).

    Tuning:
      - min_cutoff: lower = smoother when still (more jitter removed).
      - beta: higher = follows fast motion harder (less lag at impact).
      - d_cutoff: derivative cutoff, rarely needs changing.
    """
    min_cutoff = float(params.get("min_cutoff", 1.2))
    beta = float(params.get("beta", 0.02))
    d_cutoff = float(params.get("d_cutoff", 1.0))

    filters: Dict[str, Tuple[_OneEuroFilter, _OneEuroFilter, _OneEuroFilter]] = {}
    out: List[FramePose] = []
    for frame in frames:
        t = float(frame.timestamp_s)
        landmarks: Dict[str, Tuple[float, float, float]] = {}
        pixels: Dict[str, Tuple[int, int]] = {}
        for name, point in frame.landmarks.items():
            fx, fy, fz = filters.get(name) or (
                _OneEuroFilter(min_cutoff, beta, d_cutoff),
                _OneEuroFilter(min_cutoff, beta, d_cutoff),
                _OneEuroFilter(min_cutoff, beta, d_cutoff),
            )
            filters[name] = (fx, fy, fz)
            sx = fx(t, point[0])
            sy = fy(t, point[1])
            sz = fz(t, point[2])
            landmarks[name] = (sx, sy, sz)
            pixels[name] = (int(sx * width), int(sy * height))
        out.append(
            FramePose(
                frame_index=frame.frame_index,
                timestamp_s=frame.timestamp_s,
                landmarks=landmarks,
                pixel_landmarks=pixels,
                visibility=dict(frame.visibility),
            )
        )
    return out


def _smooth_frames(
    frames: List[FramePose],
    width: int,
    height: int,
    alpha: float,
) -> List[FramePose]:
    """Reduce frame-to-frame marker jitter without changing phase timing."""
    alpha = max(0.05, min(1.0, float(alpha)))
    smoothed: Dict[str, Tuple[float, float, float]] = {}
    out: List[FramePose] = []
    for frame in frames:
        landmarks: Dict[str, Tuple[float, float, float]] = {}
        pixels: Dict[str, Tuple[int, int]] = {}
        for name, point in frame.landmarks.items():
            prev = smoothed.get(name)
            vis = frame.visibility.get(name, 1.0)
            effective_alpha = alpha if vis >= 0.65 else alpha * 0.5
            if prev is None:
                smooth = point
            else:
                smooth = (
                    prev[0] + effective_alpha * (point[0] - prev[0]),
                    prev[1] + effective_alpha * (point[1] - prev[1]),
                    prev[2] + effective_alpha * (point[2] - prev[2]),
                )
            smoothed[name] = smooth
            landmarks[name] = smooth
            pixels[name] = (int(smooth[0] * width), int(smooth[1] * height))
        out.append(
            FramePose(
                frame_index=frame.frame_index,
                timestamp_s=frame.timestamp_s,
                landmarks=landmarks,
                pixel_landmarks=pixels,
                visibility=dict(frame.visibility),
            )
        )
    return out


def midpoint(a: Tuple[float, float], b: Tuple[float, float]) -> Tuple[float, float]:
    return ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)


def angle_deg(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
    """Angle of line p1->p2 from horizontal, in degrees, [0, 90]."""
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    if dx == 0 and dy == 0:
        return 0.0
    angle = np.degrees(np.arctan2(abs(dy), abs(dx)))
    return float(angle)
