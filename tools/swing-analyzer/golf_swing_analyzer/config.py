"""Config loader."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

import yaml


DEFAULTS: Dict[str, Any] = {
    "paths": {
        "raw_video_dir": "C:/golf_swings/raw",
        "annotated_video_dir": "C:/golf_swings/annotated",
        "shot_data_dir": "C:/golf_swings/shot_data",
        "analysis_dir": "C:/golf_swings/analysis",
    },
    "matching": {
        "max_time_difference_seconds": 15,
        "wait_for_video_seconds": 25,
    },
    "retention": {
        "keep_recent_swings": 5,
    },
    "camera": {
        "angle": "down_the_line",
        # 1 = analyze every frame (smoothest tracking, slower). 2 = every other.
        "fps_sample_rate": 1,
    },
    "tracking": {
        # Pose model: "lite" | "full" | "heavy". Heavy is the steadiest and
        # is recommended for a well-lit bay since clips process offline.
        "pose_model": "heavy",
        # Jitter filter: "one_euro" (recommended) | "ema" | "none".
        "smoothing": "one_euro",
        "one_euro": {
            "min_cutoff": 1.2,
            "beta": 0.02,
            "d_cutoff": 1.0,
        },
        # Legacy exponential-average strength (only used when smoothing: ema).
        "smoothing_alpha": 0.35,
        "min_torso_visibility": 0.6,
        "detection_confidence": 0.6,
        "presence_confidence": 0.6,
        "tracking_confidence": 0.6,
    },
    "annotation": {
        "slow_motion_factor": 0.5,
        "overlays": {
            "advanced": True,
            "pelvis_depth_line": True,
            "spine_inclination_line": True,
            "head_box": True,
            "shoulder_plane_trace": True,
            "hand_path_trace": True,
        },
    },
    "server": {
        "host": "0.0.0.0",
        "port": 8765,
        "public_base_url": "",
    },
    "obs": {
        "enabled": True,
        "host": "127.0.0.1",
        "port": 4455,
        "password": "",
        "save_replay_on_shot": True,
    },
    "mqtt": {
        "enabled": True,
        "host": "192.168.68.117",
        "port": 1883,
        "username": "",
        "password": "",
        "client_id": "golf_swing_analyzer",
        "shot_topic": "golf/shot/raw",
        "context_topic": "golf/context/current",
        "enable_topic": "golf/swing/analyzer/enabled",
        "result_prefix": "golf/swing/analysis",
        "discovery_prefix": "homeassistant",
        "device_name": "Golf Swing Analyzer",
        "device_id": "golf_swing_analyzer",
    },
    "llm": {
        "enabled": False,
        "endpoint": "http://localhost:11434/api/generate",
        "model": "trinity",
        "timeout_seconds": 60,
        # Higher = the coach can return its full breakdown without being cut
        # off. The full text rides along as MQTT attributes so it is not
        # capped by Home Assistant's 255-char sensor state limit.
        "max_tokens": 900,
    },
    "archive": {
        "enabled": False,
        "keep_last": 5,
        "filename_template": "swing_{timestamp}_{original}",
        "destinations": [],
    },
    # Optional second camera mounted directly above the hitting area. When a
    # clip lands in raw_video_dir, it is matched to the same shot (by time)
    # and analyzed for ball + impact location. Disabled until the camera is
    # set up so it can never disturb the down-the-line pipeline.
    "top_down": {
        "enabled": False,
        "raw_video_dir": "C:/golf_swings/top_down",
        "public_base_url": "",
        "angle": "top_down",
        "impact": {
            "search_window_s": 0.6,
            "ball_min_radius_px": 6,
            "ball_max_radius_px": 40,
            # Where the ball sits in the top-down frame (0..1) and how far out
            # to look for it. Tune these to your camera height/position.
            "hitting_zone_x_pct": 0.5,
            "hitting_zone_y_pct": 0.5,
            "hitting_zone_radius_pct": 0.35,
            # Flip to true once you calibrate a real-world reference so the
            # contact offsets read as measurements, not directional hints.
            "calibrated": False,
        },
    },
}


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def load_config(path: str | os.PathLike[str]) -> Dict[str, Any]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Config not found: {p}")
    with p.open("r", encoding="utf-8") as f:
        user = yaml.safe_load(f) or {}
    cfg = _deep_merge(DEFAULTS, user)

    for d in cfg["paths"].values():
        Path(d).mkdir(parents=True, exist_ok=True)

    return cfg
