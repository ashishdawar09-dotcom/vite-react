import { useEffect, useMemo, useState } from "react";
import * as db from "../lib/db";
import { CourtPicker } from "./CourtPicker";
import { CourtStatus } from "./CourtStatus";
import { fmtClock } from "../hooks/useScheduling";
import type { Category, Player, ProjectedMatch, Team, Tournament } from "../types";

type TeamView = Team & { p1: Player; p2: Player | null };

export function MatchesTab({
  tournament,
  categories,
  matches,
  teamById,
  playerById,
  liveByCourt,
  isAdmin,
}: {
  tournament: Tournament;
  categories: Category[];
  matches: ProjectedMatch[];
  teamById: Record<string, TeamView | undefined>;
  playerById: Record<string, Player | undefined>;
  liveByCourt: Record<number, ProjectedMatch | undefined>;
  isAdmin: boolean;
}) {
  const [filterCat, setFilterCat] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterCourt, setFilterCourt] = useState<string>("");
  const [pickingCourtFor, setPickingCourtFor] = useState<ProjectedMatch | null>(null);
  const [reassigningCourtFor, setReassigningCourtFor] = useState<ProjectedMatch | null>(null);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [timeOverPicking, setTimeOverPicking] = useState<{ matchId: string; action: "walkover" | "winner" } | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const catById = Object.fromEntries(categories.map(c => [c.id, c]));
  const busyCourts = new Set(Object.keys(liveByCourt).map(n => parseInt(n)));

  const filtered = useMemo(() => {
    return matches.filter(m => {
      if (filterCat && m.category_id !== filterCat) return false;
      if (filterStatus && m.status !== filterStatus) return false;
      if (filterCourt && String(m.court_number ?? "") !== filterCourt) return false;
      return true;
    }).sort((a, b) => {
      const order = { live: 0, pending: 1, completed: 2 };
      const oa = order[a.status];
      const ob = order[b.status];
      if (oa !== ob) return oa - ob;
      const ta = new Date(a.projected_start_at ?? 0).getTime();
      const tb = new Date(b.projected_start_at ?? 0).getTime();
      return ta - tb;
    });
  }, [matches, filterCat, filterStatus, filterCourt]);

  // Pending matches per category for reordering
  const pendingByCat = useMemo(() => {
    const map = new Map<string, ProjectedMatch[]>();
    for (const m of filtered) {
      if (m.status !== "pending") continue;
      const arr = map.get(m.category_id) ?? [];
      arr.push(m);
      map.set(m.category_id, arr);
    }
    return map;
  }, [filtered]);

  const moveMatch = async (m: ProjectedMatch, direction: "up" | "down") => {
    const pending = pendingByCat.get(m.category_id);
    if (!pending) return;
    const idx = pending.findIndex(x => x.id === m.id);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= pending.length) return;
    const other = pending[swapIdx];
    const pos1 = m.queue_position ?? m.slot_idx;
    const pos2 = other.queue_position ?? other.slot_idx;
    await db.swapMatchQueuePositions(m.id, pos1, other.id, pos2);
  };

  const canMove = (m: ProjectedMatch, direction: "up" | "down") => {
    const pending = pendingByCat.get(m.category_id);
    if (!pending) return false;
    const idx = pending.findIndex(x => x.id === m.id);
    return direction === "up" ? idx > 0 : idx < pending.length - 1;
  };

  const startMatch = async (m: ProjectedMatch, court: number) => {
    const teamA = m.team_a_id ? teamById[m.team_a_id] : null;
    const teamB = m.team_b_id ? teamById[m.team_b_id] : null;
    const playerIds = new Set<string>();
    if (teamA) { playerIds.add(teamA.p1_id); if (teamA.p2_id) playerIds.add(teamA.p2_id); }
    if (teamB) { playerIds.add(teamB.p1_id); if (teamB.p2_id) playerIds.add(teamB.p2_id); }

    const conflicts: string[] = [];
    for (const live of Object.values(liveByCourt)) {
      if (!live || live.id === m.id) continue;
      const lTeamA = live.team_a_id ? teamById[live.team_a_id] : null;
      const lTeamB = live.team_b_id ? teamById[live.team_b_id] : null;
      const liveIds = new Set<string>();
      if (lTeamA) { liveIds.add(lTeamA.p1_id); if (lTeamA.p2_id) liveIds.add(lTeamA.p2_id); }
      if (lTeamB) { liveIds.add(lTeamB.p1_id); if (lTeamB.p2_id) liveIds.add(lTeamB.p2_id); }
      for (const pid of playerIds) {
        if (liveIds.has(pid)) {
          const name = playerById[pid]?.name ?? "?";
          conflicts.push(`${name} is on Court ${live.court_number}`);
        }
      }
    }
    if (conflicts.length && conflictWarning !== "confirmed") {
      setConflictWarning(`Player conflict: ${conflicts.join(", ")}. Click "Pick Court" again to override.`);
      setTimeout(() => setConflictWarning("confirmed"), 50);
      return;
    }

    try {
      await db.startMatchOnCourt(m.id, court);
      setPickingCourtFor(null);
      setConflictWarning(null);
    } catch (e: any) {
      alert(e?.message ?? "Failed to start match");
    }
  };

  const inlineScore = async (m: ProjectedMatch, side: "a" | "b", delta: number) => {
    const cur = side === "a" ? (m.score_a ?? 0) : (m.score_b ?? 0);
    const next = Math.max(0, cur + delta);
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
    await db.updateMatch(m.id, side === "a" ? { score_a: next } : { score_b: next });
  };

  const confirmMatch = async (m: ProjectedMatch) => {
    const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
    if (sa === 0 && sb === 0) { alert("Enter a score before confirming"); return; }
    if (sa === sb) { alert("No ties allowed"); return; }
    const winner_id = sa > sb ? m.team_a_id : m.team_b_id;
    await db.updateMatch(m.id, { winner_id, confirmed: true, status: "completed", confirmed_at: new Date().toISOString() });
    propagateKnockout(m, winner_id);
  };

  const propagateKnockout = async (m: ProjectedMatch, winner_id: string | null) => {
    if (m.stage !== "knockout" || m.round_idx == null || !winner_id) return;
    const next = matches.find(x => x.category_id === m.category_id && x.stage === "knockout" && x.round_idx === (m.round_idx! + 1) && x.slot_idx === Math.floor(m.slot_idx / 2));
    if (next) {
      const patch = m.slot_idx % 2 === 0 ? { team_a_id: winner_id } : { team_b_id: winner_id };
      await db.updateMatch(next.id, patch);
    }
  };

  const markWalkover = async (m: ProjectedMatch, winnerSide: "a" | "b") => {
    const winnerId = winnerSide === "a" ? m.team_a_id : m.team_b_id;
    if (!winnerId) return;
    await db.markWalkover(m.id, winnerId);
    propagateKnockout(m, winnerId);
    setTimeOverPicking(null);
  };

  const handleSelectWinner = async (m: ProjectedMatch, winnerSide: "a" | "b") => {
    const winnerId = winnerSide === "a" ? m.team_a_id : m.team_b_id;
    if (!winnerId) return;
    await db.selectMatchWinner(m.id, winnerId);
    propagateKnockout(m, winnerId);
    setTimeOverPicking(null);
  };

  const handleExtend = async (m: ProjectedMatch) => {
    await db.extendMatch(m.id, 5);
  };

  const handleReschedule = async (m: ProjectedMatch) => {
    if (!confirm("Reschedule this match? It will go back to pending and scores will be cleared.")) return;
    await db.rescheduleMatch(m.id);
  };

  const handleCancel = async (m: ProjectedMatch) => {
    if (!confirm("Cancel this match? It will be marked completed with no winner.")) return;
    await db.cancelMatch(m.id);
  };

  const handleReassignCourt = async (m: ProjectedMatch, court: number) => {
    await db.reassignCourt(m.id, court);
    setReassigningCourtFor(null);
  };

  const isTimeOver = (m: ProjectedMatch) => {
    if (m.status !== "live" || !m.started_at) return false;
    const cat = catById[m.category_id];
    if (!cat) return false;
    const matchMin = cat.match_minutes || 12;
    const extended = (m as any).extended_minutes ?? 0;
    const elapsed = (now - new Date(m.started_at).getTime()) / 60_000;
    return elapsed > matchMin + extended;
  };

  const stageLabel = (m: ProjectedMatch) => {
    if (m.stage === "group") return `GROUP ${String.fromCharCode(65 + (m.group_idx ?? 0))}`;
    const total = matches.filter(x => x.category_id === m.category_id && x.stage === "knockout").reduce((mx, x) => Math.max(mx, x.round_idx ?? 0), 0) + 1;
    const ri = m.round_idx ?? 0;
    if (ri === total - 1) return "FINAL";
    if (ri === total - 2) return "SEMI";
    if (ri === total - 3) return "QUARTER";
    return `RD ${ri + 1}`;
  };

  const tName = (t: TeamView | null | undefined) => t?.p1 ? (t.p2 ? `${t.p1.name} & ${t.p2.name}` : t.p1.name) : "TBD";

  // For court reassignment, exclude the match's own court from busy list
  const reassignBusyCourts = useMemo(() => {
    if (!reassigningCourtFor) return busyCourts;
    const s = new Set(busyCourts);
    if (reassigningCourtFor.court_number != null) s.delete(reassigningCourtFor.court_number);
    return s;
  }, [busyCourts, reassigningCourtFor]);

  return (
    <div style={{ background: "#0a1628", borderRadius: 14, padding: 20, border: "1px solid #1a3050", color: "#fff" }}>
      <CourtStatus numCourts={tournament.num_courts} liveByCourt={liveByCourt} categories={categories} teamById={teamById} />

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, padding: 12, background: "#0f1e36", borderRadius: 8, border: "1px solid #1a3050" }}>
        <FilterChip label="CATEGORY" value={filterCat} onChange={setFilterCat} options={[{ v: "", l: "All" }, ...categories.map(c => ({ v: c.id, l: c.name }))]} />
        <FilterChip label="STATUS" value={filterStatus} onChange={setFilterStatus} options={[{ v: "", l: "All" }, { v: "pending", l: "Pending" }, { v: "live", l: "Live" }, { v: "completed", l: "Completed" }]} />
        <FilterChip label="COURT" value={filterCourt} onChange={setFilterCourt} options={[{ v: "", l: "All" }, ...Array.from({ length: tournament.num_courts }, (_, i) => ({ v: String(i + 1), l: `Court ${i + 1}` }))]} />
        <div style={{ flex: 1 }} />
        <span className="font-display" style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, letterSpacing: 1, padding: "6px 10px" }}>{filtered.length} MATCH{filtered.length === 1 ? "" : "ES"}</span>
      </div>

      {/* Match rows */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "#64748b", background: "#0f1e36", borderRadius: 8, border: "1px solid #1a3050" }}>
          No matches match these filters.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map(m => {
            const cat = catById[m.category_id];
            const ta = m.team_a_id ? teamById[m.team_a_id] : null;
            const tb = m.team_b_id ? teamById[m.team_b_id] : null;
            const isLive = m.status === "live";
            const isCompleted = m.confirmed;
            const winA = isCompleted && m.winner_id === m.team_a_id;
            const winB = isCompleted && m.winner_id === m.team_b_id;
            const deltaColor = isCompleted ? (m.delta_min != null && m.delta_min > 1 ? "#fbbf24" : m.delta_min != null && m.delta_min < -1 ? "#22c55e" : "#94a3b8") : isLive ? (m.delta_min != null && m.delta_min > 1 ? "#ef4444" : "#00d4ff") : "#94a3b8";
            const timeOver = isTimeOver(m);
            const pickingTeamForThis = timeOverPicking && timeOverPicking.matchId === m.id;

            return (
              <div key={m.id} style={{ background: isLive ? (timeOver ? "linear-gradient(90deg,#2a0f0f 0%,#0f1e36 30%)" : "linear-gradient(90deg,#1a0f0f 0%,#0f1e36 30%)") : "#0f1e36", border: isLive ? (timeOver ? "1px solid #f59e0b" : "1px solid #ef4444") : "1px solid #1a3050", borderRadius: 8, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", position: "relative" }}>
                {isLive && <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 3, background: timeOver ? "#f59e0b" : "#ef4444" }} />}
                {/* Category + stage */}
                <div style={{ minWidth: 130 }}>
                  <div className="font-display" style={{ fontSize: 11, color: "#00d4ff", fontWeight: 700, letterSpacing: 1.2 }}>{cat?.name?.toUpperCase() ?? "—"}</div>
                  <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, letterSpacing: 1, marginTop: 2 }}>{stageLabel(m)}</div>
                  {timeOver && <div className="font-display" style={{ fontSize: 10, fontWeight: 800, color: "#f59e0b", marginTop: 4, letterSpacing: 1.2 }}>⏰ TIME OVER</div>}
                </div>

                {/* Teams */}
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: winA ? 800 : 600, color: winA ? "#22c55e" : "#fff" }}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tName(ta)}</span>
                    {(isLive || isCompleted) && (
                      isAdmin && isLive ? <ScoreStepper value={m.score_a ?? 0} onPlus={() => inlineScore(m, "a", 1)} onMinus={() => inlineScore(m, "a", -1)} /> : <span className="font-display" style={{ fontSize: 18, fontWeight: 800, minWidth: 28, textAlign: "right", color: winA ? "#22c55e" : "#fff" }}>{m.score_a ?? 0}</span>
                    )}
                  </div>
                  <div style={{ height: 1, background: "#1a3050", margin: "4px 0" }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: winB ? 800 : 600, color: winB ? "#22c55e" : "#fff" }}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tName(tb)}</span>
                    {(isLive || isCompleted) && (
                      isAdmin && isLive ? <ScoreStepper value={m.score_b ?? 0} onPlus={() => inlineScore(m, "b", 1)} onMinus={() => inlineScore(m, "b", -1)} /> : <span className="font-display" style={{ fontSize: 18, fontWeight: 800, minWidth: 28, textAlign: "right", color: winB ? "#22c55e" : "#fff" }}>{m.score_b ?? 0}</span>
                    )}
                  </div>
                </div>

                {/* Time / court / status */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, minWidth: 130 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {m.court_number != null && (
                      isAdmin && isLive ? (
                        <button onClick={() => setReassigningCourtFor(m)} className="font-display" style={{ fontSize: 11, fontWeight: 700, color: "#fff", padding: "3px 8px", background: "rgba(0,184,255,0.15)", border: "1px solid rgba(0,184,255,0.3)", borderRadius: 4, letterSpacing: 1, cursor: "pointer" }} title="Change court">COURT {m.court_number} ✏️</button>
                      ) : (
                        <span className="font-display" style={{ fontSize: 11, fontWeight: 700, color: "#fff", padding: "3px 8px", background: "rgba(0,184,255,0.15)", border: "1px solid rgba(0,184,255,0.3)", borderRadius: 4, letterSpacing: 1 }}>COURT {m.court_number}</span>
                      )
                    )}
                    {m.is_walkover && <span className="font-display" style={{ fontSize: 10, fontWeight: 800, color: "#fbbf24", padding: "3px 8px", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 4, letterSpacing: 1 }}>W/O</span>}
                  </div>
                  <div className="font-display" style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, letterSpacing: 0.5 }}>{fmtClock(m.projected_start_at)}</div>
                  <div className="font-display" style={{ fontSize: 10, fontWeight: 700, color: deltaColor, letterSpacing: 1 }}>{m.delta_label}</div>
                </div>

                {/* Admin actions */}
                {isAdmin && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", width: "100%" }}>
                    {m.status === "pending" && !m.is_bye && m.team_a_id && m.team_b_id && (
                      <>
                        <button onClick={() => setPickingCourtFor(m)} className="font-display" style={{ padding: "8px 12px", borderRadius: 5, border: "none", background: busyCourts.size >= tournament.num_courts ? "#475569" : "#dc2626", color: "#fff", fontSize: 11, fontWeight: 700, cursor: busyCourts.size >= tournament.num_courts ? "not-allowed" : "pointer", letterSpacing: 1, opacity: busyCourts.size >= tournament.num_courts ? 0.5 : 1 }} disabled={busyCourts.size >= tournament.num_courts} title={busyCourts.size >= tournament.num_courts ? "All courts in use" : ""}>▶ START</button>
                        <button onClick={() => moveMatch(m, "up")} disabled={!canMove(m, "up")} style={{ padding: "8px 10px", borderRadius: 5, border: "1px solid #1a3050", background: "transparent", color: canMove(m, "up") ? "#94a3b8" : "#334155", fontSize: 14, fontWeight: 800, cursor: canMove(m, "up") ? "pointer" : "not-allowed", opacity: canMove(m, "up") ? 1 : 0.4 }} title="Move up">↑</button>
                        <button onClick={() => moveMatch(m, "down")} disabled={!canMove(m, "down")} style={{ padding: "8px 10px", borderRadius: 5, border: "1px solid #1a3050", background: "transparent", color: canMove(m, "down") ? "#94a3b8" : "#334155", fontSize: 14, fontWeight: 800, cursor: canMove(m, "down") ? "pointer" : "not-allowed", opacity: canMove(m, "down") ? 1 : 0.4 }} title="Move down">↓</button>
                      </>
                    )}
                    {isLive && !timeOver && (
                      <button onClick={() => confirmMatch(m)} className="font-display" style={{ padding: "8px 12px", borderRadius: 5, border: "none", background: "#16a34a", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: 1 }}>✓ CONFIRM</button>
                    )}

                    {/* Time-over actions */}
                    {isLive && timeOver && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", width: "100%", padding: "8px 0 0", borderTop: "1px solid #f59e0b33" }}>
                        <button onClick={() => handleExtend(m)} style={{ padding: "6px 12px", borderRadius: 5, border: "1px solid #3b82f6", background: "rgba(59,130,246,0.15)", color: "#60a5fa", fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5 }}>+5 MIN</button>
                        <button onClick={() => confirmMatch(m)} className="font-display" style={{ padding: "6px 12px", borderRadius: 5, border: "none", background: "#16a34a", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5 }}>✓ CONFIRM</button>
                        <button onClick={() => setTimeOverPicking({ matchId: m.id, action: "walkover" })} style={{ padding: "6px 12px", borderRadius: 5, border: "1px solid #f59e0b", background: "rgba(245,158,11,0.15)", color: "#fbbf24", fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5 }}>WALKOVER</button>
                        <button onClick={() => setTimeOverPicking({ matchId: m.id, action: "winner" })} style={{ padding: "6px 12px", borderRadius: 5, border: "1px solid #22c55e", background: "rgba(34,197,94,0.15)", color: "#4ade80", fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5 }}>SELECT WINNER</button>
                        <button onClick={() => handleReschedule(m)} style={{ padding: "6px 12px", borderRadius: 5, border: "1px solid #64748b", background: "transparent", color: "#94a3b8", fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5 }}>RESCHEDULE</button>
                        <button onClick={() => handleCancel(m)} style={{ padding: "6px 12px", borderRadius: 5, border: "1px solid #ef4444", background: "rgba(239,68,68,0.1)", color: "#f87171", fontSize: 10, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5 }}>CANCEL</button>
                      </div>
                    )}

                    {/* Team picker for walkover/winner selection */}
                    {pickingTeamForThis && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", width: "100%", padding: "8px 0 0" }}>
                        <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, alignSelf: "center" }}>
                          {pickingTeamForThis ? (timeOverPicking!.action === "walkover" ? "Walkover — pick winner:" : "Select winner:") : ""}
                        </span>
                        <button onClick={() => timeOverPicking!.action === "walkover" ? markWalkover(m, "a") : handleSelectWinner(m, "a")} style={{ padding: "6px 12px", borderRadius: 5, border: "1px solid #22c55e", background: "rgba(34,197,94,0.15)", color: "#4ade80", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{tName(ta)}</button>
                        <button onClick={() => timeOverPicking!.action === "walkover" ? markWalkover(m, "b") : handleSelectWinner(m, "b")} style={{ padding: "6px 12px", borderRadius: 5, border: "1px solid #22c55e", background: "rgba(34,197,94,0.15)", color: "#4ade80", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{tName(tb)}</button>
                        <button onClick={() => setTimeOverPicking(null)} style={{ padding: "6px 8px", borderRadius: 5, border: "1px solid #475569", background: "transparent", color: "#94a3b8", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pickingCourtFor && (
        <CourtPicker
          numCourts={tournament.num_courts}
          busyCourts={busyCourts}
          warning={conflictWarning && conflictWarning !== "confirmed" ? conflictWarning : null}
          onPick={c => startMatch(pickingCourtFor, c)}
          onCancel={() => { setPickingCourtFor(null); setConflictWarning(null); }}
        />
      )}

      {reassigningCourtFor && (
        <CourtPicker
          numCourts={tournament.num_courts}
          busyCourts={reassignBusyCourts}
          warning={null}
          onPick={c => handleReassignCourt(reassigningCourtFor, c)}
          onCancel={() => setReassigningCourtFor(null)}
        />
      )}
    </div>
  );
}

function FilterChip({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 4px 4px 10px", borderRadius: 6, background: "#0a1628", border: "1px solid #1a3050" }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: 1 }}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ padding: "4px 8px", borderRadius: 4, border: "none", background: "transparent", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", outline: "none" }}>
        {options.map(o => <option key={o.v} value={o.v} style={{ background: "#0a1628", color: "#fff" }}>{o.l}</option>)}
      </select>
    </div>
  );
}

function ScoreStepper({ value, onPlus, onMinus }: { value: number; onPlus: () => void; onMinus: () => void }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button onClick={onMinus} style={{ width: 28, height: 28, borderRadius: 5, border: "1px solid #1a3050", background: "#0a1628", color: "#fff", fontSize: 16, fontWeight: 800, cursor: "pointer", padding: 0 }}>−</button>
      <span className="font-display" style={{ minWidth: 32, textAlign: "center", fontSize: 18, fontWeight: 800, color: "#fff" }}>{value}</span>
      <button onClick={onPlus} style={{ width: 28, height: 28, borderRadius: 5, border: "1px solid #00d4ff", background: "rgba(0,184,255,0.15)", color: "#00d4ff", fontSize: 16, fontWeight: 800, cursor: "pointer", padding: 0 }}>+</button>
    </div>
  );
}
