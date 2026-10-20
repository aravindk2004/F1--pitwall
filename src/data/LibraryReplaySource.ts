import { ReplayRuntime } from "./replayRuntime";
import type { CarSample, LocSample, TelemetryChunk, TelemetryProvider } from "./timeline";
import type { Point, SessionInfo, SessionOption, Standings, TrackLayout } from "./types";
import { lastIndexAtOrBefore, parseDate, type RawDriver, type RawDriverStatus, type RawLap, type RawPit, type RawRaceControl, type RawRadio, type RawStint, type RawWeather } from "./records";

// Files written by scripts/build_race_library.py.

interface LibraryCircuit {
  name: string | null;
  fullName: string | null;
  place: string | null;
  country: string | null;
  lengthKm: number | null;
  turns: number | null;
}

interface LibrarySummary {
  slug: string;
  /** Missing in libraries built before multi-season support (those are 2025). */
  season?: number;
  /** Folder of the race, relative to the library root (defaults to the slug). */
  dir?: string;
  round: number;
  name: string;
  officialName: string | null;
  date: string;
  time: string;
  totalLaps: number | null;
  circuit: LibraryCircuit;
  winner: { number: number; code: string; name: string; team: string; color: string } | null;
  podium: string[];
  outline: Array<[number, number]>;
}

interface LibraryIndex {
  /** Single-season libraries name the season here instead of on each race. */
  season?: number;
  races: LibrarySummary[];
}

interface IndexedRace extends LibrarySummary {
  key: number;
  season: number;
  dir: string;
}

interface LibraryRace extends LibrarySummary {
  start: number;
  end: number;
  raceStart: number;
  drivers: RawDriver[];
  laps: RawLap[];
  positionsPacked: Array<[number, number, number]>;
  intervalsPacked: Array<[number, number, number | string | null, number | string | null]>;
  stints: RawStint[];
  pits: RawPit[];
  driverStatus: RawDriverStatus[];
  raceControl: RawRaceControl[];
  weather: RawWeather[];
  radio: RawRadio[];
  track: (TrackLayout & { rel: number[] }) | null;
  /** Championship points before this race (absent in libraries built before it was added). */
  standings?: Standings | null;
}

interface PackedCar {
  o: number;
  p: Array<number | null>;
  v: Array<number | null>;
  r: Array<number | null>;
  g: Array<number | null>;
  t: Array<number | null>;
  b: Array<number | null>;
  /** Absent from seasons without DRS (2026 onwards). */
  d?: Array<number | null>;
}

interface TelemetryFile {
  chunkMs: number;
  chunks: Array<{ t0: number; step: number; cars: Record<string, PackedCar> }>;
}

const SESSION_KEY_STORAGE = "f1dash.librarySession";
/** Location samples generated per stored (1 Hz) sample, so dots follow the circuit's curves. */
const SUBSTEPS = 4;

const iso = (ms: number) => new Date(ms).toISOString();

/** Map lap progress (0–1) to a point on the circuit using the reference lap. */
function trackMapper(track: LibraryRace["track"]): ((frac: number) => Point) | null {
  if (!track || track.points.length < 2 || track.rel?.length !== track.points.length) return null;
  const rel = track.rel.map((t, i) => ({ t, i }));
  const pts = track.points;
  return (frac) => {
    const f = ((frac % 1) + 1) % 1;
    const k = lastIndexAtOrBefore(rel, f);
    const a = k < 0 ? rel[rel.length - 1] : rel[k];
    const b = rel[(k + 1) % rel.length];
    let span = b.t - a.t;
    if (span <= 0) span += 1;
    let local = f - a.t;
    if (local < 0) local += 1;
    const w = Math.min(1, Math.max(0, local / span));
    const pa = pts[a.i], pb = pts[b.i];
    return { x: pa.x + (pb.x - pa.x) * w, y: pa.y + (pb.y - pa.y) * w };
  };
}

