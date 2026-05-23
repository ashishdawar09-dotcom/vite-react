import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion"; /* NEW: makeover motion */
import * as Sentry from "@sentry/react";
import { useAuth } from "./hooks/useAuth";
import { useIsMobile } from "./hooks/useIsMobile"; /* NEW: mobile IA detection */
import { useTournamentData } from "./hooks/useTournamentData";
import { useScheduling } from "./hooks/useScheduling";
import * as db from "./lib/db";
import { supabase } from "./lib/supabase";
import { Login } from "./components/Login";
import { TournamentPicker } from "./components/TournamentPicker";
import { CategoryPicker } from "./components/CategoryPicker";
import { LiveTab } from "./components/LiveTab";
import { CourtPicker } from "./components/CourtPicker";
import { ShuttleSVG, Av } from "./components/ui";
import { LottieLoader } from "./components/ui/lottie-loader"; /* NEW: cat Lottie loader for boot + suspense + refetch */
import { NumberTicker } from "./components/ui/number-ticker"; /* NEW: count-up tickers on stats */
import { toast } from "./components/Toast";
import { defaultFormat, recommendFormats, splitIntoGroups, seedBracket, type FormatPlan } from "./lib/formatPlanner";
import { PromoteTeamPicker } from "./components/PromoteTeamPicker";
import { ScoreInput } from "./components/ScoreInput";
import { AppFooter } from "./components/AppFooter";
import { colors } from "./lib/theme";
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
  const [tab, setTab] = useState<"live" | "matches" | "register" | "checkin" | "profiles" | "teams" | "groups" | "knockout" | "scoreboard" | "categories">("live");
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

  const currentCategory = categories.find(c => c.id === currentCategoryId) ?? null;
  const phase: "none" | "group" | "knockout" = currentCategory?.phase
    ?? (categories.find(c => c.phase !== "none")?.phase ?? "none");

  // ALL teams including singles (p2 may be null)
  const playerById = useMemo(() => Object.fromEntries(players.map(p => [p.id, p])), [players]);
  const allTeamsView: TeamView[] = useMemo(
    () => teams.map(t => {
      const p1 = playerById[t.p1_id];
      const p2 = t.p2_id ? playerById[t.p2_id] : null;
      return { ...t, p1, p2 } as TeamView;
    }).filter(t => t.p1) as TeamView[],
    [teams, playerById]
  );
  const allTeamById = useMemo(() => Object.fromEntries(allTeamsView.map(t => [t.id, t])), [allTeamsView]);

  // Scoped to currentCategory (or all when null)
  const teamsView: TeamView[] = useMemo(
    () => currentCategoryId ? allTeamsView.filter(t => t.category_id === currentCategoryId) : allTeamsView,
    [allTeamsView, currentCategoryId]
  );
  const teamById = useMemo(() => Object.fromEntries(teamsView.map(t => [t.id, t])), [teamsView]);

  const categoryMatches = useMemo(() => currentCategoryId ? matches.filter(m => m.category_id === currentCategoryId) : matches, [matches, currentCategoryId]);
  // Stable sort: tie-break on id so cards never swap positions between
  // snapshot polls while a user is editing a score.
  const groupMatches = useMemo(() =>
    categoryMatches.filter(m => m.stage === "group").sort((a, b) =>
      (a.group_idx! - b.group_idx!) ||
      (a.slot_idx - b.slot_idx) ||
      a.id.localeCompare(b.id)
    ),
  [categoryMatches]);
  const knockoutMatches = useMemo(() =>
    categoryMatches.filter(m => m.stage === "knockout").sort((a, b) =>
      (a.round_idx! - b.round_idx!) ||
      (a.slot_idx - b.slot_idx) ||
      a.id.localeCompare(b.id)
    ),
  [categoryMatches]);

  // Schedule projection across all categories (for Live + Matches tabs)
  const numCourts = current?.num_courts ?? 2;
  const { projected: projectedMatches, byId: projectedById, tournamentDeltaMin, tournamentDeltaLabel, liveByCourt } = useScheduling(matches, categories, numCourts);

  const groups: TeamView[][] = useMemo(() => {
    const map = new Map<number, Set<string>>();
    groupMatches.forEach(m => {
      if (m.group_idx == null) return;
      if (!map.has(m.group_idx)) map.set(m.group_idx, new Set());
      const s = map.get(m.group_idx)!;
      if (m.team_a_id) s.add(m.team_a_id);
      if (m.team_b_id) s.add(m.team_b_id);
    });
    return [...map.keys()].sort((a, b) => a - b).map(gi => [...map.get(gi)!].map(id => teamById[id]).filter(Boolean) as TeamView[]);
  }, [groupMatches, teamById]);

  const knockout: Match[][] = useMemo(() => {
    const map = new Map<number, Match[]>();
    knockoutMatches.forEach(m => {
      if (m.round_idx == null) return;
      if (!map.has(m.round_idx)) map.set(m.round_idx, []);
      map.get(m.round_idx)!.push(m);
    });
    return [...map.keys()].sort((a, b) => a - b).map(ri => map.get(ri)!.sort((a, b) => a.slot_idx - b.slot_idx));
  }, [knockoutMatches]);

  // Map each player to the set of categories they're assigned to (via junction table)
  const playerCategoryMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const pc of playerCategories) {
      if (!map.has(pc.player_id)) map.set(pc.player_id, new Set());
      map.get(pc.player_id)!.add(pc.category_id);
    }
    return map;
  }, [playerCategories]);

  // Active players in the *current category* (or all if no filter). This is
  // the source of truth for who's eligible to be paired here. Without this
  // filter, Auto-Pair / Partner-Picker pull in players from other categories
  // and tag the resulting teams with the wrong category_id.
  const active = useMemo(() => {
    const all = players.filter(p => p.active);
    if (!currentCategoryId) return all;
    return all.filter(p => playerCategoryMap.get(p.id)?.has(currentCategoryId));
  }, [players, currentCategoryId, playerCategoryMap]);
  const paired = useMemo(
    () => new Set(teamsView.flatMap(t => [t.p1_id, t.p2_id]).filter((id): id is string => id !== null)),
    [teamsView],
  );
  const unpaired = useMemo(
    () => active.filter(p => !paired.has(p.id)),
    [active, paired],
  );

  // Teams currently in the viewed category whose players don't all belong to
  // this category — leftovers from the pre-fix Auto-Pair bug. Surfaced via
  // the "Clean up" button on the Teams tab.
  const invalidTeamsInCategory = useMemo(() => {
    if (!currentCategoryId) return [];
    return teamsView.filter(t => {
      const p1Ok = playerCategoryMap.get(t.p1_id)?.has(currentCategoryId) ?? false;
      const p2Ok = !t.p2_id || (playerCategoryMap.get(t.p2_id)?.has(currentCategoryId) ?? false);
      return !p1Ok || !p2Ok;
    });
  }, [teamsView, currentCategoryId, playerCategoryMap]);

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

  const catById = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories]);

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
    const ni = Math.floor(m.slot_idx / 2);
    const nm = nextRound[ni];
    if (!nm) return;
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
          fontFamily: "'Inter', system-ui, sans-serif",   /* MAKEOVER: dropped font-display (Oswald) per Section 3 spec */
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
  const tLabel = (t: TeamView | null) => t?.p1 ? (t.p2 ? `${t.p1.name} & ${t.p2.name}` : t.p1.name) : "TBD";
  const teamFromId = (id: string | null): TeamView | null => id ? teamById[id] ?? null : null;

  const MatchCard = ({ match: m, editable = true, matchMinutes }: { match: Match; editable?: boolean; matchMinutes?: number }) => {
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
    const cardTimeOver = m.status === "live" && m.started_at ? (cardNow - new Date(m.started_at).getTime()) / 60_000 > totalMin : false;
    const warmupElapsed = isWarming && m.court_allocated_at
      ? (() => {
          const sec = Math.max(0, Math.floor((cardNow - new Date(m.court_allocated_at).getTime()) / 1000));
          return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
        })()
      : null;

    const teamRow = (team: typeof ta, side: "a" | "b", scoreVal: number, isWin: boolean) => {
      const stepBtn = (delta: number, label: string) => (
        <button onClick={() => adjustScore(m, side, delta)} style={{ width: 56, height: 56, borderRadius: 14, border: "2px solid #e2e8f0", background: "#fff", fontSize: 26, fontWeight: 800, color: "#1a1a2e", cursor: "pointer", touchAction: "manipulation", userSelect: "none", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }} aria-label={label}>{label}</button>
      );
      // Empty knockout slot — show a "Select team" button for admins.
      const isEmptyKnockoutSlot = !team && m.stage === "knockout" && !m.is_bye && !m.confirmed;
      return (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "1 1 140px", minWidth: 0 }}>
            {team?.p1 && <Av name={team.p1.name} photo={team.p1.photo_url} sz={34} color={team.p1.color} />}
            {isEmptyKnockoutSlot && isAdmin ? (
              <button
                onClick={() => setPromotePickerFor({ matchId: m.id, side })}
                style={{ padding: "6px 12px", borderRadius: 8, border: "1px dashed #a855f7", background: "rgba(168,85,247,0.08)", color: "#a855f7", fontSize: 12, fontWeight: 800, letterSpacing: 0.5, cursor: "pointer", textTransform: "uppercase" }}
                title="Pick a team for this slot"
              >
                + Select Team
              </button>
            ) : (
              <span style={{ fontWeight: isWin ? 800 : 600, fontSize: 14, color: isWin ? "#16a34a" : "#1a1a2e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tLabel(team)}</span>
            )}
          </div>
          {inlineMode ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
              {stepBtn(-1, "−")}
              <ScoreInput
                value={scoreVal}
                onCommit={next => setScore(m, side, next)}
              />
              {stepBtn(1, "+")}
            </div>
          ) : (
            <div style={{ marginLeft: "auto", background: showStaticScore ? (isWin ? "#f0fdf4" : "#f8fafc") : "#f8fafc", border: `2px solid ${isWin ? "#86efac" : "#e2e8f0"}`, borderRadius: 10, padding: "8px 18px", fontWeight: 900, fontSize: 22, color: isWin ? "#16a34a" : showStaticScore ? "#1a1a2e" : "#cbd5e1", minWidth: 56, textAlign: "center" }}>
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
      await db.markWalkover(m.id, winnerId);
      await propagateWinner(m, winnerId);
      setTimeOverPick(null);
    };

    const handleCardSelectWinner = async (side: "a" | "b") => {
      const winnerId = side === "a" ? m.team_a_id : m.team_b_id;
      if (!winnerId) return;
      await db.selectMatchWinner(m.id, winnerId);
      await propagateWinner(m, winnerId);
      setTimeOverPick(null);
    };

    return (
      <div style={{ background: "#fff", borderRadius: 14, border: cardTimeOver ? "2px solid #f59e0b" : m.status === "live" ? "2px solid #ef4444" : isWarming ? "2px solid #fbbf24" : "1px solid #e8ecf1", overflow: "hidden", boxShadow: m.status === "live" ? (cardTimeOver ? "0 4px 20px rgba(245,158,11,0.3)" : "0 4px 20px rgba(239,68,68,0.25)") : isWarming ? "0 4px 20px rgba(251,191,36,0.2)" : "0 2px 12px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", background: cardTimeOver ? "linear-gradient(90deg,#fffbeb,#fef3c7)" : m.status === "live" ? "linear-gradient(90deg,#fef2f2,#fee2e2)" : isWarming ? "linear-gradient(90deg,#fffbeb,#fef3c7)" : m.confirmed ? "linear-gradient(90deg,#f0fdf4,#dcfce7)" : "linear-gradient(90deg,#f8fafc,#f1f5f9)", fontSize: 12, fontWeight: 600 }}>
          <span style={{ color: "#64748b" }}>Match{m.court_number != null && (isWarming || m.status === "live") ? ` · Court ${m.court_number}` : ""}</span>
          {cardTimeOver && <span style={{ color: "#d97706", fontWeight: 800, display: "flex", alignItems: "center", gap: 4 }}>⏰ TIME OVER</span>}
          {m.status === "live" && !cardTimeOver && <span style={{ color: "#dc2626", display: "flex", alignItems: "center", gap: 4 }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#dc2626", animation: "pulse 1.5s ease-in-out infinite" }} />LIVE</span>}
          {isWarming && <span style={{ color: "#d97706", fontWeight: 800, display: "flex", alignItems: "center", gap: 4 }}>🟡 WARMING UP · {warmupElapsed}</span>}
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
                <button onClick={() => startMatchHandler(m.id)} style={{ ...btn("#dc2626"), flex: "1 1 140px", padding: "12px", fontSize: 14, borderRadius: 10 }}>▶ Start Match</button>
              )}
              {isWarming && (
                <>
                  <button onClick={() => beginScoringMatch(m.id)} style={{ ...btn("#fbbf24", "#1a1a2e"), flex: "1 1 160px", padding: "12px", fontSize: 14, borderRadius: 10, fontWeight: 800 }}>▶ Begin Scoring</button>
                  <button onClick={() => cancelMatchAllocation(m)} style={{ ...btn("#e2e8f0", "#475569"), flex: "1 1 140px", padding: "12px", fontSize: 13, borderRadius: 10, boxShadow: "none" }}>↩ Cancel Allocation</button>
                </>
              )}
              {m.status === "live" && !m.confirmed && !cardTimeOver && (
                <button onClick={() => confirmInline(m)} style={{ ...btn("#16a34a"), flex: "1 1 100%", padding: "14px", fontSize: 15, borderRadius: 10, fontWeight: 800 }}>✓ Confirm Final Score</button>
              )}
              {/* Time-over actions */}
              {m.status === "live" && !m.confirmed && cardTimeOver && (
                <>
                  <button onClick={() => db.extendMatch(m.id, 5)} style={{ ...btn("#3b82f6"), flex: "1 1 100px", padding: "10px", fontSize: 12, borderRadius: 10 }}>+5 Min</button>
                  <button onClick={() => confirmInline(m)} style={{ ...btn("#16a34a"), flex: "1 1 100px", padding: "10px", fontSize: 12, borderRadius: 10 }}>✓ Confirm</button>
                  <button onClick={() => setTimeOverPick("walkover")} style={{ ...btn("#f59e0b"), flex: "1 1 100px", padding: "10px", fontSize: 12, borderRadius: 10 }}>Walkover</button>
                  <button onClick={() => setTimeOverPick("winner")} style={{ ...btn("#22c55e"), flex: "1 1 100px", padding: "10px", fontSize: 12, borderRadius: 10 }}>Select Winner</button>
                  <button onClick={async () => { if (confirm("Reschedule? Match goes back to pending.")) await db.rescheduleMatch(m.id); }} style={{ ...btn("#e2e8f0", "#475569"), flex: "1 1 100px", padding: "10px", fontSize: 12, borderRadius: 10, boxShadow: "none" }}>Reschedule</button>
                  <button onClick={async () => { if (confirm("Cancel match? No winner will be recorded.")) await db.cancelMatch(m.id); }} style={{ ...btn("#dc2626"), flex: "1 1 100px", padding: "10px", fontSize: 12, borderRadius: 10 }}>Cancel</button>
                </>
              )}
              {/* Team picker for walkover/winner in time-over */}
              {timeOverPick && (
                <div style={{ display: "flex", gap: 8, width: "100%", flexWrap: "wrap", padding: "8px 0 0", borderTop: "1px solid #e2e8f0" }}>
                  <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600, width: "100%" }}>{timeOverPick === "walkover" ? "Pick walkover winner:" : "Pick winner:"}</span>
                  <button onClick={() => timeOverPick === "walkover" ? handleCardWalkover("a") : handleCardSelectWinner("a")} style={{ ...btn("#16a34a"), flex: 1, padding: "10px", fontSize: 13, borderRadius: 10 }}>{tLabel(ta)}</button>
                  <button onClick={() => timeOverPick === "walkover" ? handleCardWalkover("b") : handleCardSelectWinner("b")} style={{ ...btn("#16a34a"), flex: 1, padding: "10px", fontSize: 13, borderRadius: 10 }}>{tLabel(tb)}</button>
                  <button onClick={() => setTimeOverPick(null)} style={{ ...btn("#e2e8f0", "#475569"), padding: "10px 16px", fontSize: 12, borderRadius: 10, boxShadow: "none" }}>Cancel</button>
                </div>
              )}
              {m.confirmed && !isEditing && (
                <button onClick={() => setEditingMatchId(m.id)} style={{ ...btn("#f59e0b"), flex: "1 1 140px", padding: "12px", fontSize: 14, borderRadius: 10 }}>✏️ Edit Score</button>
              )}
              {isEditing && (
                <>
                  <button onClick={() => setEditingMatchId(null)} style={{ ...btn("#e2e8f0", "#475569"), flex: "1 1 100px", padding: "12px", fontSize: 14, borderRadius: 10, boxShadow: "none" }}>Cancel</button>
                  <button onClick={() => saveEditedMatch(m)} style={{ ...btn("#16a34a"), flex: "1 1 140px", padding: "12px", fontSize: 14, borderRadius: 10 }}>💾 Save Changes</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const signOut = async () => { await supabase.auth.signOut(); };

  if (authLoading) return <LottieLoader fullScreen label="Loading tournament…" />; /* NEW: cat Lottie loader during initial auth check */

  /* NEW: full-screen cat overlay during tournament-data refetch (e.g. tournament dropdown switch).
     Renders only after authLoading is false, so this never doubles up with the auth loader. */
  const showDataLoader = dataLoading && currentId;

  return (
    <div style={{ minHeight: "100dvh", background: "#0a1628", color: "#1a1a2e", fontFamily: "'Inter','Segoe UI',system-ui,-apple-system,sans-serif" }}>
      {/* NEW: cat overlay during tournament-data refetch (e.g. switching tournament from the
          dropdown). Renders on top of everything via fullScreen variant (z-index: 9999). */}
      {showDataLoader && <LottieLoader fullScreen label="Loading tournament data…" />}
      <header style={{
        background: colors.gradient.headerSurface,
        color: "#fff",
        padding: 0,
        position: "relative",
        overflow: "hidden",
        borderBottom: "1px solid #1a3050",
        // iOS PWA: push tappable content below the Dynamic Island / notch.
        // viewport-fit=cover (index.html) puts content under the OS status bar
        // in standalone mode; without this padding the Admin Sign In button is
        // physically rendered inside the OS-reserved zone and taps are
        // consumed by the Dynamic Island rather than reaching the web view.
        paddingTop: "env(safe-area-inset-top, 0px)",
        // Side insets matter in landscape on notched devices.
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}>
        {/* Athlete photo on the right with diagonal cutout */}
        <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "55%", clipPath: "polygon(20% 0, 100% 0, 100% 100%, 0 100%)", overflow: "hidden", zIndex: 0 }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/images/B6.jpg)", backgroundSize: "cover", backgroundPosition: "center 30%", opacity: 0.95 }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, #050d1a 0%, rgba(5,13,26,0.85) 22%, rgba(5,13,26,0.4) 50%, rgba(5,13,26,0.05) 100%)" }} />
        </div>

        {/* Cyan glow accent */}
        <div style={{ position: "absolute", top: "-30%", left: "-10%", width: 500, height: 500, background: "radial-gradient(circle, rgba(0,184,255,0.18) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, transparent, #00b8ff 20%, #00d4ff 50%, #00b8ff 80%, transparent)", zIndex: 1 }} />
        <div style={{ position: "absolute", bottom: 3, left: 0, right: 0, height: 1, background: "rgba(0,184,255,0.3)", zIndex: 1 }} />

        {/* Top bar: brand + admin chip */}
        <div style={{ position: "relative", zIndex: 3, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 28px", borderBottom: "1px solid rgba(0,184,255,0.12)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg,#00b8ff,#0066ff)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(0,184,255,0.4)" }}>
              {/* MAKEOVER: 🏸 emoji -> custom shuttlecock SVG */}
              <ShuttleSVG sz={22} color="#fff" opacity={1} />
            </div>
            <div>
              <div className="font-display" style={{ fontSize: 20, fontWeight: 700, letterSpacing: 1, color: "#fff", lineHeight: 1 }}>BADMINTON<span style={{ color: "#00b8ff" }}>LIVE</span></div>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, color: "#64748b", textTransform: "uppercase", marginTop: 2 }}>Tournament Center</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {isAdmin ? (
              <>
                <span style={{
                  fontSize: 11,
                  color: colors.brand.cyan,
                  background: colors.brand.cyanSubtle,
                  // 12px vertical padding lifts the chip from a non-tappable
                  // 23px tall pill to a 44pt-tall iOS-conformant target. The
                  // chip is itself non-interactive but matches sibling sizes.
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${colors.brand.cyanBorder}`,
                  fontWeight: 600,
                  letterSpacing: 0.5,
                  minHeight: 44,
                  display: "inline-flex",
                  alignItems: "center",
                }}>● {email}</span>
                <button
                  onClick={() => setShowAdminManager(true)}
                  title="Manage admins"
                  style={{
                    padding: "10px 14px",
                    minHeight: 44,
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "transparent",
                    color: "#cbd5e1",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: 0.5,
                  }}>👥 ADMINS</button>
                <button
                  onClick={signOut}
                  style={{
                    padding: "10px 16px",
                    minHeight: 44,
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "transparent",
                    color: "#cbd5e1",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: 0.5,
                  }}>SIGN OUT</button>
              </>
            ) : (
              <button
                onClick={() => setShowLogin(true)}
                style={{
                  // iOS HIG minimum touch target = 44pt; previously 8px×18px
                  // padding gave ~30px height. Bumped to 12px×22px for a
                  // 44pt-tall target that's still visually balanced.
                  padding: "12px 22px",
                  minHeight: 44,
                  borderRadius: 8,
                  border: "none",
                  background: colors.gradient.brandCta,
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 800,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  boxShadow: "0 2px 12px rgba(0,184,255,0.4)",
                }}>Admin Sign In</button>
            )}
          </div>
        </div>

        {/* Main hero content */}
        <div className="hero-pad" style={{ position: "relative", zIndex: 2, padding: "44px 28px 36px", maxWidth: 1280, margin: "0 auto" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px", borderRadius: 4, background: "rgba(0,184,255,0.12)", border: "1px solid rgba(0,184,255,0.3)", marginBottom: 18 }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#00d4ff", boxShadow: "0 0 8px #00d4ff" }} />
            <span className="font-display" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 3, textTransform: "uppercase", color: "#00d4ff" }}>Doubles Tournament</span>
          </div>

          <h1 className="font-display hero-title" style={{ margin: "0 0 10px", fontSize: 64, fontWeight: 700, letterSpacing: -1, color: "#fff", lineHeight: 0.95, textTransform: "uppercase", maxWidth: "65%" }}>{current?.name ?? "Badminton Championship"}</h1>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22, flexWrap: "wrap" }}>
            {current?.event_date && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <span style={{ color: "#00d4ff", fontSize: 13 }}>▸</span>
                <span className="font-display" style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", letterSpacing: 1 }}>{
                  // event_date is a DATE column (no time / timezone). `new Date('YYYY-MM-DD')` parses as
                  // UTC midnight, which becomes the previous day in any timezone west of UTC. Appending
                  // T12:00:00 (noon, local) avoids that off-by-one without timezone gymnastics.
                  new Date(current.event_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).toUpperCase()
                }</span>
              </div>
            )}
            <TournamentPicker tournaments={tournaments} current={current} onSelect={setCurrentId} isAdmin={isAdmin} onChange={reloadTournaments} />
            <CategoryPicker categories={categories} currentId={currentCategoryId} onSelect={setCurrentCategoryId} />
            {/* Tournament-wide pace pill */}
            {matches.some(m => m.confirmed) && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 4, background: tournamentDeltaMin > 1 ? "rgba(239,68,68,0.12)" : tournamentDeltaMin < -1 ? "rgba(34,197,94,0.12)" : "rgba(0,184,255,0.12)", border: `1px solid ${tournamentDeltaMin > 1 ? "rgba(239,68,68,0.4)" : tournamentDeltaMin < -1 ? "rgba(34,197,94,0.4)" : "rgba(0,184,255,0.4)"}` }}>
                <span style={{ fontSize: 11 }}>{tournamentDeltaMin > 1 ? "▲" : tournamentDeltaMin < -1 ? "▼" : "●"}</span>
                <span className="font-display" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: tournamentDeltaMin > 1 ? "#fca5a5" : tournamentDeltaMin < -1 ? "#86efac" : "#7dd3fc" }}>{tournamentDeltaLabel}</span>
              </div>
            )}
          </div>

          {/* Quick stats — broadcast style */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", maxWidth: "65%" }}>
            {([[active.length, "Active Players", "#00d4ff"], [teamsView.length, "Teams", "#22c55e"], [unpaired.length, "Unpaired", "#f59e0b"]] as const).map(([v, l, c]) => (
              <div key={l} style={{ flex: "1 1 140px", background: "rgba(15,30,55,0.65)", backdropFilter: "blur(8px)", borderRadius: 6, padding: "12px 16px", border: "1px solid rgba(255,255,255,0.08)", borderLeft: `3px solid ${c}`, minWidth: 110 }}>
                <NumberTicker value={v} padLength={2} className="font-display" style={{ fontSize: 32, fontWeight: 700, color: c, lineHeight: 1, fontVariantNumeric: "tabular-nums", display: "block" }} />
                <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 4, fontWeight: 600 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

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
                fontFamily: "'Inter', system-ui, sans-serif",
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

      {partnerPicker && (() => {
        const me = playerById[partnerPicker];
        const choices = unpaired.filter(p => p.id !== partnerPicker);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1500, padding: 16, backdropFilter: "blur(4px)" }} onClick={() => setPartnerPicker(null)}>
            <div style={{ background: "#fff", borderRadius: 20, padding: 28, maxWidth: 480, width: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
              <h3 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 800, textAlign: "center" }}>🤝 Choose Partner</h3>
              <p style={{ margin: "0 0 20px", fontSize: 13, color: "#64748b", textAlign: "center" }}>Pair {me?.name} with...</p>
              {choices.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No available players to pair with.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10 }}>
                  {choices.map(p => (
                    <button key={p.id} onClick={() => assignPartner(partnerPicker, p.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, border: "2px solid #e2e8f0", background: "#fff", cursor: "pointer", textAlign: "left", transition: "all .15s" }} onMouseEnter={e => { e.currentTarget.style.borderColor = "#3A86FF"; e.currentTarget.style.background = "#eff6ff"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = "#e2e8f0"; e.currentTarget.style.background = "#fff"; }}>
                      <Av name={p.name} photo={p.photo_url} sz={36} color={p.color} />
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setPartnerPicker(null)} style={{ width: "100%", marginTop: 18, padding: 12, background: "#e2e8f0", color: "#475569", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        );
      })()}

      {pickingCourtFor && (
        <CourtPicker
          numCourts={numCourts}
          busyCourts={new Set(Object.keys(liveByCourt).map(Number))}
          onPick={c => startMatchOnCourt(pickingCourtFor, c)}
          onCancel={() => setPickingCourtFor(null)}
        />
      )}

      {/* NEW: Mobile "More" drawer — slides up from bottom, shows the 7 secondary tabs. */}
      {/* HOTFIX: explicit `key` props on AnimatePresence children. Without them iOS WebKit
          could lose track of element identity across enter/exit and throw DOMException
          NotFoundError during React reconciliation (caught by Sentry: ad68e220a5ff…). */}
      <AnimatePresence>
        {isMobileNav && moreOpen && (
          <motion.div
            key="more-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setMoreOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 200, display: "flex", alignItems: "flex-end" }}
          >
            <motion.div
              key="more-drawer-sheet"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              onClick={e => e.stopPropagation()}
              style={{
                width: "100%",
                background: "#0a1628",
                borderTop: "1px solid #1a3050",
                borderTopLeftRadius: 18,
                borderTopRightRadius: 18,
                // Top 12, sides 16, bottom = 24 + safe-area so the last button
                // clears the iOS home indicator on iPhone 14+/15+/16/17.
                padding: "12px 16px calc(env(safe-area-inset-bottom, 0px) + 24px)",
                maxHeight: "70vh",
                overflowY: "auto",
              }}
            >
              <div style={{ width: 40, height: 4, background: "#475569", borderRadius: 2, margin: "0 auto 16px" }} />
              <div className="font-display" style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 2, fontWeight: 700, marginBottom: 12, padding: "0 4px" }}>More Tabs</div>
              {[
                { id: "register" as const, label: "Players", icon: "📋", visible: true },
                { id: "checkin" as const, label: "Check-In", icon: "✅", visible: true },
                { id: "teams" as const, label: "Teams", icon: "🤝", visible: true },
                { id: "groups" as const, label: "Groups", icon: "📊", visible: phase !== "none" },
                { id: "knockout" as const, label: "Knockout", icon: "⚔️", visible: phase === "knockout" },
                { id: "scoreboard" as const, label: "Scoreboard", icon: "🏅", visible: true },
                { id: "categories" as const, label: "Categories", icon: "🏷️", visible: isAdmin },
              ].filter(t => t.visible).map(t => {
                const isActive = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { setTab(t.id); setMoreOpen(false); }}
                    className="font-display"
                    style={{ width: "100%", padding: "14px", background: isActive ? "rgba(0,212,255,0.12)" : "transparent", border: isActive ? "1px solid rgba(0,212,255,0.3)" : "1px solid #1a3050", borderRadius: 10, fontSize: 13, fontWeight: 600, color: isActive ? "#00d4ff" : "#cbd5e1", letterSpacing: 1.5, textTransform: "uppercase", textAlign: "left", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", marginBottom: 6 }}
                  >
                    <span style={{ fontSize: 18 }}>{t.icon}</span>{t.label}
                  </button>
                );
              })}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
