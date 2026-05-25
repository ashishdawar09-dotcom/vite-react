import { useEffect, useState } from "react";
import * as db from "../lib/db";
import { ScoreInput } from "./ScoreInput";
import { Av } from "./ui";
import type { Match, Player, Team } from "../types";

// MatchCard's "team view" — a Team enriched with its player objects.
// Identical to the TeamView type used in App.tsx (kept in sync; if it
// drifts we'll see it at the prop boundary).
export type TeamView = Team & { p1: Player; p2: Player | null };

// Bundle of mutation handlers MatchCard needs. Passed as a single prop
// instead of 10 individual callbacks so the call site is readable and
// adding a new action doesn't churn every consumer.
//
// Most handlers come from App.tsx state setters + state-machine helpers;
// the db.* calls below could also live here if we wanted MatchCard fully
// decoupled from `db`. Left as-is for now to keep the diff small —
// MatchCard's signature already exposes the surface clearly.
export type MatchCardActions = {
  adjustScore: (match: Match, side: "a" | "b", delta: number) => void | Promise<void>;
  setScore: (match: Match, side: "a" | "b", next: number) => void | Promise<void>;
  startMatch: (matchId: string) => void;
  beginScoring: (matchId: string) => void | Promise<void>;
  cancelAllocation: (match: Match) => Promise<void>;
  confirmFinalScore: (match: Match) => Promise<void>;
  saveEditedMatch: (match: Match) => Promise<void>;
  /** After picking a walkover/winner; should also propagate the winner forward. */
  selectWinner: (match: Match, winnerId: string) => Promise<void>;
  markWalkover: (match: Match, winnerId: string) => Promise<void>;
};

const tLabel = (t: TeamView | null) =>
  t?.p1 ? (t.p2 ? `${t.p1.name} & ${t.p2.name}` : t.p1.name) : "TBD";

// Local replica of the App.tsx `btn` style factory. Kept inline so this
// component is self-sufficient — App.tsx's helper stays in App.tsx where
// every other tab needs it.
const btn = (bg = "#3A86FF", clr = "#fff"): React.CSSProperties => ({
  background: bg,
  color: clr,
  border: "none",
  borderRadius: 10,
  padding: "10px 20px",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 14,
  transition: "all .2s",
  boxShadow: `0 2px 8px ${bg}33`,
});

