import React, { Suspense, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion"; /* NEW: makeover motion */
import * as Sentry from "@sentry/react";
import { useAuth } from "./hooks/useAuth";
import { useIsMobile } from "./hooks/useIsMobile"; /* NEW: mobile IA detection */
import { useTournamentData } from "./hooks/useTournamentData";
import { useTournamentDerived } from "./hooks/useTournamentDerived";
import * as db from "./lib/db";
import { setActiveTournament } from "./lib/activeTournament";
import { supabase } from "./lib/supabase";
import { Login } from "./components/Login";
import { LiveTab } from "./components/LiveTab";
import { CourtPicker } from "./components/CourtPicker";
import { ShuttleSVG } from "./components/ui";
import { LottieLoader } from "./components/ui/lottie-loader"; /* NEW: cat Lottie loader for boot + suspense + refetch */
import { toast } from "./components/Toast";
import { defaultFormat, recommendFormats, splitIntoGroups, seedBracket, type FormatPlan } from "./lib/formatPlanner";
import { PromoteTeamPicker } from "./components/PromoteTeamPicker";
import { AppFooter } from "./components/AppFooter";
import { MoreDrawer, type TabId } from "./components/MoreDrawer";
import { PartnerPickerModal } from "./components/PartnerPickerModal";
import { MatchCard as ExtractedMatchCard, type MatchCardActions } from "./components/MatchCard";
import { AppHeader } from "./components/AppHeader";
import type { Match, Player, Team, Tournament } from "./types";

// Lazy-loaded surfaces. Anything below the fold for a spectator's initial
// LIVE-tab view is split out so the main bundle stays small. Suspense
// boundary at <main> renders LottieLoader while a chunk fetches.
const MatchesTab = React.lazy(() => import("./components/MatchesTab").then(m => ({ default: m.MatchesTab })));
const CategoriesTab = React.lazy(() => import("./components/CategoriesTab").then(m => ({ default: m.CategoriesTab })));
const CheckInTab = React.lazy(() => import("./features/checkin/CheckInTab").then(m => ({ default: m.CheckInTab })));
const ScoreboardTab = React.lazy(() => import("./features/scoreboard/ScoreboardTab").then(m => ({ default: m.ScoreboardTab })));
const KnockoutTab = React.lazy(() => import("./features/knockoutstage/KnockoutTab").then(m => ({ default: m.KnockoutTab })));
const GroupsTab = React.lazy(() => import("./features/groupstage/GroupsTab").then(m => ({ default: m.GroupsTab })));
const ProfilesTab = React.lazy(() => import("./features/profiles/ProfilesTab").then(m => ({ default: m.ProfilesTab })));
const RegisterTab = React.lazy(() => import("./features/registration/RegisterTab").then(m => ({ default: m.RegisterTab })));
const TeamsTab = React.lazy(() => import("./features/teamformation/TeamsTab").then(m => ({ default: m.TeamsTab })));
const AdminManager = React.lazy(() => import("./components/AdminManager").then(m => ({ default: m.AdminManager })));

function shuffle<T>(arr: T[]): T[] { return [...arr].sort(() => Math.random() - 0.5); }


type TeamView = Team & { p1: Player; p2: Player | null };

export default function App() {
  const { isAdmin, email, loading: authLoading } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showAdminManager, setShowAdminManager] = useState(false);
  const [tab, setTab] = useState<TabId>("live");
  /* NEW: mobile IA — 10 tabs is too many on phones; collapse the secondary 7 into a "More" drawer. */
  const isMobileNav = useIsMobile();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTabSet = new Set(["register", "checkin", "teams", "groups", "knockout", "scoreboard", "categories"]);
  const moreIsActive = isMobileNav && moreTabSet.has(tab);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [partnerPicker, setPartnerPicker] = useState<string | null>(null); // playerId whose partner we're choosing
  const [pendingRounds, setPendingRounds] = useState(1);
  // Active format-card selection on the Teams tab. Synced from the saved
  // category settings via the useEffect below; user clicks override.
  const [selectedFormatLabel, setSelectedFormatLabel] = useState<FormatPlan["label"]>("Recommended");
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null); // confirmed match being re-edited
  const [currentCategoryId, setCurrentCategoryId] = useState<string | null>(null);
  const [pickingCourtFor, setPickingCourtFor] = useState<Match | null>(null);
  const [addPlayerCats, setAddPlayerCats] = useState<Set<string>>(new Set()); // categories for new player
  const [editingPlayerCats, setEditingPlayerCats] = useState<string | null>(null); // player whose categories are being edited
  // Optimistic local set of category IDs for the player currently being edited inline.
  // Initialized from playerCategoryMap when editingPlayerCats becomes non-null; cleared on close.
  const [pendingPlayerCats, setPendingPlayerCats] = useState<Set<string> | null>(null);
  // Player whose dedicated profile is shown in the Profiles tab. null = grid view.
  const [profileViewPlayerId, setProfileViewPlayerId] = useState<string | null>(null);
  // Active "Promote Team" picker target — opens the modal on the given knockout
  // match slot when set. null = closed.
  const [promotePickerFor, setPromotePickerFor] = useState<{ matchId: string; side: "a" | "b" } | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Navigate to a specific player's profile from anywhere (search, etc.).
  const showProfile = (playerId: string) => {
    setProfileViewPlayerId(playerId);
    setTab("profiles");
  };

  const reloadTournaments = async () => {
    const list = await db.listTournaments();
    setTournaments(list);
    setCurrentId(curr => {
      if (curr && list.find(t => t.id === curr)) return curr;
      return list[0]?.id ?? null;
    });
  };

  useEffect(() => { reloadTournaments(); }, []);

  useEffect(() => {
    const ch = supabase.channel("tournaments-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments" }, reloadTournaments);
    // subscribe() can throw synchronously if the runtime's WebSocket is
    // unusable (browser extension monkey-patching, blocked CSP, etc.). Catch
    // and degrade gracefully — page still works, realtime updates just don't.
    try {
      ch.subscribe();
    } catch (err) {
      Sentry.addBreadcrumb({
        category: "realtime",
        level: "warning",
        message: "tournaments-list subscribe failed",
        data: { error: String(err) },
      });
      // eslint-disable-next-line no-console
      console.warn("[realtime] tournaments-list subscribe failed; manual refresh required for live updates", err);
    }
    return () => { supabase.removeChannel(ch); };
  }, []);

  const current = tournaments.find(t => t.id === currentId) ?? null;
  // Publish the active tournament so the global voice widget (mounted outside
  // <Routes> in main.tsx) knows what to answer about on the app shell route.
  useEffect(() => { setActiveTournament(currentId); }, [currentId]);
  const { players, teams, matches, categories, playerCategories, loading: dataLoading } = useTournamentData(currentId, isAdmin); /* NEW: dataLoading for the cat loader during tournament switch / data refetch */

  // Default to "All" (null). Only auto-select first category if none exists yet and we need one for team operations.
  useEffect(() => {
    if (categories.length === 0) { setCurrentCategoryId(null); return; }
    // Keep current selection if valid, otherwise stay on "All"
    setCurrentCategoryId(curr => {
      if (curr === null) return null; // "All" is valid
      if (curr && categories.find(c => c.id === curr)) return curr;
      return null;
    });
  }, [categories, currentId]);

  // All read-only data derivations are now centralized in useTournamentDerived
  // so App.tsx stays focused on stateful behaviour (modals, mutations, form
  // state) — data shaping lives in its own hook. ~110 lines of inline useMemo
  // chains moved out 2026-05-25.
  const {
    currentCategory,
    phase,
    playerById,
    catById,
    playerCategoryMap,
    allTeamsView,
    allTeamById,
    teamsView,
    teamById,
    groupMatches,
    knockoutMatches,
    groups,
    knockout,
    active,
    paired,
    unpaired,
    invalidTeamsInCategory,
    numCourts,
    projectedMatches,
    projectedById,
    tournamentDeltaMin,
    tournamentDeltaLabel,
    liveByCourt,
  } = useTournamentDerived(current, players, teams, matches, categories, playerCategories, currentCategoryId);

  // Sync the in-progress inline category-edit set with the underlying map.
  // - Open editor: seed local set from current memberships
  // - Close editor: clear local set
  // - Realtime updates: re-seed so other admins' changes don't get lost
  useEffect(() => {
    if (editingPlayerCats) {
      setPendingPlayerCats(new Set(playerCategoryMap.get(editingPlayerCats) ?? []));
    } else {
      setPendingPlayerCats(null);
    }
  }, [editingPlayerCats, playerCategoryMap]);

  const guard = () => { if (!isAdmin) { setShowLogin(true); return false; } return true; };

  const addPlayer = async () => {
    if (!guard() || !current) return;
    const n = newName.trim(); if (!n) return;
    const created = await db.addPlayer(current.id, n, players.length);
    if (addPlayerCats.size > 0) {
      await db.setPlayerCategories(created.id, [...addPlayerCats]);
    }
    setNewName("");
  };
  const startEdit = (p: Player) => { if (!guard()) return; setEditingId(p.id); setEditName(p.name); };
  const saveEdit = async (id: string) => {
    const n = editName.trim();
    if (!n) { setEditingId(null); return; }
    await db.updatePlayer(id, { name: n });
    setEditingId(null); setEditName("");
  };
  const isPlayerInLiveMatch = (playerId: string) => {
    const playerTeamIds = teams.filter(t => t.p1_id === playerId || t.p2_id === playerId).map(t => t.id);
    return matches.some(m => m.status === "live" && (playerTeamIds.includes(m.team_a_id!) || playerTeamIds.includes(m.team_b_id!)));
  };
  const toggleActive = async (id: string) => {
    if (!guard()) return;
    const p = playerById[id]; if (!p) return;
    if (p.active && isPlayerInLiveMatch(id)) { toast(`"${p.name}" is in a live match and cannot be deactivated right now.`, "warn"); return; }
    await db.updatePlayer(id, { active: !p.active });
    if (p.active) await db.deleteTeamsContainingPlayer(id);
  };
  const handleDeletePlayer = async (id: string) => {
    if (!guard()) return;
    const p = playerById[id]; if (!p) return;
    if (isPlayerInLiveMatch(id)) { toast(`"${p.name}" is in a live match and cannot be deleted right now.`, "warn"); return; }
    const teamCount = teams.filter(t => t.p1_id === id || t.p2_id === id).length;
    const msg = teamCount > 0
      ? `Delete "${p.name}"? This will remove them from ${teamCount} team(s) and affect related matches. Cannot be undone.`
      : `Delete "${p.name}"? This cannot be undone.`;
    if (!confirm(msg)) return;
    await db.deletePlayer(id);
  };
  const handlePhoto = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (!guard()) return;
    const f = e.target.files?.[0]; if (!f) return;
    const url = await db.uploadPlayerPhoto(id, f);
    await db.updatePlayer(id, { photo_url: url });
  };
  const openPartnerPicker = (pid: string) => {
    if (!guard()) return;
    if (!currentCategoryId || !currentCategory) { toast("Select a specific category first (not 'All') to pair teams.", "warn"); return; }
    if (currentCategory.team_size === 1) {
      // For singles, just create a 1-player team
      void createSoloTeam(pid);
      return;
    }
    setPartnerPicker(pid);
  };
  const createSoloTeam = async (pid: string) => {
    if (!current || !currentCategoryId) return;
    await db.createTeam(current.id, currentCategoryId, pid, null, teamsView.length);
  };
  const assignPartner = async (p1Id: string, p2Id: string) => {
    if (!current || !currentCategoryId) return;
    await db.createTeam(current.id, currentCategoryId, p1Id, p2Id, teamsView.length);
    setPartnerPicker(null);
  };
  const autoGen = async () => {
    if (!guard() || !current || !currentCategory || !currentCategoryId) return;
    const sh = shuffle(unpaired);
    let order = teamsView.length;
    if (currentCategory.team_size === 1) {
      for (const p of sh) {
        await db.createTeam(current.id, currentCategoryId, p.id, null, order++);
      }
    } else {
      for (let i = 0; i + 1 < sh.length; i += 2) {
        await db.createTeam(current.id, currentCategoryId, sh[i].id, sh[i + 1].id, order++);
      }
    }
  };

  const startGroupStage = async (override?: { groupsCount: number; topNAdvance: number; roundsPerPair: number }) => {
    if (!guard() || !current || !currentCategoryId) return;
    const cat = categories.find(c => c.id === currentCategoryId);
    if (!cat) return;

    // Resolution order for format params:
    //   1. Explicit override from the Teams tab format-card click (most authoritative)
    //   2. The category's saved values (groups_count > 0 / top_n_advance > 0)
    //   3. Planner default for the current team count
    const N = teamsView.length;
    let groupsCount = override?.groupsCount ?? cat.groups_count ?? 0;
    let topNAdvance = override?.topNAdvance ?? cat.top_n_advance ?? 0;
    const roundsPerPair = override?.roundsPerPair ?? pendingRounds;
    let groupSizes: number[];

    if (groupsCount > 0) {
      groupSizes = splitIntoGroups(N, groupsCount);
    } else {
      const plan = defaultFormat(N);
      groupsCount = plan.groupsCount;
      groupSizes = plan.groupSizes;
      if (topNAdvance <= 0) topNAdvance = plan.topNAdvance;
    }

    // Persist the choices so the knockout stage reads the same values.
    await db.updateCategory(currentCategoryId, {
      rounds_per_pair: roundsPerPair,
      groups_count: groupsCount,
      top_n_advance: topNAdvance,
    });

    if (groupsCount === 0 || groupSizes.length === 0) {
      toast("Too few teams to start a tournament. Add more teams first.", "warn");
      return;
    }

    // Distribute shuffled teams across groups by explicit sizes.
    const sh = shuffle(teamsView);
    const gs: TeamView[][] = [];
    let idx = 0;
    for (let g = 0; g < groupsCount; g++) {
      const arr: TeamView[] = [];
      for (let k = 0; k < groupSizes[g] && idx < sh.length; k++) arr.push(sh[idx++]);
      gs.push(arr);
    }

    const rows: Partial<Match>[] = [];
    let slot = 0;
    gs.forEach((g, gi) => {
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        for (let r = 0; r < roundsPerPair; r++) {
          rows.push({
            tournament_id: current.id, category_id: currentCategoryId, stage: "group", group_idx: gi, round_idx: null, slot_idx: slot++,
            team_a_id: g[i].id, team_b_id: g[j].id,
            score_a: null, score_b: null, winner_id: null, confirmed: false, is_bye: false,
            status: "pending", started_at: null, is_walkover: false,
          });
        }
      }
    });
    await db.insertMatches(rows);
    await db.setCategoryPhase(currentCategoryId, "group");
    setTab("groups");
  };

  const getStandings = (g: TeamView[], gi: number) => {
    const s: Record<string, { team: TeamView; w: number; l: number; pts: number; pf: number; pa: number }> = {};
    g.forEach(t => { s[t.id] = { team: t, w: 0, l: 0, pts: 0, pf: 0, pa: 0 }; });
    groupMatches.filter(m => m.group_idx === gi && m.confirmed).forEach(m => {
      const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
      if (m.team_a_id && s[m.team_a_id]) { s[m.team_a_id].pf += sa; s[m.team_a_id].pa += sb; }
      if (m.team_b_id && s[m.team_b_id]) { s[m.team_b_id].pf += sb; s[m.team_b_id].pa += sa; }
      if (m.winner_id && s[m.winner_id]) {
        s[m.winner_id].w++; s[m.winner_id].pts += 3;
        const loserId = m.winner_id === m.team_a_id ? m.team_b_id : m.team_a_id;
        if (loserId && s[loserId]) s[loserId].l++;
      }
    });
    return Object.values(s).sort((a, b) => b.pts - a.pts || (b.pf - b.pa) - (a.pf - a.pa));
  };

  const allGroupsDone = groups.length > 0 && groups.every((_, gi) => {
    const ms = groupMatches.filter(m => m.group_idx === gi);
    return ms.length > 0 && ms.every(m => m.confirmed);
  });

  const startKnockout = async () => {
    if (!guard() || !current || !currentCategoryId) return;
    const cat = categories.find(c => c.id === currentCategoryId);
    if (!cat) return;

    // Determine top-N-advance per group. Honor category.top_n_advance if set;
    // otherwise fall back to the planner's default for the current team count.
    let topN = cat.top_n_advance ?? 0;
    if (topN <= 0) {
      const plan = defaultFormat(teamsView.length);
      topN = plan.topNAdvance;
    }
    if (topN <= 0) topN = 2; // last-resort safety net

    // Collect qualifiers PER GROUP (not flattened) so seedBracket can apply
    // standard cross-group bracket seeding — same-group teams don't meet in
    // round 1, top seeds spread across halves, byes go to top seeds when the
    // qualifier count isn't a power of 2.
    const qualifiers: TeamView[][] = groups.map((g, gi) => {
      const st = getStandings(g, gi);
      const limit = Math.min(topN, st.length);
      return st.slice(0, limit).map(s => s.team);
    }).filter(arr => arr.length > 0);
    const totalQualifiers = qualifiers.reduce((sum, arr) => sum + arr.length, 0);
    if (totalQualifiers < 2) return;

    // seedBracket returns the slot-ordered placements (length is the next
    // power of 2). Nulls indicate byes — admins can also fix mis-seeded
    // brackets later via the Promote-Team UI on each match card.
    const seeded = seedBracket(qualifiers);
    const slots = seeded.length;
    const rds = Math.ceil(Math.log2(slots));
    const rows: Partial<Match>[] = [];
    for (let i = 0; i < slots / 2; i++) {
      const a = seeded[i * 2], b = seeded[i * 2 + 1];
      const bye = !a || !b;
      rows.push({
        tournament_id: current.id, category_id: currentCategoryId, stage: "knockout", group_idx: null, round_idx: 0, slot_idx: i,
        team_a_id: a?.id ?? null, team_b_id: b?.id ?? null,
        score_a: null, score_b: null,
        winner_id: bye ? (a?.id ?? b?.id ?? null) : null,
        confirmed: bye, is_bye: bye,
        status: bye ? "completed" : "pending", started_at: null, is_walkover: false,
      });
    }
    let prevCount = slots / 2;
    for (let r = 1; r < rds; r++) {
      const cnt = prevCount / 2;
      for (let i = 0; i < cnt; i++) {
        rows.push({
          tournament_id: current.id, category_id: currentCategoryId, stage: "knockout", group_idx: null, round_idx: r, slot_idx: i,
          team_a_id: null, team_b_id: null, score_a: null, score_b: null, winner_id: null, confirmed: false, is_bye: false,
          status: "pending", started_at: null, is_walkover: false,
        });
      }
      prevCount = cnt;
    }
    // Bronze / 3rd-place playoff. Only inserted when the category opts in
    // AND the bracket actually has semi-finals (slots >= 4 → rds >= 2). Lives
    // in the same round_idx as the Final (last round) at slot_idx=1; the two
    // SF losers are routed here by propagateWinner.
    if (cat.has_bronze_match && slots >= 4) {
      rows.push({
        tournament_id: current.id, category_id: currentCategoryId, stage: "knockout",
        group_idx: null, round_idx: rds - 1, slot_idx: 1,
        team_a_id: null, team_b_id: null, score_a: null, score_b: null, winner_id: null,
        confirmed: false, is_bye: false, status: "pending", started_at: null,
        is_walkover: false, is_bronze: true,
      });
    }
    await db.insertMatches(rows);
    await db.setCategoryPhase(currentCategoryId, "knockout");
    setTab("knockout");
  };

  const champion = (() => {
    const last = knockout[knockout.length - 1];
    if (!last || !last[0] || !last[0].confirmed || !last[0].winner_id) return null;
    return teamById[last[0].winner_id] ?? null;
  })();

  const resetAll = async () => {
    if (!guard() || !currentCategoryId) return;
    if (!confirm(`Wipe teams and matches for "${currentCategory?.name}" category?`)) return;
    await db.deleteMatchesForCategory(currentCategoryId);
    await db.deleteTeamsForCategory(currentCategoryId);
    await db.setCategoryPhase(currentCategoryId, "none");
  };

  // Open the court picker for a pending match (must have both teams)
  const startMatchHandler = (id: string) => {
    if (!guard()) return;
    const m = matches.find(x => x.id === id);
    if (!m) return;
    setPickingCourtFor(m);
  };
  // Court picker → allocates the court (warm-up phase). The play clock is
  // started by Begin Scoring later. Conflict check considers both LIVE and
  // WARMING matches so a player isn't double-booked.
  const startMatchOnCourt = async (m: Match, court: number) => {
    const ta = m.team_a_id ? allTeamById[m.team_a_id] : null;
    const tb = m.team_b_id ? allTeamById[m.team_b_id] : null;
    const playerIds = new Set<string>();
    if (ta) { playerIds.add(ta.p1_id); if (ta.p2_id) playerIds.add(ta.p2_id); }
    if (tb) { playerIds.add(tb.p1_id); if (tb.p2_id) playerIds.add(tb.p2_id); }

    // Gather all active (live or warming) matches with players to check against.
    const others: Match[] = [];
    Object.values(liveByCourt).forEach(x => x && others.push(x));
    for (const other of matches) {
      if (other.court_allocated_at && !other.started_at && other.court_number != null) {
        others.push(other);
      }
    }

    // Court conflict?
    const courtConflict = others.find(o => o.id !== m.id && o.court_number === court);
    if (courtConflict) {
      const state = courtConflict.started_at ? "in play" : "warming up";
      toast(`Court ${court} is ${state}. Pick another.`, "warn");
      return;
    }

    const conflicts: string[] = [];
    for (const other of others) {
      if (other.id === m.id) continue;
      const oA = other.team_a_id ? allTeamById[other.team_a_id] : null;
      const oB = other.team_b_id ? allTeamById[other.team_b_id] : null;
      const oIds = new Set<string>();
      if (oA) { oIds.add(oA.p1_id); if (oA.p2_id) oIds.add(oA.p2_id); }
      if (oB) { oIds.add(oB.p1_id); if (oB.p2_id) oIds.add(oB.p2_id); }
      for (const pid of playerIds) {
        if (oIds.has(pid)) {
          const name = playerById[pid]?.name ?? "?";
          const where = other.started_at ? "playing on" : "warming up on";
          conflicts.push(`${name} ${where} Court ${other.court_number}`);
        }
      }
    }
    if (conflicts.length) {
      if (!confirm(`Player conflict — ${conflicts.join(", ")}.\n\nAllocate anyway?`)) return;
    }

    try {
      await db.allocateCourtAndNotify(m.id, court);
      setPickingCourtFor(null);
      toast(`Court ${court} allocated. Players warming up — click Begin Scoring when ready.`, "success");
    } catch (e: any) {
      toast(e?.message ?? "Failed to allocate court", "error");
    }
  };

  /** Start the 12-minute play clock for an already-allocated match. */
  const beginScoringMatch = async (id: string) => {
    if (!guard()) return;
    try {
      await db.beginScoring(id);
    } catch (e: any) {
      toast(e?.message ?? "Failed to begin scoring", "error");
    }
  };

  /** Release the court allocation, return match to plain pending. */
  const cancelMatchAllocation = async (m: Match) => {
    if (!guard()) return;
    if (!confirm(`Cancel allocation of Court ${m.court_number}? The court will free for other matches.`)) return;
    try {
      await db.deallocateCourtForMatch(m.id);
      toast("Court allocation cancelled", "info");
    } catch (e: any) {
      toast(e?.message ?? "Failed to cancel allocation", "error");
    }
  };
  const removeTeam = async (id: string) => { if (!guard()) return; if (!confirm("Remove this team?")) return; await db.deleteTeam(id); };

  /**
   * One-shot cleanup for teams whose players don't actually belong to the
   * category the team is tagged with. Caused historically by an Auto-Pair
   * bug that ignored `currentCategoryId` when computing the unpaired list.
   * Only runs while phase === "none" so it can't break a running tournament.
   */
  const cleanupInvalidTeams = async () => {
    if (!guard() || !currentCategoryId) return;
    const bad = invalidTeamsInCategory;
    if (bad.length === 0) {
      toast("No invalid teams in this category.", "info");
      return;
    }
    const msg = `Remove ${bad.length} team${bad.length === 1 ? "" : "s"} where one or both players aren't assigned to this category?\n\nAffected teams will be deleted permanently. Players themselves are NOT removed.`;
    if (!confirm(msg)) return;
    let removed = 0;
    let failed = 0;
    for (const t of bad) {
      try {
        await db.deleteTeam(t.id);
        removed++;
      } catch {
        failed++;
      }
    }
    if (failed === 0) toast(`Removed ${removed} invalid team${removed === 1 ? "" : "s"}.`, "success");
    else toast(`Removed ${removed} of ${bad.length}; ${failed} failed.`, "warn");
  };

  const adjustScore = async (m: Match, side: "a" | "b", delta: number) => {
    if (!isAdmin) return;
    const cur = side === "a" ? (m.score_a ?? 0) : (m.score_b ?? 0);
    const next = Math.max(0, cur + delta);
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
    await db.updateMatch(m.id, side === "a" ? { score_a: next } : { score_b: next });
  };
  const setScore = async (m: Match, side: "a" | "b", val: number) => {
    if (!isAdmin) return;
    const next = Math.max(0, isNaN(val) ? 0 : val);
    await db.updateMatch(m.id, side === "a" ? { score_a: next } : { score_b: next });
  };
  const propagateWinner = async (m: Match, winner_id: string | null) => {
    if (m.stage !== "knockout" || m.round_idx == null || !winner_id) return;
    const nextRound = knockout[m.round_idx + 1];
    if (!nextRound) return;
    // The Final / next-round target. Bronze lives in the same final round at
    // slot_idx=1, but never gets winners pushed to it through this branch —
    // it's handled by the dedicated isSemiFinal block below. Skip bronze
    // explicitly so `find` returns the actual bracket-tree target.
    const ni = Math.floor(m.slot_idx / 2);
    const nm = nextRound.find(x => !x.is_bronze && x.slot_idx === ni) ?? null;
    if (nm) {
      const side = m.slot_idx % 2 === 0 ? "team_a_id" : "team_b_id";
      const patch: Partial<Match> = { [side]: winner_id };
      if (nm.winner_id && (nm.team_a_id === m.winner_id || nm.team_b_id === m.winner_id)) {
        patch.winner_id = null;
        patch.confirmed = false;
        patch.score_a = null;
        patch.score_b = null;
        patch.status = "pending";
        patch.confirmed_at = null;
      }
      await db.updateMatch(nm.id, patch);
    }

    // Bronze / 3rd-place playoff. When the SF resolves, the LOSER (not the
    // winner) goes to the bronze match in the final round. SF slot 0 →
    // bronze.team_a_id; SF slot 1 → bronze.team_b_id. Only runs when bronze
    // exists for this bracket (category opt-in + slots ≥ 4 at gen time).
    const finalRoundIdx = knockout.length - 1;
    const isSemiFinal = m.round_idx === finalRoundIdx - 1;
    if (isSemiFinal) {
      const bronze = nextRound.find(x => x.is_bronze);
      if (bronze) {
        const loserId = m.team_a_id === winner_id ? m.team_b_id : m.team_a_id;
        const bronzeSide = m.slot_idx === 0 ? "team_a_id" : "team_b_id";
        const bronzePatch: Partial<Match> = { [bronzeSide]: loserId ?? null };
        const currentBronzeSideTeam = bronzeSide === "team_a_id" ? bronze.team_a_id : bronze.team_b_id;
        if (bronze.confirmed && currentBronzeSideTeam !== loserId) {
          bronzePatch.winner_id = null;
          bronzePatch.confirmed = false;
          bronzePatch.score_a = null;
          bronzePatch.score_b = null;
          bronzePatch.status = "pending";
          bronzePatch.confirmed_at = null;
        }
        await db.updateMatch(bronze.id, bronzePatch);
      }
    }
  };
  const confirmInline = async (m: Match) => {
    if (!guard()) return;
    const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
    if (sa === 0 && sb === 0) { toast("Enter a score before confirming.", "warn"); return; }
    if (sa === sb) { toast("No ties allowed — set a winner.", "warn"); return; }
    const winner_id = sa > sb ? m.team_a_id : m.team_b_id;
    await db.updateMatch(m.id, { winner_id, confirmed: true, status: "completed", confirmed_at: new Date().toISOString() });
    await propagateWinner(m, winner_id);
    setEditingMatchId(null);
  };
  const saveEditedMatch = async (m: Match) => {
    if (!guard()) return;
    const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
    if (sa === sb) { toast("No ties allowed.", "warn"); return; }
    const winner_id = sa > sb ? m.team_a_id : m.team_b_id;
    await db.updateMatch(m.id, { winner_id, confirmed: true, status: "completed", confirmed_at: new Date().toISOString() });
    await propagateWinner(m, winner_id);
    setEditingMatchId(null);
  };

  useEffect(() => { if (currentCategory) setPendingRounds(currentCategory.rounds_per_pair || 1); }, [currentCategory?.id, currentCategory?.rounds_per_pair]);

  // Sync selected format card to whatever the category has saved (or default
  // to "Recommended" if there's no saved match). Re-runs when team count
  // changes (which can change the available options).
  useEffect(() => {
    if (!currentCategory || teamsView.length < 2) return;
    const opts = recommendFormats(teamsView.length);
    const match = opts.find(o =>
      o.groupsCount === currentCategory.groups_count &&
      o.topNAdvance === currentCategory.top_n_advance &&
      o.roundsPerPair === currentCategory.rounds_per_pair,
    );
    setSelectedFormatLabel(match?.label ?? "Recommended");
  }, [currentCategory?.id, currentCategory?.groups_count, currentCategory?.top_n_advance, currentCategory?.rounds_per_pair, teamsView.length]);

  const btn = (bg = "#3A86FF", clr = "#fff"): React.CSSProperties => ({ background: bg, color: clr, border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 600, fontSize: 14, transition: "all .2s", boxShadow: `0 2px 8px ${bg}33` });
  const tabBtn = (t: typeof tab, label: string, icon: string) => {
    const isActive = tab === t;
    return (
      <button
        key={t}
        onClick={() => setTab(t)}
        style={{
          padding: "14px 22px",
          cursor: "pointer",
          fontWeight: 600,                                /* MAKEOVER: 700 -> 600 */
          fontSize: 12,                                   /* MAKEOVER: 13 -> 12 per Section 3 spec */
          letterSpacing: 1.5,
          textTransform: "uppercase",
          background: "transparent",
          color: isActive ? "#00d4ff" : "#64748b",
          border: "none",
          borderBottom: "3px solid transparent",          /* MAKEOVER: reserves layout space for motion indicator */
          marginBottom: -1,
          display: "flex",
          alignItems: "center",
          gap: 6,
          position: "relative",                           /* NEW: anchors motion.div indicator */
          transition: "color .15s",
          fontFamily: "'Inter Variable', system-ui, sans-serif",   /* MAKEOVER: dropped font-display (Oswald) per Section 3 spec */
        }}
      >
        <span style={{ fontSize: 14 }}>{icon}</span>
        {label}
        {isActive && (
          /* NEW: Framer Motion active-tab indicator with layoutId morph */
          <motion.div
            layoutId="nav-active-indicator"
            style={{ position: "absolute", left: 0, right: 0, bottom: -1, height: 3, background: "#00d4ff" }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          />
        )}
      </button>
    );
  };
  // Bundle of mutation handlers that ExtractedMatchCard accepts as a single
  // actions prop. Composed here so the card stays decoupled from App.tsx's
  // state machinery while still mutating it.
  const matchActions: MatchCardActions = {
    adjustScore,
    setScore,
    startMatch: startMatchHandler,
    beginScoring: beginScoringMatch,
    cancelAllocation: cancelMatchAllocation,
    confirmFinalScore: confirmInline,
    saveEditedMatch,
    selectWinner: async (m, winnerId) => {
      await db.selectMatchWinner(m.id, winnerId);
      await propagateWinner(m, winnerId);
    },
    markWalkover: async (m, winnerId) => {
      await db.markWalkover(m.id, winnerId);
      await propagateWinner(m, winnerId);
    },
  };

  // Thin wrapper so consumers passing MatchCard as a prop (GroupsTab,
  // KnockoutTab) keep working with the same signature. All the JSX + local
  // state for the card lives in src/components/MatchCard.tsx.
  const MatchCard = ({ match, editable = true, matchMinutes }: { match: Match; editable?: boolean; matchMinutes?: number }) => (
    <ExtractedMatchCard
      match={match}
      editable={editable}
      matchMinutes={matchMinutes}
      isAdmin={isAdmin}
      teamById={teamById}
      editingMatchId={editingMatchId}
      onStartEdit={(id) => setEditingMatchId(id)}
      onCancelEdit={() => setEditingMatchId(null)}
      onOpenPromotePicker={(matchId, side) => setPromotePickerFor({ matchId, side })}
      actions={matchActions}
    />
  );
  const signOut = async () => { await supabase.auth.signOut(); };

  if (authLoading) return <LottieLoader fullScreen label="Loading tournament…" />; /* NEW: cat Lottie loader during initial auth check */

  /* NEW: full-screen cat overlay during tournament-data refetch (e.g. tournament dropdown switch).
     Renders only after authLoading is false, so this never doubles up with the auth loader. */
  const showDataLoader = dataLoading && currentId;

  return (
    <div style={{ minHeight: "100dvh", background: "#0a1628", color: "#1a1a2e", fontFamily: "'Inter Variable','Segoe UI',system-ui,-apple-system,sans-serif" }}>
      {/* NEW: cat overlay during tournament-data refetch (e.g. switching tournament from the
          dropdown). Renders on top of everything via fullScreen variant (z-index: 9999). */}
      {showDataLoader && <LottieLoader fullScreen label="Loading tournament data…" />}
      <AppHeader
        isAdmin={isAdmin}
        email={email}
        onSignOut={signOut}
        onOpenAdminManager={() => setShowAdminManager(true)}
        onOpenLogin={() => setShowLogin(true)}
        tournaments={tournaments}
        current={current}
        onSelectTournament={setCurrentId}
        onTournamentsChanged={reloadTournaments}
        categories={categories}
        currentCategoryId={currentCategoryId}
        onSelectCategory={setCurrentCategoryId}
        matches={matches}
        tournamentDeltaMin={tournamentDeltaMin}
        tournamentDeltaLabel={tournamentDeltaLabel}
        activeCount={active.length}
        teamsCount={teamsView.length}
        unpairedCount={unpaired.length}
      />

      <nav style={{ display: "flex", justifyContent: "center", gap: 4, paddingTop: 6, background: "#0a1628", borderBottom: "1px solid #1a3050", flexWrap: "wrap", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}>
        {/* MAKEOVER: mobile shows 3 priority tabs (LIVE, MATCHES, PROFILES) + a "MORE" button
            that opens a drawer with the remaining 7 tabs. Desktop keeps the full row. */}
        {isMobileNav ? (
          <>
            {tabBtn("live", "Live", "🔴")}
            {tabBtn("matches", "Matches", "🗓️")}
            {tabBtn("profiles", "Profiles", "👤")}
            <button
              onClick={() => setMoreOpen(true)}
              style={{
                padding: "14px 22px",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 12,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                background: "transparent",
                color: moreIsActive ? "#00d4ff" : "#64748b",
                border: "none",
                borderBottom: "3px solid transparent",
                marginBottom: -1,
                display: "flex",
                alignItems: "center",
                gap: 6,
                position: "relative",
                transition: "color .15s",
                fontFamily: "'Inter Variable', system-ui, sans-serif",
              }}
            >
              <span style={{ fontSize: 14 }}>⋯</span>MORE
              {moreIsActive && (
                <motion.div
                  layoutId="nav-active-indicator"
                  style={{ position: "absolute", left: 0, right: 0, bottom: -1, height: 3, background: "#00d4ff" }}
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
            </button>
          </>
        ) : (
          <>
            {tabBtn("live", "Live", "🔴")}
            {tabBtn("matches", "Matches", "🗓️")}
            {tabBtn("register", "Players", "📋")}
            {tabBtn("checkin", "Check-In", "✅")}
            {tabBtn("profiles", "Profiles", "👤")}
            {tabBtn("teams", "Teams", "🤝")}
            {phase !== "none" && tabBtn("groups", "Groups", "📊")}
            {phase === "knockout" && tabBtn("knockout", "Knockout", "⚔️")}
            {tabBtn("scoreboard", "Scoreboard", "🏅")}
            {isAdmin && tabBtn("categories", "Categories", "🏷️")}
          </>
        )}
      </nav>

      <main style={{ maxWidth: 1280, margin: "24px auto", padding: "0 20px" }}>
        {!current && (
          <div style={{ position: "relative", textAlign: "center", padding: 80, color: "#64748b", background: "#0a1628", borderRadius: 14, border: "1px solid #1a3050", overflow: "hidden", minHeight: 280 }}>
            <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/images/B3.jpg)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.3 }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(10,22,40,0.7) 0%, rgba(10,22,40,0.95) 100%)" }} />
            <div style={{ position: "relative", zIndex: 1 }}>
              <ShuttleSVG sz={80} color="#00b8ff" opacity={0.5} style={{ margin: "0 auto 14px", display: "block" }} />
              <p className="font-display" style={{ fontSize: 16, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase", color: "#fff", margin: 0 }}>{isAdmin ? "Click + New above to create your first tournament." : "No tournaments yet."}</p>
            </div>
          </div>
        )}

        {current && tab === "live" && <LiveTab teamsView={allTeamsView} allTeamById={allTeamById} matches={matches} groupMatches={groupMatches} knockoutMatches={knockoutMatches} phase={phase} groups={groups} getStandings={getStandings} categories={categories} numCourts={numCourts} liveByCourt={liveByCourt} projectedById={projectedById} projectedMatches={projectedMatches} players={players} playerCategories={playerCategories} onShowProfile={showProfile} />}

        {current && tab === "matches" && (
          <Suspense fallback={<LottieLoader size={140} label="Loading…" />}>
            <MatchesTab
              tournament={current}
              categories={categories}
              matches={projectedMatches}
              teamById={allTeamById}
              playerById={playerById}
              liveByCourt={liveByCourt}
              isAdmin={isAdmin}
            />
          </Suspense>
        )}

        {current && tab === "categories" && isAdmin && (
          <Suspense fallback={<LottieLoader size={140} label="Loading…" />}>
            <CategoriesTab
              tournament={current}
              categories={categories}
              teams={teams}
              matches={matches}
              players={players}
              playerCategories={playerCategories}
              isAdmin={isAdmin}
            />
          </Suspense>
        )}

        {current && tab === "register" && (
          <Suspense fallback={<LottieLoader size={140} label="Loading…" />}>
          <RegisterTab
            tournament={current}
            categories={categories}
            currentCategoryId={currentCategoryId}
            setCurrentCategoryId={setCurrentCategoryId}
            catById={catById}
            players={players}
            playerCategoryMap={playerCategoryMap}
            isAdmin={isAdmin}
            newName={newName}
            setNewName={setNewName}
            addPlayer={addPlayer}
            addPlayerCats={addPlayerCats}
            setAddPlayerCats={setAddPlayerCats}
            editingId={editingId}
            editName={editName}
            setEditName={setEditName}
            startEdit={startEdit}
            saveEdit={saveEdit}
            editingPlayerCats={editingPlayerCats}
            setEditingPlayerCats={setEditingPlayerCats}
            pendingPlayerCats={pendingPlayerCats}
            setPendingPlayerCats={setPendingPlayerCats}
            toggleActive={toggleActive}
            handleDeletePlayer={handleDeletePlayer}
            handlePhoto={handlePhoto}
            openPartnerPicker={openPartnerPicker}
            autoGen={autoGen}
            fileRefs={fileRefs}
            paired={paired}
            unpaired={unpaired}
            btn={btn}
          />
          </Suspense>
        )}

        {current && tab === "checkin" && (
          <Suspense fallback={<LottieLoader size={140} label="Loading…" />}>
          <CheckInTab
            tournament={current}
            players={players}
            categories={categories}
            currentCategoryId={currentCategoryId}
            setCurrentCategoryId={setCurrentCategoryId}
            playerCategoryMap={playerCategoryMap}
            isAdmin={isAdmin}
          />
          </Suspense>
        )}

        {current && tab === "profiles" && (
          <Suspense fallback={<LottieLoader size={140} label="Loading…" />}>
          <ProfilesTab
            categories={categories}
            currentCategoryId={currentCategoryId}
            setCurrentCategoryId={setCurrentCategoryId}
            catById={catById}
            players={players}
            allTeamsView={allTeamsView}
            projectedMatches={projectedMatches}
            playerCategories={playerCategories}
            playerCategoryMap={playerCategoryMap}
            paired={paired}
            groups={groups}
            getStandings={getStandings}
            profileViewPlayerId={profileViewPlayerId}
            setProfileViewPlayerId={setProfileViewPlayerId}
            isAdmin={isAdmin}
            editingId={editingId}
            editName={editName}
            setEditName={setEditName}
            startEdit={startEdit}
            saveEdit={saveEdit}
            fileRefs={fileRefs}
            handlePhoto={handlePhoto}
          />
          </Suspense>
        )}

        {current && tab === "teams" && (
          <Suspense fallback={<LottieLoader size={140} label="Loading…" />}>
          <TeamsTab
            tournament={current}
            categories={categories}
            currentCategoryId={currentCategoryId}
            setCurrentCategoryId={setCurrentCategoryId}
            currentCategory={currentCategory ?? null}
            catById={catById}
            teamsView={teamsView}
            invalidTeamsInCategory={invalidTeamsInCategory}
            phase={phase}
            isAdmin={isAdmin}
            removeTeam={removeTeam}
            cleanupInvalidTeams={cleanupInvalidTeams}
            selectedFormatLabel={selectedFormatLabel}
            setSelectedFormatLabel={setSelectedFormatLabel}
            onStartGroupStage={(override) => { void startGroupStage(override); }}
            resetAll={resetAll}
            btn={btn}
          />
          </Suspense>
        )}

        {current && tab === "groups" && (
          <Suspense fallback={<LottieLoader size={140} label="Loading…" />}>
          <GroupsTab
            categories={categories}
            currentCategoryId={currentCategoryId}
            setCurrentCategoryId={setCurrentCategoryId}
            currentCategory={currentCategory ?? null}
            groups={groups}
            groupMatches={groupMatches}
            getStandings={getStandings}
            isAdmin={isAdmin}
            allGroupsDone={allGroupsDone}
            phase={phase}
            onStartKnockout={() => startKnockout()}
            btn={btn}
            MatchCard={MatchCard}
          />
          </Suspense>
        )}

        {current && tab === "knockout" && (
          <Suspense fallback={<LottieLoader size={140} label="Loading…" />}>
          <KnockoutTab
            categories={categories}
            currentCategoryId={currentCategoryId}
            setCurrentCategoryId={setCurrentCategoryId}
            currentCategory={currentCategory ?? null}
            groups={groups}
            knockout={knockout}
            knockoutMatches={knockoutMatches}
            champion={champion}
            MatchCard={MatchCard}
          />
          </Suspense>
        )}

        {current && tab === "scoreboard" && (
          <Suspense fallback={<LottieLoader size={140} label="Loading…" />}>
          <ScoreboardTab
            categories={categories}
            currentCategoryId={currentCategoryId}
            setCurrentCategoryId={setCurrentCategoryId}
            teamsView={teamsView}
            groupMatches={groupMatches}
            knockoutMatches={knockoutMatches}
            champion={champion}
            phase={phase}
          />
          </Suspense>
        )}
      </main>

      {showLogin && <Login onClose={() => setShowLogin(false)} />}
      {showAdminManager && isAdmin && (
        <Suspense fallback={<LottieLoader fullScreen label="Loading…" />}>
          <AdminManager currentEmail={email} onClose={() => setShowAdminManager(false)} />
        </Suspense>
      )}

      {promotePickerFor && (() => {
        // Build the eligibility-status sets fresh on each open (cheap given small N).
        const bracketTeamIds = new Set<string>();
        const eliminatedTeamIds = new Set<string>();
        knockoutMatches.forEach(m => {
          if (m.team_a_id) bracketTeamIds.add(m.team_a_id);
          if (m.team_b_id) bracketTeamIds.add(m.team_b_id);
          if (m.confirmed && !m.is_bye && m.team_a_id && m.team_b_id && m.winner_id) {
            const loser = m.winner_id === m.team_a_id ? m.team_b_id : m.team_a_id;
            eliminatedTeamIds.add(loser);
          }
        });
        const qualifiedTeamIds = new Set<string>();
        const topN = currentCategory?.top_n_advance && currentCategory.top_n_advance > 0
          ? currentCategory.top_n_advance
          : 2;
        groups.forEach((g, gi) => {
          const st = getStandings(g, gi);
          for (let i = 0; i < Math.min(topN, st.length); i++) qualifiedTeamIds.add(st[i].team.id);
        });
        const targetMatch = knockoutMatches.find(m => m.id === promotePickerFor.matchId);
        const currentTeamId = targetMatch
          ? (promotePickerFor.side === "a" ? targetMatch.team_a_id : targetMatch.team_b_id)
          : null;
        return (
          <PromoteTeamPicker
            title="Select team for this slot"
            subtitle={`Knockout match · side ${promotePickerFor.side.toUpperCase()}`}
            candidates={teamsView}
            bracketTeamIds={bracketTeamIds}
            eliminatedTeamIds={eliminatedTeamIds}
            qualifiedTeamIds={qualifiedTeamIds}
            currentTeamId={currentTeamId}
            onSelect={async (teamId) => {
              // If the chosen team is already in another bracket slot, clear it from there.
              for (const m of knockoutMatches) {
                if (m.id === promotePickerFor.matchId) continue;
                if (m.team_a_id === teamId) {
                  await db.updateMatch(m.id, { team_a_id: null, status: "pending", winner_id: null, confirmed: false, score_a: null, score_b: null, confirmed_at: null });
                }
                if (m.team_b_id === teamId) {
                  await db.updateMatch(m.id, { team_b_id: null, status: "pending", winner_id: null, confirmed: false, score_a: null, score_b: null, confirmed_at: null });
                }
              }
              const patch = promotePickerFor.side === "a"
                ? { team_a_id: teamId }
                : { team_b_id: teamId };
              await db.updateMatch(promotePickerFor.matchId, patch);
              toast("Team placed in bracket slot", "success");
            }}
            onClose={() => setPromotePickerFor(null)}
          />
        );
      })()}

      <PartnerPickerModal
        open={partnerPicker !== null}
        me={partnerPicker ? playerById[partnerPicker] ?? null : null}
        choices={partnerPicker ? unpaired.filter(p => p.id !== partnerPicker) : []}
        onPick={(partnerId) => { if (partnerPicker) assignPartner(partnerPicker, partnerId); }}
        onClose={() => setPartnerPicker(null)}
      />

      {pickingCourtFor && (
        <CourtPicker
          numCourts={numCourts}
          busyCourts={new Set(Object.keys(liveByCourt).map(Number))}
          onPick={c => startMatchOnCourt(pickingCourtFor, c)}
          onCancel={() => setPickingCourtFor(null)}
        />
      )}

      <MoreDrawer
        open={isMobileNav && moreOpen}
        onClose={() => setMoreOpen(false)}
        currentTab={tab}
        onPickTab={setTab}
        phase={phase}
        isAdmin={isAdmin}
      />

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes pulse-strong {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
        @keyframes glow {
          0%, 100% { box-shadow: 0 0 12px rgba(0,184,255,0.4); }
          50% { box-shadow: 0 0 24px rgba(0,184,255,0.8); }
        }
        input[type=number]::-webkit-outer-spin-button,
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
        @media (max-width: 700px) {
          .hero-title { font-size: 36px !important; max-width: 100% !important; }
          .hero-pad { padding: 28px 18px 24px !important; }
        }
        @media print {
          body { background: #fff !important; color: #000 !important; }
          header, nav, footer, button { display: none !important; }
          main { max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
          [data-print-hide] { display: none !important; }
          * { background: #fff !important; color: #000 !important; box-shadow: none !important; border-color: #ccc !important; }
        }
      `}</style>

      <AppFooter />
    </div>
  );
}
// LiveTab extracted to src/components/LiveTab.tsx
