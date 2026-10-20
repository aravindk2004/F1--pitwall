// Computes the full race state at an arbitrary instant from recorded data.
// Shared by the OpenF1 replay and the offline mock.

import type {
  CarTelemetry,
  DriverState,
  LapRecord,
  LapTrace,
  Standings,
  Point,
  RaceControlMessage,
  RadioMessage,
  SessionInfo,
  Sectors,
  TrackLayout,
  Weather,
} from "./types";
import {
  compoundCode,
  lastIndexAtOrBefore,
  num,
  parseDate,
  teamColor,
  type RawDriver,
  type RawDriverStatus,
  type RawInterval,
  type RawLap,
  type RawPit,
  type RawPosition,
  type RawRaceControl,
  type RawRadio,
  type RawStint,
  type RawWeather,
} from "./records";
import { SectorBests } from "./sectors";
import { lerpSample } from "./interpolate";

export interface LocSample {
  t: number;
  x: number;
  y: number;
}

export interface CarSample extends CarTelemetry {
  t: number;
}

export interface TelemetryChunk {
  location: Map<number, LocSample[]>;
  car: Map<number, CarSample[]>;
}

/** Supplies high-frequency telemetry in fixed time windows, loaded on demand. */
export interface TelemetryProvider {
  chunkMs: number;
  loadChunk(start: number, end: number): Promise<TelemetryChunk>;
}

export interface TimelineDataset {
  session: SessionInfo;
  start: number;
  end: number;
  totalLaps: number | null;
  drivers: RawDriver[];
  laps: RawLap[];
  positions: RawPosition[];
  intervals: RawInterval[];
  stints: RawStint[];
  pits: RawPit[];
  radio: RawRadio[];
  raceControl: RawRaceControl[];
  weather: RawWeather[];
  driverStatus?: RawDriverStatus[];
  track: TrackLayout | null;
  telemetry: TelemetryProvider;
  /** Championship points before this race, when known. */
  standings?: Standings | null;
}

interface LapEntry {
  t: number; // lap start
  end: number | null;
  number: number;
  duration: number | null;
  sectors: Sectors<number | null>;
  sectorEnds: Sectors<number | null>;
}

interface Timed<T> {
  t: number;
  v: T;
}

export interface HeavyState {
  drivers: Record<number, DriverState>;
  order: number[];
  radio: RadioMessage[];
  raceControl: RaceControlMessage[];
  weather: Weather | null;
  lap: { current: number | null; total: number | null };
  history: Record<number, LapRecord[]>;
}

const RETIRE_GRACE_MS = 120_000;
const FEED_LIMIT = 40;

function groupTimed<R extends { driver_number: number; date?: string | null }>(rows: R[]): Map<number, Timed<R>[]> {
  const out = new Map<number, Timed<R>[]>();
  for (const r of rows) {
    const t = parseDate(r.date);
    if (t == null || r.driver_number == null) continue;
    let arr = out.get(r.driver_number);
    if (!arr) out.set(r.driver_number, (arr = []));
    arr.push({ t, v: r });
  }
  for (const arr of out.values()) arr.sort((a, b) => a.t - b.t);
  return out;
}

function latest<T>(arr: Timed<T>[] | undefined, t: number): T | null {
  if (!arr) return null;
  const i = lastIndexAtOrBefore(arr, t);
  return i >= 0 ? arr[i].v : null;
}

export class Timeline {
  readonly start: number;
  readonly end: number;
  private driverInfo = new Map<number, RawDriver>();
  private driverNumbers: number[] = [];
  private laps = new Map<number, LapEntry[]>();
  private sectorEvents: Array<{ t: number; driver: number; sector: 0 | 1 | 2; value: number }> = [];
  private lapEvents: Array<{ t: number; driver: number; value: number }> = [];
  private positions: Map<number, Timed<RawPosition>[]>;
  private intervals: Map<number, Timed<RawInterval>[]>;
  private pits: Map<number, Timed<RawPit>[]>;
  private status: Map<number, Timed<RawDriverStatus>[]>;
  private stints = new Map<number, RawStint[]>();
  private radio: Array<{ t: number; v: RadioMessage }>;
  private raceControl: Array<{ t: number; v: RaceControlMessage }>;
  private weather: Array<{ t: number; v: Weather }>;
  private retireAt = new Map<number, number>();
  private totalLaps: number | null;
  /** Every completed lap per driver, sorted by completion time. */
  private lapRecords = new Map<number, LapRecord[]>();
  private historyCache: { count: number; value: Record<number, LapRecord[]> } | null = null;

