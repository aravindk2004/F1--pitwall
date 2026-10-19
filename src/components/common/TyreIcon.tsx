const COMPOUNDS: Record<string, { color: string; letter: string }> = {
  SOFT: { color: "#ff3b3b", letter: "S" },
  MEDIUM: { color: "#ffd02b", letter: "M" },
  HARD: { color: "#f2f2f2", letter: "H" },
  INTERMEDIATE: { color: "#3ccf4e", letter: "I" },
  WET: { color: "#2f8cff", letter: "W" },
};

export function TyreIcon({ compound, size = 20 }: { compound: string | null; size?: number }) {
  const c = (compound && COMPOUNDS[compound]) || { color: "#5b5b66", letter: "?" };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={compound ?? "Unknown tyre"}>
      <circle cx="12" cy="12" r="10.5" fill="#0d0d10" stroke="#2a2a32" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="8" fill="none" stroke={c.color} strokeWidth="3" />
      <text x="12" y="15.6" textAnchor="middle" fontSize="10" fontWeight="800" fill={c.color} fontFamily="Inter, sans-serif">
        {c.letter}
      </text>
    </svg>
  );
}
