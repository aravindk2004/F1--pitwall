import { useMemo, useState } from "react";
import { useSnap } from "../../state/store";
import { fmtLap } from "../../lib/format";
import { Panel } from "../common/Panel";
import { Legend, LineChart } from "./LineChart";
import { buildSeries } from "./series";

type Tab = "gap" | "position" | "laps";
const TABS: Array<[Tab, string]> = [
  ["gap", "Gap to leader"],
  ["position", "Positions"],
  ["laps", "Lap times"],
];

/** Race trace, position changes and lap-time scatter for the drivers in focus. */
export function RaceCharts({ focus }: { focus: Set<number> }) {
  const [tab, setTab] = useState<Tab>("gap");
  const order = useSnap((s) => s.order);
  const drivers = useSnap((s) => s.drivers);
  const history = useSnap((s) => s.history);
  const lap = useSnap((s) => s.lap.current);

  const { series, yDomain, invert, fmt, note } = useMemo(() => {
    if (tab === "position") {
      return {
        series: buildSeries(order, drivers, history, focus, (r) => r.position),
        yDomain: [1, Math.max(2, order.length)] as [number, number],
        invert: true,
        fmt: (v: number) => `P${Math.round(v)}`,
        note: null,
      };
    }
    if (tab === "laps") {
      const series = buildSeries(order, drivers, history, focus, (r) => (r.pitIn || r.pitOut || r.lap === 1 ? null : r.time));
      const all = series.flatMap((s) => s.points.map((p) => p[1]));
      const fastest = all.length ? Math.min(...all) : 60;
      return {
        series,
        yDomain: [fastest - 0.3, fastest * 1.07] as [number, number],
        invert: false,
        fmt: (v: number) => fmtLap(v),
        note: "Pit laps, lap 1 and laps more than 7% off the fastest (safety car, incidents) are left out.",
      };
    }
    const series = buildSeries(order, drivers, history, focus, (r) => r.gap);
    const focused = series.filter((s) => s.emphasis).flatMap((s) => s.points.map((p) => p[1]));
    const max = Math.min(120, Math.max(5, ...(focused.length ? focused : series.flatMap((s) => s.points.map((p) => p[1])))));
    return {
      series,
      yDomain: [0, max * 1.05] as [number, number],
      invert: true,
      fmt: (v: number) => (v === 0 ? "0" : `+${v.toFixed(v < 10 ? 1 : 0)}s`),
      note: "Gap to the leader each time a car crosses the line. Lapped cars drop out of the chart.",
    };
  }, [tab, order, drivers, history, focus]);

  const empty = series.every((s) => s.points.length === 0);
  return (
    <Panel
      title="Race charts"
      right={
        <div className="flex rounded-md border border-white/10 p-0.5 text-[10px] font-semibold uppercase tracking-wider" role="tablist">
          {TABS.map(([t, label]) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`rounded px-2 py-0.5 ${tab === t ? "bg-cyan-glow/15 text-cyan-glow" : "text-white/45 hover:text-white/80"}`}
            >
              {label}
            </button>
          ))}
        </div>
      }
      bodyClassName="flex flex-col gap-2 p-3"
    >
      <Legend series={series} />
      {empty ? (
        <div className="grid h-[240px] place-items-center text-sm text-white/35">Charts fill in as laps are completed · --</div>
      ) : (
        <LineChart
          series={series}
          invertY={invert}
          yDomain={yDomain}
          xLabel="Lap"
          yFormat={fmt}
          dots={tab === "laps"}
          markerX={lap}
          ariaLabel={TABS.find(([t]) => t === tab)![1]}
        />
      )}
      {note && <p className="text-[10px] text-white/35">{note}</p>}
    </Panel>
  );
}
