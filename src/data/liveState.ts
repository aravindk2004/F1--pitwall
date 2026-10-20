// Incrementally merges bridge messages into one state keyed by driver number.

import type {
  CarTelemetry,
  DriverState,
  F1Snapshot,
  LapRecord,
  RaceControlMessage,
  RadioMessage,
  SectorStatus,
  SessionInfo,
  Topic,
  TrackLayout,
  Weather,
} from "./types";
import {
  compoundCode,
  num,
  parseDate,
  teamColor,
  type RawCarData,
  type RawDriver,
  type RawDriverStatus,
  type RawInterval,
  type RawLap,
  type RawLapCount,
  type RawLocation,
  type RawPit,
  type RawPosition,
  type RawRaceControl,
  type RawRadio,
  type RawStint,
  type RawWeather,
} from "./records";
import { SectorBests } from "./sectors";
import { LocationInterpolator } from "./interpolate";
import { buildTrack, extent, type DrsSample, type TrackSample } from "./track";

const FEED_LIMIT = 40;

type AnyRecord = Record<string, unknown>;

function blankDriver(n: number): DriverState {
  return {
    number: n,
    code: String(n),
    name: `Car ${n}`,
    team: "--",
    teamColor: teamColor(null),
    position: null,
    gapToLeader: null,
    interval: null,
    lastLap: null,
    bestLap: null,
    lapNumber: null,
    sectors: [null, null, null],
    sectorStatus: [null, null, null],
    tyre: { compound: null, age: null },
    pitStops: null,
    retired: false,
    inPit: false,
  };
}

const has = (r: AnyRecord, key: string) => Object.prototype.hasOwnProperty.call(r, key);

/** Collects one lap of the reference car's trace to draw the circuit. */
class LiveTrackBuilder {
  ref: number | null = null;
  private samples: TrackSample[] = [];
  private drs: DrsSample[] = [];
  private boundaries: number[] = [];
  private lastLap: number | null = null;
  done = false;

  addLocation(driver: number, s: TrackSample): TrackLayout | null {
    if (this.done) return null;
    if (this.ref == null) this.ref = driver;
    if (driver !== this.ref) return null;
    this.samples.push(s);
    if (this.samples.length > 20_000) this.samples.splice(0, 5_000);
    return this.tryClosure();
  }

  addDrs(driver: number, s: DrsSample): void {
    if (!this.done && driver === this.ref) this.drs.push(s);
  }

  addLap(driver: number, lap: number | null): TrackLayout | null {
    if (this.done || driver !== this.ref || lap == null || lap === this.lastLap) return null;
    this.lastLap = lap;
    const t = this.samples[this.samples.length - 1]?.t;
    if (t == null) return null;
    this.boundaries.push(t);
    if (this.boundaries.length < 2) return null;
    const [a, b] = this.boundaries.slice(-2);
    return this.finish(this.samples.filter((s) => s.t >= a && s.t <= b));
  }

  /** Fallback when no lap info arrives: detect the trace returning to its start. */
  private tryClosure(): TrackLayout | null {
    const n = this.samples.length;
    if (n < 200 || n % 25 !== 0) return null;
    const first = this.samples[0];
    const last = this.samples[n - 1];
    if (last.t - first.t < 60_000) return null;
    const box = extent(this.samples);
    if (Math.hypot(last.x - first.x, last.y - first.y) > Math.max(box.w, box.h) * 0.02) return null;
    return this.finish(this.samples);
  }

  private finish(lap: TrackSample[]): TrackLayout | null {
    const layout = buildTrack(lap, this.drs);
    if (layout) {
      this.done = true;
      this.samples = [];
      this.drs = [];
    }
    return layout;
  }
}

export class LiveState {
  private drivers = new Map<number, DriverState>();
  private stints = new Map<number, Map<number, RawStint>>();
  private pitDates = new Map<number, Set<string>>();
  private sectorFlags = new Map<number, Array<SectorStatus | undefined>>();
  private bests = new SectorBests();
  private car: Record<number, CarTelemetry> = {};
  private radio: RadioMessage[] = [];
  private raceControl: RaceControlMessage[] = [];
  private weather: Weather | null = null;
  private session: SessionInfo | null = null;
  private lap: { current: number | null; total: number | null } = { current: null, total: null };
  private track: TrackLayout | null = null;
  private trackBuilder = new LiveTrackBuilder();
  /** Kept for a minute so the pit-rejoin ghost can look ~25 s into the past. */
  readonly locations = new LocationInterpolator(5000, 60_000);
  private history: Record<number, LapRecord[]> = {};
  private pitFlags = new Map<number, { pitIn: boolean; pitOut: boolean }>();
  /** Smoothed delay between a sample's feed timestamp and its arrival. */
  latency: number | null = null;

