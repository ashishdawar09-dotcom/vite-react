import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  composeEmail, decide, evaluate, planLag,
  type MonCategory, type MonInput, type MonMatch, type MonPlayer, type MonTeam,
} from "./race_monitor.ts";

const MIN = 60_000;
/** A time at the venue (UTC-7) on race day, "9:20" → ms. */
const at = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return Date.parse("2026-11-21T00:00:00Z") + ((h + 7) * 60 + m) * MIN;
};
const iso = (hm: string) => new Date(at(hm)).toISOString();

function cat(id: string, sort: number, over: Partial<MonCategory> = {}): MonCategory {
  return { id, name: id.toUpperCase(), sort_order: sort, starts_at: iso("9:00"), match_minutes: 15, groups_count: 2, top_n_advance: 1, team_size: 2, ...over };
}
let n = 0;
const teams: MonTeam[] = [];
const players: MonPlayer[] = [];
/** A match between two new teams in `catId`. */
function match(catId: string, over: Partial<MonMatch> = {}): MonMatch {
  const tid = () => {
    const id = `t${++n}`;
    players.push({ id: `${id}p1`, name: `${id} One`, active: true }, { id: `${id}p2`, name: `${id} Two`, active: true });
    teams.push({ id, category_id: catId, p1_id: `${id}p1`, p2_id: `${id}p2` });
    return id;
  };
  return {
    id: `m${++n}`, category_id: catId, stage: "group", group_idx: 0, round_idx: null, is_bronze: false, is_bye: false, status: "pending",
    confirmed: false, team_a_id: tid(), team_b_id: tid(), court_number: null, court_allocated_at: null, started_at: null, confirmed_at: null,
    best_of: 1, extended_minutes: 0, ...over,
  };
}
const live = (catId: string, court: number, startedHm: string, over: Partial<MonMatch> = {}) =>
  match(catId, { status: "live", court_number: court, court_allocated_at: iso(startedHm), started_at: iso(startedHm), ...over });
const called = (catId: string, court: number, calledHm: string) => match(catId, { court_number: court, court_allocated_at: iso(calledHm) });
const done = (catId: string, court: number, doneHm: string, over: Partial<MonMatch> = {}) =>
  match(catId, { status: "completed", confirmed: true, court_number: court, started_at: iso(doneHm), confirmed_at: iso(doneHm), ...over });

/** The day with just these matches: only their teams are entered (plus `extraTeams`). */
function input(nowHm: string, matches: MonMatch[], over: Partial<MonInput> & { extraTeams?: MonTeam[] } = {}): MonInput {
  const { extraTeams = [], ...rest } = over;
  const mine = teams.filter((x) => matches.some((m) => m.team_a_id === x.id || m.team_b_id === x.id));
  return {
    now: at(nowHm), numCourts: 4, categories: [cat("a", 1), cat("b", 2, { starts_at: iso("10:00") })], matches,
    teams: [...mine, ...extraTeams], players, singles: [], plan: null, ...rest,
  };
}
const keys = (i: MonInput) => evaluate(i).alerts.map((a) => a.key).sort();

Deno.test("an empty court with a match that could go on is flagged after 5 minutes", () => {
  const ms = [live("a", 1, "9:10"), live("a", 2, "9:10"), called("a", 4, "9:18"), match("a")];
  assertEquals(keys(input("9:04", ms)), []);
  const r = evaluate(input("9:20", ms));
  assertEquals(r.alerts.map((a) => a.key), ["empty:3"]);
  assertStringIncludes(r.alerts[0].title, "Court 3 has been empty for 20 min");
  assertEquals(r.courts.length, 4);
  assertStringIncludes(r.courts[2], "Court 3: empty for 20 min");
});

Deno.test("an empty court is fine when nothing could go on: players busy, or the event hasn't started", () => {
  const busy = live("a", 1, "9:10");
  const sameTeams = match("a", { team_a_id: busy.team_a_id, team_b_id: busy.team_b_id });
  assertEquals(keys(input("9:20", [busy, sameTeams])), []);
  // Event b starts at 10:00.
  assertEquals(keys(input("9:30", [live("a", 1, "9:20"), match("b")])), []);
  assertEquals(keys(input("10:06", [live("a", 1, "10:00"), match("b")])).filter((k) => k.startsWith("empty:")).length, 3);
});

Deno.test("an empty court counts from its last result", () => {
  const ms = [done("a", 3, "9:40"), live("a", 1, "9:30"), live("a", 2, "9:30"), live("a", 4, "9:30"), match("a")];
  assertEquals(keys(input("9:43", ms)), []);
  assertEquals(keys(input("9:46", ms)), ["empty:3"]);
});

