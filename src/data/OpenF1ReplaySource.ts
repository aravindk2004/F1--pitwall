import { openf1 } from "./openf1Api";
import { ReplayRuntime } from "./replayRuntime";
import { buildTrack } from "./track";
import type { CarSample, LocSample, TelemetryChunk, TelemetryProvider } from "./timeline";
import type { SessionInfo, SessionOption, TrackLayout } from "./types";
import {
  num,
  parseDate,
  type RawCarData,
  type RawDriver,
  type RawInterval,
  type RawLap,
  type RawLocation,
  type RawMeeting,
  type RawPit,
  type RawPosition,
  type RawRaceControl,
  type RawRadio,
  type RawSession,
  type RawStint,
  type RawWeather,
} from "./records";

const CHUNK_MS = 90_000;
const SESSION_KEY_STORAGE = "f1dash.replaySession";

function toLocSamples(rows: RawLocation[]): Map<number, LocSample[]> {
  const out = new Map<number, LocSample[]>();
  for (const r of rows) {
    const t = parseDate(r.date);
    const x = num(r.x), y = num(r.y);
    if (t == null || x == null || y == null || (x === 0 && y === 0)) continue;
    let arr = out.get(r.driver_number);
    if (!arr) out.set(r.driver_number, (arr = []));
    arr.push({ t, x, y });
  }
  for (const arr of out.values()) arr.sort((a, b) => a.t - b.t);
  return out;
}

function toCarSamples(rows: RawCarData[]): Map<number, CarSample[]> {
  const out = new Map<number, CarSample[]>();
  for (const r of rows) {
    const t = parseDate(r.date);
    if (t == null) continue;
    let arr = out.get(r.driver_number);
    if (!arr) out.set(r.driver_number, (arr = []));
    arr.push({
      t,
      speed: num(r.speed),
      rpm: num(r.rpm),
      gear: num(r.n_gear),
      throttle: num(r.throttle),
      brake: num(r.brake),
      drs: num(r.drs),
    });
  }
  for (const arr of out.values()) arr.sort((a, b) => a.t - b.t);
  return out;
}

function safeStorage(fn: () => void): void {
  try {
    fn();
  } catch {
    /* storage unavailable */
  }
}

/** Replays a historical session from the public OpenF1 REST API. */
export class OpenF1ReplaySource extends ReplayRuntime {
  readonly kind = "replay" as const;
  readonly selectableSessions = true;
  readonly sourceLabel = "OpenF1 API (api.openf1.org)";
  readonly seasons: number[] = (() => {
    const out: number[] = [];
    for (let y = new Date().getUTCFullYear(); y >= 2023; y--) out.push(y);
    return out;
  })();
  private sessionKey: number | null = null;
  private abort: AbortController | null = null;

  constructor(private initialSession: number | null = null) {
    super();
  }

  override start(): void {
    super.start();
    if (this.sessionKey == null) void this.autoload();
  }

  override stop(): void {
    super.stop();
    this.abort?.abort();
  }

  currentSessionKey(): number | null {
    return this.sessionKey;
  }

