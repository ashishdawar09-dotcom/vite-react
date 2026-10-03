import { norm, teamName } from "./format";
import { buildRulesForTopic, groupLetter } from "./rules";
import { projectSchedule } from "./scheduling";
import { computeStandings } from "./standings";
import type { Match, Player, ProjectedMatch, Snapshot, Team } from "./types";

// Deterministic answers built from live tournament data. The model only picks
// which one to call; it never composes scores or times itself.

function teamsForPlayer(snap: Snapshot, playerId: string): Team[] {
  return snap.teams.filter((t) => t.p1_id === playerId || t.p2_id === playerId);
}

// Exact team name, then exact player name, then partial matches of each.
function resolveNameToTeams(snap: Snapshot, name: string): Team[] {
  const q = norm(name);
  if (!q) return [];
  const exactTeams = snap.teams.filter((t) => norm(t.name) === q);
  if (exactTeams.length) return exactTeams;
  const teamsFromPlayers = (players: Player[]): Team[] => {
    const teams: Team[] = [];
    for (const p of players) {
      for (const t of teamsForPlayer(snap, p.id)) {
        if (!teams.some((x) => x.id === t.id)) teams.push(t);
      }
    }
    return teams;
  };
  const exactPlayers = snap.players.filter((p) => norm(p.name) === q);
  const exactPlayerTeams = teamsFromPlayers(exactPlayers);
  if (exactPlayerTeams.length) return exactPlayerTeams;
  const fuzzyTeams = snap.teams.filter((t) => {
    const n = norm(t.name);
    return n.includes(q) || q.includes(n);
  });
  if (fuzzyTeams.length) return fuzzyTeams;
  const fuzzyPlayers = snap.players.filter((p) => {
    const n = norm(p.name);
    return n.includes(q) || q.includes(n);
  });
  return teamsFromPlayers(fuzzyPlayers);
}

// Live first, then warming up on an allocated court, then the earliest pending.
function pickCurrentOrNext(projected: ProjectedMatch[], teamId: string): ProjectedMatch | null {
  const mine = projected.filter((m) => (m.team_a_id === teamId || m.team_b_id === teamId) && !m.is_bye);
  const live = mine.find((m) => m.status === "live");
  if (live) return live;
  const warming = mine.find((m) => m.status === "pending" && m.court_allocated_at != null);
  if (warming) return warming;
  const pending = mine
    .filter((m) => m.status === "pending")
    .sort((a, b) => (a.projected_start_at ?? "").localeCompare(b.projected_start_at ?? ""));
  if (pending.length) return pending[0];
  return null;
}

function describeMatch(snap: Snapshot, m: ProjectedMatch, teamId: string, self: boolean): string {
  const opponentId = m.team_a_id === teamId ? m.team_b_id : m.team_a_id;
  const vs = opponentId ? ` against ${teamName(snap, opponentId)}` : "";
  const subj = self ? "You" : teamName(snap, teamId);
  const poss = self ? "Your" : `${teamName(snap, teamId)}'s`;
  const areIs = self ? "You're" : `${teamName(snap, teamId)} is`;
  if (m.status === "live") {
    const court = m.court_number != null ? `court ${m.court_number}` : "a court";
    const mins = m.delta_label?.includes("PLAYING") ? ` (${m.delta_label.toLowerCase()})` : "";
    return `${areIs} playing right now on ${court}${vs}${mins}.`;
  }
  if (m.status === "pending" && m.court_allocated_at != null) {
    const court = m.court_number != null ? `court ${m.court_number}` : "a court";
    return self ? `You're up — head to ${court} to warm up${vs}.` : `${subj} are up — on ${court} to warm up${vs}.`;
  }
  if (m.status === "pending") {
    const court = m.court_number ?? m.projected_court;
    const courtStr = court != null ? ` on court ${court}` : "";
    const label = (m.delta_label ?? "").toUpperCase();
    let whenStr: string;
    if (label === "STARTS NOW") whenStr = "starting about now";
    else if (label.startsWith("IN ")) whenStr = `in about ${Math.max(1, Math.round(m.delta_min ?? 0))} minutes`;
    else if (label === "LATER") whenStr = "a while away";
    else whenStr = "coming up";
    return `${poss} next match is ${whenStr}${courtStr}${vs}.`;
  }
  return `${poss} match${vs} is done.`;
}

