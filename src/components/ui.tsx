import React from "react";

export const ShuttleSVG = ({ sz = 40, color = "#fff", opacity = 0.12, style = {} as React.CSSProperties }) => (
  <svg width={sz} height={sz} viewBox="0 0 100 100" style={{ opacity, ...style }}>
    <ellipse cx="50" cy="75" rx="12" ry="12" fill={color} />
    <path d="M38 72 Q30 40 25 10 L35 15 Q40 45 42 70Z" fill={color} opacity="0.7" />
    <path d="M44 68 Q42 35 44 5 L50 10 Q50 40 48 66Z" fill={color} opacity="0.8" />
    <path d="M52 66 Q55 35 56 5 L50 10 Q52 40 52 66Z" fill={color} opacity="0.8" />
    <path d="M56 68 Q60 40 65 15 L75 10 Q70 40 62 70Z" fill={color} opacity="0.7" />
  </svg>
);

/**
 * Av (avatar) — circular player photo or initials. Rendered in dozens of
 * places per page (player roster cards, match cards, profile headers, search
 * results). Wrapped in React.memo because:
 *   - Props are all primitives (string / number / nullable string), so the
 *     default shallow equality is correct.
 *   - The parent surfaces re-render frequently (live scoreboard, scoreboard
 *     ticks, court status, match list) and most of those renders don't
 *     change avatar props — the memo skips needless re-renders entirely.
 * Net: smoother scrolling and ticker updates on LIVE / Matches tabs.
 */
export const Av = React.memo(function Av({ name, photo, sz = 40, color }: { name: string; photo?: string | null; sz?: number; color?: string }) {
  if (photo) return <img src={photo} alt={name} style={{ width: sz, height: sz, borderRadius: "50%", objectFit: "cover", border: `2px solid ${color || "#457B9D"}` }} />;
  const ini = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  return <div style={{ width: sz, height: sz, borderRadius: "50%", background: `linear-gradient(135deg, ${color || "#457B9D"}, ${color || "#457B9D"}dd)`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: sz * 0.38, flexShrink: 0, boxShadow: `0 2px 8px ${color || "#457B9D"}44` }}>{ini}</div>;
});
