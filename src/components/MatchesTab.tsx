import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion"; /* NEW: makeover motion */
import confetti from "canvas-confetti"; /* NEW: celebrate match confirmation */
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as db from "../lib/db";
import { CourtPicker } from "./CourtPicker";
import { CourtStatus } from "./CourtStatus";
import { MatchHistoryModal } from "./MatchHistoryModal";
import { toast } from "./Toast";
import { fmtClock } from "../hooks/useScheduling";
import { useIsMobile } from "../hooks/useIsMobile";
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
  const [historyFor, setHistoryFor] = useState<ProjectedMatch | null>(null);
  const [now, setNow] = useState(Date.now());
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion(); /* NEW: motion gate for whileTap + layoutId */

  // Optimistic order overrides per-category for the pending list.
  // Maps category_id → ordered match-id array set immediately on drag-end so
  // the UI reflects the user's intent without waiting for the server round-trip.
  const [pendingOrderOverrides, setPendingOrderOverrides] = useState<Record<string, string[]>>({});

  // Collapse state per category for the completed sub-section.
  const [collapsedCompleted, setCollapsedCompleted] = useState<Set<string>>(new Set());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Drop optimistic overrides once the server's order matches what we set
  // (i.e. realtime caught up). Compares the order of pending match IDs by
  // queue_position vs the override.
  useEffect(() => {
    if (Object.keys(pendingOrderOverrides).length === 0) return;
    setPendingOrderOverrides(prev => {
      const next: typeof prev = {};
      for (const [catId, idOrder] of Object.entries(prev)) {
        const serverOrder = matches
          .filter(m => m.category_id === catId && m.status === "pending")
          .sort((a, b) => (a.queue_position ?? a.slot_idx) - (b.queue_position ?? b.slot_idx))
          .map(m => m.id);
        if (JSON.stringify(serverOrder) !== JSON.stringify(idOrder)) {
          next[catId] = idOrder;
        }
      }
      return next;
    });
  }, [matches, pendingOrderOverrides]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const catById = Object.fromEntries(categories.map(c => [c.id, c]));

  // Matches currently in the warm-up state (court allocated, scoring not yet
  // begun). Keyed by court number, mirroring liveByCourt's shape. A court can
  // only ever be in ONE of {live, warming, free} at a time.
  const warmingByCourt = useMemo(() => {
    const map: Record<number, ProjectedMatch | undefined> = {};
    for (const m of matches) {
      if (m.court_allocated_at && !m.started_at && m.court_number != null) {
        map[m.court_number] = m;
      }
    }
    return map;
  }, [matches]);

  // Busy = live OR warming. Used to disable Allocate when no court available.
  const busyCourts = useMemo(() => {
    const set = new Set<number>();
    Object.keys(liveByCourt).forEach(n => set.add(parseInt(n)));
    Object.keys(warmingByCourt).forEach(n => set.add(parseInt(n)));
    return set;
  }, [liveByCourt, warmingByCourt]);

  // Group filtered matches by category, then split each into live/pending/completed.
  const sections = useMemo(() => {
    const visible = matches.filter(m => {
      if (filterCat && m.category_id !== filterCat) return false;
      if (filterStatus && m.status !== filterStatus) return false;
      if (filterCourt && String(m.court_number ?? "") !== filterCourt) return false;
      return true;
    });
    const byCategory = new Map<string, ProjectedMatch[]>();
    for (const m of visible) {
      const arr = byCategory.get(m.category_id) ?? [];
      arr.push(m);
      byCategory.set(m.category_id, arr);
    }
    return categories
      .filter(c => byCategory.has(c.id))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(c => {
        const cMatches = byCategory.get(c.id) ?? [];
        const live = cMatches
          .filter(m => m.status === "live")
          .sort((a, b) => new Date(a.started_at ?? 0).getTime() - new Date(b.started_at ?? 0).getTime());
        const serverPending = cMatches
          .filter(m => m.status === "pending")
          .sort((a, b) => (a.queue_position ?? a.slot_idx) - (b.queue_position ?? b.slot_idx));
        const override = pendingOrderOverrides[c.id];
        let pending = serverPending;
        if (override) {
          const byId = new Map(serverPending.map(m => [m.id, m]));
          const ordered: ProjectedMatch[] = [];
          for (const id of override) {
            const m = byId.get(id);
            if (m) { ordered.push(m); byId.delete(id); }
          }
          // Append any new pending matches the override doesn't know about
          for (const m of byId.values()) ordered.push(m);
          pending = ordered;
        }
        const completed = cMatches
          .filter(m => m.confirmed)
          .sort((a, b) => (b.confirmed_at ?? "").localeCompare(a.confirmed_at ?? ""));
        return { category: c, live, pending, completed };
      });
  }, [matches, categories, filterCat, filterStatus, filterCourt, pendingOrderOverrides]);

  const totalVisible = sections.reduce((acc, s) => acc + s.live.length + s.pending.length + s.completed.length, 0);

  const handleDragEnd = async (event: DragEndEvent, categoryId: string, currentPending: ProjectedMatch[]) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = currentPending.findIndex(m => m.id === active.id);
    const newIdx = currentPending.findIndex(m => m.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;

    const reordered = arrayMove(currentPending, oldIdx, newIdx);
    const newOrder = reordered.map(m => m.id);

    // Optimistic
    setPendingOrderOverrides(prev => ({ ...prev, [categoryId]: newOrder }));

    // Server: assign sequential queue_position values (0..N-1) for matches whose
    // position changed. This produces a stable ordering that matches the visual.
    try {
      const writes = reordered
        .map((m, i) => {
          const cur = m.queue_position ?? m.slot_idx;
          if (cur === i) return null;
          return db.updateMatch(m.id, { queue_position: i });
        })
        .filter(Boolean) as Promise<unknown>[];
      await Promise.all(writes);
    } catch (e: any) {
      toast(e?.message ?? "Reorder failed", "error");
      setPendingOrderOverrides(prev => {
        const next = { ...prev };
        delete next[categoryId];
        return next;
      });
    }
  };

  /**
   * Allocate a court for a pending match (kicks off the warm-up phase).
   * This is the action behind the existing ▶ START button — the label is
   * preserved for familiarity, but the semantics changed: it only reserves
   * a court and shows it to players. The play clock starts with Begin Scoring.
   *
   * Conflict checks consider BOTH live and warming matches to avoid
   * double-allocating a player or a court.
   */
  const allocateCourt = async (m: ProjectedMatch, court: number) => {
    if (busyCourts.has(court)) {
      toast(`Court ${court} is already taken (live or warming up). Pick another.`, "warn");
      return;
    }

    const teamA = m.team_a_id ? teamById[m.team_a_id] : null;
    const teamB = m.team_b_id ? teamById[m.team_b_id] : null;
    const playerIds = new Set<string>();
    if (teamA) { playerIds.add(teamA.p1_id); if (teamA.p2_id) playerIds.add(teamA.p2_id); }
    if (teamB) { playerIds.add(teamB.p1_id); if (teamB.p2_id) playerIds.add(teamB.p2_id); }

    const conflicts: string[] = [];
    const activeOnOtherCourts: ProjectedMatch[] = [];
    Object.values(liveByCourt).forEach(x => x && activeOnOtherCourts.push(x));
    Object.values(warmingByCourt).forEach(x => x && activeOnOtherCourts.push(x));

    for (const other of activeOnOtherCourts) {
      if (other.id === m.id) continue;
      const oTeamA = other.team_a_id ? teamById[other.team_a_id] : null;
      const oTeamB = other.team_b_id ? teamById[other.team_b_id] : null;
      const otherIds = new Set<string>();
      if (oTeamA) { otherIds.add(oTeamA.p1_id); if (oTeamA.p2_id) otherIds.add(oTeamA.p2_id); }
      if (oTeamB) { otherIds.add(oTeamB.p1_id); if (oTeamB.p2_id) otherIds.add(oTeamB.p2_id); }
      for (const pid of playerIds) {
        if (otherIds.has(pid)) {
          const name = playerById[pid]?.name ?? "?";
          const where = other.started_at ? "playing" : "warming up";
          conflicts.push(`${name} is ${where} on Court ${other.court_number}`);
        }
      }
    }
    if (conflicts.length && conflictWarning !== "confirmed") {
      setConflictWarning(`Player conflict: ${conflicts.join(", ")}. Click "Pick Court" again to override.`);
      setTimeout(() => setConflictWarning("confirmed"), 50);
      return;
    }

    try {
      await db.allocateCourtAndNotify(m.id, court);
      setPickingCourtFor(null);
      setConflictWarning(null);
      toast(`Court ${court} allocated. Players warming up.`, "success");
    } catch (e: any) {
      toast(e?.message ?? "Failed to allocate court", "error");
    }
  };

  /**
   * Begin scoring on an allocated match. Sets started_at = now() and status
   * = "live", starting the 12-min play clock. Court was already reserved at
   * allocation time, so no court-availability re-check needed.
   */
  const beginScoring = async (m: ProjectedMatch) => {
    try {
      await db.beginScoring(m.id);
    } catch (e: any) {
      toast(e?.message ?? "Failed to begin scoring", "error");
    }
  };

  /** Release the court allocation (e.g. wrong court, player no-show). Returns
   *  the match to plain pending — court frees for other matches. */
  const cancelAllocation = async (m: ProjectedMatch) => {
    if (!confirm(`Cancel allocation of Court ${m.court_number}? The court will free up for other matches.`)) return;
    try {
      await db.deallocateCourtForMatch(m.id);
      toast("Court allocation cancelled", "info");
    } catch (e: any) {
      toast(e?.message ?? "Failed to cancel allocation", "error");
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
    if (sa === 0 && sb === 0) { toast("Enter a score before confirming", "warn"); return; }
    if (sa === sb) { toast("No ties allowed", "warn"); return; }
    const winner_id = sa > sb ? m.team_a_id : m.team_b_id;
    await db.updateMatch(m.id, { winner_id, confirmed: true, status: "completed", confirmed_at: new Date().toISOString() });
    /* Celebrate — small confetti burst from page bottom-center, brand palette.
       Honours prefers-reduced-motion (skip the visual jolt). */
    if (!reduceMotion) {
      confetti({
        particleCount: 60,
        spread: 70,
        startVelocity: 32,
        ticks: 120,
        origin: { x: 0.5, y: 0.85 },
        colors: ["#00d4ff", "#3A86FF", "#22c55e", "#fbbf24", "#FF80AB"],
        disableForReducedMotion: true,
      });
    }
    propagateKnockout(m, winner_id);
  };

  const propagateKnockout = async (m: ProjectedMatch, winner_id: string | null) => {
    if (m.stage !== "knockout" || m.round_idx == null || !winner_id) return;
    const next = matches.find(x => x.category_id === m.category_id && x.stage === "knockout" && x.round_idx === (m.round_idx! + 1) && x.slot_idx === Math.floor(m.slot_idx / 2));
    if (!next) return;
    const side = m.slot_idx % 2 === 0 ? "team_a_id" : "team_b_id";
    const patch: Partial<ProjectedMatch> = { [side]: winner_id };
    if (next.winner_id && (next.team_a_id === m.winner_id || next.team_b_id === m.winner_id)) {
      patch.winner_id = null;
      patch.confirmed = false;
      patch.score_a = null;
      patch.score_b = null;
      patch.status = "pending";
      patch.confirmed_at = null;
    }
    await db.updateMatch(next.id, patch);
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
    if (liveByCourt[court] && liveByCourt[court]!.id !== m.id) {
      if (!confirm(`Court ${court} already has a live match. Reassign anyway?`)) return;
    }
    await db.reassignCourt(m.id, court);
    setReassigningCourtFor(null);
  };

  const isTimeOver = (m: ProjectedMatch) => {
    if (m.status !== "live" || !m.started_at) return false;
    const cat = catById[m.category_id];
    if (!cat) return false;
    const matchMin = cat.match_minutes || 12;
    const extended = m.extended_minutes ?? 0;
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

  const reassignBusyCourts = useMemo(() => {
    if (!reassigningCourtFor) return busyCourts;
    const s = new Set(busyCourts);
    if (reassigningCourtFor.court_number != null) s.delete(reassigningCourtFor.court_number);
    return s;
  }, [busyCourts, reassigningCourtFor]);

  /** Format ms-elapsed since court allocation as MM:SS, never below zero. */
  const fmtWarmup = (m: ProjectedMatch): string => {
    if (!m.court_allocated_at) return "0:00";
    const ms = now - new Date(m.court_allocated_at).getTime();
    const sec = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };

  // Renders one match row. `dragHandle` is provided only for sortable pending rows.
  const renderMatch = (m: ProjectedMatch, dragHandle: React.ReactNode | null = null) => {
    const ta = m.team_a_id ? teamById[m.team_a_id] : null;
    const tb = m.team_b_id ? teamById[m.team_b_id] : null;
    const isLive = m.status === "live";
    const isCompleted = m.confirmed;
    // "Warming up" = court allocated, scoring not yet begun. Status is still
    // `pending` at the DB layer; this is the visual third state.
    const isWarming = !isLive && !isCompleted && !!m.court_allocated_at && !m.started_at;
    const winA = isCompleted && m.winner_id === m.team_a_id;
    const winB = isCompleted && m.winner_id === m.team_b_id;
    const deltaColor = isCompleted ? (m.delta_min != null && m.delta_min > 1 ? "#fbbf24" : m.delta_min != null && m.delta_min < -1 ? "#22c55e" : "#94a3b8") : isLive ? (m.delta_min != null && m.delta_min > 1 ? "#ef4444" : "#00d4ff") : "#94a3b8";
    const timeOver = isTimeOver(m);
    const pickingTeamForThis = timeOverPicking && timeOverPicking.matchId === m.id;

    const bg = isLive
      ? (timeOver ? "linear-gradient(90deg,#2a0f0f 0%,#0f1e36 30%)" : "linear-gradient(90deg,#1a0f0f 0%,#0f1e36 30%)")
      : isWarming
        ? "linear-gradient(90deg,#2a200f 0%,#0f1e36 30%)"
        : "#0f1e36";
    const borderColor = isLive ? (timeOver ? "#f59e0b" : "#ef4444") : isWarming ? "#fbbf24" : "#1a3050";
    /* MAKEOVER: every state gets a coloured left stripe for at-a-glance scanning
       — gray pending, amber warming, red live, green completed. */
    const accentColor = isLive
      ? (timeOver ? "#f59e0b" : "#ef4444")
      : isWarming ? "#fbbf24"
      : isCompleted ? "#16a34a"
      : "#475569"; /* pending: muted gray */

    return (
      /* MAKEOVER: hover lift + tap-press on every match card. Admin clicks these
         constantly during a tournament — they should feel responsive. */
      <motion.div
        style={{ background: bg, border: `1px solid ${borderColor}`, borderRadius: 8, padding: "12px 14px", display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, flexWrap: "wrap", position: "relative" }}
        whileHover={reduceMotion ? undefined : { y: -2, boxShadow: "0 6px 16px rgba(0,0,0,0.28)" }}
        whileTap={reduceMotion ? undefined : { scale: 0.99 }}
        transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
      >
        <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 3, background: accentColor }} />
        {dragHandle}
        {/* Stage badge (smaller now that category is the section header) */}
        <div style={{ minWidth: isMobile ? 0 : 80 }}>
          <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600, letterSpacing: 1 }}>{stageLabel(m)}</div>
          {timeOver && <div className="font-display" style={{ fontSize: 10, fontWeight: 800, color: "#f59e0b", marginTop: 4, letterSpacing: 1.2 }}>⏰ TIME OVER</div>}
          {isWarming && <div className="font-display" style={{ fontSize: 10, fontWeight: 800, color: "#fbbf24", marginTop: 4, letterSpacing: 1.2 }}>🟡 WARMING UP · {fmtWarmup(m)}</div>}
        </div>

        {/* Teams */}
        <div style={{ flex: 1, minWidth: isMobile ? 160 : 220 }}>
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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, minWidth: isMobile ? 0 : 130 }}>
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
            <button onClick={() => setHistoryFor(m)} className="font-display" style={{ padding: "8px 10px", borderRadius: 5, border: "1px solid #1a3050", background: "transparent", color: "#94a3b8", fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: 1 }} title="View change history">📜 LOG</button>
            {/* Plain pending (no court allocated yet): show ▶ START to allocate a court. */}
            {/* MAKEOVER: shared layoutId across the 3 advance buttons so the morph
                from START -> BEGIN SCORING -> CONFIRM feels like one element. */}
            {m.status === "pending" && !m.is_bye && !isWarming && m.team_a_id && m.team_b_id && (
              <motion.button layoutId={`match-${m.id}-action`} onClick={() => setPickingCourtFor(m)} className="font-display" whileTap={reduceMotion ? undefined : { scale: 0.97 }} style={{ padding: "8px 12px", borderRadius: 5, border: "none", background: busyCourts.size >= tournament.num_courts ? "#475569" : "#dc2626", color: "#fff", fontSize: 11, fontWeight: 700, cursor: busyCourts.size >= tournament.num_courts ? "not-allowed" : "pointer", letterSpacing: 1, opacity: busyCourts.size >= tournament.num_courts ? 0.5 : 1 }} disabled={busyCourts.size >= tournament.num_courts} title={busyCourts.size >= tournament.num_courts ? "All courts in use" : ""}>▶ START</motion.button>
            )}
            {/* Warming up: ▶ Begin Scoring starts the 12-min play clock. ↩ Cancel frees the court. */}
            {isWarming && (
              <>
                <motion.button layoutId={`match-${m.id}-action`} onClick={() => beginScoring(m)} className="font-display" whileTap={reduceMotion ? undefined : { scale: 0.97 }} style={{ padding: "8px 14px", borderRadius: 5, border: "none", background: "#fbbf24", color: "#1a1a2e", fontSize: 11, fontWeight: 800, cursor: "pointer", letterSpacing: 1 }}>▶ BEGIN SCORING</motion.button>
                <motion.button onClick={() => cancelAllocation(m)} className="font-display" whileTap={reduceMotion ? undefined : { scale: 0.97 }} style={{ padding: "8px 12px", borderRadius: 5, border: "1px solid #94a3b8", background: "transparent", color: "#94a3b8", fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: 1 }} title="Free this court for other matches">↩ CANCEL ALLOCATION</motion.button>
              </>
            )}
            {isLive && !timeOver && (
              <motion.button layoutId={`match-${m.id}-action`} onClick={() => confirmMatch(m)} className="font-display" whileTap={reduceMotion ? undefined : { scale: 0.97 }} style={{ padding: "8px 12px", borderRadius: 5, border: "none", background: "#16a34a", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: 1 }}>✓ CONFIRM</motion.button>
            )}
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
            {pickingTeamForThis && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", width: "100%", padding: "8px 0 0" }}>
                <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, alignSelf: "center" }}>
                  {timeOverPicking!.action === "walkover" ? "Walkover — pick winner:" : "Select winner:"}
                </span>
                <button onClick={() => timeOverPicking!.action === "walkover" ? markWalkover(m, "a") : handleSelectWinner(m, "a")} style={{ padding: "6px 12px", borderRadius: 5, border: "1px solid #22c55e", background: "rgba(34,197,94,0.15)", color: "#4ade80", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{tName(ta)}</button>
                <button onClick={() => timeOverPicking!.action === "walkover" ? markWalkover(m, "b") : handleSelectWinner(m, "b")} style={{ padding: "6px 12px", borderRadius: 5, border: "1px solid #22c55e", background: "rgba(34,197,94,0.15)", color: "#4ade80", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{tName(tb)}</button>
                <button onClick={() => setTimeOverPicking(null)} style={{ padding: "6px 8px", borderRadius: 5, border: "1px solid #475569", background: "transparent", color: "#94a3b8", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              </div>
            )}
          </div>
        )}
      </motion.div>
    );
  };

  const toggleCollapsed = (catId: string) => {
    setCollapsedCompleted(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  };

  return (
    <div style={{ background: "#0a1628", borderRadius: 14, padding: 20, border: "1px solid #1a3050", color: "#fff" }}>
      <CourtStatus numCourts={tournament.num_courts} liveByCourt={liveByCourt} warmingByCourt={warmingByCourt} categories={categories} teamById={teamById} />

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, padding: 12, background: "#0f1e36", borderRadius: 8, border: "1px solid #1a3050" }}>
        <FilterChip label="CATEGORY" value={filterCat} onChange={setFilterCat} options={[{ v: "", l: "All" }, ...categories.map(c => ({ v: c.id, l: c.name }))]} />
        <FilterChip label="STATUS" value={filterStatus} onChange={setFilterStatus} options={[{ v: "", l: "All" }, { v: "pending", l: "Pending" }, { v: "live", l: "Live" }, { v: "completed", l: "Completed" }]} />
        <FilterChip label="COURT" value={filterCourt} onChange={setFilterCourt} options={[{ v: "", l: "All" }, ...Array.from({ length: tournament.num_courts }, (_, i) => ({ v: String(i + 1), l: `Court ${i + 1}` }))]} />
        <div style={{ flex: 1 }} />
        <span className="font-display" style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, letterSpacing: 1, padding: "6px 10px" }}>{totalVisible} MATCH{totalVisible === 1 ? "" : "ES"}</span>
      </div>

      {/* Sections */}
      {sections.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: "#64748b", background: "#0f1e36", borderRadius: 8, border: "1px solid #1a3050" }}>
          No matches match these filters.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {sections.map(({ category, live, pending, completed }) => {
            const isCollapsed = collapsedCompleted.has(category.id);
            return (
              <div key={category.id} style={{ background: "#0c1a30", borderRadius: 10, border: "1px solid #1a3050", overflow: "hidden" }}>
                {/* Category header */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid #1a3050", background: "linear-gradient(90deg, rgba(0,184,255,0.06) 0%, rgba(15,30,55,0) 70%)" }}>
                  <div style={{ width: 4, height: 22, background: "#00d4ff", borderRadius: 1 }} />
                  <h3 className="font-display" style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: 1.5, textTransform: "uppercase" }}>{category.name}</h3>
                  <div style={{ flex: 1 }} />
                  <SectionPill color="#ef4444" label="LIVE" count={live.length} />
                  <SectionPill color="#00d4ff" label="UP NEXT" count={pending.length} />
                  <SectionPill color="#22c55e" label="DONE" count={completed.length} />
                </div>

                {/* Live */}
                {live.length > 0 && (
                  <div style={{ padding: "12px 16px", borderBottom: pending.length > 0 || completed.length > 0 ? "1px solid #11243f" : "none" }}>
                    <SubHeader color="#ef4444" pulse>LIVE NOW</SubHeader>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {live.map(m => <div key={m.id}>{renderMatch(m)}</div>)}
                    </div>
                  </div>
                )}

                {/* Pending — sortable */}
                {pending.length > 0 && (
                  <div style={{ padding: "12px 16px", borderBottom: completed.length > 0 ? "1px solid #11243f" : "none" }}>
                    <SubHeader color="#00d4ff">UP NEXT {isAdmin && pending.length > 1 && <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600, letterSpacing: 1, marginLeft: 8 }}>· DRAG ≡ TO REORDER</span>}</SubHeader>
                    {isAdmin ? (
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e => handleDragEnd(e, category.id, pending)}>
                        <SortableContext items={pending.map(m => m.id)} strategy={verticalListSortingStrategy}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {pending.map(m => (
                              <SortablePendingRow key={m.id} match={m} render={(dragHandle) => renderMatch(m, dragHandle)} disabled={!isAdmin || pending.length < 2} />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {pending.map(m => <div key={m.id}>{renderMatch(m)}</div>)}
                      </div>
                    )}
                  </div>
                )}

                {/* Completed — collapsible */}
                {completed.length > 0 && (
                  <div style={{ padding: "12px 16px" }}>
                    <button
                      onClick={() => toggleCollapsed(category.id)}
                      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: 0, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
                    >
                      <span style={{ display: "inline-block", width: 4, height: 14, background: "#22c55e", borderRadius: 1 }} />
                      <span className="font-display" style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", letterSpacing: 1.5, textTransform: "uppercase" }}>
                        Completed ({completed.length})
                      </span>
                      <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{isCollapsed ? "▸ Show" : "▾ Hide"}</span>
                    </button>
                    {!isCollapsed && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                        {completed.map(m => <div key={m.id}>{renderMatch(m)}</div>)}
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
          onPick={c => allocateCourt(pickingCourtFor, c)}
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

      {historyFor && (
        <MatchHistoryModal
          match={historyFor}
          teamAName={tName(historyFor.team_a_id ? teamById[historyFor.team_a_id] : null)}
          teamBName={tName(historyFor.team_b_id ? teamById[historyFor.team_b_id] : null)}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </div>
  );
}

// Sortable wrapper for one pending match. Provides a drag handle button that
// the user grabs; the rest of the row remains interactive (buttons clickable).
function SortablePendingRow({ match, render, disabled }: { match: ProjectedMatch; render: (dragHandle: React.ReactNode) => React.ReactNode; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: match.id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    boxShadow: isDragging ? "0 12px 30px rgba(0,0,0,0.5), 0 0 0 1px #00d4ff" : undefined,
    zIndex: isDragging ? 10 : undefined,
  };
  const handle = disabled ? null : (
    <button
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder"
      style={{
        padding: "6px 8px",
        borderRadius: 5,
        border: "1px solid #1a3050",
        background: "rgba(0,184,255,0.06)",
        color: "#00d4ff",
        fontSize: 18,
        fontWeight: 800,
        lineHeight: 1,
        cursor: isDragging ? "grabbing" : "grab",
        touchAction: "none",
        userSelect: "none",
      }}
      title="Drag to reorder"
    >≡</button>
  );
  return <div ref={setNodeRef} style={style}>{render(handle)}</div>;
}

function SectionPill({ color, label, count }: { color: string; label: string; count: number }) {
  if (count === 0) return null;
  return (
    <span className="font-display" style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: 1.2, padding: "3px 8px", border: `1px solid ${color}55`, background: `${color}10`, borderRadius: 4, display: "inline-flex", alignItems: "center", gap: 6 }}>
      {label} <span style={{ color: "#fff", fontWeight: 800 }}>{count}</span>
    </span>
  );
}

function SubHeader({ color, children, pulse }: { color: string; children: React.ReactNode; pulse?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, animation: pulse ? "pulse-strong 1.4s ease-in-out infinite" : undefined, boxShadow: pulse ? `0 0 8px ${color}` : undefined }} />
      <span className="font-display" style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: 1.8, textTransform: "uppercase" }}>{children}</span>
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
