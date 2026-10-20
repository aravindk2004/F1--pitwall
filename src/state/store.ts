import { create } from "zustand";
import {
  emptySnapshot,
  initialReplayBackend,
  initialSourceKind,
  STATIC_SITE,
  type ReplayBackend,
  type F1Snapshot,
  type SourceKind,
  type SourceMode,
  type SourceStatus,
} from "../data";
import { computeInsights, EventTracker, type RaceEvent, type RaceInsights } from "../insights";

export type Page = "dashboard" | "analysis";
const EVENT_LIMIT = 80;
const TOAST_LIMIT = 3;

/** Events worth interrupting for: flags, penalties, retirements, fastest laps, and moves at the front. */
function isMajor(e: RaceEvent, s: F1Snapshot): boolean {
  if (e.kind === "overtake" || e.kind === "pit") {
    const pos = s.drivers[e.drivers[0]]?.position ?? 99;
    return e.kind === "overtake" ? pos <= 3 : pos <= 5;
  }
  return true;
}

const tracker = new EventTracker();
let insightInputs: Pick<F1Snapshot, "history" | "drivers" | "order"> | null = null;

const readFlag = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};
const writeFlag = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* ignore */
  }
};

export const STAT_VIEWS = ["Gap", "Tyre age", "Speed", "Last lap", "Pit stops"] as const;
export type RadioMode = "public" | "live";

export interface HoverTarget {
  driver: number;
  x: number;
  y: number;
}

interface DashboardState {
  kind: SourceKind;
  replayBackend: ReplayBackend;
  racePickerOpen: boolean;
  /** Track map enlarged over the radio and positions panels. */
  trackExpanded: boolean;
  showResults: boolean;
  snapshot: F1Snapshot;
  status: SourceStatus;
  mode: SourceMode;
  hovered: HoverTarget | null;
  /** Driver pinned by clicking; the hovered driver takes precedence while hovering. */
  selected: number | null;
  page: Page;
  insights: RaceInsights | null;
  events: RaceEvent[];
  toasts: RaceEvent[];
  alertSound: boolean;
  alertNotify: boolean;
  view: number;
  cycleSeconds: number;
  cyclePaused: boolean;
  radioMode: RadioMode;
  setKind(kind: SourceKind): void;
  setReplayBackend(backend: ReplayBackend): void;
  setRacePickerOpen(open: boolean): void;
  toggleTrackExpanded(): void;
  setShowResults(show: boolean): void;
  setSourceState(snapshot: F1Snapshot, status: SourceStatus, mode: SourceMode): void;
  setHovered(h: HoverTarget | null): void;
  toggleSelected(driver: number | null): void;
  setPage(page: Page): void;
  dismissToast(id: string): void;
  setAlertSound(on: boolean): void;
  setAlertNotify(on: boolean): void;
  setView(view: number): void;
  nextView(): void;
  setCycleSeconds(s: number): void;
  toggleCyclePaused(): void;
  setRadioMode(m: RadioMode): void;
}

const CYCLE_KEY = "f1dash.cycleSeconds";

function initialCycle(): number {
  try {
    const v = Number(localStorage.getItem(CYCLE_KEY));
    if (v >= 3 && v <= 20) return v;
  } catch {
    /* ignore */
  }
  return 8;
}

export const useDashboard = create<DashboardState>((set) => ({
  kind: initialSourceKind(),
  replayBackend: initialReplayBackend(),
  // A hosted demo opens on the race list so visitors pick what to watch.
  racePickerOpen: STATIC_SITE && initialSourceKind() === "replay",
  showResults: false,
  trackExpanded: false,
  snapshot: emptySnapshot(),
  status: "OFFLINE",
  mode: "replay",
  hovered: null,
  selected: null,
  page: "dashboard",
  insights: null,
  events: [],
  toasts: [],
  alertSound: readFlag("f1dash.alertSound"),
  alertNotify: readFlag("f1dash.alertNotify"),
  view: 0,
  cycleSeconds: initialCycle(),
  cyclePaused: false,
  radioMode: "public",
  setKind: (kind) => set({ kind, snapshot: emptySnapshot(), hovered: null, selected: null, events: [], toasts: [], insights: null }),
  setReplayBackend: (replayBackend) =>
    set({ replayBackend, snapshot: emptySnapshot(), hovered: null, selected: null, events: [], toasts: [], insights: null }),
  setRacePickerOpen: (racePickerOpen) => set({ racePickerOpen }),
  toggleTrackExpanded: () => set((s) => ({ trackExpanded: !s.trackExpanded })),
  setShowResults: (showResults) => set({ showResults }),
  setSourceState: (snapshot, status, mode) =>
    set((st) => {
      const patch: Partial<DashboardState> = { snapshot, status, mode };
      // Insights only change when laps, timing or order change, not on every animation frame.
      if (
        !insightInputs ||
        insightInputs.history !== snapshot.history ||
        insightInputs.drivers !== snapshot.drivers ||
        insightInputs.order !== snapshot.order
      ) {
        insightInputs = { history: snapshot.history, drivers: snapshot.drivers, order: snapshot.order };
        patch.insights = snapshot.order.length ? computeInsights(snapshot) : null;
        const fresh = tracker.update(snapshot);
        if (st.snapshot.session?.key !== snapshot.session?.key) {
          patch.events = [];
          patch.toasts = [];
        }
        if (fresh.length) {
          patch.events = [...fresh.slice().reverse(), ...(patch.events ?? st.events)].slice(0, EVENT_LIMIT);
          const major = fresh.filter((e) => isMajor(e, snapshot));
          if (major.length) patch.toasts = [...major.reverse(), ...(patch.toasts ?? st.toasts)].slice(0, TOAST_LIMIT);
        }
      }
      return patch;
    }),
  toggleSelected: (driver) => set((st) => ({ selected: driver == null || st.selected === driver ? null : driver })),
  setPage: (page) => set({ page }),
  dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),
  setAlertSound: (on) => {
    writeFlag("f1dash.alertSound", on);
    set({ alertSound: on });
  },
  setAlertNotify: (on) => {
    writeFlag("f1dash.alertNotify", on);
    set({ alertNotify: on });
  },
  setHovered: (hovered) => set({ hovered }),
  setView: (view) => set({ view: ((view % STAT_VIEWS.length) + STAT_VIEWS.length) % STAT_VIEWS.length }),
  nextView: () => set((s) => ({ view: (s.view + 1) % STAT_VIEWS.length })),
  setCycleSeconds: (cycleSeconds) => {
    try {
      localStorage.setItem(CYCLE_KEY, String(cycleSeconds));
    } catch {
      /* ignore */
    }
    set({ cycleSeconds });
  },
  toggleCyclePaused: () => set((s) => ({ cyclePaused: !s.cyclePaused })),
  setRadioMode: (radioMode) => set({ radioMode }),
}));

/** Shorthand selectors for snapshot fields. */
export const useSnap = <T,>(pick: (s: F1Snapshot) => T): T => useDashboard((st) => pick(st.snapshot));
