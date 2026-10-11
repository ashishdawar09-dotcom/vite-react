// /waiver/:token — a doubles partner reads the regulations and accepts the
// waiver after their teammate registers them. The token comes from the email
// sent by register-player (or the stripe-webhook, for card entries); admins
// can also copy the link from the registration card.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { callWaiverConsent, type PartnerWaiverInfo } from "../../lib/db";
import { colors, radii, spacing, typography } from "../../lib/theme";
import { CYAN, CYAN_DARK, Card, CheckRow, Field, PageShell, inputStyle, safeHttpUrl } from "./formParts";
import { AGE_OF_MAJORITY, parseAge } from "./validate";

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function PartnerWaiverPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<PartnerWaiverInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [guardian, setGuardian] = useState("");
  const [signature, setSignature] = useState("");
  const [rules, setRules] = useState(false);
  const [waiver, setWaiver] = useState(false);
  const [codes, setCodes] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void callWaiverConsent<PartnerWaiverInfo>({ action: "get", token }).then((r) => {
      if (cancelled) return;
      if (!r.ok) { setLoadError(r.error); return; }
      setInfo(r.data);
      setName(r.data.partner_name ?? "");
      if (r.data.alreadyAccepted) setDone(true);
    });
    return () => { cancelled = true; };
  }, [token]);

  const ageNum = parseAge(age);
  const minor = ageNum !== null && ageNum < AGE_OF_MAJORITY;
  const signer = minor ? guardian : name;
  const errors = {
    name: name.trim().length < 2 ? "Required" : undefined,
    age: ageNum === null ? "Enter your age (4–110)" : undefined,
    guardian: minor && guardian.trim().length < 2 ? "Required for players under 19" : undefined,
    signature: !signature.trim()
      ? "Type the full name to sign"
      : norm(signature) !== norm(signer)
        ? (minor ? "Must match the parent or guardian's name" : "Must match your name above")
        : undefined,
    rules: rules ? undefined : "Required",
    waiver: waiver ? undefined : "Required",
    codes: codes ? undefined : "Required",
  };
  const valid = Object.values(errors).every((e) => !e);
  const show = (e: string | undefined) => (tried ? e : undefined);

  const submit = async () => {
    setTried(true);
    if (!valid || !info) return;
    setBusy(true);
    setSubmitError(null);
    const r = await callWaiverConsent({
      action: "accept",
      token,
      name: name.trim(),
      consent: {
        age: ageNum,
        guardian_name: minor ? guardian.trim() : undefined,
        signature: signature.trim(),
        accepted_rules: rules,
        accepted_waiver: waiver,
        accepted_codes_of_conduct: codes,
        waiver_version: info.tournament.waiver_version,
      },
    });
    setBusy(false);
    if (r.ok) setDone(true);
    else setSubmitError(r.error);
  };

  const heading = (text: string) => (
    <div style={{ fontFamily: typography.display, fontSize: 24, fontWeight: 800, color: colors.text.primaryLight }}>{text}</div>
  );

  if (loadError) {
    return (
      <PageShell>
        <div style={{ paddingTop: spacing.xxl }}>
          <Card>
            {heading("This link isn't valid")}
            <p style={{ color: colors.text.mutedLight, fontSize: 15, lineHeight: 1.5 }}>
              It may have been copied incompletely. Please ask your partner or the organizers for a new link.
            </p>
          </Card>
        </div>
      </PageShell>
    );
  }
  if (!info) {
    return <PageShell><p style={{ paddingTop: spacing.xxl, color: colors.text.mutedLight }}>Loading…</p></PageShell>;
  }

  const t = info.tournament;
  if (done) {
    return (
      <PageShell>
        <div style={{ paddingTop: spacing.xxl }}>
          <Card>
            <div style={{ fontSize: 48 }}>✓</div>
            {heading("Waiver accepted")}
            <p style={{ color: colors.text.mutedLight, fontSize: 15, lineHeight: 1.5 }}>
              Thanks. You're all set to play {info.category ? `${info.category} ` : ""}with {info.player_name} at {t.name}.
            </p>
            {safeHttpUrl(t.rules_url) && (
              <a href={safeHttpUrl(t.rules_url)} style={{ color: CYAN_DARK, fontWeight: 700 }}>Competition regulations ↗</a>
            )}
          </Card>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div style={{ padding: `${spacing.xxl}px 0 ${spacing.lg}px` }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", color: CYAN_DARK }}>
          {t.name}
        </div>
        {heading("Accept the waiver")}
        <p style={{ color: colors.text.mutedLight, fontSize: 15, lineHeight: 1.5, marginTop: spacing.sm }}>
          {info.player_name} has entered you as their partner{info.category ? ` in ${info.category}` : ""}.
          Every player must read the competition regulations and agree to the waiver before taking part.
        </p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <Card>
          <Field label="Your full name" required error={show(errors.name)}>
            <input type="text" autoComplete="name" style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Your age on the tournament date" required
            hint="Under 19 needs a parent or guardian to accept the waiver." error={show(errors.age)}>
            <input type="text" inputMode="numeric" style={{ ...inputStyle, maxWidth: 120 }}
              value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))} />
          </Field>
        </Card>

        <Card>
          <div style={{ fontFamily: typography.display, fontSize: 18, fontWeight: 700, color: colors.text.primaryLight }}>
            Rules and waiver
          </div>
          {minor && (
            <p style={{ fontSize: 13, color: colors.text.mutedLight, lineHeight: 1.5 }}>
              You're under 19, so a parent or guardian must accept on your behalf.
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.md, margin: `${spacing.sm}px 0 ${spacing.md}px` }}>
            {safeHttpUrl(t.rules_url) && (
              <a href={safeHttpUrl(t.rules_url)} target="_blank" rel="noopener" style={{ color: CYAN_DARK, fontWeight: 700, fontSize: 14 }}>
                Read the competition regulations ↗
              </a>
            )}
            {safeHttpUrl(t.waiver_url) && (
              <a href={safeHttpUrl(t.waiver_url)} target="_blank" rel="noopener" style={{ color: CYAN_DARK, fontWeight: 700, fontSize: 14 }}>
                Open the waiver in a new tab ↗
              </a>
            )}
          </div>
          <div role="region" aria-label="Waiver text" tabIndex={0} style={{
            maxHeight: 280, overflowY: "auto", padding: spacing.md,
            background: colors.bg.muted, border: `1px solid ${colors.border.lightStrong}`, borderRadius: radii.md,
            fontSize: 13, lineHeight: 1.55, color: colors.text.primaryLight, whiteSpace: "pre-wrap",
          }}>
            {t.waiver_text}
          </div>
          <div style={{ marginTop: spacing.md }}>
            <CheckRow checked={rules} onChange={setRules} label="I have read the competition regulations." error={show(errors.rules)} />
            <CheckRow checked={waiver} onChange={setWaiver}
              label="I have read and understood the Acknowledgement of Risk and Release of Liability above, and I agree to it."
              error={show(errors.waiver)} />
            <CheckRow checked={codes} onChange={setCodes}
              label="I have read and will follow the Badminton BC codes of conduct (linked in the regulations)."
              error={show(errors.codes)} />
          </div>
          {minor && (
            <Field label="Parent or guardian's full name" required error={show(errors.guardian)}>
              <input type="text" autoComplete="off" style={inputStyle} value={guardian} onChange={(e) => setGuardian(e.target.value)} />
            </Field>
          )}
          <Field label={minor ? "Parent or guardian's signature" : "Your signature"} required
            hint={minor ? "Type the parent or guardian's full name, as entered above." : "Type your full name, as entered above."}
            error={show(errors.signature)}>
            <input type="text" autoComplete="off" style={{ ...inputStyle, fontStyle: "italic" }}
              value={signature} onChange={(e) => setSignature(e.target.value)} />
          </Field>
        </Card>

        <div style={{ padding: `${spacing.lg}px 0 ${spacing.xxxl}px` }}>
          {submitError && (
            <div style={{
              padding: spacing.md, marginBottom: spacing.md, background: colors.state.liveSubtle,
              border: `1px solid ${colors.state.live}`, borderRadius: radii.md, color: colors.state.live, fontSize: 14, fontWeight: 600,
            }}>{submitError}</div>
          )}
          {tried && !valid && !submitError && (
            <div style={{ marginBottom: spacing.md, color: colors.state.live, fontSize: 14, fontWeight: 600 }}>
              Please fix the highlighted fields above.
            </div>
          )}
          <button type="submit" disabled={busy} style={{
            width: "100%", minHeight: 56, borderRadius: radii.md, border: "none",
            background: busy ? colors.text.mutedLight : CYAN, color: "#001a20",
            fontSize: 17, fontWeight: 800, cursor: busy ? "not-allowed" : "pointer",
          }}>
            {busy ? "Saving…" : "Accept and sign"}
          </button>
        </div>
      </form>
    </PageShell>
  );
}