Deno.test("a sitting-out team's match doesn't count as one that could go on", () => {
  const m = match("a");
  const ms = [live("a", 1, "9:10"), live("a", 2, "9:10"), live("a", 3, "9:10"), m];
  const p = players.find((x) => x.id === `${m.team_a_id}p1`)!;
  p.active = false;
  assertEquals(keys(input("9:20", ms)), []);
  p.active = true;
  assertEquals(keys(input("9:20", ms)), ["empty:4"]);
});

Deno.test("a called match not started after 8 minutes is flagged", () => {
  const ms = [called("a", 1, "9:00"), live("a", 2, "9:00"), live("a", 3, "9:00"), live("a", 4, "9:00")];
  assertEquals(keys(input("9:07", ms)), []);
  const r = evaluate(input("9:09", ms));
  assertEquals(r.alerts.map((a) => a.key), [`called:${ms[0].id}`]);
  assertStringIncludes(r.alerts[0].detail, "Begin Scoring");
});

Deno.test("a match running 10+ minutes over its planned length is flagged; best of 3 gets double", () => {
  const one = live("a", 1, "9:00");
  const bo3 = live("a", 2, "9:00", { best_of: 3 });
  const ms = [one, bo3, live("a", 3, "9:20"), live("a", 4, "9:20")];
  assertEquals(keys(input("9:24", ms)), []);
  assertEquals(keys(input("9:25", ms)), [`long:${one.id}`]);
  assertEquals(keys(input("9:40", ms)).sort(), [`long:${bo3.id}`, `long:${one.id}`].sort());
});

Deno.test("groups done with no knockout is flagged 3 minutes after the last group result; never for a round robin", () => {
  const busyCourts = [live("b", 1, "10:00"), live("b", 2, "10:00"), live("b", 3, "10:00"), live("b", 4, "10:00")];
  const groups = [done("a", 1, "9:50"), done("a", 2, "9:55")];
  assertEquals(keys(input("9:57", [...groups, ...busyCourts])), []);
  assertEquals(keys(input("10:05", [...groups, ...busyCourts])), ["ko:a"]);
  const rr = input("10:05", [...groups, ...busyCourts], { categories: [cat("a", 1, { groups_count: 1, top_n_advance: 0 }), cat("b", 2)] });
  assertEquals(keys(rr), []);
  const ko = match("a", { stage: "knockout", group_idx: null, round_idx: 0, team_a_id: null, team_b_id: null });
  assertEquals(keys(input("10:05", [...groups, ko, ...busyCourts])), []);
});

Deno.test("an event starting within 30 minutes with entries but no draw is flagged", () => {
  const ms = [live("a", 1, "9:20"), live("a", 2, "9:20"), live("a", 3, "9:20"), live("a", 4, "9:20")];
  const extraTeams = [{ id: "bx1", category_id: "b", p1_id: "x1", p2_id: "x2" }, { id: "bx2", category_id: "b", p1_id: "x3", p2_id: "x4" }];
  assertEquals(keys(input("9:25", ms, { extraTeams })), []);
  const r = evaluate(input("9:31", ms, { extraTeams }));
  assertEquals(r.alerts.map((a) => a.key), ["nodraw:b"]);
  assertStringIncludes(r.alerts[0].detail, "starts at 10:00 am");
  // One entry can't be drawn: no alert.
  assertEquals(keys(input("9:31", ms, { extraTeams: extraTeams.slice(0, 1) })), []);
});

Deno.test("the main event's final waits while other events still have matches", () => {
  const final = match("b", { stage: "knockout", group_idx: null, round_idx: 1 });
  const semi = done("b", 1, "18:50", { stage: "knockout", group_idx: null, round_idx: 0 });
  const other = live("a", 2, "18:55");
  const plan = { ends: [], finale_category_id: "b" };
  assertEquals(keys(input("19:00", [final, semi, other, live("a", 3, "18:55"), live("a", 4, "18:55"), live("a", 1, "18:59")], { plan })), ["finale"]);
  assertEquals(keys(input("19:00", [final, semi], { plan })).filter((k) => k === "finale"), []);
});

Deno.test("plan lag: behind past the next planned finish, ahead before the last reached one", () => {
  const ends = [at("9:20"), at("9:20"), at("9:40"), at("10:00")];
  assertEquals(planLag(ends, 0, at("9:10")), 0);
  assertEquals(planLag(ends, 0, at("9:30")), 10);
  assertEquals(planLag(ends, 2, at("9:30")), 0);
  assertEquals(planLag(ends, 3, at("9:30")), -10);
  assertEquals(planLag(ends, 4, at("10:20")), 0);
});

