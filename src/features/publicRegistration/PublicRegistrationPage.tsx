import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useIsMobile } from "../../hooks/useIsMobile";
import { submitPublicRegistration } from "../../lib/db";
import { colors, easings, radii, shadows, spacing, typography } from "../../lib/theme";
import type { Category, PublicRegistrationPayload, TournamentFees } from "../../types";
import { Countdown } from "./Countdown";
import { computeFee, type PaymentSplit } from "./computeFee";
import { usePublicTournament } from "./usePublicTournament";
import { emptyFormState, type FormErrors, type FormState, hasMemberDiscount, isValid, validate } from "./validate";

const CYAN = "#00d4ff";
const CYAN_DARK = "#006d80";

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

function fmtMoney(n: number | null): string {
  if (n === null) return "—";
  return `$${n}`;
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

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
};

function Field({ label, hint, error, required, children }: FieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          color: colors.text.mutedLight,
        }}
      >
        {label}{required && <span style={{ color: colors.state.live, marginLeft: 4 }}>*</span>}
      </label>
      {children}
      {/* Reserved 16px error slot prevents layout shift on blur validation */}
      <div style={{ minHeight: 16, fontSize: 12, color: colors.state.live }}>
        {error ? error : hint && <span style={{ color: colors.text.mutedLight }}>{hint}</span>}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  fontSize: 16, // 16+ avoids iOS auto-zoom on focus
  border: `1px solid ${colors.border.lightStrong}`,
  borderRadius: radii.md,
  background: colors.bg.card,
  color: colors.text.primaryLight,
  fontFamily: typography.body,
  boxSizing: "border-box",
  minHeight: 44,
};

