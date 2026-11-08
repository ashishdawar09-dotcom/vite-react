import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { renderSVG } from "uqr";
import * as db from "../../lib/db";
import { useScheduling } from "../../hooks/useScheduling";
import { buildTvModel, type TvSnapshot } from "./tvModel";
import { createTvShow, type DesignKey, type TvShow } from "./tvEngine";
import { clockSkewMs } from "./tvTime";

/**
 * Venue TV show, /t/:slug/tv. Hands off: open it once on the hall TV and it
 * runs all day. All four designs take turns like a screensaver unless the
 * link names one.
 *
 *   ?design=rotation | pinned | floor | sports   one design only (a second TV)
 *   ?each=180                                      seconds per design (30 to 1800)
 *   ?colours=navy                                  the live page's navy instead of volt
 *
 * The old single-screen TV page is still at /t/:slug/tv/classic.
 */

// Smart TV browsers can be a few years behind. The shared snapshot fetch uses
// AbortSignal.timeout (Chromium 103+); without it every fetch of the cached
// feed would fail and the TV would drop to the slow 30 s fallback.
if (typeof AbortSignal !== "undefined" && typeof (AbortSignal as unknown as { timeout?: unknown }).timeout !== "function") {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = (ms: number) => {
    const c = new AbortController();
    setTimeout(() => c.abort(), ms);
    return c.signal;
  };
}

const POLL_LIVE_MS = 5_000;
const POLL_IDLE_MS = 15_000;
const STAGE_W = 1920;
const STAGE_H = 1080;
/** Small shifts every few minutes so nothing stays on exactly the same pixels all day. */
const BURN_IN_STEPS: [number, number][] = [[0, 0], [2, 1], [-1, 2], [-2, -1], [1, -2]];
const BURN_IN_EVERY_MS = 4 * 60_000;

const DESIGN_ALIASES: Record<string, DesignKey> = { rotation: "rotation", pinned: "pinned", floor: "floorhome", floorhome: "floorhome", sports: "sportstv", sportstv: "sportstv" };

function readOptions(search: string) {
  const p = new URLSearchParams(search);
  const design = DESIGN_ALIASES[(p.get("design") ?? "").toLowerCase()] ?? null;
  const each = Number(p.get("each"));
  const eachMs = Number.isFinite(each) && each > 0 ? Math.min(1800, Math.max(30, each)) * 1000 : 180_000;
  const colours = (p.get("colours") ?? p.get("colors") ?? p.get("theme") ?? "").toLowerCase() === "navy" ? "navy" : "volt";
  return { design, eachMs, colours, debug: p.get("debug") === "1" } as const;
}

type Feed = { snap: TvSnapshot | null; receivedAt: number; failures: number };

/**
 * One poll loop for the TV: the cached /api/snapshot feed (RPC fallback, see
 * db.liveSnapshot) every 5 s while anything is on court, 15 s otherwise. A
 * single timer, never two requests at once, so a TV that sleeps and wakes
 * cannot multiply its polling.
 */
function useTvFeed(tournamentId: string | null): Feed {
  const [feed, setFeed] = useState<Feed>({ snap: null, receivedAt: 0, failures: 0 });
  useEffect(() => {
    if (!tournamentId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    const schedule = (ms: number) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, ms);
    };
    async function tick() {
      timer = null;
      if (cancelled || inFlight) return;
      if (document.hidden) { schedule(POLL_IDLE_MS); return; }
      inFlight = true;
      let busy = false;
      try {
        const snap = (await db.liveSnapshot(tournamentId!)) as TvSnapshot | null;
        if (cancelled) return;
        if (snap && snap.tournament) {
          busy = snap.matches.some(m => m.status === "live" || (m.status === "pending" && m.court_number != null && !!m.court_allocated_at));
          setFeed({ snap, receivedAt: Date.now(), failures: 0 });
        } else {
          setFeed(f => ({ ...f, failures: f.failures + 1 }));
        }
      } catch {
        if (!cancelled) setFeed(f => ({ ...f, failures: f.failures + 1 }));
      } finally {
        inFlight = false;
      }
      schedule(db.liveSnapshotPollDelay(busy ? POLL_LIVE_MS : POLL_IDLE_MS));
    }
    const onVisible = () => { if (!document.hidden && !inFlight) schedule(0); };
    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tournamentId]);
  return feed;
}

