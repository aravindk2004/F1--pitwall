import { useDashboard, useSnap } from "../../state/store";
import type { Topic } from "../../data/types";
import { fmtNum, MISSING } from "../../lib/format";
import { ModeSwitch } from "./ModeSwitch";
import { ChangeRaceButton, ReplayControls } from "./ReplayControls";
import { StatusBadge } from "./StatusBadge";

const HEALTH_TOPICS: Topic[] = ["position", "laps", "intervals", "car_data", "location", "team_radio", "race_control", "weather"];

function TopicHealth() {
  const topics = useSnap((s) => s.topics);
  return (
    <div className="hidden items-center gap-1 2xl:flex" aria-label="Feed health">
      {HEALTH_TOPICS.map((t) => {
        const h = topics[t];
        const cls = !h ? "bg-white/15" : h.stale ? "bg-amber-400" : "bg-sector-green shadow-[0_0_6px_#22c55e]";
        return <span key={t} title={`${t}: ${!h ? "no data" : h.stale ? "stale" : "live"}`} className={`h-1.5 w-1.5 rounded-full ${cls}`} />;
      })}
    </div>
  );
}

/** Race name, circuit, place and date: what is being shown, at a glance. */
function RaceTitle() {
  const session = useSnap((s) => s.session);
  const lap = useSnap((s) => s.lap);
  if (!session) {
    return <span className="hidden text-[12px] text-white/40 md:inline">No race loaded · --</span>;
  }
  const date = session.date ? new Date(session.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;
  const where = [session.circuitFullName ?? session.circuit, [session.place, session.country].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="hidden min-w-0 flex-col leading-tight sm:flex" title={session.officialName ?? undefined}>
      <span className="flex items-baseline gap-2 truncate">
        {session.round != null && <span className="font-mono text-[10px] font-bold text-cyan-glow">R{session.round}</span>}
        <span className="truncate text-[14px] font-bold text-white">{session.name}</span>
        <span className="text-[11px] text-white/40">{session.session ?? ""}</span>
      </span>
      <span className="truncate font-mono text-[10px] text-white/45">
        {where || MISSING}
        {date ? ` · ${date}` : ""} · LAP {lap.current ?? MISSING}/{lap.total ?? MISSING}
      </span>
    </div>
  );
}

export function toggleFullscreen(): void {
  try {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  } catch {
    /* fullscreen not available */
  }
}

function Weather() {
  const weather = useSnap((s) => s.weather);
  return (
    <div className="hidden shrink-0 items-center gap-3 font-mono text-[11px] text-white/55 md:flex">
      <span title="Air temperature">AIR {fmtNum(weather?.airTemp, 1, "°")}</span>
      <span title="Track temperature">TRK {fmtNum(weather?.trackTemp, 1, "°")}</span>
      <span title="Humidity">HUM {fmtNum(weather?.humidity, 0, "%")}</span>
      {weather?.rainfall ? <span className="text-sky-400">RAIN</span> : null}
    </div>
  );
}

export function TopBar() {
  const status = useDashboard((s) => s.status);
  const mode = useDashboard((s) => s.mode);
  const loading = useSnap((s) => s.loading);
  const error = useSnap((s) => s.error);

  return (
    <div className="relative z-20 shrink-0 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur">
      <header className="flex h-14 items-center gap-4 px-4">
        <div className="flex shrink-0 items-center gap-1.5 text-lg font-black italic tracking-tight">
          <span className="text-white">F1</span>
          <span className="text-cyan-glow drop-shadow-[0_0_8px_#22e5ff]">//</span>
          <span className="text-white/70">PITWALL</span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <RaceTitle />
          {mode === "replay" && <ChangeRaceButton />}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {(loading || error) && (
            <span className={`hidden max-w-[260px] truncate text-[11px] lg:inline ${error ? "text-amber-300/90" : "text-white/50"}`} title={error ?? loading ?? ""}>
              {error ?? loading}
            </span>
          )}
          <TopicHealth />
          <StatusBadge status={status} />
          <ModeSwitch />
          <button
            onClick={toggleFullscreen}
            className="grid h-7 w-7 place-items-center rounded-md border border-white/10 text-white/60 hover:border-cyan-glow/50 hover:text-cyan-glow"
            title="Fullscreen (F)"
            aria-label="Toggle fullscreen"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 4V1h3M8 1h3v3M11 8v3H8M4 11H1V8" />
            </svg>
          </button>
        </div>
      </header>
      {/* Playback gets a full-width row of its own so the scrub bar is never squeezed. */}
      <div className="flex h-11 items-center gap-4 border-t border-white/[0.04] px-4">
        {mode === "replay" ? <ReplayControls /> : <span className="flex-1 text-[11px] uppercase tracking-wider text-white/35">Live timing</span>}
        <Weather />
      </div>
    </div>
  );
}
