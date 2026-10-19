const MAX = 360;
const START = -225; // degrees, 0 = 3 o'clock
const SWEEP = 270;
const R = 78;
const C = 100;

const polar = (deg: number, r: number) => {
  const rad = (deg * Math.PI) / 180;
  return { x: C + r * Math.cos(rad), y: C + r * Math.sin(rad) };
};

function arc(from: number, to: number, r: number): string {
  const a = polar(from, r);
  const b = polar(to, r);
  const large = to - from > 180 ? 1 : 0;
  return `M${a.x.toFixed(2)},${a.y.toFixed(2)} A${r},${r} 0 ${large} 1 ${b.x.toFixed(2)},${b.y.toFixed(2)}`;
}

/** 0–360 km/h arc gauge with a needle. */
export function Speedometer({ speed }: { speed: number | null }) {
  const v = speed != null && Number.isFinite(speed) ? Math.min(MAX, Math.max(0, speed)) : null;
  const angle = START + ((v ?? 0) / MAX) * SWEEP;
  const ticks = [];
  for (let s = 0; s <= MAX; s += 20) {
    const deg = START + (s / MAX) * SWEEP;
    const major = s % 60 === 0;
    const a = polar(deg, R + 6);
    const b = polar(deg, R + (major ? -6 : 0));
    ticks.push(
      <line key={s} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={s >= 300 ? "#ff2d55" : "#ffffff"} strokeOpacity={major ? 0.7 : 0.25} strokeWidth={major ? 2 : 1} />,
    );
    if (major) {
      const l = polar(deg, R - 18);
      ticks.push(
        <text key={`l${s}`} x={l.x} y={l.y + 3.5} textAnchor="middle" fontSize="10" fill="#ffffff" fillOpacity="0.45" fontFamily="JetBrains Mono, monospace">
          {s}
        </text>,
      );
    }
  }
  return (
    <svg viewBox="0 0 200 170" className="w-full" role="img" aria-label={`Speed ${v ?? "--"} km/h`}>
      <defs>
        <linearGradient id="spdGrad" x1="0" x2="1">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="70%" stopColor="#22e5ff" />
          <stop offset="100%" stopColor="#ff2d55" />
        </linearGradient>
      </defs>
      <path d={arc(START, START + SWEEP, R + 3)} fill="none" stroke="#ffffff" strokeOpacity="0.06" strokeWidth="10" strokeLinecap="round" />
      {v != null && v > 0 && (
        <path d={arc(START, angle, R + 3)} fill="none" stroke="url(#spdGrad)" strokeWidth="10" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 6px #22e5ff88)" }} />
      )}
      {ticks}
      <g style={{ transform: `rotate(${angle + 90}deg)`, transformOrigin: `${C}px ${C}px`, transition: "transform 220ms cubic-bezier(.3,.7,.4,1)" }}>
        <path d={`M${C - 3},${C} L${C},${C - R + 4} L${C + 3},${C} Z`} fill="#22e5ff" style={{ filter: "drop-shadow(0 0 4px #22e5ff)" }} />
      </g>
      <circle cx={C} cy={C} r="7" fill="#0a0a0c" stroke="#22e5ff" strokeWidth="2" />
      <text x={C} y={C + 38} textAnchor="middle" fontSize="28" fontWeight="800" fill="#fff" fontFamily="JetBrains Mono, monospace">
        {v != null ? Math.round(v) : "--"}
      </text>
      <text x={C} y={C + 52} textAnchor="middle" fontSize="9" letterSpacing="2" fill="#ffffff" fillOpacity="0.4">
        KM/H
      </text>
    </svg>
  );
}
