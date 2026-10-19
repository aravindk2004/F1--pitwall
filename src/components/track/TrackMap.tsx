import { memo, useMemo, useRef } from "react";
import { useDashboard, useSnap } from "../../state/store";
import type { Point, TrackLayout } from "../../data/types";
import { Panel } from "../common/Panel";
import { RaceControlTicker } from "./RaceControlTicker";

const VIEW = 1000;
const PAD = 60;

interface Projection {
  project(p: Point): Point;
}

function makeProjection(points: Point[]): Projection | null {
  if (points.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const scale = (VIEW - PAD * 2) / Math.max(w, h);
  const ox = (VIEW - w * scale) / 2, oy = (VIEW - h * scale) / 2;
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

function DriverDots({ proj }: { proj: Projection }) {
  const locations = useSnap((s) => s.locations);
  const drivers = useSnap((s) => s.drivers);
  const hovered = useDashboard((s) => s.hovered?.driver ?? null);
  const setHovered = useDashboard((s) => s.setHovered);
  const entries = Object.entries(locations)
    .map(([n, p]) => ({ n: Number(n), p: proj.project(p) }))
    // Leader drawn last so it sits on top.
    .sort((a, b) => (drivers[b.n]?.position ?? 99) - (drivers[a.n]?.position ?? 99));

  return (
    <g>
      {entries.map(({ n, p }) => {
        const d = drivers[n];
        const color = d?.teamColor ?? "#8a8a96";
        const isHover = hovered === n;
        return (
          <g
            key={n}
            transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
            className="cursor-pointer"
            onMouseEnter={(e) => setHovered({ driver: n, x: e.clientX, y: e.clientY })}
            onMouseMove={(e) => setHovered({ driver: n, x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setHovered(null)}
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

export function TrackMap() {
  const track = useSnap((s) => s.track);
  const hasLocations = useSnap((s) => Object.keys(s.locations).length > 0);
  const session = useSnap((s) => s.session);
  // Until a lap has been traced, frame the area the cars have covered so far.
  const liveLocations = useSnap((s) => (s.track ? null : s.locations));
  const seen = useRef<Point[]>([]);
  const trackProj = useMemo(() => (track ? makeProjection(track.points) : null), [track]);
  let proj = trackProj;
  if (!track && liveLocations) {
    const box = seen.current;
    for (const p of Object.values(liveLocations)) {
      if (box.length < 2) box.push({ ...p }, { ...p });
      box[0] = { x: Math.min(box[0].x, p.x), y: Math.min(box[0].y, p.y) };
      box[1] = { x: Math.max(box[1].x, p.x), y: Math.max(box[1].y, p.y) };
    }
    proj = box.length === 2 ? makeProjection(box) : null;
  }

  return (
    <Panel
      title="Track"
      right={<span className="truncate text-[11px] text-white/40">{session ? session.name : "--"}</span>}
      bodyClassName="relative"
    >
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="mapGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#22e5ff" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#22e5ff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={VIEW} height={VIEW} fill="url(#mapGlow)" />
        {track && proj && <TrackShape track={track} proj={proj} />}
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
