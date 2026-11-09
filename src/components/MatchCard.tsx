import { useCallback, useEffect, useRef, useState } from "react";
import * as db from "../lib/db";
import { ScoreInput } from "./ScoreInput";
import { useShownScores } from "../hooks/useScoreTaps";
import { timeOverPickerOpen } from "../lib/scoring";
import { Av } from "./ui";
import type { GameScore, Match, Player, Team } from "../types";
import { currentGame, endGameAction, gameTarget, gamesOf, gamesWon, isBestOf3, playMinutes } from "../lib/bestOf3";
import { isCancelledMatch } from "../lib/matchOutcome";
import { sitOutWalkoverWinner, teamSittingOut } from "../lib/sitOut";
import { CourtCallEmailStatus } from "../features/raceEmails/CourtCallEmailStatus";

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
  /** Rejects if the save fails, so the score box stops showing the unsaved number. */
  setScore: (match: Match, side: "a" | "b", next: number) => void | Promise<void>;
  startMatch: (matchId: string) => void;
  beginScoring: (matchId: string) => void | Promise<void>;
  cancelAllocation: (match: Match) => Promise<void>;
  /** `shown` = the scores in the boxes, which may be ahead of `match` while a save is in flight. */
  confirmFinalScore: (match: Match, shown?: ShownScores) => Promise<void>;
  saveEditedMatch: (match: Match, shown?: ShownScores) => Promise<void>;
  /** After picking a walkover/winner; should also propagate the winner forward. */
  selectWinner: (match: Match, winnerId: string) => Promise<void>;
  markWalkover: (match: Match, winnerId: string) => Promise<void>;
  /**
   * Best of 3: end the game on screen; when it decides the match this
   * confirms it. "not-over" = the score can't end a game to 15: the card asks,
   * then calls again with `force`.
   */
  endGame: (match: Match, shown: ShownScores, force?: boolean) => Promise<"saved" | "not-over" | null>;
  /** Best of 3: put the last finished game back into the score boxes. */
  undoGame: (match: Match) => Promise<void>;
  /** Best of 3: Save on Edit Score, with every game's points. */
  saveEditedGames: (match: Match, games: GameScore[]) => Promise<void>;
  /** Unplayed match, one team sitting out: the other team wins, no court needed. */
  recordSitOutWalkover: (match: Match) => Promise<void>;
};

