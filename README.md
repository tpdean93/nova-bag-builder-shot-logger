# Golf Range Matrix

![Golf Range Matrix logo](assets/golf-range-matrix-logo.png)

HACS-installable Home Assistant integration and companion tools for bag mapping, wedge matrix, and virtual driving-range workflows.

This repo contains:

- `custom_components/golf_range_matrix/`: the HACS custom integration with SQLite storage, native entities, services, bundled cards, dashboard templates, and optional InfluxDB export.
- `custom-cards/`: Lovelace cards for shot tracing, metric panels, history, session controls, bag building, and wedge matrix.
- `scripts/nova_shot_logger.py`: legacy local MQTT-to-SQLite shot logger for per-player/per-club shot history.
- `tools/swing-analyzer/`: local Swing Analyzer service for MQTT-driven OBS replay capture, MediaPipe pose analysis, annotated MP4 output, and Home Assistant MQTT discovery.
- `tools/sim-control-agent/`: local SIM PC control agent for Home Assistant buttons that restart OBS, start/save Replay Buffer, and optionally restart the Swing Analyzer.
- `docs/hacs-integration.md`: install, migration, backup, and release notes for the integration.
- `docs/mqtt-contract.md`: MQTT topics and payloads for the HA dashboard and lab PC bridge.
- `docs/home-assistant.md`: helper/card setup notes.
- `docs/dashboard-package.md`: dashboard layout and entity assumptions.

## HACS Integration

The recommended product path is now `Golf Range Matrix` as a Home Assistant custom integration:

