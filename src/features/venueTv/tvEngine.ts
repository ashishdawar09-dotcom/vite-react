// The venue TV show: four designs that take turns like a screensaver, each
// with its own boards rotating inside it, an announcement line across the
// top and a moving score strip along the bottom. Nobody touches the TV.
//
// Ported from the approved design page (Code Claude/tv-board). It draws
// into its own DOM subtree with plain template strings (every value goes
// through esc()), patches scores in place, and only animates with CSS and
// the Web Animations API (no per frame JavaScript).

import "./tvShow.css";
import { bracketOf, standingsOf, type TvCategory, type TvMatch, type TvModel } from "./tvModel";
import { annList, callItem, deskItem, matchPointItem, CALL_WINDOW_MIN, type AnnItem } from "./tvAnnouncements";
import { catStage, shortPersonName, shortStage, sideLabel, sideNames, teamName, type NameMode } from "./tvNames";
import { ampm, hm } from "./tvTime";
import { createTvFilm, filmAllowed, FILM_SRC } from "./tvFilm";
import { buildStats, leadersReady, matchupMatches, spotlightPeople, type TvStats } from "./tvStats";
import { leadersHTML, matchupHTML, spotlightHTML } from "./tvCards";

export type DesignKey = "rotation" | "pinned" | "floorhome" | "sportstv";
export const DESIGN_ORDER: DesignKey[] = ["rotation", "pinned", "floorhome", "sportstv"];
export const DESIGN_NAMES: Record<DesignKey, string> = { rotation: "Rotation", pinned: "Everything pinned", floorhome: "Floor home", sportstv: "Sports TV" };

export type TvShowOptions = {
  /** One design only (a second TV); otherwise all four take turns. */
  design: DesignKey | null;
  /** How long each design runs before the next takes over. */
  eachMs: number;
  /** Server corrected clock. */
  now: () => number;
  /** "badminton.adawar.org/t/shuttle-storm", shown under the scan code. */
  siteUrl: string;
  /** Inline SVG of the scan code for the public page. */
  qrSvg: string;
};

export type TvShow = {
  update(model: TvModel): void;
  destroy(): void;
  /** Test hooks (used with ?debug=1). */
  debug: {
    goto(design: DesignKey, scene: number): string;
    sceneCount(): number;
    /** Turn one of a dashboard's own rotations (slide, page, chan, dep, feat, q). */
    turn(k: string): Record<string, number>;
    state(): Record<string, unknown>;
    setInstant(v: boolean): void;
    /** Play the film now (true if it started). */
    film(): boolean;
    filmStop(): void;
    check(): string[][];
  };
};

const MIN = 60_000;
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ESC[c]);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const LOGO = '<svg viewBox="6 6 108 108" aria-hidden="true"><path d="M16 78 A46 46 0 0 1 50 15" fill="none" stroke="#829C28" stroke-width="5" stroke-linecap="round"/><path d="M104 42 A46 46 0 0 1 70 105" fill="none" stroke="#829C28" stroke-width="5" stroke-linecap="round"/><g transform="rotate(32 60 60)"><path d="M33 24 L87 24 L71 82 L49 82 Z" fill="none" stroke="#D4FF3A" stroke-width="5" stroke-linejoin="round"/><path d="M66 28 L50 56 L60 56 L53 79 L72 48 L62 48 L70 28 Z" fill="#D4FF3A"/><circle cx="60" cy="94" r="12" fill="#D4FF3A"/></g></svg>';
const TROPHY = '<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6h18v11a9 9 0 0 1-18 0z"/><path d="M15 10H8v3a7 7 0 0 0 7 7"/><path d="M33 10h7v3a7 7 0 0 1-7 7"/><path d="M24 26v7"/><path d="M18 33h12v7H18z"/><path d="M14 42h20"/></svg>';
const MEGAPHONE = '<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20v8h7l15 9V11l-15 9z"/><path d="M35 18a8 8 0 0 1 0 12"/><path d="M14 28l3 11h5l-2-9"/></svg>';
const COURT_SVG = '<svg class="mc-lines" viewBox="0 0 134 61" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="1" width="132" height="59"/><line x1="1" y1="5.6" x2="133" y2="5.6"/><line x1="1" y1="55.4" x2="133" y2="55.4"/><line x1="8.6" y1="1" x2="8.6" y2="60"/><line x1="125.4" y1="1" x2="125.4" y2="60"/><line x1="47.2" y1="1" x2="47.2" y2="60"/><line x1="86.8" y1="1" x2="86.8" y2="60"/><line x1="1" y1="30.5" x2="47.2" y2="30.5"/><line x1="86.8" y1="30.5" x2="133" y2="30.5"/></g><line class="net" x1="67" y1="0" x2="67" y2="61" stroke-width="4"/></svg>';
const ART_SVG = COURT_SVG.replace('class="mc-lines"', 'class="art"');
/** Shuttle Storm '26 sponsors, from the tournament website. */
const SPONSORS = ["Abbotsford Dental Centre", "IBJ Cafe Burgers &amp; Boba", "Kirti Law Corporation", "Novelty Physiotherapy &amp; Wellness", "Pizza 24", "The Polly Fox Bakery &amp; Bistro"];

// pl, mu and ld turn the player spotlight, match-up and leaders boards.
type Counters = { slide: number; q: number; feat: number; page: number; chan: number; dep: number; pl: number; mu: number; ld: number };
type Ctx = { v: Counters; enter: boolean };
type PartFn = (ctx: Ctx) => string;
type DashKey = "courtside" | "floor" | "broadcast" | "departures" | "finder" | "channels" | "spotlight" | "matchup" | "leaders";
type ViewDef = { layout: () => string; parts: Record<string, PartFn>; rot: Partial<Record<keyof Counters, number>> };
type Scene = { v?: DashKey; name?: string; k?: string; home?: boolean; feat?: boolean; dur: number };
type ShowDef = { layout: () => string; parts: Record<string, PartFn>; scenes: () => Scene[] };

function gameOver(a: number, b: number, to: number, cap: number) { const hi = Math.max(a, b), lo = Math.min(a, b); return (hi >= to && hi - lo >= 2) || hi >= cap; }

