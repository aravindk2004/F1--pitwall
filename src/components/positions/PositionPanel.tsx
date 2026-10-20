import { useEffect, useRef, useState } from "react";
import { STAT_VIEWS, useDashboard, useSnap } from "../../state/store";
import { useDriverHover } from "../../hooks/useDriverHover";
import type { CarTelemetry, DriverState } from "../../data/types";
import { fmtGap, fmtLap, isLeaderGap, MISSING } from "../../lib/format";
import { Panel } from "../common/Panel";

function statValue(view: number, d: DriverState, car: CarTelemetry | undefined): string {
  if (d.retired) return "OUT";
  switch (view) {
    case 0:
      return d.position === 1 || isLeaderGap(d.gapToLeader) ? "LEADER" : fmtGap(d.gapToLeader);
    case 1:
      return d.tyre.age != null ? `${d.tyre.age} L` : MISSING;
    case 2:
      return car?.speed != null ? `${Math.round(car.speed)}` : MISSING;
    case 3:
      return fmtLap(d.lastLap);
    case 4:
      return d.pitStops != null ? String(d.pitStops) : MISSING;
    default:
      return MISSING;
  }
}

const TICK_MS = 100;

export function PositionPanel() {
  const order = useSnap((s) => s.order);
  const drivers = useSnap((s) => s.drivers);
  // Speed changes every frame; only subscribe to car data while that view is up.
  const view = useDashboard((s) => s.view);
  const car = useDashboard((s) => (s.view === 2 ? s.snapshot.car : null));
  const cycleSeconds = useDashboard((s) => s.cycleSeconds);
  const paused = useDashboard((s) => s.cyclePaused);
  const { nextView, setView, setCycleSeconds, toggleCyclePaused } = useDashboard.getState();
  const hover = useDriverHover();
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);

  useEffect(() => {
    elapsedRef.current = 0;
    setElapsed(0);
  }, [view, cycleSeconds]);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      elapsedRef.current += TICK_MS;
      if (elapsedRef.current >= cycleSeconds * 1000) {
        elapsedRef.current = 0;
        nextView();
      }
      setElapsed(elapsedRef.current);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [paused, cycleSeconds, nextView]);

  const progress = Math.min(1, elapsed / (cycleSeconds * 1000));

  return (
    <Panel
      title="Positions"
      className="w-full"
      right={
        <button
          onClick={toggleCyclePaused}
          className={`grid h-6 w-6 place-items-center rounded border ${paused ? "border-cyan-glow/60 text-cyan-glow" : "border-white/10 text-white/60 hover:text-white"}`}
          title={paused ? "Resume cycling (Space)" : "Pause cycling (Space)"}
          aria-label={paused ? "Resume cycling" : "Pause cycling"}
        >
          {paused ? (
            <svg width="10" height="10" viewBox="0 0 12 12"><path d="M3 1.5 L10.5 6 L3 10.5 Z" fill="currentColor" /></svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 12 12"><rect x="2" y="1.5" width="3" height="9" rx="1" fill="currentColor" /><rect x="7" y="1.5" width="3" height="9" rx="1" fill="currentColor" /></svg>
          )}
        </button>
      }
      bodyClassName="flex flex-col"
    >
      <div className="shrink-0 border-b border-white/[0.06] px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-cyan-glow">{STAT_VIEWS[view]}</span>
          <span className="font-mono text-[10px] text-white/35">{view + 1}/{STAT_VIEWS.length}</span>
        </div>
        <div className="mt-2 flex gap-1">
          {STAT_VIEWS.map((label, i) => (
            <button
              key={label}
              onClick={() => setView(i)}
              title={`${label} (${i + 1})`}
              aria-label={`Show ${label}`}
              className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/[0.08]"
            >
              <span
                className="absolute inset-y-0 left-0 bg-cyan-glow"
                style={{ width: i < view ? "100%" : i === view ? `${progress * 100}%` : "0%", opacity: i < view ? 0.35 : 1 }}
              />
            </button>
          ))}
        </div>
      </div>

      <ol className="min-h-0 flex-1 overflow-y-auto p-1">
        {order.length === 0 && <li className="p-4 text-center text-xs text-white/35">{MISSING}</li>}
        {order.map((n) => {
          const d = drivers[n];
          if (!d) return null;
          return (
            <li
              key={n}
              className={`flex h-[26px] items-center gap-2 rounded px-2 hover:bg-white/[0.04] ${d.retired ? "opacity-35 grayscale" : ""}`}
              {...hover(n)}
            >
              <span className="w-5 text-right font-mono text-[12px] text-white/70">{d.position ?? MISSING}</span>
              <span className="h-4 w-1 rounded-full" style={{ background: d.teamColor }} />
              <span className="flex-1 text-[12px] font-bold text-white">{d.code}</span>
              <span className="font-mono text-[12px] tabular-nums text-white/85">{statValue(view, d, car?.[n])}</span>
            </li>
          );
        })}
      </ol>

      <div className="shrink-0 border-t border-white/[0.06] px-3 py-2.5">
        <label className="flex items-center justify-between text-[10px] uppercase tracking-wider text-white/40">
          <span>Cycle every</span>
          <span className="font-mono text-white/70">{cycleSeconds}s</span>
        </label>
        <input
          type="range"
          min={3}
          max={20}
          step={1}
          value={cycleSeconds}
          onChange={(e) => setCycleSeconds(Number(e.target.value))}
          className="range mt-1.5 w-full"
          aria-label="Cycle interval in seconds"
        />
      </div>
    </Panel>
  );
}
