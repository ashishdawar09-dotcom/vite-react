// /photo/:token — a player, or their parent, adds, changes or removes the
// photo on their own player profile. The photo shows on their profile page
// (/p/:id), in the live app and on the hall TV's player cards. The token
// comes from the photo invite email (player-briefing, kind photo_invite) and
// is the only credential. /photo/preview is a demo that saves nothing; the
// invite's previews and test emails link there.

import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { callPlayerPhoto, type PlayerPhotoInfo } from "../../lib/db";
import { colors, radii, spacing, typography } from "../../lib/theme";
import { CYAN, CYAN_DARK, Card, CheckRow, PageShell } from "../publicRegistration/formParts";
import { shrinkPhoto, type ShrunkPhoto } from "./photoResize";

const DEMO_TOKEN = "preview";
const DEMO: PlayerPhotoInfo = {
  first_name: "Alex",
  name: "Alex Sample",
  tournament: { name: "Shuttle Storm", event_date: null },
  photo_url: null,
  consent_text: "I'm this player, or their parent or guardian if they're under 19, and I agree this photo can be shown on their Shuttle Storm player profile, in the live app and on the hall TV on game day.",
  profile_path: null,
};

const VOLT = "#D4FF3A";
const button: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, padding: "12px 20px",
  borderRadius: 999, border: "none", background: CYAN, color: "#00131A", fontSize: 16, fontWeight: 800, cursor: "pointer",
  fontFamily: "inherit", width: "100%",
};
const ghostButton: React.CSSProperties = {
  ...button, background: "transparent", color: colors.text.primaryLight, border: `1px solid ${colors.border.light}`, fontWeight: 700,
};
const para: React.CSSProperties = { margin: 0, color: colors.text.mutedLight, fontSize: 15, lineHeight: 1.5 };

function readError(code: string): string {
  if (code === "too-big") return "That photo is too large, even made smaller. Please choose another one.";
  return "We couldn't read that file. Please choose a JPEG or PNG photo. On an iPhone, a screenshot of the photo works too.";
}

