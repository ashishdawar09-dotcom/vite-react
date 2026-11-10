import { useCallback, useEffect, useMemo, useState } from "react";
import type { Player, Tournament } from "../../types";
import * as db from "../../lib/db";
import { toast } from "../../components/Toast";
import { hm, ampm } from "../venueTv/tvTime";
import { briefingCounts, type BriefingCounts } from "./model";
import { DeskAlertsCard } from "./DeskAlertsCard";

/**
 * Admin Emails tab: the full-house thank-you, the two player briefings (the
 * day before, and the morning of) and every race-day email that didn't reach
 * its player. Each
 * player gets a briefing once; a send that stops partway carries on where it
 * left off. Delivery comes back from Resend (resend-webhook).
 */

type Kind = "full_house" | "day_before" | "morning_of";

const card: React.CSSProperties = { background: "#0a1628", border: "1px solid #1a3050", borderRadius: 14, padding: 18, marginBottom: 16, color: "#e2e8f0" };
const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: "#94a3b8", marginBottom: 6 };
const primary: React.CSSProperties = { padding: "10px 16px", borderRadius: 10, border: "none", background: "#00d4ff", color: "#00131A", fontSize: 14, fontWeight: 800, cursor: "pointer" };
const ghost: React.CSSProperties = { padding: "9px 14px", borderRadius: 10, border: "1px solid #1a3050", background: "transparent", color: "#e2e8f0", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: "1px solid #1a3050", background: "#070F1F", color: "#fff", fontSize: 16, lineHeight: 1.4, fontFamily: "inherit" };
const muted: React.CSSProperties = { margin: "0 0 12px", color: "#94a3b8", fontSize: 14, lineHeight: 1.5 };

const NOTES_MAX = 600;
const COPY: Record<Kind, { title: string; blurb: string; sendLabel: string }> = {
  full_house: {
    title: "Full house",
    blurb: "A thank-you to every player now that all entries are taken: the FULL HOUSE animation, their events, partners still to enter go to the directors, friends go to the waitlist, and more details in the coming days. It only sends once the tournament is full.",
    sendLabel: "Send",
  },
  day_before: {
    title: "Day-before briefing",
    blurb: "Each player gets their own events and partners, their first match when you've set a time for it, the venue, and links to the live page and their player page. Send it on Nov 20.",
    sendLabel: "Send",
  },
  morning_of: {
    title: "Morning-of reminder",
    blurb: "A short game-day email: first serve, check in at the desk, and their first match if it has a time. Schedule it the night before; Resend holds it until the time you pick.",
    sendLabel: "Schedule",
  },
};

// Venue time is UTC-7 all year (BC from Nov 1, 2026). The input's value is a
// wall-clock "2026-11-21T07:00" at the venue.
const toIso = (local: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? `${local}:00-07:00` : null);
const when = (iso: string) => {
  const ms = new Date(iso).getTime();
  const day = new Date(ms).toLocaleDateString("en-CA", { timeZone: "Etc/GMT+7", weekday: "short", month: "short", day: "numeric" });
  return `${day}, ${hm(ms)} ${ampm(ms)}`;
};

const readNote = (k: Kind) => { try { return localStorage.getItem(`briefing-notes-${k}`) ?? ""; } catch { return ""; } };
const saveNote = (k: Kind, v: string) => { try { localStorage.setItem(`briefing-notes-${k}`, v); } catch { /* private mode */ } };

