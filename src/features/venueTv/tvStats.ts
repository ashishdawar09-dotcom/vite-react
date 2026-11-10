// Player and team numbers for the venue TV's player cards, match-ups and
// leader boards, worked out from the finished matches in one TV model.
//
// The counting follows the Groups tab: a walkover is a win or a loss but
// has no rally points, and a best-of-3 match adds up the points of its
// games. Pure functions only, so they can be tested without a browser.

import type { TvMatch, TvModel, TvPerson } from "./tvModel";

export type Result = "W" | "L";

type Tally = {
  played: number;
  won: number;
  lost: number;
  /** Rally points won and lost. Walkovers add none. */
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  /** Wins in a row, counting back from the latest result. */
  streak: number;
  /** Results in the order they happened. */
  form: Result[];
};

export type TeamStats = Tally & { teamId: string; catId: string };

export type PersonStats = Tally & {
  person: TvPerson;
  /** The widest winning margin in a match that was played (not a walkover). */
  best: { matchId: string; for: number; against: number; oppTeamId: string } | null;
};

export type EventLeader = { catId: string; teamId: string; won: number; lost: number; diff: number; champion: boolean };

export type TvStats = {
  teams: Record<string, TeamStats>;
  people: Record<string, PersonStats>;
  /** Everyone with a result, most wins first, then point difference, then fewer matches. */
  ranking: PersonStats[];
  /** The team leading each event that has a result, in event order. A decided event shows its champion. */
  eventLeaders: EventLeader[];
  /** Finished matches counted. */
  results: number;
};

/** Each side's points in a finished match, or null when there are none to count (a walkover, or no scores entered). */
export function matchPoints(m: TvMatch): [number, number] | null {
  if (m.walkover) return null;
  if (m.bestOf3) {
    if (!m.games.length) return null;
    return m.games.reduce<[number, number]>((s, [x, y]) => [s[0] + x, s[1] + y], [0, 0]);
  }
  const [a, b] = m.cur;
  return a || b ? [a, b] : null;
}

/** A match that counts: finished, not cancelled, both sides known and one of them the winner. */
export function counts(m: TvMatch): boolean {
  return m.status === "done" && !m.cancelled && !!m.a && !!m.b && !!m.winner && (m.winner === m.a || m.winner === m.b);
}

const emptyTally = (): Tally => ({ played: 0, won: 0, lost: 0, pointsFor: 0, pointsAgainst: 0, diff: 0, streak: 0, form: [] });

function add(t: Tally, won: boolean, pf: number, pa: number) {
  t.played++;
  if (won) { t.won++; t.streak++; } else { t.lost++; t.streak = 0; }
  t.pointsFor += pf;
  t.pointsAgainst += pa;
  t.diff = t.pointsFor - t.pointsAgainst;
  t.form.push(won ? "W" : "L");
}

/** Most wins first, then the better point difference, then fewer matches played. */
function better(x: Tally, y: Tally): number {
  return y.won - x.won || y.diff - x.diff || x.played - y.played;
}

export function buildStats(model: TvModel): TvStats {
  const done = model.matches.filter(counts).sort((x, y) => (x.doneAt ?? 0) - (y.doneAt ?? 0) || x.id.localeCompare(y.id));
  const teams: Record<string, TeamStats> = {};
  const people: Record<string, PersonStats> = {};

  for (const m of done) {
    const pts = matchPoints(m);
    for (const side of ["a", "b"] as const) {
      const tid = m[side]!, opp = m[side === "a" ? "b" : "a"]!, won = m.winner === tid;
      const pf = pts ? pts[side === "a" ? 0 : 1] : 0, pa = pts ? pts[side === "a" ? 1 : 0] : 0;
      const ts = (teams[tid] ??= { ...emptyTally(), teamId: tid, catId: model.teams[tid]?.category_id ?? m.cat });
      add(ts, won, pf, pa);
      for (const pid of model.teams[tid]?.pids ?? []) {
        const person = model.people[pid];
        if (!person) continue;
        const ps = (people[pid] ??= { ...emptyTally(), person, best: null });
        add(ps, won, pf, pa);
        if (won && pts && pf - pa > 0 && pf - pa > (ps.best ? ps.best.for - ps.best.against : 0)) {
          ps.best = { matchId: m.id, for: pf, against: pa, oppTeamId: opp };
        }
      }
    }
  }

  const ranking = Object.values(people).sort((x, y) => better(x, y) || x.person.name.localeCompare(y.person.name));

  const eventLeaders: EventLeader[] = [];
  for (const c of model.categories) {
    const inCat = Object.values(teams).filter(t => t.catId === c.id && t.played > 0);
    if (!inCat.length) continue;
    const champ = c.champion ? teams[c.champion] ?? null : null;
    const top = c.champion
      ? { teamId: c.champion, won: champ?.won ?? 0, lost: champ?.lost ?? 0, diff: champ?.diff ?? 0 }
      : [...inCat].sort((x, y) => better(x, y) || x.teamId.localeCompare(y.teamId))[0];
    eventLeaders.push({ catId: c.id, teamId: top.teamId, won: top.won, lost: top.lost, diff: top.diff, champion: !!c.champion });
  }

  return { teams, people, ranking, eventLeaders, results: done.length };
}

/** People for the player spotlight: those with a photo first (it is what the board is for), then the best records. */
export function spotlightPeople(stats: TvStats, max = 12): PersonStats[] {
  return [...stats.ranking]
    .sort((x, y) => (y.person.photo ? 1 : 0) - (x.person.photo ? 1 : 0) || better(x, y) || x.person.name.localeCompare(y.person.name))
    .slice(0, max);
}

/** Matches for the match-up board: courts being called first, then the queue in calling order. */
export function matchupMatches(model: TvModel, max = 3): TvMatch[] {
  const called = model.courts
    .filter((m): m is TvMatch => !!m && m.status === "called" && !!m.a && !!m.b)
    .sort((x, y) => (x.calledAt ?? 0) - (y.calledAt ?? 0));
  return [...called, ...model.queue].slice(0, max);
}

/** The leader boards need a few results before they mean anything. */
export const LEADERS_MIN_RESULTS = 4;
export const leadersReady = (stats: TvStats) => stats.results >= LEADERS_MIN_RESULTS && stats.ranking.length >= 3;

/** A person's next match across all their events: on court first, then called, then the earliest waiting. */
export function nextFor(model: TvModel, person: TvPerson): TvMatch | null {
  const mine = model.matches.filter(m => !m.cancelled && ((m.a && person.teamIds.includes(m.a)) || (m.b && person.teamIds.includes(m.b))));
  return (
    mine.find(m => m.status === "live" && !m.ending) ??
    mine.find(m => m.status === "called") ??
    mine.filter(m => m.status === "queued" && m.a && m.b && m.eta != null).sort((x, y) => (x.eta ?? 0) - (y.eta ?? 0))[0] ??
    null
  );
}

/** The event a person has won, if any. */
export function championOf(model: TvModel, person: TvPerson): string | null {
  return model.categories.find(c => c.champion && person.teamIds.includes(c.champion))?.id ?? null;
}
