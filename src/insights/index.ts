// Everything the dashboard derives from the raw snapshot, computed in one place.

import type { F1Snapshot } from "../data/types";
import { DEFAULT_PIT_LOSS_S, estimatePitLoss, neutralisedLaps, stintPace, type StintPace } from "./pace";
import { gapTrends, predictPitStop, type GapTrend, type PitPrediction } from "./race";

export * from "./pace";
export * from "./race";
export * from "./championship";
export * from "./events";

export interface RaceInsights {
  /** Measured from this race's stops, or a typical value until a stop has been made. */
  pitLoss: number;
  pitLossMeasured: boolean;
  pace: Record<number, StintPace>;
  trends: Record<number, GapTrend>;
  pit: Record<number, PitPrediction>;
}

export function computeInsights(s: Pick<F1Snapshot, "history" | "order" | "drivers">): RaceInsights {
  const measured = estimatePitLoss(s.history);
  const pitLoss = measured ?? DEFAULT_PIT_LOSS_S;
  const neutralised = neutralisedLaps(s.history);
  const pace: Record<number, StintPace> = {};
  for (const [n, recs] of Object.entries(s.history)) {
    const p = stintPace(recs, neutralised);
    if (p) pace[Number(n)] = p;
  }
  const pit: Record<number, PitPrediction> = {};
  for (const n of s.order) {
    const p = predictPitStop(n, s.order, s.drivers, pitLoss);
    if (p) pit[n] = p;
  }
  return {
    pitLoss,
    pitLossMeasured: measured != null,
    pace,
    trends: gapTrends(s.order, s.drivers, s.history),
    pit,
  };
}
