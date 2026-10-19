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
  view: 0,
  cycleSeconds: initialCycle(),
  cyclePaused: false,
  radioMode: "public",
  setKind: (kind) => set({ kind, snapshot: emptySnapshot(), hovered: null }),
  setReplayBackend: (replayBackend) => set({ replayBackend, snapshot: emptySnapshot(), hovered: null }),
  setRacePickerOpen: (racePickerOpen) => set({ racePickerOpen }),
  toggleTrackExpanded: () => set((s) => ({ trackExpanded: !s.trackExpanded })),
  setShowResults: (showResults) => set({ showResults }),
  setSourceState: (snapshot, status, mode) => set({ snapshot, status, mode }),
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
