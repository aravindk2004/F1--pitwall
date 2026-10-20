import { useDashboard, useSnap } from "../../state/store";
import { MISSING } from "../../lib/format";
import { Panel } from "../common/Panel";
import { TyreIcon } from "../common/TyreIcon";

const Flag = ({ children, tone }: { children: string; tone: "amber" | "red" }) => (
  <span
    className={`ml-1 rounded px-1 text-[9px] font-bold ${tone === "red" ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300"}`}
  >
    {children}
  </span>
);

/** For every car: tyres, wear rate, where it would rejoin from a stop now, and its gap trend. */
export function StrategyTable() {
  const order = useSnap((s) => s.order);
  const drivers = useSnap((s) => s.drivers);
  const insights = useDashboard((s) => s.insights);
  const toggleSelected = useDashboard((s) => s.toggleSelected);
  const selected = useDashboard((s) => s.selected);
  const code = (n: number | null | undefined) => (n != null ? (drivers[n]?.code ?? String(n)) : MISSING);

  return (
    <Panel
      title="Strategy"
      right={
        <span className="text-[10px] text-white/40" title="Time a pit stop costs at this circuit">
          Pit loss {insights ? `${insights.pitLoss.toFixed(1)} s${insights.pitLossMeasured ? "" : " (typical)"}` : MISSING}
        </span>
      }
      bodyClassName="overflow-auto"
    >
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-ink-900 text-[10px] uppercase tracking-wider text-white/35">
          <tr>
            <th className="px-2 py-1.5 text-right font-semibold">P</th>
            <th className="px-2 py-1.5 text-left font-semibold">Driver</th>
            <th className="px-2 py-1.5 text-left font-semibold">Tyre</th>
            <th className="px-2 py-1.5 text-right font-semibold" title="Lap time lost per lap of tyre wear, fuel effect removed">
              Wear /lap
            </th>
            <th className="px-2 py-1.5 text-left font-semibold">Pit now</th>
            <th className="px-2 py-1.5 text-left font-semibold">Car ahead</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {order.map((n) => {
            const d = drivers[n];
            if (!d) return null;
            const pace = insights?.pace[n];
            const pit = insights?.pit[n];
            const trend = insights?.trends[n];
            return (
              <tr
                key={n}
                onClick={() => toggleSelected(n)}
                className={`cursor-pointer border-t border-white/[0.04] hover:bg-white/[0.03] ${d.retired ? "opacity-35" : ""} ${
                  selected === n ? "bg-cyan-glow/[0.06]" : ""
                }`}
              >
                <td className="px-2 py-1 text-right text-white/70">{d.position ?? MISSING}</td>
                <td className="px-2 py-1 font-sans font-bold text-white">
                  <span className="mr-1.5 inline-block h-3 w-1 rounded-full align-middle" style={{ background: d.teamColor }} />
                  {d.code}
                </td>
                <td className="px-2 py-1">
                  <span className="flex items-center gap-1.5 text-white/75">
                    <TyreIcon compound={d.tyre.compound} size={14} />
                    {d.tyre.age ?? MISSING}
                  </span>
                </td>
                <td className="px-2 py-1 text-right text-white/80">
                  {d.retired ? MISSING : pace?.degradation == null ? MISSING : `${pace.degradation >= 0 ? "+" : ""}${pace.degradation.toFixed(2)}`}
                  {pace?.cliff && <Flag tone="red">OFF</Flag>}
                </td>
                <td className="px-2 py-1 text-white/80">
                  {d.retired || !pit ? MISSING : `P${pit.rejoinPosition}`}
                  {pit && !d.retired && pit.carAhead && <span className="text-white/40"> · {code(pit.carAhead.driver)} +{pit.carAhead.margin.toFixed(1)}</span>}
                  {pit && !d.retired && pit.traffic && <Flag tone="amber">TRAFFIC</Flag>}
                </td>
                <td className="px-2 py-1 text-white/80">
                  {d.retired || trend?.ahead == null || trend.ratePerLap == null
                    ? trend?.battle
                      ? "Battle"
                      : MISSING
                    : trend.ratePerLap < -0.05
                      ? `▼ ${(-trend.ratePerLap).toFixed(2)}${trend.lapsToCatch ? ` · ${trend.lapsToCatch}L` : ""}`
                      : trend.ratePerLap > 0.05
                        ? `▲ ${trend.ratePerLap.toFixed(2)}`
                        : "Holding"}
                  {trend?.battle && trend.ratePerLap != null && <Flag tone="amber">BATTLE</Flag>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-3 py-2 font-sans text-[10px] text-white/35">
        ▼ closing on the car ahead (s/lap, laps until within 1 s) · ▲ dropping back. Wear is estimated from clean laps in the
        current stint.
      </p>
    </Panel>
  );
}