export function PlayerPhotoPage() {
  const { token = "" } = useParams<{ token: string }>();
  const demo = token === DEMO_TOKEN;
  const [info, setInfo] = useState<PlayerPhotoInfo | null>(demo ? DEMO : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ShrunkPhoto | null>(null);
  const [reading, setReading] = useState(false);
  const [consent, setConsent] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<null | "upload" | "remove">(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | "uploaded" | "removed">(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    void callPlayerPhoto<PlayerPhotoInfo>({ action: "get", token }).then((r) => {
      if (cancelled) return;
      if (!r.ok) setLoadError(r.error);
      else setInfo(r.data);
    });
    return () => { cancelled = true; };
  }, [token, demo]);

  useEffect(() => { if (done) resultRef.current?.focus(); }, [done]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setDone(null);
    setReading(true);
    try {
      setChosen(await shrinkPhoto(file));
    } catch (err) {
      setChosen(null);
      setError(readError(err instanceof Error ? err.message : ""));
    } finally {
      setReading(false);
    }
  }

  async function upload() {
    setTried(true);
    if (!chosen || !consent || !info) return;
    setError(null);
    setBusy("upload");
    if (demo) {
      setInfo({ ...info, photo_url: chosen.dataUrl });
    } else {
      const r = await callPlayerPhoto<{ photo_url: string }>({ action: "upload", token, image: chosen.dataUrl, consent: true });
      if (!r.ok) { setBusy(null); setError(r.error); return; }
      setInfo({ ...info, photo_url: r.data.photo_url });
    }
    setBusy(null);
    setChosen(null);
    setConsent(false);
    setTried(false);
    setDone("uploaded");
  }

  async function remove() {
    if (!info || !window.confirm("Take your photo off your player profile?")) return;
    setError(null);
    setBusy("remove");
    if (!demo) {
      const r = await callPlayerPhoto({ action: "remove", token });
      if (!r.ok) { setBusy(null); setError(r.error); return; }
    }
    setInfo({ ...info, photo_url: null });
    setBusy(null);
    setChosen(null);
    setDone("removed");
  }

  const heading = (text: string) => (
    <h1 style={{ margin: 0, fontFamily: typography.display, fontSize: 26, lineHeight: 1.15, fontWeight: 800, color: colors.text.primaryLight }}>{text}</h1>
  );

  if (loadError) {
    return (
      <PageShell>
        <div style={{ paddingTop: spacing.xxl }}>
          <Card>
            {heading("This link isn't valid")}
            <p style={para}>It may have been copied incompletely. Please use the button in your email again, or ask the organizers for a new link.</p>
          </Card>
        </div>
      </PageShell>
    );
  }
  if (!info) {
    return <PageShell><p style={{ paddingTop: spacing.xxl, color: colors.text.mutedLight }}>Loading…</p></PageShell>;
  }

  const current = info.photo_url;
  return (
    <PageShell>
      <div style={{ padding: `${spacing.xxl}px 0 ${spacing.lg}px` }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", color: CYAN_DARK, marginBottom: 6 }}>
          {info.tournament.name} · player profile
        </div>
        {heading(current ? `Your photo, ${info.first_name}` : `Add your photo, ${info.first_name}`)}
        <p style={{ ...para, marginTop: spacing.sm }}>
          It goes on your player profile in the live app, and on the player cards on the hall TV on game day.
          It's optional, and you can change it or take it off any time with this same link.
        </p>
        {demo && (
          <p role="note" style={{ margin: `${spacing.md}px 0 0`, padding: "10px 14px", borderRadius: radii.md, background: "#fff8db", border: "1px solid #f0d98c", color: "#5c4a00", fontSize: 14, lineHeight: 1.45 }}>
            This is a demo of the page players see. Nothing you do here is saved.
          </p>
        )}
      </div>

      {done && (
        <div ref={resultRef} tabIndex={-1} aria-live="polite" style={{ outline: "none" }}>
          <Card>
            {done === "uploaded" ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
                  {current && <Avatar src={current} size={72} />}
                  <div style={{ fontFamily: typography.display, fontSize: 20, fontWeight: 800, color: colors.text.primaryLight }}>Your photo is on your profile</div>
                </div>
                <p style={para}>{demo ? "In the real page, it would now show in the live app and on the hall TV." : "It shows in the live app now, and on the hall TV's player cards on game day. Thank you!"}</p>
              </>
            ) : (
              <>
                <div style={{ fontFamily: typography.display, fontSize: 20, fontWeight: 800, color: colors.text.primaryLight }}>Your photo is off your profile</div>
                <p style={para}>You can add one again any time with this link.</p>
              </>
            )}
            {info.profile_path && <Link to={info.profile_path} style={{ color: CYAN_DARK, fontWeight: 700, fontSize: 15 }}>See your player profile →</Link>}
          </Card>
        </div>
      )}

      {current && !chosen && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
            <Avatar src={current} size={88} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: colors.text.primaryLight }}>On your profile now</div>
              <p style={{ ...para, fontSize: 14 }}>Choose a new photo below to change it.</p>
            </div>
          </div>
          <button type="button" style={{ ...ghostButton, opacity: busy ? 0.6 : 1 }} disabled={!!busy} onClick={() => void remove()}>
            {busy === "remove" ? "Removing…" : "Remove my photo"}
          </button>
        </Card>
      )}

      <Card>
        <div style={{ fontFamily: typography.display, fontSize: 18, fontWeight: 700, color: colors.text.primaryLight }}>
          {chosen ? "How it will look" : current ? "Choose a new photo" : "Choose a photo"}
        </div>
        {!chosen && <p style={{ ...para, fontSize: 14 }}>A clear photo of your face and shoulders, in good light, works best. On a phone you can take one now.</p>}
        {chosen && (
          <div style={{ display: "flex", gap: spacing.lg, alignItems: "flex-end", flexWrap: "wrap" }}>
            <figure style={{ margin: 0, textAlign: "center" }}>
              <Avatar src={chosen.dataUrl} size={112} />
              <figcaption style={{ fontSize: 12, color: colors.text.mutedLight, marginTop: 6 }}>In the app</figcaption>
            </figure>
            <figure style={{ margin: 0, textAlign: "center" }}>
              <TvCard src={chosen.dataUrl} name={info.name} />
              <figcaption style={{ fontSize: 12, color: colors.text.mutedLight, marginTop: 6 }}>On the hall TV</figcaption>
            </figure>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" onChange={(e) => void onFile(e)} style={{ display: "none" }} aria-hidden="true" tabIndex={-1} />
        <button type="button" style={chosen ? ghostButton : { ...button, opacity: reading ? 0.6 : 1 }} disabled={reading || !!busy} onClick={() => fileRef.current?.click()}>
          {reading ? "Reading the photo…" : chosen ? "Choose a different photo" : current ? "Choose a new photo" : "Choose a photo"}
        </button>
        {error && !chosen && <p role="alert" style={{ margin: 0, color: colors.state.live, fontSize: 14, fontWeight: 700 }}>{error}</p>}
      </Card>

      {chosen && (
        <Card>
          <CheckRow
            checked={consent}
            onChange={setConsent}
            label={info.consent_text}
            error={tried && !consent ? "Please tick this to upload" : undefined}
          />
          <button type="button" style={{ ...button, opacity: busy ? 0.6 : 1 }} disabled={!!busy} onClick={() => void upload()}>
            {busy === "upload" ? "Uploading…" : "Upload my photo"}
          </button>
          {error && <p role="alert" style={{ margin: 0, color: colors.state.live, fontSize: 14, fontWeight: 700 }}>{error}</p>}
        </Card>
      )}

      <p style={{ ...para, fontSize: 13, padding: `0 ${spacing.xs}px ${spacing.xxl}px` }}>
        The photo is made smaller on your device before it's sent, and any location details stored inside it are left out.
        Questions? Reply to the invite email and it reaches the tournament directors.
      </p>
    </PageShell>
  );
}

