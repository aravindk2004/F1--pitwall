import { useMemo, useState } from "react";
import { useSnap } from "../../state/store";
import { championshipAsItStands } from "../../insights";
import { teamColor } from "../../data/records";
import { MISSING } from "../../lib/format";
import { Panel } from "../common/Panel";

const pts = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function Change({ value }: { value: number }) {
  if (value === 0) return <span className="text-white/25">–</span>;
  return value > 0 ? <span className="text-sector-green">▲{value}</span> : <span className="text-red-400">▼{-value}</span>;
}

/** Championship if the race finished in the current order. */
export function Championship() {
  const [tab, setTab] = useState<"drivers" | "teams">("drivers");
  const standings = useSnap((s) => s.standings);
  const order = useSnap((s) => s.order);
  const drivers = useSnap((s) => s.drivers);
  const table = useMemo(() => (standings ? championshipAsItStands(standings, order, drivers) : null), [standings, order, drivers]);
  const teamColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of Object.values(drivers)) m.set(d.team, d.teamColor);
    return m;
  }, [drivers]);

  return (
    <Panel
      title="Championship · as it stands"
      right={
        <div className="flex rounded-md border border-white/10 p-0.5 text-[10px] font-semibold uppercase tracking-wider" role="tablist">
          {(["drivers", "teams"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded px-2 py-0.5 ${tab === t ? "bg-cyan-glow/15 text-cyan-glow" : "text-white/45 hover:text-white/80"}`}
            >
              {t}
            </button>
          ))}
        </div>
      }
      bodyClassName="overflow-auto"
    >
      {!table ? (
        <p className="p-6 text-center text-sm text-white/40">Standings before this race aren't available · --</p>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-ink-900 text-[10px] uppercase tracking-wider text-white/35">
            <tr>
              <th className="px-2 py-1.5 text-right font-semibold">Pos</th>
              <th className="px-1 py-1.5" />
              <th className="px-2 py-1.5 text-left font-semibold">{tab === "drivers" ? "Driver" : "Team"}</th>
              <th className="px-2 py-1.5 text-right font-semibold">Before</th>
              <th className="px-2 py-1.5 text-right font-semibold">Race</th>
              <th className="px-2 py-1.5 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {(tab === "drivers"
              ? table.drivers.map((r) => ({ ...r, name: r.code, color: r.number != null ? drivers[r.number]?.teamColor : undefined }))
              : table.teams.map((r) => ({ ...r, name: r.team, color: teamColors.get(r.team) ?? teamColor(null, r.team) }))
            )
              .slice(0, 22)
              .map((r) => {
              const { name, color } = r;
              return (
                <tr key={`${name}-${r.position}`} className="border-t border-white/[0.04]">
                  <td className="px-2 py-1 text-right text-white/70">{r.position}</td>
                  <td className="w-8 px-1 py-1 text-center text-[10px]">
                    <Change value={r.change} />
                  </td>
                  <td className="px-2 py-1 font-sans font-semibold text-white">
                    <span className="mr-1.5 inline-block h-3 w-1 rounded-full align-middle" style={{ background: color ?? "#5b5b66" }} />
                    {name || MISSING}
                  </td>
                  <td className="px-2 py-1 text-right text-white/50">{pts(r.before)}</td>
                  <td className="px-2 py-1 text-right text-white/80">{r.gained ? `+${pts(r.gained)}` : "–"}</td>
                  <td className="px-2 py-1 text-right font-bold text-white">{pts(r.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {table && <p className="px-3 py-2 text-[10px] text-white/35">Race points for the current top 10 (25-18-15-12-10-8-6-4-2-1).</p>}
    </Panel>
  );
}
