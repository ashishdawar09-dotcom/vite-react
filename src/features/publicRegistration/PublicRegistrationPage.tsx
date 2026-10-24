import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useIsMobile } from "../../hooks/useIsMobile";
import { submitPublicRegistration } from "../../lib/db";
import { pushSupportStatus, subscribeToPush } from "../../lib/push";
import {
  GA_MEASUREMENT_ID,
  PRIVACY_URL,
  initAnalytics,
  rememberPendingCardRegistration,
  takePendingCardRegistration,
  trackRegistrationComplete,
} from "../../lib/analytics";
import { HEARD_FROM_OPTIONS, captureAttribution, getAttribution } from "../../lib/attribution";
import { captureError } from "../../lib/sentry";
import { colors, easings, radii, shadows, spacing, typography } from "../../lib/theme";
import type { AgeBand, Category, PublicRegistrationPayload, Tournament } from "../../types";
import { Countdown } from "./Countdown";
import { cardAmount, computeFee, fmtMoney, priceBasis, priceDescription, priceLabel, type Concessions, type PaymentSplit } from "./computeFee";
import { CYAN, CYAN_DARK, Card, CheckRow, Field, type Highlight, Highlights, PageShell, PartnerPromise, SectionHeader, inputStyle, safeHttpUrl } from "./formParts";
import { usePublicTournament } from "./usePublicTournament";
import { AGE_OF_MAJORITY, emptyFormState, type FormErrors, type FormState, isValid, parseAge, partnerAgeRequired, validate } from "./validate";

// Event highlights shown under the hero, per tournament.
const TOURNAMENT_HIGHLIGHTS: Record<string, Highlight[]> = {
  // Shuttle Storm '26
  "e7bb59ca-5cfc-4e5e-a4f6-0649ece00feb": [
    { icon: "shield", title: "Badminton BC registered club", sub: "Run to Badminton BC standards", href: "https://www.badmintonbc.com" },
    { icon: "feather", title: "Feather shuttles", sub: "Tournament-grade, on every court" },
    { icon: "trophy", title: "Prizes for winners and runners-up", sub: "In every category" },
  ],
};

// ---------- small helpers (file-local) ---------------------------------------