export function createTvShow(stageEl: HTMLElement, opts: TvShowOptions): TvShow {
  const RM = window.matchMedia("(prefers-reduced-motion: reduce)");
  const now = opts.now;
  let M: TvModel | null = null;
  let instant = false;
  let destroyed = false;
  const N = () => (M ? M.tournament.numCourts : 4);
  const layoutCourts = () => { const n = N(); return n <= 4 ? 4 : n <= 6 ? 6 : 8; };
  const QR = `<div class="qr">${opts.qrSvg}</div>`;
  const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = stageEl) => r.querySelector<T>(s);
  const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = stageEl) => Array.from(r.querySelectorAll<T>(s));

  /* ---------- small helpers ---------- */
  const courtMatch = (c: number): TvMatch | null => (M ? M.courts[c - 1] ?? null : null);
  const leadOf = (m: TvMatch) => (m.cur[0] > m.cur[1] ? "a" : m.cur[1] > m.cur[0] ? "b" : "");
  const elapsed = (m: TvMatch) => (m.startedAt ? `${Math.max(0, Math.floor((now() - m.startedAt) / MIN))} min` : "Live");
  const callLeft = (m: TvMatch) => Math.max(0, CALL_WINDOW_MIN - Math.floor((now() - (m.calledAt ?? now())) / MIN));
  const liveState = (m: TvMatch | null) => (!m ? "free" : m.status === "called" ? "called" : "live");
  const nameMode = (): "lines" | "last" => (N() <= 4 ? "lines" : "last");
  const fmtDiff = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0");
  function ago(t: number | null) { if (!t) return ""; const d = Math.floor((now() - t) / MIN); return d < 1 ? "Just now" : d < 60 ? `${d} min ago` : `${hm(t)} ${ampm(t)}`; }
  function pointBadge(m: TvMatch): { text: string; cls: string } | null {
    if (m.ending) return { text: "Final score", cls: "soft" };
    if (m.bestOf3 || m.status !== "live") return null;
    const [a, b] = m.cur;
    if (!gameOver(a, b, 21, 30) && (gameOver(a + 1, b, 21, 30) || gameOver(a, b + 1, 21, 30))) return { text: "Match point", cls: "" };
    return null;
  }
  function namesHTML(m: TvMatch, s: "a" | "b", mode: "lines" | "lastlines" | NameMode, max?: number) {
    // Full names, each with a short form that fitNames() swaps in when the full one doesn't fit its box.
    if (m[s] && mode === "lines") return sideNames(M!, m, s).map(n => `<span data-full="${esc(n)}" data-short="${esc(shortPersonName(n))}">${esc(n)}</span>`).join("");
    if (m[s] && mode === "lastlines") return sideNames(M!, m, s, true).map(n => `<span>${esc(n)}</span>`).join("");
    return `<span>${esc(sideLabel(M!, m, s, mode === "lines" || mode === "lastlines" ? "full" : mode, max))}</span>`;
  }
  const scoreOf = (m: TvMatch, s: "a" | "b") => m.cur[s === "a" ? 0 : 1];
  /**
   * A full name that doesn't fit its box ("Gurmeet Singh Ghera" on a court map half)
   * becomes its short form ("G. Ghera") instead of ending in "…". Runs after every render,
   * when Floor home shows its court map again (hidden boxes measure 0) and when fonts load.
   * Every name goes back to its full form first, so a box that has room again shows it.
   */
  function fitNames(root: ParentNode) {
    const els = Array.from(root.querySelectorAll<HTMLElement>(".who span[data-short]"));
    for (const el of els) { const full = el.dataset.full; if (full && el.textContent !== full) el.textContent = full; }
    // All reads after all writes: one layout for the whole set.
    const over = els.filter(el => el.scrollWidth > el.clientWidth + 1);
    for (const el of over) el.textContent = el.dataset.short ?? el.textContent;
  }
  const fontSet = (document as Document & { fonts?: FontFaceSet }).fonts;
  const onFontsLoaded = () => { if (!destroyed) fitNames(stageEl); };
  fontSet?.addEventListener?.("loadingdone", onFontsLoaded);

  /* ---------- player boards: stats once per feed update, photos loaded ahead ---------- */
  let ST: { m: TvModel | null; s: TvStats | null; spot: boolean; mu: boolean; ld: boolean } = { m: null, s: null, spot: false, mu: false, ld: false };
  function stats(): TvStats {
    if (ST.m !== M || !ST.s) {
      const s = buildStats(M!);
      ST = { m: M, s, spot: spotlightPeople(s).length > 0, mu: matchupMatches(M!).length > 0, ld: leadersReady(s) };
    }
    return ST.s!;
  }
  /** A photo that failed to load is dropped, so the card shows initials instead of a broken image. */
  const badPhotos = new Set<string>();
  const photoOk = (url: string) => !badPhotos.has(url);
  const preloaded = new Set<string>();
  function preloadPhotos() {
    if (!M) return;
    const s = stats(), urls: string[] = [];
    for (const p of spotlightPeople(s)) if (p.person.photo) urls.push(p.person.photo);
    for (const p of s.ranking.slice(0, 5)) if (p.person.photo) urls.push(p.person.photo);
    for (const m of matchupMatches(M)) for (const t of [m.a, m.b]) for (const id of M.teams[t ?? ""]?.pids ?? []) { const u = M.people[id]?.photo; if (u) urls.push(u); }
    for (const u of urls) {
      if (preloaded.has(u)) continue;
      preloaded.add(u);
      const im = new Image();
      im.decoding = "async";
      im.onerror = () => { if (destroyed || badPhotos.has(u)) return; badPhotos.add(u); refreshParts(); };
      im.src = u;
    }
  }

  /* ---------- frame: header with announcements, the moving strip ---------- */
  function clockHTML() { const t = now(); return `${hm(t)}<small>${ampm(t)}</small>`; }
  function syncHTML() {
    const g = M?.generatedAt;
    if (!g) return `<i class="dot call"></i><span>Connecting</span>`;
    const s = Math.max(0, Math.round((now() - g) / 1000));
    if (s > 45) return `<i class="dot call"></i><span>Reconnecting · scores from ${hm(g)}</span>`;
    return `<i class="dot ok"></i><span>${s < 8 ? "Updated just now" : `Updated ${s} s ago`}</span>`;
  }
  function showHeader() {
    return `<header class="sh-h"><span class="sh-logo">${LOGO}</span><div class="ann" data-part="ann"></div>
      <div class="sh-ck"><p class="tv-clock" data-clock>${clockHTML()}</p><p class="tv-sync" data-sync>${syncHTML()}</p></div></header>`;
  }
  const stripFrame = () => `<footer class="st"><p class="st-label"><i class="dot pulse"></i>Live scores</p><div class="st-view" data-tk></div><div class="st-next" data-part="stnext"></div></footer>`;

  /* ---------- court tile (all courts dashboard, everything pinned) ---------- */
  function tileHTML(c: number) {
    const m = courtMatch(c), mode = nameMode();
    if (!m) return `<article class="court free" data-court="${c}" data-kind="tile"><div class="court-top"><h3 class="court-n">Court ${c}</h3><span class="state free">Free</span></div><div class="free-body"><b>Ready for the next match</b><span>The desk calls it in a moment</span></div></article>`;
    if (m.status === "called") {
      return `<article class="court called" data-court="${c}" data-kind="tile"><div class="court-top"><h3 class="court-n">Court ${c}</h3><span class="state called">Now calling</span></div>
      <p class="court-meta"><span class="cs">${esc(shortStage(M!, m))}</span></p>
      <div class="call-body"><div class="who">${namesHTML(m, "a", "fit", 22)}</div><p class="vs">vs</p><div class="who">${namesHTML(m, "b", "fit", 22)}</div></div>
      <p class="call-note">Be on court within ${callLeft(m)} min</p></article>`;
    }
    const lead = leadOf(m), badge = pointBadge(m);
    const side = (s: "a" | "b") => `<div class="side${lead === s ? " lead" : ""}"><div class="who">${namesHTML(m, s, mode)}</div><span class="pts" data-s="${s}"><i>${scoreOf(m, s)}</i></span></div>`;
    return `<article class="court live" data-court="${c}" data-kind="tile" data-a="${m.cur[0]}" data-b="${m.cur[1]}">
      <div class="court-top"><h3 class="court-n">Court ${c}</h3>${badge ? `<span class="badge ${badge.cls}">${badge.text}</span>` : `<span class="state"><i class="dot pulse"></i><span class="t">${elapsed(m)}</span></span>`}</div>
      <p class="court-meta"><span class="cs">${esc(shortStage(M!, m))}</span>${m.bestOf3 ? `<span class="unit">${esc(bo3Live(m))}</span>` : ""}</p>
      <div class="sides">${side("a")}${side("b")}</div></article>`;
  }
  const courtsHTML = () => Array.from({ length: N() }, (_, i) => tileHTML(i + 1)).join("");

  /* ---------- up next ---------- */
  /** Whole minutes between the clock times shown on screen, so two matches at "1:17" never say different things. */
  const minsUntil = (t: number) => Math.floor(t / MIN) - Math.floor(now() / MIN);
  /** Beyond this (say, before the first serve on race morning), "in 300 min" reads worse than "Later" next to the clock time. */
  const LATER_MIN = 120;
  function qRowHTML(m: TvMatch, isNext: boolean, max: number) {
    const mins = m.eta != null ? minsUntil(m.eta) : null;
    const rel = isNext ? "Next" : mins == null ? "" : mins <= 1 ? "Soon" : mins > LATER_MIN ? "Later" : `in ${mins} min`;
    return `<div class="q-row${isNext ? " is-next" : ""}"><div class="q-when"><span class="q-time">${m.eta != null ? hm(m.eta) : ""}</span><span class="q-rel">${rel}</span></div>
      <div class="q-what"><p class="q-cat">${esc(shortStage(M!, m))}</p><p class="q-team">${esc(sideLabel(M!, m, "a", "fit", max))}</p><p class="q-team">${esc(sideLabel(M!, m, "b", "fit", max))}</p></div></div>`;
  }
  const QUEUE_SPAN = 12;
  function queueRows() {
    const k = show === "rotation" ? curView : show;
    if (k === "courtside" || k === "pinned") return N() <= 4 ? 2 : 3;
    if (k === "broadcast" || k === "sportstv") return N() <= 4 ? 1 : 0;
    return 3;
  }
  function queueHTML(ctx: Ctx, rowsVisible: number, max: number) {
    const q = M!.queue, first = q[0], rest = q.slice(1, 1 + QUEUE_SPAN);
    const off = rest.length > rowsVisible ? ctx.v.q % rest.length : 0;
    const rows: TvMatch[] = [];
    for (let i = 0; i < Math.min(rest.length, rowsVisible + 1); i++) rows.push(rest[(off + i) % rest.length]);
    return `<div class="panel-h"><h2>Up next</h2><span>${q.length} waiting</span></div>
      ${first ? `<div class="q-next">${qRowHTML(first, true, max)}</div>` : `<p class="muted">Nothing waiting right now</p>`}
      ${rowsVisible ? `<div class="q-window"><ol class="q-list">${rows.map(m => `<li>${qRowHTML(m, false, max)}</li>`).join("")}</ol></div>` : ""}`;
  }

  // Best of 3: "Best of 3 · Game 2" on a live court; the games of a result.
  const bo3Live = (m: TvMatch) => `Best of 3 · Game ${Math.min(3, m.games.length + 1)}`;
  // `flip`: each game from team B's side, for "B beat A 2–1 (15–12, …)".
  const gamesText = (m: TvMatch, flip = false) =>
    m.games.map(([x, y]) => (flip ? `${y}–${x}` : `${x}–${y}`)).join(", ");
  /* ---------- boards: results, tables, brackets, champions ---------- */
  function resultHTML(m: TvMatch) {
    const wa = m.winner === m.a;
    return `<article class="res"><p class="res-cat">${esc(catStage(M!, m))}</p>
      <div class="res-row${wa ? " win" : ""}"><span>${esc(teamName(M!, m.a, "fit", 24))}</span><b>${m.walkover ? "" : m.cur[0]}</b></div>
      <div class="res-row${wa ? "" : " win"}"><span>${esc(teamName(M!, m.b, "fit", 24))}</span><b>${m.walkover ? "" : m.cur[1]}</b></div>
      <p class="res-when">${m.walkover ? "Walkover · " : ""}${m.bestOf3 && m.games.length && !m.walkover ? `${esc(gamesText(m))} · ` : ""}${ago(m.doneAt)}</p></article>`;
  }
  function tableHTML(cat: TvCategory, gIdx: number, max: number, compact: boolean) {
    const g = cat.groups.find(x => x.idx === gIdx);
    const rows = standingsOf(M!, cat.id, gIdx);
    const tight = rows.length > 6;
    return `<table class="tbl${tight ? " tight" : ""}"><caption>${cat.groups.length === 1 ? "Round robin" : `Group ${g?.letter ?? ""}`}</caption>
      <thead><tr><th class="n"></th><th>Team</th>${compact ? "" : `<th class="num w-sm">Played</th>`}<th class="num w-sm">Won</th><th class="num w-sm">+/−</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${cat.advance && i < cat.advance ? "adv" : ""}"><td class="n">${i + 1}</td><td>${esc(teamName(M!, r.teamId, "fit", max))}</td>${compact ? "" : `<td class="num w-sm">${r.played}</td>`}<td class="num w-sm pts-col">${r.won}</td><td class="num w-sm">${fmtDiff(r.diff)}</td></tr>`).join("")}</tbody></table>`;
  }
  function tablesHTML(cat: TvCategory, from: number, compact: boolean) {
    const gs = cat.groups.slice(from, from + 2), two = gs.length > 1;
    const tall = gs.some(g => g.teamIds.length > 6);
    const note = cat.roundRobinOnly ? "The top of the table wins the event." : cat.advance ? `Top ${cat.advance}${cat.groups.length > 1 ? " in each group" : ""} go through to the knockout.` : "";
    return `<div class="tables" style="--n:${Math.max(1, gs.length)}">${gs.map(g => tableHTML(cat, g.idx, two ? (compact ? 18 : 22) : 30, compact && two)).join("")}</div>
      ${note && !tall ? `<p class="tbl-note">${note} Ranked by wins, then point difference.</p>` : ""}`;
  }
  function bmatchHTML(m: TvMatch) {
    const st = m.status;
    const tag = st === "live" ? `<p class="b-tag live"><i class="dot pulse"></i>Live on court ${m.court}</p>` : st === "called" ? `<p class="b-tag called">Called to court ${m.court}</p>` : st === "queued" && m.eta && m.a && m.b ? `<p class="b-tag">About ${hm(m.eta)}</p>` : m.kind === "bronze" ? `<p class="b-tag">Bronze match</p>` : "";
    const row = (s: "a" | "b") => { const won = st === "done" && !!m.winner && m.winner === m[s]; const score = st === "live" || (st === "done" && !m.walkover) ? scoreOf(m, s) : ""; return `<div class="b-row${won ? " win" : ""}"><span>${esc(sideLabel(M!, m, s, "fit", 22))}</span><b>${score}</b></div>`; };
    return `<div class="b-match ${st}">${row("a")}${row("b")}${tag}</div>`;
  }
  function bracketHTML(cat: TvCategory) {
    const cols = bracketOf(M!, cat.id).slice(-3);
    if (!cols.length) return `<p class="muted">The knockout draw comes after the groups.</p>`;
    return `<div class="bracket" style="--n:${cols.length}">${cols.map(col => `<div class="b-col"><p class="b-h">${col.title}</p><div class="b-list">${col.matches.map(bmatchHTML).join("")}</div></div>`).join("")}</div>`;
  }
  function championsHTML(cat: TvCategory) {
    if (!cat.champion) return `<p class="muted">The final is still to come.</p>`;
    const w = M!.teams[cat.champion];
    const how = cat.finalScore ? `Won the final ${cat.finalScore[0]}–${cat.finalScore[1]}` : "Won the round robin";
    return `<div class="champ">${TROPHY}<div><p class="champ-cat">${esc(cat.name)}</p><p class="champ-names">${w.names.map(esc).join(" &amp; ")}</p><p class="champ-sub">${how}${cat.runnerUp ? ` · runners up ${esc(teamName(M!, cat.runnerUp, "full"))}` : ""}</p></div></div>`;
  }
  const sponsorsHTML = () => `<div class="spons"><p class="spons-main"><span>Thank you to our sponsors</span>ADW</p><div class="spons-grid">${SPONSORS.map(s => `<p>${s}</p>`).join("")}</div></div>`;
  const scanHTML = (title?: string) => `<div class="scan">${QR}<div class="scan-t"><h3>${title || "Every court on your phone"}</h3><p>Live scores, the full queue and a search for your own name.</p><span class="url">${esc(opts.siteUrl)}</span></div></div>`;
  function progressHTML() {
    const m = M!;
    const inUse = m.courts.filter(Boolean).length;
    const done = m.categories.filter(c => c.finished).length;
    const frac = m.total ? m.played / m.total : 0;
    return `<div class="prog"><p class="prog-big"><b>${m.played}</b>of ${m.total} matches played</p><div class="bar"><i style="transform:scaleX(${frac.toFixed(3)})"></i></div>
      <dl class="facts"><div><dt>Courts in use</dt><dd>${inUse} of ${m.tournament.numCourts}</dd></div><div><dt>Categories finished</dt><dd>${done} of ${m.categories.length}</dd></div><div><dt>Last match expected</dt><dd>${m.finish ? `About ${hm(m.finish)} ${ampm(m.finish)}` : "All done"}</dd></div></dl></div>`;
  }
  const noticeHTML = () => `<div class="notice">${MEGAPHONE}<p>When your match is called, be on court within ${CALL_WINDOW_MIN} minutes.<span>Then a 3 minute warm up. Matches not started by then are defaulted.</span></p></div>`;

  /* finder pages, shared by the dashboard and the finder boards */
  function playerStatus(p: { teamIds: string[] }): [string, string] {
    const mine = M!.matches.filter(m => (m.a && p.teamIds.includes(m.a)) || (m.b && p.teamIds.includes(m.b)));
    const live = mine.find(m => m.status === "live");
    if (live) return ["live", `<i class="dot pulse"></i>Playing now · Court ${live.court}`];
    const called = mine.find(m => m.status === "called");
    if (called) return ["called", `Called to court ${called.court}`];
    const q = mine.filter(m => m.status === "queued" && m.a && m.b && m.eta != null).sort((x, y) => (x.eta ?? 0) - (y.eta ?? 0))[0];
    if (q) return M!.queue[0]?.id === q.id ? ["next", `Next · ${esc(M!.catById[q.cat]?.short ?? "")}`] : ["queued", `About ${hm(q.eta!)} · ${esc(M!.catById[q.cat]?.short ?? "")}`];
    const champ = M!.categories.find(c => c.champion && p.teamIds.includes(c.champion));
    if (champ) return ["won", `Champion · ${esc(champ.short)}`];
    return ["", "No match waiting"];
  }
  function finderPages(per: number) {
    const P = M!.players, pages = Math.max(1, Math.ceil(P.length / per));
    if (!P.length) return [""];
    return Array.from({ length: pages }, (_, k) => { const a = P[k * per].name[0], b = P[Math.min(P.length, (k + 1) * per) - 1].name[0]; return a === b ? a : `${a}–${b}`; });
  }
  function namesListHTML(per: number, page: number, enter: boolean) {
    const slice = M!.players.slice(page * per, page * per + per);
    if (!slice.length) return `<p class="muted">Players appear here once the draw is made.</p>`;
    return `<ol class="names${enter ? " enter" : ""}">${slice.map(p => { const [cls, txt] = playerStatus(p); return `<li class="pl"><p class="pl-n">${esc(p.name)}</p><p class="pl-s ${cls}">${txt}</p></li>`; }).join("")}</ol>`;
  }
  // Rows of names a finder board has room for in each design (three names a row).
  const FINDER_ROWS: Record<DesignKey, number> = { rotation: 4, pinned: 4, floorhome: 5, sportstv: 6 };

  function slide(key: string, v: Counters): { title: string; body: string } {
    const [type, arg, from] = key.split(":");
    const r = M!.results;
    if (type === "results") {
      const page = arg === "2" ? r.slice(6, 12) : r.slice(0, 6);
      return { title: arg === "2" ? "Earlier results" : "Latest results", body: page.length ? `<div class="res-grid">${page.map(resultHTML).join("")}</div>` : `<p class="muted">Results appear here as matches finish.</p>` };
    }
    if (type === "finder") { const per = FINDER_ROWS[show] * 3, ranges = finderPages(per), page = v.page % ranges.length; return { title: `Find your name${ranges[page] ? ` · ${ranges[page]}` : ""}`, body: namesListHTML(per, page, false) }; }
    const cat = arg ? M!.catById[arg] : undefined;
    if (type === "standings" && cat) return { title: `${esc(cat.name)} · standings`, body: tablesHTML(cat, Number(from) || 0, false) };
    if (type === "bracket" && cat) return { title: `${esc(cat.name)} · knockout`, body: bracketHTML(cat) };
    if (type === "champions" && cat) return { title: "Champions", body: championsHTML(cat) };
    if (type === "scan") return { title: "Follow along", body: scanHTML() };
    if (type === "sponsors") return { title: "Sponsors", body: sponsorsHTML() };
    if (type === "progress") return { title: "How the day is going", body: progressHTML() };
    return { title: "From the tournament desk", body: noticeHTML() };
  }
  function slideShort(key: string) {
    const [type, arg] = key.split(":");
    const cat = arg ? M?.catById[arg] : undefined;
    if (type === "results") return arg === "2" ? "Earlier results" : "Latest results";
    if (type === "standings") return `${cat?.short ?? ""} standings`;
    if (type === "bracket") return `${cat?.short ?? ""} bracket`;
    if (type === "champions") return "Champions";
    if (type === "finder") return "Find your name";
    if (type === "scan") return "Scores on your phone";
    if (type === "sponsors") return "Sponsors";
    if (type === "progress") return "How the day is going";
    return "From the desk";
  }
  /** The boards that take turns, from where each category is: tables while groups play, brackets in the knockout, champions at the end. */
  function boards(): string[] {
    const m = M!;
    const S: string[] = [], K: string[] = [], C: string[] = [];
    for (const c of m.categories) {
      if (c.finished) { C.push(`champions:${c.id}`); continue; }
      const koStarted = m.matches.some(x => x.cat === c.id && x.kind !== "group" && (x.a || x.b));
      if (koStarted) K.push(`bracket:${c.id}`);
      else if (c.groups.length) for (let g = 0; g < c.groups.length; g += 2) S.push(`standings:${c.id}:${g}`);
    }
    const pick = (list: string[], n: number) => (list.length ? list[n % list.length] : null);
    const pattern: (string | [string[], number])[] = ["results", [S, 0], "finder", [K, 0], "scan", [S, 1], [C, 0], "finder", "results:2", [K, 1], [S, 2], "sponsors", "finder", "progress", [C, 1], "notice", [S, 3], [K, 2]];
    const out: string[] = [];
    for (const p of pattern) {
      const k = typeof p === "string" ? p : pick(p[0], p[1]);
      if (k && out[out.length - 1] !== k && !(typeof p !== "string" && out.includes(k))) out.push(k);
    }
    if (m.results.length < 7) return out.filter(k => k !== "results:2");
    return out;
  }
  function slidesHTML(ctx: Ctx) {
    const list = boards(), i = ctx.v.slide % list.length, s = slide(list[i], ctx.v);
    return `<div class="slide-h"><h2>${s.title}</h2><div class="dots">${list.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div></div><div class="slide-b${ctx.enter ? " enter" : ""}">${s.body}</div>`;
  }

  /* ---------- floor view ---------- */
  function mapCourtHTML(c: number) {
    const m = courtMatch(c), st = liveState(m), mode = N() <= 4 ? "lines" : "lastlines";
    const lead = m && st === "live" ? leadOf(m) : "", badge = m && st === "live" ? pointBadge(m) : null;
    const chip = !m ? `<span class="state free">Free</span>` : st === "called" ? `<span class="state called">Now calling</span>` : badge ? `<span class="badge ${badge.cls}">${badge.text}</span>` : m.bestOf3 ? `<span class="badge soft">${esc(bo3Live(m))}</span>` : `<span class="state"><i class="dot pulse"></i><span class="t">${elapsed(m)}</span></span>`;
    const label = !m ? (N() <= 4 ? "Ready for the next match" : "") : N() <= 4 ? shortStage(M!, m) : N() <= 6 ? (M!.catById[m.cat]?.short ?? "") : "";
    const net = m && st === "live" ? `<span class="pts${lead === "a" ? " lead" : ""}" data-s="a"><i>${m.cur[0]}</i></span><span class="pts${lead === "b" ? " lead" : ""}" data-s="b"><i>${m.cur[1]}</i></span>` : `<span class="mc-word">${st === "called" ? "Warming up" : "Free"}</span>`;
    return `<article class="mcourt ${st}" data-court="${c}" data-kind="map"${m && st === "live" ? ` data-a="${m.cur[0]}" data-b="${m.cur[1]}"` : ""}>
      <div class="mc-top"><span class="mc-n">${c}</span><span class="mc-cs">${esc(label)}</span>${chip}</div>
      <div class="mc-floor">${COURT_SVG}<div class="mc-half a${lead === "a" ? " lead" : ""}">${m ? `<div class="who">${namesHTML(m, "a", mode)}</div>` : ""}</div><div class="mc-half b${lead === "b" ? " lead" : ""}">${m ? `<div class="who">${namesHTML(m, "b", mode)}</div>` : ""}</div><div class="mc-net">${net}</div></div></article>`;
  }
  const hallHTML = () => Array.from({ length: N() }, (_, i) => mapCourtHTML(i + 1)).join("");
  const scanMiniHTML = (title?: string) => `${QR}<div><h3>${title || "Scan for live scores"}</h3><p>${esc(opts.siteUrl.replace(/\/t\//, "\n/t/")).replace("\n", "<br>")}</p></div>`;

  /* ---------- featured match ---------- */
  function featuredCourt(ctx: Ctx) {
    const live: number[] = [];
    for (let c = 1; c <= N(); c++) if (courtMatch(c)) live.push(c);
    return live.length ? live[ctx.v.feat % live.length] : 0;
  }
  function featHTML(c: number) {
    const m = courtMatch(c);
    if (!m) return `<div class="feat" data-court="${c}" data-kind="feat"><div class="f-top"><span class="f-court">Court ${c}</span><span class="f-cs">Ready for the next match</span></div></div>`;
    const called = m.status === "called", lead = called ? "" : leadOf(m), badge = called ? null : pointBadge(m), solo = (M!.teams[m.a ?? ""]?.names.length ?? 2) === 1;
    const side = (s: "a" | "b") => `<div class="f-side${lead === s ? " lead" : ""}${solo ? " solo" : ""}"><div class="who">${namesHTML(m, s, "lines")}</div>${called ? "" : `<span class="pts" data-s="${s}"><i>${scoreOf(m, s)}</i></span>`}</div>`;
    const foot = badge ? `<span class="badge big ${badge.cls}">${badge.text}</span>` : called ? `<span class="call-note">Be on court within ${callLeft(m)} min</span>` : m.bestOf3 ? `<span class="badge big soft">Best of 3 games to 15</span>` : "";
    return `<div class="feat${called ? " called" : ""}" data-court="${c}" data-kind="feat"${called ? "" : ` data-a="${m.cur[0]}" data-b="${m.cur[1]}"`}>
      <div class="f-top"><span class="f-court">Court ${c}</span><span class="f-cs">${esc(catStage(M!, m))}</span>${called ? `<span class="state called">Now calling</span>` : m.ending ? `<span class="state">Finished</span>` : `<span class="state"><i class="dot pulse"></i>Live <span class="t">${elapsed(m)}</span></span>`}</div>
      <div class="f-sides">${side("a")}<p class="f-vs">vs</p>${side("b")}</div><div class="f-foot">${foot}</div></div>`;
  }
  const courtPick = (c: number) => Array.from({ length: N() }, (_, i) => `<span class="${i + 1 === c ? "on" : ""}">${N() <= 4 ? `Court ${i + 1}` : i + 1}</span>`).join("");
  function featuredHTML(ctx: Ctx) {
    const c = featuredCourt(ctx);
    return `${ART_SVG}<div class="${ctx.enter ? "enter" : ""}" style="flex:1;display:flex;flex-direction:column;min-height:0">${c ? featHTML(c) : `<p class="muted">No matches on court right now</p>`}</div>
      <div class="f-bottom"><div class="f-pick">${courtPick(c)}</div><p>Switches court every 12 seconds</p></div>`;
  }
  function railRowHTML(c: number) {
    const m = courtMatch(c), st = liveState(m);
    if (!m) return `<div class="cl-row free" data-court="${c}" data-kind="rail"><span class="cl-n">${c}</span><span class="cl-state">Free</span></div>`;
    const lead = st === "live" ? leadOf(m) : "";
    const right = (s: "a" | "b") => (st === "live" ? `<b class="pts${lead === s ? " lead" : ""}" data-s="${s}"><i>${scoreOf(m, s)}</i></b>` : s === "a" ? `<b class="cl-state">Warming up</b>` : "");
    const line = (s: "a" | "b") => `<div class="cl-line${lead === s ? " lead" : ""}"><span>${esc(sideLabel(M!, m, s, "last"))}</span>${right(s)}</div>`;
    return `<div class="cl-row ${st}" data-court="${c}" data-kind="rail"${st === "live" ? ` data-a="${m.cur[0]}" data-b="${m.cur[1]}"` : ""}><span class="cl-n">${c}</span><div class="cl-lines">${line("a")}${line("b")}</div></div>`;
  }
  const courtlistHTML = () => `<div class="panel-h"><h2>All courts</h2><span>${M!.courts.filter(m => m && m.status === "live" && !m.ending).length} playing</span></div><div>${Array.from({ length: N() }, (_, i) => railRowHTML(i + 1)).join("")}</div>`;

  /* ---------- departures ---------- */
  function depRowHTML(c: number) {
    const m = courtMatch(c), st = liveState(m);
    const dot = st === "live" ? `<i class="dot pulse"></i>` : st === "called" ? `<i class="dot call"></i>` : `<i class="dot idle"></i>`;
    if (!m) return `<div class="d-row free" data-court="${c}" data-kind="dep"><span class="d-court">${dot}Court ${c}</span><span class="d-event">Ready for the next match</span><span class="r"></span><span class="d-score"><span class="word">Free</span></span><span></span></div>`;
    const lead = st === "live" ? leadOf(m) : "";
    const score = st === "live" ? `<span class="pts${lead === "a" ? " lead" : ""}" data-s="a"><i>${m.cur[0]}</i></span><span class="sep">–</span><span class="pts${lead === "b" ? " lead" : ""}" data-s="b"><i>${m.cur[1]}</i></span>` : `<span class="word">Warming up</span>`;
    const max = N() <= 4 ? 30 : 24;
    return `<div class="d-row ${st}" data-court="${c}" data-kind="dep"${st === "live" ? ` data-a="${m.cur[0]}" data-b="${m.cur[1]}"` : ""}><span class="d-court">${dot}Court ${c}</span><span class="d-event">${esc(shortStage(M!, m))}</span><span class="r">${esc(sideLabel(M!, m, "a", "fit", max))}</span><span class="d-score">${score}</span><span>${esc(sideLabel(M!, m, "b", "fit", max))}</span></div>`;
  }
  function onboardHTML() {
    const live = M!.courts.filter(m => m && m.status === "live" && !m.ending).length, called = M!.courts.filter(m => m && m.status === "called").length;
    return `<div class="panel-h"><h2>On court</h2><span>${live} playing${called ? ` · ${called} warming up` : ""}</span></div>
      <div class="on-board"><div class="d-cols"><span>Court</span><span>Event</span><span class="r">Player</span><span class="c">Score</span><span>Player</span></div>${Array.from({ length: N() }, (_, i) => depRowHTML(i + 1)).join("")}</div>`;
  }
  function nextboardHTML(ctx: Ctx) {
    const per = N() <= 4 ? 4 : 3, q = M!.queue, pages = Math.max(1, Math.ceil(q.length / per)), page = ctx.v.dep % pages;
    const rows = q.slice(page * per, page * per + per).map((m, i) => {
      const pos = page * per + i, mins = m.eta != null ? minsUntil(m.eta) : 99;
      const status = pos === 0 ? ["next", "Next to be called"] : mins <= 10 ? ["soon", "Get ready"] : mins > LATER_MIN ? ["", "Later"] : ["", `In ${mins} min`];
      return `<div class="d-row${ctx.enter ? " flip" : ""}" style="animation-delay:${i * 60}ms"><span class="d-time">${m.eta != null ? hm(m.eta) : ""}</span><span class="d-event">${esc(shortStage(M!, m))}</span><span class="d-players">${esc(sideLabel(M!, m, "a", "fit", 20))}<span class="vs">vs</span>${esc(sideLabel(M!, m, "b", "fit", 20))}</span><span class="d-status ${status[0]}">${status[1]}</span></div>`;
    }).join("");
    return `<div class="panel-h"><h2>Next to play</h2><span>Page ${page + 1} of ${pages} · times are estimates</span></div>
      <div class="next-wrap"><div class="next-board"><div class="d-cols"><span>About</span><span>Event</span><span>Players</span><span>Status</span></div>${rows || `<p class="muted">Nothing waiting right now</p>`}</div>
      <aside class="next-scan">${QR}<h3>On your phone</h3><p>${esc(opts.siteUrl.replace(/\/t\//, "\n/t/")).replace("\n", "<br>")}</p></aside></div>`;
  }

  /* ---------- strip chips (finder, channels, floor home strip) ---------- */
  function chipHTML(c: number) {
    const m = courtMatch(c), st = liveState(m), n = N();
    const badge = m && st === "live" ? pointBadge(m) : null;
    const right = n >= 8 || (show === "floorhome" && n > 6) ? `<i class="dot ${st === "live" ? "pulse" : st === "called" ? "call" : "idle"}"></i>` : st === "live" ? (badge ? `<span class="badge ${badge.cls}">${badge.text}</span>` : `<span class="state"><i class="dot pulse"></i><span class="t">${elapsed(m!)}</span></span>`) : st === "called" ? `<span class="state called">Now calling</span>` : `<span class="state free">Free</span>`;
    const lead = m && st === "live" ? leadOf(m) : "";
    const mid = m && st === "live" ? `<span class="pts${lead === "a" ? " lead" : ""}" data-s="a"><i>${m.cur[0]}</i></span><span class="sep">–</span><span class="pts${lead === "b" ? " lead" : ""}" data-s="b"><i>${m.cur[1]}</i></span>` : `<span class="ch-word">${st === "called" ? "Warming up" : "Ready"}</span>`;
    const who = !m ? `<span>${n <= 4 ? "Next match on its way" : "Free"}</span>` : n <= 4 ? `<span>${esc(sideLabel(M!, m, "a", "last"))} vs ${esc(sideLabel(M!, m, "b", "last"))}</span>` : `<span>${esc(sideLabel(M!, m, "a", "last"))}</span><span>${esc(sideLabel(M!, m, "b", "last"))}</span>`;
    return `<article class="chip ${st}" data-court="${c}" data-kind="chip"${m && st === "live" ? ` data-a="${m.cur[0]}" data-b="${m.cur[1]}"` : ""}><div class="ch-top"><span class="ch-n">Court ${c}</span>${right}</div><div class="ch-mid">${mid}</div><div class="ch-who">${who}</div></article>`;
  }
  const stripHTML = () => Array.from({ length: N() }, (_, i) => chipHTML(i + 1)).join("");

  function callingHTML() {
    const called = M!.courts.filter((m): m is TvMatch => !!m && m.status === "called");
    const q = M!.queue;
    const soonN = N() <= 4 ? 2 : 1;
    const soon = (list: TvMatch[]) => (list.length ? `<div class="soon-list"><h3>Starting soon</h3>${list.map(m => `<div class="soon-row"><span class="t">${m.eta != null ? hm(m.eta) : ""}</span><span>${esc(sideLabel(M!, m, "a", "last"))} vs ${esc(sideLabel(M!, m, "b", "last"))}</span></div>`).join("")}</div>` : "");
    if (called.length === 1) { const m = called[0]; return `<div class="panel-h"><h2>Now calling</h2><span>${CALL_WINDOW_MIN} minutes to reach the court</span></div><div class="call-item"><p class="call-court">Court ${m.court}</p><div class="who">${namesHTML(m, "a", "fit", 30)}</div><p class="vs">vs</p><div class="who">${namesHTML(m, "b", "fit", 30)}</div><p class="call-note">Be on court within ${callLeft(m)} min</p></div>${soon(q.slice(0, soonN))}`; }
    if (called.length > 1) return `<div class="panel-h"><h2>Now calling</h2><span>${CALL_WINDOW_MIN} minutes to reach the court</span></div>${called.slice(0, 2).map(m => `<div class="call-item"><p class="call-court">Court ${m.court}</p><div class="who"><span>${esc(sideLabel(M!, m, "a", "last"))} vs ${esc(sideLabel(M!, m, "b", "last"))}</span></div><p class="call-note">Be on court within ${callLeft(m)} min</p></div>`).join("")}${called.length > 2 ? `<p class="call-note">Also calling court ${called.slice(2).map(m => m.court).join(" and ")}</p>` : ""}`;
    const nx = q[0];
    return `<div class="panel-h"><h2>Next to be called</h2><span>${nx && nx.eta != null ? `About ${hm(nx.eta)}` : ""}</span></div>${nx ? `<div class="call-item"><p class="q-cat">${esc(catStage(M!, nx))}</p><div class="who">${namesHTML(nx, "a", "fit", 30)}</div><p class="vs">vs</p><div class="who">${namesHTML(nx, "b", "fit", 30)}</div></div>` : `<p class="muted">Nothing waiting right now</p>`}${soon(q.slice(1, 1 + soonN))}`;
  }
  function finderHTML(ctx: Ctx) {
    const per = 15, ranges = finderPages(per), page = ctx.v.page % ranges.length;
    return `<div class="panel-h"><h2>Find your name</h2><div class="az">${ranges.map((r, k) => (r ? `<span class="${k === page ? "on" : ""}">${r}</span>` : "")).join("")}</div></div>${namesListHTML(per, page, ctx.enter)}`;
  }

  /* ---------- channels ---------- */
  const channels = () => [...M!.categories.map(c => c.id), "scan", "sponsors"];
  function chanLiveHTML(c: number) {
    const m = courtMatch(c), st = liveState(m);
    if (!m) return "";
    const lead = st === "live" ? leadOf(m) : "";
    const line = (s: "a" | "b") => `<div class="cl-line${lead === s ? " lead" : ""}"><span>${esc(sideLabel(M!, m, s, "fit", 30))}</span>${st === "live" ? `<b class="pts${lead === s ? " lead" : ""}" data-s="${s}"><i>${scoreOf(m, s)}</i></b>` : ""}</div>`;
    return `<div class="cl-mini ${st}" data-court="${c}" data-kind="chanlive"${st === "live" ? ` data-a="${m.cur[0]}" data-b="${m.cur[1]}"` : ""}><span class="mini-court">Court ${c}</span><div class="cl-lines">${line("a")}${line("b")}</div><span class="cl-state">${st === "live" ? (m.bestOf3 ? `Game ${m.games.length + 1}` : "") : "Warming up"}</span></div>`;
  }
  function channelHTML(ctx: Ctx) {
    const list = channels(), key = list[ctx.v.chan % list.length], enter = ctx.enter ? " enter" : "";
    if (key === "scan") return `<div class="ch-wrap single${enter}">${scanHTML("Follow every court on your phone")}</div>`;
    if (key === "sponsors") return `<div class="ch-wrap single${enter}">${sponsorsHTML()}</div>`;
    const c = M!.catById[key];
    if (!c) return "";
    const mine = M!.matches.filter(m => m.cat === key);
    const onCourt = M!.courts.filter((m): m is TvMatch => !!m && m.cat === key);
    const coming = M!.queue.filter(m => m.cat === key).slice(0, 3);
    const groupsLeft = mine.filter(m => m.kind === "group" && m.status !== "done").length;
    const groupDone = mine.filter(m => m.kind === "group" && m.status === "done").length, groupAll = mine.filter(m => m.kind === "group").length;
    const koStarted = mine.some(m => m.kind !== "group" && (m.a || m.b));
    const status = c.finished ? "Finished" : koStarted ? "Knockout stage" : groupAll ? `Group stage · ${groupDone} of ${groupAll} played` : "Draw to come";
    const fmt = c.groups.length ? `${c.groups.length === 1 ? `One group of ${c.groups[0].teamIds.length}` : `${c.groups.length} groups`}${c.advance ? `, top ${c.advance} through` : ""} · ` : "";
    const left = c.finished && c.champion
      ? `<div class="ch-champ">${TROPHY}<div><p>Champions</p><b>${M!.teams[c.champion].names.map(esc).join(" &amp; ")}</b><p>${c.finalScore ? `Won the final ${c.finalScore[0]}–${c.finalScore[1]}` : "Won the round robin"}</p></div></div>`
      : `<section class="ch-sec"><h3>On court now</h3>${onCourt.length ? onCourt.map(m => chanLiveHTML(m.court!)).join("") : `<p class="muted">Not on court right now</p>`}</section>
         <section class="ch-sec"><h3>Coming up</h3>${coming.length ? coming.map(m => `<div class="soon-row"><span class="t">${m.eta != null ? hm(m.eta) : ""}</span><span>${esc(sideLabel(M!, m, "a", "last"))} vs ${esc(sideLabel(M!, m, "b", "last"))}</span></div>`).join("") : `<p class="muted">Nothing else waiting in this category</p>`}</section>`;
    const right = !koStarted && groupsLeft && c.groups.length ? tablesHTML(c, 0, true) : bracketHTML(c);
    return `<div class="ch-wrap${enter}"><div class="ch-left"><h2 class="ch-title">${esc(c.name)}</h2><p class="ch-fmt">${fmt}${status}</p>${left}</div><div class="ch-right">${right}</div></div>`;
  }

  /* ---------- the six dashboards (design 1) ---------- */
  const queuePart = (max: number): PartFn => ctx => queueHTML(ctx, queueRows(), max);
  const VIEWS: Record<DashKey, ViewDef> = {
    courtside: {
      layout: () => `<div class="tv v-courtside">${N() <= 4 ? `<section class="courts" data-part="courts" style="--cols:${N()}"></section>` : `<section class="strip" data-part="strip" style="--cols:${N()}"></section>`}<div class="lower"><section class="panel slides" data-part="slides"></section><section class="panel queue" data-part="queue"></section></div></div>`,
      parts: { courts: courtsHTML, strip: stripHTML, slides: slidesHTML, queue: queuePart(26) },
      rot: { slide: 10_000, q: 4000 },
    },
    floor: {
      layout: () => `<div class="tv v-floor"><div class="floor-main"><section class="hall" data-part="hall" style="--cols:${N() <= 2 ? N() : N() <= 4 ? 2 : N() <= 6 ? 3 : 4}"></section><aside class="rail"><section class="panel queue" data-part="queue"></section><section class="panel scan-mini">${scanMiniHTML()}</section></aside></div></div>`,
      parts: { hall: hallHTML, queue: queuePart(24) },
      rot: { q: 4000 },
    },
    broadcast: {
      layout: () => `<div class="tv v-broadcast"><div class="bc-main"><section class="feature" data-part="featured"></section><aside class="rail"><section class="panel courtlist" data-part="courtlist"></section><section class="panel queue" data-part="queue"></section></aside></div></div>`,
      parts: { featured: featuredHTML, courtlist: courtlistHTML, queue: queuePart(26) },
      rot: { feat: 12_000, q: 4000 },
    },
    departures: {
      layout: () => `<div class="tv v-dep"><section class="board" data-part="onboard"></section><section class="board" data-part="nextboard"></section></div>`,
      parts: { onboard: onboardHTML, nextboard: nextboardHTML },
      rot: { dep: 8000 },
    },
    finder: {
      layout: () => `<div class="tv v-finder"><section class="strip" data-part="strip" style="--cols:${N()}"></section><div class="f-main"><aside class="f-left"><section class="panel calling" data-part="calling"></section><section class="panel scan-mini">${scanMiniHTML("Search your name on your phone")}</section></aside><section class="panel directory" data-part="finder"></section></div></div>`,
      parts: { strip: stripHTML, calling: callingHTML, finder: finderHTML },
      rot: { page: 10_000 },
    },
    channels: {
      layout: () => `<div class="tv v-chan"><section class="strip" data-part="strip" style="--cols:${N()}"></section><section class="channel" data-part="channel"></section></div>`,
      parts: { strip: stripHTML, channel: channelHTML },
      rot: { chan: 12_000 },
    },
    // The player boards (tvCards.ts). Each only joins the rotation once it has something to show.
    spotlight: {
      layout: () => `<div class="tv v-card"><section data-part="spot"></section></div>`,
      parts: { spot: ctx => spotlightHTML(M!, stats(), ctx.v.pl, ctx.enter, photoOk) },
      rot: { pl: 8000 },
    },
    matchup: {
      layout: () => `<div class="tv v-card"><section data-part="matchup"></section></div>`,
      parts: { matchup: ctx => matchupHTML(M!, stats(), ctx.v.mu, ctx.enter, photoOk) },
      rot: { mu: 10_000 },
    },
    leaders: {
      layout: () => `<div class="tv v-card"><section class="ld-wrap" data-part="leaders"></section></div>`,
      parts: { leaders: ctx => leadersHTML(M!, stats(), ctx.v.ld, ctx.enter, photoOk) },
      rot: { ld: 12_000 },
    },
  };

  /* ---------- the four designs ---------- */
  const A_SCENES: Scene[] = [
    { v: "courtside", name: "All courts", dur: 30_000 },
    { v: "spotlight", name: "Player spotlight", dur: 24_000 },
    { v: "departures", name: "Next to play", dur: 24_000 },
    { v: "floor", name: "Court map", dur: 24_000 },
    { v: "matchup", name: "Match-up", dur: 20_000 },
    { v: "finder", name: "Find your name", dur: 30_000 },
    { v: "broadcast", name: "Featured match", dur: 24_000 },
    { v: "leaders", name: "Leaders", dur: 24_000 },
    { v: "departures", name: "Next to play", dur: 24_000 },
    { v: "channels", name: "Categories", dur: 24_000 },
    { v: "finder", name: "Find your name", dur: 30_000 },
  ];
  /** The rotation's dashboards, leaving out a player board that has nothing to show yet. */
  function rotationScenes(): Scene[] {
    if (!M) return A_SCENES.filter(s => s.v !== "spotlight" && s.v !== "matchup" && s.v !== "leaders");
    stats();
    return A_SCENES.filter(s => (s.v === "spotlight" ? ST.spot : s.v === "matchup" ? ST.mu : s.v === "leaders" ? ST.ld : true));
  }
  function stageHTML(ctx: Ctx) {
    const list = boards(), j = (show === "pinned" ? SC.i : Math.floor(SC.i / 2)) % list.length, s = slide(list[j], ctx.v);
    return `<div class="slide-h"><h2>${s.title}</h2><div class="dots">${list.map((_, n) => `<i class="${n === j ? "on" : ""}"></i>`).join("")}</div></div><div class="slide-b${ctx.enter ? " enter" : ""}">${s.body}</div>`;
  }
  const fhCourtsHTML = () => Array.from({ length: N() }, (_, i) => `<div class="fh-court">${mapCourtHTML(i + 1)}${chipHTML(i + 1)}</div>`).join("");
  const D = { cut: null as null | { court: number; until: number }, cutFor: null as string | null };
  function heroCourt(ctx: Ctx) { if (D.cut && D.cut.until > now() && courtMatch(D.cut.court)) return D.cut.court; return featuredCourt(ctx); }
  function heroHTML(ctx: Ctx) {
    const sc = curScene();
    if (sc.k) { const s = slide(sc.k, ctx.v); return `<div class="pkg${ctx.enter ? " enter" : ""}"><div class="pkg-h"><h2>${s.title}</h2></div><div class="pkg-b">${s.body}</div></div>`; }
    const c = heroCourt(ctx), cut = !!D.cut && D.cut.court === c && D.cut.until > now();
    return `${ART_SVG}<div class="hero-feat${ctx.enter ? " enter" : ""}">${c ? featHTML(c) : `<p class="muted">No matches on court right now</p>`}</div><div class="f-bottom"><div class="f-pick">${courtPick(c)}</div><p>${cut ? "Match point, so the TV cut to this court" : "Switches court every 12 seconds"}</p></div>`;
  }
  const SHOWS: Record<DesignKey, ShowDef> = {
    rotation: {
      layout: () => `<div class="show">${showHeader()}<main class="scene-wrap" data-slot="scene"></main>${stripFrame()}</div>`,
      parts: {},
      scenes: rotationScenes,
    },
    pinned: {
      layout: () => `<div class="show">${showHeader()}<main class="sb">${N() <= 4 ? `<section class="courts" data-part="courts" style="--cols:${N()}"></section>` : `<section class="strip" data-part="strip" style="--cols:${N()}"></section>`}<div class="sb-mid"><section class="panel slides" data-part="stage"></section><section class="panel queue" data-part="queue"></section></div></main>${stripFrame()}</div>`,
      parts: { courts: courtsHTML, strip: stripHTML, stage: stageHTML, queue: queuePart(26) },
      scenes: () => boards().map(k => ({ k, dur: 12_000 })),
    },
    floorhome: {
      layout: () => `<div class="show">${showHeader()}<main class="fh home" style="--n:${N()};--cols:${N() <= 2 ? N() : N() <= 4 ? 2 : N() <= 6 ? 3 : 4}"><section class="fh-courts" data-part="fhcourts"></section><div class="fh-left"><section class="panel slides fh-away" data-part="away"></section></div><aside class="rail"><section class="panel queue" data-part="queue"></section><section class="panel scan-mini">${scanMiniHTML()}</section></aside></main>${stripFrame()}</div>`,
      parts: { fhcourts: fhCourtsHTML, away: stageHTML, queue: queuePart(24) },
      scenes: () => boards().flatMap(k => [{ home: true, dur: 20_000 }, { k, dur: 14_000 }]),
    },
    sportstv: {
      layout: () => `<div class="show">${showHeader()}<main class="bd"><section class="bd-hero" data-part="hero"></section><aside class="rail"><section class="panel courtlist" data-part="courtlist"></section><section class="panel queue" data-part="queue"></section></aside></main>${stripFrame()}</div>`,
      parts: { hero: heroHTML, courtlist: courtlistHTML, queue: queuePart(26) },
      scenes: () => boards().flatMap(k => [{ feat: true, dur: 12_000 }, { feat: true, dur: 12_000 }, { k, dur: 12_000 }]),
    },
  };
  const KIND: Record<string, (c: number) => string> = { tile: tileHTML, map: mapCourtHTML, rail: railRowHTML, dep: depRowHTML, chip: chipHTML, feat: featHTML, chanlive: chanLiveHTML, tk: tkCourtHTML };

  /* ---------- the moving score strip ---------- */
  const SPEED = 130; // stage pixels a second
  const TK = { sig: "", w: 0, x0: 0, anim: null as Animation | null, track: null as HTMLElement | null, prev: {} as Record<string, string>, carry: null as null | { anchor: string | null; rel: number; x: number } };
  /** The item showing most in the strip and where it is, so a new frame's strip carries on from the same spot. */
  function tkCapture(): { anchor: string | null; rel: number; x: number } | null {
    const view = $("[data-tk]"), track = view?.firstElementChild;
    if (!view || !track || !TK.w) return null;
    const x = tkX(), vw = view.clientWidth;
    let anchor: string | null = null, rel = 0, best = -1;
    for (const el of $$(".ti", track)) {
      const L = el.offsetLeft, R = L + el.offsetWidth;
      if (R <= x || L >= x + vw) continue;
      const shown = Math.min(R, x + vw) - Math.max(L, x);
      if (shown > best) { best = shown; anchor = el.dataset.key ?? null; rel = L - x; }
    }
    return { anchor, rel, x };
  }
  function tkCourtHTML(c: number) {
    const m = courtMatch(c);
    const open = `<span class="ti" data-key="c${c}" data-court="${c}" data-kind="tk"`;
    if (!m) return `${open}><span class="ti-c">Court ${c}</span><span class="ti-tag">Free</span></span>`;
    if (m.status === "called") return `${open}><span class="ti-c">Court ${c}</span><span class="ti-tag call">Now calling</span><span class="ti-e">${esc(M!.catById[m.cat]?.short ?? "")}</span><b>${esc(sideLabel(M!, m, "a", "last"))}</b>vs<b>${esc(sideLabel(M!, m, "b", "last"))}</b></span>`;
    const lead = leadOf(m);
    const tag = m.ending ? `<span class="ti-tag fin">Final score</span>` : `<span class="ti-tag live"><i class="dot pulse"></i>Live</span>`;
    return `${open} data-a="${m.cur[0]}" data-b="${m.cur[1]}"><span class="ti-c">Court ${c}</span>${tag}<span class="ti-e">${esc(M!.catById[m.cat]?.short ?? "")}</span><b>${esc(sideLabel(M!, m, "a", "last"))}</b><span class="pts${lead === "a" ? " lead" : ""}" data-s="a"><i>${m.cur[0]}</i></span><span class="sep">–</span><span class="pts${lead === "b" ? " lead" : ""}" data-s="b"><i>${m.cur[1]}</i></span><b>${esc(sideLabel(M!, m, "b", "last"))}</b></span>`;
  }
  function tkResultHTML(m: TvMatch) {
    const wa = m.winner === m.a, sc = wa ? m.cur : [m.cur[1], m.cur[0]];
    return `<span class="ti" data-key="r${m.id}"><span class="ti-tag fin">Final</span><span class="ti-e">${esc(M!.catById[m.cat]?.short ?? "")}</span><b>${esc(teamName(M!, wa ? m.a : m.b, "last"))}</b>beat ${esc(teamName(M!, wa ? m.b : m.a, "last"))}${m.walkover ? `<span class="ti-e">walkover</span>` : `<span class="ti-sc">${sc[0]}–${sc[1]}${m.bestOf3 && m.games.length ? ` (${esc(gamesText(m, !wa))})` : ""}</span>`}</span>`;
  }
  function tkItems() {
    const out: { key: string; sig: string; html: () => string }[] = [];
    for (let c = 1; c <= N(); c++) { const m = courtMatch(c); if (m) out.push({ key: "c" + c, sig: `c${c}:${m.id}:${m.status}:${m.ending}`, html: () => tkCourtHTML(c) }); }
    out.push({ key: "url", sig: "url", html: () => `<span class="ti" data-key="url"><span class="ti-tag wide">On your phone</span><b>${esc(opts.siteUrl)}</b></span>` });
    for (const r of M!.results.slice(0, 4)) out.push({ key: "r" + r.id, sig: "r" + r.id, html: () => tkResultHTML(r) });
    return out;
  }
  const tkX = () => (TK.anim ? TK.x0 + (Number(TK.anim.currentTime) || 0) * SPEED / 1000 : TK.x0);
  function tkPlay(x0: number) {
    const track = TK.track; if (!track) return;
    TK.x0 = x0;
    track.style.transform = `translateX(${-x0}px)`;
    if (instant || RM.matches || typeof track.animate !== "function" || !TK.w) { TK.anim = null; return; }
    const a = track.animate([{ transform: `translateX(${-x0}px)` }, { transform: `translateX(${-TK.w}px)` }], { duration: Math.max(1, (TK.w - x0) / SPEED * 1000), easing: "linear" });
    TK.anim = a;
    a.onfinish = () => { if (TK.anim !== a) return; TK.w = (track.firstElementChild as HTMLElement | null)?.offsetWidth || TK.w; tkPlay(0); };
  }
  /** Rebuild only when the items change; the steadiest item in view keeps its exact place, so the strip never jumps. */
  function tickerUpdate(force: boolean) {
    const view = $("[data-tk]"); if (!view || !M) return;
    const items = tkItems(), sig = items.map(i => i.sig).join("|"), old = view.firstElementChild as HTMLElement | null;
    if (!force && old && sig === TK.sig && Math.abs(((old.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0) - TK.w) < 1) return;
    const newSig: Record<string, string> = {};
    for (const i of items) newSig[i.key] = i.sig;
    let anchor: string | null = null, rel = 0, xOld = 0;
    if (old && TK.w) {
      xOld = tkX();
      const vw = view.clientWidth;
      let best = -1;
      for (const el of $$(".ti", old)) {
        const L = el.offsetLeft, R = L + el.offsetWidth, key = el.dataset.key ?? "";
        if (R <= xOld || L >= xOld + vw || !(key in newSig)) continue;
        const score = Math.min(R, xOld + vw) - Math.max(L, xOld) + (TK.prev[key] === newSig[key] ? 1e5 : 0);
        if (score > best) { best = score; anchor = key; rel = L - xOld; }
      }
    } else if (TK.carry) {
      // A new design just took over: carry on from where the last frame's strip was.
      ({ anchor, rel, x: xOld } = TK.carry);
    }
    TK.carry = null;
    TK.prev = newSig;
    if (TK.anim) { TK.anim.cancel(); TK.anim = null; }
    let run = items.map(i => i.html()).join("");
    view.innerHTML = `<div class="st-track"><div class="st-run">${run}</div></div>`;
    const one = (view.firstElementChild?.firstElementChild as HTMLElement | null)?.offsetWidth || 1;
    run = run.repeat(Math.max(1, Math.ceil(view.clientWidth / one)));
    view.innerHTML = `<div class="st-track"><div class="st-run">${run}</div><div class="st-run" aria-hidden="true">${run}</div></div>`;
    const track = view.firstElementChild as HTMLElement, r1 = track.firstElementChild as HTMLElement;
    TK.track = track; TK.sig = sig; TK.w = r1.offsetWidth;
    let x0 = xOld;
    if (anchor) { const el = r1.querySelector<HTMLElement>(`[data-key="${anchor}"]`); if (el) x0 = el.offsetLeft - rel; }
    x0 = TK.w ? ((x0 % TK.w) + TK.w) % TK.w : 0;
    tkPlay(x0);
  }

  /* ---------- announcements ---------- */
  const ANN = { i: -1, at: 0, key: "", ev: 0, mp: new Set<string>(), calls: new Set<string>() };
  function annHTML(it: AnnItem) {
    return `<div class="ann-msg"><span class="ann-tag ${it.type}">${it.type === "desk" ? MEGAPHONE : ""}${esc(it.tag)}</span><p class="ann-text"><b>${esc(it.main)}</b>${it.sub ? `<span>${esc(it.sub)}</span>` : ""}</p></div>`;
  }
  function fitAnn(msg: Element | null) { const tx = msg?.querySelector<HTMLElement>(".ann-text"); if (tx && tx.scrollWidth > tx.clientWidth + 1) tx.classList.add("two"); }
  const annItems = () => annList(M!, ANN.ev, opts.siteUrl);
  function annShow(it: AnnItem | undefined, animate: boolean) {
    const box = $('[data-part="ann"]'); if (!box || !it) return;
    ANN.key = it.key;
    box.classList.toggle("desk", it.type === "desk");
    const old = $$(".ann-msg", box);
    box.insertAdjacentHTML("beforeend", annHTML(it));
    const el = box.lastElementChild;
    fitAnn(el);
    if (!animate || instant || RM.matches) { old.forEach(o => o.remove()); return; }
    el?.classList.add("in");
    old.forEach(o => { o.classList.remove("in"); o.classList.add("out"); window.setTimeout(() => o.remove(), 460); });
    window.setTimeout(() => el?.classList.remove("in"), 620);
  }
  function annStep(animate: boolean) {
    const l = annItems(); if (!l.length) return;
    ANN.i = (ANN.i + 1) % l.length;
    if (l[ANN.i].type === "info") ANN.ev++;
    annShow(l[ANN.i], animate);
  }
  function annForce(it: AnnItem) {
    ANN.at = Date.now();
    const j = annItems().findIndex(x => x.key === it.key);
    if (j >= 0) ANN.i = j;
    annShow(it, true);
  }

  /* ---------- a desk post shown full screen ---------- */
  let TO: null | { el: HTMLElement; start: number; dur: number; id: string } = null;
  const takeoverSeen = new Set<string>();
  function takeover(text: string, postedAt: number, id: string) {
    const host = $(".show:not(.leaving)"); if (!host) return;
    $$(".takeover", host).forEach(x => x.remove());
    host.insertAdjacentHTML("beforeend", `<section class="takeover">${MEGAPHONE}<p class="to-tag">Announcement from the desk</p><p class="to-text">${esc(text)}</p><p class="to-sub">Posted at ${hm(postedAt)} ${ampm(postedAt)}</p><div class="to-bar"><i></i></div></section>`);
    TO = { el: host.lastElementChild as HTMLElement, start: Date.now(), dur: 15_000, id };
    if (!instant && !RM.matches) TO.el.classList.add("in");
  }
  function endTakeover() {
    if (!TO) return;
    const el = TO.el; TO = null;
    if (instant || RM.matches) { el.remove(); return; }
    el.classList.remove("in"); el.classList.add("out"); window.setTimeout(() => el.remove(), 460);
  }
  function takeoverTick() {
    if (!TO) return;
    if (!TO.el.isConnected) { TO = null; return; }
    const p = clamp((Date.now() - TO.start) / TO.dur, 0, 1), bar = $(".to-bar i", TO.el);
    if (bar) bar.style.transform = `scaleX(${(1 - p).toFixed(3)})`;
    if (p >= 1) endTakeover();
  }

  /* ---------- rendering ---------- */
  const order = opts.design ? [opts.design] : DESIGN_ORDER;
  let di = 0;
  let show: DesignKey = order[0];
  let curView: DashKey | null = null;
  let morphing = false;
  const VIEW: Counters = { slide: 0, q: 0, feat: 0, page: 0, chan: 0, dep: 0, pl: 0, mu: 0, ld: 0 };
  const SC = { i: 0, start: Date.now() };
  const resume: Partial<Record<DesignKey, number>> = {};
  let designStart = Date.now();
  // The film loops full screen while an admin has it switched on (TV tab). Anything
  // live (a call, a match point, a full-screen desk post) stops it, and it comes
  // back a minute later if it's still switched on.
  const film = filmAllowed(window.location.search)
    ? createTvFilm(stageEl.parentElement ?? stageEl, FILM_SRC, () => instant || RM.matches) : null;
  const FILM_HOLD_MS = 60_000;
  let filmHoldUntil = 0;
  const afterFilm = () => { if (!destroyed) { SC.start = Date.now(); lastFull = 0; } };
  function filmCheck() {
    if (!film) return;
    if (!M?.film) { if (film.playing()) film.stop(); return; }
    if (!film.playing() && Date.now() >= filmHoldUntil) film.play(afterFilm);
  }
  /** Something live needs the screen: stop the film and keep it off for a minute. */
  function filmYield() { if (film?.playing()) { filmHoldUntil = Date.now() + FILM_HOLD_MS; film.stop(); } }
  let lastRot: Partial<Record<keyof Counters, number>> = {};
  let lastFull = 0;

  const scenes = () => SHOWS[show].scenes();
  const curScene = () => { const l = scenes(); return l[SC.i % l.length] ?? { dur: 10_000 }; };
  const nextScene = (): { name: string } => {
    const l = scenes();
    if (order.length > 1 && Date.now() - designStart + curScene().dur - (Date.now() - SC.start) >= opts.eachMs) {
      const nd = order[(di + 1) % order.length];
      return { name: DESIGN_NAMES[nd] };
    }
    return { name: sceneName(l[(SC.i + 1) % l.length]) };
  };
  function sceneName(sc: Scene | undefined) { return !sc ? "" : sc.name ? sc.name : sc.home ? "Court map" : sc.feat ? "Featured match" : slideShort(sc.k ?? ""); }
  function partFn(name: string): PartFn | null {
    const own = SHOWS[show].parts[name];
    if (own) return own;
    return show === "rotation" && curView && VIEWS[curView].parts[name] ? VIEWS[curView].parts[name] : null;
  }
  function renderPart(name: string, enter: boolean) {
    const fn = partFn(name); if (!fn || !M) return;
    $$(`[data-part="${name}"]`).forEach(p => { if (!p.closest(".scene.out,.show.leaving")) { p.innerHTML = fn({ v: VIEW, enter }); fitNames(p); } });
  }
  function refreshParts() {
    if (!M) return;
    const names = new Set($$("[data-part]").filter(p => !p.closest(".show.leaving")).map(p => p.dataset.part ?? ""));
    for (const n of names) { if (n === "ann" || n === "stnext" || (n === "fhcourts" && morphing)) continue; renderPart(n, false); }
    tickerUpdate(false);
    renderNext();
    lastFull = Date.now();
  }
  function patchCourt(c: number) {
    $$<HTMLElement>(`[data-court="${c}"][data-kind]`).forEach(el => {
      if (el.closest(".show.leaving")) return;
      const fn = KIND[el.dataset.kind ?? ""]; if (!fn) return;
      const old = { a: el.dataset.a, b: el.dataset.b };
      const tmp = document.createElement("div"); tmp.innerHTML = fn(c);
      const neu = tmp.firstElementChild as HTMLElement | null; if (!neu) return;
      el.replaceWith(neu);
      fitNames(neu);
      if (RM.matches) return;
      for (const s of ["a", "b"] as const) if (old[s] !== undefined && old[s] !== neu.dataset[s]) $$(`.pts[data-s="${s}"] i`, neu).forEach(i => i.classList.add("bump"));
    });
  }
  function swapDashboard(v: DashKey, animate: boolean) {
    const wrap = $('.show:not(.leaving) [data-slot="scene"]'); if (!wrap) return;
    curView = v;
    const el = document.createElement("div");
    el.className = "scene"; el.dataset.view = v;
    el.innerHTML = VIEWS[v].layout();
    const ctx = { v: VIEW, enter: false };
    for (const name in VIEWS[v].parts) $$(`[data-part="${name}"]`, el).forEach(p => { p.innerHTML = VIEWS[v].parts[name](ctx); });
    const old = $$(".scene", wrap);
    wrap.appendChild(el);
    fitNames(el);
    if (!animate || instant || RM.matches) { old.forEach(o => o.remove()); return; }
    el.classList.add("in");
    old.forEach(o => { o.classList.remove("in"); o.classList.add("out"); window.setTimeout(() => o.remove(), 520); });
    window.setTimeout(() => el.classList.remove("in"), 820);
  }
  function stageScale() { const r = stageEl.getBoundingClientRect(); return r.width / 1920 || 1; }
  function setFloorMode(away: boolean, animate: boolean) {
    const fh = $(".show:not(.leaving) .fh"); if (!fh || fh.classList.contains("away") === away) return;
    const els = $$(".fh-court", fh), move = animate && !instant && !RM.matches && els.length > 0 && typeof els[0].animate === "function";
    const first = move ? els.map(e => e.getBoundingClientRect()) : null;
    fh.classList.toggle("away", away); fh.classList.toggle("home", !away);
    fitNames(fh);
    if (!move || !first) return;
    const k = stageScale();
    morphing = true;
    els.forEach((e, i) => {
      const f = first[i], l = e.getBoundingClientRect(); if (!l.width || !l.height) return;
      e.animate([{ transform: `translate(${(f.left - l.left) / k}px,${(f.top - l.top) / k}px) scale(${f.width / l.width},${f.height / l.height})` }, { transform: "none" }], { duration: 800, easing: "cubic-bezier(0.22,1,0.36,1)" });
      const card = e.querySelector(away ? ".chip" : ".mcourt");
      if (card) for (const ch of Array.from(card.children)) (ch as HTMLElement).animate([{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], { duration: 800 });
    });
    window.setTimeout(() => { morphing = false; }, 820);
  }
  function heroSwap(animate: boolean) {
    const hero = $('.show:not(.leaving) [data-part="hero"]'); if (!hero) return;
    if (!animate || instant || RM.matches) { renderPart("hero", false); return; }
    hero.classList.remove("wipe"); void hero.offsetWidth; hero.classList.add("wipe");
    window.setTimeout(() => renderPart("hero", true), 340);
    window.setTimeout(() => hero.classList.remove("wipe"), 820);
  }
  function enterScene(first: boolean) {
    const sc = curScene(), anim = !first;
    SC.start = Date.now(); lastRot = {};
    if (!first) { const l = scenes(), prev = l[(SC.i - 1 + l.length) % l.length]; if (prev?.k === "finder") VIEW.page++; if (sc.feat) VIEW.feat++; }
    if (show === "rotation") swapDashboard(sc.v ?? "courtside", anim);
    else if (show === "pinned") renderPart("stage", anim);
    else if (show === "floorhome") { if (!sc.home) renderPart("away", anim); setFloorMode(!sc.home, anim); }
    else heroSwap(anim);
    renderNext();
  }
  function advanceScene() {
    SC.i = (SC.i + 1) % Math.max(1, scenes().length);
    if (D.cut && D.cut.until <= now()) D.cut = null;
    enterScene(false);
  }
  function renderNext() {
    const el = $('.show:not(.leaving) [data-part="stnext"]'); if (!el) return;
    el.innerHTML = `<p><span>Next</span><b>${esc(nextScene().name)}</b></p><div class="st-bar"><i></i></div>`;
    progressTick();
  }
  function progressTick() {
    const i = $('.show:not(.leaving) [data-part="stnext"] .st-bar i'); if (!i) return;
    i.style.transform = `scaleX(${clamp((Date.now() - SC.start) / curScene().dur, 0, 1).toFixed(3)})`;
  }
  function renderFrame(arriving: boolean) {
    if (!M) return;
    TK.carry = tkCapture();
    if (TK.anim) { TK.anim.cancel(); TK.anim = null; }
    TK.sig = ""; TK.w = 0; TK.track = null; TO = null; morphing = false; curView = null;
    stageEl.dataset.courts = String(layoutCourts());
    stageEl.dataset.show = show;
    stageEl.innerHTML = SHOWS[show].layout();
    const frame = $(".show");
    if (arriving && frame && !instant && !RM.matches) { frame.classList.add("arriving"); window.setTimeout(() => frame.classList.remove("arriving"), 950); }
    enterScene(true);
    refreshParts();
    const l = annItems(); if (l.length) annShow(l[Math.max(0, ANN.i) % l.length], false);
  }
  /** Screensaver hand over: the design that ran fades out and the next one comes in, picking up its boards where it left off. */
  function nextDesign() {
    resume[show] = SC.i;
    di = (di + 1) % order.length;
    show = order[di];
    SC.i = ((resume[show] ?? -1) + 1) % Math.max(1, SHOWS[show].scenes().length);
    designStart = Date.now();
    D.cut = null; D.cutFor = null;
    const frame = $(".show");
    if (frame && !instant && !RM.matches) {
      frame.classList.add("leaving");
      window.setTimeout(() => { if (!destroyed) renderFrame(true); }, 600);
    } else renderFrame(false);
  }
  function stepQueue() {
    const list = $$('[data-part="queue"] .q-list').filter(x => !x.closest(".scene.out,.show.leaving"))[0];
    const rest = Math.min(QUEUE_SPAN, Math.max(0, (M?.queue.length ?? 0) - 1)), visible = queueRows();
    if (!visible || rest <= visible) return;
    if (!list || instant || RM.matches) { VIEW.q++; renderPart("queue", false); return; }
    const li = list.firstElementChild as HTMLElement | null, h = li ? li.offsetHeight : 0;
    list.style.transition = "transform .5s cubic-bezier(0.22,1,0.36,1)";
    list.style.transform = `translateY(-${h}px)`;
    window.setTimeout(() => { VIEW.q++; renderPart("queue", false); }, 520);
  }
  function step(k: keyof Counters) {
    if (k === "q") return stepQueue();
    VIEW[k]++;
    if (k === "slide") renderPart("slides", true);
    else if (k === "feat") renderPart("featured", true);
    else if (k === "page") renderPart("finder", true);
    else if (k === "chan") renderPart("channel", true);
    else if (k === "dep") renderPart("nextboard", true);
    else if (k === "pl") renderPart("spot", true);
    else if (k === "mu") renderPart("matchup", true);
    else if (k === "ld") renderPart("leaders", true);
  }
  function rotate(t: number) {
    if (film?.playing()) return;
    if (t - SC.start >= curScene().dur) {
      if (order.length > 1 && t - designStart >= opts.eachMs) nextDesign();
      else advanceScene();
      return;
    }
    const r: Partial<Record<keyof Counters, number>> = show === "rotation" ? (curView ? VIEWS[curView].rot : {}) : { q: 4000 };
    for (const k of Object.keys(r) as (keyof Counters)[]) {
      const every = r[k]!;
      if (lastRot[k] === undefined) lastRot[k] = t;
      if (t - lastRot[k]! >= every) { lastRot[k] = t; step(k); }
    }
  }

  /* ---------- live updates from the feed ---------- */
  const courtSig = (m: TvModel) => m.courts.map(x => (x ? `${x.id}:${x.status}:${x.ending}` : "-")).join("|");
  const restSig = (m: TvModel) => `${m.queue.slice(0, 16).map(x => x.id).join(",")}|${m.results.slice(0, 12).map(x => x.id).join(",")}|${m.categories.map(c => `${c.id}:${c.finished}:${c.groups.length}`).join(",")}|${m.players.length}|${m.tournament.numCourts}`;
  function update(model: TvModel) {
    if (destroyed) return;
    const prev = M;
    M = model;
    preloadPhotos();
    if (!prev || prev.tournament.numCourts !== model.tournament.numCourts) { renderFrame(false); return; }
    // Calls and match points go to the front of the announcement line.
    for (const m of model.courts) {
      if (!m) continue;
      if (m.status === "called" && !ANN.calls.has(m.id)) { ANN.calls.add(m.id); if (prev.courts.every(x => x?.id !== m.id || x.status !== "called")) { filmYield(); annForce(callItem(model, m)); } }
      const b = pointBadge(m);
      if (b && b.text === "Match point" && !ANN.mp.has(m.id)) { ANN.mp.add(m.id); filmYield(); annForce(matchPointItem(model, m)); cutTo(m.court!, m); }
    }
    // Desk posts marked full screen take over once, when they are new.
    for (const d of model.messages) {
      if (takeoverSeen.has(d.id)) continue;
      takeoverSeen.add(d.id);
      if (!prev.messages.some(x => x.id === d.id)) {
        if (d.style === "full" && now() - d.postedAt < 120_000) { filmYield(); takeover(d.text, d.postedAt, d.id); }
        annForce(deskItem(d));
      }
    }
    if (TO && !model.messages.some(d => d.id === TO!.id)) endTakeover();
    if (courtSig(prev) !== courtSig(model) || restSig(prev) !== restSig(model)) { refreshParts(); return; }
    for (let c = 1; c <= model.tournament.numCourts; c++) {
      const a = prev.courts[c - 1], b = model.courts[c - 1];
      if (a && b && (a.cur[0] !== b.cur[0] || a.cur[1] !== b.cur[1])) patchCourt(c);
    }
  }
  /* sports TV: cut to a court the first time its match reaches match point */
  function cutTo(c: number, m: TvMatch) {
    if (show !== "sportstv" || D.cutFor === m.id) return;
    D.cutFor = m.id;
    const sc = curScene();
    if (!sc.feat || heroCourt({ v: VIEW, enter: false }) === c) return;
    D.cut = { court: c, until: now() + 15_000 };
    SC.start = Date.now();
    heroSwap(true);
  }

  /* ---------- loop ---------- */
  const timer = window.setInterval(() => {
    if (destroyed || !M) return;
    const t = Date.now();
    if (t - ANN.at >= 7000) { ANN.at = t; annStep(true); }
    filmCheck();
    rotate(t);
    if (t - lastFull >= 20_000) refreshParts();
    takeoverTick();
    progressTick();
    $$("[data-clock]").forEach(el => { el.innerHTML = clockHTML(); });
    $$("[data-sync]").forEach(el => { el.innerHTML = syncHTML(); });
  }, 250);

  return {
    update,
    destroy() {
      destroyed = true;
      window.clearInterval(timer);
      fontSet?.removeEventListener?.("loadingdone", onFontsLoaded);
      if (TK.anim) TK.anim.cancel();
      film?.destroy();
      stageEl.innerHTML = "";
    },
    debug: {
      goto(design: DesignKey, scene: number) {
        if (order.length > 1) di = Math.max(0, order.indexOf(design));
        show = order.length > 1 ? design : order[0];
        designStart = Date.now();
        SC.i = scene % Math.max(1, SHOWS[show].scenes().length);
        renderFrame(false);
        return sceneName(curScene());
      },
      sceneCount: () => SHOWS[show].scenes().length,
      turn(k: string) { if (k in VIEW) step(k as keyof Counters); return { ...VIEW }; },
      state: () => ({ show, scene: SC.i, board: sceneName(curScene()), live: M?.courts.filter(m => m?.status === "live").length ?? 0, queued: M?.queue.length ?? 0, results: M?.results.length ?? 0, messages: M?.messages.length ?? 0 }),
      setInstant(v: boolean) { instant = v; },
      film: () => !!film && film.play(afterFilm),
      filmStop: () => { film?.stop(); },
      check() {
        const R0 = stageEl.getBoundingClientRect(), out: string[][] = [];
        const BOX = ".scene,.panel,.court,.chip,.mcourt,.board,.feature,.bd-hero,.ann,.st,.takeover,.d-row,.q-row,.cl-row,.b-match,.res,.pl,.call-item,.ch-champ,.cl-mini,.channel,.hall,.fh-court,.sh-h,.ti,.sp,.sp-main,.sp-chips,.sp-ev,.sp-st,.sp-next,.sp-tag,.mu,.mu-head,.mu-side,.mu-pl,.mu-rec,.mu-r,.ld,.ld-hero,.ld-mid,.ld-row,.ld-er";
        const desc = (el: Element) => el.tagName.toLowerCase() + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "");
        for (const el of Array.from(stageEl.querySelectorAll("*"))) {
          if (el.closest(".scene.out,.art,.mc-lines,.qr,.deco")) continue;
          const r = el.getBoundingClientRect(); if (r.width < 0.5 && r.height < 0.5) continue;
          const cs = getComputedStyle(el); if (cs.visibility === "hidden") continue;
          const moving = el.closest(".st-track"), inWin = el.closest(".q-window");
          if (!moving && !inWin && (r.left < R0.left - 1 || r.right > R0.right + 1 || r.top < R0.top - 1 || r.bottom > R0.bottom + 1)) out.push(["outside the TV", desc(el)]);
          const box = !inWin && el.parentElement ? el.parentElement.closest(BOX) : null;
          if (box && (!moving || box.classList.contains("ti"))) { const b = box.getBoundingClientRect(); if (r.left < b.left - 2 || r.right > b.right + 2 || r.top < b.top - 2 || r.bottom > b.bottom + 2) out.push(["escapes " + desc(box), desc(el)]); }
          const he = el as HTMLElement;
          if (cs.textOverflow === "ellipsis" && he.scrollWidth > he.clientWidth + 1) out.push(["cut off", desc(el), (el.textContent ?? "").trim().slice(0, 48)]);
          if (moving || el.matches(".q-window,.st-view,.pts,.ann,.scene-wrap,.feature,.bd-hero")) continue;
          if ((cs.overflowY === "hidden" || cs.overflowY === "clip") && he.scrollHeight > he.clientHeight + 2) out.push(["clipped height", desc(el)]);
          if (cs.textOverflow !== "ellipsis" && (cs.overflowX === "hidden" || cs.overflowX === "clip") && he.scrollWidth > he.clientWidth + 2) out.push(["clipped width", desc(el)]);
        }
        return out;
      },
    },
  };
}