export function answerMyNextMatch(snap: Snapshot, playerId: string | null, nowMs: number): string {
  if (!playerId) {
    return "I don't know who you are yet. Tell me your name or your team and I'll look it up.";
  }
  const teams = teamsForPlayer(snap, playerId);
  if (!teams.length) return "I couldn't find a team for you in this tournament.";
  const numCourts = snap.tournament?.num_courts ?? 1;
  const { projected } = projectSchedule(snap.matches, snap.categories, numCourts, nowMs);
  const answers = teams.map((t) => {
    const m = pickCurrentOrNext(projected, t.id);
    return m ? describeMatch(snap, m, t.id, true) : `No upcoming matches for ${teamName(snap, t.id)}.`;
  });
  return answers.join(" ");
}

export function answerMatchForName(snap: Snapshot, name: string, nowMs: number): string {
  const teams = resolveNameToTeams(snap, name);
  if (!teams.length) return `I couldn't find anyone or any team matching "${name}".`;
  const numCourts = snap.tournament?.num_courts ?? 1;
  const { projected } = projectSchedule(snap.matches, snap.categories, numCourts, nowMs);
  const answers = teams.slice(0, 2).map((t) => {
    const m = pickCurrentOrNext(projected, t.id);
    const prefix = teams.length > 1 ? `${teamName(snap, t.id)}: ` : "";
    return prefix + (m ? describeMatch(snap, m, t.id, false) : `No upcoming matches for ${teamName(snap, t.id)}.`);
  });
  return answers.join(" ");
}

export function answerLookup(snap: Snapshot, name: string, nowMs: number): string {
  const teams = resolveNameToTeams(snap, name);
  if (!teams.length) return `I couldn't find anyone or any team matching "${name}".`;
  const numCourts = snap.tournament?.num_courts ?? 1;
  const { projected } = projectSchedule(snap.matches, snap.categories, numCourts, nowMs);
  const parts = teams.slice(0, 2).map((t) => {
    const cat = snap.categories.find((c) => c.id === t.category_id)?.name ?? "";
    const played = snap.matches.filter(
      (m) => (m.team_a_id === t.id || m.team_b_id === t.id) && m.confirmed && !m.is_bye,
    );
    let w = 0,
      l = 0;
    const results: string[] = [];
    for (const m of played) {
      const won = m.winner_id === t.id;
      if (won) w++;
      else l++;
      const oppId = m.team_a_id === t.id ? m.team_b_id : m.team_a_id;
      const my = m.team_a_id === t.id ? (m.score_a ?? 0) : (m.score_b ?? 0);
      const op = m.team_a_id === t.id ? (m.score_b ?? 0) : (m.score_a ?? 0);
      results.push(`${won ? "beat" : "lost to"} ${teamName(snap, oppId)} ${my}-${op}`);
    }
    const header = `${teamName(snap, t.id)}${cat ? ` (${cat})` : ""}`;
    const record = played.length
      ? ` — ${w} win${w === 1 ? "" : "s"}, ${l} loss${l === 1 ? "" : "es"}.`
      : " — no matches played yet.";
    const recent = results.length ? ` Recent: ${results.slice(-3).join("; ")}.` : "";
    const next = pickCurrentOrNext(projected, t.id);
    const nextStr = next ? ` ${describeMatch(snap, next, t.id, false)}` : "";
    return `${header}${record}${recent}${nextStr}`;
  });
  return parts.join(" ");
}

export function answerStandings(snap: Snapshot, letter: string, categoryName?: string): string {
  const idx = letter.trim().toUpperCase().charCodeAt(0) - 65;
  if (idx < 0 || idx > 25) return `I didn't catch which group you meant.`;
  let cats = snap.categories;
  if (categoryName) {
    const q = norm(categoryName);
    cats = snap.categories.filter((c) => norm(c.name).includes(q) || q.includes(norm(c.name)));
    if (!cats.length) cats = snap.categories;
  }
  const lines: string[] = [];
  for (const cat of cats) {
    const groupMatches = snap.matches.filter(
      (m) => m.category_id === cat.id && m.stage === "group" && m.group_idx === idx,
    );
    if (!groupMatches.length) continue;
    const teamIds = new Set<string>();
    for (const m of groupMatches) {
      if (m.team_a_id) teamIds.add(m.team_a_id);
      if (m.team_b_id) teamIds.add(m.team_b_id);
    }
    const teams = snap.teams.filter((t) => teamIds.has(t.id));
    const rows = computeStandings(teams, groupMatches);
    const played = groupMatches.some((m) => m.confirmed);
    const scope = cats.length > 1 ? `In ${cat.name}, ` : "";
    if (!played) {
      lines.push(`${scope}no matches in Group ${groupLetter(idx)} have finished yet.`);
      continue;
    }
    const top = rows
      .slice(0, 3)
      .map(
        (r, i) =>
          `${i + 1}. ${teamName(snap, r.team.id)} (${r.pts} point${r.pts === 1 ? "" : "s"}, ${r.w} win${r.w === 1 ? "" : "s"})`,
      );
    const leader = rows[0];
    lines.push(`${scope}${teamName(snap, leader.team.id)} is leading Group ${groupLetter(idx)}. ${top.join("; ")}.`);
  }
  if (!lines.length) return `I couldn't find a Group ${groupLetter(idx)} in this tournament.`;
  return lines.join(" ");
}