function fmtDate(iso: string | null, time: string | null): string {
  if (!iso) return "Date TBD";
  // Parse YYYY-MM-DD as a LOCAL date — `new Date(iso)` on a date-only
  // string treats it as UTC midnight, which then shifts to the previous
  // calendar day in negative-offset timezones (PST/PDT).
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const d = ymd ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])) : new Date(iso);
  const dateStr = d.toLocaleDateString("en-US", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  if (!time) return dateStr;
  // time is "HH:MM:SS" — render as "9:00 AM"
  const [hh, mm] = time.split(":");
  const h = Number(hh); const mins = Number(mm);
  if (Number.isNaN(h) || Number.isNaN(mins)) return dateStr;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${dateStr} • ${h12}:${String(mins).padStart(2, "0")} ${period}`;
}

function paragraphs(text: string): string[] {
  return text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------- field-level building blocks ---------------------------------------

// ---------- the page ---------------------------------------------------------

type SubmitStatus = "idle" | "submitting" | "success" | "error";

export function PublicRegistrationPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const { tournament, categories, loading, error } = usePublicTournament(tournamentId);
  const isMobile = useIsMobile();
  const reduce = useReducedMotion();

  const [form, setForm] = useState<FormState>(emptyFormState());
  const [touched, setTouched] = useState<Set<keyof FormState>>(new Set());
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // After successful submission, we hold the pending registration id so the
  // success screen can attach a push subscription to it.
  const [submittedRegistrationId, setSubmittedRegistrationId] = useState<string | null>(null);
  // Honeypot: hidden from people; bots that fill it are dropped server-side.
  const [website, setWebsite] = useState("");

  useEffect(() => { captureAttribution(); void initAnalytics(); }, []);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === form.category_id) ?? null,
    [categories, form.category_id],
  );
  // Card payment needs a category price; without one only e-Transfer is offered.
  const cardAvailable = computeFee(selectedCategory, "separate") !== null;
  const payMethod = cardAvailable ? form.payment_method : "etransfer";

  // Reduced fees for under-18s and students, and the waiver every participant
  // must accept, both set per tournament.
  const concessions: Concessions = useMemo(
    () => ({ youth_price: tournament?.youth_price ?? null, student_price: tournament?.student_price ?? null }),
    [tournament],
  );
  const studentPrice = numOrNull(tournament?.student_price);
  const waiverRequired = !!tournament?.waiver_text;
  const ageRequired = waiverRequired || numOrNull(tournament?.youth_price) !== null;
  const playerAge = parseAge(form.player_age);
  const playerIsMinor = playerAge !== null && playerAge < AGE_OF_MAJORITY;
  const categoryPrice = selectedCategory ? numOrNull(selectedCategory.price) : null;
  const perPlayerPrice = categoryPrice !== null && priceBasis(selectedCategory!) === "per_player";
  // The student rate is offered to adults when it beats the category price.
  const offerStudent = (who: number | null) =>
    perPlayerPrice && studentPrice !== null && studentPrice < categoryPrice! && (who === null || who >= 18);
  const player = { age: playerAge, student: offerStudent(playerAge) && form.player_student };
  const partnerAge = parseAge(form.partner_age);
  const partner = { age: partnerAge, student: offerStudent(partnerAge) && form.partner_student };

  // Prices are per category and per player's age/student status; membership
  // no longer affects the fee. requirePartnerAge is set below once the split
  // is known.
  const partnerAgeNeeded =
    ageRequired && selectedCategory?.team_size === 2 && priceBasis(selectedCategory) === "per_player" &&
    !!form.partner_name.trim() && form.payment_split === "full";
  // Age-banded doubles (35+): both partners must qualify, so ask the named
  // partner's age whatever the payment split.
  const bandedPartnerAge = partnerAgeRequired(form, selectedCategory);
  const errors = useMemo(
    () => validate({ ...form, payment_method: payMethod }, selectedCategory, {
      requireMembership: false,
      requireAge: ageRequired,
      requireWaiver: waiverRequired,
      requirePartnerAge: partnerAgeNeeded,
    }),
    [form, payMethod, selectedCategory, ageRequired, waiverRequired, partnerAgeNeeded],
  );
  const visibleErrors: FormErrors = useMemo(() => {
    const out: FormErrors = {};
    (Object.keys(errors) as Array<keyof FormState>).forEach((k) => {
      if (touched.has(k) || submitStatus === "error") out[k] = errors[k];
    });
    return out;
  }, [errors, touched, submitStatus]);

  // "Pay for both" only applies to doubles priced per player, once a partner
  // is named. Per-team prices already cover both players.
  const baseFee = computeFee(selectedCategory, "separate");
  const showPaymentSplit =
    selectedCategory?.team_size === 2 &&
    priceBasis(selectedCategory) === "per_player" &&
    baseFee !== null &&
    !!form.partner_name.trim();
  const paymentSplit: PaymentSplit = showPaymentSplit ? form.payment_split : "separate";
  const etransferDue = computeFee(selectedCategory, paymentSplit, player, partner, concessions);
  const ownShare = computeFee(selectedCategory, "separate", player, partner, concessions);
  const cardDue = etransferDue === null ? null : cardAmount(etransferDue);

  // Back from Stripe Checkout: ?payment=success&reg=<id> or ?payment=cancelled.
  const [cardReturn, setCardReturn] = useState<"paid" | "cancelled" | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const payment = q.get("payment");
    if (!payment) return;
    const reg = q.get("reg");
    if (payment === "success" && reg && /^[0-9a-f-]{36}$/i.test(reg)) {
      setSubmittedRegistrationId(reg);
      setCardReturn("paid");
      setSubmitStatus("success");
      trackRegistrationComplete(reg, {
        payment_method: "card",
        value: takePendingCardRegistration(),
        tournament_id: window.location.pathname.split("/")[2],
      });
    } else if (payment === "cancelled") {
      setCardReturn("cancelled");
    }
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: val }));
  };
  const markTouched = (key: keyof FormState) => {
    setTouched((t) => { if (t.has(key)) return t; const n = new Set(t); n.add(key); return n; });
  };

  // Numeric-only phone filter
  const phoneInput = (val: string) => val.replace(/[^\d]/g, "").slice(0, 15);

  const onCopy = async (key: string, value: string) => {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1500);
    }
  };

  const handleSubmit = async () => {
    // Mark all fields touched so all errors become visible
    setTouched(new Set(Object.keys(form) as Array<keyof FormState>));
    if (!isValid(errors)) {
      setSubmitStatus("error");
      setSubmitError("Please fix the highlighted fields above.");
      return;
    }
    if (!tournament || !selectedCategory) return;

    setSubmitStatus("submitting");
    setSubmitError(null);

    const payload: PublicRegistrationPayload = {
      tournament_id: tournament.id,
      category_id: selectedCategory.id,
      player_name: form.player_name.trim(),
      player_email: form.player_email.trim(),
      player_phone: form.player_phone.trim() || undefined,
      player_is_member: false,
      payment_method: payMethod,
      payment_reference: payMethod === "etransfer" ? form.payment_reference.trim() : undefined,
      payment_paid_full_for_partner:
        selectedCategory.team_size === 2 &&
        (priceBasis(selectedCategory) === "per_team" ? !!form.partner_name.trim() : paymentSplit === "full"),
      comments: form.comments.trim() || undefined,
      group_choice: form.group_choice ?? undefined,
      website: website || undefined,
      player_age: playerAge ?? undefined,
      player_student: player.student,
      heard_from: form.heard_from || undefined,
      attribution: getAttribution(),
    };
    if (partnerAgeNeeded && paymentSplit === "full") {
      payload.partner_age = partnerAge ?? undefined;
      payload.partner_student = partner.student;
    } else if (bandedPartnerAge) {
      payload.partner_age = partnerAge ?? undefined;
    }
    if (waiverRequired) {
      payload.consent = {
        guardian_name: playerIsMinor ? form.guardian_name.trim() : undefined,
        signature: form.signature.trim(),
        accepted_rules: form.accepted_rules,
        accepted_waiver: form.accepted_waiver,
        accepted_codes_of_conduct: form.accepted_codes,
        waiver_version: tournament.waiver_version,
      };
    }
    if (selectedCategory.team_size === 2 && form.partner_name.trim()) {
      payload.partner_name = form.partner_name.trim();
      payload.partner_email = form.partner_email.trim();
      payload.partner_phone = form.partner_phone.trim() || undefined;
    }

    const result = await submitPublicRegistration(payload);
    if (result.success && result.checkoutUrl) {
      // Card: Stripe Checkout takes over and sends the player back here.
      if (cardDue !== null) rememberPendingCardRegistration(cardDue);
      window.location.assign(result.checkoutUrl);
      return;
    }
    if (result.success) {
      setSubmittedRegistrationId(result.registrationId ?? null);
      setSubmitStatus("success");
      trackRegistrationComplete(result.registrationId ?? null, {
        payment_method: "etransfer",
        value: etransferDue ?? undefined,
        tournament_id: tournament.id,
      });
    } else {
      setSubmitStatus("error");
      setSubmitError(result.error ?? "Submission failed. Please try again.");
    }
  };

  const resetForAnotherCategory = () => {
    // Preserve email + name; clear category-specific + partner + payment fields.
    setForm((f) => ({
      ...emptyFormState(),
      player_email: f.player_email,
      player_name: f.player_name,
      player_phone: f.player_phone,
      player_is_member: f.player_is_member,
      group_choice: f.group_choice,
      payment_method: f.payment_method,
      player_age: f.player_age,
      player_student: f.player_student,
      guardian_name: f.guardian_name,
    }));
    setTouched(new Set());
    setSubmitStatus("idle");
    setSubmitError(null);
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  // ---------- LOADING / ERROR / NOT-FOUND ----------
  if (loading) {
    return (
      <PageShell>
        <div style={{ textAlign: "center", padding: spacing.xxxl, color: colors.text.mutedLight }}>
          Loading tournament…
        </div>
      </PageShell>
    );
  }
  if (error || !tournament) {
    return (
      <PageShell>
        <div style={{ textAlign: "center", padding: spacing.xxxl, color: colors.state.live }}>
          {error ?? "Tournament not found"}
        </div>
      </PageShell>
    );
  }

  const deadlinePassed =
    !!tournament.registration_deadline &&
    new Date(tournament.registration_deadline).getTime() < Date.now();
  const formClosed = !tournament.registration_open || deadlinePassed;
  const highlights = TOURNAMENT_HIGHLIGHTS[tournament.id];
  const soloDoublesOffered = categories.some((c) => c.team_size === 2 && c.allow_solo_signup);
  // Section numbers follow the cards actually shown.
  const sections = [
    "details", "category",
    ...(selectedCategory?.team_size === 2 ? ["partner"] : []),
    ...(waiverRequired ? ["waiver"] : []),
    "payment",
  ];
  const stepOf = (key: string) => sections.indexOf(key) + 1;

  // ---------- SUCCESS SCREEN ----------
  if (submitStatus === "success") {
    return (
      <PageShell>
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            background: colors.bg.card,
            borderRadius: radii.xl,
            padding: spacing.xxl,
            textAlign: "center",
            boxShadow: shadows.lg,
          }}
        >
          <div style={{ fontSize: 56, marginBottom: spacing.md }}>✓</div>
          <div style={{ fontFamily: typography.display, fontSize: 28, fontWeight: 800, color: colors.text.primaryLight }}>
            {cardReturn === "paid" ? "Payment received" : "Registration submitted"}
          </div>
          <p style={{ color: colors.text.mutedLight, marginTop: spacing.md, fontSize: 15, lineHeight: 1.5 }}>
            {cardReturn === "paid"
              ? <>Thanks{form.player_name ? `, ${form.player_name}` : ""}! Your card payment went through and your
                  registration is with the organizers. They'll confirm your spot shortly, and Stripe has
                  emailed your receipt from Adawar Technologies, which runs Shuttle Storm's registration.
                  The charge shows on your statement as ADAWAR* SHUTTLE STORM.</>
              : <>Thanks, {form.player_name}! An admin will verify your e-transfer reference and
                  confirm your spot shortly. You'll be visible in the player roster once approved.</>}
          </p>
          {/* Push opt-in surface — always renders something so users on
              cached pages or with malformed responses still see status */}
          {tournament && (
            submittedRegistrationId ? (
              <PushOptInButton
                tournamentId={tournament.id}
                pendingRegistrationId={submittedRegistrationId}
              />
            ) : (
              <div style={{
                marginTop: spacing.lg, padding: spacing.md,
                background: colors.bg.muted, borderRadius: radii.md,
                fontSize: 13, color: colors.text.mutedLight, lineHeight: 1.5,
              }}>
                🔔 Couldn't get your registration ID from the server. Please
                refresh the page and re-submit — then you'll be able to enable
                push notifications on the next success screen.
              </div>
            )
          )}
          {tournament?.waiver_text && (
            <p style={{ color: colors.text.mutedLight, marginTop: spacing.md, fontSize: 13, lineHeight: 1.5 }}>
              If you entered a doubles partner, we've emailed them a link to accept the waiver. They need to do this before they can play.
            </p>
          )}
          <p style={{ color: colors.text.mutedLight, marginTop: spacing.md, fontSize: 13 }}>
            Need to enter another category? Each category requires a separate submission.
          </p>
          <button
            type="button"
            onClick={resetForAnotherCategory}
            style={{
              marginTop: spacing.xl,
              padding: "14px 24px",
              borderRadius: radii.md,
              border: "none",
              background: CYAN,
              color: "#001a20",
              fontSize: 15,
              fontWeight: 800,
              cursor: "pointer",
              minHeight: 48,
            }}
          >
            Register another category
          </button>
        </motion.div>
      </PageShell>
    );
  }

  // ---------- MAIN FORM ----------
  return (
    <PageShell>
      {/* Hero */}
      <div style={{ textAlign: "center", paddingTop: spacing.xxl, paddingBottom: spacing.lg }}>
        <div style={{ color: CYAN, fontSize: 11, fontWeight: 800, letterSpacing: 3, textTransform: "uppercase", marginBottom: spacing.sm }}>
          Tournament Registration
        </div>
        <h1 style={{
          fontFamily: typography.display, fontWeight: 800,
          fontSize: isMobile ? 32 : 44, lineHeight: 1.1, margin: 0,
          color: colors.text.primaryLight, letterSpacing: -0.5,
        }}>
          {tournament.name}
        </h1>
        <div style={{ marginTop: spacing.md, color: colors.text.primaryLight, fontSize: 15, fontWeight: 600 }}>
          {fmtDate(tournament.event_date, tournament.event_time)}
        </div>
        {tournament.registration_deadline && (
          <div style={{ marginTop: spacing.md }}>
            <Countdown deadline={tournament.registration_deadline} />
          </div>
        )}
      </div>

      {highlights && <Highlights items={highlights} isMobile={isMobile} />}
      {soloDoublesOffered && !formClosed && <PartnerPromise />}

      {/* Preamble card */}
      <Card>
        {tournament.venue_name && (
          <div style={{ marginBottom: spacing.md }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", color: colors.text.mutedLight }}>
              📍 Venue
            </div>
            <div style={{ marginTop: 4, fontSize: 16, fontWeight: 700, color: colors.text.primaryLight }}>
              {tournament.venue_name}
            </div>
            {tournament.venue_address && (
              <div style={{ marginTop: 2, fontSize: 14, color: colors.text.mutedLight, lineHeight: 1.4 }}>
                {tournament.venue_address}
              </div>
            )}
            {safeHttpUrl(tournament.venue_map_url) && (
              <a href={safeHttpUrl(tournament.venue_map_url)} target="_blank" rel="noopener noreferrer"
                style={{ marginTop: spacing.sm, display: "inline-block", color: CYAN_DARK, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
                Open map ↗
              </a>
            )}
          </div>
        )}
        {tournament.e_transfer_email && (
          <div style={{ marginBottom: spacing.md }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", color: colors.text.mutedLight }}>
              💸 e-Transfer payment
            </div>
            <div style={{ marginTop: spacing.sm, display: "flex", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" }}>
              <code style={{
                padding: "6px 10px", background: colors.bg.muted, borderRadius: radii.sm,
                fontSize: 14, fontWeight: 700, color: colors.text.primaryLight, fontFamily: "Menlo, monospace",
              }}>
                {tournament.e_transfer_email}
              </code>
              <button type="button"
                onClick={() => onCopy("etransfer", tournament.e_transfer_email!)}
                style={{
                  padding: "6px 10px", border: `1px solid ${colors.border.lightStrong}`,
                  borderRadius: radii.sm, background: colors.bg.card, fontSize: 12,
                  fontWeight: 700, cursor: "pointer", color: colors.text.primaryLight,
                }}>
                {copiedKey === "etransfer" ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}
        {tournament.contact_info && (
          <div style={{ marginBottom: spacing.md }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", color: colors.text.mutedLight }}>
              📞 Contact
            </div>
            <div style={{ marginTop: 4, fontSize: 13, color: colors.text.mutedLight, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
              {tournament.contact_info}
            </div>
          </div>
        )}
      </Card>

      {/* Terms text */}
      {tournament.terms_text && (
        <Card>
          {paragraphs(tournament.terms_text).map((p, i) => (
            <p key={i} style={{
              margin: i === 0 ? 0 : `${spacing.md}px 0 0`,
              fontSize: 13, color: colors.text.mutedLight,
              lineHeight: 1.55, whiteSpace: "pre-wrap",
            }}>{p}</p>
          ))}
        </Card>
      )}

      {/* Closed banner OR Form */}
      {formClosed ? (
        <Card>
          <div style={{
            padding: spacing.xl, textAlign: "center", background: colors.state.liveSubtle,
            borderRadius: radii.md, color: colors.state.live, fontWeight: 700, fontSize: 16,
          }}>
            🚫 Registration is closed for this tournament.
          </div>
        </Card>
      ) : (
        <form
          onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
          noValidate
        >
          {/* Honeypot. Off-screen rather than display:none, which some bots skip. */}
          <div aria-hidden="true" style={{ position: "absolute", left: -10000, top: "auto", width: 1, height: 1, overflow: "hidden" }}>
            <label>
              Website (leave blank)
              <input
                type="text" name="website" tabIndex={-1} autoComplete="off"
                value={website} onChange={(e) => setWebsite(e.target.value)}
              />
            </label>
          </div>
          <Card>
            <SectionHeader step={stepOf("details")} title="Your details" />
            <Field label="Email" required hint="We'll contact you here about your entry" error={visibleErrors.player_email}>
              <input
                type="email" inputMode="email" autoComplete="email" style={inputStyle}
                value={form.player_email}
                onChange={(e) => set("player_email", e.target.value)}
                onBlur={() => markTouched("player_email")}
              />
            </Field>
            <Field label="Player Name" required error={visibleErrors.player_name}>
              <input
                type="text" autoComplete="name" style={inputStyle}
                value={form.player_name}
                onChange={(e) => set("player_name", e.target.value)}
                onBlur={() => markTouched("player_name")}
              />
            </Field>
            <Field label="Contact Number" required hint="Numbers only (e.g. 6041234567)" error={visibleErrors.player_phone}>
              <input
                type="tel" inputMode="numeric" autoComplete="tel" style={inputStyle}
                value={form.player_phone}
                onChange={(e) => set("player_phone", phoneInput(e.target.value))}
                onBlur={() => markTouched("player_phone")}
              />
            </Field>
            {ageRequired && (
              <Field
                label={`Player's age on ${tournament.event_date ? fmtShortDate(tournament.event_date) : "the tournament date"}`}
                required
                hint={waiverRequired ? "Under 18 pays the youth fee. Under 19 needs a parent or guardian to accept the waiver." : "Under 18 pays the youth fee."}
                error={visibleErrors.player_age}
              >
                <input
                  type="text" inputMode="numeric" style={{ ...inputStyle, maxWidth: 120 }}
                  value={form.player_age}
                  onChange={(e) => set("player_age", e.target.value.replace(/\D/g, "").slice(0, 3))}
                  onBlur={() => markTouched("player_age")}
                />
              </Field>
            )}
          </Card>

          {/* Category section */}
          <Card>
            <SectionHeader step={stepOf("category")} title="Category" sub={soloDoublesOffered ? "Doubles players can enter solo. We'll pair you up." : undefined} />
            <Field label="Choose your category" required error={visibleErrors.category_id}>
              <CategoryPicker
                categories={categories}
                value={form.category_id}
                onChange={(id) => { set("category_id", id); markTouched("category_id"); }}
                isMobile={isMobile}
              />
            </Field>
            {selectedCategory && priceDescription(selectedCategory) && (
              <div style={{
                marginTop: spacing.sm, padding: "12px 14px",
                background: "rgba(0, 212, 255, 0.08)", border: `1px solid ${CYAN}`, borderRadius: radii.md,
                fontSize: 14, color: colors.text.primaryLight,
              }}>
                <span style={{ fontWeight: 800, color: CYAN_DARK }}>Entry fee: </span>
                {priceDescription(selectedCategory)}
                {concessionNote(selectedCategory, tournament) && (
                  <div style={{ marginTop: 6, color: colors.text.mutedLight }}>{concessionNote(selectedCategory, tournament)}</div>
                )}
              </div>
            )}
            {offerStudent(playerAge) && (
              <CheckRow
                checked={form.player_student}
                onChange={(v) => set("player_student", v)}
                label={`I'm a current ${tournament.student_label ?? "student"} (${fmtMoney(studentPrice!)} instead of ${fmtMoney(categoryPrice!)})`}
                hint="Your student ID may be checked at check-in."
              />
            )}
          </Card>

          {/* Partner section (conditional) */}
          <AnimatePresence initial={false}>
            {selectedCategory && selectedCategory.team_size === 2 && (
              <motion.div
                key="partner"
                initial={reduce ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: easings.standard }}
                style={{ overflow: "hidden" }}
              >
                <Card>
                  <SectionHeader
                    step={stepOf("partner")}
                    title="Your partner"
                    sub={selectedCategory.allow_solo_signup ? undefined : "Only one member of each team needs to submit this form."}
                  />
                  {selectedCategory.allow_solo_signup && <PartnerPromise compact />}
                  <Field label="Partner Name" required={!selectedCategory.allow_solo_signup} error={visibleErrors.partner_name}>
                    <input type="text" style={inputStyle}
                      value={form.partner_name}
                      onChange={(e) => set("partner_name", e.target.value)}
                      onBlur={() => markTouched("partner_name")} />
                  </Field>
                  <Field label="Partner Contact" required={!selectedCategory.allow_solo_signup} hint="Numbers only" error={visibleErrors.partner_phone}>
                    <input type="tel" inputMode="numeric" style={inputStyle}
                      value={form.partner_phone}
                      onChange={(e) => set("partner_phone", phoneInput(e.target.value))}
                      onBlur={() => markTouched("partner_phone")} />
                  </Field>
                  <Field label="Partner Email" required={!selectedCategory.allow_solo_signup} error={visibleErrors.partner_email}>
                    <input type="email" inputMode="email" style={inputStyle}
                      value={form.partner_email}
                      onChange={(e) => set("partner_email", e.target.value)}
                      onBlur={() => markTouched("partner_email")} />
                  </Field>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Rules and waiver */}
          {waiverRequired && (
            <Card>
              <SectionHeader
                step={stepOf("waiver")}
                title="Rules and waiver"
                sub={<>Every player must read the competition regulations and agree to the waiver before taking part.
                  {playerIsMinor && " The player is under 19, so a parent or guardian must accept on their behalf."}</>}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: spacing.md, marginBottom: spacing.md }}>
                {safeHttpUrl(tournament.rules_url) && (
                  <a href={safeHttpUrl(tournament.rules_url)} target="_blank" rel="noopener" style={{ color: CYAN_DARK, fontWeight: 700, fontSize: 14 }}>
                    Read the competition regulations ↗
                  </a>
                )}
                {safeHttpUrl(tournament.waiver_url) && (
                  <a href={safeHttpUrl(tournament.waiver_url)} target="_blank" rel="noopener" style={{ color: CYAN_DARK, fontWeight: 700, fontSize: 14 }}>
                    Open the waiver in a new tab ↗
                  </a>
                )}
              </div>
              <div
                role="region" aria-label="Waiver text" tabIndex={0}
                style={{
                  maxHeight: 240, overflowY: "auto", padding: spacing.md,
                  background: colors.bg.muted, border: `1px solid ${colors.border.lightStrong}`, borderRadius: radii.md,
                  fontSize: 13, lineHeight: 1.55, color: colors.text.primaryLight, whiteSpace: "pre-wrap",
                }}
              >
                {tournament.waiver_text}
              </div>
              <div style={{ marginTop: spacing.md }}>
                <CheckRow checked={form.accepted_rules} onChange={(v) => { set("accepted_rules", v); markTouched("accepted_rules"); }}
                  label="I have read the competition regulations." error={visibleErrors.accepted_rules} />
                <CheckRow checked={form.accepted_waiver} onChange={(v) => { set("accepted_waiver", v); markTouched("accepted_waiver"); }}
                  label="I have read and understood the Acknowledgement of Risk and Release of Liability above, and I agree to it."
                  error={visibleErrors.accepted_waiver} />
                <CheckRow checked={form.accepted_codes} onChange={(v) => { set("accepted_codes", v); markTouched("accepted_codes"); }}
                  label="I have read and will follow the Badminton BC codes of conduct (linked in the regulations)."
                  error={visibleErrors.accepted_codes} />
              </div>
              {playerIsMinor && (
                <Field label="Parent or guardian's full name" required error={visibleErrors.guardian_name}>
                  <input type="text" autoComplete="off" style={inputStyle}
                    value={form.guardian_name}
                    onChange={(e) => set("guardian_name", e.target.value)}
                    onBlur={() => markTouched("guardian_name")} />
                </Field>
              )}
              <Field
                label={playerIsMinor ? "Parent or guardian's signature" : "Your signature"}
                required
                hint={playerIsMinor ? "Type the parent or guardian's full name, as entered above." : "Type your full name, as entered above."}
                error={visibleErrors.signature}
              >
                <input type="text" autoComplete="off" style={{ ...inputStyle, fontStyle: "italic" }}
                  value={form.signature}
                  onChange={(e) => set("signature", e.target.value)}
                  onBlur={() => markTouched("signature")} />
              </Field>
              {selectedCategory?.team_size === 2 && form.partner_email.trim() && (
                <p style={{ fontSize: 13, color: colors.text.mutedLight, margin: 0, lineHeight: 1.5 }}>
                  We'll email {form.partner_name.trim() || "your partner"} a link to read the regulations and accept the waiver too.
                </p>
              )}
            </Card>
          )}

          {/* Payment section */}
          <Card>
            <SectionHeader step={stepOf("payment")} title="Payment" />
            {showPaymentSplit && baseFee !== null && (
              <Field label="Payment split for this team">
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: spacing.sm }}>
                  {([
                    { v: "separate" as PaymentSplit, label: `Partner pays their own share (you pay ${fmtMoney(ownShare ?? baseFee)})` },
                    { v: "full" as PaymentSplit, label: ageRequired ? "I'll pay for both (total depends on your partner's age)" : `I'll pay for both (${fmtMoney(baseFee * 2)} total)` },
                  ]).map((o) => {
                    const sel = paymentSplit === o.v;
                    return (
                      <button key={o.v} type="button"
                        onClick={() => set("payment_split", o.v)}
                        style={{
                          padding: "12px 16px", borderRadius: radii.md, textAlign: "left",
                          border: `2px solid ${sel ? CYAN : colors.border.lightStrong}`,
                          background: sel ? "rgba(0, 212, 255, 0.08)" : colors.bg.card,
                          color: sel ? CYAN_DARK : colors.text.primaryLight,
                          fontSize: 14, fontWeight: 700, cursor: "pointer", minHeight: 48,
                        }}>{o.label}</button>
                    );
                  })}
                </div>
              </Field>
            )}
            {((partnerAgeNeeded && paymentSplit === "full") || bandedPartnerAge) && (
              <>
                <Field
                  label="Partner's age on the tournament date" required
                  hint={bandedPartnerAge
                    ? `Both partners must be ${selectedCategory!.min_age}+ on the tournament date.`
                    : "Prices your partner's share."}
                  error={visibleErrors.partner_age}>
                  <input
                    type="text" inputMode="numeric" style={{ ...inputStyle, maxWidth: 120 }}
                    value={form.partner_age}
                    onChange={(e) => set("partner_age", e.target.value.replace(/\D/g, "").slice(0, 3))}
                    onBlur={() => markTouched("partner_age")}
                  />
                </Field>
                {partnerAgeNeeded && paymentSplit === "full" && offerStudent(partnerAge) && (
                  <CheckRow
                    checked={form.partner_student}
                    onChange={(v) => set("partner_student", v)}
                    label={`My partner is a current ${tournament.student_label ?? "student"} (${fmtMoney(studentPrice!)})`}
                    hint="Their student ID may be checked at check-in."
                  />
                )}
              </>
            )}
            {cardAvailable && etransferDue !== null && cardDue !== null && (
              <Field label="How would you like to pay?" required>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: spacing.sm }}>
                  {([
                    { v: "etransfer" as const, title: `Interac e-Transfer · ${fmtMoney(etransferDue)}`, sub: "The lower price. Send the e-Transfer, then enter its reference number." },
                    { v: "card" as const, title: `Card, Apple Pay or Google Pay · ${fmtMoney(cardDue)}`, sub: "Pay now on Stripe's secure checkout page. Shows on your statement as ADAWAR* SHUTTLE STORM." },
                  ]).map((o) => {
                    const sel = payMethod === o.v;
                    return (
                      <button key={o.v} type="button" onClick={() => set("payment_method", o.v)}
                        style={{
                          padding: "12px 16px", borderRadius: radii.md, textAlign: "left",
                          border: `2px solid ${sel ? CYAN : colors.border.lightStrong}`,
                          background: sel ? "rgba(0, 212, 255, 0.08)" : colors.bg.card,
                          cursor: "pointer", minHeight: 56,
                        }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: sel ? CYAN_DARK : colors.text.primaryLight }}>{o.title}</div>
                        <div style={{ fontSize: 12, color: colors.text.mutedLight, marginTop: 2 }}>{o.sub}</div>
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}
            {payMethod === "etransfer" ? (
              <Field label="e-Transfer reference #" required hint="Send your e-transfer first, then paste the reference number here" error={visibleErrors.payment_reference}>
                <input type="text" style={inputStyle} autoCapitalize="characters"
                  value={form.payment_reference}
                  onChange={(e) => set("payment_reference", e.target.value)}
                  onBlur={() => markTouched("payment_reference")} />
              </Field>
            ) : (
              <div style={{ fontSize: 13, color: colors.text.mutedLight, lineHeight: 1.5 }}>
                After you submit, you'll pay {cardDue !== null ? fmtMoney(cardDue) : ""} on Stripe's secure checkout.
                Your registration goes to the organizers once the payment completes.
              </div>
            )}
            <Field label="Comments" hint={`${form.comments.length}/500 characters`} error={visibleErrors.comments}>
              <textarea
                rows={3}
                style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
                value={form.comments}
                onChange={(e) => set("comments", e.target.value.slice(0, 500))}
                onBlur={() => markTouched("comments")}
              />
            </Field>
          </Card>

          {/* Where they heard about us (optional) — checked against ad results */}
          <Card>
            <Field label="How did you hear about us?" hint="Optional. Helps us know which posts and ads reach players.">
              <select
                style={{ ...inputStyle, appearance: "auto" }}
                value={form.heard_from}
                onChange={(e) => set("heard_from", e.target.value)}
              >
                <option value="">Choose one</option>
                {HEARD_FROM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </Card>

          {/* Submit */}
          <div style={{ padding: `${spacing.lg}px ${spacing.md}px ${spacing.xxxl}px` }}>
            {cardReturn === "cancelled" && submitStatus !== "error" && (
              <div style={{
                padding: spacing.md, marginBottom: spacing.md,
                background: colors.bg.muted, border: `1px solid ${colors.border.lightStrong}`,
                borderRadius: radii.md, color: colors.text.primaryLight, fontSize: 14,
              }}>
                Card payment cancelled. You weren't charged. Submit again to retry, or choose e-Transfer.
              </div>
            )}
            {submitError && submitStatus === "error" && (
              <div style={{
                padding: spacing.md, marginBottom: spacing.md,
                background: colors.state.liveSubtle, border: `1px solid ${colors.state.live}`,
                borderRadius: radii.md, color: colors.state.live, fontSize: 14, fontWeight: 600,
              }}>
                {submitError}
              </div>
            )}
            <button
              type="submit"
              disabled={submitStatus === "submitting"}
              style={{
                width: "100%", minHeight: 56, padding: "16px 24px",
                borderRadius: radii.md, border: "none",
                background: submitStatus === "submitting" ? colors.text.mutedLight : CYAN,
                color: "#001a20", fontSize: 17, fontWeight: 800, letterSpacing: 0.3,
                cursor: submitStatus === "submitting" ? "not-allowed" : "pointer",
                boxShadow: "0 4px 12px rgba(0, 212, 255, 0.32)",
              }}
            >
              {submitStatus === "submitting"
                ? (payMethod === "card" ? "Opening secure checkout…" : "Submitting…")
                : payMethod === "card" && cardDue !== null ? `Continue to payment · ${fmtMoney(cardDue)}` : "Submit Registration"}
            </button>
            <p style={{ margin: `${spacing.md}px 0 0`, textAlign: "center", fontSize: 13, color: colors.text.mutedLight }}>
              How we use your details:{" "}
              <a href={PRIVACY_URL} target="_blank" rel="noopener" style={{ color: "inherit" }}>privacy policy</a>
              {GA_MEASUREMENT_ID && (
                <>
                  {" · "}
                  <button
                    type="button" data-consent-open
                    style={{ font: "inherit", color: "inherit", background: "none", border: 0, padding: 0, textDecoration: "underline", cursor: "pointer" }}
                  >
                    cookie settings
                  </button>
                </>
              )}
            </p>
          </div>
        </form>
      )}
    </PageShell>
  );
}

