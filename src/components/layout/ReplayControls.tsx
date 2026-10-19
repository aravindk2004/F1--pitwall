import { useState } from "react";
import { useDataSource } from "../../data/context";
import type { PlaybackSpeed } from "../../data/types";
import { useDashboard, useSnap } from "../../state/store";
import { fmtClock, MISSING } from "../../lib/format";

const SPEEDS: PlaybackSpeed[] = [1, 2, 5, 10];

/** Opens the race picker; lives in the top bar next to the race name. */
export function ChangeRaceButton() {
  const replay = useDataSource()?.replay;
  const hasSession = useSnap((s) => s.session != null);
  const openPicker = useDashboard((s) => s.setRacePickerOpen);
  if (!replay?.selectableSessions) return null;
  return (
    <button
      onClick={() => openPicker(true)}
      className="flex h-7 shrink-0 items-center gap-2 rounded-md border border-cyan-glow/40 bg-cyan-glow/[0.06] px-2.5 text-[11px] font-semibold text-cyan-glow hover:bg-cyan-glow/15"
      title="Choose another race"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="1" y="1" width="4" height="4" rx="1" />
        <rect x="7" y="1" width="4" height="4" rx="1" />
        <rect x="1" y="7" width="4" height="4" rx="1" />
        <rect x="7" y="7" width="4" height="4" rx="1" />
      </svg>
      {hasSession ? "Change race" : "Choose race"}
    </button>
  );
}

/** Play/pause, speed and a full-width scrub bar. */
export function ReplayControls() {
  const replay = useDataSource()?.replay;
  const playback = useSnap((s) => s.playback);
  const lap = useSnap((s) => s.lap);
  // While dragging, show where the thumb is rather than where playback is.
  const [dragValue, setDragValue] = useState<number | null>(null);
  if (!replay) return null;
  const disabled = !playback;
  const span = playback ? playback.end - playback.start : 0;
  const position = dragValue ?? (playback ? playback.time - playback.start : 0);
  const pct = span > 0 ? (position / span) * 100 : 0;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <button
        disabled={disabled}
        onClick={() => (playback?.playing ? replay.pause() : replay.play())}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-cyan-glow/40 text-cyan-glow hover:bg-cyan-glow/10 disabled:opacity-30"
        aria-label={playback?.playing ? "Pause replay" : "Play replay"}
      >
        {playback?.playing ? (
          <svg width="10" height="10" viewBox="0 0 12 12"><rect x="2" y="1.5" width="3" height="9" rx="1" fill="currentColor" /><rect x="7" y="1.5" width="3" height="9" rx="1" fill="currentColor" /></svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 12 12"><path d="M3 1.5 L10.5 6 L3 10.5 Z" fill="currentColor" /></svg>
        )}
      </button>
      <div className="flex h-7 shrink-0 rounded-md border border-white/10 p-0.5" role="radiogroup" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={playback?.speed === s}
            disabled={disabled}
            onClick={() => replay.setSpeed(s)}
            className={`rounded px-1.5 font-mono text-[11px] ${playback?.speed === s ? "bg-white/10 text-white" : "text-white/45 hover:text-white"}`}
          >
            {s}x
          </button>
        ))}
      </div>
      <span className="w-16 shrink-0 text-right font-mono text-[12px] tabular-nums text-white/80">{playback ? fmtClock(position) : MISSING}</span>
      <input
        id="replay-scrub"
        type="range"
        className="range range-scrub min-w-[120px] flex-1"
        style={{ background: `linear-gradient(90deg, #22e5ff ${pct}%, rgba(255,255,255,0.1) ${pct}%)` }}
        min={0}
        max={Math.max(1, span)}
        step={1000}
        value={position}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDragValue(v);
          if (playback) replay.seek(playback.start + v);
        }}
        onPointerUp={() => setDragValue(null)}
        onKeyUp={() => setDragValue(null)}
        onBlur={() => setDragValue(null)}
        aria-label="Scrub replay"
        aria-valuetext={playback ? `${fmtClock(position)} of ${fmtClock(span)}` : undefined}
      />
      <span className="w-16 shrink-0 font-mono text-[12px] tabular-nums text-white/40">{playback ? fmtClock(span) : MISSING}</span>
      <span className="hidden shrink-0 font-mono text-[11px] text-white/55 lg:inline">
        LAP <span className="text-white">{lap.current ?? MISSING}</span>/{lap.total ?? MISSING}
      </span>
    </div>
  );
}
