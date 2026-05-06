import { useState } from "react";
import * as db from "../lib/db";
import { CategoryEditor } from "./CategoryEditor";
import { fmtClock } from "../hooks/useScheduling";
import type { Category, Match, Team, Tournament } from "../types";

export function CategoriesTab({
  tournament,
  categories,
  teams,
  matches,
  isAdmin,
}: {
  tournament: Tournament;
  categories: Category[];
  teams: Team[];
  matches: Match[];
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState<Category | null | "new">(null);
  const [busy, setBusy] = useState(false);

  const setCourts = async (n: number) => {
    if (!isAdmin) return;
    if (n < 1 || n > 12) return;
    setBusy(true);
    try { await db.setNumCourts(tournament.id, n); }
    catch (e: any) { alert(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ background: "#0a1628", borderRadius: 14, padding: 24, border: "1px solid #1a3050", color: "#fff" }}>
      {/* Court count config */}
      <div style={{ background: "#0f1e36", borderRadius: 10, border: "1px solid #1a3050", padding: 18, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h3 className="font-display" style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "#00d4ff" }}>Number of courts</h3>
            <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>How many courts will you use today? Set this on the morning of the tournament.</p>
          </div>
          {isAdmin ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {[1, 2, 3, 4, 6].map(n => (
                <button key={n} disabled={busy} onClick={() => setCourts(n)} className="font-display" style={{ width: 48, height: 48, borderRadius: 8, border: tournament.num_courts === n ? "2px solid #00d4ff" : "1px solid #1a3050", background: tournament.num_courts === n ? "rgba(0,184,255,0.2)" : "transparent", color: tournament.num_courts === n ? "#00d4ff" : "#94a3b8", fontSize: 20, fontWeight: 800, cursor: "pointer" }}>{n}</button>
              ))}
            </div>
          ) : (
            <span className="font-display" style={{ fontSize: 28, fontWeight: 800, color: "#00d4ff" }}>{tournament.num_courts}</span>
          )}
        </div>
      </div>

      {/* Categories list */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 4, height: 22, background: "#a855f7", borderRadius: 1 }} />
          <h2 className="font-display" style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>Categories</h2>
          <span className="font-display" style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, letterSpacing: 1 }}>{categories.length} TOTAL</span>
        </div>
        {isAdmin && (
          <button onClick={() => setEditing("new")} className="font-display" style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "linear-gradient(135deg,#00b8ff,#0066ff)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, letterSpacing: 1.5 }}>+ NEW CATEGORY</button>
        )}
      </div>

      {categories.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "#64748b", background: "#0f1e36", borderRadius: 10, border: "1px solid #1a3050" }}>
          <p style={{ margin: 0, fontSize: 14 }}>{isAdmin ? "Click + NEW CATEGORY to add Men's Singles, Mixed Doubles, etc." : "No categories yet."}</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 14 }}>
          {categories.map(c => {
            const cTeams = teams.filter(t => t.category_id === c.id);
            const cMatches = matches.filter(m => m.category_id === c.id);
            const played = cMatches.filter(m => m.confirmed).length;
            const live = cMatches.filter(m => m.status === "live").length;
            return (
              <div key={c.id} style={{ background: "#0f1e36", borderRadius: 10, border: "1px solid #1a3050", overflow: "hidden", padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div>
                    <h3 className="font-display" style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#fff", letterSpacing: 0.5 }}>{c.name}</h3>
                    <div style={{ marginTop: 4, fontSize: 11, color: "#94a3b8", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>
                      {c.team_size === 1 ? "👤 SINGLES" : "👥 DOUBLES"} · {c.match_minutes}M MATCHES
                    </div>
                  </div>
                  {isAdmin && (
                    <button onClick={() => setEditing(c)} style={{ padding: "5px 10px", borderRadius: 5, border: "1px solid #1a3050", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 11, fontWeight: 600, letterSpacing: 1 }}>EDIT</button>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 12 }}>
                  <Stat label="TEAMS" value={cTeams.length} color="#00d4ff" />
                  <Stat label="LIVE" value={live} color={live > 0 ? "#ef4444" : "#475569"} />
                  <Stat label="DONE" value={`${played}/${cMatches.filter(m => !m.is_bye && m.team_a_id && m.team_b_id).length}`} color="#22c55e" />
                </div>
                <div style={{ marginTop: 12, padding: "8px 10px", background: "#0a1628", borderRadius: 6, border: "1px solid #1a3050" }}>
                  <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 }}>Start Time</div>
                  <div className="font-display" style={{ fontSize: 14, fontWeight: 700, color: c.starts_at ? "#fff" : "#475569" }}>
                    {c.starts_at ? new Date(c.starts_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "NOT SCHEDULED"}
                  </div>
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: c.phase === "knockout" ? "#a855f7" : c.phase === "group" ? "#00d4ff" : "#64748b", fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>
                  STAGE: {c.phase === "none" ? "NOT STARTED" : c.phase === "group" ? "GROUP" : "KNOCKOUT"}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && <CategoryEditor tournamentId={tournament.id} category={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {/* fmtClock referenced for tree-shake guard */}
      <span style={{ display: "none" }}>{fmtClock(null)}</span>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: any; color: string }) {
  return (
    <div style={{ background: "#0a1628", borderRadius: 5, padding: "8px 10px", border: "1px solid #1a3050" }}>
      <div style={{ fontSize: 9, color: "#64748b", fontWeight: 700, letterSpacing: 1.5 }}>{label}</div>
      <div className="font-display" style={{ fontSize: 18, fontWeight: 800, color, letterSpacing: 0.5 }}>{value}</div>
    </div>
  );
}
