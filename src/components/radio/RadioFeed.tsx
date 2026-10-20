import { useEffect, useRef, useState } from "react";
import { useDashboard, useSnap } from "../../state/store";
import type { RadioMessage } from "../../data/types";
import { fmtAgo } from "../../lib/format";
import { Panel } from "../common/Panel";
import { AlertToggles, EventList } from "../events/EventFeed";

type PlayState = { id: string; progress: number; error?: boolean } | null;

function RadioToggle() {
  const mode = useDashboard((s) => s.radioMode);
  const setMode = useDashboard((s) => s.setRadioMode);
  return (
    <div className="flex rounded-md border border-white/10 p-0.5 text-[10px] font-semibold uppercase tracking-wider" role="tablist">
      {(["public", "live"] as const).map((m) => (
        <button
          key={m}
          role="tab"
          aria-selected={mode === m}
          title={m === "public" ? "Browse published clips and play on demand" : "Auto-play each new clip as it arrives"}
          className={`rounded px-2 py-0.5 transition-colors ${mode === m ? "bg-cyan-glow/15 text-cyan-glow" : "text-white/45 hover:text-white/80"}`}
          onClick={() => setMode(m)}
        >
          {m === "live" && <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${mode === "live" ? "animate-pulse bg-red-500" : "bg-white/30"}`} />}
          {m}
        </button>
      ))}
    </div>
  );
}

type FeedTab = "radio" | "events";

function FeedTabs({ tab, setTab }: { tab: FeedTab; setTab(t: FeedTab): void }) {
  const count = useDashboard((s) => s.events.length);
  const tabs: Array<[FeedTab, string]> = [
    ["radio", "Team radio"],
    ["events", `Events${count ? ` · ${count}` : ""}`],
  ];
  return (
    <span className="flex items-center gap-3" role="tablist">
      {tabs.map(([t, label]) => (
        <button
          key={t}
          role="tab"
          aria-selected={tab === t}
          onClick={() => setTab(t)}
          className={`uppercase tracking-[0.18em] transition-colors ${tab === t ? "text-white/80" : "text-white/35 hover:text-white/60"}`}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

export function RadioFeed() {
  const [tab, setTab] = useState<FeedTab>("radio");
  const radio = useSnap((s) => s.radio);
  const drivers = useSnap((s) => s.drivers);
  const now = useSnap((s) => s.playback?.time ?? null);
  const radioMode = useDashboard((s) => s.radioMode);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<PlayState>(null);
  const lastAuto = useRef<number>(0);
  const [wallNow, setWallNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setWallNow(Date.now()), 5000);
    return () => {
      clearInterval(id);
      audio.current?.pause();
    };
  }, []);

  const play = (m: RadioMessage) => {
    try {
      if (!audio.current) audio.current = new Audio();
      const el = audio.current;
      if (playing?.id === m.id && !el.paused) {
        el.pause();
        setPlaying(null);
        return;
      }
      el.src = m.url;
      el.ontimeupdate = () => setPlaying({ id: m.id, progress: el.duration ? el.currentTime / el.duration : 0 });
      el.onended = () => setPlaying(null);
      el.onerror = () => setPlaying({ id: m.id, progress: 0, error: true });
      setPlaying({ id: m.id, progress: 0 });
      el.play().catch(() => setPlaying({ id: m.id, progress: 0, error: true }));
    } catch {
      setPlaying({ id: m.id, progress: 0, error: true });
    }
  };

  // In Live mode, auto-play each clip as it comes in.
  const newest = radio[0];
  useEffect(() => {
    if (!newest) return;
    if (radioMode !== "live") {
      lastAuto.current = Math.max(lastAuto.current, newest.date);
      return;
    }
    const ref = now ?? Date.now();
    if (newest.date > lastAuto.current && ref - newest.date < 60_000) {
      lastAuto.current = newest.date;
      play(newest);
    }
  }, [newest?.id, radioMode]);

  const ref = now ?? wallNow;

  return (
    <Panel
      title={<FeedTabs tab={tab} setTab={setTab} />}
      right={tab === "radio" ? <RadioToggle /> : <AlertToggles />}
      bodyClassName="overflow-y-auto"
    >
      {tab === "events" ? (
        <EventList />
      ) : radio.length === 0 ? (
        <div className="flex h-full items-center justify-center p-4 text-sm text-white/35">No radio yet · --</div>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5 p-2 xl:grid-cols-2">
          {radio.map((m) => {
            const d = drivers[m.driverNumber];
            const isPlaying = playing?.id === m.id;
            const color = d?.teamColor ?? "#8a8a96";
            return (
              <li
                key={m.id}
                className={`flex items-center gap-3 rounded-lg border px-2.5 py-1.5 transition-colors ${
                  isPlaying ? "border-cyan-glow/40 bg-cyan-glow/[0.06]" : "border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04]"
                }`}
              >
                <button
                  onClick={() => play(m)}
                  aria-label={isPlaying ? "Pause radio" : "Play radio"}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-cyan-glow/40 text-cyan-glow transition hover:bg-cyan-glow/15 hover:shadow-[0_0_14px_#22e5ff55]"
                >
                  {isPlaying && !playing?.error ? (
                    <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1.5" width="3" height="9" rx="1" fill="currentColor" /><rect x="7" y="1.5" width="3" height="9" rx="1" fill="currentColor" /></svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.5 L10.5 6 L3 10.5 Z" fill="currentColor" /></svg>
                  )}
                </button>
                <span className="h-6 w-1 rounded-full" style={{ background: color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-bold text-white">{d?.code ?? m.driverNumber}</span>
                    <span className="font-mono text-[10px] text-white/40">{fmtAgo(m.date, ref)}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className={`h-full rounded-full ${playing?.error && isPlaying ? "bg-red-500/70" : "bg-cyan-glow"}`}
                      style={{ width: `${isPlaying ? (playing?.error ? 100 : playing!.progress * 100) : 0}%` }}
                    />
                  </div>
                  {isPlaying && playing?.error && <span className="text-[10px] text-red-400/80">Clip unavailable</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
