import { describe, expect, it } from "vitest";
import type { DriverState, F1Snapshot, LapRecord } from "../data/types";
import { emptySnapshot } from "../data/types";
import { Timeline } from "../data/timeline";
import { createMockDataset } from "../data/mock/mockData";
import {
  championshipAsItStands,
  computeInsights,
  estimatePitLoss,
  EventTracker,
  FUEL_EFFECT_S_PER_LAP,
  gapTrends,
  linearFit,
  neutralisedLaps,
  predictPitStop,
  sameTeam,
  stintPace,
} from ".";

const lap = (n: number, time: number, extra: Partial<LapRecord> = {}): LapRecord => ({
  lap: n,
  end: n * 90_000,
  time,
  sectors: [null, null, null],
  compound: "MEDIUM",
  tyreAge: n,
  position: 1,
  gap: 0,
  pitIn: false,
  pitOut: false,
  ...extra,
});

const driver = (n: number, extra: Partial<DriverState> = {}): DriverState => ({
  number: n,
  code: `D${n}`,
  name: `Driver ${n}`,
  team: "Team",
  teamColor: "#fff",
  position: null,
  gapToLeader: null,
  interval: null,
  lastLap: null,
  bestLap: null,
  lapNumber: null,
  sectors: [null, null, null],
  sectorStatus: [null, null, null],
  tyre: { compound: null, age: null },
  pitStops: 0,
  retired: false,
  inPit: false,
  ...extra,
});

describe("pace", () => {
  it("fits a straight line", () => {
    expect(linearFit([[0, 1], [1, 3], [2, 5]])).toEqual({ slope: 2, intercept: 1 });
    expect(linearFit([[1, 1], [1, 2]])).toBeNull();
  });

  it("measures tyre degradation with the fuel effect added back", () => {
    const recs = [2, 3, 4, 5, 6, 7, 8].map((n) => lap(n, 90 + 0.1 * n));
    const pace = stintPace(recs, new Set([1]))!;
    expect(pace.degradation).toBeCloseTo(0.1 + FUEL_EFFECT_S_PER_LAP, 5);
    expect(pace.cliff).toBe(false);
  });

  it("flags a cliff when the last laps fall well off the trend", () => {
    const recs = [2, 3, 4, 5, 6, 7, 8, 9].map((n) => lap(n, n >= 8 ? 90.3 + 0.05 * n + 1.2 : 90.3 + 0.05 * n));
    expect(stintPace(recs, new Set([1]))!.cliff).toBe(true);
  });

  it("only uses the current stint", () => {
    const recs = [
      ...[2, 3, 4, 5].map((n) => lap(n, 95, { compound: "SOFT" })),
      lap(6, 110, { pitIn: true, compound: "SOFT" }),
      ...[7, 8, 9, 10, 11].map((n, i) => lap(n, 91 + 0.2 * i, { compound: "HARD", tyreAge: i + 1, pitOut: i === 0 })),
    ];
    const pace = stintPace(recs, new Set([1]))!;
    expect(pace.compound).toBe("HARD");
    expect(pace.laps).toBe(4); // the out-lap is excluded
    expect(pace.degradation).toBeNull(); // too few laps to judge yet
  });

  it("estimates pit loss from in- and out-laps", () => {
    const recs = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => lap(n, 90));
    recs[3] = lap(5, 101, { pitIn: true });
    recs[4] = lap(6, 101, { pitOut: true });
    const others = (o: number) => [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => lap(n, 90 + o));
    expect(estimatePitLoss({ 1: recs, 2: others(0.3), 3: others(0.6) })).toBeCloseTo(22, 5);
  });

  it("detects neutralised laps", () => {
    const history = {
      1: [2, 3, 4, 5].map((n) => lap(n, n === 4 ? 130 : 90)),
      2: [2, 3, 4, 5].map((n) => lap(n, n === 4 ? 131 : 91)),
      3: [2, 3, 4, 5].map((n) => lap(n, n === 4 ? 129 : 92)),
    };
    expect([...neutralisedLaps(history)].sort()).toEqual([1, 4]);
  });
});

describe("race", () => {
  const drivers = {
    1: driver(1, { position: 1, gapToLeader: 0, interval: 0 }),
    2: driver(2, { position: 2, gapToLeader: 3, interval: 3 }),
    3: driver(3, { position: 3, gapToLeader: 3.6, interval: 0.6 }),
    4: driver(4, { position: 4, gapToLeader: 26, interval: 22.4 }),
    5: driver(5, { position: 5, gapToLeader: "+1 LAP", interval: 40 }),
  };
  const order = [1, 2, 3, 4, 5];

  it("predicts where a car rejoins after a stop", () => {
    const p = predictPitStop(1, order, drivers, 22)!;
    expect(p.rejoinPosition).toBe(3);
    expect(p.carAhead).toEqual({ driver: 3, margin: 22 - 3.6 });
    expect(p.carBehind?.driver).toBe(4);
    expect(p.carBehind?.margin).toBeCloseTo(4, 5);
    expect(p.traffic).toBe(false);
  });

  it("flags rejoining in traffic or under pressure", () => {
    const held = predictPitStop(2, order, drivers, 23.5)!; // rejoins 0.5 s behind car 4
    expect(held.carAhead?.driver).toBe(4);
    expect(held.traffic).toBe(true);
    const attacked = predictPitStop(2, order, drivers, 22.5)!; // rejoins 0.5 s ahead of car 4
    expect(attacked.carBehind?.driver).toBe(4);
    expect(attacked.pressure).toBe(true);
    expect(attacked.traffic).toBe(false);
  });

  it("measures closing rates and battles", () => {
    const history = {
      1: [1, 2, 3, 4, 5].map((n) => lap(n, 90, { gap: 0 })),
      2: [1, 2, 3, 4, 5].map((n) => lap(n, 90, { gap: 5 - 0.5 * n })),
    };
    const t = gapTrends([1, 2], { 1: drivers[1], 2: driver(2, { interval: 2.5 }) }, history);
    expect(t[2].ratePerLap).toBeCloseTo(-0.5, 5);
    expect(t[2].lapsToCatch).toBe(3);
    expect(t[2].battle).toBe(false);
    expect(gapTrends(order, drivers, {})[3].battle).toBe(true);
    expect(gapTrends(order, drivers, {})[1].battle).toBe(false); // the leader has no one ahead
  });
});