Deno.test("behind plan is flagged at 20 minutes and clears under 10; after 3 pm a late finish brings the finals tip", () => {
  const ends = Array.from({ length: 10 }, (_, k) => iso(`9:${String(10 + k * 5).padStart(2, "0")}`));
  const plan = { ends, finish_by: iso("10:00") };
  const busy = [live("a", 1, "9:30"), live("a", 2, "9:30"), live("a", 3, "9:30"), live("a", 4, "9:30")];
  assertEquals(keys(input("9:29", busy, { plan })), []); // 19 min behind
  assertEquals(keys(input("9:31", busy, { plan })), ["behind"]); // 21 min
  const closer = [done("a", 1, "9:20"), done("a", 1, "9:22"), ...busy];
  assertEquals(keys(input("9:31", closer, { plan, openKeys: ["behind"] })), ["behind"]); // 11 min, still flagged
  assertEquals(keys(input("9:31", closer, { plan })), []); // not flagged before, under 20
  // 3:30 pm: far behind and past the finish target.
  const late = input("15:30", [live("a", 1, "15:20"), live("a", 2, "15:20"), live("a", 3, "15:20"), live("a", 4, "15:20")], { plan });
  assertEquals(keys(late), ["behind", "late-finish"]);
  assertStringIncludes(evaluate(late).alerts[1].detail, "Best of 3 games from → Never");
});

Deno.test("decide: a new alert emails now, a known one waits for the 30-minute status, and the end is emailed once", () => {
  const result = (alertKeys: string[], allDone = false) => ({
    alerts: alertKeys.map((key) => ({ key, title: key, detail: "" })), courts: [], done: 0, total: 4, lagMin: null, planEnd: null, allDone,
  });
  const d1 = decide(result(["empty:3"]), {}, at("9:20"));
  assertEquals([d1.send, d1.kind, d1.fresh.length], [true, "alert", 1]);
  const d2 = decide(result(["empty:3"]), d1.state, at("9:30"));
  assertEquals([d2.send, d2.kind], [false, null]);
  const d3 = decide(result(["empty:3", "called:m9"]), d2.state, at("9:40"));
  assertEquals([d3.send, d3.kind, d3.fresh.map((a) => a.key)], [true, "alert", ["called:m9"]]);
  const d4 = decide(result(["empty:3", "called:m9"]), d3.state, at("10:10"));
  assertEquals([d4.send, d4.kind, d4.fresh.length], [true, "status", 0]);
  // Gone, then back: emailed again.
  const quiet = decide(result([]), d4.state, at("10:20"));
  assertEquals([quiet.send, quiet.state.sent], [false, {}]);
  assertEquals(decide(result(["empty:3"]), quiet.state, at("10:30")).kind, "alert");
  // Every match done: one last email, then nothing.
  const end = decide(result([], true), quiet.state, at("19:15"));
  assertEquals([end.send, end.kind], [true, "done"]);
  assertEquals(decide(result([], true), end.state, at("19:25")).send, false);
});

Deno.test("every match done, including finals: a knockout still to start isn't the end", () => {
  const rr = [cat("a", 1, { groups_count: 1, top_n_advance: 0 })];
  assert(evaluate(input("19:15", [done("a", 1, "19:00"), done("a", 2, "19:10")], { categories: rr })).allDone);
  const groupsOnly = evaluate(input("19:15", [done("a", 1, "19:00"), done("a", 2, "19:10")], { categories: [cat("a", 1)] }));
  assertEquals(groupsOnly.allDone, false);
});

Deno.test("the email: subject by kind, the alerts, plan line and courts, names escaped", () => {
  const ms = [live("a", 1, "9:10", {}), live("a", 2, "9:10"), called("a", 4, "9:18"), match("a")];
  players.find((p) => p.id === `${ms[0].team_a_id}p1`)!.name = "Sam <b>";
  const r = evaluate(input("9:20", ms));
  const alert = composeEmail(r, { tournament: "Shuttle Storm", now: at("9:20"), kind: "alert", fresh: r.alerts });
  assertStringIncludes(alert.subject, "⚠ Court 3 has been empty for 20 min · Shuttle Storm");
  assertStringIncludes(alert.text, "NEEDS YOU NOW");
  assertStringIncludes(alert.text, "[new] Court 3 has been empty");
  assertStringIncludes(alert.text, "no day plan loaded");
  assertStringIncludes(alert.html, "Sam &lt;b&gt;");
  const status = composeEmail(r, { tournament: "Shuttle Storm", now: at("9:20"), kind: "test", fresh: [] });
  assertStringIncludes(status.subject, "[Test] Desk check 9:20 am:");
  assertStringIncludes(status.subject, "1 to act on");
});
