# Golf Swing Analyzer

Local-only golf swing analysis pipeline that ties together:

- **OpenLaunch Nova** for club/ball metrics (already in Home Assistant via HACS)
- **OBS replay buffer** for swing video
- **MediaPipe Pose** for body tracking
- **OpenCV** for an annotated video overlay
- **Deterministic swing scores** for posture, hip-depth retention, transition, and balance trends
- **Optional local LLM** (Ollama / Trinity) for a coaching summary
- **Home Assistant** for triggering and displaying everything

> The analyzer **never tries to track the clubface from video**. Nova is the source of truth for club/ball numbers; the camera is only for body mechanics.

---

## How it flows

```
Nova -> OBS Open Golf Coach plugin -> MQTT golf/shot/raw
                                      │
                                      ├─> Range Matrix HACS integration
                                      │      logs canonical shot data
                                      │
                                      └─> Golf Swing Analyzer service
                                             subscribes to enable + context
                                             tells OBS to save replay buffer
                                             runs MediaPipe pose + faults
                                             renders annotated 0.5x MP4
                                             serves MP4s on port 8765
                                             publishes MQTT discovery + analysis
```

The analyzer does not write to Range Matrix SQLite. Range Matrix remains the canonical shot store; this service only contributes swing-analysis sensors and video URLs through MQTT discovery.

---

## What Runs Where

Use this split when debugging or explaining the install:

- **Home Assistant** runs MQTT/Mosquitto, the `Golf Range Matrix` HACS integration, the Range Matrix dashboard, and MQTT discovery entities for the analyzer.
- **Sim PC** runs OBS, the Open Golf Coach OBS script, OBS Replay Buffer, OBS WebSocket, and this Python Swing Analyzer service.
- **MQTT is the event bus.** OBS publishes each Nova shot to `golf/shot/raw`; Range Matrix and the Swing Analyzer both subscribe to that same event. Range Matrix publishes retained context to `golf/context/current`, and the analyzer subscribes to that context.
- **TCP/HTTP is only for video playback.** The analyzer runs a tiny Flask server on TCP `8765` so Home Assistant dashboards can fetch annotated MP4s from URLs like `http://192.168.68.150:8765/videos/annotated/<file>.mp4`.
- **SIM Control Agent is optional recovery tooling.** `tools/sim-control-agent/` can expose Home Assistant buttons to restart OBS, start/save Replay Buffer, and optionally restart this analyzer if the OBS script stops publishing after launching GSPro.

That means a shot can be logged successfully through MQTT while the dashboard video still fails if Windows Firewall blocks TCP `8765` or `server.public_base_url` points at the wrong sim PC IP.

---

## One-time setup on the Windows sim PC

### 1. Python