export function MatchCard({
  match: m,
  editable = true,
  matchMinutes,
  isAdmin,
  teamById,
  editingMatchId,
  onStartEdit,
  onCancelEdit,
  onOpenPromotePicker,
  actions,
}: {
  match: Match;
  editable?: boolean;
  matchMinutes?: number;
  isAdmin: boolean;
  teamById: Record<string, TeamView | undefined>;
  editingMatchId: string | null;
  onStartEdit: (matchId: string) => void;
  onCancelEdit: () => void;
  onOpenPromotePicker: (matchId: string, side: "a" | "b") => void;
  actions: MatchCardActions;
}) {
  const teamFromId = (id: string | null): TeamView | null => (id ? teamById[id] ?? null : null);
  const ta = teamFromId(m.team_a_id);
  const tb = teamFromId(m.team_b_id);
  const isEditing = m.confirmed && editingMatchId === m.id;
  const inlineMode = isAdmin && editable && (m.status === "live" || isEditing);
  const showStaticScore = m.confirmed || (m.score_a != null || m.score_b != null);
  const winA = m.confirmed && m.winner_id === ta?.id;
  const winB = m.confirmed && m.winner_id === tb?.id;
  // Warming up = court allocated, scoring not yet begun. Status still `pending` at the DB.
  const isWarming = !m.confirmed && m.status !== "live" && !!m.court_allocated_at && !m.started_at;

  const [cardNow, setCardNow] = useState(Date.now());
  const [timeOverPick, setTimeOverPick] = useState<"walkover" | "winner" | null>(null);
  useEffect(() => {
    // Tick both for live (play clock) AND warming (warm-up elapsed timer).
    if (m.status !== "live" && !isWarming) return;
    const id = setInterval(() => setCardNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [m.status, isWarming]);

  const totalMin = (matchMinutes ?? 12) + (m.extended_minutes ?? 0);
  const cardTimeOver = m.status === "live" && m.started_at
    ? (cardNow - new Date(m.started_at).getTime()) / 60_000 > totalMin
    : false;
  const warmupElapsed = isWarming && m.court_allocated_at
    ? (() => {
        const sec = Math.max(0, Math.floor((cardNow - new Date(m.court_allocated_at).getTime()) / 1000));
        return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
      })()
    : null;

  const teamRow = (team: TeamView | null, side: "a" | "b", scoreVal: number, isWin: boolean) => {
    const stepBtn = (delta: number, label: string) => (
      <button
        onClick={() => void actions.adjustScore(m, side, delta)}
        style={{
          width: 56, height: 56, borderRadius: 14, border: "2px solid #e2e8f0",
          background: "#fff", fontSize: 26, fontWeight: 800, color: "#1a1a2e",
          cursor: "pointer", touchAction: "manipulation", userSelect: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}
        aria-label={label}
      >
        {label}
      </button>
    );
    // Empty knockout slot — show a "Select team" button for admins.
    const isEmptyKnockoutSlot = !team && m.stage === "knockout" && !m.is_bye && !m.confirmed;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "1 1 140px", minWidth: 0 }}>
          {team?.p1 && <Av name={team.p1.name} photo={team.p1.photo_url} sz={34} color={team.p1.color} />}
          {isEmptyKnockoutSlot && isAdmin ? (
            <button
              onClick={() => onOpenPromotePicker(m.id, side)}
              style={{
                padding: "6px 12px", borderRadius: 8, border: "1px dashed #a855f7",
                background: "rgba(168,85,247,0.08)", color: "#a855f7", fontSize: 12,
                fontWeight: 800, letterSpacing: 0.5, cursor: "pointer",
                textTransform: "uppercase",
              }}
              title="Pick a team for this slot"
            >
              + Select Team
            </button>
          ) : (
            <span style={{
              fontWeight: isWin ? 800 : 600,
              fontSize: 14,
              color: isWin ? "#16a34a" : "#1a1a2e",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {tLabel(team)}
            </span>
          )}
        </div>
        {inlineMode ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            {stepBtn(-1, "−")}
            <ScoreInput
              value={scoreVal}
              onCommit={(next) => void actions.setScore(m, side, next)}
            />
            {stepBtn(1, "+")}
          </div>
        ) : (
          <div style={{
            marginLeft: "auto",
            background: showStaticScore ? (isWin ? "#f0fdf4" : "#f8fafc") : "#f8fafc",
            border: `2px solid ${isWin ? "#86efac" : "#e2e8f0"}`,
            borderRadius: 10,
            padding: "8px 18px",
            fontWeight: 900,
            fontSize: 22,
            color: isWin ? "#16a34a" : showStaticScore ? "#1a1a2e" : "#cbd5e1",
            minWidth: 56,
            textAlign: "center",
          }}>
            {showStaticScore ? scoreVal : "—"}
          </div>
        )}
      </div>
    );
  };

  const handleCardWalkover = async (side: "a" | "b") => {
    const winnerId = side === "a" ? m.team_a_id : m.team_b_id;
    if (!winnerId) return;
    if (!confirm("Mark this match as a walkover? The other team forfeits.")) return;
    await actions.markWalkover(m, winnerId);
    setTimeOverPick(null);
  };

  const handleCardSelectWinner = async (side: "a" | "b") => {
    const winnerId = side === "a" ? m.team_a_id : m.team_b_id;
    if (!winnerId) return;
    await actions.selectWinner(m, winnerId);
    setTimeOverPick(null);
  };

  return (
    <div style={{
      background: "#fff",
      borderRadius: 14,
      border: cardTimeOver ? "2px solid #f59e0b"
            : m.status === "live" ? "2px solid #ef4444"
            : isWarming ? "2px solid #fbbf24"
            : "1px solid #e8ecf1",
      overflow: "hidden",
      boxShadow: m.status === "live"
        ? (cardTimeOver ? "0 4px 20px rgba(245,158,11,0.3)" : "0 4px 20px rgba(239,68,68,0.25)")
        : isWarming ? "0 4px 20px rgba(251,191,36,0.2)"
        : "0 2px 12px rgba(0,0,0,0.04)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 14px",
        background: cardTimeOver ? "linear-gradient(90deg,#fffbeb,#fef3c7)"
                  : m.status === "live" ? "linear-gradient(90deg,#fef2f2,#fee2e2)"
                  : isWarming ? "linear-gradient(90deg,#fffbeb,#fef3c7)"
                  : m.confirmed ? "linear-gradient(90deg,#f0fdf4,#dcfce7)"
                  : "linear-gradient(90deg,#f8fafc,#f1f5f9)",
        fontSize: 12, fontWeight: 600,
      }}>
        <span style={{ color: "#64748b" }}>
          Match{m.court_number != null && (isWarming || m.status === "live") ? ` · Court ${m.court_number}` : ""}
        </span>
        {cardTimeOver && (
          <span style={{ color: "#d97706", fontWeight: 800, display: "flex", alignItems: "center", gap: 4 }}>
            ⏰ TIME OVER
          </span>
        )}
        {m.status === "live" && !cardTimeOver && (
          <span style={{ color: "#dc2626", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{
              display: "inline-block", width: 8, height: 8, borderRadius: "50%",
              background: "#dc2626", animation: "pulse 1.5s ease-in-out infinite",
            }} />
            LIVE
          </span>
        )}
        {isWarming && (
          <span style={{ color: "#d97706", fontWeight: 800, display: "flex", alignItems: "center", gap: 4 }}>
            🟡 WARMING UP · {warmupElapsed}
          </span>
        )}
        {m.confirmed && !isEditing && <span style={{ color: "#16a34a" }}>✓ Confirmed</span>}
        {isEditing && <span style={{ color: "#f59e0b" }}>✏️ Editing</span>}
      </div>
      <div style={{ padding: "8px 14px 14px" }}>
        {teamRow(ta, "a", m.score_a ?? 0, winA)}
        <div style={{ height: 1, background: "#f1f5f9", margin: "2px 0" }} />
        {teamRow(tb, "b", m.score_b ?? 0, winB)}

        {editable && ta && tb && isAdmin && (
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {m.status === "pending" && !m.confirmed && !isWarming && (
              <button
                onClick={() => actions.startMatch(m.id)}
                style={{ ...btn("#dc2626"), flex: "1 1 140px", padding: "12px", fontSize: 14, borderRadius: 10 }}
              >
                ▶ Start Match
              </button>
            )}
            {isWarming && (
              <>
                <button
                  onClick={() => void actions.beginScoring(m.id)}
                  style={{ ...btn("#fbbf24", "#1a1a2e"), flex: "1 1 160px", padding: "12px", fontSize: 14, borderRadius: 10, fontWeight: 800 }}
                >
                  ▶ Begin Scoring
                </button>
                <button
                  onClick={() => void actions.cancelAllocation(m)}
                  style={{ ...btn("#e2e8f0", "#475569"), flex: "1 1 140px", padding: "12px", fontSize: 13, borderRadius: 10, boxShadow: "none" }}
                >
                  ↩ Cancel Allocation
                </button>
              </>
            )}
            {m.status === "live" && !m.confirmed && !cardTimeOver && (
              <button
                onClick={() => void actions.confirmFinalScore(m)}
                style={{ ...btn("#16a34a"), flex: "1 1 100%", padding: "14px", fontSize: 15, borderRadius: 10, fontWeight: 800 }}
              >
                ✓ Confirm Final Score
              </button>
            )}
            {/* Time-over actions */}
            {m.status === "live" && !m.confirmed && cardTimeOver && (
              <>
                <button
                  onClick={() => void db.extendMatch(m.id, 5)}
                  style={{ ...btn("#3b82f6"), flex: "1 1 100px", padding: "10px", fontSize: 12, borderRadius: 10 }}
                >
                  +5 Min
                </button>
                <button
                  onClick={() => void actions.confirmFinalScore(m)}
                  style={{ ...btn("#16a34a"), flex: "1 1 100px", padding: "10px", fontSize: 12, borderRadius: 10 }}
                >
                  ✓ Confirm
                </button>
                <button
                  onClick={() => setTimeOverPick("walkover")}
                  style={{ ...btn("#f59e0b"), flex: "1 1 100px", padding: "10px", fontSize: 12, borderRadius: 10 }}
                >
                  Walkover
                </button>
                <button
                  onClick={() => setTimeOverPick("winner")}
                  style={{ ...btn("#22c55e"), flex: "1 1 100px", padding: "10px", fontSize: 12, borderRadius: 10 }}
                >
                  Select Winner
                </button>
                <button
                  onClick={async () => {
                    if (confirm("Reschedule? Match goes back to pending.")) await db.rescheduleMatch(m.id);
                  }}
                  style={{ ...btn("#e2e8f0", "#475569"), flex: "1 1 100px", padding: "10px", fontSize: 12, borderRadius: 10, boxShadow: "none" }}
                >
                  Reschedule
                </button>
                <button
                  onClick={async () => {
                    if (confirm("Cancel match? No winner will be recorded.")) await db.cancelMatch(m.id);
                  }}
                  style={{ ...btn("#dc2626"), flex: "1 1 100px", padding: "10px", fontSize: 12, borderRadius: 10 }}
                >
                  Cancel
                </button>
              </>
            )}
            {/* Team picker for walkover/winner in time-over */}
            {timeOverPick && (
              <div style={{
                display: "flex", gap: 8, width: "100%", flexWrap: "wrap",
                padding: "8px 0 0", borderTop: "1px solid #e2e8f0",
              }}>
                <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600, width: "100%" }}>
                  {timeOverPick === "walkover" ? "Pick walkover winner:" : "Pick winner:"}
                </span>
                <button
                  onClick={() => timeOverPick === "walkover" ? handleCardWalkover("a") : handleCardSelectWinner("a")}
                  style={{ ...btn("#16a34a"), flex: 1, padding: "10px", fontSize: 13, borderRadius: 10 }}
                >
                  {tLabel(ta)}
                </button>
                <button
                  onClick={() => timeOverPick === "walkover" ? handleCardWalkover("b") : handleCardSelectWinner("b")}
                  style={{ ...btn("#16a34a"), flex: 1, padding: "10px", fontSize: 13, borderRadius: 10 }}
                >
                  {tLabel(tb)}
                </button>
                <button
                  onClick={() => setTimeOverPick(null)}
                  style={{ ...btn("#e2e8f0", "#475569"), padding: "10px 16px", fontSize: 12, borderRadius: 10, boxShadow: "none" }}
                >
                  Cancel
                </button>
              </div>
            )}
            {m.confirmed && !isEditing && (
              <button
                onClick={() => onStartEdit(m.id)}
                style={{ ...btn("#f59e0b"), flex: "1 1 140px", padding: "12px", fontSize: 14, borderRadius: 10 }}
              >
                ✏️ Edit Score
              </button>
            )}
            {isEditing && (
              <>
                <button
                  onClick={onCancelEdit}
                  style={{ ...btn("#e2e8f0", "#475569"), flex: "1 1 100px", padding: "12px", fontSize: 14, borderRadius: 10, boxShadow: "none" }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => void actions.saveEditedMatch(m)}
                  style={{ ...btn("#16a34a"), flex: "1 1 140px", padding: "12px", fontSize: 14, borderRadius: 10 }}
                >
                  💾 Save Changes
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
