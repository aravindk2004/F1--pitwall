import { useEffect, useMemo, useRef, useState } from "react";

export interface Series {
  id: number;
  label: string;
  color: string;
  /** Second driver of a team: same team colour, dashed line. */
  dashed: boolean;
  /** Drawn bold with an end label; the rest recede. */
  emphasis: boolean;
  points: Array<[number, number]>;
}

interface Props {
  series: Series[];
  /** y grows downward (positions, gap behind the leader). */
  invertY?: boolean;
  yDomain?: [number, number];
  xLabel: string;
  yFormat(v: number): string;
  /** Dots instead of lines (lap-time scatter). */
  dots?: boolean;
  height?: number;
  /** Extra marker at this x, e.g. the current lap. */
  markerX?: number | null;
  ariaLabel: string;
  /** x is continuous (e.g. distance): never break lines, hover snaps to the nearest sample. */
  continuous?: boolean;
  xFormat?(v: number): string;
  /** Labelled reference lines along x, e.g. corners. */
  xMarks?: Array<{ x: number; label: string }>;
}

const PAD = { top: 12, right: 52, bottom: 28, left: 48 };

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

function useWidth(ref: React.RefObject<HTMLDivElement>): number {
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => e.contentRect.width > 0 && setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Multi-series chart over laps with a crosshair tooltip. One y axis only. */
export function LineChart({
  series,
  invertY,
  yDomain,
  xLabel,
  yFormat,
  dots,
  height = 240,
  markerX,
  ariaLabel,
  continuous,
  xFormat = (v) => String(v),
  xMarks,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const s of series)
      for (const [x, y] of s.points) {
        xMin = Math.min(xMin, x);
        xMax = Math.max(xMax, x);
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
    if (yDomain) [yMin, yMax] = yDomain;
    if (!Number.isFinite(xMin)) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    return { xMin, xMax: Math.max(xMax, xMin + 1), yMin, yMax: yMax === yMin ? yMin + 1 : yMax };
  }, [series, yDomain]);

  const iw = Math.max(10, width - PAD.left - PAD.right);
  const ih = height - PAD.top - PAD.bottom;
  const sx = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin)) * iw;
  const sy = (y: number) => {
    const k = (Math.min(yMax, Math.max(yMin, y)) - yMin) / (yMax - yMin);
    return PAD.top + (invertY ? k : 1 - k) * ih;
  };
  const xTicks = niceTicks(xMin, xMax, Math.max(3, Math.floor(iw / 70)));
  const yTicks = niceTicks(yMin, yMax, 5);

  const ordered = [...series].sort((a, b) => Number(a.emphasis) - Number(b.emphasis));
  const focus = series.filter((s) => s.emphasis);
  const hovered =
    hoverX == null
      ? []
      : focus
          .map((s) => {
            let p: [number, number] | undefined;
            if (continuous) {
              let best = Infinity;
              for (const q of s.points) {
                const dist = Math.abs(q[0] - hoverX);
                if (dist < best) {
                  best = dist;
                  p = q;
                }
              }
            } else p = s.points.find((q) => q[0] === hoverX);
            return p ? { s, y: p[1] } : null;
          })
          .filter((v): v is { s: Series; y: number } => v != null)
          .sort((a, b) => (invertY ? a.y - b.y : b.y - a.y));

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = xMin + ((e.clientX - rect.left) / rect.width) * (xMax - xMin);
    setHoverX(continuous ? x : Math.round(x));
  };

  return (
    <div ref={box} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD.left} x2={PAD.left + iw} y1={sy(t)} y2={sy(t)} stroke="#ffffff" strokeOpacity="0.06" />
            <text x={PAD.left - 8} y={sy(t) + 3.5} textAnchor="end" fontSize="10" fill="#ffffff" fillOpacity="0.45" fontFamily="JetBrains Mono, monospace">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={sx(t)} y={height - 10} textAnchor="middle" fontSize="10" fill="#ffffff" fillOpacity="0.45" fontFamily="JetBrains Mono, monospace">
            {xFormat(t)}
          </text>
        ))}
        {xMarks?.map((m) => (
          <g key={`m${m.label}${m.x}`}>
            <line x1={sx(m.x)} x2={sx(m.x)} y1={PAD.top} y2={PAD.top + ih} stroke="#ffffff" strokeOpacity="0.07" />
            <text x={sx(m.x)} y={PAD.top + 9} textAnchor="middle" fontSize="9" fill="#ffffff" fillOpacity="0.4" fontFamily="JetBrains Mono, monospace">
              {m.label}
            </text>
          </g>
        ))}
        <text x={PAD.left + iw} y={height - 10} textAnchor="end" fontSize="9" fill="#ffffff" fillOpacity="0.3" dx="44">
          {xLabel}
        </text>
        {markerX != null && markerX >= xMin && markerX <= xMax && (
          <line x1={sx(markerX)} x2={sx(markerX)} y1={PAD.top} y2={PAD.top + ih} stroke="#22e5ff" strokeOpacity="0.35" strokeDasharray="3 3" />
        )}
        {ordered.map((s) => {
          const pts = s.points.filter(([, y]) => y >= yMin - 1e-9 && y <= yMax + 1e-9);
          const opacity = s.emphasis ? 1 : focus.length ? 0.14 : 0.6;
          if (dots) {
            return (
              <g key={s.id} opacity={opacity}>
                {pts.map(([x, y]) => (
                  <circle key={x} cx={sx(x)} cy={sy(y)} r={s.emphasis ? 3.2 : 2.4} fill={s.dashed ? "#101014" : s.color} stroke={s.color} strokeWidth={s.dashed ? 1.5 : 0} />
                ))}
              </g>
            );
          }
          // Break the line where laps are missing.
          const d = s.points
            .map(([x, y], i) => `${i > 0 && (continuous || x - s.points[i - 1][0] === 1) ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`)
            .join("");
          return (
            <path
              key={s.id}
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth={s.emphasis ? 2 : 1.25}
              strokeDasharray={s.dashed ? "5 3" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={opacity}
            />
          );
        })}
        {!dots &&
          !continuous &&
          focus.map((s) => {
            const last = s.points[s.points.length - 1];
            if (!last) return null;
            return (
              <g key={`end${s.id}`}>
                <circle cx={sx(last[0])} cy={sy(last[1])} r="4" fill={s.color} stroke="#101014" strokeWidth="2" />
                <text x={sx(last[0]) + 8} y={sy(last[1]) + 3.5} fontSize="10" fontWeight="700" fill="#ffffff" fillOpacity="0.85" fontFamily="Inter, sans-serif">
                  {s.label}
                </text>
              </g>
            );
          })}
        {hoverX != null && (
          <line x1={sx(hoverX)} x2={sx(hoverX)} y1={PAD.top} y2={PAD.top + ih} stroke="#ffffff" strokeOpacity="0.35" />
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={iw}
          height={ih}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHoverX(null)}
        />
      </svg>
      {hoverX != null && hovered.length > 0 && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-[140px] rounded-md border border-white/10 bg-ink-950/95 px-2.5 py-2 text-[11px] shadow-lg"
          style={sx(hoverX) > width / 2 ? { right: width - sx(hoverX) + 12 } : { left: sx(hoverX) + 12 }}
        >
          <div className="mb-1 font-mono text-[10px] text-white/45">
            {xLabel} {xFormat(continuous ? Number(hoverX.toFixed(2)) : hoverX)}
          </div>
          {hovered.map(({ s, y }) => (
            <div key={s.id} className="flex items-center gap-2">
              <svg width="14" height="4" aria-hidden="true">
                <line x1="0" x2="14" y1="2" y2="2" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 2" : undefined} />
              </svg>
              <span className="w-9 font-semibold text-white/85">{s.label}</span>
              <span className="ml-auto font-mono tabular-nums text-white/75">{yFormat(y)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Legend row: line key + code for each focused series. */
export function Legend({ series }: { series: Series[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/70">
      {series
        .filter((s) => s.emphasis)
        .map((s) => (
          <span key={s.id} className="flex items-center gap-1.5">
            <svg width="16" height="4" aria-hidden="true">
              <line x1="0" x2="16" y1="2" y2="2" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 2" : undefined} />
            </svg>
            {s.label}
          </span>
        ))}
    </div>
  );
}
