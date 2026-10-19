import { memo, useState } from "react";
import { useDashboard, useSnap } from "../../state/store";
import type { DriverState, SectorStatus } from "../../data/types";
import { fmtGap, fmtLap, fmtSector, isLeaderGap, MISSING } from "../../lib/format";
import { Panel } from "../common/Panel";
import { TyreIcon } from "../common/TyreIcon";

const SECTOR_CLASS: Record<string, string> = {
  purple: "text-sector-purple",
  green: "text-sector-green",
  yellow: "text-sector-yellow",
};
const SECTOR_BAR: Record<string, string> = {
  purple: "bg-sector-purple",
  green: "bg-sector-green",
  yellow: "bg-sector-yellow",
};

function SectorCell({ value, status }: { value: number | null; status: SectorStatus }) {
  return (
    <div className="relative flex flex-col items-end">
      <span className={`font-mono text-[12px] tabular-nums ${status ? SECTOR_CLASS[status] : "text-white/35"}`}>{fmtSector(value)}</span>
      <span className={`mt-0.5 h-[2px] w-full rounded-full ${status ? SECTOR_BAR[status] : "bg-white/5"}`} />
    </div>
  );
}

const GRID = "grid grid-cols-[28px_4px_minmax(0,1fr)_76px_74px_52px_52px_52px_30px] items-center gap-x-2";

const Row = memo(function Row({ d, showGap }: { d: DriverState; showGap: boolean }) {
  const setHovered = useDashboard((s) => s.setHovered);
  const hovered = useDashboard((s) => s.hovered?.driver === d.number);
  const value = showGap ? d.gapToLeader : d.interval;
  const leader = d.position === 1 || isLeaderGap(value);
  let gapText = d.retired ? "OUT" : leader ? "LEADER" : fmtGap(value);
  if (!d.retired && d.inPit) gapText = "PIT";
  const personalBestLap = d.lastLap != null && d.bestLap != null && Math.abs(d.lastLap - d.bestLap) < 1e-6;

  return (
    <div
      className={`${GRID} h-[30px] cursor-default rounded-md px-2 transition-colors ${
        d.retired ? "opacity-35 grayscale" : ""
      } ${hovered ? "bg-cyan-glow/[0.08]" : "hover:bg-white/[0.04]"}`}
      onMouseEnter={(e) => setHovered({ driver: d.number, x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setHovered({ driver: d.number, x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setHovered(null)}
    >
      <span className="text-right font-mono text-[13px] font-semibold tabular-nums text-white/90">{d.position ?? MISSING}</span>
      <span className="h-5 w-1 rounded-full" style={{ background: d.teamColor, boxShadow: `0 0 8px ${d.teamColor}66` }} />
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-[13px] font-bold tracking-wide text-white">{d.code}</span>
        <span className="truncate text-[11px] text-white/35">{d.team}</span>
      </div>
      <span
        className={`text-right font-mono text-[12px] tabular-nums ${
          d.retired ? "font-bold text-white/60" : gapText === "PIT" ? "font-bold text-cyan-glow" : leader ? "text-cyan-glow/80" : "text-white/80"
        }`}
      >
        {gapText}
      </span>
      <span className={`text-right font-mono text-[12px] tabular-nums ${personalBestLap ? "text-sector-green" : "text-white/80"}`}>
        {fmtLap(d.lastLap)}
      </span>
      {[0, 1, 2].map((j) => (
        <SectorCell key={j} value={d.sectors[j]} status={d.sectorStatus[j]} />
      ))}
      <div className="flex items-center justify-end gap-1" title={`${d.tyre.compound ?? "Unknown"} · ${d.tyre.age ?? MISSING} laps`}>
        <TyreIcon compound={d.tyre.compound} size={20} />
      </div>
    </div>
  );
});

export function TimingTower() {
  const order = useSnap((s) => s.order);
  const drivers = useSnap((s) => s.drivers);
  const lap = useSnap((s) => s.lap);
  const [showGap, setShowGap] = useState(false);

  return (
    <Panel
      title="Timing"
      right={
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-white/50">
            LAP <span className="text-white">{lap.current ?? MISSING}</span>
            <span className="text-white/30">/{lap.total ?? MISSING}</span>
          </span>
          <button
            className="rounded border border-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/60 hover:border-cyan-glow/50 hover:text-cyan-glow"
            onClick={() => setShowGap((g) => !g)}
            title="Toggle interval / gap to leader"
          >
            {showGap ? "Gap" : "Interval"}
          </button>
        </div>
      }
      bodyClassName="overflow-y-auto"
    >
      <div className={`${GRID} sticky top-0 z-10 h-7 border-b border-white/[0.04] bg-ink-900/95 px-2 text-[10px] font-semibold uppercase tracking-wider text-white/35`}>
        <span className="text-right">P</span>
        <span />
        <span>Driver</span>
        <span className="text-right">{showGap ? "Gap" : "Int"}</span>
        <span className="text-right">Last</span>
        <span className="text-right">S1</span>
        <span className="text-right">S2</span>
        <span className="text-right">S3</span>
        <span className="text-right">Tyre</span>
      </div>
      <div className="flex flex-col gap-[2px] p-1">
        {order.length === 0 && <div className="p-6 text-center text-sm text-white/40">Waiting for timing data… {MISSING}</div>}
        {order.map((n) => {
          const d = drivers[n];
          return d ? <Row key={n} d={d} showGap={showGap} /> : null;
        })}
      </div>
    </Panel>
  );
}
