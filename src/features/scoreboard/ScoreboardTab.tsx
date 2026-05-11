import { CategoryFilter } from "../../components/CategoryFilter";
import type { Category, Match, TeamWithPlayers, Tournament } from "../../types";

/**
 * Cross-stage standings view. Counts group-stage W/L and PF/PA, layers in
 * knockout state (in-bracket / eliminated / champion), and ranks teams by
 * points → point diff. Pinned champion at the top when present.
 *
 * Read-only — no actions or mutations. Visible to all users.
 */
export function ScoreboardTab({
  categories,
  currentCategoryId,
  setCurrentCategoryId,
  teamsView,
  groupMatches,
  knockoutMatches,
  champion,
  phase,
}: {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tournament?: Tournament; // accepted for symmetry with other tabs; unused
  categories: Category[];
  currentCategoryId: string | null;
  setCurrentCategoryId: (id: string | null) => void;
  teamsView: TeamWithPlayers[];
  groupMatches: Match[];
  knockoutMatches: Match[];
  champion: TeamWithPlayers | null;
  phase: "none" | "group" | "knockout";
}) {
  type Row = { team: TeamWithPlayers; gw: number; gl: number; pf: number; pa: number; status: string };
  const all: Record<string, Row> = {};
  teamsView.forEach(t => { all[t.id] = { team: t, gw: 0, gl: 0, pf: 0, pa: 0, status: "Registered" }; });

  groupMatches.filter(m => m.confirmed).forEach(m => {
    const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
    if (m.team_a_id && all[m.team_a_id]) { all[m.team_a_id].pf += sa; all[m.team_a_id].pa += sb; }
    if (m.team_b_id && all[m.team_b_id]) { all[m.team_b_id].pf += sb; all[m.team_b_id].pa += sa; }
    if (m.winner_id && all[m.winner_id]) all[m.winner_id].gw++;
    const loserId = m.winner_id === m.team_a_id ? m.team_b_id : m.team_a_id;
    if (loserId && all[loserId]) all[loserId].gl++;
  });

  const koT = new Set<string>(), koL = new Set<string>();
  knockoutMatches.forEach(m => { if (m.team_a_id) koT.add(m.team_a_id); if (m.team_b_id) koT.add(m.team_b_id); });
  knockoutMatches.filter(m => m.confirmed && !m.is_bye).forEach(m => {
    const loserId = m.winner_id === m.team_a_id ? m.team_b_id : m.team_a_id;
    if (loserId) koL.add(loserId);
  });

  Object.values(all).forEach(s => {
    if (champion && champion.id === s.team.id) s.status = "🏆 Champion";
    else if (koL.has(s.team.id)) s.status = "❌ Eliminated (KO)";
    else if (koT.has(s.team.id)) s.status = "⚔️ In Knockout";
    else if (phase === "knockout") s.status = "❌ Eliminated (Group)";
    else if (phase === "group") s.status = "📊 Group Stage";
    else s.status = "📝 Registered";
  });

  const sorted = Object.values(all).sort((a, b) => {
    if (champion) {
      if (a.team.id === champion.id) return -1;
      if (b.team.id === champion.id) return 1;
    }
    return (b.gw * 3) - (a.gw * 3) || (b.pf - b.pa) - (a.pf - a.pa);
  });

  return (
    <div>
      <CategoryFilter categories={categories} currentCategoryId={currentCategoryId} onSelect={setCurrentCategoryId} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: 28 }}>🏅</span>
        <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Scoreboard</h2>
      </div>
      <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 16px rgba(0,0,0,0.05)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "linear-gradient(90deg,#1a1a2e,#2d3a5c)" }}>
              {["Rank", "Team", "W", "L", "PF", "PA", "+/-", "Status"].map(h => (
                <th key={h} style={{ padding: "14px 16px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: 1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => (
              <tr key={s.team.id} style={{ borderBottom: "1px solid #f1f5f9", background: champion && champion.id === s.team.id ? "#fefce8" : i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                <td style={{ padding: "12px 16px", fontWeight: 900, color: i === 0 && champion ? "#f59e0b" : "#3A86FF" }}>{i + 1}</td>
                <td style={{ padding: "12px 16px", fontWeight: 600 }}>{s.team.p2 ? `${s.team.p1.name} & ${s.team.p2.name}` : s.team.p1.name}</td>
                <td style={{ padding: "12px 16px", fontWeight: 700, color: "#16a34a" }}>{s.gw}</td>
                <td style={{ padding: "12px 16px", color: "#E63946" }}>{s.gl}</td>
                <td style={{ padding: "12px 16px" }}>{s.pf}</td>
                <td style={{ padding: "12px 16px" }}>{s.pa}</td>
                <td style={{ padding: "12px 16px", fontWeight: 700, color: s.pf - s.pa > 0 ? "#16a34a" : s.pf - s.pa < 0 ? "#E63946" : "#94a3b8" }}>{s.pf - s.pa > 0 ? "+" : ""}{s.pf - s.pa}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600 }}>{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