function decodeChunk(chunk: TelemetryFile["chunks"][number], map: (f: number) => Point): TelemetryChunk {
  const location = new Map<number, LocSample[]>();
  const car = new Map<number, CarSample[]>();
  for (const [num, c] of Object.entries(chunk.cars)) {
    const n = Number(num);
    const locs: LocSample[] = [];
    const cars: CarSample[] = [];
    let acc: number | null = null;
    let prev: { t: number; p: number; i: number } | null = null;
    c.p.forEach((delta, i) => {
      if (delta == null) {
        prev = null;
        return;
      }
      acc = acc == null ? delta : acc + delta;
      const t = chunk.t0 + (c.o + i) * chunk.step;
      const p = acc / 10000;
      const sample = (time: number, progress: number, w: number, from: number) => {
        locs.push({ t: time, ...map(progress) });
        const lerp = (arr: Array<number | null>) => {
          const a = arr[from], b = arr[i];
          return a == null || b == null ? b ?? a : a + (b - a) * w;
        };
        const speed = lerp(c.v), rpm = lerp(c.r);
        cars.push({
          t: time,
          speed: speed != null ? Math.round(speed) : null,
          rpm: rpm != null ? Math.round(rpm * 10) : null,
          gear: c.g[i],
          throttle: c.t[i],
          brake: c.b[i] != null ? c.b[i]! * 100 : null,
          drs: c.d?.[i] ?? null,
        });
      };
      const last = prev as { t: number; p: number; i: number } | null;
      if (last && t - last.t <= chunk.step * 1.5) {
        for (let s = 1; s < SUBSTEPS; s++) {
          const w = s / SUBSTEPS;
          sample(last.t + (t - last.t) * w, last.p + (p - last.p) * w, w, last.i);
        }
      }
      sample(t, p, 1, i);
      prev = { t, p, i };
    });
    locs.sort((a, b) => a.t - b.t);
    cars.sort((a, b) => a.t - b.t);
    if (locs.length) location.set(n, locs);
    if (cars.length) car.set(n, cars);
  }
  return { location, car };
}

function safeStorage(fn: () => void): void {
  try {
    fn();
  } catch {
    /* storage unavailable */
  }
}

/** Replays real races bundled as static files (see scripts/build_race_library.py). */
export class LibraryReplaySource extends ReplayRuntime {
  readonly kind = "replay" as const;
  readonly selectableSessions = true;
  readonly sourceLabel = "Race library · FastF1 data via TracingInsights, F1DB";
  seasons: number[] = [];
  private index: Promise<IndexedRace[]> | null = null;
  private sessionKey: number | null = null;
  private loadToken = 0;

  constructor(
    private base = "races/",
    private initialSession: number | null = null,
  ) {
    super();
  }

  override start(): void {
    super.start();
    if (this.sessionKey == null) void this.autoload();
  }

  currentSessionKey(): number | null {
    return this.sessionKey;
  }

  private loadIndex(): Promise<IndexedRace[]> {
    if (!this.index) {
      this.index = fetch(`${this.base}index.json`)
        .then((r) => {
          if (!r.ok) throw new Error(`race library not found (${r.status})`);
          return r.json() as Promise<LibraryIndex>;
        })
        .then((idx) =>
          idx.races.map((r) => {
            const season = r.season ?? idx.season ?? 2025;
            // Keys are unique across seasons: 202612 = 2026, round 12.
            return { ...r, season, dir: r.dir ?? r.slug, key: season * 100 + r.round };
          }),
        );
      this.index
        .then((races) => (this.seasons = [...new Set(races.map((r) => r.season))].sort((a, b) => b - a)))
        .catch(() => (this.index = null));
    }
    return this.index;
  }

  async listSessions(year?: number): Promise<SessionOption[]> {
    const races = await this.loadIndex();
    return races
      .filter((r) => year == null || r.season === year)
      .map((r) => ({
        key: r.key,
        label: `${r.season} R${r.round} · ${r.name}`,
        year: r.season,
        date: parseDate(`${r.date}T${r.time || "12:00"}:00Z`) ?? 0,
        name: r.name,
        circuit: r.circuit.fullName ?? r.circuit.name,
        place: r.circuit.place,
        country: r.circuit.country,
        round: r.round,
        laps: r.totalLaps,
        lengthKm: r.circuit.lengthKm,
        winner: r.winner ? { ...r.winner, color: `#${r.winner.color}` } : null,
        podium: r.podium,
        outline: r.outline.map(([x, y]) => ({ x, y })),
      }));
  }

