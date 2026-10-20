// Offline mock data: a deterministic, physically plausible 18-lap race on a
// synthetic circuit. Everything is generated locally — no network needed.
// Records use the same OpenF1 shapes as the real replay.

import type { CarSample, LocSample, TelemetryChunk, TimelineDataset } from "../timeline";
import type { TrackLayout } from "../types";
import type {
  RawDriver,
  RawDriverStatus,
  RawInterval,
  RawLap,
  RawPit,
  RawPosition,
  RawRaceControl,
  RawRadio,
  RawStint,
  RawWeather,
} from "../records";

export const MOCK_DRIVERS: RawDriver[] = [
  { driver_number: 1, name_acronym: "VER", full_name: "Max Verstappen", team_name: "Red Bull Racing", team_colour: "3671C6" },
  { driver_number: 22, name_acronym: "TSU", full_name: "Yuki Tsunoda", team_name: "Red Bull Racing", team_colour: "3671C6" },
  { driver_number: 4, name_acronym: "NOR", full_name: "Lando Norris", team_name: "McLaren", team_colour: "FF8000" },
  { driver_number: 81, name_acronym: "PIA", full_name: "Oscar Piastri", team_name: "McLaren", team_colour: "FF8000" },
  { driver_number: 16, name_acronym: "LEC", full_name: "Charles Leclerc", team_name: "Ferrari", team_colour: "E8002D" },
  { driver_number: 44, name_acronym: "HAM", full_name: "Lewis Hamilton", team_name: "Ferrari", team_colour: "E8002D" },
  { driver_number: 63, name_acronym: "RUS", full_name: "George Russell", team_name: "Mercedes", team_colour: "27F4D2" },
  { driver_number: 12, name_acronym: "ANT", full_name: "Andrea Kimi Antonelli", team_name: "Mercedes", team_colour: "27F4D2" },
  { driver_number: 14, name_acronym: "ALO", full_name: "Fernando Alonso", team_name: "Aston Martin", team_colour: "229971" },
  { driver_number: 18, name_acronym: "STR", full_name: "Lance Stroll", team_name: "Aston Martin", team_colour: "229971" },
  { driver_number: 10, name_acronym: "GAS", full_name: "Pierre Gasly", team_name: "Alpine", team_colour: "FF87BC" },
  { driver_number: 43, name_acronym: "COL", full_name: "Franco Colapinto", team_name: "Alpine", team_colour: "FF87BC" },
  { driver_number: 23, name_acronym: "ALB", full_name: "Alexander Albon", team_name: "Williams", team_colour: "64C4FF" },
  { driver_number: 55, name_acronym: "SAI", full_name: "Carlos Sainz", team_name: "Williams", team_colour: "64C4FF" },
  { driver_number: 6, name_acronym: "HAD", full_name: "Isack Hadjar", team_name: "Racing Bulls", team_colour: "6692FF" },
  { driver_number: 30, name_acronym: "LAW", full_name: "Liam Lawson", team_name: "Racing Bulls", team_colour: "6692FF" },
  { driver_number: 27, name_acronym: "HUL", full_name: "Nico Hulkenberg", team_name: "Kick Sauber", team_colour: "52E252" },
  { driver_number: 5, name_acronym: "BOR", full_name: "Gabriel Bortoleto", team_name: "Kick Sauber", team_colour: "52E252" },
  { driver_number: 31, name_acronym: "OCO", full_name: "Esteban Ocon", team_name: "Haas F1 Team", team_colour: "B6BABD" },
  { driver_number: 87, name_acronym: "BEA", full_name: "Oliver Bearman", team_name: "Haas F1 Team", team_colour: "B6BABD" },
];

const LAPS = 18;
const T0 = Date.UTC(2025, 6, 6, 14, 3, 0);
const SAMPLE_MS = 270; // ~3.7 Hz like the real feed
const UNITS_PER_M = 10; // OpenF1 location units are roughly decimetres
const RETIRE = { driver: 18, lap: 9, fraction: 0.47 };

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

