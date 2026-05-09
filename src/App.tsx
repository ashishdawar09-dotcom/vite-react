import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { useTournamentData } from "./hooks/useTournamentData";
import { useScheduling } from "./hooks/useScheduling";
import * as db from "./lib/db";
import { supabase } from "./lib/supabase";
import { Login } from "./components/Login";
import { TournamentPicker } from "./components/TournamentPicker";
import { CategoryPicker } from "./components/CategoryPicker";
import { CategoryFilter } from "./components/CategoryFilter";
import { LiveTab } from "./components/LiveTab";
import { CourtPicker } from "./components/CourtPicker";
import { ShuttleSVG, Av } from "./components/ui";
import { toast } from "./components/Toast";
import { AdminManager } from "./components/AdminManager";
import { PlayerProfileView } from "./components/PlayerProfileView";
import { defaultFormat, recommendFormats, describeFormat, splitIntoGroups, type FormatPlan } from "./lib/formatPlanner";
import { PromoteTeamPicker } from "./components/PromoteTeamPicker";
import { KnockoutSanityBanner } from "./components/KnockoutSanityBanner";
import type { Match, Player, Team, Tournament } from "./types";

const MatchesTab = React.lazy(() => import("./components/MatchesTab").then(m => ({ default: m.MatchesTab })));
const CategoriesTab = React.lazy(() => import("./components/CategoriesTab").then(m => ({ default: m.CategoriesTab })));

function shuffle<T>(arr: T[]): T[] { return [...arr].sort(() => Math.random() - 0.5); }

/**
 * Score input that keeps a local string while the field is focused, so
 * snapshot polls / realtime pushes don't fight with the user's typing.
 * Persists on blur or Enter. Selects all on focus so a fresh number
 * cleanly replaces the previous one.
 */
function ScoreInput({ value, onCommit }: { value: number; onCommit: (next: number) => void }) {
  const [local, setLocal] = useState<string>(String(value));
  const [focused, setFocused] = useState(false);
  // Sync from props ONLY when not focused — otherwise we'd clobber the
  // user's in-progress typing every time the data refreshes.
  useEffect(() => {
    if (!focused) setLocal(String(value));
  }, [value, focused]);
  const commit = () => {
    const n = parseInt(local, 10);
    const next = Math.max(0, isNaN(n) ? 0 : n);
    if (next !== value) onCommit(next);
    setLocal(String(next));
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={local}
      onChange={e => setLocal(e.target.value.replace(/[^0-9]/g, ""))}
      onFocus={e => { setFocused(true); e.target.select(); }}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={e => {
        if (e.key === "Enter") { e.currentTarget.blur(); }
        else if (e.key === "Escape") { setLocal(String(value)); e.currentTarget.blur(); }
      }}
      style={{ width: 72, height: 56, textAlign: "center", fontSize: 30, fontWeight: 900, borderRadius: 14, border: "2px solid #3A86FF", outline: "none", color: "#1a1a2e", background: "#eff6ff", padding: 0, MozAppearance: "textfield" as any }}
      aria-label="Score"
    />
  );
}

const rName = (n: number, i: number) => { if (i === n - 1) return "🏆 Final"; if (i === n - 2) return "Semi-Final"; if (i === n - 3) return "Quarter-Final"; return `Round ${i + 1}`; };

type TeamView = Team & { p1: Player; p2: Player | null };

