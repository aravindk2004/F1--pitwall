// Wire-level record shapes. These follow the OpenF1 schema, and the Python
// bridge emits the same shapes, so one set of helpers handles both sources.

export interface RawDriver {
  driver_number: number;
  name_acronym?: string | null;
  full_name?: string | null;
  broadcast_name?: string | null;
  team_name?: string | null;
  team_colour?: string | null;
}

export interface RawSession {
  session_key: number;
  meeting_key?: number | null;
  session_name?: string | null;
  session_type?: string | null;
  date_start?: string | null;
  date_end?: string | null;
  location?: string | null;
  country_name?: string | null;
  circuit_short_name?: string | null;
  year?: number | null;
}

export interface RawLap {
  driver_number: number;
  lap_number?: number | null;
  date_start?: string | null;
  lap_duration?: number | null;
  duration_sector_1?: number | null;
  duration_sector_2?: number | null;
  duration_sector_3?: number | null;
  is_pit_out_lap?: boolean | null;
  /** Bridge only: when the timing update arrived. */
  date?: string | null;
  /** Bridge only: sector colours as reported by the official feed. */
  sector_flags?: Array<"purple" | "green" | "yellow" | null> | null;
}

export interface RawPosition {
  driver_number: number;
  date?: string | null;
  position?: number | null;
}

export interface RawInterval {
  driver_number: number;
  date?: string | null;
  gap_to_leader?: number | string | null;
  interval?: number | string | null;
}

export interface RawCarData {
  driver_number: number;
  date?: string | null;
  speed?: number | null;
  rpm?: number | null;
  n_gear?: number | null;
  throttle?: number | null;
  brake?: number | null;
  drs?: number | null;
}

export interface RawLocation {
  driver_number: number;
  date?: string | null;
  x?: number | null;
  y?: number | null;
  z?: number | null;
}

export interface RawStint {
  driver_number: number;
  stint_number?: number | null;
  compound?: string | null;
  lap_start?: number | null;
  lap_end?: number | null;
  tyre_age_at_start?: number | null;
}

export interface RawPit {
  driver_number: number;
  date?: string | null;
  lap_number?: number | null;
  pit_duration?: number | null;
}

export interface RawRadio {
  driver_number: number;
  date?: string | null;
  recording_url?: string | null;
}

export interface RawRaceControl {
  date?: string | null;
  category?: string | null;
  flag?: string | null;
  message?: string | null;
  lap_number?: number | null;
  driver_number?: number | null;
}

export interface RawWeather {
  date?: string | null;
  air_temperature?: number | null;
  track_temperature?: number | null;
  humidity?: number | null;
  rainfall?: number | null;
  wind_speed?: number | null;
  wind_direction?: number | null;
}

export interface RawMeeting {
  meeting_key: number;
  meeting_name?: string | null;
  meeting_official_name?: string | null;
  circuit_short_name?: string | null;
  location?: string | null;
  country_name?: string | null;
  year?: number | null;
}

/** Not part of OpenF1: emitted by the bridge and the mock generator. */
export interface RawDriverStatus {
  driver_number: number;
  date?: string | null;
  retired?: boolean | null;
  in_pit?: boolean | null;
  pit_stops?: number | null;
}

export interface RawLapCount {
  current_lap?: number | null;
  total_laps?: number | null;
}

/** Parse an ISO date (OpenF1 uses microseconds, which some engines reject). */
export function parseDate(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.replace(/(\.\d{3})\d+/, "$1");
  const withZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed) ? trimmed : `${trimmed}Z`;
  const t = Date.parse(withZone);
  return Number.isFinite(t) ? t : null;
}

export function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function teamColor(raw: string | null | undefined, teamName?: string | null): string {
  if (raw && /^#?[0-9a-fA-F]{6}$/.test(raw)) return raw.startsWith("#") ? raw : `#${raw}`;
  const fallback: Record<string, string> = {
    "red bull racing": "#3671C6",
    ferrari: "#E8002D",
    mercedes: "#27F4D2",
    mclaren: "#FF8000",
    "aston martin": "#229971",
    alpine: "#FF87BC",
    williams: "#64C4FF",
    "racing bulls": "#6692FF",
    rb: "#6692FF",
    "kick sauber": "#52E252",
    sauber: "#52E252",
    haas: "#B6BABD",
    "haas f1 team": "#B6BABD",
    cadillac: "#C9B37E",
    audi: "#BB0A30",
  };
  return fallback[(teamName ?? "").toLowerCase()] ?? "#8a8a96";
}

/** Insert into a sorted-by-`t` array, keeping order. */
export function insertSorted<T extends { t: number }>(arr: T[], item: T): void {
  if (arr.length === 0 || arr[arr.length - 1].t <= item.t) {
    arr.push(item);
    return;
  }
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t <= item.t) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, item);
}

/** Index of the last element with t <= time, or -1. */
export function lastIndexAtOrBefore<T extends { t: number }>(arr: T[], time: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t <= time) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function compoundCode(compound: string | null | undefined): string | null {
  if (!compound) return null;
  const c = compound.toUpperCase();
  if (c.startsWith("SOFT")) return "SOFT";
  if (c.startsWith("MED")) return "MEDIUM";
  if (c.startsWith("HARD")) return "HARD";
  if (c.startsWith("INTER")) return "INTERMEDIATE";
  if (c.startsWith("WET")) return "WET";
  return c === "UNKNOWN" || c === "TEST_UNKNOWN" ? null : c;
}
