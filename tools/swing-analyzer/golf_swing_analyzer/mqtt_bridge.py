"""MQTT bridge: subscribes for shots/context/enable, publishes results + HA discovery."""
from __future__ import annotations

import json
import logging
import threading
from typing import Any, Callable, Dict, Optional

log = logging.getLogger(__name__)


class MQTTBridge:
    """Thin paho-mqtt wrapper with the topics this analyzer cares about."""

    def __init__(self, cfg: Dict[str, Any]) -> None:
        self.cfg = cfg
        self._client = None
        self._lock = threading.Lock()
        self._on_shot: Optional[Callable[[Dict[str, Any]], None]] = None
        self._on_context: Optional[Callable[[Dict[str, Any]], None]] = None
        self._on_enable: Optional[Callable[[bool], None]] = None
        self.enabled_state: bool = False
        self.context_state: Dict[str, Any] = {}

    # ----- public API -----
    def set_callbacks(
        self,
        on_shot: Callable[[Dict[str, Any]], None],
        on_context: Callable[[Dict[str, Any]], None],
        on_enable: Callable[[bool], None],
    ) -> None:
        self._on_shot = on_shot
        self._on_context = on_context
        self._on_enable = on_enable

    def start(self) -> None:
        if not self.cfg.get("enabled"):
            log.info("MQTT disabled in config")
            return
        try:
            import paho.mqtt.client as mqtt
        except ImportError:
            log.error("paho-mqtt not installed; pip install paho-mqtt")
            return

        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=self.cfg.get("client_id", "golf_swing_analyzer"),
        )
        if self.cfg.get("username"):
            client.username_pw_set(self.cfg["username"], self.cfg.get("password") or "")

        client.on_connect = self._on_connect
        client.on_message = self._on_message

        client.will_set(self._availability_topic(), "offline", retain=True)

        try:
            client.connect(self.cfg["host"], int(self.cfg.get("port", 1883)), keepalive=30)
        except Exception as e:
            log.error("MQTT connect failed: %s", e)
            return

        client.loop_start()
        self._client = client
        log.info(
            "MQTT bridge attempting %s:%s (user=%s)",
            self.cfg["host"],
            self.cfg.get("port", 1883),
            self.cfg.get("username") or "<anonymous>",
        )

    def stop(self) -> None:
        if self._client is None:
            return
        try:
            self._client.publish(self._availability_topic(), "offline", retain=True)
            self._client.loop_stop()
            self._client.disconnect()
        except Exception:
            pass
        self._client = None

    def publish_result(self, payload: Dict[str, Any]) -> bool:
        if self._client is None:
            return False
        prefix = self.cfg.get("result_prefix", "golf/swing/analysis").rstrip("/")
        try:
            self._client.publish(f"{prefix}/latest", json.dumps(payload), retain=True)
            self._client.publish(
                f"{prefix}/recent",
                json.dumps(payload.get("recent", [])),
                retain=True,
            )
            self._publish_state_attributes(payload)
            return True
        except Exception as e:
            log.warning("MQTT publish failed: %s", e)
            return False

    # ----- internals -----
    def _availability_topic(self) -> str:
        prefix = self.cfg.get("result_prefix", "golf/swing/analysis").rstrip("/")
        return f"{prefix}/availability"

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code != 0:
            log.warning(
                "MQTT auth/connect refused (rc=%s) for user=%s - check config "
                "and HA user account",
                reason_code,
                self.cfg.get("username") or "<anonymous>",
            )
            return

        log.info("MQTT bridge authenticated as %s", self.cfg.get("username") or "<anonymous>")
        client.subscribe(self.cfg["shot_topic"])
        client.subscribe(self.cfg["context_topic"])
        client.subscribe(self.cfg["enable_topic"])
        client.publish(self._availability_topic(), "online", retain=True)
        self._publish_discovery()
        log.info(
            "MQTT subscribed to shot=%s context=%s enable=%s",
            self.cfg["shot_topic"], self.cfg["context_topic"], self.cfg["enable_topic"],
        )

    def _on_message(self, client, userdata, msg):
        topic = msg.topic
        try:
            text = msg.payload.decode("utf-8", errors="replace").strip()
        except Exception:
            return

        if topic == self.cfg["shot_topic"]:
            data = self._parse_json(text)
            if data is not None and self._on_shot:
                try:
                    self._on_shot(data)
                except Exception:
                    log.exception("on_shot handler raised")

        elif topic == self.cfg["context_topic"]:
            data = self._parse_json(text) or {}
            self.context_state = data
            if self._on_context:
                try:
                    self._on_context(data)
                except Exception:
                    log.exception("on_context handler raised")

        elif topic == self.cfg["enable_topic"]:
            on = text.lower() in ("on", "true", "1", "enabled")
            self.enabled_state = on
            if self._on_enable:
                try:
                    self._on_enable(on)
                except Exception:
                    log.exception("on_enable handler raised")

    def _parse_json(self, text: str) -> Optional[Dict[str, Any]]:
        if not text:
            return None
        try:
            data = json.loads(text)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            log.debug("Non-JSON MQTT payload on %s: %.80s", text[:80], text)
        return None

    # ----- HA discovery -----
    def _publish_discovery(self) -> None:
        client = self._client
        if client is None:
            return

        disc = self.cfg.get("discovery_prefix", "homeassistant").rstrip("/")
        prefix = self.cfg.get("result_prefix", "golf/swing/analysis").rstrip("/")
        device_id = self.cfg.get("device_id", "golf_swing_analyzer")
        device_name = self.cfg.get("device_name", "Golf Swing Analyzer")
        availability = self._availability_topic()

        device = {
            "identifiers": [device_id],
            "name": device_name,
            "manufacturer": "Local",
            "model": "OBS + MediaPipe",
        }

        # Switch: enable/disable analyzer
        switch_cfg = {
            "name": "Swing Analyzer",
            "unique_id": f"{device_id}_enabled",
            "command_topic": self.cfg["enable_topic"],
            "state_topic": self.cfg["enable_topic"],
            "payload_on": "on",
            "payload_off": "off",
            "state_on": "on",
            "state_off": "off",
            "retain": True,
            "availability_topic": availability,
            "device": device,
        }
        client.publish(
            f"{disc}/switch/{device_id}/enabled/config",
            json.dumps(switch_cfg),
            retain=True,
        )

        # Sensors derived from latest analysis JSON
        sensors = [
            ("club", "Last Swing Club", None, "{{ value_json.club }}"),
            ("player", "Last Swing Player", None, "{{ value_json.player }}"),
            ("body_summary", "Last Swing Body Summary", None,
             "{{ value_json.body_summary }}"),
            ("faults", "Last Swing Faults", None,
             "{{ value_json.faults_text }}"),
            ("summary", "Last Swing Summary", None,
             "{{ value_json.summary }}"),
            ("priority_fault", "Last Swing Priority Fault", None,
             "{{ value_json.llm_priority_fault | default('', true) }}"),
            ("why_it_matters", "Last Swing Why It Matters", None,
             "{{ value_json.llm_why_it_matters | default('', true) }}"),
            ("evidence", "Last Swing Evidence", None,
             "{{ value_json.llm_evidence | default('', true) }}"),
            ("drill", "Last Swing Drill", None,
             "{{ value_json.llm_drill | default('', true) }}"),
            ("confidence", "Last Swing Confidence", None,
             "{{ value_json.llm_confidence | default('', true) }}"),
            ("llm_status", "Last Swing LLM Status", None,
             "{{ value_json.llm_status | default('', true) }}"),
            ("llm_error", "Last Swing LLM Error", None,
             "{{ value_json.llm_error | default('', true) }}"),
            ("annotated_url", "Last Swing Annotated URL", None,
             "{{ value_json.annotated_url }}"),
            ("raw_url", "Last Swing Raw URL", None,
             "{{ value_json.raw_url }}"),
            ("timestamp", "Last Swing Timestamp", None,
             "{{ value_json.timestamp }}"),
            ("score_summary", "Last Swing Score Summary", None,
             "{{ value_json.score_summary | default('', true) }}"),
            ("posture_delta", "Last Swing Posture Delta", None,
             "{{ value_json.scores.address_vs_impact_posture_delta.score | default('', true) }}"),
            ("hip_depth_retention", "Last Swing Hip Depth Retention", "%",
             "{{ value_json.scores.hip_depth_retention_pct.score | default('', true) }}"),
            ("shoulder_tilt_impact", "Last Swing Shoulder Tilt Impact", "deg",
             "{{ value_json.scores.shoulder_tilt_impact_deg | default('', true) }}"),
            ("transition_score", "Last Swing Transition Score", None,
             "{{ value_json.scores.transition_steepness_score.score | default('', true) }}"),
            ("balance_score", "Last Swing Balance Score", None,
             "{{ value_json.scores.balance_score.score | default('', true) }}"),
            ("top_down_summary", "Last Swing Top-Down Summary", None,
             "{{ value_json.top_down_summary | default('', true) }}"),
            ("impact_approach_angle", "Last Swing Impact Approach", "deg",
             "{{ value_json.top_down.approach_angle_deg | default('', true) }}"),
        ]
        # Home Assistant caps a sensor STATE at 255 characters, which is what
        # was clipping the coach text with "...". For the long coaching fields
        # we also publish the untruncated value as a "full_text" attribute
        # (attributes allow ~16 KB), and the dashboard cards prefer it.
        full_text_sources = {
            "summary": "value_json.summary",
            "priority_fault": "value_json.llm_priority_fault",
            "why_it_matters": "value_json.llm_why_it_matters",
            "evidence": "value_json.llm_evidence",
            "drill": "value_json.llm_drill",
            "confidence": "value_json.llm_confidence",
            "top_down_summary": "value_json.top_down_summary",
        }

        for object_id, friendly, unit, tpl in sensors:
            payload_cfg: Dict[str, Any] = {
                "name": friendly,
                "unique_id": f"{device_id}_{object_id}",
                "state_topic": f"{prefix}/latest",
                "value_template": tpl,
                "availability_topic": availability,
                "device": device,
            }
            if unit:
                payload_cfg["unit_of_measurement"] = unit
            full_src = full_text_sources.get(object_id)
            if full_src:
                payload_cfg["json_attributes_topic"] = f"{prefix}/latest"
                payload_cfg["json_attributes_template"] = (
                    "{{ {'full_text': (" + full_src + " | default('', true))} | tojson }}"
                )
            client.publish(
                f"{disc}/sensor/{device_id}/{object_id}/config",
                json.dumps(payload_cfg),
                retain=True,
            )

    def _publish_state_attributes(self, payload: Dict[str, Any]) -> None:
        # No extra attribute topics needed; latest JSON is the single source.
        pass
