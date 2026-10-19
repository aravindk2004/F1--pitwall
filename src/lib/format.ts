export const MISSING = "--";

const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function fmtLap(sec: number | null | undefined): string {
  if (!ok(sec) || sec <= 0) return MISSING;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, "0")}` : s.toFixed(3);
}

export function fmtSector(sec: number | null | undefined): string {
  return ok(sec) && sec > 0 ? sec.toFixed(3) : MISSING;
}

/** Gap/interval: numbers become "+1.234", strings ("+1 LAP") pass through. */
export function fmtGap(v: number | string | null | undefined): string {
  if (v == null || v === "") return MISSING;
  if (typeof v === "string") {
    const n = Number(v.replace("+", ""));
    if (v.trim() !== "" && Number.isFinite(n)) return `+${n.toFixed(3)}`;
    return v.toUpperCase();
  }
  return ok(v) ? `+${v.toFixed(3)}` : MISSING;
}

export function fmtNum(v: number | null | undefined, digits = 0, suffix = ""): string {
  return ok(v) ? `${v.toFixed(digits)}${suffix}` : MISSING;
}

export function fmtClock(ms: number | null | undefined): string {
  if (!ok(ms)) return MISSING;
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtAgo(then: number, now: number): string {
  const d = Math.max(0, Math.round((now - then) / 1000));
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 6 * 3600) return `${Math.floor(d / 3600)}h ago`;
  const t = new Date(then);
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}

export const isLeaderGap = (v: number | string | null | undefined) => v === 0 || v === "0" || v === "0.000";
