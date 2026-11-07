// The screen after an entry is in: what happens next, a link to bring a
// partner or friend, and optional WhatsApp and push updates.

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { pushSupportStatus, subscribeToPush } from "../../lib/push";
import { formatClubNumber, optinCode, optinLink } from "../../lib/whatsapp";
import { captureError } from "../../lib/sentry";
import { trackEvent } from "../../lib/analytics";
import type { Tournament } from "../../types";
import { Button, Mark, Note, Panel } from "./ss/parts";
import { monoLabel, ss } from "./ss/theme";

// Where friends land: the Shuttle Storm site, tagged so shares are counted.
export const SHARE_URL = "https://shuttlestorm.adawar.org/?utm_source=player_share&utm_medium=referral&utm_campaign=bring_a_partner";

export function Success({ tournament, events, playerName, paidByCard, registrationId, namedPartners, onAnother }: {
  tournament: Tournament;
  events: string[];
  playerName: string;
  paidByCard: boolean;
  registrationId: string | null;
  // How many partners were named with an email (they get the waiver link).
  namedPartners: number;
  onAnother: () => void;
}) {
  const reduce = useReducedMotion();
  const first = playerName.trim().split(/\s+/)[0];
  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <div style={{ padding: "26px 0 8px" }}>
        <span aria-hidden="true" style={{
          width: 64, height: 64, borderRadius: 64, display: "grid", placeItems: "center",
          background: ss.volt, boxShadow: "0 0 0 10px rgba(212,255,58,.08), 0 18px 50px -12px rgba(212,255,58,.5)",
        }}>
          <svg width="28" height="22" viewBox="0 0 28 22"><path d="M2.5 11.5l7.5 7.5L25.5 3" fill="none" stroke={ss.ink} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <h1 className="ss-h-hero ss-hero-text ss-balance" style={{ margin: "24px 0 0", fontFamily: ss.display, maxWidth: 680 }}>
          {paidByCard ? "Payment received" : "Entry received"}
        </h1>
        <p style={{ margin: "16px 0 0", fontSize: 16, lineHeight: "24px", color: ss.body }}>
          {first ? `Thanks, ${first}. ` : "Thanks. "}
          {paidByCard
            ? "Your card payment went through and your entry is with the directors. They'll confirm your spot by email. Stripe has emailed your receipt; it shows on your statement as ADAWAR* SHUTTLE STORM."
            : "The directors will check your e-Transfer and confirm your spot by email. You'll appear in the player list once you're approved."}
        </p>
      </div>

      {events.length > 0 && (
        <Panel style={{ padding: "6px 18px", marginTop: 20 }}>
          {events.map((name) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${ss.line}` }}>
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 6, background: ss.volt }} />
              <span style={{ color: ss.bone, fontSize: 14, lineHeight: "20px" }}>{name}</span>
            </div>
          ))}
          <div style={{ ...monoLabel, padding: "12px 0" }}>{tournament.name}</div>
        </Panel>
      )}
      {namedPartners > 0 && tournament.waiver_text && (
        <p style={{ margin: "4px 0 18px", fontSize: 14, lineHeight: "20px", color: ss.mute }}>
          We've emailed your partner{namedPartners > 1 ? "s" : ""} what they still need to do before they can play.
        </p>
      )}

      <ShareCard />

      {tournament.whatsapp_enabled && tournament.whatsapp_number && registrationId && (
        <WhatsAppOptIn clubNumber={tournament.whatsapp_number} tournamentName={tournament.name} registrationId={registrationId} />
      )}
      {registrationId && <PushOptIn tournamentId={tournament.id} pendingRegistrationId={registrationId} />}

      <div style={{ marginTop: 26, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <Button variant="ghost" onClick={onAnother}>Enter another event</Button>
        <a className="ss-link" href="https://shuttlestorm.adawar.org/" style={{ color: ss.body, fontSize: 14, lineHeight: "20px" }}>Back to Shuttle Storm</a>
      </div>
      {/* Room for the chat button (ChatWithUs), so the last line scrolls clear of it. */}
      {tournament.whatsapp_number && <div aria-hidden="true" style={{ height: "calc(48px + env(safe-area-inset-bottom, 0px))" }} />}
    </motion.div>
  );
}

// "Bring a partner": the cheapest new entries come from friends of players.
function ShareCard() {
  const [copied, setCopied] = useState(false);
  const text = "I've entered Shuttle Storm '26, Abbotsford's badminton tournament on Sat Nov 21. Singles and doubles, ages 13 to 50+, and they'll find you a partner. Join me:";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const wa = `https://wa.me/?text=${encodeURIComponent(`${text} ${SHARE_URL}`)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      setCopied(true);
      trackEvent("share", { method: "copy", content_type: "registration" });
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  };
  return (
    <section style={{
      marginTop: 18, padding: "22px 20px", borderRadius: 20,
      border: `1px solid rgba(212,255,58,.35)`,
      background: "linear-gradient(160deg, rgba(212,255,58,.09), rgba(212,255,58,.02) 60%)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Mark size={22} />
        <span style={{ ...monoLabel, color: ss.volt }}>Bring a partner</span>
      </div>
      <h2 style={{ margin: "12px 0 6px", fontFamily: ss.display, fontWeight: 400, fontSize: 24, lineHeight: "32px", color: ss.bone }}>
        Know someone who'd play?
      </h2>
      <p style={{ margin: 0, fontSize: 14, lineHeight: "20px", color: ss.body }}>
        Send them the link. Doubles are better with your own partner, and every category needs more players.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
        <a href={wa} target="_blank" rel="noopener noreferrer" className="ss-btn ss-btn-primary"
          onClick={() => trackEvent("share", { method: "whatsapp", content_type: "registration" })}
          style={{
            minHeight: 48, padding: "8px 16px", borderRadius: 9999, display: "inline-flex", alignItems: "center", gap: 8,
            background: ss.bone, color: ss.ink, textDecoration: "none", fontWeight: 600, fontSize: 14, lineHeight: "20px",
          }}>
          Share on WhatsApp
        </a>
        {canShare ? (
          <Button variant="ghost" style={{ minHeight: 48, fontSize: 14, lineHeight: "20px" }}
            onClick={() => {
              trackEvent("share", { method: "native", content_type: "registration" });
              navigator.share({ title: "Shuttle Storm '26", text, url: SHARE_URL }).catch(() => {});
            }}>
            More ways
          </Button>
        ) : (
          <Button variant="ghost" style={{ minHeight: 48, fontSize: 14, lineHeight: "20px" }} onClick={() => void copy()}>
            {copied ? "Link copied" : "Copy link"}
          </Button>
        )}
      </div>
    </section>
  );
}

// Opt-in is the player's own message: the button opens WhatsApp with their
// code typed in, and nothing is sent to them until they send it.
function WhatsAppOptIn({ clubNumber, tournamentName, registrationId }: {
  clubNumber: string; tournamentName: string; registrationId: string;
}) {
  const [opened, setOpened] = useState(false);
  const link = optinLink(clubNumber, tournamentName, registrationId);
  if (!link) return null;
  return (
    <Panel style={{ marginTop: 16, padding: "18px 18px" }}>
      <div style={{ color: ss.bone, fontSize: 16, lineHeight: "24px" }}>Updates on WhatsApp</div>
      <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: "20px", color: ss.mute }}>
        A reminder the evening before, and a message when your court is ready. Only if you ask: tap the button, then press Send in WhatsApp. Reply STOP anytime.
      </p>
      <a href={link} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)} className="ss-btn"
        style={{
          marginTop: 14, minHeight: 50, padding: "0 20px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 10,
          background: "#25D366", color: "#062b16", textDecoration: "none", fontWeight: 700, fontSize: 14, lineHeight: "20px",
        }}>
        Get updates on WhatsApp
      </a>
      {opened && (
        <p style={{ margin: "12px 0 0", fontSize: 12, lineHeight: "16px", color: ss.mute }}>
          Once you press Send, you'll get a reply confirming it. If WhatsApp didn't open, message{" "}
          <strong style={{ color: ss.bone }}>{formatClubNumber(clubNumber)}</strong> with: <strong style={{ color: ss.bone }}>My code: {optinCode(registrationId)}</strong>
        </p>
      )}
    </Panel>
  );
}

type PushUiState = "idle" | "working" | "enabled" | "denied" | "unsupported" | "error";

function pushDiagnostics(): { missing: string[]; standalone: boolean } {
  const missing: string[] = [];
  if (!("Notification" in window)) missing.push("Notification API");
  if (!("serviceWorker" in navigator)) missing.push("Service Worker");
  const hasPushManager =
    "PushManager" in window ||
    (typeof ServiceWorkerRegistration !== "undefined" && "pushManager" in ServiceWorkerRegistration.prototype);
  if (!hasPushManager) missing.push("PushManager");
  const standalone =
    // @ts-expect-error iOS-only non-standard property
    navigator.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;
  return { missing, standalone: !!standalone };
}

// Court-ready notifications in the browser. Hidden where they can't work
// (e.g. iPhone outside an installed app), instead of showing an error.
function PushOptIn({ tournamentId, pendingRegistrationId }: { tournamentId: string; pendingRegistrationId: string }) {
  const [state, setState] = useState<PushUiState>(() => {
    const s = pushSupportStatus();
    if (s === "unsupported") return "unsupported";
    if (s === "denied") return "denied";
    return "idle";
  });
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current || state !== "unsupported") return;
    const diag = pushDiagnostics();
    if (diag.standalone) {
      reported.current = true;
      captureError(new Error("Push unsupported in PWA standalone mode"), {
        missing: diag.missing, userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints,
      });
    }
  }, [state]);

  if (state === "unsupported" || state === "denied") return null;
  if (state === "enabled") {
    return <div style={{ marginTop: 16 }}><Note tone="volt">Notifications are on. We'll ping you the moment your court is ready.</Note></div>;
  }
  const enable = async () => {
    setState("working");
    setErrMsg(null);
    const result = await subscribeToPush(tournamentId, { kind: "player", pending_registration_id: pendingRegistrationId });
    if (result.ok) setState("enabled");
    else if (result.reason === "denied") setState("denied");
    else { setState("error"); setErrMsg(result.error ?? "Couldn't turn on notifications"); }
  };
  return (
    <Panel style={{ marginTop: 16, padding: "18px 18px" }}>
      <div style={{ color: ss.bone, fontSize: 16, lineHeight: "24px" }}>Court-ready alerts</div>
      <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: "20px", color: ss.mute }}>
        A notification on this device the moment your court opens on the day.
      </p>
      <Button variant="ghost" disabled={state === "working"} onClick={() => void enable()} style={{ marginTop: 14, minHeight: 50, fontSize: 12, lineHeight: "16px" }}>
        {state === "working" ? "Turning on…" : "Turn on notifications"}
      </Button>
      {state === "error" && errMsg && <div style={{ marginTop: 10, fontSize: 12, lineHeight: "16px", color: ss.danger }}>{errMsg}</div>}
    </Panel>
  );
}
