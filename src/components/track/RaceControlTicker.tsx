import { useSnap } from "../../state/store";

const FLAG_COLORS: Record<string, string> = {
  GREEN: "#22c55e",
  CLEAR: "#22c55e",
  YELLOW: "#facc15",
  "DOUBLE YELLOW": "#facc15",
  RED: "#ef4444",
  BLUE: "#3b82f6",
  CHEQUERED: "#ffffff",
  "BLACK AND WHITE": "#ffffff",
};

/** Latest race-control messages, overlaid on the bottom of the map. */
export function RaceControlTicker() {
  const messages = useSnap((s) => s.raceControl);
  const weather = useSnap((s) => s.weather);
  const latest = messages.slice(0, 3);
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
      <ul className="flex min-w-0 flex-col gap-1">
        {latest.length === 0 && <li className="text-[11px] text-white/30">Race control --</li>}
        {latest.map((m, i) => (
          <li
            key={m.id}
            className="flex min-w-0 items-center gap-2 rounded-md border border-white/[0.06] bg-ink-950/80 px-2 py-1 text-[11px] backdrop-blur"
            style={{ opacity: 1 - i * 0.28 }}
          >
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: (m.flag && FLAG_COLORS[m.flag]) || "#22e5ff" }} />
            <span className="shrink-0 font-mono text-white/40">{m.lap != null ? `L${m.lap}` : "--"}</span>
            <span className="truncate text-white/80">{m.message || "--"}</span>
          </li>
        ))}
      </ul>
      <div className="hidden shrink-0 rounded-md border border-white/[0.06] bg-ink-950/80 px-2 py-1 font-mono text-[10px] text-white/50 backdrop-blur md:block">
        WIND {weather?.windSpeed != null ? `${weather.windSpeed.toFixed(1)} m/s` : "--"}
      </div>
    </div>
  );
}
