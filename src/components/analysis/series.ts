import type { DriverState, LapRecord } from "../../data/types";
import type { Series } from "./LineChart";

/** The higher-numbered driver of each team is drawn dashed, as F1 graphics do. */
export function dashedDrivers(drivers: Record<number, DriverState>): Set<number> {
  const byTeam = new Map<string, number[]>();
  for (const d of Object.values(drivers)) {
    const arr = byTeam.get(d.team) ?? [];
    arr.push(d.number);
    byTeam.set(d.team, arr);
  }
  const out = new Set<number>();
  for (const nums of byTeam.values()) nums.sort((a, b) => a - b).slice(1).forEach((n) => out.add(n));
  return out;
}

export function buildSeries(
  order: number[],
  drivers: Record<number, DriverState>,
  history: Record<number, LapRecord[]>,
  focus: Set<number>,
  pick: (r: LapRecord) => number | null,
): Series[] {
  const dashed = dashedDrivers(drivers);
  return order
    .filter((n) => drivers[n])
    .map((n) => ({
      id: n,
      label: drivers[n].code,
      color: drivers[n].teamColor,
      dashed: dashed.has(n),
      emphasis: focus.has(n),
      points: (history[n] ?? [])
        .map((r) => [r.lap, pick(r)] as [number, number | null])
        .filter((p): p is [number, number] => p[1] != null && Number.isFinite(p[1])),
    }));
}
