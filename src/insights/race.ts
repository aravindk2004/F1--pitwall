// Gap trends, battles and pit-stop rejoin predictions.

import type { DriverState, LapRecord } from "../data/types";
import { linearFit } from "./pace";

/** Within this many seconds of the car ahead counts as a battle. */
export const BATTLE_GAP_S = 1.0;
/** Changes in the gap smaller than this per lap are treated as holding station. */
const TREND_THRESHOLD_S = 0.05;
const MAX_CATCH_LAPS = 20;

const numeric = (v: number | string | null | undefined): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^\+?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
};

export interface GapTrend {
  driver: number;
  ahead: number | null;
  /** Current gap to the car ahead (s). */
  interval: number | null;
  /** Change in that gap per lap over recent laps; negative = closing. */
  ratePerLap: number | null;
  /** Laps until within a second, when closing. */
  lapsToCatch: number | null;
  battle: boolean;
}

/**
 * How the gap to the car ahead has moved over the last few laps, from the gap
 * to the leader each car had when crossing the line.
 */
export function gapTrends(
  order: number[],
  drivers: Record<number, DriverState>,
  history: Record<number, LapRecord[]>,
  window = 5,
): Record<number, GapTrend> {
  const running = order.filter((n) => drivers[n] && !drivers[n].retired);
  const out: Record<number, GapTrend> = {};
  running.forEach((n, i) => {
    const ahead = i > 0 ? running[i - 1] : null;
    const interval = numeric(drivers[n].interval);
    let ratePerLap: number | null = null;
    if (ahead != null) {
      const mine = new Map((history[n] ?? []).map((r) => [r.lap, r.gap]));
      const theirs = new Map((history[ahead] ?? []).map((r) => [r.lap, r.gap]));
      const pts: Array<[number, number]> = [];
      for (const [lap, g] of mine) {
        const a = theirs.get(lap);
        if (g != null && a != null) pts.push([lap, g - a]);
      }
      pts.sort((a, b) => a[0] - b[0]);
      const recent = pts.slice(-window);
      // A pit stop by either car makes the gap jump; only use the run since then.
      const steady: Array<[number, number]> = [];
      for (const p of recent) {
        if (steady.length && Math.abs(p[1] - steady[steady.length - 1][1]) > 8) steady.length = 0;
        steady.push(p);
      }
      const fit = steady.length >= 3 ? linearFit(steady) : null;
      ratePerLap = fit ? fit.slope : null;
    }
    const closing = ratePerLap != null && ratePerLap < -TREND_THRESHOLD_S;
    const lapsToCatch =
      closing && interval != null && interval > BATTLE_GAP_S ? Math.ceil((interval - BATTLE_GAP_S) / -ratePerLap!) : null;
    out[n] = {
      driver: n,
      ahead,
      interval,
      ratePerLap,
      // Beyond ~20 laps the projection is noise.
      lapsToCatch: lapsToCatch != null && lapsToCatch <= MAX_CATCH_LAPS ? lapsToCatch : null,
      battle: ahead != null && interval != null && interval <= BATTLE_GAP_S,
    };
  });
  return out;
}

export interface PitPrediction {
  driver: number;
  pitLoss: number;
  /** Position the car would rejoin in if it pitted now. */
  rejoinPosition: number;
  /** Cars it would rejoin directly behind and ahead of, with the margin in seconds. */
  carAhead: { driver: number; margin: number } | null;
  carBehind: { driver: number; margin: number } | null;
  /** Rejoining within 1.5 s behind a car: likely to be held up. */
  traffic: boolean;
  /** Rejoining less than a second ahead of a car: likely to be attacked on cold tyres. */
  pressure: boolean;
}

/** Where a car would come out if it made a pit stop now. */
export function predictPitStop(
  driver: number,
  order: number[],
  drivers: Record<number, DriverState>,
  pitLoss: number,
): PitPrediction | null {
  const d = drivers[driver];
  if (!d || d.retired) return null;
  const gapOf = (n: number): number | null => {
    const dr = drivers[n];
    if (!dr || dr.retired) return null;
    if (dr.position === 1) return 0;
    return numeric(dr.gapToLeader);
  };
  const mine = gapOf(driver);
  if (mine == null) return null;
  const projected = mine + pitLoss;
  // Lapped cars and cars without a time gap are left out.
  const others = order
    .filter((n) => n !== driver)
    .map((n) => ({ n, gap: gapOf(n) }))
    .filter((x): x is { n: number; gap: number } => x.gap != null);
  const ahead = others.filter((x) => x.gap <= projected).sort((a, b) => b.gap - a.gap);
  const behind = others.filter((x) => x.gap > projected).sort((a, b) => a.gap - b.gap);
  const carAhead = ahead[0] ? { driver: ahead[0].n, margin: projected - ahead[0].gap } : null;
  const carBehind = behind[0] ? { driver: behind[0].n, margin: behind[0].gap - projected } : null;
  return {
    driver,
    pitLoss,
    rejoinPosition: ahead.length + 1,
    carAhead,
    carBehind,
    traffic: carAhead != null && carAhead.margin < 1.5,
    pressure: carBehind != null && carBehind.margin < 1.0,
  };
}