// ---------- Page shell --------------------------------------------------------

const AGE_BAND_LABEL: Record<AgeBand, string> = { kid: "Junior", teen: "Youth", adult: "Adult" };

function numOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtShortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

// "Under 18: $30. UFV students: $30." when those beat the category price.
function concessionNote(category: Category, t: Tournament): string | null {
  const price = numOrNull(category.price);
  if (price === null || priceBasis(category) === "per_team") return null;
  const parts: string[] = [];
  const youth = numOrNull(t.youth_price);
  const student = numOrNull(t.student_price);
  if (youth !== null && youth < price) parts.push(`Under 18: ${fmtMoney(youth)}`);
  if (student !== null && student < price) parts.push(`${t.student_label ? `${t.student_label}s` : "Students"}: ${fmtMoney(student)}`);
  return parts.length ? `${parts.join(". ")} per player.` : null;
}

// ---------- Category picker (sub-component) ----------------------------------

type CategoryPickerProps = {
  categories: Category[];
  value: string | null;
  onChange: (id: string) => void;
  isMobile: boolean;
};

function CategoryPicker({ categories, value, onChange, isMobile }: CategoryPickerProps) {
  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
        {categories.map((c) => {
          const sel = c.id === value;
          const price = priceLabel(c);
          return (
            <button key={c.id} type="button" onClick={() => onChange(c.id)}
              style={{
                padding: spacing.md, borderRadius: radii.md, textAlign: "left",
                border: `2px solid ${sel ? CYAN : colors.border.lightStrong}`,
                background: sel ? "rgba(0, 212, 255, 0.08)" : colors.bg.card,
                cursor: "pointer", minHeight: 56,
                display: "flex", flexDirection: "column", gap: 4,
              }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: colors.text.primaryLight }}>{c.name}</div>
              <div style={{ fontSize: 12, color: colors.text.mutedLight, display: "flex", gap: spacing.sm }}>
                <span>{c.team_size === 1 ? "Singles" : "Doubles"}</span>
                {c.age_band && <span>• {AGE_BAND_LABEL[c.age_band]}</span>}
                {price && <span>• {price}</span>}
              </div>
            </button>
          );
        })}
        {categories.length === 0 && (
          <div style={{ color: colors.text.mutedLight, fontSize: 13, padding: spacing.md }}>
            No categories available.
          </div>
        )}
      </div>
    );
  }
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      style={inputStyle}
    >
      <option value="" disabled>Choose a category…</option>
      {categories.map((c) => {
        const price = priceLabel(c);
        return (
          <option key={c.id} value={c.id}>
            {c.name} — {c.team_size === 1 ? "Singles" : "Doubles"}
            {c.age_band ? ` (${AGE_BAND_LABEL[c.age_band]})` : ""}{price ? ` — ${price}` : ""}
          </option>
        );
      })}
    </select>
  );
}

