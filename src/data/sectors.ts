import type { SectorStatus, Sectors } from "./types";

const EPS = 1e-6;

/** Tracks personal and overall best sector times and colours a sector value. */
export class SectorBests {
  private overall: Sectors<number> = [Infinity, Infinity, Infinity];
  private personal = new Map<number, Sectors<number>>();
  private bestLaps = new Map<number, number>();

  record(driver: number, sector: 0 | 1 | 2, value: number | null | undefined): void {
    if (value == null || !Number.isFinite(value) || value <= 0) return;
    const p = this.personal.get(driver) ?? [Infinity, Infinity, Infinity];
    if (value < p[sector]) p[sector] = value;
    this.personal.set(driver, p);
    if (value < this.overall[sector]) this.overall[sector] = value;
  }

  recordLap(driver: number, lap: number | null | undefined): void {
    if (lap == null || !Number.isFinite(lap) || lap <= 0) return;
    const prev = this.bestLaps.get(driver);
    if (prev == null || lap < prev) this.bestLaps.set(driver, lap);
  }

  bestLap(driver: number): number | null {
    return this.bestLaps.get(driver) ?? null;
  }

  status(driver: number, sector: 0 | 1 | 2, value: number | null): SectorStatus {
    if (value == null) return null;
    if (value <= this.overall[sector] + EPS) return "purple";
    const p = this.personal.get(driver);
    if (p && value <= p[sector] + EPS) return "green";
    return "yellow";
  }
}
