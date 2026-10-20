import type { Point, TrackLayout } from "./types";
import { lastIndexAtOrBefore } from "./records";

export interface TrackSample {
  t: number;
  x: number;
  y: number;
}

export interface DrsSample {
  t: number;
  drs: number | null;
}

/** DRS channel values of 10, 12 and 14 mean the flap is open. */
export const isDrsOpen = (drs: number | null | undefined): boolean => drs != null && drs >= 10;

/**
 * Build a track outline from one lap of location samples. DRS zones are the
 * stretches where the reference car had DRS open during that lap.
 */
export function buildTrack(lap: TrackSample[], drs: DrsSample[] = []): TrackLayout | null {
  const clean = lap
    .filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && !(s.x === 0 && s.y === 0))
    .sort((a, b) => a.t - b.t);
  if (clean.length < 20) return null;

  // Thin out points that sit almost on top of each other.
  const span = extent(clean);
  const minStep = Math.max(span.w, span.h) / 600;
  const kept: TrackSample[] = [clean[0]];
  for (const s of clean) {
    const last = kept[kept.length - 1];
    if (Math.hypot(s.x - last.x, s.y - last.y) >= minStep) kept.push(s);
  }
  if (kept.length < 20) return null;

  const drsSorted = [...drs].sort((a, b) => a.t - b.t);
  const open = kept.map((s) => {
    const i = lastIndexAtOrBefore(drsSorted, s.t);
    return i >= 0 && s.t - drsSorted[i].t < 3000 && isDrsOpen(drsSorted[i].drs);
  });

  const zones: Array<[number, number]> = [];
  let startIdx = -1;
  open.forEach((isOpen, i) => {
    if (isOpen && startIdx < 0) startIdx = i;
    if ((!isOpen || i === open.length - 1) && startIdx >= 0) {
      const end = isOpen ? i : i - 1;
      if (end - startIdx >= 2) zones.push([startIdx, end]);
      startIdx = -1;
    }
  });

  return { points: kept.map(({ x, y }) => ({ x, y })), drsZones: zones };
}

export function extent(points: Point[]): { minX: number; minY: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, w: 1, h: 1 };
  return { minX, minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

export interface TrackGeometry {
  /** Fraction of the lap (0–1) at the point of the circuit nearest to `p`. */
  fractionOf(p: Point): number | null;
}

/** Lap-distance lookups along a circuit outline. */
export function trackGeometry(layout: TrackLayout | null): TrackGeometry | null {
  if (!layout || layout.points.length < 10) return null;
  const pts = layout.points;
  let frac: number[];
  if (layout.rel && layout.rel.length === pts.length) {
    frac = layout.rel;
  } else {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = cum[cum.length - 1] + Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
    frac = cum.map((c) => c / (total || 1));
  }
  const box = extent(pts);
  const maxDist = Math.max(box.w, box.h) * 0.08;
  return {
    fractionOf(p) {
      let best = -1, bestD = Infinity, bestW = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy || 1;
        const w = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
        const d = Math.hypot(a.x + dx * w - p.x, a.y + dy * w - p.y);
        if (d < bestD) {
          bestD = d;
          best = i;
          bestW = w;
        }
      }
      if (best < 0 || bestD > maxDist) return null;
      const f0 = frac[best];
      let f1 = best + 1 < frac.length ? frac[best + 1] : 1;
      if (f1 < f0) f1 += 1;
      return (f0 + (f1 - f0) * bestW) % 1;
    },
  };
}
