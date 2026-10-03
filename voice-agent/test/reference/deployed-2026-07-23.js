// Application logic of the badminton-voice-agent Worker as deployed on 23 July 2026,
// extracted from the compiled bundle via the Cloudflare API on 2 October 2026.
// Kept unmodified (apart from this header and the exports) as the reference for parity.test.ts.
// @ts-nocheck
const __name = (fn) => fn;
// src/snapshot.ts
async function fetchSnapshot(env2, tournamentId) {
  const url2 = `${env2.SUPABASE_URL}/rest/v1/rpc/live_snapshot`;
  const res = await fetch(url2, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env2.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env2.SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({ p_tournament_id: tournamentId })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`live_snapshot ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    tournament: data?.tournament ?? null,
    players: data?.players ?? [],
    teams: data?.teams ?? [],
    matches: data?.matches ?? [],
    categories: data?.categories ?? [],
    player_categories: data?.player_categories ?? [],
    generated_at: data?.generated_at ?? 0
  };
}
__name(fetchSnapshot, "fetchSnapshot");
async function resolveTournamentIdBySlug(env2, slug) {
  const url2 = `${env2.SUPABASE_URL}/rest/v1/tournaments?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`;
  const res = await fetch(url2, {
    headers: {
      apikey: env2.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env2.SUPABASE_ANON_KEY}`
    }
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0]?.id ?? null;
}
__name(resolveTournamentIdBySlug, "resolveTournamentIdBySlug");

// src/standings.ts
function computeStandings(teams, matches) {
  const rows = /* @__PURE__ */ new Map();
  for (const t2 of teams) {
    rows.set(t2.id, { team: t2, w: 0, l: 0, pts: 0, pf: 0, pa: 0 });
  }
  for (const m of matches) {
    if (!m.confirmed || m.is_bye) continue;
    if (!m.team_a_id || !m.team_b_id) continue;
    const a2 = rows.get(m.team_a_id);
    const b = rows.get(m.team_b_id);
    if (!a2 || !b) continue;
    const sa = m.score_a ?? 0;
    const sb = m.score_b ?? 0;
    a2.pf += sa;
    a2.pa += sb;
    b.pf += sb;
    b.pa += sa;
    if (m.winner_id === m.team_a_id) {
      a2.w++;
      b.l++;
      a2.pts += 3;
    } else if (m.winner_id === m.team_b_id) {
      b.w++;
      a2.l++;
      b.pts += 3;
    }
  }
  return [...rows.values()].sort(
    (a2, b) => b.pts - a2.pts || b.pf - b.pa - (a2.pf - a2.pa) || b.pf - a2.pf
  );
}
__name(computeStandings, "computeStandings");