  apply(topic: Topic | string, data: unknown): boolean {
    if (data == null || typeof data !== "object") return false;
    if (Array.isArray(data)) {
      let changed = false;
      for (const item of data) changed = this.apply(topic, item) || changed;
      return changed;
    }
    const r = data as AnyRecord;
    switch (topic) {
      case "drivers":
        return this.applyDriver(r as unknown as RawDriver);
      case "position":
        return this.patchDriver(r, (d, rec: RawPosition) => {
          if (has(r, "position")) d.position = num(rec.position);
        });
      case "intervals":
        return this.patchDriver(r, (d, rec: RawInterval) => {
          if (has(r, "gap_to_leader")) d.gapToLeader = rec.gap_to_leader ?? null;
          if (has(r, "interval")) d.interval = rec.interval ?? null;
        });
      case "laps":
        return this.applyLap(r as unknown as RawLap, r);
      case "stints":
        return this.applyStint(r as unknown as RawStint);
      case "pit":
        return this.applyPit(r as unknown as RawPit);
      case "driver_status":
        return this.patchDriver(r, (d, rec: RawDriverStatus) => {
          if (rec.retired != null) d.retired = rec.retired;
          if (rec.in_pit != null) {
            // Entering the pits marks the lap being run as an in-lap, leaving marks the next as an out-lap.
            const flags = this.pitFlags.get(d.number) ?? { pitIn: false, pitOut: false };
            if (rec.in_pit && !d.inPit) flags.pitIn = true;
            if (!rec.in_pit && d.inPit) flags.pitOut = true;
            this.pitFlags.set(d.number, flags);
            d.inPit = rec.in_pit;
          }
          if (rec.pit_stops != null) d.pitStops = rec.pit_stops;
        });
      case "car_data":
        return this.applyCar(r as unknown as RawCarData);
      case "location":
        return this.applyLocation(r as unknown as RawLocation);
      case "team_radio":
        return this.applyRadio(r as unknown as RawRadio);
      case "race_control":
        return this.applyRaceControl(r as unknown as RawRaceControl);
      case "weather":
        return this.applyWeather(r as unknown as RawWeather);
      case "session":
        this.session = {
          key: (r.session_key as number | undefined) ?? null,
          name: String(r.meeting_name ?? r.session_name ?? "Live session"),
          place: r.location != null ? String(r.location) : null,
          circuit: String(r.circuit_short_name ?? r.location ?? "--"),
          country: String(r.country_name ?? "--"),
          year: num(r.year),
          session: r.session_name != null ? String(r.session_name) : null,
          date: parseDate(r.date_start as string | null | undefined),
        };
        return true;
      case "lap_count": {
        const lc = r as RawLapCount;
        this.lap = { current: num(lc.current_lap) ?? this.lap.current, total: num(lc.total_laps) ?? this.lap.total };
        return true;
      }
      default:
        return false;
    }
  }

  private mutable(n: number): DriverState {
    const prev = this.drivers.get(n) ?? blankDriver(n);
    const copy = { ...prev, sectors: [...prev.sectors] as DriverState["sectors"], sectorStatus: [...prev.sectorStatus] as DriverState["sectorStatus"], tyre: { ...prev.tyre } };
    this.drivers.set(n, copy);
    return copy;
  }

  private patchDriver<R>(r: AnyRecord, fn: (d: DriverState, rec: R) => void): boolean {
    const n = num(r.driver_number);
    if (n == null) return false;
    fn(this.mutable(n), r as unknown as R);
    return true;
  }

  private applyDriver(r: RawDriver): boolean {
    const n = num(r.driver_number);
    if (n == null) return false;
    const d = this.mutable(n);
    if (r.name_acronym) d.code = r.name_acronym;
    if (r.full_name || r.broadcast_name) d.name = (r.full_name ?? r.broadcast_name)!;
    if (r.team_name) d.team = r.team_name;
    if (r.team_colour || r.team_name) d.teamColor = teamColor(r.team_colour, r.team_name);
    return true;
  }

