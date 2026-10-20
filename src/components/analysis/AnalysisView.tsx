import { useMemo, useState } from "react";
import { useDashboard, useSnap } from "../../state/store";
import { ErrorBoundary } from "../common/ErrorBoundary";
import { Championship } from "./Championship";
import { RaceCharts } from "./RaceCharts";
import { StrategyTable } from "./StrategyTable";
import { TelemetryCompare } from "./TelemetryCompare";
import { TyreStrategy } from "./TyreStrategy";
import { RaceEngineer } from "../engineer/RaceEngineer";

const AUTO_FOCUS = 5;

/** Drivers highlighted in the charts: the top five plus whoever you follow, until you pick your own. */
function FocusPicker({ focus, custom, setCustom }: { focus: Set<number>; custom: boolean; setCustom(v: number[] | null): void }) {
  const order = useSnap((s) => s.order);
  const drivers = useSnap((s) => s.drivers);
  const toggle = (n: number) => {
    const next = new Set(focus);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    setCustom([...next]);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/[0.06] bg-ink-900/85 px-3 py-2">
      <span className="mr-1 text-[10px] uppercase tracking-[0.18em] text-white/45">Focus</span>
      {order.map((n) => {
        const d = drivers[n];
        if (!d) return null;
        const on = focus.has(n);
        return (
          <button
            key={n}
            onClick={() => toggle(n)}
            aria-pressed={on}
            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-bold transition-colors ${
              on ? "border-white/25 bg-white/10 text-white" : "border-white/[0.06] text-white/40 hover:text-white/70"
            }`}
          >
            <span className="h-2.5 w-1 rounded-full" style={{ background: d.teamColor }} />
            {d.code}
          </button>
        );
      })}
      {custom && (
        <button onClick={() => setCustom(null)} className="ml-1 text-[10px] text-cyan-glow hover:underline">
          Reset to top {AUTO_FOCUS}
        </button>
      )}
    </div>
  );
}

/** Charts and tables that explain the race, alongside the timing tower. */
export function AnalysisView() {
  const order = useSnap((s) => s.order);
  const drivers = useSnap((s) => s.drivers);
  const selected = useDashboard((s) => s.selected);
  const [custom, setCustom] = useState<number[] | null>(null);
  const focus = useMemo(() => {
    if (custom) return new Set(custom);
    const auto = order.filter((n) => drivers[n] && !drivers[n].retired).slice(0, AUTO_FOCUS);
    if (selected != null) auto.push(selected);
    return new Set(auto);
  }, [custom, order, drivers, selected]);

  return (
    // Panels keep their natural height and the column scrolls; nothing may shrink.
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1 [&>*]:shrink-0" data-analysis-scroll>
      <FocusPicker focus={focus} custom={custom != null} setCustom={setCustom} />
      <div>
        <ErrorBoundary name="Race charts">
          <RaceCharts focus={focus} />
        </ErrorBoundary>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="h-[460px] min-h-0">
          <ErrorBoundary name="Tyre strategy">
            <TyreStrategy />
          </ErrorBoundary>
        </div>
        <div className="h-[460px] min-h-0">
          <ErrorBoundary name="Strategy">
            <StrategyTable />
          </ErrorBoundary>
        </div>
        <div>
          <ErrorBoundary name="Telemetry compare">
            <TelemetryCompare />
          </ErrorBoundary>
        </div>
        <div className="h-[460px] min-h-0 xl:h-auto xl:max-h-[640px]">
          <ErrorBoundary name="Championship">
            <Championship />
          </ErrorBoundary>
        </div>
      </div>
      <div>
        <ErrorBoundary name="Race engineer">
          <RaceEngineer />
        </ErrorBoundary>
      </div>
    </div>
  );
}