  constructor(private ds: TimelineDataset) {
    this.start = ds.start;
    this.end = ds.end;
    for (const d of ds.drivers) {
      if (d.driver_number == null) continue;
      this.driverInfo.set(d.driver_number, d);
    }
    this.indexLaps(ds.laps);
    this.positions = groupTimed(ds.positions);
    this.intervals = groupTimed(ds.intervals);
    this.pits = groupTimed(ds.pits);
    this.status = groupTimed(ds.driverStatus ?? []);
    for (const s of ds.stints) {
      if (s.driver_number == null) continue;
      const arr = this.stints.get(s.driver_number) ?? [];
      arr.push(s);
      this.stints.set(s.driver_number, arr);
    }
    for (const arr of this.stints.values()) arr.sort((a, b) => (a.stint_number ?? 0) - (b.stint_number ?? 0));

    this.radio = ds.radio
      .map((r) => {
        const t = parseDate(r.date);
        if (t == null || !r.recording_url) return null;
        return { t, v: { id: `${r.driver_number}-${t}`, date: t, driverNumber: r.driver_number, url: r.recording_url } };
      })
      .filter(<T,>(x: T | null): x is T => x != null)
      .sort((a, b) => a.t - b.t);
    this.raceControl = ds.raceControl
      .map((r, i) => {
        const t = parseDate(r.date);
        if (t == null) return null;
        return {
          t,
          v: {
            id: `${t}-${i}`,
            date: t,
            category: r.category ?? null,
            flag: r.flag ?? null,
            message: r.message ?? "",
            lap: num(r.lap_number),
          },
        };
      })
      .filter(<T,>(x: T | null): x is T => x != null)
      .sort((a, b) => a.t - b.t);
    this.weather = ds.weather
      .map((w) => {
        const t = parseDate(w.date);
        if (t == null) return null;
        return {
          t,
          v: {
            airTemp: num(w.air_temperature),
            trackTemp: num(w.track_temperature),
            humidity: num(w.humidity),
            rainfall: num(w.rainfall),
            windSpeed: num(w.wind_speed),
            windDirection: num(w.wind_direction),
          },
        };
      })
      .filter(<T,>(x: T | null): x is T => x != null)
      .sort((a, b) => a.t - b.t);

    const known = new Set<number>([...this.driverInfo.keys(), ...this.laps.keys(), ...this.positions.keys()]);
    this.driverNumbers = [...known].sort((a, b) => a - b);

    let maxLap = 0;
    for (const arr of this.laps.values()) for (const l of arr) maxLap = Math.max(maxLap, l.number);
    this.totalLaps = ds.totalLaps ?? (maxLap || null);
    if (!ds.driverStatus?.length) this.inferRetirements();
    this.buildLapRecords();
  }

  private stintFor(driver: number, lapNumber: number | null): RawStint | null {
    const stints = this.stints.get(driver) ?? [];
    let stint: RawStint | null = null;
    for (const s of stints) {
      const startLap = s.lap_start ?? 1;
      if (lapNumber == null ? s === stints[0] : startLap <= lapNumber) stint = s;
    }
    return stint;
  }

  private tyreAge(stint: RawStint | null, lapNumber: number | null): number | null {
    if (!stint || stint.tyre_age_at_start == null) return null;
    return stint.tyre_age_at_start + Math.max(0, (lapNumber ?? stint.lap_start ?? 1) - (stint.lap_start ?? 1));
  }