  private applyLap(r: RawLap, raw: AnyRecord): boolean {
    const n = num(r.driver_number);
    if (n == null) return false;
    const d = this.mutable(n);
    if (has(raw, "lap_number") && r.lap_number != null) {
      d.lapNumber = r.lap_number;
      const layout = this.trackBuilder.addLap(n, r.lap_number);
      if (layout) this.track = layout;
      this.refreshTyre(n, d);
    }
    if (has(raw, "lap_duration") && r.lap_duration != null) {
      d.lastLap = r.lap_duration;
      this.bests.recordLap(n, r.lap_duration);
      d.bestLap = this.bests.bestLap(n);
    }
    const keys = ["duration_sector_1", "duration_sector_2", "duration_sector_3"] as const;
    keys.forEach((k, j) => {
      if (!has(raw, k)) return;
      const v = num(r[k]);
      d.sectors[j] = v;
      this.bests.record(n, j as 0 | 1 | 2, v);
    });
    if (Array.isArray(r.sector_flags)) {
      const flags = this.sectorFlags.get(n) ?? [];
      r.sector_flags.forEach((f, j) => {
        if (j < 3) flags[j] = f ?? undefined;
      });
      this.sectorFlags.set(n, flags);
    }
    // An overall best can demote everyone else's purple, so recolour all cars.
    for (const [num_, drv] of this.drivers) {
      const flags = this.sectorFlags.get(num_);
      const next = drv.sectors.map((v, j) =>
        v == null ? null : (flags?.[j] ?? this.bests.status(num_, j as 0 | 1 | 2, v)),
      ) as DriverState["sectorStatus"];
      if (next.some((s, j) => s !== drv.sectorStatus[j])) {
        const copy = num_ === n ? d : this.mutable(num_);
        copy.sectorStatus = next;
      }
    }
    // OpenF1 sends a lap when it starts (no time yet) and again when complete; record completed laps only.
    if (r.lap_duration != null) this.recordLap(n, d, r);
    return true;
  }

  private recordLap(n: number, d: DriverState, r: RawLap): void {
    const lap = r.lap_number ?? d.lapNumber;
    const prev = this.history[n] ?? [];
    if (lap == null || (prev.length && prev[prev.length - 1].lap >= lap)) return;
    const flags = this.pitFlags.get(n) ?? { pitIn: false, pitOut: false };
    const record: LapRecord = {
      lap,
      end: parseDate(r.date) ?? Date.now(),
      time: num(r.lap_duration),
      sectors: [...d.sectors] as LapRecord["sectors"],
      compound: d.tyre.compound,
      tyreAge: d.tyre.age,
      position: d.position,
      gap: typeof d.gapToLeader === "number" ? d.gapToLeader : null,
      pitIn: flags.pitIn || d.inPit,
      pitOut: flags.pitOut,
    };
    // A car that pitted on this lap starts the next lap as an out-lap.
    this.pitFlags.set(n, { pitIn: false, pitOut: flags.pitIn && !d.inPit ? true : false });
    this.history = { ...this.history, [n]: [...prev, record] };
  }

  private applyStint(r: RawStint): boolean {
    const n = num(r.driver_number);
    if (n == null) return false;
    const map = this.stints.get(n) ?? new Map<number, RawStint>();
    const key = r.stint_number ?? map.size + 1;
    map.set(key, { ...map.get(key), ...r });
    this.stints.set(n, map);
    this.refreshTyre(n, this.mutable(n));
    return true;
  }

  private refreshTyre(n: number, d: DriverState): void {
    const map = this.stints.get(n);
    if (!map || map.size === 0) return;
    const latestKey = Math.max(...map.keys());
    const s = map.get(latestKey)!;
    d.tyre.compound = compoundCode(s.compound);
    const base = num(s.tyre_age_at_start);
    d.tyre.age =
      base == null ? null : s.lap_start != null && d.lapNumber != null ? base + Math.max(0, d.lapNumber - s.lap_start) : base;
    if (d.pitStops == null) d.pitStops = Math.max(0, latestKey - 1);
  }

  private applyPit(r: RawPit): boolean {
    const n = num(r.driver_number);
    if (n == null) return false;
    const seen = this.pitDates.get(n) ?? new Set<string>();
    const id = r.date ?? String(r.lap_number ?? seen.size);
    if (seen.has(id)) return false;
    seen.add(id);
    this.pitDates.set(n, seen);
    this.mutable(n).pitStops = seen.size;
    return true;
  }

