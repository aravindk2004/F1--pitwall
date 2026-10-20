// Championship standings "as it stands": points before the race plus the current order.

import type { DriverState, Standings } from "../data/types";

/** Points for P1–P10 in a Grand Prix (no fastest-lap point since 2025). */
export const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export interface DriverStandingRow {
  number: number | null;
  code: string;
  team: string;
  before: number;
  gained: number;
  total: number;
  position: number;
  /** Places gained (+) or lost (−) compared with the standings before the race. */
  change: number;
}

export interface TeamStandingRow {
  team: string;
  before: number;
  gained: number;
  total: number;
  position: number;
  change: number;
}

const normaliseTeam = (name: string) =>
  name
    .toLowerCase()
    .replace(/f1 team|formula one team|racing|scuderia|team|honda|rbpt|ford|mercedes-amg|petronas|\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Match a standings team name to a team name used in the race ("RB F1 Team" vs "Racing Bulls" is not matched). */
export function sameTeam(a: string, b: string): boolean {
  const x = normaliseTeam(a), y = normaliseTeam(b);
  return x === y || (x.length > 2 && y.includes(x)) || (y.length > 2 && x.includes(y));
}

function rank<T extends { total: number; before: number }>(rows: T[]): Array<T & { position: number; change: number }> {
  const beforeOrder = [...rows].sort((a, b) => b.before - a.before);
  const sorted = [...rows].sort((a, b) => b.total - a.total || b.before - a.before);
  return sorted.map((r, i) => ({ ...r, position: i + 1, change: beforeOrder.indexOf(r) - i }));
}

export function championshipAsItStands(
  standings: Standings,
  order: number[],
  drivers: Record<number, DriverState>,
): { drivers: DriverStandingRow[]; teams: TeamStandingRow[] } {
  const gainedBy = new Map<number, number>();
  order
    .filter((n) => drivers[n] && !drivers[n].retired)
    .forEach((n, i) => gainedBy.set(n, RACE_POINTS[i] ?? 0));

  const rows: Array<Omit<DriverStandingRow, "position" | "change">> = [];
  const seen = new Set<number>();
  for (const s of standings.drivers) {
    const n =
      s.number != null && drivers[s.number]
        ? s.number
        : (Object.values(drivers).find((d) => s.code && d.code === s.code)?.number ?? null);
    if (n != null) seen.add(n);
    const d = n != null ? drivers[n] : undefined;
    const gained = n != null ? (gainedBy.get(n) ?? 0) : 0;
    rows.push({ number: n, code: d?.code ?? s.code ?? "--", team: d?.team ?? "--", before: s.points, gained, total: s.points + gained });
  }
  // Drivers scoring their first points of the season, or new entries.
  for (const [n, gained] of gainedBy) {
    if (seen.has(n)) continue;
    const d = drivers[n];
    rows.push({ number: n, code: d.code, team: d.team, before: 0, gained, total: gained });
  }

  const teamRows = new Map<string, { team: string; before: number; gained: number; total: number }>();
  for (const t of standings.constructors) teamRows.set(t.team, { team: t.team, before: t.points, gained: 0, total: t.points });
  for (const [n, gained] of gainedBy) {
    if (!gained) continue;
    const teamName = drivers[n].team;
    const key = [...teamRows.keys()].find((k) => sameTeam(k, teamName)) ?? teamName;
    const row = teamRows.get(key) ?? { team: teamName, before: 0, gained: 0, total: 0 };
    row.gained += gained;
    row.total += gained;
    teamRows.set(key, row);
  }
  return { drivers: rank(rows), teams: rank([...teamRows.values()]) };
}