  private buildLapRecords(): void {
    const pitLaps = new Map<number, Set<number>>();
    for (const [driver, rows] of this.pits) {
      pitLaps.set(driver, new Set(rows.map((r) => num(r.v.lap_number)).filter((n): n is number => n != null)));
    }
    const pitOutLaps = new Map<number, Set<number>>();
    for (const r of this.ds.laps) {
      if (r.is_pit_out_lap && r.lap_number != null) {
        const set = pitOutLaps.get(r.driver_number) ?? new Set<number>();
        set.add(r.lap_number);
        pitOutLaps.set(r.driver_number, set);
      }
    }
    for (const [driver, laps] of this.laps) {
      const records: LapRecord[] = [];
      for (const l of laps) {
        if (l.end == null) continue;
        const stint = this.stintFor(driver, l.number);
        const gap = latest(this.intervals.get(driver), l.end)?.gap_to_leader;
        // OpenF1 has no pit-out flag for some sessions; a new stint starting on this lap means the same.
        const stintStart = stint?.lap_start === l.number && (stint.stint_number ?? 1) > 1;
        records.push({
          lap: l.number,
          end: l.end,
          time: l.duration,
          sectors: l.sectors,
          compound: compoundCode(stint?.compound),
          tyreAge: this.tyreAge(stint, l.number),
          position: num(latest(this.positions.get(driver), l.end)?.position),
          gap: typeof gap === "number" ? gap : typeof gap === "string" && /^\+?\d+(\.\d+)?$/.test(gap) ? Number(gap) : null,
          pitIn: pitLaps.get(driver)?.has(l.number) ?? false,
          pitOut: (pitOutLaps.get(driver)?.has(l.number) ?? false) || stintStart,
        });
      }
      records.sort((a, b) => a.end - b.end);
      this.lapRecords.set(driver, records);
    }
  }

