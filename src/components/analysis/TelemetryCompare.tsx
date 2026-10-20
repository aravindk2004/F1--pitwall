import { useEffect, useMemo, useState } from "react";
import { useDataSource } from "../../data/context";
import { trackGeometry } from "../../data/track";
import type { LapTrace } from "../../data/types";
import { useDashboard, useSnap } from "../../state/store";
import { fmtLap, MISSING } from "../../lib/format";
import { Panel } from "../common/Panel";
import { Legend, LineChart, type Series } from "./LineChart";
import { dashedDrivers } from "./series";

/** Half-width of the window around a corner in which to look for the minimum speed (lap fraction). */
const CORNER_WINDOW = 0.012;

/** Overlay two drivers' speed and throttle over one lap, with minimum speed per corner. */
export function TelemetryCompare() {
  const source = useDataSource();
  const order = useSnap((s) => s.order);
  const drivers = useSnap((s) => s.drivers);
  const history = useSnap((s) => s.history);
  const track = useSnap((s) => s.track);
  const session = useSnap((s) => s.session);
  const selected = useDashboard((s) => s.selected);

  const running = order.filter((n) => drivers[n] && (history[n]?.length ?? 0) > 0);
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const [lap, setLap] = useState<number | null>(null);
  const da = a ?? selected ?? running[0] ?? null;
  const db = b ?? running.find((n) => n !== da) ?? null;

  const laps = useMemo(() => {
    if (da == null || db == null) return [];
    const other = new Set((history[db] ?? []).map((r) => r.lap));
    return (history[da] ?? [])
      .filter((r) => other.has(r.lap) && r.lap > 1)
      .map((r) => r.lap)
      .reverse();
  }, [da, db, history]);
  const theLap = lap != null && laps.includes(lap) ? lap : (laps[0] ?? null);

  const [traces, setTraces] = useState<{ key: string; a: LapTrace | null; b: LapTrace | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const key = `${session?.key}-${da}-${db}-${theLap}`;
  useEffect(() => {
    if (!source?.lapTrace || da == null || db == null || theLap == null) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([source.lapTrace(da, theLap), source.lapTrace(db, theLap)])
      .then(([ta, tb]) => !cancelled && setTraces({ key, a: ta, b: tb }))
      .catch(() => !cancelled && setTraces({ key, a: null, b: null }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [source, da, db, theLap, key]);

  const km = session?.lengthKm ?? null;
  const toX = (f: number) => (km ? f * km : f * 100);
  const corners = useMemo(() => {
    const geo = trackGeometry(track);
    if (!geo || !track?.corners) return [];
    return track.corners
      .map((c) => ({ label: c.label, f: geo.fractionOf(c) }))
      .filter((c): c is { label: string; f: number } => c.f != null)
      .sort((x, y) => x.f - y.f);
  }, [track]);

  const current = traces?.key === key ? traces : null;
  const dashed = dashedDrivers(drivers);
  const mk = (t: LapTrace | null | undefined, n: number | null, pick: (s: LapTrace["samples"][number]) => number | null): Series | null =>
    t && n != null
      ? {
          id: n,
          label: drivers[n]?.code ?? String(n),
          // Teammates share a colour; the second one is dashed.
          color: drivers[n]?.teamColor ?? "#8a8a96",
          dashed: n === db && (dashed.has(n) || drivers[da!]?.team === drivers[n]?.team),
          emphasis: true,
          points: t.samples.map((s) => [toX(s.x), pick(s)] as [number, number | null]).filter((p): p is [number, number] => p[1] != null),
        }
      : null;
  const speed = [mk(current?.a, da, (s) => s.speed), mk(current?.b, db, (s) => s.speed)].filter((s): s is Series => s != null);
  const throttle = [mk(current?.a, da, (s) => s.throttle), mk(current?.b, db, (s) => s.throttle)].filter((s): s is Series => s != null);

  const minSpeed = (t: LapTrace | null | undefined, f: number) => {
    const vals = (t?.samples ?? []).filter((s) => Math.abs(s.x - f) <= CORNER_WINDOW && s.speed != null).map((s) => s.speed!);
    return vals.length ? Math.min(...vals) : null;
  };
  const lapTime = (n: number | null) => (n != null && theLap != null ? history[n]?.find((r) => r.lap === theLap)?.time ?? null : null);

  const select = (value: number | null, set: (n: number) => void, label: string, id: string) => (
    <select id={id} className="select w-20" value={value ?? ""} onChange={(e) => set(Number(e.target.value))} aria-label={label}>
      {running.map((n) => (
        <option key={n} value={n}>
          {drivers[n].code}
        </option>
      ))}
    </select>
  );

  return (
    <Panel
      title="Telemetry compare"
      right={
        <div className="flex items-center gap-1.5">
          {select(da, setA, "First driver", "tc-a")}
          <span className="text-[10px] text-white/40">vs</span>
          {select(db, setB, "Second driver", "tc-b")}
          <select id="tc-lap" className="select w-20" value={theLap ?? ""} onChange={(e) => setLap(Number(e.target.value))} aria-label="Lap">
            {laps.map((l) => (
              <option key={l} value={l}>
                Lap {l}
              </option>
            ))}
          </select>
        </div>
      }
      bodyClassName="flex flex-col gap-2 p-3"
    >
      {!source?.lapTrace ? (
        <p className="py-8 text-center text-sm text-white/40">Telemetry comparison works in Replay and Mock modes.</p>
      ) : theLap == null ? (
        <p className="py-8 text-center text-sm text-white/40">Needs a lap completed by both drivers · --</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/60">
            <Legend series={speed} />
            <span className="font-mono">
              {drivers[da!]?.code} {fmtLap(lapTime(da))} · {drivers[db!]?.code} {fmtLap(lapTime(db))}
            </span>
          </div>
          {loading && !current ? (
            <div className="grid h-[200px] place-items-center text-sm text-white/40">Loading telemetry…</div>
          ) : speed.length === 0 ? (
            <div className="grid h-[200px] place-items-center text-sm text-white/40">No telemetry for this lap · --</div>
          ) : (
            <>
              <LineChart
                series={speed}
                continuous
                xLabel={km ? "km" : "% lap"}
                xFormat={(v) => (km ? v.toFixed(1) : `${Math.round(v)}`)}
                yFormat={(v) => `${Math.round(v)}`}
                xMarks={corners.map((c) => ({ x: toX(c.f), label: c.label }))}
                height={200}
                ariaLabel="Speed in km/h along the lap"
              />
              <LineChart
                series={throttle}
                continuous
                xLabel={km ? "km" : "% lap"}
                xFormat={(v) => (km ? v.toFixed(1) : `${Math.round(v)}`)}
                yFormat={(v) => `${Math.round(v)}%`}
                yDomain={[0, 100]}
                height={100}
                ariaLabel="Throttle percentage along the lap"
              />
              {corners.length > 0 && (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-white/35">Minimum speed per corner (km/h)</div>
                  <div className="flex flex-wrap gap-1">
                    {corners.map((c) => {
                      const va = minSpeed(current?.a, c.f), vb = minSpeed(current?.b, c.f);
                      const faster = va != null && vb != null && Math.abs(va - vb) >= 2 ? (va > vb ? "a" : "b") : null;
                      return (
                        <span key={c.label} className="rounded border border-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-white/55">
                          T{c.label}{" "}
                          <span className={faster === "a" ? "font-bold text-white" : ""}>{va ?? MISSING}</span>/
                          <span className={faster === "b" ? "font-bold text-white" : ""}>{vb ?? MISSING}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </Panel>
  );
}