// src/scheduling.ts
var MIN = 6e4;
function parseT(s2) {
  if (!s2) return null;
  const n2 = new Date(s2).getTime();
  return Number.isFinite(n2) ? n2 : null;
}
__name(parseT, "parseT");
function fmtDelta(min) {
  const m = Math.round(min);
  if (Math.abs(m) < 1) return "ON TIME";
  if (m < 0) return `${-m} MIN AHEAD`;
  return `${m} MIN BEHIND`;
}
__name(fmtDelta, "fmtDelta");
function adaptiveMatchMinutes(matches, categoryId, fallback) {
  const completed = matches.filter(
    (m) => m.category_id === categoryId && m.confirmed && !m.is_walkover && !m.is_bye && m.started_at && m.confirmed_at
  );
  if (completed.length < 3) return fallback;
  const recent = [...completed].sort((a2, b) => (b.confirmed_at ?? "").localeCompare(a2.confirmed_at ?? "")).slice(0, 5);
  const weights = recent.map((_, i2) => recent.length - i2);
  const sumW = weights.reduce((a2, b) => a2 + b, 0);
  const weighted = recent.reduce((sum, m, i2) => {
    const dur = (new Date(m.confirmed_at).getTime() - new Date(m.started_at).getTime()) / MIN;
    return sum + dur * weights[i2];
  }, 0) / sumW;
  return Math.max(2, Math.min(60, weighted));
}
__name(adaptiveMatchMinutes, "adaptiveMatchMinutes");
function projectSchedule(matches, categories, numCourts, nowMs) {
  const now = nowMs;
  if (matches.length === 0) {
    return {
      projected: [],
      byId: {},
      tournamentDeltaMin: 0,
      tournamentDeltaLabel: fmtDelta(0),
      liveByCourt: {}
    };
  }
  const projected = [];
  const byCat = /* @__PURE__ */ new Map();
  for (const m of matches) {
    const arr = byCat.get(m.category_id) ?? [];
    arr.push(m);
    byCat.set(m.category_id, arr);
  }
  let tournamentDeltaSum = 0;
  let tournamentDeltaCount = 0;
  for (const cat of categories) {
    const ms = (byCat.get(cat.id) ?? []).slice().sort((a2, b) => {
      const stageOrder = a2.stage === "group" ? 0 : 1;
      const stageOrderB = b.stage === "group" ? 0 : 1;
      if (stageOrder !== stageOrderB) return stageOrder - stageOrderB;
      const ai = a2.stage === "group" ? a2.group_idx ?? 0 : a2.round_idx ?? 0;
      const bi = b.stage === "group" ? b.group_idx ?? 0 : b.round_idx ?? 0;
      if (ai !== bi) return ai - bi;
      const aq = a2.queue_position ?? a2.slot_idx;
      const bq = b.queue_position ?? b.slot_idx;
      return aq - bq;
    });
    const startsAt = parseT(cat.starts_at);
    const baseStart = Math.max(startsAt ?? now, now);
    const queues = Array.from({ length: Math.max(1, numCourts) }, () => baseStart);
    const nominalMatchMin = cat.match_minutes || 12;
    const matchMin = adaptiveMatchMinutes(matches, cat.id, nominalMatchMin);
    for (const m of ms) {
      const startedAt = parseT(m.started_at);
      const confirmedAt = parseT(m.confirmed_at);
      const scheduledAt = parseT(m.scheduled_at);
      let projected_start_at = m.scheduled_at;
      let delta_min = null;
      let delta_label = "";
      let projected_court = m.court_number ?? null;
      if (m.confirmed && confirmedAt && scheduledAt) {
        const scheduledFinish = scheduledAt + matchMin * MIN;
        const d2 = (confirmedAt - scheduledFinish) / MIN;
        delta_min = d2;
        delta_label = m.is_walkover ? "WALKOVER" : d2 > 1 ? `${Math.round(d2)}M LATE` : d2 < -1 ? `${Math.round(-d2)}M EARLY` : "ON TIME";
        if (m.court_number != null && m.court_number >= 1 && m.court_number <= queues.length) {
          queues[m.court_number - 1] = Math.max(queues[m.court_number - 1], confirmedAt);
        }
        projected_start_at = m.scheduled_at;
        tournamentDeltaSum += d2;
        tournamentDeltaCount++;
      } else if (m.status === "live" && startedAt) {
        const totalMin = (cat.match_minutes || 12) + (m.extended_minutes ?? 0);
        const expectedFinish = startedAt + totalMin * MIN;
        const elapsed = (now - startedAt) / MIN;
        delta_min = elapsed - totalMin;
        delta_label = elapsed > totalMin + 1 ? `${Math.round(elapsed - totalMin)}M OVER` : `${Math.round(elapsed)}M PLAYING`;
        if (m.court_number != null && m.court_number >= 1 && m.court_number <= queues.length) {
          queues[m.court_number - 1] = Math.max(queues[m.court_number - 1], Math.max(now, expectedFinish));
        }
        projected_start_at = m.started_at;
      } else if (m.status === "pending" && !m.confirmed) {
        let courtIdx = 0;
        for (let i2 = 1; i2 < queues.length; i2++) {
          if (queues[i2] < queues[courtIdx]) courtIdx = i2;
        }
        const start = Math.max(queues[courtIdx], now);
        projected_start_at = new Date(start).toISOString();
        queues[courtIdx] = start + matchMin * MIN;
        delta_min = (start - now) / MIN;
        if (m.court_number == null && !m.is_bye) projected_court = courtIdx + 1;
        if (m.is_bye) {
          delta_label = "BYE";
        } else if (delta_min > 60) {
          delta_label = "LATER";
        } else if (delta_min > 1) {
          delta_label = `IN ${Math.round(delta_min)}M`;
        } else {
          delta_label = "STARTS NOW";
        }
      } else {
        delta_label = m.is_bye ? "BYE" : "";
      }
      projected.push({ ...m, projected_start_at, delta_min, delta_label, projected_court });
    }
  }
  const byId = {};
  for (const p of projected) byId[p.id] = p;
  const liveByCourt = {};
  for (const p of projected) {
    if (p.status === "live" && p.court_number != null) {
      liveByCourt[p.court_number] = p;
    }
  }
  const tournamentDeltaMin = tournamentDeltaCount > 0 ? tournamentDeltaSum / tournamentDeltaCount : 0;
  return { projected, byId, tournamentDeltaMin, tournamentDeltaLabel: fmtDelta(tournamentDeltaMin), liveByCourt };
}
__name(projectSchedule, "projectSchedule");