// ---------- PushOptInButton -------------------------------------------------

type PushUiState = "idle" | "working" | "enabled" | "denied" | "unsupported" | "error";

// Detailed support detection — separated so we can show ALL diagnostics on
// the screen when the user can't get push to work. iOS Safari has subtle
// failure modes (PushManager missing, not installed to home screen, < 16.4)
// that previously silently hid the button. Now we always render and tell
// the user exactly what's missing.
function pushDiagnostics(): { ok: boolean; missing: string[]; standalone: boolean } {
  const missing: string[] = [];
  if (typeof window === "undefined") missing.push("window (SSR)");
  else {
    if (!("Notification" in window)) missing.push("Notification API");
    if (!("serviceWorker" in navigator)) missing.push("Service Worker");
    
    const hasPushManager =
      "PushManager" in window ||
      (typeof ServiceWorkerRegistration !== "undefined" && "pushManager" in ServiceWorkerRegistration.prototype);
    if (!hasPushManager) missing.push("PushManager");
  }
  // iOS standalone detection — Apple-specific property + general matchMedia
  const standalone =
    typeof navigator !== "undefined" &&
    // @ts-expect-error iOS-only non-standard property
    (navigator.standalone === true ||
      (typeof window !== "undefined" &&
        window.matchMedia?.("(display-mode: standalone)").matches));
  return { ok: missing.length === 0, missing, standalone };
}

