// The venue TV's player boards, approved by Ashish on Nov 10, 2026 (design
// canvas "Shuttle Storm TV player cards"): a player spotlight card, a
// match-up of the next pairs to play, and the leader boards.
//
// Plain template strings like the rest of the show: every value goes
// through esc(), and the only numbers placed in style attributes are ones
// worked out here.

import type { TvMatch, TvModel, TvPerson, TvTeam } from "./tvModel";
import { championOf, leadersReady, matchupMatches, nextFor, spotlightPeople, type PersonStats, type TeamStats, type TvStats } from "./tvStats";
import { catStage, teamName } from "./tvNames";
import { ampm, hm } from "./tvTime";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ESC[c]);
const fmtDiff = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0");

/** Says whether a photo link may be shown (the engine drops links that failed to load). */
export type PhotoOk = (url: string) => boolean;

const CAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
const CUP = '<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6h18v11a9 9 0 0 1-18 0z"/><path d="M15 10H8v3a7 7 0 0 0 7 7"/><path d="M33 10h7v3a7 7 0 0 1-7 7"/><path d="M24 26v7"/><path d="M18 33h12v7H18z"/><path d="M14 42h20"/></svg>';
const BOLT = '<svg class="sp-bolt" viewBox="48 26 26 56" aria-hidden="true"><path d="M66 28 L50 56 L60 56 L53 79 L72 48 L62 48 L70 28 Z"/></svg>';
const COURT = '<svg class="sp-court" viewBox="0 0 1100 840" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M300 70 L800 70 L1250 900 L-150 900 Z"/><path d="M337.7 70 L-44.4 900 M762.3 70 L1144.4 900"/><path d="M274.4 117.3 L825.6 117.3 M141.6 362.2 L958.4 362.2 M8.4 607.8 L1091.6 607.8"/><path d="M550 70 L550 362.2 M550 607.8 L550 900"/><path class="net" d="M75 485 L1025 485"/></svg>';
const CTA = `<span class="sp-cta">${CAMERA}Your photo here? Ask at the desk</span>`;

/** "Gurmeet Singh Ghera" → ["Gurmeet Singh", "Ghera"]; a one word name is all surname. */
export function splitName(name: string): [string, string] {
  const n = name.trim().replace(/\s+/g, " ");
  const i = n.lastIndexOf(" ");
  return i < 0 ? ["", n] : [n.slice(0, i), n.slice(i + 1)];
}