// --- circuit ------------------------------------------------------------------

interface Circuit {
  x: number[];
  y: number[];
  s: number[]; // cumulative distance (m)
  v: number[]; // reference speed (m/s)
  tr: number[]; // cumulative reference time (s)
  length: number;
  sectorIdx: [number, number, number, number];
  drs: Array<[number, number]>;
}

function buildCircuit(): Circuit {
  const N = 900;
  const x: number[] = [], y: number[] = [];
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const r =
      1 + 0.28 * Math.sin(3 * th + 0.4) + 0.12 * Math.cos(5 * th + 1.1) + 0.06 * Math.sin(8 * th) +
      0.03 * Math.sin(9 * th + 2) + 0.04 * Math.cos(13 * th + 0.7);
    x.push(r * Math.cos(th) * 1.25);
    y.push(r * Math.sin(th) * 0.8);
  }
  // Scale to roughly 5.6 km.
  let raw = 0;
  for (let i = 0; i < N; i++) raw += Math.hypot(x[(i + 1) % N] - x[i], y[(i + 1) % N] - y[i]);
  const k = 5600 / raw;
  for (let i = 0; i < N; i++) {
    x[i] *= k;
    y[i] *= k;
  }
  const s = [0];
  for (let i = 1; i <= N; i++) s.push(s[i - 1] + Math.hypot(x[i % N] - x[i - 1], y[i % N] - y[i - 1]));
  const length = s[N];

  // Curvature → cornering speed limit, then acceleration and braking passes.
  const curv: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i - 4 + N) % N, b = (i + 4) % N;
    const h1 = Math.atan2(y[i] - y[a], x[i] - x[a]);
    const h2 = Math.atan2(y[b] - y[i], x[b] - x[i]);
    let d = h2 - h1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    curv.push(Math.abs(d) / Math.max(1, Math.hypot(x[b] - x[a], y[b] - y[a])));
  }
  const vmax = 92, vmin = 22;
  let v = curv.map((c) => Math.min(vmax, Math.max(vmin, Math.sqrt(18 / Math.max(c, 1e-6)))));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < N * 2; i++) {
      const cur = i % N, prev = (i - 1) % N;
      const ds = s[cur + 1] - s[cur] || 5;
      v[cur] = Math.min(v[cur], Math.sqrt(v[prev] ** 2 + 2 * 9 * ds));
    }
    for (let i = N * 2; i > 0; i--) {
      const cur = i % N, next = (i + 1) % N;
      const ds = s[cur + 1] - s[cur] || 5;
      v[cur] = Math.min(v[cur], Math.sqrt(v[next] ** 2 + 2 * 38 * ds));
    }
  }
  v = v.map((val) => Math.max(vmin, val));
  const tr = [0];
  for (let i = 1; i <= N; i++) tr.push(tr[i - 1] + (s[i] - s[i - 1]) / ((v[i - 1] + v[i % N]) / 2));

  const sectorIdx: [number, number, number, number] = [0, Math.round(N / 3), Math.round((2 * N) / 3), N];

  // DRS on the two longest flat-out runs.
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= N; i++) {
    const fast = i < N && v[i] > 83;
    if (fast && start < 0) start = i;
    if (!fast && start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  const drs = runs
    .filter(([a, b]) => s[b] - s[a] > 350)
    .sort((p, q) => s[q[1]] - s[q[0]] - (s[p[1]] - s[p[0]]))
    .slice(0, 2)
    .map(([a, b]) => [a + Math.round((b - a) * 0.15), b] as [number, number]);
  return { x, y, s, v, tr, length, sectorIdx, drs };
}

// --- race model ---------------------------------------------------------------

interface DriverPlan {
  number: number;
  grid: number;
  lapStart: number[]; // epoch ms, length LAPS + 1 (last = finish)
  sectors: number[][]; // seconds
  pitLap: number;
  retiredAt: number | null;
  stopAt: number | null; // time car comes to rest
}

class MockRace {
  readonly c = buildCircuit();
  readonly plans = new Map<number, DriverPlan>();
  readonly end: number;
  private refSector: number[];

  constructor() {
    const rand = rng(2025);
    const c = this.c;
    this.refSector = [0, 1, 2].map((j) => c.tr[c.sectorIdx[j + 1]] - c.tr[c.sectorIdx[j]]);
    const grid = [...MOCK_DRIVERS].map((d) => d.driver_number);
    for (let i = grid.length - 1; i > 0; i--) {
      if (rand() < 0.35) {
        const j = Math.max(0, i - 1 - Math.floor(rand() * 3));
        [grid[i], grid[j]] = [grid[j], grid[i]];
      }
    }
    let latestFinish = 0;
    grid.forEach((n, g) => {
      const pace = 1 + g * 0.0022 + (rand() - 0.5) * 0.004;
      const pitLap = 6 + Math.floor(rand() * 6);
      const lapStart = [T0 + g * 280];
      const sectors: number[][] = [];
      let retiredAt: number | null = null;
      let stopAt: number | null = null;
      for (let lap = 1; lap <= LAPS; lap++) {
        const age = lap < pitLap ? lap : lap - pitLap;
        const sec = this.refSector.map((ref, j) => {
          let t = ref * pace * (1 + (rand() - 0.5) * 0.012 + age * 0.0009 - lap * 0.0006);
          if (lap === 1) t *= j === 0 ? 1.12 : 1.04;
          if (lap === pitLap && j === 2) t += 21 + rand() * 3;
          if (lap === pitLap + 1 && j === 0) t += 1.2;
          return Math.round(t * 1000) / 1000;
        });
        if (n === RETIRE.driver && lap === RETIRE.lap) {
          const start = lapStart[lapStart.length - 1];
          stopAt = start + (this.refSector[0] * pace * 1.6 + this.refSector[1] * pace * 0.5) * 1000;
          retiredAt = stopAt + 15_000;
          sectors.push(sec);
          break;
        }
        sectors.push(sec);
        lapStart.push(lapStart[lapStart.length - 1] + sec.reduce((a, b) => a + b, 0) * 1000);
      }
      if (retiredAt == null) latestFinish = Math.max(latestFinish, lapStart[lapStart.length - 1]);
      this.plans.set(n, { number: n, grid: g, lapStart, sectors, pitLap, retiredAt, stopAt });
    });
    this.end = latestFinish + 45_000;
  }

  /** Distance index (fractional) along the circuit and speed scale at time t. */
  locate(n: number, t: number): { lap: number; frac: number; speedScale: number; finished: boolean } | null {
    const p = this.plans.get(n)!;
    const c = this.c;
    const N = c.x.length;
    if (p.stopAt != null && t >= p.stopAt) return { lap: RETIRE.lap, frac: RETIRE.fraction, speedScale: 0, finished: false };
    if (t < p.lapStart[0]) {
      const back = (p.grid * 8 + 30) / c.length;
      return { lap: 0, frac: 1 - back, speedScale: 0, finished: false };
    }
    let k = 0;
    while (k + 1 < p.lapStart.length && p.lapStart[k + 1] <= t) k++;
    const completed = p.retiredAt == null ? p.lapStart.length - 1 : p.sectors.length;
    if (k >= completed && p.retiredAt == null) {
      // Cool-down lap after the flag at ~60% pace, then park.
      const since = (t - p.lapStart[completed]) / 1000;
      const coolTotal = c.tr[N] * 1.6;
      if (since > coolTotal) return null;
      const idx = this.indexAtRefTime((since / coolTotal) * c.tr[N]);
      return { lap: LAPS + 1, frac: idx / N, speedScale: 1 / 1.6, finished: true };
    }
    if (p.stopAt != null && k === RETIRE.lap - 1) {
      const span = p.stopAt - p.lapStart[k];
      const u = Math.min(1, (t - p.lapStart[k]) / span);
      const eased = 1 - (1 - u) ** 2; // decelerating to a stop
      return { lap: RETIRE.lap, frac: eased * RETIRE.fraction, speedScale: 0.6 * (1 - u), finished: false };
    }
    const sec = p.sectors[k];
    let tau = (t - p.lapStart[k]) / 1000;
    for (let j = 0; j < 3; j++) {
      if (tau <= sec[j] || j === 2) {
        const refStart = c.tr[c.sectorIdx[j]];
        const refT = refStart + (Math.min(tau, sec[j]) / sec[j]) * this.refSector[j];
        const idx = this.indexAtRefTime(refT);
        return { lap: k + 1, frac: idx / N, speedScale: this.refSector[j] / sec[j], finished: false };
      }
      tau -= sec[j];
    }
    return null;
  }

  private indexAtRefTime(rt: number): number {
    const tr = this.c.tr;
    let lo = 0, hi = tr.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tr[mid] <= rt) lo = mid;
      else hi = mid;
    }
    const span = tr[hi] - tr[lo] || 1;
    return lo + (rt - tr[lo]) / span;
  }

  progress(n: number, t: number): number {
    const l = this.locate(n, t);
    if (!l) return LAPS + (this.end - this.plans.get(n)!.lapStart[LAPS]) * 1e-12;
    if (l.finished) return LAPS + (this.end - this.plans.get(n)!.lapStart[LAPS]) * 1e-12;
    return l.lap === 0 ? l.frac - 1 : l.lap - 1 + l.frac;
  }

  point(n: number, t: number): { x: number; y: number; v: number; dv: number; idx: number; lap: number } | null {
    const l = this.locate(n, t);
    if (!l) return null;
    const c = this.c, N = c.x.length;
    const f = (((l.frac % 1) + 1) % 1) * N;
    const i = Math.floor(f) % N, j = (i + 1) % N, w = f - Math.floor(f);
    const v = (c.v[i] * (1 - w) + c.v[j] * w) * l.speedScale;
    const dv = (c.v[(i + 6) % N] - c.v[i]) * l.speedScale;
    return { x: c.x[i] * (1 - w) + c.x[j] * w, y: c.y[i] * (1 - w) + c.y[j] * w, v, dv, idx: i, lap: l.lap };
  }

  /** Time at which driver n reached progress p (binary search on monotone progress). */
  timeAtProgress(n: number, p: number, hi: number): number {
    let lo = hi - 400_000;
    for (let it = 0; it < 28; it++) {
      const mid = (lo + hi) / 2;
      if (this.progress(n, mid) < p) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  inDrs(idx: number): boolean {
    return this.c.drs.some(([a, b]) => idx >= a && idx <= b);
  }
}

// --- record generation ----------------------------------------------------------

function buildRecords(race: MockRace) {
  const laps: RawLap[] = [];
  const stints: RawStint[] = [];
  const pits: RawPit[] = [];
  const status: RawDriverStatus[] = [];
  const rand = rng(77);
  for (const p of race.plans.values()) {
    p.sectors.forEach((sec, k) => {
      const finishedLap = k < p.lapStart.length - 1;
      laps.push({
        driver_number: p.number,
        lap_number: k + 1,
        date_start: iso(p.lapStart[k]),
        lap_duration: finishedLap ? Math.round(sec.reduce((a, b) => a + b, 0) * 1000) / 1000 : null,
        duration_sector_1: finishedLap ? sec[0] : null,
        duration_sector_2: finishedLap ? sec[1] : null,
        duration_sector_3: finishedLap ? sec[2] : null,
        is_pit_out_lap: k + 1 === p.pitLap + 1,
      });
    });
    const firstCompound = rand() < 0.6 ? "MEDIUM" : "SOFT";
    const secondCompound = firstCompound === "SOFT" ? "MEDIUM" : "HARD";
    const retiredLap = p.retiredAt != null ? RETIRE.lap : null;
    const stillRunning = retiredLap == null || p.pitLap < retiredLap;
    stints.push({ driver_number: p.number, stint_number: 1, compound: firstCompound, lap_start: 1, lap_end: stillRunning ? p.pitLap : retiredLap, tyre_age_at_start: firstCompound === "SOFT" ? 0 : 3 });
    if (stillRunning) {
      stints.push({ driver_number: p.number, stint_number: 2, compound: secondCompound, lap_start: p.pitLap + 1, lap_end: retiredLap ?? LAPS, tyre_age_at_start: 0 });
      const pitEntry = p.lapStart[p.pitLap - 1] + (p.sectors[p.pitLap - 1][0] + p.sectors[p.pitLap - 1][1]) * 1000 + 6000;
      pits.push({ driver_number: p.number, date: iso(pitEntry), lap_number: p.pitLap, pit_duration: 22.4 + Math.round(rand() * 30) / 10 });
    }
    if (p.retiredAt != null) status.push({ driver_number: p.number, date: iso(p.retiredAt), retired: true });
  }

  // Positions & intervals sampled through the race (position only on change, like OpenF1).
  const positions: RawPosition[] = [];
  const intervals: RawInterval[] = [];
  const lastPos = new Map<number, number>();
  const numbers = [...race.plans.keys()];
  for (let t = T0 - 15_000; t <= race.end; t += 4000) {
    const live = numbers.filter((n) => {
      const r = race.plans.get(n)!.retiredAt;
      return r == null || t < r;
    });
    const prog = new Map(numbers.map((n) => [n, race.progress(n, t)]));
    const order = [...live].sort((a, b) => prog.get(b)! - prog.get(a)!);
    const out = numbers.filter((n) => !live.includes(n));
    [...order, ...out].forEach((n, i) => {
      if (lastPos.get(n) !== i + 1) {
        positions.push({ driver_number: n, date: iso(t), position: i + 1 });
        lastPos.set(n, i + 1);
      }
    });
    if (t < T0 + 20_000) continue;
    const leader = order[0];
    order.forEach((n, i) => {
      const p = prog.get(n)!;
      if (p > LAPS) return;
      const gapTo = (other: number): number | string => {
        const diff = prog.get(other)! - p;
        if (diff >= 1) return `+${Math.floor(diff)} LAP${diff >= 2 ? "S" : ""}`;
        return Math.round((t - race.timeAtProgress(other, p, t)) / 10) / 100;
      };
      intervals.push({
        driver_number: n,
        date: iso(t),
        gap_to_leader: i === 0 ? 0 : gapTo(leader),
        interval: i === 0 ? 0 : gapTo(order[i - 1]),
      });
    });
  }
  return { laps, stints, pits, status, positions, intervals };
}

function buildRaceControl(race: MockRace): RawRaceControl[] {
  const p = (n: number) => race.plans.get(n)!;
  const leaderFinish = Math.min(...[...race.plans.values()].filter((d) => d.retiredAt == null).map((d) => d.lapStart[d.lapStart.length - 1]));
  const rows: RawRaceControl[] = [
    { date: iso(T0 - 60_000), category: "Flag", flag: "GREEN", message: "GREEN LIGHT - PIT EXIT OPEN", lap_number: 1 },
    { date: iso(T0 + 2_000), category: "Other", flag: null, message: "RACE START", lap_number: 1 },
    { date: iso(p(1).lapStart[2]), category: "Drs", flag: null, message: "DRS ENABLED", lap_number: 3 },
    { date: iso(p(44).lapStart[4] + 31_000), category: "Other", flag: null, message: "CAR 44 (HAM) TIME 1:19.903 DELETED - TRACK LIMITS AT TURN 9 LAP 5", lap_number: 5 },
    { date: iso(p(RETIRE.driver).stopAt! + 4_000), category: "Flag", flag: "YELLOW", message: "YELLOW IN TRACK SECTOR 7", lap_number: RETIRE.lap },
    { date: iso(p(RETIRE.driver).retiredAt!), category: "Other", flag: null, message: `CAR ${RETIRE.driver} (STR) RETIRED`, lap_number: RETIRE.lap },
    { date: iso(p(RETIRE.driver).retiredAt! + 50_000), category: "Flag", flag: "CLEAR", message: "CLEAR IN TRACK SECTOR 7", lap_number: RETIRE.lap },
    { date: iso(p(4).lapStart[11] + 12_000), category: "Other", flag: null, message: "CARS 4 (NOR) AND 16 (LEC) NOTED - TURN 4 - POSSIBLE LEAVING THE TRACK", lap_number: 12 },
    { date: iso(leaderFinish), category: "Flag", flag: "CHEQUERED", message: "CHEQUERED FLAG", lap_number: LAPS },
  ];
  return rows;
}

function buildWeather(race: MockRace): RawWeather[] {
  const out: RawWeather[] = [];
  const rand = rng(9);
  let air = 27.4, track = 44.1;
  for (let t = T0 - 120_000; t <= race.end; t += 60_000) {
    air += (rand() - 0.5) * 0.2;
    track += (rand() - 0.55) * 0.5;
    out.push({
      date: iso(t),
      air_temperature: Math.round(air * 10) / 10,
      track_temperature: Math.round(track * 10) / 10,
      humidity: Math.round(46 + rand() * 4),
      rainfall: 0,
      wind_speed: Math.round((1.2 + rand() * 1.4) * 10) / 10,
      wind_direction: Math.round(200 + rand() * 30),
    });
  }
  return out;
}

let clipUrls: string[] | null = null;

/** Synthesise short "radio" clips so the play button works offline. */
function radioClips(): string[] {
  if (clipUrls) return clipUrls;
  clipUrls = [0, 1, 2].map((seed) => {
    const rate = 16000, secs = 2.2 + seed * 0.4, n = Math.floor(rate * secs);
    const rand = rng(100 + seed);
    const buf = new ArrayBuffer(44 + n * 2);
    const dv = new DataView(buf);
    const str = (o: number, s: string) => [...s].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)));
    str(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    str(36, "data"); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const beep = t < 0.12 || t > secs - 0.12 ? Math.sin(2 * Math.PI * 1400 * t) * 0.35 : 0;
      const syll = Math.max(0, Math.sin(2 * Math.PI * (3.2 + seed) * t)) ** 2;
      const voice = (Math.sin(2 * Math.PI * (140 + 30 * Math.sin(5 * t)) * t) * 0.5 + (rand() - 0.5) * 0.5) * syll * 0.45;
      const hiss = (rand() - 0.5) * 0.04;
      dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, beep + voice + hiss)) * 32000, true);
    }
    try {
      return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
    } catch {
      return "";
    }
  });
  return clipUrls;
}