[![Open your Home Assistant instance and open this repository inside HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=tpdean93&repository=Golf-Range-Matrix&category=integration)

1. Add this repo to HACS as a custom integration repository.
2. Install `Golf Range Matrix`.
3. Restart Home Assistant.
4. Add `Golf Range Matrix` from Settings > Devices & services.
5. Add `/golf_range_matrix/golf-range-matrix-cards.js` as a Lovelace module resource or use the bundled dashboard template at `/golf_range_matrix/dashboards/golf-range-matrix-dashboard.json`.

The integration stores app data in `golf_range_matrix.sqlite3` under the Home Assistant config directory. Profiles, bags, club metadata, wedge matrices, shots, and summaries are no longer stored in mutable chunked `input_text` helpers.

## Range Matrix Shot Lab Card

`custom:range-shot-tracer-card` is the headline card. The live shot tracer renders the carry/total/offline of the last shot on a perspective driving range with mowing stripes, a horizon, scenery, and an animated ball flight.

- **Wedge target trainer**: toggle a target green at a settable distance and landing radius (with quick preset buttons for 50/75/100/125/150/175 yd). The card draws the green and pin, shows a live **HIT / MISS** badge for the current shot, and keeps a running hits/attempts tally with a landing percentage. Settings and the score persist in the browser, and there's a Reset.
- **Quick club select**: a compact strip of the clubs in the active bag (driven by `select.golf_range_matrix_range_matrix_active_club`). Tap a club to set which club the next logged shot used; the active club is highlighted and the last-shot time is shown.
- **Responsive**: scales cleanly from an ultrawide monitor to a TV/kiosk.

## Local Swing Analyzer

The optional local Swing Analyzer service lives in `tools/swing-analyzer/`. It subscribes to the same `golf/shot/raw` MQTT events as Range Matrix, saves OBS replay-buffer clips, runs MediaPipe pose analysis, serves annotated slow-motion MP4s, and publishes Home Assistant MQTT discovery for the `Golf Swing Analyzer` device.

Range Matrix publishes retained selected-player/selected-club context to `golf/context/current`, so the analyzer labels swings with the dashboard-selected club instead of any stale club value coming from the OBS shot payload. The bundled card resource also includes `custom:range-swing-video-card`, a compact looping video card with an on/off control for the analyzer MQTT switch.

The swing video card includes a **manual markup** toolset for drawing on the analyzed swing. Click **Draw** to enable it, then use:

- **Line + angle** — draws a line and labels its tilt from vertical in degrees (spine angle, shaft lean, shoulder tilt).
- **Plumb line** (full-height vertical) — head sway / hang-back reference.
- **Level line** (full-width horizontal) — shoulder / hip level reference.
- **Box** and **Oval** — head box or impact-zone callouts.
- **Freehand** pen, plus color swatches, four line thicknesses, undo, clear, and save-to-PNG.

Markup uses the **Fullscreen** button to expand the video (and toolbar) while keeping drawings aligned, and switching tools/colors no longer drops you out of fullscreen.

**Clip length / follow-through:** the analyzer flushes the OBS replay buffer a short delay after the shot (`obs.replay_delay_seconds`, default 1.8s) so the saved clip includes the follow-through and finish rather than cutting off at impact. Set OBS *Maximum Replay Time* to ~8-10s so the buffer still holds the address and backswing.

See `tools/swing-analyzer/README.md` for install steps, OBS replay-buffer setup, the `mqtt_swing` user, paho-mqtt installation into OBS, firewall notes for the analyzer HTTP server, LLM coaching options, and camera/FPS guidance. OBS Replay Buffer must be started in OBS before `SaveReplayBuffer` can produce source MP4s. Annotated videos default to 0.5x speed via `annotation.slow_motion_factor` in the analyzer config.

At a high level, the working setup is:

1. Install `Golf Range Matrix` in Home Assistant through HACS and add `/golf_range_matrix/golf-range-matrix-cards.js` as a Lovelace module resource.
2. Configure the OBS Open Golf Coach script on the sim PC to publish shots to MQTT topic `golf/shot/raw`.
3. Install the Swing Analyzer Python service on the sim PC from `tools/swing-analyzer/`; its `requirements.txt` installs MediaPipe, OpenCV, Flask, paho-mqtt, OBS WebSocket support, and ffmpeg helpers.
4. Configure OBS Replay Buffer and OBS WebSocket. OBS must have Replay Buffer started so `SaveReplayBuffer` can write MP4s.
5. Let Range Matrix publish selected player/club context to `golf/context/current`; the analyzer uses that retained context so the overlay matches the dashboard-selected club.
6. Open TCP `8765` on the sim PC firewall. Home Assistant and dashboard browsers fetch annotated MP4s from the analyzer HTTP server at `http://<sim-pc-ip>:8765/videos/...`.

## SIM Control Agent

The optional SIM Control Agent lives in `tools/sim-control-agent/`. It runs on the sim PC and publishes Home Assistant MQTT discovery for recovery buttons such as Restart OBS Bridge, Select Swing Analyzer Scene, Start Replay Buffer, Save Replay Buffer, and Restart Swing Analyzer.

Use it when OBS or the Open Golf Coach script stops pushing shots after launching GSPro or changing simulator state. The agent listens on fixed MQTT commands only; it does not run arbitrary shell payloads from Home Assistant. See `tools/sim-control-agent/README.md` for setup.

## Run The Logger

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python scripts\nova_shot_logger.py --host homeassistant.local
```

Set `MQTT_USERNAME` and `MQTT_PASSWORD` in `.env` if your broker requires authentication.

The standalone logger keeps its original filename and `NOVA_*` environment variables for compatibility. The HACS integration is the recommended Golf Range Matrix path for new installs.

## Data Flow

1. Home Assistant publishes retained context to `golf/context/current`.
2. The lab PC / OBS bridge publishes each shot to `golf/shot/raw`.
3. The logger combines both payloads and writes SQLite records.
4. The logger publishes retained summaries to `golf/summary/...` and AI-ready exports to `golf/export/...`.
5. Home Assistant can display those summaries on the Golf Range Matrix dashboard.

By default, only shots with `recording: true` in the HA context are stored. Set `NOVA_STORE_UNRECORDED=true` to keep every shot.

## Analytics / AI Export

The logger publishes richer per-club analytics after every recorded or discarded shot:

- `golf/summary/<player>/<club>`: club averages, confidence windows, tendencies, and playable yardage.
- `golf/summary/<player>/bag`: all club summaries for the player.
- `golf/export/<player>/ai`: AI-ready bag profile using schema `nova-golf-ai-export/v1`.

The logger also publishes Home Assistant MQTT discovery for bag summaries, allowing the dashboard Results tab to read entities such as `sensor.golf_summary_tyler_bag`.

Discarded shots are excluded from all analytics.

## Short Game / Wedge Matrix

The wedge matrix card lets each player keep a short-game carry chart by wedge and swing type. It only shows wedges that are saved in that player's bag, so the short-game chart stays tied to the bag setup.

The default swings are:

- `Half`
- `Waist`
- `Shoulder`
- `Full`

Each cell can store a number or a range, such as `74/80`, matching the kind of wedge card you showed.

The card can also capture 5 live carry readings for a selected wedge/swing cell and fill the cell with the average. This is driven from the HA dashboard and uses `sensor.golf_carry`.