export default function App() {
  const { isAdmin, email, loading: authLoading } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showAdminManager, setShowAdminManager] = useState(false);
  const [tab, setTab] = useState<"live" | "matches" | "register" | "profiles" | "teams" | "groups" | "knockout" | "scoreboard" | "categories">("live");
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
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments" }, reloadTournaments)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const current = tournaments.find(t => t.id === currentId) ?? null;
  const { players, teams, matches, categories, playerCategories } = useTournamentData(currentId, isAdmin);

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
    () => new Set(teamsView.flatMap(t => [t.p1_id, t.p2_id])),
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

    const rows: any[] = [];
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

    // Collect qualifiers from each group's standings (already sorted W/+/-).
    const q: TeamView[] = [];
    groups.forEach((g, gi) => {
      const st = getStandings(g, gi);
      const limit = Math.min(topN, st.length);
      for (let i = 0; i < limit; i++) q.push(st[i].team);
    });
    if (q.length < 2) return;

    // Build a power-of-2 bracket. With the format planner driving group/topN
    // choices, q.length should already be a power of 2 — but if it's not
    // (e.g. admin customized values that don't add up), we fall back to byes
    // for the trailing slots so the bracket still renders. Admins can fix
    // mis-seeded brackets via the Promote-Team UI on each match card.
    const rds = Math.ceil(Math.log2(q.length));
    const slots = Math.pow(2, rds);
    const seeded: (TeamView | null)[] = [...q];
    while (seeded.length < slots) seeded.push(null);
    const rows: any[] = [];
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
  const startMatchOnCourt = async (m: Match, court: number) => {
    // Player conflict check
    const ta = m.team_a_id ? allTeamById[m.team_a_id] : null;
    const tb = m.team_b_id ? allTeamById[m.team_b_id] : null;
    const playerIds = new Set<string>();
    if (ta) { playerIds.add(ta.p1_id); if (ta.p2_id) playerIds.add(ta.p2_id); }
    if (tb) { playerIds.add(tb.p1_id); if (tb.p2_id) playerIds.add(tb.p2_id); }
    const conflicts: string[] = [];
    for (const live of Object.values(liveByCourt)) {
      if (!live || live.id === m.id) continue;
      const lA = live.team_a_id ? allTeamById[live.team_a_id] : null;
      const lB = live.team_b_id ? allTeamById[live.team_b_id] : null;
      const liveIds = new Set<string>();
      if (lA) { liveIds.add(lA.p1_id); if (lA.p2_id) liveIds.add(lA.p2_id); }
      if (lB) { liveIds.add(lB.p1_id); if (lB.p2_id) liveIds.add(lB.p2_id); }
      for (const pid of playerIds) {
        if (liveIds.has(pid)) {
          const name = playerById[pid]?.name ?? "?";
          conflicts.push(`${name} on Court ${live.court_number}`);
        }
      }
    }
    if (conflicts.length) {
      if (!confirm(`Player conflict — ${conflicts.join(", ")}.\n\nStart anyway?`)) return;
    }
    const ok = await db.startMatchOnCourt(m.id, court);
    if (!ok) {
      toast(`Court ${court} is already in use — pick another court.`, "warn");
      return;
    }
    setPickingCourtFor(null);
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
  const tabBtn = (t: typeof tab, label: string, icon: string) => (
    <button key={t} onClick={() => setTab(t)} className="font-display" style={{ padding: "14px 22px", cursor: "pointer", fontWeight: 700, fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase", background: "transparent", color: tab === t ? "#00d4ff" : "#64748b", border: "none", borderBottom: tab === t ? "3px solid #00d4ff" : "3px solid transparent", marginBottom: -1, display: "flex", alignItems: "center", gap: 6, transition: "color .15s" }}><span style={{ fontSize: 14 }}>{icon}</span>{label}</button>
  );
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

    const [cardNow, setCardNow] = useState(Date.now());
    const [timeOverPick, setTimeOverPick] = useState<"walkover" | "winner" | null>(null);
    useEffect(() => {
      if (m.status !== "live") return;
      const id = setInterval(() => setCardNow(Date.now()), 15_000);
      return () => clearInterval(id);
    }, [m.status]);
    const totalMin = (matchMinutes ?? 12) + (m.extended_minutes ?? 0);
    const cardTimeOver = m.status === "live" && m.started_at ? (cardNow - new Date(m.started_at).getTime()) / 60_000 > totalMin : false;

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
      <div style={{ background: "#fff", borderRadius: 14, border: cardTimeOver ? "2px solid #f59e0b" : m.status === "live" ? "2px solid #ef4444" : "1px solid #e8ecf1", overflow: "hidden", boxShadow: m.status === "live" ? (cardTimeOver ? "0 4px 20px rgba(245,158,11,0.3)" : "0 4px 20px rgba(239,68,68,0.25)") : "0 2px 12px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", background: cardTimeOver ? "linear-gradient(90deg,#fffbeb,#fef3c7)" : m.status === "live" ? "linear-gradient(90deg,#fef2f2,#fee2e2)" : m.confirmed ? "linear-gradient(90deg,#f0fdf4,#dcfce7)" : "linear-gradient(90deg,#f8fafc,#f1f5f9)", fontSize: 12, fontWeight: 600 }}>
          <span style={{ color: "#64748b" }}>Match</span>
          {cardTimeOver && <span style={{ color: "#d97706", fontWeight: 800, display: "flex", alignItems: "center", gap: 4 }}>⏰ TIME OVER</span>}
          {m.status === "live" && !cardTimeOver && <span style={{ color: "#dc2626", display: "flex", alignItems: "center", gap: 4 }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#dc2626", animation: "pulse 1.5s ease-in-out infinite" }} />LIVE</span>}
          {m.confirmed && !isEditing && <span style={{ color: "#16a34a" }}>✓ Confirmed</span>}
          {isEditing && <span style={{ color: "#f59e0b" }}>✏️ Editing</span>}
        </div>
        <div style={{ padding: "8px 14px 14px" }}>
          {teamRow(ta, "a", m.score_a ?? 0, winA)}
          <div style={{ height: 1, background: "#f1f5f9", margin: "2px 0" }} />
          {teamRow(tb, "b", m.score_b ?? 0, winB)}

          {editable && ta && tb && isAdmin && (
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              {m.status === "pending" && !m.confirmed && (
                <button onClick={() => startMatchHandler(m.id)} style={{ ...btn("#dc2626"), flex: "1 1 140px", padding: "12px", fontSize: 14, borderRadius: 10 }}>▶ Start Match</button>
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

  if (authLoading) return <div style={{ padding: 40, textAlign: "center", fontFamily: "system-ui" }}>Loading…</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#0a1628", color: "#1a1a2e", fontFamily: "'Inter','Segoe UI',system-ui,-apple-system,sans-serif" }}>
      <header style={{ background: "linear-gradient(135deg,#050d1a 0%,#0a1628 50%,#0d1f3a 100%)", color: "#fff", padding: 0, position: "relative", overflow: "hidden", borderBottom: "1px solid #1a3050" }}>
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
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg,#00b8ff,#0066ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, boxShadow: "0 4px 16px rgba(0,184,255,0.4)" }}>🏸</div>
            <div>
              <div className="font-display" style={{ fontSize: 20, fontWeight: 700, letterSpacing: 1, color: "#fff", lineHeight: 1 }}>BADMINTON<span style={{ color: "#00b8ff" }}>LIVE</span></div>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 2, color: "#64748b", textTransform: "uppercase", marginTop: 2 }}>Tournament Center</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {isAdmin ? (
              <>
                <span style={{ fontSize: 11, color: "#00d4ff", background: "rgba(0,184,255,0.1)", padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(0,184,255,0.3)", fontWeight: 600, letterSpacing: 0.5 }}>● {email}</span>
                <button onClick={() => setShowAdminManager(true)} title="Manage admins" style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#cbd5e1", cursor: "pointer", fontSize: 12, fontWeight: 600, letterSpacing: 0.5 }}>👥 ADMINS</button>
                <button onClick={signOut} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#cbd5e1", cursor: "pointer", fontSize: 12, fontWeight: 600, letterSpacing: 0.5 }}>SIGN OUT</button>
              </>
            ) : (
              <button onClick={() => setShowLogin(true)} style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: "linear-gradient(135deg,#00b8ff,#0066ff)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", boxShadow: "0 2px 12px rgba(0,184,255,0.4)" }}>Admin Sign In</button>
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
                <div className="font-display" style={{ fontSize: 32, fontWeight: 700, color: c, lineHeight: 1 }}>{String(v).padStart(2, "0")}</div>
                <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 4, fontWeight: 600 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <nav style={{ display: "flex", justifyContent: "center", gap: 4, paddingTop: 6, background: "#0a1628", borderBottom: "1px solid #1a3050", flexWrap: "wrap", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }}>
        {tabBtn("live", "Live", "🔴")}
        {tabBtn("matches", "Matches", "🗓️")}
        {tabBtn("register", "Players", "📋")}
        {tabBtn("profiles", "Profiles", "👤")}
        {tabBtn("teams", "Teams", "🤝")}
        {phase !== "none" && tabBtn("groups", "Groups", "📊")}
        {phase === "knockout" && tabBtn("knockout", "Knockout", "⚔️")}
        {tabBtn("scoreboard", "Scoreboard", "🏅")}
        {isAdmin && tabBtn("categories", "Categories", "🏷️")}
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
          <Suspense fallback={<div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Loading...</div>}>
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
          <Suspense fallback={<div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Loading...</div>}>
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

        {current && tab === "register" && (() => {
          const filteredPlayers = currentCategoryId
            ? players.filter(p => playerCategoryMap.get(p.id)?.has(currentCategoryId!))
            : players;
          return (
          <div>
            {/* Category filter */}
            <CategoryFilter categories={categories} currentCategoryId={currentCategoryId} onSelect={setCurrentCategoryId} />

            {/* Add player with category checkboxes */}
            {isAdmin && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                  <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addPlayer()} placeholder="Enter new player name..." style={{ flex: 1, minWidth: 220, padding: "12px 16px", borderRadius: 12, border: "2px solid #e2e8f0", background: "#fff", fontSize: 15, outline: "none" }} />
                  <button onClick={addPlayer} style={{ ...btn(), padding: "12px 24px", fontSize: 15 }}>+ Add Player</button>
                </div>
                {categories.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1 }}>ASSIGN TO:</span>
                    {categories.map(c => (
                      <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, border: addPlayerCats.has(c.id) ? "2px solid #3A86FF" : "1px solid #e2e8f0", background: addPlayerCats.has(c.id) ? "#eff6ff" : "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, color: addPlayerCats.has(c.id) ? "#3A86FF" : "#475569" }}>
                        <input type="checkbox" checked={addPlayerCats.has(c.id)} onChange={e => {
                          const next = new Set(addPlayerCats);
                          e.target.checked ? next.add(c.id) : next.delete(c.id);
                          setAddPlayerCats(next);
                        }} style={{ accentColor: "#3A86FF" }} />
                        {c.team_size === 1 ? "👤" : "👥"} {c.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Player list */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
              {filteredPlayers.map((p, i) => {
                const pCats = playerCategoryMap.get(p.id);
                const isEditingCats = editingPlayerCats === p.id;
                return (
                <div key={p.id} style={{ background: "#fff", borderRadius: 14, padding: 16, display: "flex", alignItems: "center", gap: 14, border: "1px solid #e8ecf1", opacity: p.active ? 1 : 0.4, boxShadow: "0 2px 8px rgba(0,0,0,0.03)", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: p.color, borderRadius: "0 4px 4px 0" }} />
                  <div style={{ position: "relative", cursor: isAdmin ? "pointer" : "default", marginLeft: 4 }} onClick={() => isAdmin && fileRefs.current[p.id]?.click()}>
                    <Av name={p.name} photo={p.photo_url} sz={64} color={p.color} />
                    {isAdmin && <div style={{ position: "absolute", bottom: -1, right: -1, background: "#3A86FF", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, border: "2px solid #fff", color: "#fff" }}>📷</div>}
                    <input ref={el => { fileRefs.current[p.id] = el; }} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handlePhoto(p.id, e)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    {editingId === p.id ? (
                      <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} onBlur={() => saveEdit(p.id)} onKeyDown={e => e.key === "Enter" && saveEdit(p.id)} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "2px solid #3A86FF", fontSize: 15, outline: "none" }} />
                    ) : (
                      <div style={{ fontWeight: 700, fontSize: 16, cursor: isAdmin ? "pointer" : "default" }} onClick={() => isAdmin && startEdit(p)}>
                        <span style={{ color: "#94a3b8", marginRight: 6, fontSize: 12, fontWeight: 500 }}>#{i + 1}</span>{p.name}
                      </div>
                    )}
                    {p.note && <div style={{ fontSize: 12, color: "#E63946", marginTop: 3 }}>⚠️ {p.note}</div>}
                    {/* Category badges — clickable for admin to edit */}
                    {isEditingCats ? (
                      <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                        {categories.map(c => {
                          // Read from optimistic local set so the checkbox flips instantly on click.
                          const has = pendingPlayerCats?.has(c.id) ?? false;
                          return (
                            <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: has ? "#eff6ff" : "#f8fafc", color: has ? "#3A86FF" : "#94a3b8", border: has ? "1px solid #bfdbfe" : "1px solid #e2e8f0", cursor: "pointer" }}>
                              <input type="checkbox" checked={has} onChange={async () => {
                                // Optimistic toggle
                                setPendingPlayerCats(prev => {
                                  const next = new Set(prev ?? []);
                                  if (has) next.delete(c.id); else next.add(c.id);
                                  return next;
                                });
                                try {
                                  if (has) await db.removePlayerFromCategory(p.id, c.id);
                                  else await db.addPlayerToCategory(p.id, c.id);
                                } catch (e: any) {
                                  // Revert on failure
                                  setPendingPlayerCats(prev => {
                                    const next = new Set(prev ?? []);
                                    if (has) next.add(c.id); else next.delete(c.id);
                                    return next;
                                  });
                                  toast(e?.message ?? "Failed to update category assignment", "error");
                                }
                              }} style={{ accentColor: "#3A86FF", width: 12, height: 12 }} />
                              {c.name}
                            </label>
                          );
                        })}
                        <button onClick={() => setEditingPlayerCats(null)} style={{ fontSize: 10, padding: "2px 6px", border: "none", background: "transparent", color: "#3A86FF", cursor: "pointer", fontWeight: 700 }}>Done</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                        {pCats && pCats.size > 0 ? [...pCats].map(cid => {
                          const c = catById[cid];
                          return c ? <span key={cid} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "#eff6ff", color: "#3A86FF", border: "1px solid #bfdbfe" }}>{c.name}</span> : null;
                        }) : <span style={{ fontSize: 10, color: "#94a3b8" }}>No category</span>}
                        {isAdmin && <button onClick={() => setEditingPlayerCats(p.id)} style={{ fontSize: 10, padding: "2px 6px", border: "none", background: "transparent", color: "#3A86FF", cursor: "pointer", fontWeight: 700 }}>Edit</button>}
                      </div>
                    )}
                    {paired.has(p.id) && <div style={{ fontSize: 12, color: "#16a34a", marginTop: 3, fontWeight: 600 }}>✓ Team assigned</div>}
                  </div>
                  {isAdmin && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                      <button onClick={() => toggleActive(p.id)} style={{ ...btn(p.active ? "#e2e8f0" : "#2A9D8F", p.active ? "#475569" : "#fff"), padding: "6px 12px", fontSize: 12, borderRadius: 8, boxShadow: "none" }}>{p.active ? "Sit Out" : "Activate"}</button>
                      {p.active && !paired.has(p.id) && unpaired.length >= 2 && (
                        <button onClick={() => openPartnerPicker(p.id)} style={{ ...btn("#3A86FF"), padding: "6px 12px", fontSize: 12, borderRadius: 8 }}>Choose Partner</button>
                      )}
                      <button onClick={() => handleDeletePlayer(p.id)} style={{ ...btn("#dc2626"), padding: "6px 12px", fontSize: 12, borderRadius: 8 }}>Delete</button>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
            {isAdmin && unpaired.length >= 2 && currentCategoryId && <div style={{ textAlign: "center", marginTop: 28 }}><button onClick={autoGen} style={{ ...btn("#2A9D8F"), padding: "14px 36px", fontSize: 16, borderRadius: 14 }}>🎲 Auto-Pair All Players</button></div>}
            {unpaired.length === 1 && currentCategoryId && <div style={{ textAlign: "center", marginTop: 16, padding: 14, background: "#fef3c7", borderRadius: 12, border: "1px solid #fde68a", color: "#92400e", fontSize: 14 }}>⚠️ Odd player out: <strong>{unpaired[0].name}</strong></div>}
          </div>
          );
        })()}

        {current && tab === "profiles" && (() => {
          // Dedicated single-player profile view — shown when a name is clicked in
          // search results, on a player card, or via direct nav.
          if (profileViewPlayerId) {
            const p = players.find(x => x.id === profileViewPlayerId);
            if (!p) {
              // Player not found (deleted?) — fall back to grid.
              setProfileViewPlayerId(null);
              return null;
            }
            return (
              <PlayerProfileView
                player={p}
                allTeams={allTeamsView}
                matches={projectedMatches}
                categories={categories}
                playerCategories={playerCategories}
                groups={groups}
                getStandings={getStandings}
                onBack={() => setProfileViewPlayerId(null)}
                onShowProfile={(pid) => setProfileViewPlayerId(pid)}
              />
            );
          }
          const filteredProfiles = currentCategoryId
            ? players.filter(p => playerCategoryMap.get(p.id)?.has(currentCategoryId!))
            : players;
          return (
          <div>
            <CategoryFilter categories={categories} currentCategoryId={currentCategoryId} onSelect={setCurrentCategoryId} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <span style={{ fontSize: 28 }}>👤</span>
              <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Player Profiles</h2>
              <span style={{ marginLeft: "auto", fontSize: 13, color: "#94a3b8" }}>{isAdmin ? "Click photo to upload, name to edit, or VIEW for full profile" : "Click VIEW for full profile"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 18 }}>
              {filteredProfiles.map((p, i) => (
                <div key={p.id} style={{ background: "#fff", borderRadius: 18, overflow: "hidden", border: "1px solid #e8ecf1", boxShadow: "0 4px 20px rgba(0,0,0,0.06)", opacity: p.active ? 1 : 0.55, position: "relative" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 6, background: p.color }} />
                  <div style={{ padding: "26px 16px 18px", textAlign: "center" }}>
                    <div style={{ position: "relative", display: "inline-block", cursor: isAdmin ? "pointer" : "default" }} onClick={() => isAdmin && fileRefs.current[`prof-${p.id}`]?.click()}>
                      <Av name={p.name} photo={p.photo_url} sz={120} color={p.color} />
                      {isAdmin && <div style={{ position: "absolute", bottom: 4, right: 4, background: "#3A86FF", color: "#fff", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, border: "3px solid #fff", boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}>📷</div>}
                      <input ref={el => { fileRefs.current[`prof-${p.id}`] = el; }} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handlePhoto(p.id, e)} />
                    </div>
                    {editingId === p.id ? (
                      <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} onBlur={() => saveEdit(p.id)} onKeyDown={e => e.key === "Enter" && saveEdit(p.id)} style={{ width: "85%", marginTop: 14, padding: "8px 12px", borderRadius: 8, border: "2px solid #3A86FF", fontSize: 17, outline: "none", textAlign: "center", fontWeight: 700 }} />
                    ) : (
                      <div onClick={() => isAdmin && startEdit(p)} style={{ marginTop: 14, fontSize: 18, fontWeight: 800, cursor: isAdmin ? "pointer" : "default", color: "#1a1a2e" }}>
                        <span style={{ color: "#94a3b8", fontSize: 13, fontWeight: 500, marginRight: 6 }}>#{i + 1}</span>{p.name}
                      </div>
                    )}
                    {p.note && <div style={{ fontSize: 12, color: "#E63946", marginTop: 6, padding: "3px 10px", background: "#fef2f2", borderRadius: 12, display: "inline-block" }}>⚠️ {p.note}</div>}
                    {/* Category badges */}
                    {(() => { const pCats = playerCategoryMap.get(p.id); return pCats && pCats.size > 0 ? (
                      <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap", justifyContent: "center" }}>
                        {[...pCats].map(cid => { const c = catById[cid]; return c ? <span key={cid} style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "#eff6ff", color: "#3A86FF", border: "1px solid #bfdbfe" }}>{c.name}</span> : null; })}
                      </div>
                    ) : null; })()}
                    <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>{p.active ? (paired.has(p.id) ? "✓ On a team" : "Available") : "Inactive"}</div>
                    <button
                      onClick={() => setProfileViewPlayerId(p.id)}
                      style={{ marginTop: 14, width: "100%", padding: "9px 14px", borderRadius: 10, border: "1px solid #3A86FF", background: "transparent", color: "#3A86FF", fontSize: 11, fontWeight: 800, letterSpacing: 1.5, cursor: "pointer", textTransform: "uppercase", transition: "all .15s" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "#3A86FF"; e.currentTarget.style.color = "#fff"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#3A86FF"; }}
                    >
                      View Profile →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          );
        })()}

        {current && tab === "teams" && (
          <div>
            <CategoryFilter categories={categories} currentCategoryId={currentCategoryId} onSelect={setCurrentCategoryId} />
            {isAdmin && phase === "none" && currentCategoryId && invalidTeamsInCategory.length > 0 && (
              <div style={{ background: "linear-gradient(90deg, rgba(239,68,68,0.08), rgba(239,68,68,0.04))", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 12, padding: "14px 18px", marginBottom: 18, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div className="font-display" style={{ fontSize: 12, fontWeight: 800, color: "#ef4444", letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 4 }}>
                    ⚠ {invalidTeamsInCategory.length} invalid team{invalidTeamsInCategory.length === 1 ? "" : "s"} detected
                  </div>
                  <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.4 }}>
                    {invalidTeamsInCategory.length === 1 ? "One team has" : "These teams have"} a player who isn't assigned to <strong>{currentCategory?.name ?? "this category"}</strong>. Likely from an Auto-Pair bug now fixed. Clean them up to restore correct counts.
                  </div>
                </div>
                <button
                  onClick={cleanupInvalidTeams}
                  className="font-display"
                  style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontWeight: 800, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", cursor: "pointer", boxShadow: "0 2px 8px rgba(220,38,38,0.4)" }}
                >
                  Clean Up Invalid Teams
                </button>
              </div>
            )}
            {teamsView.length === 0 ? (
              <div style={{ textAlign: "center", padding: 50, color: "#94a3b8" }}><p>No teams yet.</p></div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 14 }}>
                  {teamsView.map((t, i) => (
                    <div key={t.id} style={{ background: "#fff", borderRadius: 16, padding: 20, border: "1px solid #e8ecf1", boxShadow: "0 4px 16px rgba(0,0,0,0.04)", position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: `linear-gradient(90deg,${t.p1.color},${t.p2?.color ?? t.p1.color})` }} />
                      {isAdmin && phase === "none" && (
                        <button onClick={() => removeTeam(t.id)} title="Remove team" style={{ position: "absolute", top: 10, right: 10, width: 26, height: 26, borderRadius: "50%", border: "none", background: "#fef2f2", color: "#dc2626", cursor: "pointer", fontSize: 16, fontWeight: 700, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                      )}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                        <span style={{ fontWeight: 800, fontSize: 12, color: "#3A86FF", textTransform: "uppercase", letterSpacing: 2 }}>{currentCategory?.team_size === 1 ? `Player ${i + 1}` : `Team ${i + 1}`}</span>
                        {!currentCategoryId && (() => { const c = catById[t.category_id]; return c ? <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "#eff6ff", color: "#3A86FF", border: "1px solid #bfdbfe" }}>{c.name}</span> : null; })()}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                        <Av name={t.p1.name} photo={t.p1.photo_url} sz={40} color={t.p1.color} />
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{t.p1.name}</span>
                      </div>
                      {t.p2 && (<>
                        <div style={{ textAlign: "center", color: "#3A86FF", fontWeight: 900, fontSize: 14, margin: "4px 0", letterSpacing: 2 }}>&amp;</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                          <Av name={t.p2.name} photo={t.p2.photo_url} sz={40} color={t.p2.color} />
                          <span style={{ fontWeight: 700, fontSize: 16 }}>{t.p2.name}</span>
                        </div>
                      </>)}
                    </div>
                  ))}
                </div>
                {isAdmin && teamsView.length >= 2 && phase === "none" && (() => {
                  const formatOptions = recommendFormats(teamsView.length);
                  const selectedPlan = formatOptions.find(o => o.label === selectedFormatLabel) ?? formatOptions[0];
                  const courts = Math.max(1, current.num_courts || 1);
                  const matchMinutes = currentCategory?.match_minutes ?? 12;
                  const handleStart = () => {
                    if (!selectedPlan) return startGroupStage();
                    return startGroupStage({
                      groupsCount: selectedPlan.groupsCount,
                      topNAdvance: selectedPlan.topNAdvance,
                      roundsPerPair: selectedPlan.roundsPerPair,
                    });
                  };
                  const accentFor = (label: FormatPlan["label"]) =>
                    label === "Recommended" ? "#84cc16" :
                    label === "More games" ? "#a855f7" : "#3b82f6";
                  return (
                    <div style={{ marginTop: 32, padding: "26px 28px", background: "linear-gradient(135deg,#1a1a2e,#2d3a5c)", borderRadius: 18, color: "#fff" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
                        <div>
                          <div className="font-display" style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2.5, color: "#93c5fd", textTransform: "uppercase", marginBottom: 4 }}>Tournament Format</div>
                          <div style={{ fontSize: 14, color: "#cbd5e1" }}>Choose how the {teamsView.length} teams will compete.</div>
                        </div>
                        <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "right", lineHeight: 1.6 }}>
                          Estimates assume<br />{courts} court{courts === 1 ? "" : "s"} · {matchMinutes} min/match
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))`, gap: 12, marginBottom: 22 }}>
                        {formatOptions.map(opt => {
                          const selected = opt.label === selectedFormatLabel;
                          const accent = accentFor(opt.label);
                          return (
                            <button
                              key={opt.label}
                              type="button"
                              onClick={() => setSelectedFormatLabel(opt.label)}
                              style={{
                                padding: "14px 16px",
                                borderRadius: 12,
                                border: selected ? `2px solid ${accent}` : "2px solid rgba(255,255,255,0.08)",
                                background: selected ? `${accent}1A` : "rgba(255,255,255,0.03)",
                                color: "#fff",
                                cursor: "pointer",
                                textAlign: "left",
                                transition: "border-color .15s, background .15s",
                                boxShadow: selected ? `0 8px 24px ${accent}33` : "none",
                              }}
                            >
                              <div className="font-display" style={{ fontSize: 11, fontWeight: 800, color: accent, letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                                {selected ? "✓" : "○"} {opt.label}
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 8, lineHeight: 1.35 }}>{describeFormat(opt)}</div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 11, color: "#94a3b8", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
                                <span><strong style={{ color: "#fff", fontSize: 13 }}>{opt.totalMatches}</strong> matches</span>
                                <span>~{opt.estimatedMinutes(matchMinutes, courts)} min</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <button
                          onClick={handleStart}
                          style={{ ...btn("#84cc16"), padding: "16px 44px", fontSize: 17, borderRadius: 14, fontWeight: 800 }}
                        >
                          📊 Start Group Stage
                        </button>
                      </div>
                      {selectedPlan && (
                        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 10, textAlign: "center" }}>
                          {selectedPlan.totalGroupGames} group games + {selectedPlan.totalKnockoutGames} knockout
                          {selectedPlan.knockoutShape !== "RR-only" && selectedPlan.knockoutShape !== "none" && " · top advances per " + (selectedPlan.groupsCount === 1 ? "category" : "group")}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
            {isAdmin && <div style={{ textAlign: "center", marginTop: 20 }}><button onClick={resetAll} style={{ ...btn("#E63946"), padding: "10px 22px", fontSize: 13, borderRadius: 10 }}>🔄 Reset This Tournament</button></div>}
          </div>
        )}

        {current && tab === "groups" && (
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
                <button onClick={startKnockout} style={{ ...btn("#E63946"), padding: "16px 44px", fontSize: 18, borderRadius: 14 }}>⚔️ Start Knockout Stage</button>
              </div>
            )}
          </div>
        )}

        {current && tab === "knockout" && (() => {
          const expectedQualifiers = currentCategory
            ? Math.max(0, (currentCategory.groups_count || groups.length) * (currentCategory.top_n_advance || 2))
            : 0;
          const round1Matches = knockoutMatches.filter(m => m.round_idx === 0);
          const actualQualifiers = round1Matches.reduce(
            (n, m) => n + (m.team_a_id ? 1 : 0) + (m.team_b_id ? 1 : 0), 0,
          );
          return (
          <div>
            <CategoryFilter categories={categories} currentCategoryId={currentCategoryId} onSelect={setCurrentCategoryId} />
            {champion && (
              <div style={{ textAlign: "center", padding: 32, background: "linear-gradient(135deg,#fef3c7,#fde68a,#fef3c7)", borderRadius: 20, border: "3px solid #f59e0b", marginBottom: 28 }}>
                <div style={{ fontSize: 56, marginBottom: 8 }}>🏆</div>
                <div style={{ fontWeight: 900, fontSize: 14, color: "#b45309", textTransform: "uppercase", letterSpacing: 3 }}>Champions</div>
                <div style={{ fontWeight: 900, fontSize: 22, color: "#78350f", marginTop: 10 }}>{champion.p2 ? `${champion.p1.name} & ${champion.p2.name}` : champion.p1.name}</div>
              </div>
            )}
            {!champion && knockoutMatches.length > 0 && (
              <KnockoutSanityBanner
                knockoutMatches={knockoutMatches}
                expectedQualifiers={expectedQualifiers}
                actualQualifiers={actualQualifiers}
              />
            )}
            <div style={{ overflowX: "auto", paddingBottom: 20 }}>
              <div style={{ display: "flex", gap: 0, minWidth: knockout.length * 290 }}>
                {knockout.map((round, ri) => (
                  <div key={ri} style={{ flex: 1, minWidth: 270, display: "flex", flexDirection: "column" }}>
                    <div style={{ textAlign: "center", fontWeight: 800, color: "#1a1a2e", fontSize: 13, textTransform: "uppercase", letterSpacing: 1, padding: "10px 12px", background: "linear-gradient(90deg,#e0e7ff,#ede9fe,#e0e7ff)", borderRadius: 10, margin: "0 8px 16px" }}>
                      {rName(knockout.length, ri)}
                    </div>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-around", gap: 14, padding: "0 8px" }}>
                      {round.map(m => <MatchCard key={m.id} match={m} editable={!m.is_bye} matchMinutes={currentCategory?.match_minutes} />)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          );
        })()}

        {current && tab === "scoreboard" && (
          <div>
            <CategoryFilter categories={categories} currentCategoryId={currentCategoryId} onSelect={setCurrentCategoryId} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <span style={{ fontSize: 28 }}>🏅</span>
              <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Scoreboard</h2>
            </div>
            <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 16px rgba(0,0,0,0.05)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "linear-gradient(90deg,#1a1a2e,#2d3a5c)" }}>
                  {["Rank", "Team", "W", "L", "PF", "PA", "+/-", "Status"].map(h => <th key={h} style={{ padding: "14px 16px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: 1 }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {(() => {
                    const all: Record<string, { team: TeamView; gw: number; gl: number; pf: number; pa: number; status: string }> = {};
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
                    return Object.values(all).sort((a, b) => {
                      if (champion) { if (a.team.id === champion.id) return -1; if (b.team.id === champion.id) return 1; }
                      return (b.gw * 3) - (a.gw * 3) || (b.pf - b.pa) - (a.pf - a.pa);
                    }).map((s, i) => (
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
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {showLogin && <Login onClose={() => setShowLogin(false)} />}
      {showAdminManager && isAdmin && <AdminManager currentEmail={email} onClose={() => setShowAdminManager(false)} />}

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

      <footer style={{ textAlign: "center", padding: "32px 16px", color: "#475569", fontSize: 11, background: "#050d1a", borderTop: "1px solid #1a3050", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>
        <span style={{ color: "#00b8ff" }}>●</span> BADMINTON LIVE · MAY THE BEST TEAM WIN
      </footer>
    </div>
  );
}
// LiveTab extracted to src/components/LiveTab.tsx