function buildRadio(race: MockRace): RawRadio[] {
  const clips = radioClips();
  const rand = rng(31);
  const picks = [1, 4, 16, 81, 44, 63, 14, 4, 1, 23, 12, 16, 55];
  return picks.map((n, i) => {
    const p = race.plans.get(n)!;
    const lap = Math.min(p.lapStart.length - 2, 1 + Math.floor((i / picks.length) * (LAPS - 1)));
    return {
      driver_number: n,
      date: iso(p.lapStart[Math.max(0, lap)] + rand() * 40_000),
      recording_url: clips[i % clips.length],
    };
  });
}

function trackLayout(race: MockRace): TrackLayout {
  const c = race.c;
  return {
    points: c.x.map((x, i) => ({ x: x * UNITS_PER_M, y: c.y[i] * UNITS_PER_M })),
    drsZones: c.drs,
  };
}

function gearFor(kmh: number): number {
  const top = [0, 95, 135, 170, 205, 240, 270, 300];
  let g = 1;
  for (let i = 1; i < top.length; i++) if (kmh > top[i]) g = i + 1;
  return Math.min(8, g);
}

function telemetryChunk(race: MockRace, from: number, to: number): TelemetryChunk {
  const location = new Map<number, LocSample[]>();
  const car = new Map<number, CarSample[]>();
  const leaderAt = (t: number) => {
    let best = -Infinity, who = -1;
    for (const n of race.plans.keys()) {
      const pr = race.progress(n, t);
      if (pr > best && pr <= LAPS) {
        best = pr;
        who = n;
      }
    }
    return who;
  };
  for (const p of race.plans.values()) {
    const n = p.number;
    const offset = (n * 37) % SAMPLE_MS;
    const locs: LocSample[] = [];
    const cars: CarSample[] = [];
    for (let t = Math.ceil((from - offset) / SAMPLE_MS) * SAMPLE_MS + offset; t < to; t += SAMPLE_MS) {
      const pt = race.point(n, t);
      if (!pt) continue;
      locs.push({ t, x: pt.x * UNITS_PER_M, y: pt.y * UNITS_PER_M });
      const kmh = pt.v * 3.6;
      const jitter = Math.sin(t / 97 + n) * 1.5;
      const gear = kmh < 2 ? 0 : gearFor(kmh);
      const braking = pt.dv < -6;
      const lifting = pt.dv < -1.5 && !braking;
      const drsOpen = pt.lap >= 3 && pt.lap <= LAPS && race.inDrs(pt.idx) && Math.abs(Math.sin(n * 13.1)) > 0.25 && leaderAt(t) !== n;
      cars.push({
        t,
        speed: Math.max(0, Math.round(kmh + jitter)),
        gear,
        rpm: kmh < 2 ? 4000 : Math.round(10400 + ((kmh % 35) / 35) * 1500 + jitter * 40),
        throttle: braking ? 0 : lifting ? 35 : Math.min(100, Math.round(78 + pt.v / 4)),
        brake: braking ? 100 : 0,
        drs: drsOpen ? 12 : race.inDrs(pt.idx) && pt.lap >= 3 ? 8 : 1,
      });
    }
    if (locs.length) location.set(n, locs);
    if (cars.length) car.set(n, cars);
  }
  return { location, car };
}

