import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useDriverHover } from "../../hooks/useDriverHover";
import { useDashboard, useSnap } from "../../state/store";
import type { Point, TrackLayout } from "../../data/types";
import { Panel } from "../common/Panel";
import { RaceControlTicker } from "./RaceControlTicker";
import { useDataSource } from "../../data/context";

/** Drawing height in SVG units; the width follows the panel's shape so the map fills it. */
const VIEW_H = 1000;
const PAD = 40;

interface Projection {
  project(p: Point): Point;
}

function makeProjection(points: Point[], viewW: number): Projection | null {
  if (points.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const scale = Math.min((viewW - PAD * 2) / w, (VIEW_H - PAD * 2) / h);
  const ox = (viewW - w * scale) / 2, oy = (VIEW_H - h * scale) / 2;
  // Timing coordinates are y-up; SVG is y-down.
  return { project: (p) => ({ x: ox + (p.x - minX) * scale, y: oy + (maxY - p.y) * scale }) };
}

const toPath = (pts: Point[], closed: boolean) =>
  pts.length ? `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("L")}${closed ? "Z" : ""}` : "";

const TrackShape = memo(function TrackShape({ track, proj }: { track: TrackLayout; proj: Projection }) {
  const pts = useMemo(() => track.points.map(proj.project), [track, proj]);
  const outline = toPath(pts, true);
  const drs = track.drsZones.map(([a, b]) => toPath(pts.slice(a, b + 1), false));
  const start = pts[0];
  const next = pts[Math.min(3, pts.length - 1)];
  const angle = (Math.atan2(next.y - start.y, next.x - start.x) * 180) / Math.PI;
  return (
    <g>
      <path d={outline} fill="none" stroke="#22e5ff" strokeOpacity="0.07" strokeWidth="34" strokeLinejoin="round" />
      <path d={outline} fill="none" stroke="#24242c" strokeWidth="18" strokeLinejoin="round" />
      <path d={outline} fill="none" stroke="#3a3a46" strokeWidth="14" strokeLinejoin="round" />
      <path d={outline} fill="none" stroke="#22e5ff" strokeOpacity="0.35" strokeWidth="1.2" strokeLinejoin="round" />
      {drs.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="#ff2d55" strokeWidth="4" strokeDasharray="10 8" strokeLinecap="round" />
      ))}
      {track.corners?.map((c) => {
        const p = proj.project(c);
        return (
          <g key={c.label} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`} opacity="0.75">
            <circle r="9" fill="#101014" stroke="#3a3a46" strokeWidth="1" />
            <text y="3.2" textAnchor="middle" fontSize="9" fontWeight="700" fill="#9aa3b2" fontFamily="JetBrains Mono, monospace">
              {c.label}
            </text>
          </g>
        );
      })}
      <g transform={`translate(${start.x} ${start.y}) rotate(${angle + 90})`}>
        <rect x="-11" y="-2" width="22" height="4" fill="#fff" />
        <rect x="-11" y="-2" width="5.5" height="2" fill="#000" />
        <rect x="0" y="-2" width="5.5" height="2" fill="#000" />
        <rect x="-5.5" y="0" width="5.5" height="2" fill="#000" />
        <rect x="5.5" y="0" width="5.5" height="2" fill="#000" />
      </g>
    </g>
  );
});

/**
 * Where the focused car would be if it pitted now: the spot it passed `pit loss`
 * seconds ago, since a stop costs that much time against the cars around it.
 */
function PitGhost({ proj }: { proj: Projection }) {
  const source = useDataSource();
  const focus = useDashboard((s) => s.hovered?.driver ?? s.selected);
  const pit = useDashboard((s) => (focus != null ? s.insights?.pit[focus] : undefined));
  const d = useSnap((s) => (focus != null ? s.drivers[focus] : undefined));
  useSnap((s) => s.locations); // re-render as the cars move
  if (focus == null || !pit || !d || d.inPit || d.retired || !source?.pastLocation) return null;
  const at = source.pastLocation(focus, pit.pitLoss);
  if (!at) return null;
  const p = proj.project(at);
  return (
    <g transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`} pointerEvents="none">
      <circle r="13" fill="none" stroke={d.teamColor} strokeWidth="2.5" strokeDasharray="4 3" opacity="0.9" />
      <circle r="4" fill={d.teamColor} opacity="0.7" />
      <text x="16" y="18" fontSize="14" fontWeight="800" fill="#e7f9ff" fontFamily="Inter, sans-serif" stroke="#0a0a0c" strokeWidth="4" paintOrder="stroke">
        {`IF ${d.code} PITS → P${pit.rejoinPosition}`}
      </text>
    </g>
  );
}

function DriverDots({ proj }: { proj: Projection }) {
  const locations = useSnap((s) => s.locations);
  const drivers = useSnap((s) => s.drivers);
  const hovered = useDashboard((s) => s.hovered?.driver ?? null);
  const selected = useDashboard((s) => s.selected);
  const hover = useDriverHover();
  const toggleSelected = useDashboard((s) => s.toggleSelected);
  const entries = Object.entries(locations)
    .map(([n, p]) => ({ n: Number(n), p: proj.project(p) }))
    // Leader drawn last so it sits on top.
    .sort((a, b) => (drivers[b.n]?.position ?? 99) - (drivers[a.n]?.position ?? 99));

  return (
    <g>
      {entries.map(({ n, p }) => {
        const d = drivers[n];
        const color = d?.teamColor ?? "#8a8a96";
        const isHover = hovered === n || selected === n;
        return (
          <g
            key={n}
            transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
            className="cursor-pointer"
            {...hover(n)}
            onClick={() => toggleSelected(n)}
          >
            <circle r={isHover ? 22 : 16} fill={color} opacity="0.18" />
            <circle r={isHover ? 12 : 9.5} fill={color} stroke={isHover ? "#22e5ff" : "#0a0a0c"} strokeWidth={isHover ? 3 : 2.5} />
            <text y="3.6" textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#0a0a0c" fontFamily="Inter, sans-serif">
              {d?.position ?? ""}
            </text>
            <text x="15" y="-12" fontSize="15" fontWeight="700" fill="#fff" opacity={isHover ? 1 : 0.8} fontFamily="Inter, sans-serif" stroke="#0a0a0c" strokeWidth="4" paintOrder="stroke">
              {d?.code ?? n}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Circuit name, location and key numbers in the map's corner. */
function CircuitCard() {
  const session = useSnap((s) => s.session);
  const hasCorners = useSnap((s) => Boolean(s.track?.corners?.length));
  const hasDrs = useSnap((s) => Boolean(s.track?.drsZones.length));
  const stats = [
    session?.lengthKm != null ? `${session.lengthKm.toFixed(3)} km` : null,
    session?.turns != null ? `${session.turns} turns` : null,
    session?.totalLaps != null ? `${session.totalLaps} laps` : null,
  ].filter(Boolean);
  return (
    <div className="pointer-events-none absolute left-3 top-3 flex max-w-[60%] flex-col gap-1 rounded-lg border border-white/[0.06] bg-ink-950/75 px-3 py-2 backdrop-blur">
      <span className="truncate text-[13px] font-bold text-white">{session?.circuitFullName ?? session?.circuit ?? "Circuit --"}</span>
      <span className="truncate text-[11px] text-white/50">{[session?.place, session?.country].filter(Boolean).join(", ") || "--"}</span>
      <span className="font-mono text-[10px] text-white/45">{stats.length ? stats.join(" · ") : "--"}</span>
      <span className="mt-0.5 flex items-center gap-3 text-[10px] uppercase tracking-wider text-white/40">
        {hasDrs && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0 w-5 border-t-2 border-dashed border-[#ff2d55]" /> DRS zone
          </span>
        )}
        {hasCorners && (
          <span className="flex items-center gap-1.5">
            <span className="grid h-3.5 w-3.5 place-items-center rounded-full border border-white/20 font-mono text-[7px] text-white/60">1</span> Turn
          </span>
        )}
      </span>
    </div>
  );
}

/** Width of the drawing in SVG units, matching the panel's aspect ratio. */
function useViewWidth(ref: React.RefObject<HTMLDivElement>): number {
  const [viewW, setViewW] = useState(VIEW_H);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setViewW(Math.round(VIEW_H * Math.min(4, Math.max(0.5, width / height))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return viewW;
}

export function TrackMap() {
  const expanded = useDashboard((s) => s.trackExpanded);
  const toggleExpanded = useDashboard((s) => s.toggleTrackExpanded);
  const frame = useRef<HTMLDivElement>(null);
  const viewW = useViewWidth(frame);
  const track = useSnap((s) => s.track);
  const hasLocations = useSnap((s) => Object.keys(s.locations).length > 0);
  const session = useSnap((s) => s.session);
  // Until a lap has been traced, frame the area the cars have covered so far.
  const liveLocations = useSnap((s) => (s.track ? null : s.locations));
  const seen = useRef<Point[]>([]);
  const trackProj = useMemo(() => (track ? makeProjection(track.points, viewW) : null), [track, viewW]);
  let proj = trackProj;
  if (!track && liveLocations) {
    const box = seen.current;
    for (const p of Object.values(liveLocations)) {
      if (box.length < 2) box.push({ ...p }, { ...p });
      box[0] = { x: Math.min(box[0].x, p.x), y: Math.min(box[0].y, p.y) };
      box[1] = { x: Math.max(box[1].x, p.x), y: Math.max(box[1].y, p.y) };
    }
    proj = box.length === 2 ? makeProjection(box, viewW) : null;
  }

  return (
    <Panel
      title="Track"
      right={
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-[11px] text-white/40">{session ? session.name : "--"}</span>
          <button
            onClick={toggleExpanded}
            className="flex h-6 shrink-0 items-center gap-1.5 rounded border border-white/10 px-2 text-[10px] font-semibold uppercase tracking-wider text-white/60 hover:border-cyan-glow/50 hover:text-cyan-glow"
            title={expanded ? "Show radio and positions again (M)" : "Enlarge the map (M)"}
            aria-pressed={expanded}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              {expanded ? <path d="M4 1v3H1M8 1v3h3M11 8H8v3M1 8h3v3" /> : <path d="M1 4V1h3M8 1h3v3M11 8v3H8M4 11H1V8" />}
            </svg>
            {expanded ? "Shrink" : "Expand"}
          </button>
        </div>
      }
      bodyClassName="relative"
    >
      <div ref={frame} className="absolute inset-0" />
      <svg viewBox={`0 0 ${viewW} ${VIEW_H}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="mapGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#22e5ff" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#22e5ff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={viewW} height={VIEW_H} fill="url(#mapGlow)" />
        {track && proj && <TrackShape track={track} proj={proj} />}
        {proj && <PitGhost proj={proj} />}
        {proj && <DriverDots proj={proj} />}
      </svg>
      {!track && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-white/35">
          {hasLocations ? "Drawing circuit from the first full lap…" : "Track map --"}
        </div>
      )}
      <CircuitCard />
      <RaceControlTicker />
    </Panel>
  );
}