function PushOptInButton({
  tournamentId,
  pendingRegistrationId,
}: { tournamentId: string; pendingRegistrationId: string }) {
  const [state, setState] = useState<PushUiState>(() => {
    const s = pushSupportStatus();
    if (s === "unsupported") return "unsupported";
    if (s === "denied") return "denied";
    return "idle";
  });
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const diag = pushDiagnostics();

  // Report unsupported-in-PWA exactly once per mount. `diag.missing` is a
  // fresh array every render, so listing it in deps would refire each render;
  // a ref guard keeps this strictly one-shot.
  const reportedRef = useRef(false);
  useEffect(() => {
    if (reportedRef.current) return;
    if (state === "unsupported" && diag.standalone) {
      reportedRef.current = true;
      captureError(new Error("Push unsupported in PWA standalone mode"), {
        missing: diag.missing,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        maxTouchPoints: navigator.maxTouchPoints,
      });
    }
  }, [state, diag.standalone, diag.missing]);

  // iOS PWAs report Mac UA in standalone — easier to detect via standalone flag
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent ?? "") ||
    (navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1);

  const handleClick = async () => {
    setState("working");
    setErrMsg(null);
    const result = await subscribeToPush(tournamentId, {
      kind: "player",
      pending_registration_id: pendingRegistrationId,
    });
    if (result.ok) {
      setState("enabled");
    } else if (result.reason === "denied") {
      setState("denied");
    } else {
      setState("error");
      setErrMsg(`${result.reason}: ${result.error ?? "Couldn't enable notifications"}`);
    }
  };

  // ---- ENABLED state (success) ----
  if (state === "enabled") {
    return (
      <div style={{
        marginTop: spacing.lg, padding: spacing.md,
        background: "rgba(0, 212, 255, 0.08)",
        border: `1px solid ${CYAN}`, borderRadius: radii.md,
        fontSize: 14, fontWeight: 700, color: CYAN_DARK,
      }}>
        🔔 Notifications enabled — you'll get pinged when your court is ready.
      </div>
    );
  }

  // ---- DENIED state ----
  if (state === "denied") {
    return (
      <div style={{
        marginTop: spacing.lg, padding: spacing.md,
        background: colors.bg.muted, borderRadius: radii.md,
        fontSize: 13, color: colors.text.mutedLight, lineHeight: 1.5,
      }}>
        Notifications were blocked for this site. To re-enable, allow them in
        your browser/iOS Settings → Notifications → Badminton, then refresh.
      </div>
    );
  }

  // ---- UNSUPPORTED state — show helpful instructions ----
  if (state === "unsupported") {
    let helper: string;
    if (isIOS && !diag.standalone) {
      helper = "On iPhone, push notifications require installing the app. Tap the Share button ⬆️ then 'Add to Home Screen', then open the new icon and submit again.";
    } else if (isIOS && diag.standalone) {
      if (diag.missing.includes("PushManager")) {
        helper = "Web Push on iPhone is supported, but PushManager is not active. Please ensure you are running iOS 16.4 or later and launched the app from the Home Screen icon.";
      } else {
        helper = "Web Push on iPhone is not supported on this device. (Missing: " + diag.missing.join(", ") + ")";
      }
    } else {
      helper = "Your browser doesn't support web push notifications. Try Chrome, Edge, or Firefox. (Missing: " + diag.missing.join(", ") + ")";
    }
    return (
      <div style={{
        marginTop: spacing.lg, padding: spacing.md,
        background: colors.bg.muted, borderRadius: radii.md,
        fontSize: 13, color: colors.text.mutedLight, lineHeight: 1.5,
      }}>
        🔔 {helper}
      </div>
    );
  }

  // ---- IDLE / WORKING / ERROR — render the button ----
  return (
    <>
      {/* Two-line explainer above the CTA. Earlier copy ("Get notified when
          your court is ready") buried the value prop in the button label.
          Lifting it into a dedicated explainer + a tighter button label
          measurably moves opt-in rates on signup forms. */}
      <p style={{
        marginTop: spacing.lg,
        marginBottom: spacing.sm,
        fontSize: 13,
        fontWeight: 600,
        color: colors.text.primaryLight,
        lineHeight: 1.4,
      }}>
        Never miss your call — we'll push you the moment your court opens.
      </p>
      <p style={{
        marginTop: 0,
        marginBottom: 0,
        fontSize: 12,
        color: colors.text.mutedLight,
        lineHeight: 1.4,
      }}>
        Works on iPhone (when installed to home screen), Android, and desktop.
      </p>
      <button
        type="button"
        disabled={state === "working"}
        onClick={() => { void handleClick(); }}
        style={{
          marginTop: spacing.md, padding: "14px 20px",
          borderRadius: radii.md, border: `2px solid ${CYAN}`,
          background: colors.bg.card, color: CYAN_DARK,
          fontSize: 15, fontWeight: 800,
          cursor: state === "working" ? "wait" : "pointer",
          minHeight: 48, width: "100%",
        }}
      >
        {state === "working" ? "Enabling…" : "🔔 Turn on push notifications"}
      </button>
      {state === "error" && errMsg && (
        <div style={{ marginTop: spacing.sm, fontSize: 12, color: colors.state.live, lineHeight: 1.4 }}>
          {errMsg}
        </div>
      )}
    </>
  );
}

export default PublicRegistrationPage;
