import { useCallback, useEffect, useState } from "react";
import type { Tournament } from "../../types";
import * as db from "../../lib/db";
import { toast } from "../../components/Toast";
import { ON_DECK_COUNT, ON_DECK_WITHIN_MIN } from "../../hooks/useOnDeckAlerts";
import { hm, ampm } from "../venueTv/tvTime";

/**
 * Emails tab: the race-day desk's two automatic messages, each with an
 * on/off switch.
 * - "You're up soon": the players of a match about to be called get an
 *   email and a phone alert (notify-on-deck, sent from the desk's app).
 * - Desk monitor: on the day, every 10 minutes, the race-monitor function
 *   checks the courts and the plan and emails the director what needs them.
 */

const card: React.CSSProperties = { background: "#0a1628", border: "1px solid #1a3050", borderRadius: 14, padding: 18, marginBottom: 16, color: "#e2e8f0" };
const sub: React.CSSProperties = { borderTop: "1px solid #1a3050", paddingTop: 14, marginTop: 14 };
const muted: React.CSSProperties = { margin: "0 0 10px", color: "#94a3b8", fontSize: 14, lineHeight: 1.5 };
const primary: React.CSSProperties = { padding: "10px 16px", borderRadius: 10, border: "none", background: "#00d4ff", color: "#00131A", fontSize: 14, fontWeight: 800, cursor: "pointer" };
const ghost: React.CSSProperties = { padding: "9px 14px", borderRadius: 10, border: "1px solid #1a3050", background: "transparent", color: "#e2e8f0", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
const input: React.CSSProperties = { flex: "1 1 240px", minWidth: 0, boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: "1px solid #1a3050", background: "#070F1F", color: "#fff", fontSize: 16, lineHeight: 1.4, fontFamily: "inherit" };
const pill = (on: boolean): React.CSSProperties => ({
  display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 800, letterSpacing: 0.5,
  background: on ? "rgba(34,197,94,0.15)" : "rgba(148,163,184,0.15)", color: on ? "#4ade80" : "#94a3b8",
});
const clock = (iso: string) => { const ms = Date.parse(iso); return `${hm(ms)} ${ampm(ms)}`; };

export function DeskAlertsCard({ tournament }: { tournament: Tournament }) {
  const [s, setS] = useState<db.RaceDaySettings | null>(null);
  const [alerted, setAlerted] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [emailTo, setEmailTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [settings, n] = await Promise.all([db.getRaceDaySettings(tournament.id), db.countOnDeckAlerts(tournament.id)]);
      setS(settings);
      setAlerted(n);
      setUnavailable(false);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      // The tables aren't there yet: the database update hasn't been applied.
      if (code === "42P01" || code === "42703" || code === "PGRST205" || code === "PGRST204") setUnavailable(true);
    }
  }, [tournament.id]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [load]);

  const save = async (patch: Parameters<typeof db.setRaceDaySettings>[1], done: string) => {
    setBusy(true);
    try {
      await db.setRaceDaySettings(tournament.id, patch);
      toast(done, "success");
      await load();
    } catch (e) {
      toast((e as { message?: string })?.message ?? "Couldn't save", "error");
    } finally {
      setBusy(false);
    }
  };

  const sendStatus = async () => {
    setBusy(true);
    try {
      const r = await db.sendMonitorStatusNow(tournament.id);
      if (r.sent) toast(`Status sent to ${s?.monitor_email_to ?? "you"}${r.alerts ? ` (${r.alerts} to act on)` : ""}.`, "success");
      else toast(r.error ?? "Couldn't send the status", "error");
    } catch (e) {
      toast((e as { message?: string })?.message ?? "Couldn't send the status", "error");
    } finally {
      setBusy(false);
    }
  };

  if (unavailable) {
    return (
      <section style={card}>
        <p style={{ margin: 0, color: "#fbbf24", fontSize: 14 }}>The race-day desk alerts need a database update that isn't live yet.</p>
      </section>
    );
  }
  if (!s) return null;

  const plan = s.monitor_plan;
  const ends = (plan?.ends ?? []).filter(x => Number.isFinite(Date.parse(x))).sort();
  const lastCheck = s.monitor_state?.last_run_at ?? null;
  const draft = emailTo ?? s.monitor_email_to ?? "";

  return (
    <section style={card} aria-labelledby="desk-alerts-h">
      <h3 id="desk-alerts-h" style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 800 }}>Race-day desk alerts</h3>
      <p style={muted}>Two automatic messages on the day. Turn either off here at any time.</p>

      <div style={sub}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
          <strong style={{ fontSize: 15 }}>“You're up soon” for players</strong>
          <span style={pill(s.on_deck_alerts)} aria-live="polite">{s.on_deck_alerts ? "On" : "Off"}</span>
        </div>
        <p style={muted}>
          When a match is one of the next {ON_DECK_COUNT} in Up next and its court call is {ON_DECK_WITHIN_MIN} minutes away or less, its players get an
          email and a phone alert to stay close to the courts. Once per match, on the tournament's day only. It's sent from the desk's app, so keep the
          app open on the desk.{alerted ? ` ${alerted} match${alerted === 1 ? "" : "es"} alerted so far.` : ""}
        </p>
        <button type="button" disabled={busy} style={s.on_deck_alerts ? ghost : primary}
          onClick={() => save({ on_deck_alerts: !s.on_deck_alerts }, s.on_deck_alerts ? "“You're up soon” alerts are off." : "“You're up soon” alerts are on.")}>
          {s.on_deck_alerts ? "Turn off" : "Turn on"}
        </button>
      </div>

      <div style={sub}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
          <strong style={{ fontSize: 15 }}>Desk monitor emails</strong>
          <span style={pill(s.monitor_on)} aria-live="polite">{s.monitor_on ? "On" : "Off"}</span>
        </div>
        <p style={muted}>
          On the day, 8:30 am to 9 pm, it checks every 10 minutes and emails you when something needs you: an empty court while matches wait, a called
          match that hasn't started, a match running long, groups done with no knockout, an event with no draw, or the day falling behind the plan.
          Plus a short status every 30 minutes.
        </p>
        <p style={{ ...muted, color: ends.length ? "#e0f9ff" : "#94a3b8" }}>
          {ends.length
            ? `Day plan loaded: ${ends.length} matches, last one about ${clock(ends[ends.length - 1])}.`
            : "No day plan loaded: it checks the courts and events only."}
          {lastCheck ? ` Last check ${clock(lastCheck)}.` : ""}
        </p>
        <label htmlFor="desk-monitor-to" style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>Send to (up to 3 addresses, comma separated)</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <input id="desk-monitor-to" type="text" inputMode="email" autoComplete="off" value={draft} onChange={e => setEmailTo(e.target.value)} style={input} />
          <button type="button" disabled={busy || draft.trim() === (s.monitor_email_to ?? "")} style={ghost}
            onClick={() => save({ monitor_email_to: draft.trim() }, "Saved.").then(() => setEmailTo(null))}>Save</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" disabled={busy || (!s.monitor_on && !s.monitor_email_to)} style={s.monitor_on ? ghost : primary}
            onClick={() => save({ monitor_on: !s.monitor_on }, s.monitor_on ? "Desk monitor is off." : "Desk monitor is on.")}>
            {s.monitor_on ? "Turn off" : "Turn on"}
          </button>
          <button type="button" disabled={busy || !s.monitor_email_to} style={ghost} onClick={sendStatus}>Send me a status now</button>
        </div>
      </div>
    </section>
  );
}
