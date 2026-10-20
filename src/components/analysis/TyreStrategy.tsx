import { useMemo } from "react";
import type { DriverState, LapRecord } from "../../data/types";
import { useDashboard, useSnap } from "../../state/store";
import { MISSING } from "../../lib/format";
import { Panel } from "../common/Panel";
import { TyreIcon } from "../common/TyreIcon";

export const COMPOUND_COLOR: Record<string, string> = {
  SOFT: "#ff3b3b",
  MEDIUM: "#ffd02b",
  HARD: "#f2f2f2",
  INTERMEDIATE: "#3ccf4e",
  WET: "#2f8cff",
};

interface Stint {
  compound: string | null;
  from: number;
  to: number;
}

/** Group completed laps into stints, and extend the last one to the lap in progress. */
function stintsOf(recs: LapRecord[], d: DriverState): Stint[] {
  const out: Stint[] = [];
  for (const r of recs) {
    const last = out[out.length - 1];
    if (!last || r.pitOut || r.compound !== last.compound) out.push({ compound: r.compound, from: r.lap, to: r.lap });
    else last.to = r.lap;
  }
  if (!d.retired && d.lapNumber != null) {
    const last = out[out.length - 1];
    if (last && last.compound === d.tyre.compound) last.to = Math.max(last.to, d.lapNumber);
    else out.push({ compound: d.tyre.compound, from: (last?.to ?? 0) + 1, to: d.lapNumber });
  }
  return out;
}

const ROW = 20;
const LABEL_W = 44;

/** Each driver's stints as compound-coloured bars across the race distance. */
export function TyreStrategy() {
  const order = useSnap((s) => s.order);
  const drivers = useSnap((s) => s.drivers);
  const history = useSnap((s) => s.history);
  const total = useSnap((s) => s.lap.total);
  const current = useSnap((s) => s.lap.current);
  const setHovered = useDashboard((s) => s.setHovered);
  const rows = useMemo(
    () => order.filter((n) => drivers[n]).map((n) => ({ d: drivers[n], stints: stintsOf(history[n] ?? [], drivers[n]) })),
    [order, drivers, history],
  );
  const laps = total ?? Math.max(1, current ?? 1, ...rows.flatMap((r) => r.stints.map((s) => s.to)));
  const pct = (lap: number) => `${((lap - 1) / laps) * 100}%`;
  const width = (s: Stint) => `calc(${((s.to - s.from + 1) / laps) * 100}% - 2px)`;

  return (
    <Panel title="Tyre strategy" right={<Compounds />} bodyClassName="overflow-y-auto p-3">
      <div className="flex flex-col gap-[3px]">
        {rows.map(({ d, stints }) => (
          <div
            key={d.number}
            className={`flex items-center ${d.retired ? "opacity-40" : ""}`}
            style={{ height: ROW }}
            onMouseEnter={(e) => setHovered({ driver: d.number, x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold text-white/85" style={{ width: LABEL_W }}>
              <span className="h-3 w-1 rounded-full" style={{ background: d.teamColor }} />
              {d.code}
            </span>
            <div className="relative h-3 flex-1 rounded-sm bg-white/[0.03]">
              {stints.map((s, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full rounded"
                  style={{ left: pct(s.from), width: width(s), background: s.compound ? COMPOUND_COLOR[s.compound] ?? "#5b5b66" : "#5b5b66" }}
                  title={`${d.code} · ${s.compound ?? "Unknown"} · laps ${s.from}–${s.to} (${s.to - s.from + 1} laps)`}
                />
              ))}
              {current != null && <div className="absolute -top-0.5 h-4 w-px bg-cyan-glow/60" style={{ left: pct(current + 1) }} />}
            </div>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-white/35">{MISSING}</p>}
      </div>
      <div className="mt-2 flex justify-between pl-11 font-mono text-[10px] text-white/35">
        <span>Lap 1</span>
        <span>Lap {laps}</span>
      </div>
    </Panel>
  );
}

function Compounds() {
  return (
    <div className="flex items-center gap-2">
      {["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"].map((c) => (
        <span key={c} className="flex items-center gap-1 text-[10px] text-white/45" title={c}>
          <TyreIcon compound={c} size={14} />
        </span>
      ))}
    </div>
  );
}