export function TvShowPage() {
  const { slug } = useParams<{ slug: string }>();
  const options = useMemo(() => readOptions(window.location.search), []);
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pageRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const showRef = useRef<TvShow | null>(null);
  const skewRef = useRef(0);
  const [idle, setIdle] = useState(false);

  // Resolve the slug, retrying through Wi-Fi drops (5 s, 10 s, 20 s, then every 30 s).
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    db.getTournamentBySlug(slug)
      .then(t => { if (cancelled) return; if (t) setTournamentId(t.id); else setNotFound(true); })
      .catch(() => { if (!cancelled) retry = setTimeout(() => setAttempt(a => a + 1), Math.min(5_000 * 2 ** attempt, 30_000)); });
    return () => { cancelled = true; if (retry) clearTimeout(retry); };
  }, [slug, attempt]);

  const feed = useTvFeed(tournamentId);
  const snap = feed.snap;
  const scheduling = useScheduling(snap?.matches ?? [], snap?.categories ?? [], snap?.tournament?.num_courts ?? 4);

  // Shown under the scan code and in the strip. A preview's long vercel.app
  // host would wrap onto several lines, so long hosts are shortened.
  const host = window.location.host;
  const shownHost = host.length > 28 ? `${host.slice(0, 12)}…${host.slice(-14)}` : host;
  const siteUrl = `${shownHost}/t/${slug ?? ""}`;
  const qrSvg = useMemo(() => renderSVG(`${window.location.origin}/t/${slug ?? ""}`, { ecc: "M", border: 1, pixelSize: 8 }), [slug]);

  // Start the show once the first snapshot is in, then feed it every new one.
  // A model rebuild every 15 s keeps estimates and "Final score" holds moving
  // between snapshots.
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(x => x + 1), 15_000); return () => clearInterval(id); }, []);
  useEffect(() => {
    if (!snap || !stageRef.current) return;
    skewRef.current = clockSkewMs(snap.generated_at ?? null, feed.receivedAt);
    const now = Date.now() + skewRef.current;
    const model = buildTvModel(snap, now, scheduling.byId);
    if (!model) return;
    if (!showRef.current) {
      showRef.current = createTvShow(stageRef.current, {
        design: options.design,
        eachMs: options.eachMs,
        now: () => Date.now() + skewRef.current,
        siteUrl,
        qrSvg,
      });
      if (options.debug) (window as unknown as { __tvshow?: TvShow["debug"] }).__tvshow = showRef.current.debug;
    }
    showRef.current.update(model);
  }, [snap, feed.receivedAt, scheduling.byId, tick, options, siteUrl, qrSvg]);
  useEffect(() => () => { showRef.current?.destroy(); showRef.current = null; }, []);

  // Scale the 1920x1080 stage to the screen, with a tiny shift every few minutes.
  useEffect(() => {
    const page = pageRef.current, stage = stageRef.current;
    if (!page || !stage) return;
    let step = 0;
    const fit = () => {
      const w = page.clientWidth, h = page.clientHeight;
      if (!w || !h) return;
      const s = Math.min(w / STAGE_W, h / STAGE_H);
      const [dx, dy] = BURN_IN_STEPS[step % BURN_IN_STEPS.length];
      stage.style.transform = `translate(${(w - STAGE_W * s) / 2 + dx}px, ${(h - STAGE_H * s) / 2 + dy}px) scale(${s})`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(page);
    const shift = setInterval(() => { step++; fit(); }, BURN_IN_EVERY_MS);
    return () => { ro.disconnect(); clearInterval(shift); };
  }, [tournamentId, notFound]);

  // Keep the screen awake where the browser allows it (it is released whenever the page is hidden).
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<Sentinel> } };
    if (!nav.wakeLock) return;
    let lock: Sentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      if (document.hidden || !nav.wakeLock) return;
      nav.wakeLock.request("screen").then(l => { if (cancelled) void l.release().catch(() => {}); else lock = l; }).catch(() => {});
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", acquire); if (lock) void lock.release().catch(() => {}); };
  }, []);

  // A laptop on HDMI: hide the pointer after a few seconds; one click or key goes full screen.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const wake = () => { setIdle(false); if (t) clearTimeout(t); t = setTimeout(() => setIdle(true), 3_000); };
    const full = () => { if (!document.fullscreenElement && document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(() => {}); };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("click", full);
    window.addEventListener("keydown", full);
    return () => { if (t) clearTimeout(t); window.removeEventListener("mousemove", wake); window.removeEventListener("click", full); window.removeEventListener("keydown", full); };
  }, []);

  useEffect(() => { document.title = snap?.tournament?.name ? `${snap.tournament.name} · TV` : "Venue TV"; }, [snap?.tournament?.name]);

  if (notFound || !slug) return <div className="tvs-msg"><p><b>Tournament not found</b>Check the link on the TV.</p></div>;
  return (
    <div ref={pageRef} className={`tvs-page${options.colours === "navy" ? " navy" : ""}${idle ? " idle" : ""}`} aria-label="Venue TV">
      <div ref={stageRef} className="tvs-stage" data-theme={options.colours} />
      {!snap && <div className="tvs-msg"><p><b>Getting the latest scores</b>{feed.failures > 0 ? "Still connecting. This screen keeps trying by itself." : "One moment."}</p></div>}
    </div>
  );
}