  /** Completed laps as of `t`; the same object is returned until a new lap completes. */
  historyAt(t: number): Record<number, LapRecord[]> {
    const out: Record<number, LapRecord[]> = {};
    let count = 0;
    const cut = new Map<number, number>();
    for (const [driver, recs] of this.lapRecords) {
      let lo = 0, hi = recs.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (recs[mid].end <= t) lo = mid + 1;
        else hi = mid;
      }
      cut.set(driver, lo);
      count = count * 31 + lo + 1;
    }
    if (this.historyCache && this.historyCache.count === count) return this.historyCache.value;
    for (const [driver, n] of cut) out[driver] = this.lapRecords.get(driver)!.slice(0, n);
    this.historyCache = { count, value: out };
    return out;
  }

  get standings(): Standings | null {
    return this.ds.standings ?? null;
  }

  /** Start and end (epoch ms) of a driver's lap, if it was completed. */
  lapWindow(driver: number, lap: number): { start: number; end: number } | null {
    const l = this.laps.get(driver)?.find((x) => x.number === lap);
    return l && l.end != null ? { start: l.t, end: l.end } : null;
  }

  /** Load (or reuse) every telemetry chunk overlapping [from, to]. */
  async chunksFor(from: number, to: number): Promise<TelemetryChunk[]> {
    const first = this.chunkIndex(from), last = this.chunkIndex(to);
    const out: TelemetryChunk[] = [];
    for (let i = Math.max(0, first); i <= last; i++) {
      const cached = this.chunkAt(i);
      if (cached) {
        out.push(cached);
        continue;
      }
      const start = this.start + i * this.ds.telemetry.chunkMs;
      const chunk = await this.ds.telemetry.loadChunk(start, start + this.ds.telemetry.chunkMs);
      if (!this.chunks.has(i) || this.chunks.get(i) === "loading" || this.chunks.get(i) === "error") this.chunks.set(i, chunk);
      out.push(chunk);
    }
    return out;
  }

  /** Interpolated position of one car at time t, from loaded telemetry only. */
  locationAt(driver: number, t: number): Point | null {
    const idx = this.chunkIndex(t);
    const here = this.chunkAt(idx)?.location.get(driver);
    if (!here) return null;
    const i = lastIndexAtOrBefore(here, t);
    const a = i >= 0 ? here[i] : this.chunkAt(idx - 1)?.location.get(driver)?.at(-1);
    const b = i + 1 < here.length ? here[i + 1] : this.chunkAt(idx + 1)?.location.get(driver)?.[0];
    if (a && b) return lerpSample(a, b, t, 5000);
    return a && Math.abs(t - a.t) < 5000 ? { x: a.x, y: a.y } : null;
  }

  /** One lap of telemetry, with x as the fraction of lap distance along the circuit. */
  async lapTrace(driver: number, lap: number, distanceOf: (p: Point) => number | null): Promise<LapTrace | null> {
    const w = this.lapWindow(driver, lap);
    if (!w) return null;
    const chunks = await this.chunksFor(w.start, w.end);
    const cars = chunks.flatMap((c) => c.car.get(driver) ?? []).filter((s) => s.t >= w.start && s.t <= w.end);
    const locs = chunks.flatMap((c) => c.location.get(driver) ?? []).sort((a, b) => a.t - b.t);
    if (cars.length < 5) return null;
    const samples: LapTrace["samples"] = [];
    let prevX = -1;
    for (const s of cars.sort((a, b) => a.t - b.t)) {
      let x: number | null = null;
      if (locs.length) {
        const i = lastIndexAtOrBefore(locs, s.t);
        const a = locs[Math.max(0, i)], b = locs[Math.min(locs.length - 1, i + 1)];
        x = distanceOf(lerpSample(a, b, s.t, 5000));
      }
      // Fall back to the share of lap time when the car's position is unknown.
      if (x == null) x = (s.t - w.start) / (w.end - w.start);
      // Near the line the projection can wrap; keep the trace moving forward.
      if (prevX > 0.5 && x < 0.2) x += 1;
      if (x > 1.05 || x < prevX - 0.02) continue;
      prevX = Math.max(prevX, x);
      samples.push({ x: Math.min(1, x), speed: s.speed, throttle: s.throttle, brake: s.brake, gear: s.gear });
    }
    return samples.length >= 5 ? { driver, lap, samples } : null;
  }

  private indexLaps(rows: RawLap[]): void {
    const byDriver = new Map<number, RawLap[]>();
    for (const r of rows) {
      if (r.driver_number == null || r.lap_number == null) continue;
      const arr = byDriver.get(r.driver_number) ?? [];
      arr.push(r);
      byDriver.set(r.driver_number, arr);
    }
    for (const [driver, raw] of byDriver) {
      raw.sort((a, b) => (a.lap_number ?? 0) - (b.lap_number ?? 0));
      const entries: LapEntry[] = [];
      let prevEnd: number | null = null;
      for (const r of raw) {
        const start: number | null = parseDate(r.date_start) ?? prevEnd;
        if (start == null) continue;
        const sectors: Sectors<number | null> = [num(r.duration_sector_1), num(r.duration_sector_2), num(r.duration_sector_3)];
        const duration = num(r.lap_duration);
        const end: number | null = duration != null ? start + duration * 1000 : null;
        const sectorEnds: Sectors<number | null> = [null, null, null];
        let acc = start;
        for (let j = 0; j < 3; j++) {
          const s = sectors[j];
          if (s == null) break;
          acc += s * 1000;
          sectorEnds[j] = acc;
        }
        if (sectorEnds[2] == null && end != null && sectors[2] != null) sectorEnds[2] = end;
        entries.push({ t: start, end, number: r.lap_number!, duration, sectors, sectorEnds });
        sectors.forEach((value, j) => {
          const at = sectorEnds[j];
          if (value != null && at != null) this.sectorEvents.push({ t: at, driver, sector: j as 0 | 1 | 2, value });
        });
        if (duration != null && end != null) this.lapEvents.push({ t: end, driver, value: duration });
        prevEnd = end;
      }
      entries.sort((a, b) => a.t - b.t);
      this.laps.set(driver, entries);
    }
    this.sectorEvents.sort((a, b) => a.t - b.t);
    this.lapEvents.sort((a, b) => a.t - b.t);
  }

  /** OpenF1 has no retirement flag: a car that stops lapping well before the finish is out. */
  private inferRetirements(): void {
    let finish = -Infinity;
    const lastEnd = new Map<number, number>();
    for (const [driver, arr] of this.laps) {
      const ends = arr.map((l) => l.end).filter((e): e is number => e != null);
      if (!ends.length) continue;
      const e = Math.max(...ends);
      lastEnd.set(driver, e);
      finish = Math.max(finish, e);
    }
    if (!Number.isFinite(finish)) return;
    for (const [driver, e] of lastEnd) {
      if (e + 3 * RETIRE_GRACE_MS / 2 < finish) this.retireAt.set(driver, e + RETIRE_GRACE_MS);
    }
  }

  isRetired(driver: number, t: number): boolean {
    const st = latest(this.status.get(driver), t);
    if (st?.retired != null) return st.retired;
    const at = this.retireAt.get(driver);
    return at != null && t >= at;
  }

  computeHeavy(t: number): HeavyState {
    const bests = new SectorBests();
    for (const e of this.sectorEvents) {
      if (e.t > t) break;
      bests.record(e.driver, e.sector, e.value);
    }
    for (const e of this.lapEvents) {
      if (e.t > t) break;
      bests.recordLap(e.driver, e.value);
    }

    const drivers: Record<number, DriverState> = {};
    let leaderLap: number | null = null;
    for (const n of this.driverNumbers) {
      const d = this.driverState(n, t, bests);
      drivers[n] = d;
      if (d.lapNumber != null && !d.retired) leaderLap = Math.max(leaderLap ?? 0, d.lapNumber);
    }
    const order = [...this.driverNumbers].sort((a, b) => {
      const da = drivers[a], db = drivers[b];
      if (da.retired !== db.retired) return da.retired ? 1 : -1;
      return (da.position ?? 999) - (db.position ?? 999) || a - b;
    });

    const tail = <V,>(arr: Array<{ t: number; v: V }>): V[] => {
      const i = lastIndexAtOrBefore(arr, t);
      return arr.slice(Math.max(0, i - FEED_LIMIT + 1), i + 1).map((x) => x.v).reverse();
    };
    const wi = lastIndexAtOrBefore(this.weather, t);

    const total = this.totalLaps;
    return {
      drivers,
      order,
      radio: tail(this.radio),
      raceControl: tail(this.raceControl),
      weather: wi >= 0 ? this.weather[wi].v : null,
      lap: { current: leaderLap != null && total != null ? Math.min(leaderLap, total) : leaderLap, total },
      history: this.historyAt(t),
    };
  }

  private driverState(n: number, t: number, bests: SectorBests): DriverState {
    const info = this.driverInfo.get(n);
    const laps = this.laps.get(n) ?? [];
    const li = lastIndexAtOrBefore(laps, t);
    const cur = li >= 0 ? laps[li] : null;
    const prev = li >= 1 ? laps[li - 1] : null;

    let lastLap: number | null = null;
    for (let i = li; i >= 0; i--) {
      const l = laps[i];
      if (l.end != null && l.end <= t && l.duration != null) {
        lastLap = l.duration;
        break;
      }
    }

    const sectors: Sectors<number | null> = [null, null, null];
    for (let j = 0; j < 3; j++) {
      const end = cur?.sectorEnds[j];
      if (cur && end != null && end <= t) sectors[j] = cur.sectors[j];
      else if (prev) sectors[j] = prev.sectors[j];
    }

    const pos = latest(this.positions.get(n), t);
    const iv = latest(this.intervals.get(n), t);
    const lapNumber = cur?.number ?? null;

    const stint = this.stintFor(n, lapNumber);
    const age = this.tyreAge(stint, lapNumber);

    const pitRows = this.pits.get(n) ?? [];
    const pi = lastIndexAtOrBefore(pitRows, t);
    let pitStops: number | null = pi + 1;
    if (this.pits.size === 0) pitStops = stint?.stint_number != null ? stint.stint_number - 1 : null;
    const lastPit = pi >= 0 ? pitRows[pi] : null;
    const status = latest(this.status.get(n), t);
    const inPit =
      status?.in_pit ??
      (lastPit != null && t - lastPit.t <= (num(lastPit.v.pit_duration) ?? 25) * 1000);

    return {
      number: n,
      code: info?.name_acronym ?? String(n),
      name: info?.full_name ?? info?.broadcast_name ?? `Car ${n}`,
      team: info?.team_name ?? "--",
      teamColor: teamColor(info?.team_colour, info?.team_name),
      position: num(pos?.position),
      gapToLeader: iv?.gap_to_leader ?? null,
      interval: iv?.interval ?? null,
      lastLap,
      bestLap: bests.bestLap(n),
      lapNumber,
      sectors,
      sectorStatus: [
        bests.status(n, 0, sectors[0]),
        bests.status(n, 1, sectors[1]),
        bests.status(n, 2, sectors[2]),
      ],
      tyre: { compound: compoundCode(stint?.compound), age },
      pitStops: status?.pit_stops ?? pitStops,
      retired: this.isRetired(n, t),
      inPit: Boolean(inPit),
    };
  }

  // --- telemetry -----------------------------------------------------------

  private chunks = new Map<number, TelemetryChunk | "loading" | "error">();
  private onChunk: (() => void) | null = null;

  setChunkListener(fn: () => void): void {
    this.onChunk = fn;
  }

  private chunkIndex(t: number): number {
    return Math.floor((t - this.start) / this.ds.telemetry.chunkMs);
  }

  /** Make sure the chunks around `t` are loaded; evict far-away ones. */
  ensureTelemetry(t: number): void {
    const idx = this.chunkIndex(t);
    for (const i of [idx, idx + 1, idx - 1]) {
      if (i < 0 || this.chunks.has(i)) continue;
      const start = this.start + i * this.ds.telemetry.chunkMs;
      if (start > this.end) continue;
      this.chunks.set(i, "loading");
      this.ds.telemetry
        .loadChunk(start, start + this.ds.telemetry.chunkMs)
        .then((chunk) => {
          this.chunks.set(i, chunk);
          this.onChunk?.();
        })
        .catch(() => {
          // Leave a marker; retried after eviction or on the next seek.
          this.chunks.set(i, "error");
          setTimeout(() => this.chunks.get(i) === "error" && this.chunks.delete(i), 5000);
        });
    }
    for (const k of this.chunks.keys()) if (Math.abs(k - idx) > 3) this.chunks.delete(k);
  }

  isTelemetryLoading(t: number): boolean {
    return this.chunks.get(this.chunkIndex(t)) === "loading";
  }

  private chunkAt(i: number): TelemetryChunk | null {
    const c = this.chunks.get(i);
    return c && c !== "loading" && c !== "error" ? c : null;
  }

  telemetryAt(t: number, hidden: (driver: number) => boolean): { locations: Record<number, Point>; car: Record<number, CarTelemetry> } {
    const idx = this.chunkIndex(t);
    const here = this.chunkAt(idx);
    const before = this.chunkAt(idx - 1);
    const after = this.chunkAt(idx + 1);
    const locations: Record<number, Point> = {};
    const car: Record<number, CarTelemetry> = {};
    if (!here) return { locations, car };

    for (const [driver, arr] of here.location) {
      if (hidden(driver)) continue;
      const i = lastIndexAtOrBefore(arr, t);
      const a = i >= 0 ? arr[i] : before?.location.get(driver)?.at(-1);
      const b = i + 1 < arr.length ? arr[i + 1] : after?.location.get(driver)?.[0];
      if (a && b) locations[driver] = lerpSample(a, b, t, 5000);
      else if (a && t - a.t < 5000) locations[driver] = { x: a.x, y: a.y };
    }
    for (const [driver, arr] of here.car) {
      const i = lastIndexAtOrBefore(arr, t);
      const s = i >= 0 ? arr[i] : before?.car.get(driver)?.at(-1);
      if (s && t - s.t < 5000) car[driver] = { speed: s.speed, rpm: s.rpm, gear: s.gear, throttle: s.throttle, brake: s.brake, drs: s.drs };
    }
    return { locations, car };
  }
}
