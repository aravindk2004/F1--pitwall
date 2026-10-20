// A compact text picture of the race for Claude to reason over.

import type { F1Snapshot } from "../data/types";
import { fmtGap, fmtLap } from "../lib/format";
import type { RaceEvent } from "./events";
import type { RaceInsights } from "./index";
import { championshipAsItStands } from "./championship";

const n2 = (v: number | null | undefined, digits = 2) => (v == null || !Number.isFinite(v) ? "?" : v.toFixed(digits));

export function buildRaceContext(s: F1Snapshot, insights: RaceInsights | null, events: RaceEvent[]): string {
  const lines: string[] = [];
  const session = s.session;
  lines.push(
    `RACE: ${session?.name ?? "unknown"}${session?.year ? ` ${session.year}` : ""} at ${session?.circuitFullName ?? session?.circuit ?? "?"}` +
      `${session?.lengthKm ? ` (${session.lengthKm} km)` : ""}. Lap ${s.lap.current ?? "?"} of ${s.lap.total ?? "?"}.`,
  );
  if (s.weather) {
    lines.push(
      `WEATHER: air ${n2(s.weather.airTemp, 1)}°C, track ${n2(s.weather.trackTemp, 1)}°C, humidity ${n2(s.weather.humidity, 0)}%, ` +
        `${s.weather.rainfall ? "RAINING" : "dry"}.`,
    );
  }
  if (insights) lines.push(`PIT LOSS: ${n2(insights.pitLoss, 1)} s${insights.pitLossMeasured ? " (measured this race)" : " (typical value)"}.`);

  lines.push("", "ORDER (pos | driver | team | gap to leader | interval | trend to car ahead s/lap (− = closing) | tyre age | wear s/lap | stops | if pits now):");
  for (const n of s.order) {
    const d = s.drivers[n];
    if (!d) continue;
    if (d.retired) {
      lines.push(`- ${d.code} (${d.team}): RETIRED`);
      continue;
    }
    const p = insights?.pace[n];
    const t = insights?.trends[n];
    const pit = insights?.pit[n];
    lines.push(
      [
        `P${d.position ?? "?"}`,
        `${d.code} (${d.name})`,
        d.team,
        d.position === 1 ? "leader" : fmtGap(d.gapToLeader),
        d.position === 1 ? "-" : fmtGap(d.interval),
        t?.ratePerLap != null ? n2(t.ratePerLap) : "?",
        `${d.tyre.compound ?? "?"} ${d.tyre.age ?? "?"} laps`,
        p?.degradation != null ? n2(p.degradation) : "?",
        String(d.pitStops ?? "?"),
        pit ? `P${pit.rejoinPosition}${pit.traffic ? " in traffic" : ""}` : "?",
      ].join(" | ") + (d.inPit ? " [IN PIT]" : "") + (t?.battle ? " [BATTLE]" : "") + (p?.cliff ? " [TYRES DROPPING OFF]" : ""),
    );
  }

  // Recent lap times for the top ten, to judge pace.
  lines.push("", "LAST 5 LAP TIMES (top 10; p = pit lap):");
  for (const n of s.order.slice(0, 10)) {
    const d = s.drivers[n];
    const recs = (s.history[n] ?? []).slice(-5);
    if (!d || !recs.length) continue;
    lines.push(`- ${d.code}: ${recs.map((r) => `L${r.lap} ${fmtLap(r.time)}${r.pitIn || r.pitOut ? "p" : ""}`).join(", ")}`);
  }

  if (events.length) {
    lines.push("", "RECENT EVENTS (newest first):");
    for (const e of events.slice(0, 15)) lines.push(`- L${e.lap ?? "?"}: ${e.text}`);
  }
  if (s.raceControl.length) {
    lines.push("", "RACE CONTROL (newest first):");
    for (const m of s.raceControl.slice(0, 8)) lines.push(`- L${m.lap ?? "?"}: ${m.message}`);
  }
  if (s.standings) {
    const champ = championshipAsItStands(s.standings, s.order, s.drivers);
    lines.push("", "CHAMPIONSHIP IF THE RACE ENDED NOW (top 6):");
    for (const r of champ.drivers.slice(0, 6)) lines.push(`- ${r.position}. ${r.code} ${r.total} pts (${r.before} before, +${r.gained})`);
  }
  return lines.join("\n");
}

export const ENGINEER_INSTRUCTIONS = `You are a Formula 1 race engineer and strategist explaining a race to a fan.
Use only the race data below; it is everything the fan's dashboard knows at this moment.
If the data is a replay of a past race, treat this moment as live: do not use any outside knowledge of what happens later in the race or season, and never reveal results.
Say plainly when the data doesn't show something. Keep it short and concrete: name drivers, gaps in seconds and laps.
Format: a one-line headline, then at most 6 short bullet points. No tables.`;
