import { useEffect, useRef, useState } from "react";
import { useDashboard, useSnap } from "../../state/store";
import type { RaceEvent, RaceEventKind } from "../../insights";
import { fmtAgo } from "../../lib/format";

const KIND: Record<RaceEventKind, { label: string; color: string }> = {
  overtake: { label: "Overtake", color: "#22e5ff" },
  pit: { label: "Pit", color: "#e5e7eb" },
  "fastest-lap": { label: "Fastest", color: "#b14cff" },
  retirement: { label: "Out", color: "#ef4444" },
  flag: { label: "Flag", color: "#facc15" },
  penalty: { label: "Steward", color: "#f59e0b" },
};

function KindChip({ kind }: { kind: RaceEventKind }) {
  const k = KIND[kind];
  return (
    <span
      className="w-[62px] shrink-0 rounded px-1.5 py-0.5 text-center text-[9px] font-extrabold uppercase tracking-wider"
      style={{ color: k.color, background: `${k.color}1f` }}
    >
      {k.label}
    </span>
  );
}

/** Every event detected so far, newest first. */
export function EventList() {
  const events = useDashboard((s) => s.events);
  const now = useSnap((s) => s.now);
  if (!events.length) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-white/35">
        Overtakes, pit stops, fastest laps and flags appear here as they happen.
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-1 p-2">
      {events.map((e) => (
        <li key={e.id} className="flex items-center gap-2.5 rounded-md border border-white/[0.04] bg-white/[0.02] px-2 py-1.5 text-[12px]">
          <KindChip kind={e.kind} />
          <span className="w-8 shrink-0 font-mono text-[10px] text-white/40">{e.lap != null ? `L${e.lap}` : "--"}</span>
          <span className="min-w-0 flex-1 truncate text-white/85" title={e.text}>
            {e.text}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-white/35">{now != null ? fmtAgo(e.t, now) : ""}</span>
        </li>
      ))}
    </ul>
  );
}

function canNotify(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Sound and desktop-notification switches for major events. */
export function AlertToggles() {
  const sound = useDashboard((s) => s.alertSound);
  const notify = useDashboard((s) => s.alertNotify);
  const setSound = useDashboard((s) => s.setAlertSound);
  const setNotify = useDashboard((s) => s.setAlertNotify);
  const [blocked, setBlocked] = useState(false);
  const toggleNotify = async () => {
    if (notify) return setNotify(false);
    if (!canNotify()) return setBlocked(true);
    try {
      const result = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (result === "granted") setNotify(true);
      else setBlocked(true);
    } catch {
      setBlocked(true);
    }
  };
  const btn = (on: boolean) =>
    `rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${on ? "bg-cyan-glow/15 text-cyan-glow" : "text-white/45 hover:text-white/80"}`;
  return (
    <div className="flex items-center gap-1 rounded-md border border-white/10 p-0.5">
      <button className={btn(sound)} onClick={() => setSound(!sound)} aria-pressed={sound} title="Play a chime for major events">
        Sound
      </button>
      <button
        className={btn(notify)}
        onClick={() => void toggleNotify()}
        aria-pressed={notify}
        title={blocked ? "Notifications are blocked in this browser or page" : "Desktop notifications for major events"}
      >
        {blocked ? "Alerts blocked" : "Desktop alerts"}
      </button>
    </div>
  );
}

let audio: AudioContext | null = null;

/** A short two-note chime, made with Web Audio so no sound file is needed. */
function chime(urgent: boolean): void {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    const notes = urgent ? [880, 660, 880] : [660, 990];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.13;
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  } catch {
    /* audio unavailable */
  }
}

const TOAST_MS = 7000;

/** Pop-ups for major events, with optional chime and desktop notification. */
export function AlertToasts() {
  const toasts = useDashboard((s) => s.toasts);
  const dismiss = useDashboard((s) => s.dismissToast);
  const sound = useDashboard((s) => s.alertSound);
  const notify = useDashboard((s) => s.alertNotify);
  const announced = useRef(new Set<string>());

  useEffect(() => {
    for (const t of toasts) {
      if (announced.current.has(t.id)) continue;
      announced.current.add(t.id);
      if (sound) chime(t.kind === "flag" || t.kind === "retirement");
      if (notify && canNotify() && Notification.permission === "granted" && document.visibilityState !== "visible") {
        try {
          new Notification(`F1 Pitwall · ${KIND[t.kind].label}`, { body: t.text, tag: t.id, silent: true });
        } catch {
          /* notifications unavailable */
        }
      }
      setTimeout(() => dismiss(t.id), TOAST_MS);
    }
  }, [toasts, sound, notify, dismiss]);

  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-28 z-40 flex w-80 flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t: RaceEvent) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-2.5 rounded-lg border bg-ink-900/95 px-3 py-2.5 text-[12px] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.9)] backdrop-blur"
          style={{ borderColor: `${KIND[t.kind].color}55` }}
        >
          <KindChip kind={t.kind} />
          <span className="min-w-0 flex-1 text-white/90">{t.text}</span>
          <button className="text-white/40 hover:text-white" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
