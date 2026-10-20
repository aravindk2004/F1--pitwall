// Turns successive snapshots into race events: overtakes, pit stops, fastest laps, flags.

import type { F1Snapshot } from "../data/types";
import { fmtLap } from "../lib/format";

export type RaceEventKind = "overtake" | "pit" | "fastest-lap" | "retirement" | "flag" | "penalty";

export interface RaceEvent {
  id: string;
  /** Source clock (playback time in replays). */
  t: number;
  kind: RaceEventKind;
  text: string;
  drivers: number[];
  lap: number | null;
}

/** A jump in the source clock bigger than this (e.g. scrubbing) resets the comparison. */
const MAX_STEP_MS = 30_000;

const FLAG_PATTERNS: Array<[RegExp, string]> = [
  [/RED FLAG/, "Red flag"],
  [/VIRTUAL SAFETY CAR DEPLOYED|VSC DEPLOYED/, "Virtual safety car"],
  [/SAFETY CAR DEPLOYED/, "Safety car deployed"],
  [/SAFETY CAR IN THIS LAP|VSC ENDING/, "Safety car ending"],
  [/CHEQUERED FLAG/, "Chequered flag"],
];

export class EventTracker {
  private prev: F1Snapshot | null = null;
  private fastest: number | null = null;
  private seenMessages = new Set<string>();
  private counter = 0;
  private lastPit = new Map<number, number>();

  reset(): void {
    this.prev = null;
    this.fastest = null;
    this.seenMessages.clear();
    this.lastPit.clear();
  }

  /** Compare with the previous snapshot and return anything new. */
  update(s: F1Snapshot): RaceEvent[] {
    const prev = this.prev;
    const now = s.now;
    if (now == null || !s.order.length) return [];
    if (!prev || prev.now == null || now < prev.now || now - prev.now > MAX_STEP_MS || prev.session?.key !== s.session?.key) {
      // Start (or restart after a scrub) from this state without reporting what already happened.
      this.prev = s;
      this.fastest = this.bestLap(s);
      this.seenMessages = new Set(s.raceControl.map((m) => m.id));
      return [];
    }
    if (prev.drivers === s.drivers && prev.raceControl === s.raceControl) return [];

    const events: RaceEvent[] = [];
    const lap = s.lap.current;
    const add = (kind: RaceEventKind, text: string, drivers: number[]) =>
      events.push({ id: `${now}-${this.counter++}`, t: now, kind, text, drivers, lap });
    const code = (n: number) => s.drivers[n]?.code ?? String(n);

    for (const n of s.order) {
      const d = s.drivers[n];
      const p = prev.drivers[n];
      if (!d || !p) continue;
      if (d.retired && !p.retired) add("retirement", `${code(n)} is out of the race`, [n]);
      // Entering the pit lane and the stop counter going up are the same stop: report it once.
      if ((d.pitStops ?? 0) > (p.pitStops ?? 0) || (d.inPit && !p.inPit)) {
        const last = this.lastPit.get(n);
        if (last == null || now - last > 90_000) {
          this.lastPit.set(n, now);
          add("pit", `${code(n)} pits`, [n]);
        }
      }
      // Overtake: gained a place on track from someone who did not pit or retire.
      if (d.position != null && p.position != null && d.position < p.position && !d.inPit && !d.retired) {
        const passed = s.order.find((m) => {
          const a = s.drivers[m], b = prev.drivers[m];
          return a && b && b.position === d.position && a.position === p.position && !a.inPit && !a.retired && (a.pitStops ?? 0) === (b.pitStops ?? 0);
        });
        if (passed != null) add("overtake", `${code(n)} passes ${code(passed)} for P${d.position}`, [n, passed]);
      }
    }

    const best = this.bestLap(s);
    if (best != null && (this.fastest == null || best < this.fastest - 1e-6)) {
      const holder = s.order.find((n) => s.drivers[n]?.bestLap === best);
      if (holder != null && this.fastest != null) add("fastest-lap", `Fastest lap: ${code(holder)} ${fmtLap(best)}`, [holder]);
      this.fastest = best;
    }

    for (const m of s.raceControl) {
      if (this.seenMessages.has(m.id)) continue;
      this.seenMessages.add(m.id);
      const msg = m.message.toUpperCase();
      const flag = FLAG_PATTERNS.find(([re]) => re.test(msg));
      if (flag) add("flag", flag[1], []);
      else if (/PENALTY|UNDER INVESTIGATION/.test(msg) && !/NO FURTHER/.test(msg)) add("penalty", m.message, []);
    }

    this.prev = s;
    return events;
  }

  private bestLap(s: F1Snapshot): number | null {
    let best: number | null = null;
    for (const d of Object.values(s.drivers)) if (d.bestLap != null && (best == null || d.bestLap < best)) best = d.bestLap;
    return best;
  }
}