function YesNoCards({
  value, onChange,
}: { value: boolean | null; onChange: (v: boolean) => void }) {
  const opts: Array<{ v: boolean; label: string }> = [
    { v: true, label: "Yes" },
    { v: false, label: "No" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: spacing.sm }}>
      {opts.map((o) => {
        const sel = value === o.v;
        return (
          <button
            key={String(o.v)} type="button" onClick={() => onChange(o.v)}
            style={{
              padding: "12px 16px",
              borderRadius: radii.md,
              border: `2px solid ${sel ? CYAN : colors.border.lightStrong}`,
              background: sel ? "rgba(0, 212, 255, 0.08)" : colors.bg.card,
              color: sel ? CYAN_DARK : colors.text.primaryLight,
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
              minHeight: 44,
              transition: "border-color 120ms, background 120ms",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

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

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === form.category_id) ?? null,
    [categories, form.category_id],
  );
  const fees: TournamentFees = tournament?.fees ?? {};
  const showMembershipQuestion = useMemo(() => hasMemberDiscount(fees), [fees]);
  const errors = useMemo(
    () => validate(form, selectedCategory, { requireMembership: showMembershipQuestion }),
    [form, selectedCategory, showMembershipQuestion],
  );
  const visibleErrors: FormErrors = useMemo(() => {
    const out: FormErrors = {};
    (Object.keys(errors) as Array<keyof FormState>).forEach((k) => {
      if (touched.has(k) || submitStatus === "error") out[k] = errors[k];
    });
    return out;
  }, [errors, touched, submitStatus]);

  // When membership question is hidden (flat-fee tournament), treat as non-member
  // for fee calc so a value is always available.
  const memberForFee = showMembershipQuestion ? form.player_is_member : false;
  const feeOwed = computeFee(fees, selectedCategory, memberForFee, form.payment_split);
  const baseFee = computeFee(fees, selectedCategory, memberForFee, "separate");

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
      player_is_member: form.player_is_member === true,
      payment_reference: form.payment_reference.trim(),
      payment_paid_full_for_partner: form.payment_split === "full",
      comments: form.comments.trim() || undefined,
      group_choice: form.group_choice ?? undefined,
    };
    if (selectedCategory.team_size === 2 && form.partner_name.trim()) {
      payload.partner_name = form.partner_name.trim();
      payload.partner_email = form.partner_email.trim();
      payload.partner_phone = form.partner_phone.trim() || undefined;
      if (form.partner_is_member !== null) payload.partner_is_member = form.partner_is_member;
    }

    const result = await submitPublicRegistration(payload);
    if (result.success) {
      setSubmitStatus("success");
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
            Registration submitted
          </div>
          <p style={{ color: colors.text.mutedLight, marginTop: spacing.md, fontSize: 15, lineHeight: 1.5 }}>
            Thanks, {form.player_name}! An admin will verify your e-transfer reference and
            confirm your spot shortly. You'll be visible in the player roster once approved.
          </p>
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
        <div style={{ marginTop: spacing.md, color: colors.text.mutedLight, fontSize: 15 }}>
          {fmtDate(tournament.event_date, tournament.event_time)}
        </div>
        {tournament.registration_deadline && (
          <div style={{ marginTop: spacing.md }}>
            <Countdown deadline={tournament.registration_deadline} />
          </div>
        )}
      </div>

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
            {tournament.venue_map_url && (
              <a href={tournament.venue_map_url} target="_blank" rel="noopener noreferrer"
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
          <Card>
            <Field label="Email" required hint="We'll send confirmation here" error={visibleErrors.player_email}>
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
            {showMembershipQuestion && (
              <Field label="Are you a club member?" required hint="Determines your fee tier" error={visibleErrors.player_is_member}>
                <YesNoCards
                  value={form.player_is_member}
                  onChange={(v) => { set("player_is_member", v); markTouched("player_is_member"); }}
                />
              </Field>
            )}
          </Card>

          {/* Category section */}
          <Card>
            <Field label="Choose your category" required error={visibleErrors.category_id}>
              <CategoryPicker
                categories={categories}
                value={form.category_id}
                onChange={(id) => { set("category_id", id); markTouched("category_id"); }}
                fees={fees}
                isMember={memberForFee}
                isMobile={isMobile}
              />
            </Field>
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
                  <div style={{ marginBottom: spacing.md }}>
                    <div style={{ fontFamily: typography.display, fontSize: 18, fontWeight: 700, color: colors.text.primaryLight }}>
                      Partner Information
                    </div>
                    <div style={{ fontSize: 13, color: colors.text.mutedLight, marginTop: 4 }}>
                      {selectedCategory.allow_solo_signup
                        ? "Optional — leave blank if you don't have a partner, we'll arrange one for you."
                        : "Only one member of each team needs to submit this form."}
                    </div>
                  </div>
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
                  {showMembershipQuestion && (
                    <Field label="Is your partner a club member?" required={!selectedCategory.allow_solo_signup} error={visibleErrors.partner_is_member}>
                      <YesNoCards
                        value={form.partner_is_member}
                        onChange={(v) => { set("partner_is_member", v); markTouched("partner_is_member"); }}
                      />
                    </Field>
                  )}
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Payment section */}
          <Card>
            {selectedCategory && selectedCategory.team_size === 2 && baseFee !== null && (
              <Field label="Payment split for this team">
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: spacing.sm }}>
                  {([
                    { v: "separate" as PaymentSplit, label: `Partner pays separately (${fmtMoney(baseFee)} each)` },
                    { v: "full" as PaymentSplit, label: `I'll pay for both (${fmtMoney(baseFee * 2)} total)` },
                  ]).map((o) => {
                    const sel = form.payment_split === o.v;
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
            <Field label="You owe">
              <div style={{
                padding: "14px 16px", background: "rgba(0, 212, 255, 0.08)",
                border: `1px solid ${CYAN}`, borderRadius: radii.md,
                fontSize: 22, fontWeight: 800, color: CYAN_DARK,
                ...typography.tabular,
              }}>
                {feeOwed !== null
                  ? <>CAD {fmtMoney(feeOwed)} <span style={{ fontSize: 12, fontWeight: 600, color: colors.text.mutedLight, marginLeft: spacing.sm }}>computed from category + membership</span></>
                  : <span style={{ fontSize: 14, color: colors.text.mutedLight }}>Select a category and membership status to see your fee.</span>}
              </div>
            </Field>
            <Field label="e-Transfer reference #" required hint="Send your e-transfer first, then paste the reference number here" error={visibleErrors.payment_reference}>
              <input type="text" style={inputStyle} autoCapitalize="characters"
                value={form.payment_reference}
                onChange={(e) => set("payment_reference", e.target.value)}
                onBlur={() => markTouched("payment_reference")} />
            </Field>
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

          {/* Submit */}
          <div style={{ padding: `${spacing.lg}px ${spacing.md}px ${spacing.xxxl}px` }}>
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
              {submitStatus === "submitting" ? "Submitting…" : "Submit Registration"}
            </button>
          </div>
        </form>
      )}
    </PageShell>
  );
}

// ---------- Page shell --------------------------------------------------------

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: "100vh", background: colors.bg.page,
      fontFamily: typography.body, color: colors.text.primaryLight,
    }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: `0 ${spacing.md}px` }}>
        {children}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: colors.bg.card,
      borderRadius: radii.xl,
      padding: spacing.lg,
      marginBottom: spacing.md,
      boxShadow: shadows.md,
      border: `1px solid ${colors.border.light}`,
      display: "flex", flexDirection: "column", gap: spacing.md,
    }}>
      {children}
    </div>
  );
}

// ---------- Category picker (sub-component) ----------------------------------

type CategoryPickerProps = {
  categories: Category[];
  value: string | null;
  onChange: (id: string) => void;
  fees: TournamentFees;
  isMember: boolean | null;
  isMobile: boolean;
};

function CategoryPicker({ categories, value, onChange, fees, isMember, isMobile }: CategoryPickerProps) {
  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
        {categories.map((c) => {
          const sel = c.id === value;
          const fee = computeFee(fees, c, isMember, "separate");
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
                {c.age_band && <span>• {c.age_band}</span>}
                {fee !== null && <span>• {fmtMoney(fee)}</span>}
                {c.allow_solo_signup && <span style={{ color: CYAN_DARK }}>• solo OK</span>}
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
        const fee = computeFee(fees, c, isMember, "separate");
        return (
          <option key={c.id} value={c.id}>
            {c.name} — {c.team_size === 1 ? "Singles" : "Doubles"}
            {c.age_band ? ` (${c.age_band})` : ""}{fee !== null ? ` — ${fmtMoney(fee)}` : ""}
          </option>
        );
      })}
    </select>
  );
}

export default PublicRegistrationPage;
