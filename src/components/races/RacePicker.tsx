import { useEffect, useMemo, useState } from "react";
import { useDataSource } from "../../data/context";
import type { Point, SessionOption } from "../../data/types";
import { AVAILABLE_BACKENDS, type ReplayBackend } from "../../data/config";
import { useDashboard, useSnap } from "../../state/store";

const BACKEND_LABEL: Record<ReplayBackend, string> = {
  library: "Race library",
  openf1: "OpenF1 · 2023+",
};

function Outline({ points }: { points: Point[] | null | undefined }) {
  if (!points || points.length < 3) {
    return (
      <div className="grid h-full place-items-center text-[10px] uppercase tracking-widest text-white/20">No outline</div>
    );
  }
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const size = Math.max(maxX - minX, maxY - minY) || 1;
  const pad = size * 0.08;
  const d = points.map((p, i) => `${i ? "L" : "M"}${(p.x - minX).toFixed(0)},${(maxY - p.y).toFixed(0)}`).join("") + "Z";
  return (
    <svg
      viewBox={`${-pad - (size - (maxX - minX)) / 2} ${-pad - (size - (maxY - minY)) / 2} ${size + pad * 2} ${size + pad * 2}`}
      className="h-full w-full"
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke="#22e5ff" strokeOpacity="0.15" strokeWidth={size * 0.05} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#e7f9ff" strokeWidth={size * 0.014} strokeLinejoin="round" />
    </svg>
  );
}

