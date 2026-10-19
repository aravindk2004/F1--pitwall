import type { Point } from "./types";
import { insertSorted, lastIndexAtOrBefore } from "./records";

interface Sample {
  t: number;
  x: number;
  y: number;
}

/** Linear interpolation of 2D samples so cars glide between updates. */
export class LocationInterpolator {
  private series = new Map<number, Sample[]>();

  constructor(
    /** Samples further apart than this are not interpolated across. */
    private maxGapMs = 5000,
    /** Samples older than this (relative to the newest) are dropped. */
    private retainMs = 60_000,
  ) {}

  push(driver: number, t: number, x: number, y: number): void {
    let arr = this.series.get(driver);
    if (!arr) {
      arr = [];
      this.series.set(driver, arr);
    }
    insertSorted(arr, { t, x, y });
    const cutoff = arr[arr.length - 1].t - this.retainMs;
    if (arr[0].t < cutoff) {
      const drop = lastIndexAtOrBefore(arr, cutoff);
      if (drop > 0) arr.splice(0, drop);
    }
  }

  sample(driver: number, t: number): Point | null {
    const arr = this.series.get(driver);
    if (!arr || arr.length === 0) return null;
    return interpolateSamples(arr, t, this.maxGapMs);
  }

  sampleAll(t: number): Record<number, Point> {
    const out: Record<number, Point> = {};
    for (const [driver, arr] of this.series) {
      const p = interpolateSamples(arr, t, this.maxGapMs);
      if (p) out[driver] = p;
    }
    return out;
  }

  latestTime(): number | null {
    let latest: number | null = null;
    for (const arr of this.series.values()) {
      const t = arr[arr.length - 1]?.t;
      if (t != null && (latest == null || t > latest)) latest = t;
    }
    return latest;
  }

  clear(): void {
    this.series.clear();
  }
}

export function interpolateSamples(arr: Sample[], t: number, maxGapMs: number): Point | null {
  const i = lastIndexAtOrBefore(arr, t);
  if (i < 0) {
    const first = arr[0];
    return first && first.t - t < maxGapMs ? { x: first.x, y: first.y } : null;
  }
  const a = arr[i];
  const b = arr[i + 1];
  if (!b) return t - a.t < maxGapMs ? { x: a.x, y: a.y } : null;
  return lerpSample(a, b, t, maxGapMs);
}

export function lerpSample(a: Sample, b: Sample, t: number, maxGapMs: number): Point {
  const span = b.t - a.t;
  if (span <= 0 || span > maxGapMs) return { x: a.x, y: a.y };
  const k = Math.min(1, Math.max(0, (t - a.t) / span));
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}
