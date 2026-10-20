# F1 Pitwall — live F1 dashboard

React + Vite + TypeScript + Tailwind + Zustand. The track map and the gauges are hand-drawn SVG.

- **Timing tower**: position, team bar, interval or gap (toggle), last lap, S1/S2/S3 coloured purple/green/yellow, and tyre. Retired cars are greyed out and show `OUT`; cars in the pit lane show `PIT`.
- **Team radio**: play/pause and a progress bar for each clip. The **Public / Live** toggle picks the mode: *Public* lists the published clips for you to play on demand; *Live* auto-plays each new clip as it arrives.
- **Track map**: drawn from one lap of location data. DRS zones are red dashes. Driver dots are interpolated so they move smoothly. The latest race-control messages appear along the bottom.
- **Hover card** (hover any driver in the tower, map or positions panel): 0–360 km/h arc speedometer with needle, DRS pill, throttle and brake bars, gear, RPM, tyre compound and age, and gap to the leader.
- **Positions panel**: cycles through Gap → Tyre age → Speed → Last lap → Pit stops. A slider sets the interval (3–20 s, saved between visits), and there is a pause button.
- **Top bar**: session and lap, weather, per-topic feed health dots, the **LIVE / STALE / REPLAY / OFFLINE** badge, the **Live / Replay / Mock** switch, replay transport controls, and fullscreen.
- **Race insights**: arrows in the tower show whether each gap is closing or growing; cars within 1 s of the car ahead are marked as a battle. The hover card adds tyre wear per lap, where the car would rejoin if it pitted now, and when it will catch the car ahead. A ghost dot on the map shows the pit rejoin spot.
- **Events and alerts**: the **Events** tab next to Team radio lists overtakes, pit stops, fastest laps, retirements, flags and penalties as they happen. Optional sound and browser notifications.
- **Analysis view** (`A`): lap-time, gap and position charts, tyre strategy, a strategy table (pace, wear, pit window), a lap-by-lap telemetry compare for two drivers, and the championship as it stands. Click any driver to follow them across the dashboard.
- **Race engineer**: ask Claude about the race in plain English. It sees the timing, gaps, tyres, pit projections and recent events at the current moment, and in replays it won't reveal what happens later.
- **Phone layout**: the header and tower adapt to narrow screens; tap a driver for their card.
- Missing values show `--`. Each panel sits in its own error boundary, so one bad message can't blank the dashboard.

## Quick start (no network needed)

```bash
npm install
npm run dev            # http://localhost:5173 — opens in Mock mode by default
```

Mock mode plays a bundled, deterministic 18-lap race on a synthetic circuit through the same replay engine as OpenF1. It includes pit stops, a retirement, DRS, race control messages and generated radio clips.

## Choosing a data source

The source is chosen at startup, in this order:

1. Query parameter: `?source=live`, `?source=replay` or `?source=mock`
2. The last choice made with the top-bar switch (saved in `localStorage`)
3. Default: `mock`

Other parameters:

| Param | Example | Effect |
| --- | --- | --- |
| `bridge` | `?source=live&bridge=ws://192.168.1.20:8765` | Bridge URL (default `ws://localhost:8765`) |
| `replay` | `?source=replay&replay=library` | Replay backend: `openf1` (default) or `library` |
| `session` | `?source=replay&session=9158` | Race to load first: OpenF1 `session_key`, or round number for the library |

## Live mode (Python bridge)

See [`bridge/README.md`](bridge/README.md) for full details.

```bash
cd bridge && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python bridge.py                     # during a session (needs F1TV for FastF1 live timing)
# no session? python make_sample_feed.py sample_feed.txt && python bridge.py --replay-file sample_feed.txt --loop
```

Then open `http://localhost:5173/?source=live`.

- **LIVE**: connected, and data is flowing.
- **STALE**: connected, but car data or location (or every topic) has been silent for more than 5 s. Each topic's freshness shows as a dot in the top bar (on wide screens): green is fresh, amber is stale, grey means no data yet.
- **OFFLINE**: the bridge is not reachable. The dashboard reconnects with exponential backoff (0.5 s, 1 s, 2 s … up to 30 s, with jitter).

The track outline is built from the first full lap of one car's location trace. Until then, the map frames the cars as they move.

## Replay mode

Click **Replay**, or open `?source=replay`. Then click **Choose race** (or **Change race**) in the top bar to open the race picker. Each race appears as a card showing the circuit outline, round, date, circuit name, location, laps and lap length. You can search by race, circuit or country. **Show winners** reveals each race's winner and podium; it's off by default so results aren't spoiled.