/** Up to two capital letters: first and last word. */
export function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  const first = [...w[0]][0] ?? "";
  const last = w.length > 1 ? [...w[w.length - 1]][0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

/**
 * Font size in px so an upper case line of `text` fits `width` px. Oswald
 * capitals run about 0.52 em wide; 0.6 leaves room for wide letters (M, W).
 */
export function fitPx(text: string, maxPx: number, width: number, em = 0.6): number {
  const n = Math.max(1, [...text].length);
  return Math.max(Math.round(maxPx * 0.4), Math.min(maxPx, Math.floor(width / (n * em))));
}

function photoHTML(p: TvPerson | undefined, ok: PhotoOk): { cls: string; html: string } {
  const ini = `<b>${esc(initials(p?.name ?? ""))}</b>`;
  if (p?.photo && ok(p.photo)) return { cls: "", html: `${ini}<img src="${esc(p.photo)}" alt="" decoding="async">` };
  return { cls: " ini", html: ini };
}

const members = (model: TvModel, t: TvTeam | undefined): TvPerson[] =>
  (t?.pids ?? []).map(id => model.people[id]).filter((p): p is TvPerson => !!p);

const otherSide = (m: TvMatch, teamIds: string[]) => (m.a && teamIds.includes(m.a) ? m.b : m.a);

/** The groups line of a singles player, when the event has more than one group. */
function groupOf(model: TvModel, teamId: string): string {
  const t = model.teams[teamId], cat = t ? model.catById[t.category_id] : undefined;
  if (!cat || cat.groups.length < 2) return "";
  const g = cat.groups.find(x => x.teamIds.includes(teamId));
  return g ? `Group ${g.letter}` : "";
}

/* ---------- player spotlight ---------- */

export function spotlightHTML(model: TvModel, stats: TvStats, idx: number, enter: boolean, ok: PhotoOk): string {
  const list = spotlightPeople(stats);
  if (!list.length) return `<div class="sp empty"><p class="muted">Player cards appear here after the first results.</p></div>`;
  const s = list[((idx % list.length) + list.length) % list.length];
  const p = s.person;
  const [first, last] = splitName(p.name);
  const teams = p.teamIds.map(id => model.teams[id]).filter((t): t is TvTeam => !!t)
    .sort((x, y) => (model.catById[x.category_id]?.order ?? 0) - (model.catById[y.category_id]?.order ?? 0));
  const champ = championOf(model, p);
  const rank = stats.ranking.indexOf(s) + 1;
  const photo = photoHTML(p, ok);

  const badge = teams.length >= 2 ? `${teams.length} events`
    : champ ? "Champion"
    : s.played >= 2 && s.lost === 0 ? "Unbeaten"
    : model.catById[teams[0]?.category_id ?? ""]?.short ?? "";

  const rows: string[] = [];
  const evRow = (t: TvTeam) => {
    const cat = model.catById[t.category_id];
    const partner = t.names.find((_, i) => t.pids[i] !== p.id && t.pids.length > 1);
    const v = partner ? `with <b>${esc(partner)}</b>` : esc(groupOf(model, t.id));
    return `<div class="sp-ev"><span class="k">${esc(cat?.name ?? "")}</span><span class="v">${v}</span></div>`;
  };
  if (teams.length <= 3) teams.forEach(t => rows.push(evRow(t)));
  else {
    rows.push(evRow(teams[0]), evRow(teams[1]));
    rows.push(`<div class="sp-ev"><span class="k">Also playing</span><span class="v">${esc(teams.slice(2).map(t => model.catById[t.category_id]?.short ?? "").join(" · "))}</span></div>`);
  }
  if (rows.length < 3 && s.form.length) {
    const f = s.form.slice(-5);
    rows.push(`<div class="sp-ev"><span class="k">${f.length === 1 ? "Last match" : `Last ${f.length} matches`}</span><span class="sp-form">${f.map(r => `<i class="${r === "W" ? "w" : "l"}">${r}</i>`).join("")}</span></div>`);
  }
  if (rows.length < 3 && s.best) {
    rows.push(`<div class="sp-ev"><span class="k">Biggest win</span><span class="v"><b>${s.best.for}–${s.best.against}</b> vs ${esc(teamName(model, s.best.oppTeamId, "fit", 26))}</span></div>`);
  }

  const tiles: [string, string | number, boolean][] = [
    ["Played", s.played, false],
    ["Won", s.won, true],
    ["Points", s.pointsFor, false],
    s.streak >= 2 ? ["Win streak", s.streak, false] : ["Point diff", fmtDiff(s.diff), false],
  ];

  const tag = rank >= 1 && rank <= 3 && s.won > 0 ? ["Rank today", `#${rank} in wins`]
    : champ ? ["Champion", model.catById[champ]?.short ?? ""]
    : null;

  const n2 = fitPx(last.toUpperCase(), 176, 1000);
  const n1 = fitPx(first.toUpperCase(), 96, 1000, 0.56);
  return `<div class="sp${enter ? " fade-in" : ""}">
    <div class="deco"><div class="sp-glow"></div>${COURT}<div class="sp-ghost">${esc(last)}</div><i class="sp-streak one"></i><i class="sp-streak two"></i>${BOLT}<div class="sp-edge"></div></div>
    <div class="sp-photo${photo.cls}">${photo.html}<i class="sp-fade"></i></div>
    ${tag ? `<div class="sp-tag"><span class="k">${esc(tag[0])}</span><span class="v">${esc(tag[1])}</span></div>` : ""}
    <div class="sp-main">
      <div class="sp-chips"><span class="sp-chip solid">Player spotlight</span>${badge ? `<span class="sp-chip line">${esc(badge)}</span>` : ""}${CTA}</div>
      ${first ? `<p class="sp-n1" style="font-size:${n1}px;line-height:${Math.round(n1 * 0.92)}px">${esc(first)}</p>` : ""}
      <p class="sp-n2${first ? "" : " solo"}" style="font-size:${n2}px;line-height:${Math.round(n2 * 0.89)}px">${esc(last)}</p>
      <div class="sp-evs">${rows.join("")}</div>
      <div class="sp-stats">${tiles.map(([k, n, hi]) => `<div class="sp-st${hi ? " hi" : ""}"><span class="k">${k}</span><span class="n">${esc(n)}</span></div>`).join("")}</div>
      ${nextBarHTML(model, p, champ)}
    </div>
  </div>`;
}

function nextBarHTML(model: TvModel, p: TvPerson, champ: string | null): string {
  const m = nextFor(model, p);
  if (m) {
    const opp = otherSide(m, p.teamIds);
    const vs = opp ? `vs <b>${esc(teamName(model, opp, "fit", 30))}</b>` : "";
    if (m.status === "live") return `<div class="sp-next live"><i class="dot pulse"></i><span class="k">Playing now</span><span class="t">Court ${m.court ?? ""}</span><span class="v">${vs}</span></div>`;
    if (m.status === "called") return `<div class="sp-next"><i class="dot call"></i><span class="k">Called</span><span class="t">Court ${m.court ?? ""}</span><span class="v">${vs}</span></div>`;
    return `<div class="sp-next"><i class="dot call"></i><span class="k">Next</span><span class="t">about ${hm(m.eta!)} ${ampm(m.eta!)}</span><span class="v">${vs}</span></div>`;
  }
  if (champ) return `<div class="sp-next won"><span class="sp-cup">${CUP}</span><span class="k">Champion</span><span class="v">${esc(model.catById[champ]?.name ?? "")}</span></div>`;
  return "";
}

/* ---------- match-up ---------- */

export function matchupHTML(model: TvModel, stats: TvStats, idx: number, enter: boolean, ok: PhotoOk): string {
  const list = matchupMatches(model);
  if (!list.length) return `<div class="mu empty"><p class="muted">The next match-up shows here once matches are waiting.</p></div>`;
  const m = list[((idx % list.length) + list.length) % list.length];
  const first = model.queue[0]?.id === m.id;
  const chip = m.status === "called" ? `Now calling · Court ${m.court ?? ""}` : first ? "Up next" : "Coming up";
  const time = m.status === "called" ? "" : m.eta != null ? `about ${hm(m.eta)} ${ampm(m.eta)}` : "";
  const ta: TeamStats | undefined = m.a ? stats.teams[m.a] : undefined;
  const tb: TeamStats | undefined = m.b ? stats.teams[m.b] : undefined;

  const side = (s: "a" | "b", t: TeamStats | undefined) => {
    const ps = members(model, model.teams[m[s] ?? ""]);
    const pls = ps.length ? ps : [{ id: "", name: teamName(model, m[s], "full"), photo: null, teamIds: [] } as TvPerson];
    const cards = pls.map(p => {
      const [fn, ln] = splitName(p.name), ph = photoHTML(p.id ? p : undefined, ok);
      return `<div class="mu-pl"><div class="mu-fr${ph.cls}">${ph.html}<i class="mu-fade"></i></div><i class="mu-bar"></i><p class="mu-fn">${fn ? esc(fn) : "&nbsp;"}</p><p class="mu-ln" style="font-size:${fitPx(ln.toUpperCase(), 54, 330)}px">${esc(ln)}</p></div>`;
    }).join("");
    const rec = !t || !t.played ? `<div class="mu-rec">First match</div>`
      : `<div class="mu-rec"><b>${t.won}–${t.lost}</b>${m.kind === "group" ? "in the group" : "so far"}<b>${fmtDiff(t.diff)}</b>points</div>`;
    return `<div class="mu-side ${s}"><div class="mu-pair">${cards}</div>${rec}</div>`;
  };

  const rowsDef: [string, number, number][] = [["Wins", ta?.won ?? 0, tb?.won ?? 0], ["Points won", ta?.pointsFor ?? 0, tb?.pointsFor ?? 0], ["Win streak", ta?.streak ?? 0, tb?.streak ?? 0]];
  const anyPlayed = (ta?.played ?? 0) + (tb?.played ?? 0) > 0;
  const pct = (v: number, a: number, b: number) => Math.round((v / Math.max(1, a, b)) * 100);
  const h2h = anyPlayed
    ? `<div class="mu-h2h">${rowsDef.map(([k, a, b]) => `<div class="mu-r"><i class="bl" style="width:${pct(a, a, b)}%"></i><span class="va">${a}</span><span class="k">${k}</span><span class="vb">${b}</span><i class="br" style="width:${pct(b, a, b)}%"></i></div>`).join("")}</div>`
    : `<p class="mu-first">First match of the day for both</p>`;

  return `<div class="mu${enter ? " fade-in" : ""}">
    <div class="deco"><div class="mu-bg"></div><div class="mu-seam"></div>${BOLT.replace('class="sp-bolt"', 'class="mu-bolt"')}</div>
    <div class="mu-head"><div class="mu-row"><span class="sp-chip solid">${esc(chip)}</span>${time ? `<span class="mu-time">${esc(time)}</span>` : ""}</div><p class="mu-event">${esc(catStage(model, m))}</p></div>
    ${side("a", ta)}<p class="mu-vs">VS</p>${side("b", tb)}
    ${h2h}
  </div>`;
}

/* ---------- leaders ---------- */

/**
 * A leaders row's events line. Three or more events never fit next to the
 * name ("Mixed Doubles 35+ · Mixed Doubles 18–34 · Men's…" was cut off for a
 * player in four), so they read "4 events"; two long names fall back to the
 * short ones.
 */
export function leaderEvents(cats: { name: string; short: string }[], maxChars = 44): string {
  if (cats.length >= 3) return `${cats.length} events`;
  const full = cats.map(c => c.name).join(" · ");
  return full.length <= maxChars ? full : cats.map(c => c.short).join(" · ");
}

/** Event rows a leaders page holds. */
export const LD_ROWS = 6;
export const leadersPages = (stats: TvStats) => Math.max(1, Math.ceil(stats.eventLeaders.length / LD_ROWS));

export function leadersHTML(model: TvModel, stats: TvStats, page: number, enter: boolean, ok: PhotoOk): string {
  if (!leadersReady(stats)) return `<div class="ld ld-left"><p class="muted">Leaders appear here after a few results.</p></div><div class="ld ld-right"></div>`;
  const top = stats.ranking.slice(0, 5), hero = top[0];
  const cats = (s: PersonStats) => s.person.teamIds.map(id => model.catById[model.teams[id]?.category_id ?? ""]).filter(Boolean);
  const heroCats = cats(hero);
  const ph = photoHTML(hero.person, ok);
  const sub = [`${hero.played} played`, `${hero.pointsFor} points`, hero.streak >= 2 ? `won the last ${hero.streak}` : `${fmtDiff(hero.diff)} points difference`].join(" · ");
  const row = (s: PersonStats, i: number) => {
    const p = photoHTML(s.person, ok);
    return `<div class="ld-row"><span class="n">${i + 2}</span><span class="ld-av${p.cls}">${p.html}</span><span class="ld-who"><b>${esc(s.person.name)}</b><span>${esc(leaderEvents(cats(s).map(c => ({ name: c!.name, short: c!.short }))))}</span></span><span class="w">${s.won}<small>of ${s.played}</small></span><span class="d">${fmtDiff(s.diff)}</span></div>`;
  };

  const pages = leadersPages(stats), pg = ((page % pages) + pages) % pages;
  const evs = stats.eventLeaders.slice(pg * LD_ROWS, pg * LD_ROWS + LD_ROWS);
  const erow = (e: TvStats["eventLeaders"][number]) => {
    const cat = model.catById[e.catId];
    const rc = e.champion ? `<span class="rc champ">${CUP}Champions</span>` : `<span class="rc"><b>${e.won}–${e.lost}</b><span>${fmtDiff(e.diff)}</span></span>`;
    return `<div class="ld-er"><span class="k">${esc(cat?.name ?? "")}</span><span class="t">${esc(teamName(model, e.teamId, "fit", 26))}</span>${rc}</div>`;
  };

  return `<div class="ld ld-left${enter ? " fade-in" : ""}">
      <div class="ld-h"><div class="ld-hl"><span class="sp-chip solid">Storm leaders</span><h2>Most wins today</h2></div><span>after ${stats.results} matches</span></div>
      <div class="ld-hero">
        <div class="ld-fr${ph.cls}">${ph.html}</div>
        <div class="ld-mid"><span class="ld-rk">No. 1 · ${esc(heroCats.length >= 2 ? `${heroCats.length} events` : heroCats[0]?.short ?? "")}</span><span class="ld-nm" style="font-size:${fitPx(hero.person.name.toUpperCase(), 76, 530, 0.5)}px">${esc(hero.person.name)}</span><span class="ld-sub">${esc(sub)}</span></div>
        <div class="ld-big"><b>${hero.won}</b><span>${hero.won === 1 ? "win" : "wins"}</span></div>
      </div>
      <div class="ld-list">${top.slice(1).map(row).join("")}</div>
      <p class="ld-cta">${CAMERA}Players with a photo get it here. Ask at the desk</p>
    </div>
    <div class="ld ld-right${enter ? " fade-in" : ""}">
      <div class="ld-h"><div class="ld-hl"><h2>Leading each event</h2></div><span>wins · points</span></div>
      <div class="ld-evl">${evs.map(erow).join("")}</div>
      ${pages > 1 ? `<div class="ld-pager"><span>Page ${pg + 1} of ${pages}</span><span class="ld-dots">${Array.from({ length: pages }, (_, k) => `<i class="${k === pg ? "on" : ""}"></i>`).join("")}</span></div>` : ""}
    </div>`;
}
