import { useDashboard } from "../../state/store";
import { fmtGap, fmtNum, isLeaderGap, MISSING } from "../../lib/format";
import { TyreIcon } from "../common/TyreIcon";
import { Speedometer } from "./Speedometer";

const CARD_W = 300;
const CARD_H = 470;
const MAX_RPM = 13000;

function DrsPill({ drs }: { drs: number | null }) {
  const state = drs == null ? "unknown" : drs >= 10 ? "open" : drs === 8 ? "eligible" : "off";
  const cls = {
    open: "bg-sector-green text-black shadow-[0_0_12px_#22c55e]",
    eligible: "border border-sector-green/70 text-sector-green",
    off: "border border-white/10 text-white/35",
    unknown: "border border-white/10 text-white/25",
  }[state];
  return <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold tracking-[0.2em] ${cls}`}>DRS{state === "unknown" ? " --" : ""}</span>;
}

function VBar({ label, value, color }: { label: string; value: number | null; color: string }) {
  const pct = value != null && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-24 w-3.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="absolute inset-x-0 bottom-0 rounded-full transition-[height] duration-200" style={{ height: `${pct}%`, background: color, boxShadow: `0 0 10px ${color}` }} />
      </div>
      <span className="text-[9px] font-semibold uppercase tracking-wider text-white/40">{label}</span>
      <span className="font-mono text-[10px] text-white/70">{value != null ? Math.round(value) : MISSING}</span>
    </div>
  );
}

/** Floating telemetry card for whichever driver is under the pointer. */
export function DriverHoverCard() {
  const hovered = useDashboard((s) => s.hovered);
  const d = useDashboard((s) => (s.hovered ? s.snapshot.drivers[s.hovered.driver] : undefined));
  const car = useDashboard((s) => (s.hovered ? s.snapshot.car[s.hovered.driver] : undefined));
  const pace = useDashboard((s) => (s.hovered ? s.insights?.pace[s.hovered.driver] : undefined));
  const pit = useDashboard((s) => (s.hovered ? s.insights?.pit[s.hovered.driver] : undefined));
  const trend = useDashboard((s) => (s.hovered ? s.insights?.trends[s.hovered.driver] : undefined));
  const allDrivers = useDashboard((s) => s.snapshot.drivers);
  const codeOf = (n: number | null | undefined) => (n != null ? (allDrivers[n]?.code ?? String(n)) : MISSING);
  if (!hovered) return null;

  const vw = typeof window !== "undefined" ? window.innerWidth : 1600;
  const vh = typeof window !== "undefined" ? window.innerHeight : 900;
  let left = hovered.x + 18;
  if (left + CARD_W > vw - 8) left = hovered.x - CARD_W - 18;
  // Keep the card below the top bar (title row + playback row).
  const minTop = 108;
  const top = Math.max(minTop, Math.min(hovered.y - CARD_H / 2, vh - CARD_H - 8));
  const color = d?.teamColor ?? "#8a8a96";
  const rpm = car?.rpm ?? null;
  const rpmPct = rpm != null ? Math.min(100, (rpm / MAX_RPM) * 100) : 0;
  const gap = d?.retired ? "OUT" : d?.position === 1 || isLeaderGap(d?.gapToLeader) ? "LEADER" : fmtGap(d?.gapToLeader);

  return (
    <div
      className="pointer-events-none fixed z-50 overflow-hidden rounded-2xl border border-white/10 bg-ink-900/95 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.9),0_0_0_1px_rgba(34,229,255,0.08)] backdrop-blur-xl"
      style={{ left, top, width: CARD_W }}
      role="tooltip"
    >
      <div className="h-1" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <div className="flex items-center gap-3 px-4 pt-3">
        <span className="font-mono text-2xl font-extrabold text-white">{d?.position ?? MISSING}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-extrabold tracking-wide text-white">{d?.code ?? hovered.driver}</span>
            <span className="font-mono text-xs text-white/40">#{hovered.driver}</span>
          </div>
          <div className="truncate text-[11px] text-white/45">{d ? `${d.name} · ${d.team}` : MISSING}</div>
        </div>
        <DrsPill drs={car?.drs ?? null} />
      </div>

      <div className="flex items-end gap-2 px-3">
        <div className="flex-1">
          <Speedometer speed={car?.speed ?? null} />
        </div>
        <div className="flex gap-2 pb-4">
          <VBar label="Thr" value={car?.throttle ?? null} color="#22c55e" />
          <VBar label="Brk" value={car?.brake ?? null} color="#ff2d55" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px border-t border-white/[0.06] bg-white/[0.06]">
        <Stat label="Gear" value={car?.gear != null ? (car.gear === 0 ? "N" : String(car.gear)) : MISSING} big />
        <Stat label="RPM" value={fmtNum(rpm)}>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${rpmPct}%`, background: rpmPct > 88 ? "#ff2d55" : "#22e5ff" }} />
          </div>
        </Stat>
        <Stat label="Gap" value={gap} />
        <div className="col-span-3 flex items-center gap-3 bg-ink-900 px-4 py-2.5">
          <TyreIcon compound={d?.tyre.compound ?? null} size={26} />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-white/40">Tyre</div>
            <div className="text-sm font-semibold text-white">{d?.tyre.compound ?? MISSING}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-white/40">Age</div>
            <div className="font-mono text-sm text-white">{d?.tyre.age != null ? `${d.tyre.age} lap${d.tyre.age === 1 ? "" : "s"}` : MISSING}</div>
          </div>
        </div>
        {!d?.retired && (
          <div className="col-span-3 flex flex-col gap-1.5 bg-ink-900 px-4 py-2.5 text-[11px]">
            <div className="text-[10px] uppercase tracking-wider text-white/40">Strategy</div>
            <StrategyLine label="Tyre wear">
              {pace?.degradation == null
                ? `${MISSING} (${pace?.laps ?? 0} clean laps)`
                : pace.degradation < 0
                  ? "Getting faster (track improving)"
                  : `+${pace.degradation.toFixed(2)} s/lap`}
              {pace?.cliff && <span className="ml-1.5 rounded bg-red-500/20 px-1 text-[9px] font-bold text-red-300">DROPPING OFF</span>}
            </StrategyLine>
            <StrategyLine label="Pit now">
              {pit ? (
                <>
                  P{pit.rejoinPosition}
                  {pit.carAhead && ` · ${pit.carAhead.margin.toFixed(1)} s behind ${codeOf(pit.carAhead.driver)}`}
                  {pit.traffic && <span className="ml-1.5 rounded bg-amber-500/20 px-1 text-[9px] font-bold text-amber-300">TRAFFIC</span>}
                  {pit.pressure && <span className="ml-1.5 rounded bg-amber-500/20 px-1 text-[9px] font-bold text-amber-300">PRESSURE</span>}
                </>
              ) : (
                MISSING
              )}
            </StrategyLine>
            <StrategyLine label="Car ahead">
              {trend?.ahead == null
                ? MISSING
                : trend.battle
                  ? `Battling ${codeOf(trend.ahead)}`
                  : trend.ratePerLap == null
                    ? MISSING
                    : trend.ratePerLap < -0.05
                      ? `Closing on ${codeOf(trend.ahead)} ${(-trend.ratePerLap).toFixed(2)} s/lap${trend.lapsToCatch ? ` · ~${trend.lapsToCatch} laps` : ""}`
                      : trend.ratePerLap > 0.05
                        ? `Losing ${trend.ratePerLap.toFixed(2)} s/lap to ${codeOf(trend.ahead)}`
                        : `Holding gap to ${codeOf(trend.ahead)}`}
            </StrategyLine>
          </div>
        )}
      </div>
    </div>
  );
}

function StrategyLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-16 shrink-0 text-white/40">{label}</span>
      <span className="min-w-0 text-white/85">{children}</span>
    </div>
  );
}

function Stat({ label, value, big, children }: { label: string; value: string; big?: boolean; children?: React.ReactNode }) {
  return (
    <div className="bg-ink-900 px-4 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
      <div className={`font-mono font-bold text-white ${big ? "text-xl" : "text-sm"}`}>{value}</div>
      {children}
    </div>
  );
}