  private async autoload(): Promise<void> {
    let key = this.initialSession;
    if (key == null) {
      safeStorage(() => {
        const saved = Number(localStorage.getItem(SESSION_KEY_STORAGE));
        if (Number.isFinite(saved) && saved > 0) key = saved;
      });
    }
    try {
      const races = await this.listSessions();
      if (!races.length) throw new Error("the library is empty");
      // Default to the most recent race of the newest season.
      if (key == null || !races.some((r) => r.key === key)) key = races.reduce((a, b) => (b.key > a.key ? b : a)).key;
      await this.loadSession(key);
    } catch (err) {
      this.update({ loading: null, error: `Race library unavailable: ${(err as Error).message}` });
    }
  }

  /** Older libraries store "races/<slug>/radio/x.mp3"; newer ones "radio/x.mp3" relative to the race folder. */
  private radioUrl(dir: string, url: string | null | undefined): string | null {
    if (!url) return null;
    return url.startsWith("races/") ? `${this.base}${url.slice("races/".length)}` : `${this.base}${dir}/${url}`;
  }

  async loadSession(key: number): Promise<void> {
    const token = ++this.loadToken;
    this.sessionKey = key;
    safeStorage(() => localStorage.setItem(SESSION_KEY_STORAGE, String(key)));
    this.clearDataset();
    try {
      const summary = (await this.loadIndex()).find((r) => r.key === key);
      if (!summary) throw new Error(`race ${key} is not in the library`);
      this.update({ loading: `Loading ${summary.name}…`, error: null });
      const res = await fetch(`${this.base}${summary.dir}/race.json`);
      if (!res.ok) throw new Error(`race file missing (${res.status})`);
      const race = (await res.json()) as LibraryRace;
      if (token !== this.loadToken) return;

      const map = trackMapper(race.track);
      let telemetry: Promise<TelemetryFile> | null = null;
      const telemetryFile = () =>
        (telemetry ??= fetch(`${this.base}${summary.dir}/tel.json`).then((r) => {
          if (!r.ok) throw new Error(`telemetry missing (${r.status})`);
          return r.json() as Promise<TelemetryFile>;
        }));
      const provider: TelemetryProvider = {
        chunkMs: 120_000,
        loadChunk: async (from) => {
          const file = await telemetryFile();
          const i = Math.round((from - race.start) / file.chunkMs);
          const chunk = file.chunks[i];
          if (!chunk || !map) return { location: new Map(), car: new Map() };
          return decodeChunk(chunk, map);
        },
      };
      // Start fetching telemetry right away; it is the largest file.
      void telemetryFile().catch(() => undefined);

      const info: SessionInfo = {
        key: summary.key,
        name: summary.name,
        session: "Race",
        circuit: summary.circuit.name ?? "--",
        circuitFullName: summary.circuit.fullName,
        place: summary.circuit.place,
        country: summary.circuit.country ?? "--",
        year: summary.season,
        officialName: summary.officialName,
        lengthKm: summary.circuit.lengthKm,
        turns: summary.circuit.turns,
        totalLaps: summary.totalLaps,
        round: summary.round,
        date: race.raceStart,
      };
      const at = (sec: number) => iso(race.start + sec * 1000);
      this.setDataset({
        session: info,
        start: race.start,
        end: race.end,
        totalLaps: summary.totalLaps,
        drivers: race.drivers,
        laps: race.laps,
        positions: race.positionsPacked.map(([t, n, position]) => ({ driver_number: n, date: at(t), position })),
        intervals: race.intervalsPacked.map(([t, n, gap, interval]) => ({
          driver_number: n,
          date: at(t),
          gap_to_leader: gap,
          interval,
        })),
        stints: race.stints,
        pits: race.pits,
        driverStatus: race.driverStatus,
        radio: race.radio.map((r) => ({ ...r, recording_url: this.radioUrl(summary.dir, r.recording_url) })),
        raceControl: race.raceControl,
        weather: race.weather,
        track: race.track
          ? { points: race.track.points, rel: race.track.rel, drsZones: race.track.drsZones, corners: race.track.corners }
          : null,
        standings: race.standings ?? null,
        telemetry: provider,
      });
    } catch (err) {
      if (token !== this.loadToken) return;
      this.update({ loading: null, error: `Could not load race: ${(err as Error).message}` });
    }
  }
}