// src/rules.ts
function groupLetter(idx) {
  return String.fromCharCode(65 + idx);
}
__name(groupLetter, "groupLetter");
function observedGroupCount(snap, categoryId) {
  const idxs = /* @__PURE__ */ new Set();
  for (const m of snap.matches) {
    if (m.category_id === categoryId && m.stage === "group" && m.group_idx != null) {
      idxs.add(m.group_idx);
    }
  }
  return idxs.size;
}
__name(observedGroupCount, "observedGroupCount");
function describeCategory(snap, cat) {
  const kind = cat.team_size === 1 ? "singles" : "doubles (teams of two)";
  const parts = [`${cat.name}: ${kind}, ${cat.match_minutes}-minute matches`];
  if (cat.age_band) parts.push(`${cat.age_band} age band`);
  const groups = observedGroupCount(snap, cat.id) || cat.groups_count;
  if (cat.phase === "knockout") {
    parts.push("currently in the knockout stage");
  } else if (groups > 0) {
    const advance = cat.top_n_advance > 0 ? `top ${cat.top_n_advance} of each group advance` : "top teams of each group advance";
    const letters = Array.from({ length: groups }, (_, i2) => groupLetter(i2)).join(", ");
    parts.push(`${groups} group${groups > 1 ? "s" : ""} (${letters}), then a knockout bracket; ${advance}`);
  } else {
    parts.push("group stage then a knockout bracket");
  }
  if (cat.has_bronze_match) parts.push("with a third-place playoff");
  return parts.join(", ") + ".";
}
__name(describeCategory, "describeCategory");
var STATIC_RULES = [
  "Scoring in the group stage: 3 points for a win, 0 for a loss \u2014 there are no draws.",
  "Group standings are ranked by total points; ties are broken first by point differential (points scored minus points conceded), then by total points scored.",
  "A bye counts as no match played and does not affect standings. A walkover awards the win to the present team.",
  "Match flow: a match is queued, then a court is allocated and the teams warm up, then scoring begins, and finally the result is confirmed.",
  "After the group stage, the top teams from each group advance to a single-elimination knockout bracket to decide the winner."
].join(" ");
function buildRules(snap) {
  const cats = [...snap.categories].sort((a2, b) => a2.sort_order - b.sort_order);
  const catLines = cats.map((c) => describeCategory(snap, c)).join(" ");
  const name = snap.tournament?.name ?? "this tournament";
  const courts = snap.tournament?.num_courts ? ` It runs on ${snap.tournament.num_courts} courts.` : "";
  return `${name} categories: ${catLines} ${STATIC_RULES}${courts}`;
}
__name(buildRules, "buildRules");
function buildRulesForTopic(snap, topic) {
  if (topic) {
    const t2 = topic.toLowerCase();
    const match = snap.categories.find((c) => c.name.toLowerCase().includes(t2) || t2.includes(c.name.toLowerCase()));
    if (match) {
      return `${describeCategory(snap, match)} ${STATIC_RULES}`;
    }
  }
  return buildRules(snap);
}
__name(buildRulesForTopic, "buildRulesForTopic");

// src/format.ts
function norm(s2) {
  return s2.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}
__name(norm, "norm");
function teamName(snap, teamId) {
  if (!teamId) return "TBD";
  const t2 = snap.teams.find((x) => x.id === teamId);
  if (!t2) return "TBD";
  const p1 = snap.players.find((p) => p.id === t2.p1_id)?.name;
  const p2 = t2.p2_id ? snap.players.find((p) => p.id === t2.p2_id)?.name : null;
  if (p1 && p2) return `${p1} & ${p2}`;
  if (p1) return p1;
  return t2.name;
}
__name(teamName, "teamName");

