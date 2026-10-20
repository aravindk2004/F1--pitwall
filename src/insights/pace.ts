// Lap-time analysis: which laps are representative, pit loss, and tyre degradation.

import type { LapRecord } from "../data/types";

/** Typical fuel-burn gain per lap (s). Added back so degradation reflects the tyres alone. */
export const FUEL_EFFECT_S_PER_LAP = 0.035;
/** Clean laps needed in a stint before degradation is reported. */
export const MIN_STINT_LAPS = 5;
/** Used until the race has produced a pit stop we can measure. */
export const DEFAULT_PIT_LOSS_S = 22;

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Least-squares line through (x, y); null with fewer than two distinct x values. */
export function linearFit(points: Array<[number, number]>): { slope: number; intercept: number } | null {
  if (points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0;
  for (const [x, y] of points) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/**
 * Laps run under safety car, VSC or red flag: the field's median time for that lap
 * is well above the race's typical lap.
 */
export function neutralisedLaps(history: Record<number, LapRecord[]>): Set<number> {
  const byLap = new Map<number, number[]>();
  for (const recs of Object.values(history)) {
    for (const r of recs) {
      if (r.time == null || r.lap <= 1) continue;
      const arr = byLap.get(r.lap) ?? [];
      arr.push(r.time);
      byLap.set(r.lap, arr);
    }
  }
  const lapMedians = [...byLap].map(([lap, times]) => [lap, median(times)!] as const);
  const typical = median(lapMedians.map(([, m]) => m));
  const out = new Set<number>([1]);
  if (typical == null) return out;
  for (const [lap, m] of lapMedians) {
    // A lone car's pit lap must not look like a safety car: need several cars on the lap.
    if (m > typical * 1.1 && (byLap.get(lap)?.length ?? 0) >= 3) out.add(lap);
  }
  return out;
}

/** A lap that reflects race pace: timed, not lap 1, no pit stop, not neutralised. */
export function isCleanLap(r: LapRecord, neutralised: Set<number>): boolean {
  return r.time != null && !r.pitIn && !r.pitOut && !neutralised.has(r.lap);
}

/**
 * Time lost making a pit stop: in-lap + out-lap compared with two normal laps,
 * taken as the median over every stop so far.
 */
export function estimatePitLoss(history: Record<number, LapRecord[]>): number | null {
  const neutralised = neutralisedLaps(history);
  const losses: number[] = [];
  for (const recs of Object.values(history)) {
    for (let i = 0; i < recs.length; i++) {
      const pin = recs[i];
      const pout = recs[i + 1];
      if (!pin.pitIn || !pout || pin.time == null || pout.time == null) continue;
      if (neutralised.has(pin.lap) || neutralised.has(pout.lap)) continue;
      const nearby = recs
        .filter((r) => Math.abs(r.lap - pin.lap) <= 6 && isCleanLap(r, neutralised))
        .map((r) => r.time!);
      const ref = median(nearby);
      if (ref == null) continue;
      const loss = pin.time + pout.time - 2 * ref;
      if (loss > 8 && loss < 60) losses.push(loss);
    }
  }
  return median(losses);
}

export interface StintPace {
  compound: string | null;
  /** Laps completed on this set of tyres. */
  age: number | null;
  /** Clean laps used for the fit. */
  laps: number;
  /** Seconds lost per lap from tyre wear (fuel effect removed); null with too few laps. */
  degradation: number | null;
  /** Average clean lap time in this stint. */
  average: number | null;
  /** The last two laps are well slower than the trend: the tyres are going off. */
  cliff: boolean;
  /** Clean laps as [tyre age, lap time], for charts. */
  points: Array<[number, number]>;
}

/** Degradation of a driver's current stint. */
export function stintPace(records: LapRecord[], neutralised: Set<number>): StintPace | null {
  if (!records.length) return null;
  // The current stint is everything since the last out-lap (or compound change).
  let start = 0;
  for (let i = records.length - 1; i > 0; i--) {
    if (records[i].pitOut || records[i].compound !== records[i - 1].compound) {
      start = i;
      break;
    }
  }
  const stint = records.slice(start);
  const last = stint[stint.length - 1];
  const clean = stint.filter((r) => isCleanLap(r, neutralised) && r.tyreAge != null);
  const med = median(clean.map((r) => r.time!));
  // Drop laps spoiled by traffic, mistakes or yellow flags.
  const points = clean
    .filter((r) => med == null || r.time! < med * 1.04)
    .map((r) => [r.tyreAge!, r.time!] as [number, number]);
  const fit = points.length >= MIN_STINT_LAPS ? linearFit(points) : null;
  let cliff = false;
  if (points.length >= 6) {
    // Compare the last two laps with the trend of the laps before them.
    const early = linearFit(points.slice(0, -2));
    cliff = early != null && points.slice(-2).every(([x, y]) => y - (early.intercept + early.slope * x) > 0.5);
  }
  return {
    compound: last.compound,
    age: last.tyreAge,
    laps: points.length,
    degradation: fit ? fit.slope + FUEL_EFFECT_S_PER_LAP : null,
    average: points.length ? points.reduce((s, p) => s + p[1], 0) / points.length : null,
    cliff,
    points,
  };
}