describe("championship", () => {
  it("adds race points to the standings", () => {
    const drivers = { 1: driver(1, { team: "Red Bull Racing" }), 4: driver(4, { team: "McLaren" }), 81: driver(81, { team: "McLaren" }) };
    const res = championshipAsItStands(
      {
        drivers: [
          { number: 81, points: 100 },
          { number: 4, points: 90 },
          { number: 1, points: 95 },
        ],
        constructors: [
          { team: "McLaren", points: 190 },
          { team: "Red Bull", points: 95 },
        ],
      },
      [1, 4, 81],
      drivers,
    );
    expect(res.drivers.map((r) => [r.number, r.total])).toEqual([[1, 120], [81, 115], [4, 108]]);
    expect(res.drivers.find((r) => r.number === 1)!.change).toBe(1); // 2nd before the race, 1st now
    expect(res.drivers.find((r) => r.number === 81)!.change).toBe(-1);
    expect(res.drivers.find((r) => r.number === 4)!.change).toBe(0);
    expect(res.teams[0]).toMatchObject({ team: "McLaren", gained: 33 });
    expect(res.teams[1]).toMatchObject({ team: "Red Bull", gained: 25 });
  });

  it("matches team names loosely", () => {
    expect(sameTeam("Red Bull", "Red Bull Racing")).toBe(true);
    expect(sameTeam("Haas F1 Team", "Haas")).toBe(true);
    expect(sameTeam("Ferrari", "McLaren")).toBe(false);
  });
});

describe("events", () => {
  const base = (now: number, positions: Record<number, number>, extra: Partial<F1Snapshot> = {}): F1Snapshot => ({
    ...emptySnapshot(),
    now,
    session: { key: 1, name: "Test", circuit: "--", country: "--", year: 2026 },
    order: Object.keys(positions).map(Number).sort((a, b) => positions[a] - positions[b]),
    drivers: Object.fromEntries(Object.entries(positions).map(([n, p]) => [n, driver(Number(n), { position: p })])),
    ...extra,
  });

  it("reports overtakes but not the first snapshot", () => {
    const t = new EventTracker();
    expect(t.update(base(1000, { 1: 1, 2: 2 }))).toEqual([]);
    const ev = t.update(base(2000, { 1: 2, 2: 1 }));
    expect(ev.map((e) => e.kind)).toEqual(["overtake"]);
    expect(ev[0].text).toContain("D2 passes D1");
  });

  it("ignores two cars swapping back and forth", () => {
    const t = new EventTracker();
    t.update(base(1000, { 1: 1, 2: 2 }));
    expect(t.update(base(2000, { 1: 2, 2: 1 }))).toHaveLength(1);
    expect(t.update(base(5000, { 1: 1, 2: 2 }))).toHaveLength(0);
    expect(t.update(base(8000, { 1: 2, 2: 1 }))).toHaveLength(0);
  });

  it("ignores jumps in time such as scrubbing", () => {
    const t = new EventTracker();
    t.update(base(1000, { 1: 1, 2: 2 }));
    expect(t.update(base(500_000, { 1: 2, 2: 1 }))).toEqual([]);
  });

  it("reports flags from race control", () => {
    const t = new EventTracker();
    t.update(base(1000, { 1: 1 }));
    const rc = [{ id: "x", date: 1500, category: "SafetyCar", flag: null, message: "SAFETY CAR DEPLOYED", lap: 3 }];
    expect(t.update(base(2000, { 1: 1 }, { raceControl: rc })).map((e) => e.text)).toEqual(["Safety car deployed"]);
  });
});

describe("mock race end to end", () => {
  it("produces lap history and sensible insights mid-race", () => {
    const ds = createMockDataset();
    const tl = new Timeline(ds);
    const t = ds.start + (ds.end - ds.start) * 0.75;
    const heavy = tl.computeHeavy(t);
    const laps = Object.values(heavy.history).map((h) => h.length);
    expect(Math.max(...laps)).toBeGreaterThan(10);
    expect(tl.historyAt(t)).toBe(heavy.history); // cached until another lap completes

    const ins = computeInsights(heavy);
    expect(ins.pitLossMeasured).toBe(true);
    expect(ins.pitLoss).toBeGreaterThan(18);
    expect(ins.pitLoss).toBeLessThan(28);
    const degs = Object.values(ins.pace).map((p) => p.degradation).filter((d): d is number => d != null);
    expect(degs.length).toBeGreaterThan(5); // cars that pitted recently have too few laps yet
    const leader = heavy.order[0];
    expect(ins.pit[leader].rejoinPosition).toBeGreaterThan(1);
  });
});