function RaceCard({ race, current, showResults, onPick }: { race: SessionOption; current: boolean; showResults: boolean; onPick(): void }) {
  const date = race.date ? new Date(race.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "--";
  return (
    <button
      onClick={onPick}
      className={`group flex flex-col overflow-hidden rounded-xl border text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-glow ${
        current ? "border-cyan-glow/70 bg-cyan-glow/[0.06]" : "border-white/[0.07] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]"
      }`}
    >
      <div className="relative h-32 border-b border-white/[0.06] bg-[radial-gradient(circle_at_50%_40%,rgba(34,229,255,0.08),transparent_70%)] p-3">
        <Outline points={race.outline} />
        <span className="absolute left-3 top-3 rounded bg-ink-950/80 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white/70">
          {race.round != null ? `R${race.round}` : "--"}
        </span>
        {current && (
          <span className="absolute right-3 top-3 rounded bg-cyan-glow px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-ink-950">
            Now showing
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <span className="text-[14px] font-bold leading-tight text-white">{race.name ?? race.label}</span>
        <span className="truncate text-[11px] text-white/55">{race.circuit ?? "--"}</span>
        <span className="truncate text-[11px] text-white/35">{[race.place, race.country].filter(Boolean).join(", ") || "--"}</span>
        <div className="mt-auto flex items-center justify-between pt-2 font-mono text-[10px] text-white/45">
          <span>{date}</span>
          <span>
            {race.laps ?? "--"} laps · {race.lengthKm != null ? `${race.lengthKm.toFixed(3)} km` : "--"}
          </span>
        </div>
        {showResults && race.winner && (
          <div className="mt-1 flex items-center gap-2 border-t border-white/[0.06] pt-2 text-[11px]">
            <span className="h-3.5 w-1 rounded-full" style={{ background: race.winner.color }} />
            <span className="text-white/45">Winner</span>
            <span className="font-bold text-white">{race.winner.name}</span>
            {race.podium && race.podium.length > 1 && (
              <span className="ml-auto font-mono text-[10px] text-white/40">{race.podium.join(" · ")}</span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

/** Full-screen chooser: every race with its circuit, date, laps and (optionally) result. */
export function RacePicker() {
  const open = useDashboard((s) => s.racePickerOpen);
  const setOpen = useDashboard((s) => s.setRacePickerOpen);
  const showResults = useDashboard((s) => s.showResults);
  const setShowResults = useDashboard((s) => s.setShowResults);
  const backend = useDashboard((s) => s.replayBackend);
  const setBackend = useDashboard((s) => s.setReplayBackend);
  const replay = useDataSource()?.replay;
  const currentKey = useSnap((s) => s.session?.key ?? null);
  const currentYear = useSnap((s) => s.session?.year ?? null);
  const [season, setSeason] = useState<number | null>(null);
  const [races, setRaces] = useState<SessionOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const seasons = replay?.seasons ?? [];
  // Open on the season of the race being shown.
  const year = season ?? currentYear ?? seasons[0] ?? new Date().getUTCFullYear();

  useEffect(() => {
    if (!open || !replay?.selectableSessions) return;
    let cancelled = false;
    setRaces(null);
    setError(null);
    replay
      .listSessions(year)
      .then((list) => !cancelled && setRaces(list))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [open, replay, year]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!races || !q) return races;
    return races.filter((r) => [r.name, r.label, r.circuit, r.place, r.country].some((v) => v?.toLowerCase().includes(q)));
  }, [races, query]);

  if (!open || !replay) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a race"
        className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.9)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-white/[0.07] px-5 py-4">
          <div className="mr-auto">
            <h2 className="text-lg font-bold text-white">Choose a race</h2>
            <p className="text-[11px] text-white/40">{replay.sourceLabel}</p>
          </div>
          {AVAILABLE_BACKENDS.length > 1 && (
            <div className="flex h-8 rounded-md border border-white/10 p-0.5 text-[11px] font-semibold" role="radiogroup" aria-label="Race data">
              {AVAILABLE_BACKENDS.map((b) => (
                <button
                  key={b}
                  role="radio"
                  aria-checked={backend === b}
                  onClick={() => backend !== b && setBackend(b)}
                  className={`rounded px-2.5 ${backend === b ? "bg-white/10 text-white" : "text-white/45 hover:text-white"}`}
                >
                  {BACKEND_LABEL[b]}
                </button>
              ))}
            </div>
          )}
          {seasons.length > 1 && seasons.length <= 4 && (
            <div className="flex h-8 rounded-md border border-white/10 p-0.5 font-mono text-[12px] font-bold" role="tablist" aria-label="Season">
              {seasons.map((y) => (
                <button
                  key={y}
                  role="tab"
                  aria-selected={year === y}
                  onClick={() => setSeason(y)}
                  className={`rounded px-3 ${year === y ? "bg-cyan-glow text-ink-950" : "text-white/50 hover:text-white"}`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
          {seasons.length > 4 && (
            <select id="race-season" className="select h-8 w-24" value={year} onChange={(e) => setSeason(Number(e.target.value))} aria-label="Season">
              {seasons.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}
          <input
            id="race-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search race, circuit or country"
            className="h-8 w-60 rounded-md border border-white/10 bg-ink-850 px-3 text-[12px] text-white placeholder:text-white/30 outline-none focus:border-cyan-glow/60"
          />
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-white/60">
            <input id="race-results" type="checkbox" checked={showResults} onChange={(e) => setShowResults(e.target.checked)} className="accent-cyan-400" />
            Show winners
          </label>
          <button
            onClick={() => setOpen(false)}
            className="grid h-8 w-8 place-items-center rounded-md border border-white/10 text-white/60 hover:text-white"
            aria-label="Close race picker"
          >
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error && <p className="py-10 text-center text-sm text-amber-300/90">Races unavailable: {error}</p>}
          {!error && !filtered && <p className="py-10 text-center text-sm text-white/40">Loading races…</p>}
          {filtered && filtered.length === 0 && <p className="py-10 text-center text-sm text-white/40">No races match “{query}”.</p>}
          {filtered && filtered.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
              {filtered.map((r) => (
                <RaceCard
                  key={r.key}
                  race={r}
                  current={r.key === currentKey}
                  showResults={showResults}
                  onPick={() => {
                    void replay.loadSession(r.key);
                    setOpen(false);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
