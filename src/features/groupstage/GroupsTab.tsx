import { CategoryFilter } from "../../components/CategoryFilter";
import type { Category, Match, TeamWithPlayers } from "../../types";

export type GroupStanding = { team: TeamWithPlayers; w: number; l: number; pts: number; pf: number; pa: number };

/**
 * Group-stage view: per-group standings tables + match cards.
 *
 * Admin sees a "Start Knockout" CTA once every group's matches are confirmed.
 * Top 2 rows are highlighted green (kept for visual continuity with the
 * Standings panel on Live — though the actual top_n_advance can differ;
 * a future refactor could thread that through here too).
 */
export function GroupsTab({
  categories,
  currentCategoryId,
  setCurrentCategoryId,
  currentCategory,
  groups,
  groupMatches,
  getStandings,
  isAdmin,
  allGroupsDone,
  phase,
  onStartKnockout,
  btn,
  MatchCard,
}: {
  categories: Category[];
  currentCategoryId: string | null;
  setCurrentCategoryId: (id: string | null) => void;
  currentCategory: Category | null;
  groups: TeamWithPlayers[][];
  groupMatches: Match[];
  getStandings: (g: TeamWithPlayers[], gi: number) => GroupStanding[];
  isAdmin: boolean;
  allGroupsDone: boolean;
  phase: "none" | "group" | "knockout";
  onStartKnockout: () => void;
  btn: (bg?: string, clr?: string) => React.CSSProperties;
  MatchCard: React.ComponentType<{ match: Match; editable?: boolean; matchMinutes?: number }>;
}) {
  return (
    <div>
      <CategoryFilter categories={categories} currentCategoryId={currentCategoryId} onSelect={setCurrentCategoryId} />
      {groups.map((g, gi) => {
        const st = getStandings(g, gi);
        const ms = groupMatches.filter(m => m.group_idx === gi);
        return (
          <div key={gi} style={{ marginBottom: 32, background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 16px rgba(0,0,0,0.04)", border: "1px solid #e8ecf1" }}>
            <div style={{ background: "linear-gradient(90deg,#1a1a2e,#2d3a5c)", padding: "14px 20px" }}>
              <span style={{ background: "#3A86FF", color: "#fff", borderRadius: 8, padding: "4px 14px", fontSize: 14, fontWeight: 800 }}>Group {String.fromCharCode(65 + gi)}</span>
              <span style={{ color: "#94a3b8", fontSize: 13, marginLeft: 10 }}>{g.length} teams • {ms.filter(m => m.confirmed).length}/{ms.length} matches</span>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ overflowX: "auto", marginBottom: 16 }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 4px" }}>
                  <thead><tr>{["#", "Team", "W", "L", "PF", "PA", "+/-", "Pts"].map(h => <th key={h} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: 1 }}>{h}</th>)}</tr></thead>
                  <tbody>{st.map((s, si) => (
                    <tr key={s.team.id} style={{ background: si < 2 ? "#f0fdf4" : "#f8fafc" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 800, color: si < 2 ? "#16a34a" : "#94a3b8" }}>{si + 1}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 600 }}>{s.team.p2 ? `${s.team.p1.name} & ${s.team.p2.name}` : s.team.p1.name}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: "#16a34a" }}>{s.w}</td>
                      <td style={{ padding: "10px 12px", color: "#E63946" }}>{s.l}</td>
                      <td style={{ padding: "10px 12px" }}>{s.pf}</td>
                      <td style={{ padding: "10px 12px" }}>{s.pa}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: s.pf - s.pa > 0 ? "#16a34a" : s.pf - s.pa < 0 ? "#E63946" : "#94a3b8" }}>{s.pf - s.pa > 0 ? "+" : ""}{s.pf - s.pa}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 900, fontSize: 18, color: "#3A86FF" }}>{s.pts}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
                {ms.map(m => <MatchCard key={m.id} match={m} matchMinutes={currentCategory?.match_minutes} />)}
              </div>
            </div>
          </div>
        );
      })}
      {isAdmin && allGroupsDone && phase === "group" && (
        <div style={{ textAlign: "center", marginTop: 24, padding: 28, background: "linear-gradient(135deg,#f0fdf4,#dcfce7)", borderRadius: 16, border: "2px solid #86efac" }}>
          <button onClick={onStartKnockout} style={{ ...btn("#E63946"), padding: "16px 44px", fontSize: 18, borderRadius: 14 }}>⚔️ Start Knockout Stage</button>
        </div>
      )}
    </div>
  );
}
