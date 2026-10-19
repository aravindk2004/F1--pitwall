import type { SourceKind } from "../../data/types";
import { AVAILABLE_KINDS } from "../../data/config";
import { useDashboard } from "../../state/store";

const OPTIONS: Record<SourceKind, { label: string; hint: string }> = {
  live: { label: "Live", hint: "Python bridge on ws://localhost:8765" },
  replay: { label: "Replay", hint: "Replay a real race" },
  mock: { label: "Mock", hint: "Offline demo race" },
};

export function ModeSwitch() {
  const kind = useDashboard((s) => s.kind);
  const setKind = useDashboard((s) => s.setKind);
  const setPickerOpen = useDashboard((s) => s.setRacePickerOpen);
  return (
    <div className="flex h-7 rounded-md border border-white/10 p-0.5" role="radiogroup" aria-label="Data source">
      {AVAILABLE_KINDS.map((k) => (
        <button
          key={k}
          role="radio"
          aria-checked={kind === k}
          title={OPTIONS[k].hint}
          onClick={() => {
            if (kind === k) return;
            setKind(k);
            if (k === "replay") setPickerOpen(true);
          }}
          className={`rounded px-2.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
            kind === k ? "bg-cyan-glow text-ink-950 shadow-[0_0_12px_#22e5ff66]" : "text-white/50 hover:text-white"
          }`}
        >
          {OPTIONS[k].label}
        </button>
      ))}
    </div>
  );
}