/** Made-up points so the championship view has something to show offline. */
function mockStandings() {
  const rand = rng(404);
  const drivers = MOCK_DRIVERS.map((d, i) => ({
    number: d.driver_number,
    points: Math.max(0, Math.round(240 - i * 12 + (rand() - 0.5) * 30)),
  })).sort((a, b) => b.points - a.points);
  const byTeam = new Map<string, number>();
  for (const d of MOCK_DRIVERS) {
    const pts = drivers.find((x) => x.number === d.driver_number)!.points;
    byTeam.set(d.team_name!, (byTeam.get(d.team_name!) ?? 0) + pts);
  }
  const constructors = [...byTeam].map(([team, points]) => ({ team, points })).sort((a, b) => b.points - a.points);
  return { drivers, constructors };
}

let cached: { race: MockRace; records: ReturnType<typeof buildRecords> } | null = null;

export function createMockDataset(): TimelineDataset {
  if (!cached) {
    const race = new MockRace();
    cached = { race, records: buildRecords(race) };
  }
  const { race, records } = cached;
  return {
    session: {
      key: "mock",
      name: "Synthetica Grand Prix",
      session: "Race (mock)",
      circuit: "Synthetica",
      circuitFullName: "Synthetica Circuit (synthetic)",
      place: "Generated offline",
      country: "",
      year: 2025,
      lengthKm: 5.6,
      totalLaps: LAPS,
      date: T0,
      synthetic: true,
    },
    start: T0 - 20_000,
    end: race.end,
    totalLaps: LAPS,
    drivers: MOCK_DRIVERS,
    laps: records.laps,
    positions: records.positions,
    intervals: records.intervals,
    stints: records.stints,
    pits: records.pits,
    driverStatus: records.status,
    radio: buildRadio(race),
    raceControl: buildRaceControl(race),
    weather: buildWeather(race),
    track: trackLayout(race),
    standings: mockStandings(),
    telemetry: {
      chunkMs: 60_000,
      loadChunk: (from, to) => new Promise((resolve) => setTimeout(() => resolve(telemetryChunk(race, from, to)), 0)),
    },
  };
}
