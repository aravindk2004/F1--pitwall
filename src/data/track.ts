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