export function PlayerEmailsTab({ tournament, players }: { tournament: Tournament; players: Player[] }) {
  const [rows, setRows] = useState<db.BriefingEmailRow[]>([]);
  const [courtProblems, setCourtProblems] = useState<db.BriefingProblemRow[]>([]);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, c] = await Promise.all([db.getBriefingEmails(tournament.id), db.getCourtCallProblems(tournament.id)]);
      setRows(b);
      setCourtProblems(c);
      setUnavailable(false);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      // The table or columns aren't there yet: the database update hasn't been applied.
      if (code === "42P01" || code === "42703" || code === "PGRST205" || code === "PGRST204") setUnavailable(true);
    }
  }, [tournament.id]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [load]);

  const nameById = useMemo(() => new Map(players.map(p => [p.id, p.name])), [players]);
  const emailById = useMemo(() => new Map(players.map(p => [p.id, p.email ?? ""])), [players]);

  const briefingProblems = useMemo(() => (["full_house", "day_before", "morning_of"] as Kind[]).flatMap(k =>
    briefingCounts(rows, k).problems.map(p => ({ ...p, what: COPY[k].title }))), [rows]);
  const courtList = useMemo(() => {
    // Latest problem per player: one line each, however many calls bounced.
    const seen = new Set<string>();
    return courtProblems.filter(r => (seen.has(r.player_id) ? false : (seen.add(r.player_id), true)));
  }, [courtProblems]);

  return (
    <div style={{ maxWidth: 820, color: "#e2e8f0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <span style={{ fontSize: 28 }} aria-hidden="true">✉️</span>
        <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: "#f8fafc" }}>Player emails</h2>
      </div>

      <DeskAlertsCard tournament={tournament} />

      {unavailable ? (
        <section style={card}>
          <p style={{ margin: 0, color: "#fbbf24", fontSize: 14 }}>Player emails need a database update that isn't live yet.</p>
        </section>
      ) : (
        <>
          <BriefingCard kind="full_house" tournament={tournament} counts={briefingCounts(rows, "full_house")} onChanged={load} />
          <BriefingCard kind="day_before" tournament={tournament} counts={briefingCounts(rows, "day_before")} onChanged={load} />
          <BriefingCard kind="morning_of" tournament={tournament} counts={briefingCounts(rows, "morning_of")} onChanged={load} />

          <section style={card} aria-labelledby="em-problems-h" aria-live="polite">
            <h3 id="em-problems-h" style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 800 }}>Emails that didn't arrive</h3>
            <p style={muted}>Bounces and failed sends, for briefings and court calls. Fix the address on the player's profile, or tell them at check-in.</p>
            {briefingProblems.length === 0 && courtList.length === 0 ? (
              <p style={{ margin: 0, color: "#4ade80", fontSize: 14 }}>None so far.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {[...briefingProblems.map(p => ({ key: `b-${p.what}-${p.player_id}`, player_id: p.player_id, what: p.what, reason: p.reason })),
                  ...courtList.map(r => ({
                    key: `c-${r.player_id}`, player_id: r.player_id, what: "Court call",
                    reason: r.status === "failed" ? `couldn't send (${r.error_message ?? "error"})` : `${r.delivery_status}${r.delivery_detail ? `: ${r.delivery_detail}` : ""}`,
                  }))].map(p => (
                  <li key={p.key} style={{ padding: "10px 0", borderTop: "1px solid #1a3050", fontSize: 14, lineHeight: 1.45 }}>
                    <strong style={{ color: "#f8fafc" }}>{nameById.get(p.player_id) ?? "Removed player"}</strong>
                    <span style={{ color: "#94a3b8" }}> · {emailById.get(p.player_id) || "no email"}</span>
                    <span style={{ display: "block", color: "#fca5a5", fontSize: 13, overflowWrap: "anywhere" }}>{p.what}: {p.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function BriefingCard({ kind, tournament, counts, onChanged }: {
  kind: Kind; tournament: Tournament; counts: BriefingCounts; onChanged: () => Promise<void> | void;
}) {
  const copy = COPY[kind];
  const [notes, setNotes] = useState(() => readNote(kind));
  const [at, setAt] = useState(() => (tournament.event_date ? `${tournament.event_date}T07:00` : ""));
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<db.BriefingResponse | null>(null);
  const id = (s: string) => `em-${kind}-${s}`;
  const base = { tournament_id: tournament.id, kind, notes: notes.trim() || null } as const;

  useEffect(() => saveNote(kind, notes), [kind, notes]);

  async function doPreview() {
    setBusy("preview");
    const r = await db.playerBriefing({ action: "preview", ...base });
    setBusy(null);
    if (r.error) { toast(r.error, "error"); return; }
    setPreview(r);
  }

  async function doTest() {
    setBusy("test");
    const r = await db.playerBriefing({ action: "test", ...base });
    setBusy(null);
    if (r.error) toast(r.error, "error");
    else toast(`Test sent to ${r.sent_to}. It's the email ${preview?.player ?? "the first player"} would get.`, "success");
  }

  async function doSend() {
    const scheduledAt = kind === "morning_of" ? toIso(at) : null;
    if (kind === "morning_of" && !scheduledAt) { toast("Pick a date and time first.", "warn"); return; }
    const p = await db.playerBriefing({ action: "preview", ...base });
    if (p.error) { toast(p.error, "error"); return; }
    const todo = (p.eligible ?? 0) - (p.already ?? 0);
    if (todo <= 0) { toast("Everyone with an email address already has this one.", "info"); return; }
    const what = kind === "full_house" ? "full-house email" : copy.title.toLowerCase();
    const ask = scheduledAt
      ? `Schedule the ${what} for ${todo} player${todo === 1 ? "" : "s"}, to arrive ${when(scheduledAt)}?`
      : `Send the ${what} to ${todo} player${todo === 1 ? "" : "s"} now? This can't be undone.`;
    if (!window.confirm(ask)) return;
    let done = 0, failed = 0;
    setBusy(`0 of ${todo}`);
    try {
      for (let round = 0; round < 20; round++) {
        const r = await db.playerBriefing({ action: "send", ...base, scheduled_at: scheduledAt });
        if (r.error) { toast(r.error, "error"); break; }
        done += (r.sent ?? 0) + (r.scheduled ?? 0);
        failed += r.failed ?? 0;
        setBusy(`${done} of ${todo}`);
        if (r.stop) { toast(`Stopped: ${r.errors?.[0] ?? "the emails couldn't be sent."}`, "error"); break; }
        if (!r.remaining || (r.sent ?? 0) + (r.scheduled ?? 0) + (r.failed ?? 0) === 0) break;
      }
    } finally {
      setBusy(null);
      await onChanged();
    }
    if (done) toast(`${scheduledAt ? "Scheduled" : "Sent"} for ${done} player${done === 1 ? "" : "s"}${failed ? `. ${failed} failed; press ${copy.sendLabel} again to retry them.` : "."}`, failed ? "warn" : "success");
  }

  async function doCancel() {
    if (!window.confirm(`Cancel the ${counts.scheduled} scheduled email${counts.scheduled === 1 ? "" : "s"}? You can schedule them again after.`)) return;
    setBusy("cancelling");
    let cancelled = 0;
    try {
      for (let round = 0; round < 20; round++) {
        const r = await db.playerBriefing({ action: "cancel", tournament_id: tournament.id, kind });
        if (r.error) { toast(r.error, "error"); break; }
        cancelled += r.cancelled ?? 0;
        if (r.stop || !r.remaining) break;
      }
    } finally {
      setBusy(null);
      await onChanged();
    }
    toast(`Cancelled ${cancelled}.`, "info");
  }

  const status = [
    counts.sent && `${counts.sent} sent`,
    counts.scheduled && `${counts.scheduled} scheduled${counts.scheduledFor ? ` for ${when(counts.scheduledFor)}` : ""}`,
    counts.delivered && `${counts.delivered} delivered`,
    counts.failed && `${counts.failed} failed`,
  ].filter(Boolean).join(" · ");

  return (
    <section style={card} aria-labelledby={id("h")}>
      <h3 id={id("h")} style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 800 }}>{copy.title}</h3>
      <p style={muted}>{copy.blurb}</p>
      <p style={{ margin: "0 0 14px", fontSize: 14, color: status ? "#e0f9ff" : "#64748b" }} aria-live="polite">{status || "Not sent yet."}</p>

      <label htmlFor={id("notes")} style={label}>Note from the directors (optional)</label>
      <textarea
        id={id("notes")}
        value={notes}
        maxLength={NOTES_MAX}
        rows={3}
        placeholder="For example: where to park, what to bring, where lunch is"
        onChange={e => setNotes(e.target.value)}
        style={{ ...input, resize: "vertical" }}
      />
      <div style={{ textAlign: "right", margin: "4px 0 12px", fontSize: 12, color: "#64748b" }}>{notes.length} of {NOTES_MAX}</div>

      {kind === "morning_of" && (
        <>
          <label htmlFor={id("at")} style={label}>Arrives at (venue time)</label>
          <input id={id("at")} type="datetime-local" value={at} onChange={e => setAt(e.target.value)} style={{ ...input, maxWidth: 280, marginBottom: 14, colorScheme: "dark" }} />
        </>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={ghost} disabled={!!busy} onClick={doPreview}>{busy === "preview" ? "Loading…" : "Preview"}</button>
        <button type="button" style={ghost} disabled={!!busy} onClick={doTest}>{busy === "test" ? "Sending…" : "Send me a test"}</button>
        <button type="button" style={{ ...primary, opacity: busy ? 0.6 : 1 }} disabled={!!busy} onClick={doSend}>
          {busy && busy.includes(" of ") ? `${kind === "morning_of" ? "Scheduling" : "Sending"} ${busy}…` : `${copy.sendLabel} to players`}
        </button>
        {counts.scheduled > 0 && (
          <button type="button" style={{ ...ghost, borderColor: "#7f1d1d", color: "#fca5a5" }} disabled={!!busy} onClick={doCancel}>
            {busy === "cancelling" ? "Cancelling…" : "Cancel scheduled"}
          </button>
        )}
      </div>

      {preview?.html && (
        <div style={{ marginTop: 16 }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#94a3b8" }}>
            What {preview.player} gets · {preview.eligible} players with an email{preview.already ? ` · ${preview.already} already have it` : ""}{preview.no_email ? ` · ${preview.no_email} without an email` : ""}
          </p>
          <p style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 700 }}>Subject: {preview.subject}</p>
          <iframe
            title={`${copy.title} preview`}
            srcDoc={preview.html}
            sandbox=""
            style={{ width: "100%", height: 560, border: "1px solid #1a3050", borderRadius: 10, background: "#06080D" }}
          />
          <button type="button" style={{ ...ghost, marginTop: 8 }} onClick={() => setPreview(null)}>Close preview</button>
        </div>
      )}
    </section>
  );
}