Once a race is loaded, use play/pause, **1× 2× 5× 10×** and the scrub bar. The top bar shows the race name, round, circuit, location and date. The map shows a circuit card (name, location, length, turns, laps), turn numbers and DRS zones.

Replay can read races from two places. Switch between them at the top of the race picker, or with `?replay=library|openf1`:

### Race library (2025 and 2026 seasons, works offline)

Real races from 2025 and 2026 are pre-processed into static files under `public/races/<season>/<race>/`, so they load with no API access. The race picker has a tab for each season.

```bash
pip install numpy pyyaml
python scripts/build_race_library.py                     # every completed race, 2025 and 2026 (~4–5 MB per race)
python scripts/build_race_library.py --season 2026        # one season
python scripts/build_race_library.py --season 2026 qatar  # or just some races (rerun after each new race)
```

- Timing, sectors, tyres, pit stops, race control, weather, team radio and per-lap telemetry (speed, RPM, gear, throttle, brake, DRS and lap distance) come from [TracingInsights](https://github.com/TracingInsights) (`TracingInsights/2025`, `TracingInsights/2026`). That data is produced with FastF1 and is Apache-2.0 licensed.
- Races that haven't been run yet are skipped. Rerun the script after a race weekend to add it; new races usually appear in the source repository within a day or two.
- 2026 cars have no DRS, so 2026 replays show DRS as `--` and draw no DRS zones.
- Circuit names, locations, lap lengths, turn counts, starting grids and the official classification come from [F1DB](https://github.com/f1db/f1db), licensed CC BY 4.0.
- Telemetry is stored at 1 Hz with each car's lap distance. In the browser, cars are placed along the real circuit line, so they follow the corners smoothly between samples.
- Positions and gaps come from each car's distance travelled. The official classification is applied at the chequered flag.
- Ten team-radio clips per race are bundled.

### OpenF1 (2023 onwards, needs internet)

The dashboard reads <https://api.openf1.org/v1> directly, and the picker offers seasons from 2023.

- On load it fetches `/sessions`, `/meetings`, `/drivers`, `/laps`, `/position`, `/intervals`, `/stints`, `/pit`, `/team_radio`, `/race_control` and `/weather`. `car_data` and `location` are fetched in 90-second windows around the playhead.
- The track is drawn from a clean lap. DRS zones are where that car had DRS open.
- Requests are spaced about 400 ms apart and retried on 429/5xx to respect the free rate limit.
- OpenF1 has no retirement flag, so a car that stops lapping well before the finish is shown as `OUT`.

### Static demo build

```bash
VITE_STATIC_SITE=1 VITE_REPLAY_BACKEND=library npx vite build --base=./
```

This build hides Live mode and the OpenF1 option, since a hosted page can't reach the bridge or external APIs. It opens on the race picker. Copy `public/races` alongside the build output.

### GitHub Pages (updates itself after each race)

`.github/workflows/pages.yml` builds any new races into the library on Monday and Tuesday mornings (and on every push to `main`), then publishes the static build to GitHub Pages. To turn it on: **Settings → Pages → Source: GitHub Actions**.

- Pages on a **private** repository needs a paid GitHub plan.
- A Pages site is public. It would serve the bundled timing data and team-radio clips to anyone, so check you're comfortable with that before enabling it.

## Race insights

All insights are computed in the browser from the lap history (`src/insights/`), so they work the same in Live, Replay and Mock.

| Insight | How it's worked out |
| --- | --- |
| Tyre wear | Slope of clean-lap times across the stint, corrected for fuel burn (0.035 s/lap). Laps behind a safety car, in/out laps and outliers are left out. Needs 5 clean laps. A "cliff" is flagged when the last laps are well off the stint's trend. |
| Pit rejoin | The car's gap to the leader plus the pit loss, placed among the other cars. Pit loss is measured from this race's stops when there are enough of them, otherwise 22 s. Flags traffic (rejoining within 1.5 s of a car) and pressure (a car within 1 s behind). |
| Gap trends | Change in the gap to the car ahead over the last few laps, and how many laps until it's closed (capped at 20). |
| Championship | Points before the race (Jolpica) plus points for the current top 10. |

## Race engineer (Claude)

Open **Analysis** and scroll to **Race engineer**. Pick a quick question or type your own.

- Running locally, paste an Anthropic API key. It's stored only in this browser (if you tick *Remember*) and is sent only to the Anthropic API. Each question is billed to that key: one request carrying a summary of the race so far, so later in the race costs a little more.
- On the page published through Claude, it uses the viewer's own Claude account instead, and no key is needed.
- Model: `claude-opus-5-5`, streamed, with server-side fallback enabled so a busy model doesn't fail the question.

## Following a race live

The dashboard can't call F1's feed directly from the browser, so a small Python bridge sits in between. Options for the data, from free to paid:

| Source | Cost | Notes |
| --- | --- | --- |
| F1 live timing via FastF1 (`--source fastf1`, default) | F1TV subscription | The same feed the official app uses: timing, positions, car data, radio. `--no-auth` may give partial data with no subscription. |
| OpenF1 real-time (`--source openf1`) | Paid OpenF1 account | Polled every 3 s. OpenF1 says location, car data and intervals may be missing in real time. Historical data stays free. |
| Jolpica (Ergast successor) | Free | Results and standings only, after the race. Used here for the championship. |

There is no free, official, complete live API. FastF1 with F1TV is the most complete option.

### Running the bridge on a server

To watch from a phone or share with friends, run the bridge on a small server (any VPS) and put it behind HTTPS:

```bash
BRIDGE_TOKEN=pick-a-long-secret python bridge.py --host 127.0.0.1 --port 8765
```

Put a reverse proxy (Caddy or nginx) in front of it for `wss://`; a page served over HTTPS can't connect to a plain `ws://` address. Then open the dashboard with `?source=live&bridge=wss://your.server/ws?token=pick-a-long-secret`.

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | Pause / resume the positions-panel cycle |
| `1`–`5` | Gap, tyre age, speed, last lap, pit stops |
| `F` | Toggle fullscreen |
| `M` | Enlarge the track map over the radio and positions panels (or use **Expand** on the map) |
| `A` | Switch between Dashboard and Analysis |
| `Esc` | Stop following the selected driver |

## Architecture

```
src/
  data/                     ← every provider lives here
    types.ts                F1DataSource interface, snapshot and UI-facing types
    records.ts              OpenF1-shaped wire records + parsing helpers
    index.ts                createDataSource(), initialSourceKind() — the only factory
    context.tsx             DataSourceProvider / useDataSource (components get the interface, never a class)
    LiveBridgeSource.ts     WebSocket client, per-topic staleness, backoff reconnect
    liveState.ts            merges bridge messages into one store keyed by driver number
    OpenF1ReplaySource.ts   session list/loader, chunked telemetry
    LibraryReplaySource.ts  bundled 2025 races (public/races), maps lap distance onto the circuit
    config.ts               which modes/backends a build offers
    openf1Api.ts            rate-limited fetch queue
    MockSource.ts           offline source
    mock/mockData.ts        mock race generator (drivers, circuit, laps, telemetry, radio…)
    replayRuntime.ts        playback clock (speed, pause, seek) shared by replay + mock
    timeline.ts             race state at any instant (positions, sectors, tyres, retirements…)
    interpolate.ts track.ts sectors.ts
  state/store.ts            Zustand: snapshot + status + UI state (hover, stat view, cycle)
  components/
    layout/   TopBar, StatusBadge, ModeSwitch, ReplayControls
    timing/   TimingTower
    radio/    RadioFeed
    track/    TrackMap, RaceControlTicker
    hover/    DriverHoverCard, Speedometer
    positions/PositionPanel
    races/    RacePicker
    common/   Panel, TyreIcon, ErrorBoundary
  hooks/useKeyboard.ts
bridge/                     Python FastF1 → WebSocket bridge (see bridge/README.md)
scripts/build_race_library.py   builds public/races from TracingInsights + F1DB
```

```ts
interface F1DataSource {
  subscribe(listener: (s: F1Snapshot) => void): () => void;
  getSnapshot(): F1Snapshot;   // drivers (position, laps, intervals, sectors, tyres), car data,
                               // locations, radio, race control, weather, track, playback
  status(): "LIVE" | "STALE" | "REPLAY" | "OFFLINE";
  mode(): "live" | "replay";
  start(): void;
  stop(): void;
  readonly replay?: ReplayControls;   // play/pause/setSpeed/seek/listSessions/loadSession
}
```

`App.tsx` creates the source through `createDataSource(kind)` and pushes each snapshot into the Zustand store. Components read the store with selectors. They import types from `data/types` and the context hook from `data/context`, never a provider module. High-frequency fields (`locations`, `car`) are kept separate from the slower timing data, so the timing tower doesn't re-render on every animation frame.

CI (`.github/workflows/ci.yml`) runs the tests, the type check, the build and the bridge tests on every push and pull request.

## Scripts

```bash
npm run dev        # dev server
npm run build      # type-check + production build to dist/
npm run preview    # serve the build
npm test           # insight engine tests (vitest)
cd bridge && python -m unittest test_translator.py test_openf1_live.py
```
