# F1 live timing bridge

A small Python process that receives the official F1 live timing feed through
[FastF1](https://docs.fastf1.dev)'s live timing client and forwards it to the
dashboard over a local WebSocket (`ws://localhost:8765`).

```
F1 SignalR feed ──► FastF1 SignalRClient ──► translator.py ──► ws://localhost:8765 ──► dashboard
                     (subclassed, bridge.py)   (OpenF1-shaped records)
```

Each WebSocket message is one JSON object:

```json
{"topic": "car_data", "data": {"driver_number": 44, "date": "2025-07-06T14:03:12.215Z", "speed": 301, "rpm": 11020, "n_gear": 7, "throttle": 100, "brake": 0, "drs": 12}}
```

## Requirements

- Python 3.10+
- `fastf1` 3.8.x (tested against 3.8.3) and `websockets` 13+ (tested against 17)
- For live sessions: an **F1TV Access, Pro or Premium** subscription. FastF1 3.8 authenticates the live timing connection with your F1TV account.

## Install

```bash
cd bridge
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Run during a session

1. Start the bridge a few minutes before the session (or at any point during it):

   ```bash
   python bridge.py --record race.txt
   ```

   - The first time, FastF1 prints a link like `https://f1login.fastf1.dev?port=…`. Open it, sign in with your F1TV account, and the token is saved for later runs.
   - `--record race.txt` is optional. It appends the raw feed to a file so you can replay it later with `--replay-file`.
   - `--no-auth` tries to connect without F1TV. Depending on the session this can give partial data or none.

2. Start the dashboard with `?source=live`, or click **Live** in the top bar. The badge reads **LIVE** while data is flowing. It changes to **STALE** when car data or positions stop arriving for 5 seconds, and to **OFFLINE** when the bridge is unreachable. The dashboard reconnects automatically with exponential backoff.

When a browser connects mid-session, the bridge first sends the latest known state (drivers, timing, tyres, weather, recent radio and race control), then streams updates.

## Stop

Press **Ctrl+C** in the bridge terminal, or send it `SIGTERM`. This closes the F1 connection and the WebSocket server. The dashboard switches to OFFLINE and keeps trying to reconnect until you start the bridge again.

## Try it without a live session

```bash
python make_sample_feed.py sample_feed.txt          # small synthetic feed (6 cars, 4 laps)
python bridge.py --replay-file sample_feed.txt --speed 4 --loop
```

`--replay-file` also accepts any file written with `--record`, or with FastF1's own `python -m fastf1.livetiming save <file>`. Use `--speed N` to change the replay speed.

## Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Interface to bind |
| `--port` | `8765` | WebSocket port |
| `--record FILE` | – | Also append the raw feed to `FILE` |
| `--no-auth` | off | Connect without F1TV authentication |
| `--timeout N` | `0` | Stop the feed client after N s without data (0 = never) |
| `--replay-file FILE` | – | Replay a recorded raw feed instead of connecting live |
| `--speed X` / `--loop` | `1` / off | Replay speed / restart the replay when it ends |
| `-v` | off | Debug logging |

## Topics

| Bridge topic | Source feed topic | Notes |
| --- | --- | --- |
| `position` | `TimingData` | Race position |
| `intervals` | `TimingData` | `gap_to_leader` / `interval` in seconds, or `"+1 LAP"` |
| `laps` | `TimingData` | Lap count, last lap, sector times, `sector_flags` (purple/green/yellow from the feed) |
| `driver_status` | `TimingData` | `retired`, `in_pit`, `pit_stops` |
| `car_data` | `CarData.z` | Speed, RPM, gear, throttle, brake (0–100), DRS |
| `location` | `Position.z` | X/Y/Z, every sample, so the map can interpolate |
| `team_radio` | `TeamRadio` | Absolute clip URL on `livetiming.formula1.com/static` |
| `race_control` | `RaceControlMessages` | |
| `weather` | `WeatherData` | |
| `drivers`, `stints`, `session`, `lap_count`, `heartbeat` | `DriverList`, `TimingAppData`, `SessionInfo`, `LapCount`, `Heartbeat` | |

## How it uses FastF1

The API was checked against the installed package (FastF1 3.8.3), not assumed:

- `fastf1.livetiming.client.SignalRClient(filename, filemode='w', debug=False, timeout=60, logger=None, no_auth=False)` connects to `wss://livetiming.formula1.com/signalrcore`, subscribes to the topics, and passes every message to `self._on_message(msg)`.
- `msg` is either a `signalrcore` `CompletionMessage`, whose `.result` is the full initial state as a dict keyed by topic, or a `list` `[topic, data, timestamp]` for each later update.
- `.start()` blocks, so the bridge runs it in a daemon thread. The `BridgeClient` subclass overrides `_on_message`: it calls the original method, which writes the raw feed to `filename` (`os.devnull` unless you pass `--record`), and then hands the message to the asyncio loop with `call_soon_threadsafe`.
- `.z` topics are base64-encoded raw-deflate JSON. `translator.decode_z` decodes them the same way `fastf1._api.parse(..., zipped=True)` does.

`_on_message` is an internal FastF1 method. If a future FastF1 release changes it, pin `fastf1==3.8.3`.

## Tests

```bash
python -m unittest test_translator.py
```