  async listSessions(year: number): Promise<SessionOption[]> {
    const rows = await openf1<RawSession>("sessions", { year, session_type: "Race" });
    const meetings = await openf1<RawMeeting>("meetings", { year }).catch(() => [] as RawMeeting[]);
    const meetingName = new Map(meetings.map((m) => [m.meeting_key, m.meeting_name ?? null]));
    const now = Date.now();
    const races = rows
      .map((s) => ({ s, date: parseDate(s.date_start) ?? 0 }))
      .filter(({ date }) => date > 0 && date < now)
      .sort((a, b) => a.date - b.date);
    return races.map(({ s, date }, i) => {
      const gp = (s.meeting_key != null && meetingName.get(s.meeting_key)) || `${s.country_name ?? s.location ?? "?"} Grand Prix`;
      const sprint = (s.session_name ?? "").toLowerCase().includes("sprint");
      return {
        key: s.session_key,
        year: s.year ?? year,
        date,
        round: i + 1,
        label: `${gp}${sprint ? " (Sprint)" : ""}`,
        name: `${gp}${sprint ? " — Sprint" : ""}`,
        circuit: s.circuit_short_name ?? null,
        place: s.location ?? null,
        country: s.country_name ?? null,
      };
    });
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
      if (key == null) {
        this.update({ loading: "Finding latest race…" });
        const year = new Date().getUTCFullYear();
        let sessions = await this.listSessions(year);
        if (!sessions.length) sessions = await this.listSessions(year - 1);
        key = sessions[sessions.length - 1]?.key ?? null;
      }
      if (key == null) throw new Error("No sessions available");
      await this.loadSession(key);
    } catch (err) {
      this.update({ loading: null, error: `OpenF1 unavailable: ${(err as Error).message}` });
    }
  }

  async loadSession(key: number): Promise<void> {
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const signal = abort.signal;
    this.sessionKey = key;
    safeStorage(() => localStorage.setItem(SESSION_KEY_STORAGE, String(key)));
    this.clearDataset();
    this.update({ loading: "Loading session…", error: null });

    const get = <T,>(endpoint: string, label: string) => {
      this.update({ loading: `Loading ${label}…` });
      return openf1<T>(endpoint, { session_key: key }, undefined, signal);
    };
    // Optional feeds degrade to empty so the UI shows "--" instead of failing.
    const optional = <T,>(p: Promise<T[]>) => p.catch((err) => (signal.aborted ? Promise.reject(err) : ([] as T[])));

    try {
      const [session] = await get<RawSession>("sessions", "session");
      if (!session) throw new Error(`Session ${key} not found`);
      const [meeting] =
        session.meeting_key != null
          ? await optional(openf1<RawMeeting>("meetings", { meeting_key: session.meeting_key }, undefined, signal))
          : [];
      const drivers = await optional(get<RawDriver>("drivers", "drivers"));
      const laps = await optional(get<RawLap>("laps", "laps"));
      const positions = await optional(get<RawPosition>("position", "positions"));
      const intervals = await optional(get<RawInterval>("intervals", "intervals"));
      const stints = await optional(get<RawStint>("stints", "tyres"));
      const pits = await optional(get<RawPit>("pit", "pit stops"));
      const radio = await optional(get<RawRadio>("team_radio", "team radio"));
      const raceControl = await optional(get<RawRaceControl>("race_control", "race control"));
      const weather = await optional(get<RawWeather>("weather", "weather"));

      const sessionStart = parseDate(session.date_start) ?? Date.now();
      const sessionEnd = parseDate(session.date_end) ?? sessionStart + 2 * 3600_000;
      const lapStarts = laps.map((l) => parseDate(l.date_start)).filter((t): t is number => t != null);
      const lapEnds = laps
        .map((l) => {
          const s = parseDate(l.date_start);
          return s != null && l.lap_duration != null ? s + l.lap_duration * 1000 : null;
        })
        .filter((t): t is number => t != null);
      const start = lapStarts.length ? Math.max(sessionStart, Math.min(...lapStarts) - 30_000) : sessionStart;
      const end = lapEnds.length ? Math.min(sessionEnd + 600_000, Math.max(...lapEnds) + 60_000) : sessionEnd;

      this.update({ loading: "Drawing track…" });
      const track = await this.loadTrack(key, laps, signal).catch(() => null);
      if (signal.aborted) return;

      const maxLap = laps.reduce((m, l) => Math.max(m, l.lap_number ?? 0), 0);
      const info: SessionInfo = {
        key,
        name: meeting?.meeting_name ?? `${session.country_name ?? session.location ?? ""} Grand Prix`.trim(),
        session: session.session_name ?? "Race",
        officialName: meeting?.meeting_official_name ?? null,
        circuit: session.circuit_short_name ?? session.location ?? "--",
        place: session.location ?? null,
        country: session.country_name ?? "--",
        year: session.year ?? null,
        totalLaps: maxLap || null,
        date: sessionStart,
      };
      const telemetry: TelemetryProvider = {
        chunkMs: CHUNK_MS,
        loadChunk: async (from, to): Promise<TelemetryChunk> => {
          const [loc, car] = await Promise.all([
            openf1<RawLocation>("location", { session_key: key }, { from, to }, signal),
            openf1<RawCarData>("car_data", { session_key: key }, { from, to }, signal),
          ]);
          return { location: toLocSamples(loc), car: toCarSamples(car) };
        },
      };
      this.setDataset({
        session: info,
        start,
        end,
        totalLaps: null,
        drivers,
        laps,
        positions,
        intervals,
        stints,
        pits,
        radio,
        raceControl,
        weather,
        track,
        telemetry,
      });
    } catch (err) {
      if (signal.aborted) return;
      this.update({ loading: null, error: `Could not load session: ${(err as Error).message}` });
    }
  }

  /** Pick a clean, representative lap and draw the circuit from its location trace. */
  private async loadTrack(key: number, laps: RawLap[], signal: AbortSignal): Promise<TrackLayout | null> {
    const candidates = laps.filter(
      (l) => l.lap_number != null && l.lap_number >= 2 && l.lap_duration != null && !l.is_pit_out_lap && l.date_start,
    );
    if (!candidates.length) return null;
    const durations = candidates.map((l) => l.lap_duration!).sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)];
    const ref = candidates.reduce((best, l) =>
      Math.abs(l.lap_duration! - median) < Math.abs(best.lap_duration! - median) ? l : best,
    );
    const from = parseDate(ref.date_start)!;
    const to = from + ref.lap_duration! * 1000 + 500;
    const params = { session_key: key, driver_number: ref.driver_number };
    const loc = await openf1<RawLocation>("location", params, { from, to }, signal);
    const car = await openf1<RawCarData>("car_data", params, { from, to }, signal).catch(() => []);
    const locSamples = toLocSamples(loc).get(ref.driver_number) ?? [];
    const drs = (toCarSamples(car).get(ref.driver_number) ?? []).map((c) => ({ t: c.t, drs: c.drs }));
    return buildTrack(locSamples, drs);
  }
}
