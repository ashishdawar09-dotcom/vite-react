import { useCallback, useEffect, useState } from "react";
import type { Tournament } from "../../types";
import * as db from "../../lib/db";
import { toast } from "../../components/Toast";
import { hm, ampm } from "./tvTime";

/**
 * Admin TV tab: the link for the hall TV and the announcement box. A posted
 * message reaches every TV within a few seconds through the live feed and
 * comes round in the announcement line until it ends; "Full screen first"
 * also fills the TV for 15 seconds when it first arrives.
 */

const PICKS = [
  "Lunch is open in the cafeteria until 1:30 pm",
  "Prize giving at 6:00 pm on court 1",
  "Court 3 is paused for a few minutes",
  "Please keep the court area clear for players",
  "Lost and found is at the front desk",
];
const DURATIONS: { label: string; minutes: number | null }[] = [
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "Until I take it down", minutes: null },
];
const MAX = 120;

const card: React.CSSProperties = { background: "#0a1628", border: "1px solid #1a3050", borderRadius: 14, padding: 18, marginBottom: 16 };
const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, letterSpacing: 0.4, color: "#94a3b8", marginBottom: 6 };
const segBtn = (on: boolean): React.CSSProperties => ({ padding: "8px 12px", borderRadius: 8, border: `1px solid ${on ? "#00d4ff" : "#1a3050"}`, background: on ? "rgba(0,212,255,0.12)" : "#070F1F", color: on ? "#e0f9ff" : "#cbd5e1", fontSize: 13, fontWeight: 700, cursor: "pointer" });
const primary: React.CSSProperties = { padding: "10px 16px", borderRadius: 10, border: "none", background: "#00d4ff", color: "#00131A", fontSize: 14, fontWeight: 800, cursor: "pointer" };
const ghost: React.CSSProperties = { padding: "7px 12px", borderRadius: 8, border: "1px solid #1a3050", background: "transparent", color: "#e2e8f0", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };

/** Keeps "court 1" and "6:00 pm" together when the TV wraps a long message. */
const keepTogether = (t: string) => t.replace(/\b([Cc]ourts?) (\d)/g, "$1 $2").replace(/(\d) ?(am|pm)\b/gi, "$1 $2");