function Avatar({ src, size }: { src: string; size: number }) {
  return (
    <img src={src} alt="" width={size} height={size}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", objectPosition: "50% 20%", display: "block", flex: "none", border: `2px solid ${colors.border.light}` }} />
  );
}

/** A small copy of the hall TV's player card frame: the photo in a slanted volt-edged frame. */
function TvCard({ src, name }: { src: string; name: string }) {
  const last = name.trim().split(/\s+/).pop() ?? "";
  return (
    <div aria-hidden="true" style={{ position: "relative", width: 200, height: 150, borderRadius: 10, overflow: "hidden", background: "#070802" }}>
      <div style={{ position: "absolute", left: 14, top: 10, width: 92, height: 140, background: VOLT, clipPath: "polygon(0 0,100% 0,80% 100%,0 100%)" }} />
      <img src={src} alt="" style={{ position: "absolute", left: 8, top: 10, width: 92, height: 140, objectFit: "cover", objectPosition: "50% 20%", clipPath: "polygon(0 0,100% 0,80% 100%,0 100%)" }} />
      <div style={{ position: "absolute", left: 104, top: 44, right: 8, fontFamily: "'Oswald Variable', sans-serif", fontWeight: 700, fontSize: last.length > 8 ? 18 : 24, lineHeight: 1, color: VOLT, textTransform: "uppercase", overflowWrap: "anywhere" }}>{last}</div>
      <div style={{ position: "absolute", left: 104, top: 24, fontFamily: "monospace", fontSize: 8, letterSpacing: 1, color: "#BEC2B3", textTransform: "uppercase" }}>Player spotlight</div>
    </div>
  );
}
