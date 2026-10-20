// Public data contracts shared by every data source and by the UI.
// Components may import types from here, but never a provider implementation.

export type SourceStatus = "LIVE" | "STALE" | "REPLAY" | "OFFLINE";
export type SourceMode = "live" | "replay";
export type SourceKind = "live" | "replay" | "mock";

/** Topics forwarded by the Python bridge. The first seven are the core feed. */
export type Topic =
  | "position"
  | "laps"
  | "intervals"
  | "car_data"
  | "team_radio"
  | "race_control"
  | "weather"
  | "location"
  | "drivers"
  | "stints"
  | "pit"
  | "driver_status"
  | "session"
  | "lap_count"
  | "heartbeat";

export type SectorStatus = "purple" | "green" | "yellow" | null;
export type Sectors<T> = [T, T, T];

export interface DriverState {
  number: number;
  code: string;
  name: string;
  team: string;
  /** Hex colour including '#'. */
  teamColor: string;
  position: number | null;
  /** Seconds, or a string such as "+1 LAP". */
  gapToLeader: number | string | null;
  interval: number | string | null;
  lastLap: number | null;
  bestLap: number | null;
  lapNumber: number | null;
  sectors: Sectors<number | null>;
  sectorStatus: Sectors<SectorStatus>;
  tyre: { compound: string | null; age: number | null };
  pitStops: number | null;
  retired: boolean;
  inPit: boolean;
}

export interface CarTelemetry {
  speed: number | null;
  rpm: number | null;
  gear: number | null;
  throttle: number | null;
  brake: number | null;
  /** Raw OpenF1/F1 DRS channel value (>=10 means open, 8 means eligible). */
  drs: number | null;
}

export interface Point {
  x: number;
  y: number;
}

export interface RadioMessage {
  id: string;
  date: number;
  driverNumber: number;
  url: string;
}

export interface RaceControlMessage {
  id: string;
  date: number;
  category: string | null;
  flag: string | null;
  message: string;
  lap: number | null;
}

export interface Weather {
  airTemp: number | null;
  trackTemp: number | null;
  humidity: number | null;
  rainfall: number | null;
  windSpeed: number | null;
  windDirection: number | null;
}

export interface TrackLayout {
  points: Point[];
  /** Lap fraction (0–1) of each point, when known; otherwise derived from distance. */
  rel?: number[];
  /** Index ranges into `points` where DRS was open on the reference lap. */
  drsZones: Array<[number, number]>;
  /** Turn numbers, in the same coordinate space as `points`. */
  corners?: Array<{ x: number; y: number; label: string }>;
}

export interface SessionInfo {
  key: string | number | null;
  /** Event name, e.g. "British Grand Prix". */
  name: string;
  /** Short circuit name, e.g. "Silverstone". */
  circuit: string;
  country: string;
  year: number | null;
  /** Session type, e.g. "Race". */
  session?: string | null;
  officialName?: string | null;
  circuitFullName?: string | null;
  place?: string | null;
  lengthKm?: number | null;
  turns?: number | null;
  totalLaps?: number | null;
  round?: number | null;
  /** Epoch ms of the session start. */
  date?: number | null;
  /** Shown when the data is generated rather than real. */
  synthetic?: boolean;
}

export interface TopicHealth {
  lastMessage: number | null;
  stale: boolean;
}

export type PlaybackSpeed = 1 | 2 | 5 | 10;

export interface PlaybackState {
  playing: boolean;
  speed: PlaybackSpeed;
  /** Epoch ms of the playhead. */
  time: number;
  start: number;
  end: number;
}

/** One completed lap of one car, as known when it crossed the line. */
export interface LapRecord {
  lap: number;
  /** Epoch ms the lap was completed. */
  end: number;
  time: number | null;
  sectors: Sectors<number | null>;
  compound: string | null;
  tyreAge: number | null;
  position: number | null;
  /** Seconds behind the leader at the line; null when lapped or unknown. */
  gap: number | null;
  pitIn: boolean;
  pitOut: boolean;
}

/** Championship points before this race started. */
export interface Standings {
  /** Matched by number, or by three-letter code when the number is unknown. */
  drivers: Array<{ number: number | null; code?: string | null; points: number }>;
  constructors: Array<{ team: string; points: number }>;
}

/** One lap of speed/throttle/brake, for comparing two drivers. */
export interface LapTrace {
  driver: number;
  lap: number;
  /** x is the fraction of the lap distance (0–1). */
  samples: Array<{ x: number; speed: number | null; throttle: number | null; brake: number | null; gear: number | null }>;
}

export interface F1Snapshot {
  session: SessionInfo | null;
  lap: { current: number | null; total: number | null };
  drivers: Record<number, DriverState>;
  /** Driver numbers sorted by race position. */
  order: number[];
  car: Record<number, CarTelemetry>;
  locations: Record<number, Point>;
  radio: RadioMessage[];
  raceControl: RaceControlMessage[];
  weather: Weather | null;
  track: TrackLayout | null;
  /** Completed laps per driver, oldest first. */
  history: Record<number, LapRecord[]>;
  standings: Standings | null;
  /** The source's own clock (epoch ms): playback time in replays, wall time live. */
  now: number | null;
  topics: Partial<Record<Topic, TopicHealth>>;
  playback: PlaybackState | null;
  loading: string | null;
  error: string | null;
}

export interface SessionOption {
  key: number;
  label: string;
  year: number;
  date: number;
  /** Optional details for the race picker. */
  name?: string;
  circuit?: string | null;
  place?: string | null;
  country?: string | null;
  round?: number | null;
  laps?: number | null;
  lengthKm?: number | null;
  winner?: { code: string; name: string; team: string; color: string } | null;
  podium?: string[];
  /** Small circuit outline for a thumbnail. */
  outline?: Point[] | null;
}

/** Extra controls offered by sources that play back recorded data. */
export interface ReplayControls {
  listSessions(year: number): Promise<SessionOption[]>;
  loadSession(key: number): Promise<void>;
  currentSessionKey(): number | null;
  play(): void;
  pause(): void;
  setSpeed(speed: PlaybackSpeed): void;
  seek(time: number): void;
  /** True when listSessions/loadSession are meaningful (real sessions). */
  readonly selectableSessions: boolean;
  /** Seasons the race picker can offer, newest first. */
  readonly seasons: number[];
  /** Where the races come from, shown in the picker. */
  readonly sourceLabel: string;
}

export type Listener = (snapshot: F1Snapshot) => void;

export interface F1DataSource {
  /** Where a car was `secondsAgo` before the source's current time (for the pit-rejoin ghost). */
  pastLocation?(driver: number, secondsAgo: number): Point | null;
  /** Speed trace of one lap; resolves null when the source has no telemetry for it. */
  lapTrace?(driver: number, lap: number): Promise<LapTrace | null>;
  subscribe(listener: Listener): () => void;
  getSnapshot(): F1Snapshot;
  status(): SourceStatus;
  mode(): SourceMode;
  start(): void;
  stop(): void;
  readonly kind: SourceKind;
  readonly replay?: ReplayControls;
}

export function emptySnapshot(): F1Snapshot {
  return {
    session: null,
    lap: { current: null, total: null },
    drivers: {},
    order: [],
    car: {},
    locations: {},
    radio: [],
    raceControl: [],
    weather: null,
    track: null,
    history: {},
    standings: null,
    now: null,
    topics: {},
    playback: null,
    loading: null,
    error: null,
  };
}
