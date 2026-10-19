import type { SourceStatus } from "../../data/types";

const STYLES: Record<SourceStatus, { dot: string; text: string; ring: string }> = {
  LIVE: { dot: "bg-red-500 animate-pulse shadow-[0_0_10px_#ef4444]", text: "text-white", ring: "border-red-500/50 bg-red-500/10" },
  STALE: { dot: "bg-amber-400", text: "text-amber-300", ring: "border-amber-400/50 bg-amber-400/10" },
  REPLAY: { dot: "bg-cyan-glow shadow-[0_0_10px_#22e5ff]", text: "text-cyan-glow", ring: "border-cyan-glow/50 bg-cyan-glow/10" },
  OFFLINE: { dot: "bg-white/30", text: "text-white/50", ring: "border-white/15 bg-white/[0.03]" },
};

export function StatusBadge({ status }: { status: SourceStatus }) {
  const s = STYLES[status];
  return (
    <span className={`inline-flex h-7 items-center gap-2 rounded-md border px-2.5 text-[11px] font-extrabold tracking-[0.2em] ${s.ring} ${s.text}`} role="status" aria-live="polite">
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}