export type ShownScores = { a: number | null; b: number | null };

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
  // Best of 3 (src/lib/bestOf3.ts): while live the boxes hold the current
  // game; finished games are in `games`. Editing a result edits the games.
  const bo3 = isBestOf3(m);
  const games = gamesOf(m);
  const [gwA, gwB] = gamesWon(games);
  const inlineMode = isAdmin && editable && (m.status === "live" || (isEditing && !bo3));
  const showStaticScore = m.confirmed || (m.score_a != null || m.score_b != null);
  const winA = m.confirmed && m.winner_id === ta?.id;
  const winB = m.confirmed && m.winner_id === tb?.id;
  // Warming up = court allocated, scoring not yet begun. Status still `pending` at the DB.
  const isWarming = !m.confirmed && m.status !== "live" && !!m.court_allocated_at && !m.started_at;
  // A team here is sitting out (Sit Out on their profile): the other team
  // gets a walkover instead of the match going on a court.
  const sitOutWinner = sitOutWalkoverWinner(m, teamById);
  const unplayed = !m.confirmed && m.status !== "live" && !m.is_bye;

  // What the score boxes show right now. Typing then tapping Confirm used to
  // confirm the scores from before the typed one had saved, with the wrong
  // winner; Confirm and Save read these instead.
  const shown = useRef<{ a?: number; b?: number }>({});
  // +/− taps show at once and save in order (src/lib/scoreTaps.ts).
  const onScreen = useShownScores(m);
  // Editing a confirmed result: changes stay on the card until 💾 Save, which
  // writes the scores and the winner together; Cancel drops them. They used to
  // save as they were made, so Cancel left the new score with the old winner.
  const [draft, setDraft] = useState<{ a: number; b: number } | null>(null);
  if (isEditing && !draft) setDraft({ a: m.score_a ?? 0, b: m.score_b ?? 0 });
  if (!isEditing && draft) setDraft(null);
  // Edit Score on a best-of-3 result: three game rows, as typed text.
  const [gamesDraft, setGamesDraft] = useState<string[][] | null>(null);
  if (isEditing && bo3 && !gamesDraft) setGamesDraft([0, 1, 2].map(i => (games[i] ? games[i].map(String) : ["", ""])));
  if (!isEditing && gamesDraft) setGamesDraft(null);
  const editGame = (row: number, col: number, text: string) =>
    setGamesDraft(d => d && d.map((r, i) => (i === row ? r.map((c, j) => (j === col ? text.replace(/[^0-9]/g, "") : c)) : r)));
  const draftGames = (): GameScore[] => {
    const out: GameScore[] = [];
    for (const [x, y] of gamesDraft ?? []) {
      if (x === "" && y === "") break;
      out.push([Number(x) || 0, Number(y) || 0]);
    }
    return out;
  };
  const editDraft = (side: "a" | "b", next: number | ((cur: number) => number)) =>
    setDraft(d => (d ? { ...d, [side]: Math.max(0, typeof next === "function" ? next(d[side]) : next) } : d));
  const onShownA = useCallback((n: number) => { shown.current.a = n; }, []);
  const onShownB = useCallback((n: number) => { shown.current.b = n; }, []);
  const shownScores = (): ShownScores => ({
    a: inlineMode && shown.current.a !== undefined ? shown.current.a : m.score_a,
    b: inlineMode && shown.current.b !== undefined ? shown.current.b : m.score_b,
  });

  const [cardNow, setCardNow] = useState(() => Date.now());
  const [timeOverPick, setTimeOverPick] = useState<"walkover" | "winner" | null>(null);
  // Close the picker when the match moves on (confirmed, rescheduled,
  // cancelled, here or by another admin). Cards used to remount on every App
  // render, which hid this; now they persist.
  const matchState = `${m.status}|${m.confirmed}`;
  const [pickFor, setPickFor] = useState(matchState);
  if (pickFor !== matchState) { setPickFor(matchState); setTimeOverPick(null); }
  const pickerOpen = timeOverPickerOpen(m, timeOverPick);
  // "15–14 can't end a game to 15": shown for the score it was about, until
  // the score changes or the scorer saves it anyway.
  const [notOverAt, setNotOverAt] = useState<string | null>(null);
  const showNotOver = bo3 && m.status === "live" && !m.confirmed && notOverAt === `${onScreen.a}-${onScreen.b}`;
  const runEndGame = async (force: boolean) => {
    const s = shownScores();
    const r = await actions.endGame(m, s, force);
    setNotOverAt(r === "not-over" ? `${s.a ?? 0}-${s.b ?? 0}` : null);
  };
  // "End Game 2", or "✓ Confirm Match 2–1" once the score on screen ends the game that decides it.
  const endGameLabel = () => {
    const act = endGameAction(m, onScreen.a, onScreen.b);
    return act.decides ? `✓ Confirm Match ${act.score}` : `End Game ${act.game}`;
  };
  useEffect(() => {
    // Tick both for live (play clock) AND warming (warm-up elapsed timer).
    if (m.status !== "live" && !isWarming) return;
    const id = setInterval(() => setCardNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [m.status, isWarming]);

  // A best-of-3 match gets two matches' time before TIME OVER.
  const totalMin = playMinutes(m, matchMinutes);
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
        // Steps from the number on screen, including taps and typed scores still saving.
        onClick={() => {
          if (isEditing) editDraft(side, cur => cur + delta);
          else void actions.adjustScore(m, side, delta);
        }}
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
          {bo3 && !m.confirmed && (m.status === "live" || games.length > 0) && (
            <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, padding: "2px 7px", borderRadius: 6, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #bfdbfe" }}>
              {side === "a" ? gwA : gwB} {(side === "a" ? gwA : gwB) === 1 ? "game" : "games"}
            </span>
          )}
          {unplayed && teamSittingOut(team) && (
            <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, letterSpacing: 0.8, padding: "2px 6px", borderRadius: 4, color: "#b45309", background: "#fef3c7", border: "1px solid #fde68a", textTransform: "uppercase" }}>
              Sitting out
            </span>
          )}
        </div>
        {inlineMode ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
            {stepBtn(-1, "−")}
            <ScoreInput
              value={scoreVal}
              onCommit={(next) => (isEditing ? editDraft(side, next) : actions.setScore(m, side, next))}
              onShownChange={side === "a" ? onShownA : onShownB}
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
    if (!pickerOpen) return;
    const winnerId = side === "a" ? m.team_a_id : m.team_b_id;
    if (!winnerId) return;
    if (!confirm("Mark this match as a walkover? The other team forfeits.")) return;
    await actions.markWalkover(m, winnerId);
    setTimeOverPick(null);
  };

  const handleCardSelectWinner = async (side: "a" | "b") => {
    if (!pickerOpen) return;
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
          {/* Non-breaking spaces: a narrow card wraps between the parts, never inside "Game 2". */}
          {bo3
            ? ` · Best\u00a0of\u00a03${m.status === "live" && !m.confirmed ? ` · Game\u00a0${currentGame(m)}` : ""}`
            : m.stage === "knockout" && !m.is_bye ? " · 1\u00a0game" : ""}
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
        {m.confirmed && !isEditing && (isCancelledMatch(m)
          ? <span style={{ color: "#64748b" }}>Cancelled</span>
          : <span style={{ color: "#16a34a" }}>✓ Confirmed</span>)}
        {isEditing && <span style={{ color: "#f59e0b" }}>✏️ Editing</span>}
      </div>
      <div style={{ padding: "8px 14px 14px" }}>
        {teamRow(ta, "a", isEditing && draft ? draft.a : inlineMode ? onScreen.a : m.score_a ?? 0, winA)}
        <div style={{ height: 1, background: "#f1f5f9", margin: "2px 0" }} />
        {teamRow(tb, "b", isEditing && draft ? draft.b : inlineMode ? onScreen.b : m.score_b ?? 0, winB)}

        {bo3 && games.length > 0 && !isEditing && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {games.map(([x, y], i) => (
              <span key={i} style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 8, background: "#f1f5f9", color: "#334155" }}>
                Game {i + 1} · {x}–{y}
              </span>
            ))}
          </div>
        )}
        {isEditing && bo3 && gamesDraft && (
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", gap: 8, alignItems: "center" }}>
            <span />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tLabel(ta)}</span>
            <span />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tLabel(tb)}</span>
            {gamesDraft.map((row, i) => (
              <GameRow key={i} n={i + 1} row={row} onChange={(col, text) => editGame(i, col, text)} />
            ))}
          </div>
        )}
        {showNotOver && (
          <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: "#b45309" }}>
            {onScreen.a}–{onScreen.b} can't end a game to {gameTarget(m)}. Check the score, or save it anyway.
          </div>
        )}

        {isAdmin && isWarming && (
          <CourtCallEmailStatus
            matchId={m.id}
            allocatedAt={m.court_allocated_at}
            names={[ta?.p1, ta?.p2, tb?.p1, tb?.p2].filter((p): p is Player => !!p).map((p) => [p.id, p.name])}
          />
        )}

        {editable && ta && tb && isAdmin && (
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {sitOutWinner && (
              <button
                onClick={() => void actions.recordSitOutWalkover(m)}
                style={{ ...btn("#d97706"), flex: "1 1 100%", padding: "12px", fontSize: 14, borderRadius: 10 }}
              >
                Walkover: {tLabel(teamFromId(sitOutWinner))} wins
              </button>
            )}
            {unplayed && teamSittingOut(ta) && teamSittingOut(tb) && (
              <div style={{ flex: "1 1 100%", fontSize: 12, color: "#b45309", fontWeight: 600 }}>
                Both teams are sitting out. Bring one back on their profile, then record the walkover.
              </div>
            )}
            {m.status === "pending" && !m.confirmed && !isWarming && !sitOutWinner && !(teamSittingOut(ta) && teamSittingOut(tb)) && (
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
            {m.status === "live" && !m.confirmed && !cardTimeOver && (bo3 ? (
              <button
                onClick={() => void runEndGame(false)}
                style={{ ...btn("#16a34a"), flex: "1 1 100%", padding: "14px", fontSize: 15, borderRadius: 10, fontWeight: 800 }}
              >
                {endGameLabel()}
              </button>
            ) : (
              <button
                onClick={() => void actions.confirmFinalScore(m, shownScores())}
                style={{ ...btn("#16a34a"), flex: "1 1 100%", padding: "14px", fontSize: 15, borderRadius: 10, fontWeight: 800 }}
              >
                ✓ Confirm Final Score
              </button>
            ))}
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
                  onClick={() => void (bo3 ? runEndGame(false) : actions.confirmFinalScore(m, shownScores()))}
                  style={{ ...btn("#16a34a"), flex: "1 1 100px", padding: "10px", fontSize: 12, borderRadius: 10 }}
                >
                  {bo3 ? endGameLabel() : "✓ Confirm"}
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
            {/* Best of 3, after the main buttons (and the time-over ones). */}
            {m.status === "live" && !m.confirmed && bo3 && showNotOver && (
              <button
                onClick={() => void runEndGame(true)}
                style={{ ...btn("#f59e0b"), flex: "1 1 140px", padding: "12px", fontSize: 13, borderRadius: 10 }}
              >
                Save Anyway
              </button>
            )}
            {m.status === "live" && !m.confirmed && bo3 && games.length > 0 && (
              <button
                onClick={() => void actions.undoGame(m)}
                style={{ ...btn("#e2e8f0", "#475569"), flex: "1 1 140px", padding: "12px", fontSize: 13, borderRadius: 10, boxShadow: "none" }}
              >
                ↶ Undo Game {games.length}
              </button>
            )}
            {/* Team picker for walkover/winner in time-over */}
            {pickerOpen && (
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
                  onClick={() => void (bo3 ? actions.saveEditedGames(m, draftGames()) : actions.saveEditedMatch(m, shownScores()))}
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

/** One game's row on Edit Score for a best-of-3 result. */
function GameRow({ n, row, onChange }: { n: number; row: string[]; onChange: (col: number, text: string) => void }) {
  const box = (col: number) => (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={row[col]}
      placeholder="–"
      onChange={(e) => onChange(col, e.target.value)}
      onFocus={(e) => e.target.select()}
      aria-label={`Game ${n}, ${col === 0 ? "first" : "second"} team's points`}
      style={{
        width: "100%", minWidth: 0, height: 44, textAlign: "center", fontSize: 22, fontWeight: 900,
        borderRadius: 10, border: "2px solid #3A86FF", outline: "none", color: "#1a1a2e", background: "#eff6ff", padding: 0,
      }}
    />
  );
  return (
    <>
      <span style={{ fontSize: 12, fontWeight: 800, color: "#475569", whiteSpace: "nowrap" }}>Game {n}</span>
      {box(0)}
      <span style={{ fontWeight: 900, color: "#94a3b8" }}>–</span>
      {box(1)}
    </>
  );
}