Install Python 3.11 or 3.12 (MediaPipe doesn't support 3.13 yet).

```powershell
cd C:\golf-range-matrix\tools\swing-analyzer
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

This installs the analysis/runtime stack:

- `mediapipe` for pose landmarks.
- `opencv-python` and `numpy` for video/frame processing.
- `imageio-ffmpeg` for browser-playable H.264 MP4 output.
- `watchdog` to detect new OBS replay files.
- `flask` to serve annotated/raw clips over TCP `8765`.
- `paho-mqtt` for shot/context/enable topics and HA discovery.
- `obsws-python` to call OBS WebSocket `SaveReplayBuffer`.

The MediaPipe pose model downloads into `models/` on first run. That folder is local cache and should not be committed.

### 2. OBS replay buffer

In OBS Studio:

1. `Settings` > `Output` > switch `Output Mode` to `Advanced`.
2. Find the `Replay Buffer` tab.
3. Enable `Enable Replay Buffer`.
4. Set `Maximum Replay Time` to `30s` (or whatever you want; `8-10s` is plenty and keeps clips snappy).
5. Set the recording path to `C:\golf_swings\raw\`.
6. `Settings` > `Hotkeys` > set a hotkey for `Save Replay` (so you can also save manually).
7. Click the `Start Replay Buffer` button in the Controls dock.

The shot fires at impact, so the analyzer waits `obs.replay_delay_seconds` (default `1.8`) after the shot before flushing the buffer. That delay is what captures the follow-through and finish in the saved clip — without it the clip ends at impact and looks like only a 1-2 second video. Increase it for a longer finish, but keep `Maximum Replay Time` comfortably larger than the delay plus your backswing.

### 3. OBS WebSocket

`Tools` > `WebSocket Server Settings`:

- Enable WebSocket Server.
- Note the `Server Port` (default `4455` in OBS 32).
- If you set a password, copy it.
- Update `obs.port` and `obs.password` in `config.yaml`.

### 4. Open Golf Coach OBS Script

The OBS Open Golf Coach script is the TCP/client side of the Nova connection and the MQTT producer for Range Matrix/Swing Analyzer:

```text
Nova/OpenLaunch -> OBS Open Golf Coach script -> MQTT golf/shot/raw
```

In OBS, open the Open Golf Coach script properties and configure the MQTT section:

- Enable `Publish Shots to MQTT (Range Matrix / Swing Analyzer)`.
- `MQTT Broker Host`: your Home Assistant/Mosquitto host or IP.
- `MQTT Broker Port`: usually `1883`.
- `MQTT Username`: the Home Assistant user account used for MQTT, for example `mqtt_swing`.
- `MQTT Password`: that user's password.
- `MQTT Topic`: `golf/shot/raw`.

The OBS script uses `paho-mqtt`. If OBS's embedded Open Golf Coach Python environment does not have it, install it into the OBS script package path:

```powershell
py -3.12 -m pip install --target "$env:APPDATA\obs-studio\ogc-python\Lib\site-packages" paho-mqtt
```

The OBS script still publishes the existing Home Assistant REST sensors if you use them. MQTT publishing is additive and is what lets Range Matrix and Swing Analyzer both consume the same shot.

### 5. Configure the analyzer

Copy `config.example.yaml` to `config.yaml`, then edit it:

- `mqtt.host`, `mqtt.username`, and `mqtt.password` — use the Mosquitto broker and the `mqtt_swing` Home Assistant user account.
- `mqtt.shot_topic` — defaults to `golf/shot/raw`, the same topic Range Matrix consumes.
- `mqtt.context_topic` — defaults to `golf/context/current`, where Range Matrix publishes the selected player/club/session.
- `mqtt.enable_topic` — defaults to `golf/swing/analyzer/enabled`, controlled by the MQTT discovery switch.
- `server.public_base_url` — set this to the sim PC URL, e.g. `http://192.168.68.150:8765`.
- `obs.port` and `obs.password` — match OBS WebSocket settings.
- `camera.angle` — `down_the_line` or `face_on`.
- `annotation.side_by_side` — when `true` (default) the annotated MP4 is rendered as `RAW | ANALYZED` side by side so the HA Last Swing card plays both views in one player. Set to `false` for analyzed-only.
- `annotation.overlays.*` — turn individual advanced overlays off if the video gets visually cluttered.
- `llm.enabled` — `true` if you have Ollama / Trinity running locally.

If the dashboard browser is not on the sim PC, allow inbound TCP `8765` through Windows Firewall. Home Assistant and kiosk clients fetch annotated MP4s directly from `server.public_base_url`.

### 6. Run the analyzer

```powershell
cd C:\golf-range-matrix\tools\swing-analyzer
.\.venv\Scripts\Activate.ps1
.\start-agent.ps1
```

You should see:

```
HTTP server on http://0.0.0.0:8765
Watching: C:\golf_swings\raw
Connected to OBS at 127.0.0.1:4455
MQTT subscribed to shot=golf/shot/raw context=golf/context/current enable=golf/swing/analyzer/enabled
```

To start the analyzer automatically at Windows logon:

```powershell
cd C:\golf-range-matrix\tools\swing-analyzer
.\install-startup-task.ps1
```

That creates a Windows Scheduled Task named `Golf Swing Analyzer`. The scheduled task runs `.venv\Scripts\pythonw.exe`, so it runs in the background without a console window. To remove it:

```powershell
.\uninstall-startup-task.ps1
```

### 7. Home Assistant side

When the service starts, MQTT discovery creates a `Golf Swing Analyzer` device. Home Assistant commonly prefixes entity IDs with the device name, so the default entities are:

- `switch.golf_swing_analyzer_swing_analyzer`
- `sensor.golf_swing_analyzer_last_swing_club`
- `sensor.golf_swing_analyzer_last_swing_player`
- `sensor.golf_swing_analyzer_last_swing_body_summary`
- `sensor.golf_swing_analyzer_last_swing_faults`
- `sensor.golf_swing_analyzer_last_swing_summary`
- `sensor.golf_swing_analyzer_last_swing_annotated_url`
- `sensor.golf_swing_analyzer_last_swing_raw_url`
- `sensor.golf_swing_analyzer_last_swing_timestamp`
- `sensor.golf_swing_analyzer_last_swing_score_summary`
- `sensor.golf_swing_analyzer_last_swing_posture_delta`
- `sensor.golf_swing_analyzer_last_swing_hip_depth_retention`
- `sensor.golf_swing_analyzer_last_swing_shoulder_tilt_impact`
- `sensor.golf_swing_analyzer_last_swing_transition_score`
- `sensor.golf_swing_analyzer_last_swing_balance_score`

Add the `ha_dashboard_swing.yaml` view to the Range Matrix dashboard, or use the bundled dashboard template in the integration. The bundled `/golf_range_matrix/golf-range-matrix-cards.js` resource includes `custom:range-swing-video-card`, which loops the latest annotated MP4 and includes a compact analyzer on/off control.

Range Matrix also publishes retained context to `golf/context/current` whenever the selected player, club, recording state, or workflow changes. The analyzer applies that context before saving shot JSON, so the annotated overlay and MQTT sensors use the club selected in the dashboard.

### 8. (Optional) Archive annotated clips into Home Assistant

The Flask server on TCP `8765` only works on the home network. To make the Last Swing card load over Nabu Casa as well, copy each new annotated MP4 into a folder Home Assistant serves, and publish a Home Assistant URL for it.

One-time setup on Home Assistant OS:

1. Settings -> Add-ons -> Add-on Store -> install and start `Samba share`.
2. Set a username and password and start it.
3. From the sim PC, confirm `\\homeassistant\config` and `\\homeassistant\media` are reachable in Explorer.
4. Create the destination folders once:
   - `\\homeassistant\config\www\golf_replays`
   - `\\homeassistant\media\golf_replays`

In `config.yaml`:

```yaml
archive:
  enabled: true
  keep_last: 5
  filename_template: "swing_{timestamp}_{original}"
  destinations:
    # Served at /local/golf_replays/<file>. The custom card uses this URL.
    - path: '\\homeassistant\config\www\golf_replays'
      public_url_prefix: "/local/golf_replays"
    # Browsable in HA Media Browser; also reachable via Nabu Casa.
    - path: '\\homeassistant\media\golf_replays'
```

After each successful annotation, the analyzer copies the rendered MP4 into every destination, prunes each folder to `keep_last`, and (when a destination defines `public_url_prefix`) publishes `annotated_url` as that public URL instead of the local Flask URL. The `/local/...` URL is served by HA itself, so the dashboard works on the LAN and through Nabu Casa with no auth tokens or media-source plumbing.

The copy lands as `*.part` first and is then renamed, so HA's Media Browser never sees a half-written clip.

If the agent runs as a Windows scheduled task, mapped drives may not be visible in some sessions; UNC paths above are recommended. If you must persist credentials for the task user, run once as that user:

```powershell
cmdkey /add:homeassistant /user:<samba-user> /pass:<samba-password>
```

---

## End-to-end Setup Checklist

1. Home Assistant: install Mosquitto/MQTT and create an MQTT-capable HA user such as `mqtt_swing`.
2. Home Assistant: install `Golf Range Matrix` through HACS, add the integration from Settings > Devices & services, and register `/golf_range_matrix/golf-range-matrix-cards.js` as a Lovelace module resource.
3. Home Assistant: open the bundled dashboard template or add `custom:range-swing-video-card` to your existing Range Matrix dashboard.
4. OBS: configure Open Golf Coach to publish MQTT shots to `golf/shot/raw`.
5. OBS: enable and start Replay Buffer, set raw recording path to the analyzer `paths.raw_video_dir`, and enable OBS WebSocket.
6. Sim PC: create the Python venv, install `requirements.txt`, copy `config.example.yaml` to `config.yaml`, and fill in MQTT, OBS, server, and camera settings.
7. Sim PC: allow inbound TCP `8765` in Windows Firewall.
8. Sim PC: run `.\start-agent.ps1` or install `.\install-startup-task.ps1` and confirm the MQTT subscription log line.
9. Home Assistant: turn on the Swing Analyzer switch.
10. Hit a shot. Within about 30 seconds the latest swing sensors should update and the dashboard video should loop the annotated MP4.

---

## Quick test (no Nova required)

1. Start OBS and click `Start Replay Buffer`.
2. Start the analyzer (`python run.py`).
3. In Home Assistant, turn `switch.golf_swing_analyzer_swing_analyzer` on.
4. Hit one shot so the OBS plugin publishes `golf/shot/raw`.
5. Within about 30 seconds, `sensor.golf_swing_analyzer_last_swing_annotated_url` should populate and the dashboard video should auto-play.

---

## LLM Coaching

The deterministic heuristics extract pose metrics, advanced overlay traces, swing scores, obvious faults, and a short score summary. For richer feedback, enable `llm.enabled` and point `llm.endpoint` at a local model server such as Ollama:

```yaml
llm:
  enabled: true
  endpoint: "http://localhost:11434/api/generate"
  model: "trinity"
  timeout_seconds: 60
  send_video_frames: true
  max_visual_frames: 8
```

The LLM receives the structured analysis JSON: club, camera angle, NOVA metrics, body metrics, advanced traces, deterministic scores, detected faults, and the score summary. When `send_video_frames` is enabled, the analyzer also samples frames from the raw and annotated videos and sends them through Ollama's `images` field. Use a vision-capable local model for that mode.

The prompt tells the model to use raw golfer motion as primary evidence and treat marker overlays as approximate because pose markers can be wrong for a few frames. It is asked to return:

```json
{
  "priority_fault": "...",
  "why_it_matters": "...",
  "evidence": ["...", "..."],
  "drill": "...",
  "confidence": "low|medium|high"
}
```

Keep the deterministic heuristics as the source of truth for extracted measurements. Use the LLM to explain patterns, rank likely issues, and suggest drills rather than to invent measurements from the video.

If Trinity/Ollama is unreachable or the model rejects image input, the dashboard still shows a Local LLM Breakdown box under the swing video with the deterministic fallback and the latest LLM status/error. Check `sensor.golf_swing_analyzer_last_swing_llm_status` and `sensor.golf_swing_analyzer_last_swing_llm_error` when the coaching text is missing.

## Side-by-side Raw + Analyzed View

By default the annotated MP4 is rendered as a `RAW | ANALYZED` composite (raw video on the left, AI overlays on the right). The HA "Last Swing" card and any other consumer of `annotated_url` just plays the one MP4 and you see both views in the same player without changing the dashboard. Disable with `annotation.side_by_side: false` if you only want the analyzed panel.

## Advanced Overlays And Scores

The annotated MP4 can draw a second analysis layer:

- Pelvis depth reference line and address-to-impact hip-center movement.
- Address and impact spine inclination lines.
- Address-centered head movement box.
- Shoulder plane trace through address, top, and impact.
- Hand path trace through the swing.
- Compact HUD with the score summary.

The `scores` object in each analysis JSON includes posture delta, hip-depth retention percentage, impact shoulder tilt, transition steepness score, and balance score. These are conservative trend metrics until you validate them against more swings.

## Camera Calibration And FPS Notes

Higher FPS should improve phase detection because impact, transition, and early extension happen quickly. After upgrading the camera:

- Keep the camera fixed, level, and square to the target line. Re-aiming the camera changes the baseline for hip-depth and balance trends.
- For down-the-line video, place the camera on the hand-line/target-line view you intend to keep using, then compare future swings from that same setup.
- Keep OBS recording the camera at its real frame rate and verify the saved MP4 reports that FPS correctly.
- Set `camera.fps_sample_rate: 1` if the sim PC can handle analyzing every frame. Use `2` or higher if MediaPipe CPU/GPU load is too high.
- Keep shutter speed and lighting high enough to reduce motion blur; higher FPS alone will not help if the body landmarks smear.
- Recheck `annotation.slow_motion_factor`; 0.5x is good for review, but very high FPS clips may look better at 0.4x or 0.25x.
- Treat hip depth and balance scores as camera-specific trend metrics, not absolute 3D measurements.

## Validation

After updating the sim PC, restart the analyzer service so it loads the new Python files. Then:

1. Analyze 3-5 known swings from the current camera.
2. Confirm the head box, pelvis line, spine lines, shoulder trace, and hand path line up with the body.
3. Confirm the annotated MP4 still plays and loops in Home Assistant.
4. Confirm the selected Range Matrix club appears in the overlay HUD.
5. Confirm the new MQTT score sensors appear under the `Golf Swing Analyzer` device.
6. Re-test after installing the higher-FPS camera, especially phase timing and hand path smoothness.

---

## Files

```
golf_swing_analyzer/
├── run.py                 # entry point
├── config.yaml            # all configuration
├── requirements.txt
├── ha_dashboard_swing.yaml # Lovelace view snippet
├── README.md
└── golf_swing_analyzer/
    ├── analyzer.py        # main service: MQTT + watchdog + worker
    ├── config.py          # config loader with defaults
    ├── mqtt_bridge.py     # MQTT subscriptions, discovery, and analysis publish
    ├── obs_client.py      # OBS WebSocket SaveReplayBuffer
    ├── pose.py            # MediaPipe pose extraction
    ├── metrics.py         # body metrics + phase detection + faults
    ├── annotate.py        # OpenCV annotated video overlay
    └── llm.py             # optional Ollama/Trinity summary
```

---

## Limits / philosophy

- This is **MVP**. Phase detection is heuristic, not perfect.
- Numbers are **suggestions**, not coach-grade truth.
- Down-the-line camera is the recommended starting angle.
- Face-on camera works but some metrics (early extension, hip sway) are tuned for DTL.
- Everything runs locally. No cloud calls unless you point `llm.endpoint` at one.

