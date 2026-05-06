import { useEffect, useState } from "react";
import type { Category, ProjectedMatch, Team, Player } from "../types";
import { fmtElapsed } from "../hooks/useScheduling";

export function CourtStatus({
  numCourts,
  liveByCourt,
  categories,
  teamById,
}: {
  numCourts: number;
  liveByCourt: Record<number, ProjectedMatch | undefined>;
  categories: Category[];
  teamById: Record<string, (Team & { p1: Player; p2: Player | null }) | undefined>;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const catById = Object.fromEntries(categories.map(c => [c.id, c]));
  const courts = Array.from({ length: Math.max(1, numCourts) }, (_, i) => i + 1);

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ width: 4, height: 18, background: "#00d4ff", borderRadius: 1 }} />
        <h3 className="font-display" style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#fff", letterSpacing: 1.5, textTransform: "uppercase" }}>Court Status</h3>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill,minmax(${courts.length === 1 ? 200 : 240}px,1fr))`, gap: 10 }}>
        {courts.map(n => {
          const m = liveByCourt[n];
          const cat = m ? catById[m.category_id] : null;
          const ta = m?.team_a_id ? teamById[m.team_a_id] : null;
          const tb = m?.team_b_id ? teamById[m.team_b_id] : null;
          const matchMin = cat?.match_minutes ?? 12;
          const elapsed = m?.started_at ? (now - new Date(m.started_at).getTime()) / 60000 : 0;
          const over = elapsed > matchMin;
          const wayOver = elapsed > matchMin + 3;
          return (
            <div key={n} style={{ background: m ? (wayOver ? "linear-gradient(135deg,#3a0c0c,#1f0808)" : over ? "linear-gradient(135deg,#3a2a0c,#1f1408)" : "linear-gradient(135deg,#0c2a3a,#081f2e)") : "#0f1e36", border: m ? `1px solid ${wayOver ? "#ef4444" : over ? "#f59e0b" : "#00d4ff"}` : "1px solid #1a3050", borderRadius: 8, padding: 14, minHeight: 88 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span className="font-display" style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: 2 }}>COURT {n}</span>
                {m ? (
                  <span className="font-display" style={{ fontSize: 13, fontWeight: 800, color: wayOver ? "#ef4444" : over ? "#fbbf24" : "#00d4ff", letterSpacing: 0.5 }}>{fmtElapsed(m.started_at, now)}</span>
                ) : (
                  <span className="font-display" style={{ fontSize: 10, fontWeight: 700, color: "#22c55e", letterSpacing: 2, padding: "2px 8px", background: "rgba(34,197,94,0.1)", borderRadius: 3, border: "1px solid rgba(34,197,94,0.3)" }}>FREE</span>
                )}
              </div>
              {m ? (
                <>
                  <div style={{ fontSize: 11, color: "#cbd5e1", marginBottom: 4, fontWeight: 600 }}>
                    {cat?.name?.toUpperCase()} · {m.stage === "group" ? `GROUP ${String.fromCharCode(65 + (m.group_idx ?? 0))}` : `RD ${(m.round_idx ?? 0) + 1}`}
                  </div>
                  <div style={{ fontSize: 13, color: "#fff", fontWeight: 700, lineHeight: 1.3 }}>
                    {tName(ta)} <span style={{ color: "#ef4444" }}>vs</span> {tName(tb)}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                    <span className="font-display" style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: 1 }}>{m.score_a ?? 0}–{m.score_b ?? 0}</span>
                    {wayOver && <span className="font-display" style={{ fontSize: 10, fontWeight: 800, color: "#ef4444", letterSpacing: 1.5 }}>OVERTIME</span>}
                    {over && !wayOver && <span className="font-display" style={{ fontSize: 10, fontWeight: 800, color: "#fbbf24", letterSpacing: 1.5 }}>OVER {Math.round(elapsed - matchMin)}M</span>}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: "#475569", fontStyle: "italic", marginTop: 4 }}>Available for next match</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function tName(t: any): string {
  if (!t || !t.p1) return "TBD";
  return t.p2 ? `${t.p1.name} & ${t.p2.name}` : t.p1.name;
}