// src/tools.ts
function teamsForPlayer(snap, playerId) {
  return snap.teams.filter((t2) => t2.p1_id === playerId || t2.p2_id === playerId);
}
__name(teamsForPlayer, "teamsForPlayer");
function resolveNameToTeams(snap, name) {
  const q = norm(name);
  if (!q) return [];
  const exactTeams = snap.teams.filter((t2) => norm(t2.name) === q);
  if (exactTeams.length) return exactTeams;
  const teamsFromPlayers = /* @__PURE__ */ __name((players) => {
    const teams = [];
    for (const p of players) {
      for (const t2 of teamsForPlayer(snap, p.id)) {
        if (!teams.some((x) => x.id === t2.id)) teams.push(t2);
      }
    }
    return teams;
  }, "teamsFromPlayers");
  const exactPlayers = snap.players.filter((p) => norm(p.name) === q);
  const exactPlayerTeams = teamsFromPlayers(exactPlayers);
  if (exactPlayerTeams.length) return exactPlayerTeams;
  const fuzzyTeams = snap.teams.filter((t2) => {
    const n2 = norm(t2.name);
    return n2.includes(q) || q.includes(n2);
  });
  if (fuzzyTeams.length) return fuzzyTeams;
  const fuzzyPlayers = snap.players.filter((p) => {
    const n2 = norm(p.name);
    return n2.includes(q) || q.includes(n2);
  });
  return teamsFromPlayers(fuzzyPlayers);
}
__name(resolveNameToTeams, "resolveNameToTeams");
function pickCurrentOrNext(projected, teamId) {
  const mine = projected.filter(
    (m) => (m.team_a_id === teamId || m.team_b_id === teamId) && !m.is_bye
  );
  const live = mine.find((m) => m.status === "live");
  if (live) return live;
  const warming = mine.find((m) => m.status === "pending" && m.court_allocated_at != null);
  if (warming) return warming;
  const pending = mine.filter((m) => m.status === "pending").sort((a2, b) => (a2.projected_start_at ?? "").localeCompare(b.projected_start_at ?? ""));
  if (pending.length) return pending[0];
  return null;
}
__name(pickCurrentOrNext, "pickCurrentOrNext");
function describeMatch(snap, m, teamId, self2) {
  const opponentId = m.team_a_id === teamId ? m.team_b_id : m.team_a_id;
  const vs = opponentId ? ` against ${teamName(snap, opponentId)}` : "";
  const subj = self2 ? "You" : teamName(snap, teamId);
  const poss = self2 ? "Your" : `${teamName(snap, teamId)}'s`;
  const areIs = self2 ? "You're" : `${teamName(snap, teamId)} is`;
  if (m.status === "live") {
    const court = m.court_number != null ? `court ${m.court_number}` : "a court";
    const mins = m.delta_label?.includes("PLAYING") ? ` (${m.delta_label.toLowerCase()})` : "";
    return `${areIs} playing right now on ${court}${vs}${mins}.`;
  }
  if (m.status === "pending" && m.court_allocated_at != null) {
    const court = m.court_number != null ? `court ${m.court_number}` : "a court";
    return self2 ? `You're up \u2014 head to ${court} to warm up${vs}.` : `${subj} are up \u2014 on ${court} to warm up${vs}.`;
  }
  if (m.status === "pending") {
    const court = m.court_number ?? m.projected_court;
    const courtStr = court != null ? ` on court ${court}` : "";
    const label = (m.delta_label ?? "").toUpperCase();
    let whenStr;
    if (label === "STARTS NOW") whenStr = "starting about now";
    else if (label.startsWith("IN ")) whenStr = `in about ${Math.max(1, Math.round(m.delta_min ?? 0))} minutes`;
    else if (label === "LATER") whenStr = "a while away";
    else whenStr = "coming up";
    return `${poss} next match is ${whenStr}${courtStr}${vs}.`;
  }
  return `${poss} match${vs} is done.`;
}
__name(describeMatch, "describeMatch");
function answerMyNextMatch(snap, playerId, nowMs) {
  if (!playerId) {
    return "I don't know who you are yet. Tell me your name or your team and I'll look it up.";
  }
  const teams = teamsForPlayer(snap, playerId);
  if (!teams.length) return "I couldn't find a team for you in this tournament.";
  const numCourts = snap.tournament?.num_courts ?? 1;
  const { projected } = projectSchedule(snap.matches, snap.categories, numCourts, nowMs);
  const answers = teams.map((t2) => {
    const m = pickCurrentOrNext(projected, t2.id);
    return m ? describeMatch(snap, m, t2.id, true) : `No upcoming matches for ${teamName(snap, t2.id)}.`;
  });
  return answers.join(" ");
}
__name(answerMyNextMatch, "answerMyNextMatch");
function answerMatchForName(snap, name, nowMs) {
  const teams = resolveNameToTeams(snap, name);
  if (!teams.length) return `I couldn't find anyone or any team matching "${name}".`;
  const numCourts = snap.tournament?.num_courts ?? 1;
  const { projected } = projectSchedule(snap.matches, snap.categories, numCourts, nowMs);
  const answers = teams.slice(0, 2).map((t2) => {
    const m = pickCurrentOrNext(projected, t2.id);
    const prefix = teams.length > 1 ? `${teamName(snap, t2.id)}: ` : "";
    return prefix + (m ? describeMatch(snap, m, t2.id, false) : `No upcoming matches for ${teamName(snap, t2.id)}.`);
  });
  return answers.join(" ");
}
__name(answerMatchForName, "answerMatchForName");
function answerLookup(snap, name, nowMs) {
  const teams = resolveNameToTeams(snap, name);
  if (!teams.length) return `I couldn't find anyone or any team matching "${name}".`;
  const numCourts = snap.tournament?.num_courts ?? 1;
  const { projected } = projectSchedule(snap.matches, snap.categories, numCourts, nowMs);
  const parts = teams.slice(0, 2).map((t2) => {
    const cat = snap.categories.find((c) => c.id === t2.category_id)?.name ?? "";
    const played = snap.matches.filter(
      (m) => (m.team_a_id === t2.id || m.team_b_id === t2.id) && m.confirmed && !m.is_bye
    );
    let w = 0, l = 0;
    const results = [];
    for (const m of played) {
      const won = m.winner_id === t2.id;
      if (won) w++;
      else l++;
      const oppId = m.team_a_id === t2.id ? m.team_b_id : m.team_a_id;
      const my = m.team_a_id === t2.id ? m.score_a ?? 0 : m.score_b ?? 0;
      const op = m.team_a_id === t2.id ? m.score_b ?? 0 : m.score_a ?? 0;
      results.push(`${won ? "beat" : "lost to"} ${teamName(snap, oppId)} ${my}-${op}`);
    }
    const header = `${teamName(snap, t2.id)}${cat ? ` (${cat})` : ""}`;
    const record2 = played.length ? ` \u2014 ${w} win${w === 1 ? "" : "s"}, ${l} loss${l === 1 ? "" : "es"}.` : " \u2014 no matches played yet.";
    const recent = results.length ? ` Recent: ${results.slice(-3).join("; ")}.` : "";
    const next = pickCurrentOrNext(projected, t2.id);
    const nextStr = next ? ` ${describeMatch(snap, next, t2.id, false)}` : "";
    return `${header}${record2}${recent}${nextStr}`;
  });
  return parts.join(" ");
}
__name(answerLookup, "answerLookup");
function answerStandings(snap, letter, categoryName2) {
  const idx = letter.trim().toUpperCase().charCodeAt(0) - 65;
  if (idx < 0 || idx > 25) return `I didn't catch which group you meant.`;
  let cats = snap.categories;
  if (categoryName2) {
    const q = norm(categoryName2);
    cats = snap.categories.filter((c) => norm(c.name).includes(q) || q.includes(norm(c.name)));
    if (!cats.length) cats = snap.categories;
  }
  const lines = [];
  for (const cat of cats) {
    const groupMatches = snap.matches.filter(
      (m) => m.category_id === cat.id && m.stage === "group" && m.group_idx === idx
    );
    if (!groupMatches.length) continue;
    const teamIds = /* @__PURE__ */ new Set();
    for (const m of groupMatches) {
      if (m.team_a_id) teamIds.add(m.team_a_id);
      if (m.team_b_id) teamIds.add(m.team_b_id);
    }
    const teams = snap.teams.filter((t2) => teamIds.has(t2.id));
    const rows = computeStandings(teams, groupMatches);
    const played = groupMatches.some((m) => m.confirmed);
    const scope = cats.length > 1 ? `In ${cat.name}, ` : "";
    if (!played) {
      lines.push(`${scope}no matches in Group ${groupLetter(idx)} have finished yet.`);
      continue;
    }
    const top = rows.slice(0, 3).map((r2, i2) => `${i2 + 1}. ${teamName(snap, r2.team.id)} (${r2.pts} point${r2.pts === 1 ? "" : "s"}, ${r2.w} win${r2.w === 1 ? "" : "s"})`);
    const leader = rows[0];
    lines.push(`${scope}${teamName(snap, leader.team.id)} is leading Group ${groupLetter(idx)}. ${top.join("; ")}.`);
  }
  if (!lines.length) return `I couldn't find a Group ${groupLetter(idx)} in this tournament.`;
  return lines.join(" ");
}
__name(answerStandings, "answerStandings");
function answerRules(snap, topic) {
  return buildRulesForTopic(snap, topic);
}
__name(answerRules, "answerRules");
function score(m) {
  return `${m.score_a ?? 0}-${m.score_b ?? 0}`;
}
__name(score, "score");
function answerCourts(snap, nowMs, court) {
  const numCourts = snap.tournament?.num_courts ?? 1;
  const { projected } = projectSchedule(snap.matches, snap.categories, numCourts, nowMs);
  const courts = court && court >= 1 && court <= numCourts ? [court] : Array.from({ length: numCourts }, (_, i2) => i2 + 1);
  const lines = courts.map((c) => {
    const live = projected.find((m) => m.status === "live" && m.court_number === c);
    if (live) return `Court ${c}: ${teamName(snap, live.team_a_id)} vs ${teamName(snap, live.team_b_id)} playing now, ${score(live)}.`;
    const warming = projected.find((m) => m.status === "pending" && m.court_allocated_at != null && m.court_number === c);
    if (warming) return `Court ${c}: ${teamName(snap, warming.team_a_id)} vs ${teamName(snap, warming.team_b_id)} warming up.`;
    return `Court ${c} is free.`;
  });
  return lines.join(" ");
}
__name(answerCourts, "answerCourts");
function answerResults(snap, limit = 4) {
  const recent = snap.matches.filter((m) => m.confirmed && !m.is_bye).sort((a2, b) => (b.confirmed_at ?? "").localeCompare(a2.confirmed_at ?? "")).slice(0, limit);
  if (!recent.length) return "No matches have finished yet.";
  const parts = recent.map((m) => {
    const winId = m.winner_id;
    if (!winId) return `${teamName(snap, m.team_a_id)} vs ${teamName(snap, m.team_b_id)} ${score(m)}`;
    const loseId = winId === m.team_a_id ? m.team_b_id : m.team_a_id;
    const ws = winId === m.team_a_id ? m.score_a ?? 0 : m.score_b ?? 0;
    const ls = winId === m.team_a_id ? m.score_b ?? 0 : m.score_a ?? 0;
    return `${teamName(snap, winId)} beat ${teamName(snap, loseId)} ${ws}-${ls}`;
  });
  return `Recent results: ${parts.join("; ")}.`;
}
__name(answerResults, "answerResults");
function answerUpcoming(snap, nowMs, limit = 4) {
  const numCourts = snap.tournament?.num_courts ?? 1;
  const { projected } = projectSchedule(snap.matches, snap.categories, numCourts, nowMs);
  const up = projected.filter((m) => m.status === "pending" && !m.confirmed && !m.is_bye).sort((a2, b) => (a2.projected_start_at ?? "").localeCompare(b.projected_start_at ?? "")).slice(0, limit);
  if (!up.length) return "There are no upcoming matches \u2014 everything's either playing or done.";
  const parts = up.map((m) => {
    const c = m.court_number ?? m.projected_court;
    const where = c != null ? ` on court ${c}` : "";
    const label = (m.delta_label ?? "").toUpperCase();
    const when = label === "STARTS NOW" ? " about now" : label.startsWith("IN ") ? ` in about ${Math.max(1, Math.round(m.delta_min ?? 0))} minutes` : label === "LATER" ? " later" : "";
    return `${teamName(snap, m.team_a_id)} vs ${teamName(snap, m.team_b_id)}${where}${when}`;
  });
  return `Coming up: ${parts.join("; ")}.`;
}
__name(answerUpcoming, "answerUpcoming");
function answerTournamentInfo(snap) {
  const t2 = snap.tournament;
  if (!t2) return "I couldn't find the tournament details.";
  const real = snap.matches.filter((m) => !m.is_bye);
  const done = real.filter((m) => m.confirmed).length;
  const stages = snap.categories.map((c) => `${c.name} is in the ${c.phase === "knockout" ? "knockout stage" : c.phase === "group" ? "group stage" : "pre-tournament setup"}`).join(", ");
  return `${t2.name} has ${snap.players.length} players in ${snap.teams.length} teams on ${t2.num_courts} courts. ${done} of ${real.length} matches are complete. ${stages}.`;
}
__name(answerTournamentInfo, "answerTournamentInfo");

export { fetchSnapshot, resolveTournamentIdBySlug, computeStandings, projectSchedule, buildRulesForTopic, teamName, answerMyNextMatch, answerMatchForName, answerLookup, answerStandings, answerRules, answerCourts, answerResults, answerUpcoming, answerTournamentInfo };