export function TvTab({ tournament }: { tournament: Tournament }) {
  const [messages, setMessages] = useState<db.TvMessageRow[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [text, setText] = useState("");
  const [style, setStyle] = useState<"line" | "full">("line");
  const [minutes, setMinutes] = useState<number | null>(30);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setMessages(await db.getTvMessages(tournament.id));
      setUnavailable(false);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      // 42703: the column isn't there yet (the database update hasn't been applied).
      if (code === "42703" || code === "PGRST204") setUnavailable(true);
    }
  }, [tournament.id]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(() => { setNow(Date.now()); void load(); }, 15_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [load]);

  const live = messages.filter(m => !m.until || new Date(m.until).getTime() > now);
  const tvUrl = `${window.location.origin}/t/${tournament.slug}/tv`;

  async function post() {
    const t = keepTogether(text.replace(/\s+/g, " ").trim()).slice(0, MAX);
    if (!t) { toast("Type a message first.", "warn"); return; }
    setBusy(true);
    try {
      setMessages(await db.postTvMessage(tournament.id, t, style, minutes));
      setText("");
      setNow(Date.now());
      toast("Posted. It shows on the TV within a few seconds.", "success");
    } catch (e) {
      toast((e as Error)?.message || "Couldn't post the announcement.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function takeDown(id: string) {
    setBusy(true);
    try {
      setMessages(await db.removeTvMessage(tournament.id, id));
      toast("Taken down. The TV goes back to its own messages.", "info");
    } catch (e) {
      toast((e as Error)?.message || "Couldn't take it down.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); toast("Link copied.", "success"); } catch { toast(url, "info"); }
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <span style={{ fontSize: 28 }} aria-hidden="true">📺</span>
        <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Venue TV</h2>
      </div>

      <section style={card} aria-labelledby="tv-link-h">
        <h3 id="tv-link-h" style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 800 }}>Link for the TV</h3>
        <p style={{ margin: "0 0 12px", color: "#94a3b8", fontSize: 14, lineHeight: 1.5 }}>Open it once on the hall TV. It runs by itself: all four designs take turns, with live scores, up next and your announcements.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <code style={{ flex: "1 1 260px", minWidth: 0, padding: "10px 12px", borderRadius: 8, background: "#070F1F", border: "1px solid #1a3050", color: "#e0f9ff", fontSize: 13, overflowWrap: "anywhere" }}>{tvUrl}</code>
          <button type="button" style={ghost} onClick={() => copy(tvUrl)}>Copy</button>
          <a href={tvUrl} target="_blank" rel="noreferrer" style={{ ...ghost, textDecoration: "none" }}>Open</a>
        </div>
        <p style={{ margin: "12px 0 0", color: "#64748b", fontSize: 13, lineHeight: 1.5 }}>A second TV can show one design only: add <code>?design=floor</code>, <code>?design=rotation</code>, <code>?design=pinned</code> or <code>?design=sports</code> to the link.</p>
      </section>

      <section style={card} aria-labelledby="tv-ann-h">
        <h3 id="tv-ann-h" style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 800 }}>Post an announcement</h3>
        {unavailable ? (
          <p style={{ margin: 0, color: "#fbbf24", fontSize: 14 }}>Announcements need a database update that isn't live yet.</p>
        ) : (
          <>
            <label htmlFor="tv-ann-text" style={label}>Message</label>
            <textarea
              id="tv-ann-text"
              value={text}
              maxLength={MAX}
              rows={3}
              placeholder="Lunch is open in the cafeteria until 1:30 pm"
              onChange={e => setText(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8, border: "1px solid #1a3050", background: "#070F1F", color: "#fff", fontSize: 16, lineHeight: 1.4, resize: "vertical", fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, margin: "4px 0 12px", fontSize: 12, color: "#64748b" }}>
              <span>Shows in large type on every TV</span><span>{text.length} of {MAX}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }} role="group" aria-label="Quick picks">
              {PICKS.map(p => <button key={p} type="button" style={{ ...ghost, borderRadius: 999, fontWeight: 600, fontSize: 12 }} onClick={() => setText(p)}>{p}</button>)}
            </div>
            <span style={label} id="tv-ann-style">How it shows</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }} role="group" aria-labelledby="tv-ann-style">
              <button type="button" style={segBtn(style === "line")} aria-pressed={style === "line"} onClick={() => setStyle("line")}>In the announcement line</button>
              <button type="button" style={segBtn(style === "full")} aria-pressed={style === "full"} onClick={() => setStyle("full")}>Full screen first</button>
            </div>
            <span style={label} id="tv-ann-for">Keep it up for</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }} role="group" aria-labelledby="tv-ann-for">
              {DURATIONS.map(d => <button key={d.label} type="button" style={segBtn(minutes === d.minutes)} aria-pressed={minutes === d.minutes} onClick={() => setMinutes(d.minutes)}>{d.label}</button>)}
            </div>
            <button type="button" style={{ ...primary, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={post}>Post to the TV</button>
          </>
        )}
      </section>

      {!unavailable && (
        <section style={card} aria-labelledby="tv-onair-h" aria-live="polite">
          <h3 id="tv-onair-h" style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 800 }}>On the TV now</h3>
          {live.length === 0 ? (
            <p style={{ margin: 0, color: "#94a3b8", fontSize: 14 }}>Nothing posted. The TV is showing calls, up next and results by itself.</p>
          ) : live.map(m => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: "1px solid #1a3050" }}>
              <p style={{ margin: 0, minWidth: 0, overflowWrap: "anywhere", fontSize: 15 }}>
                {m.text}
                <span style={{ display: "block", marginTop: 2, color: "#64748b", fontSize: 12 }}>
                  {m.style === "full" ? "Full screen first, then the line" : "In the announcement line"} · {m.until ? `until ${hm(new Date(m.until).getTime())} ${ampm(new Date(m.until).getTime())}` : "until you take it down"}
                </span>
              </p>
              <button type="button" style={ghost} disabled={busy} onClick={() => takeDown(m.id)}>Take down</button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