  private applyCar(r: RawCarData): boolean {
    const n = num(r.driver_number);
    if (n == null) return false;
    const prev = this.car[n];
    const pick = (k: keyof RawCarData, fallback: number | null | undefined) =>
      Object.prototype.hasOwnProperty.call(r, k) ? num(r[k]) : (fallback ?? null);
    this.car = {
      ...this.car,
      [n]: {
        speed: pick("speed", prev?.speed),
        rpm: pick("rpm", prev?.rpm),
        gear: pick("n_gear", prev?.gear),
        throttle: pick("throttle", prev?.throttle),
        brake: pick("brake", prev?.brake),
        drs: pick("drs", prev?.drs),
      },
    };
    const t = parseDate(r.date) ?? Date.now();
    this.trackBuilder.addDrs(n, { t, drs: num(r.drs) });
    return true;
  }

  private applyLocation(r: RawLocation): boolean {
    const n = num(r.driver_number);
    const x = num(r.x), y = num(r.y);
    if (n == null || x == null || y == null || (x === 0 && y === 0)) return false;
    const now = Date.now();
    const t = parseDate(r.date) ?? now;
    const lat = now - t;
    this.latency = this.latency == null ? lat : this.latency * 0.95 + lat * 0.05;
    this.locations.push(n, t, x, y);
    const layout = this.trackBuilder.addLocation(n, { t, x, y });
    if (layout) this.track = layout;
    return layout != null;
  }

  private applyRadio(r: RawRadio): boolean {
    const t = parseDate(r.date) ?? Date.now();
    const n = num(r.driver_number);
    if (!r.recording_url || n == null) return false;
    const id = `${n}-${t}`;
    if (this.radio.some((m) => m.id === id)) return false;
    this.radio = [{ id, date: t, driverNumber: n, url: r.recording_url }, ...this.radio]
      .sort((a, b) => b.date - a.date)
      .slice(0, FEED_LIMIT);
    return true;
  }

  private applyRaceControl(r: RawRaceControl): boolean {
    const t = parseDate(r.date) ?? Date.now();
    const id = `${t}-${r.message ?? ""}`;
    if (this.raceControl.some((m) => m.id === id)) return false;
    const msg: RaceControlMessage = {
      id,
      date: t,
      category: r.category ?? null,
      flag: r.flag ?? null,
      message: r.message ?? "",
      lap: num(r.lap_number),
    };
    this.raceControl = [msg, ...this.raceControl].sort((a, b) => b.date - a.date).slice(0, FEED_LIMIT);
    return true;
  }

  private applyWeather(r: RawWeather): boolean {
    const prev = this.weather;
    const pick = (k: keyof RawWeather, p: number | null | undefined) => (has(r as AnyRecord, k) ? num(r[k]) : (p ?? null));
    this.weather = {
      airTemp: pick("air_temperature", prev?.airTemp),
      trackTemp: pick("track_temperature", prev?.trackTemp),
      humidity: pick("humidity", prev?.humidity),
      rainfall: pick("rainfall", prev?.rainfall),
      windSpeed: pick("wind_speed", prev?.windSpeed),
      windDirection: pick("wind_direction", prev?.windDirection),
    };
    return true;
  }

  /** Assemble the slow-changing parts of the snapshot. */
  build(base: F1Snapshot): F1Snapshot {
    const drivers: Record<number, DriverState> = {};
    for (const [n, d] of this.drivers) drivers[n] = d;
    const order = [...this.drivers.keys()].sort((a, b) => {
      const da = drivers[a], db = drivers[b];
      if (da.retired !== db.retired) return da.retired ? 1 : -1;
      return (da.position ?? 999) - (db.position ?? 999) || a - b;
    });
    let leaderLap: number | null = null;
    for (const d of this.drivers.values()) if (d.lapNumber != null) leaderLap = Math.max(leaderLap ?? 0, d.lapNumber);
    return {
      ...base,
      session: this.session,
      lap: { current: this.lap.current ?? leaderLap, total: this.lap.total },
      drivers,
      order,
      car: this.car,
      radio: this.radio,
      raceControl: this.raceControl,
      weather: this.weather,
      track: this.track,
      history: this.history,
    };
  }

  isRetired(n: number): boolean {
    return this.drivers.get(n)?.retired ?? false;
  }
}