export function answerRules(snap: Snapshot, topic?: string): string {
  return buildRulesForTopic(snap, topic);
}

function score(m: Match): string {
  return `${m.score_a ?? 0}-${m.score_b ?? 0}`;
}

export function answerCourts(snap: Snapshot, nowMs: number, court?: number): string {
  const numCourts = snap.tournament?.num_courts ?? 1;
  const { projected } = projectSchedule(snap.matches, snap.categories, numCourts, nowMs);
  const courts =
    court && court >= 1 && court <= numCourts ? [court] : Array.from({ length: numCourts }, (_, i) => i + 1);
  const lines = courts.map((c) => {
    const live = projected.find((m) => m.status === "live" && m.court_number === c);
    if (live)
      return `Court ${c}: ${teamName(snap, live.team_a_id)} vs ${teamName(snap, live.team_b_id)} playing now, ${score(live)}.`;
    const warming = projected.find(
      (m) => m.status === "pending" && m.court_allocated_at != null && m.court_number === c,
    );
    if (warming)
      return `Court ${c}: ${teamName(snap, warming.team_a_id)} vs ${teamName(snap, warming.team_b_id)} warming up.`;
    return `Court ${c} is free.`;
  });
  return lines.join(" ");
}

export function answerResults(snap: Snapshot, limit = 4): string {
  const recent = snap.matches
    .filter((m) => m.confirmed && !m.is_bye)
    .sort((a, b) => (b.confirmed_at ?? "").localeCompare(a.confirmed_at ?? ""))
    .slice(0, limit);
  if (!recent.length) return "No matches have finished yet.";
  const parts = recent.map((m) => {
    const winId = m.winner_id;
    if (!winId) return `${teamName(snap, m.team_a_id)} vs ${teamName(snap, m.team_b_id)} ${score(m)}`;
    const loseId = winId === m.team_a_id ? m.team_b_id : m.team_a_id;
    const ws = winId === m.team_a_id ? (m.score_a ?? 0) : (m.score_b ?? 0);
    const ls = winId === m.team_a_id ? (m.score_b ?? 0) : (m.score_a ?? 0);
    return `${teamName(snap, winId)} beat ${teamName(snap, loseId)} ${ws}-${ls}`;
  });
  return `Recent results: ${parts.join("; ")}.`;
}

export function answerUpcoming(snap: Snapshot, nowMs: number, limit = 4): string {
  const numCourts = snap.tournament?.num_courts ?? 1;
  const { projected } = projectSchedule(snap.matches, snap.categories, numCourts, nowMs);
  const up = projected
    .filter((m) => m.status === "pending" && !m.confirmed && !m.is_bye)
    .sort((a, b) => (a.projected_start_at ?? "").localeCompare(b.projected_start_at ?? ""))
    .slice(0, limit);
  if (!up.length) return "There are no upcoming matches — everything's either playing or done.";
  const parts = up.map((m) => {
    const c = m.court_number ?? m.projected_court;
    const where = c != null ? ` on court ${c}` : "";
    const label = (m.delta_label ?? "").toUpperCase();
    const when =
      label === "STARTS NOW"
        ? " about now"
        : label.startsWith("IN ")
          ? ` in about ${Math.max(1, Math.round(m.delta_min ?? 0))} minutes`
          : label === "LATER"
            ? " later"
            : "";
    return `${teamName(snap, m.team_a_id)} vs ${teamName(snap, m.team_b_id)}${where}${when}`;
  });
  return `Coming up: ${parts.join("; ")}.`;
}

export function answerTournamentInfo(snap: Snapshot): string {
  const t = snap.tournament;
  if (!t) return "I couldn't find the tournament details.";
  const real = snap.matches.filter((m) => !m.is_bye);
  const done = real.filter((m) => m.confirmed).length;
  const stages = snap.categories
    .map(
      (c) =>
        `${c.name} is in the ${c.phase === "knockout" ? "knockout stage" : c.phase === "group" ? "group stage" : "pre-tournament setup"}`,
    )
    .join(", ");
  return `${t.name} has ${snap.players.length} players in ${snap.teams.length} teams on ${t.num_courts} courts. ${done} of ${real.length} matches are complete. ${stages}.`;
}
