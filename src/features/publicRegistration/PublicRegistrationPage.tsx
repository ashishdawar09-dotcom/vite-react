// Public registration form at /register/<tournament_id>, in steps:
// You → Events → Partners (doubles only) → Waiver → Payment.
//
// One submission can enter several events and pays once for all of them
// (register-player creates one entry per event). Progress is kept on this
// device, the contact details are saved as a lead once they're in (so one
// reminder can go out if the player doesn't finish), and each step is
// tracked for the registration funnel.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { saveRegistrationLead, submitPublicRegistration } from "../../lib/db";
import {
  GA_MEASUREMENT_ID, PRIVACY_URL, initAnalytics, isTestEmail, rememberPendingCardRegistration,
  takePendingCardRegistration, trackRegistrationComplete, trackRegistrationStep,
} from "../../lib/analytics";
import { captureAttribution, getAttribution } from "../../lib/attribution";
import { captureError, captureWarning } from "../../lib/sentry";
import { lazyWithReload } from "../../lib/lazyWithReload";
import { clearDraft, loadDraft, saveDraft } from "./draft";
import {
  STEP_LABEL, buildPayload, emptyFlow, emptyPartner, firstInvalidStep, hasErrors, isDoubles, partnerMode,
  partnerOf, selectedCategories, stepErrors, stepsFor, totalFee,
  type FlowContext, type FlowState, type StepKey,
} from "./multiEntry";
import { flowLead } from "./registrationLead";
import { GoodToKnow, Hero, StepEvents, StepPartners, StepPay, StepWaiver, StepYou, WelcomeBack, type Highlight, type StepProps } from "./steps";
import { Success } from "./Success";
import { ChatWithUs } from "./ChatWithUs";
import { usePublicTournament } from "./usePublicTournament";
import { useEntryCapacity } from "./useEntryCapacity";
import { SpotsMeter, SpotsStrip } from "./SpotsMeter";
import { formSpot } from "../../lib/liveVisitors";
import { useFormVisitorPing } from "./useFormVisitorPing";
import type { Socials } from "./FullHouse";
import { ActionBar, ActionButtons, Arrow, Button, Note, Progress, Shell, TopBar } from "./ss/parts";
import { isTextField, useKeepFieldInView, useTypingOnTouch } from "./ss/keyboard";
import { money, monoLabel, ss } from "./ss/theme";

// Event highlights under the title, per tournament.
const TOURNAMENT_HIGHLIGHTS: Record<string, Highlight[]> = {
  // Shuttle Storm '26
  "e7bb59ca-5cfc-4e5e-a4f6-0649ece00feb": [
    { title: "Badminton BC registered club", sub: "Run to Badminton BC standards", href: "https://www.badmintonbc.com" },
    { title: "Feather shuttles", sub: "Tournament grade, on every court" },
    { title: "Prizes", sub: "For first and second place in every category" },
  ],
};

// The "we're full" page loads only when it's needed (and reloads the page if
// a deploy replaced its file meanwhile).
const FullHouse = lazyWithReload(() => import("./FullHouse").then((m) => ({ default: m.FullHouse })));

// Where to follow the tournament, on the "we're full" page.
const TOURNAMENT_SOCIALS: Record<string, Socials> = {
  "e7bb59ca-5cfc-4e5e-a4f6-0649ece00feb": {
    instagram: "https://www.instagram.com/shuttlstorm/",
    facebook: "https://www.facebook.com/profile.php?id=61595251802328",
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A saved draft worth a "welcome back": something was typed or picked.
const draftHasContent = (s: FlowState) =>
  !!(s.player_name.trim() || s.player_email.trim() || s.player_phone.trim() || s.category_ids.length);

// The fields the keyboard's Next key moves through, in page order (not the
// hidden honeypot, nor textareas, where Enter is a new line).
function textFields(form: HTMLFormElement): HTMLInputElement[] {
  return [...form.querySelectorAll<HTMLInputElement>("input")].filter(
    (f) => isTextField(f) && f.name !== "website" && !f.disabled && f.getClientRects().length > 0,
  );
}

export function PublicRegistrationPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const { tournament, categories, loading, error } = usePublicTournament(tournamentId);
  const { capacity, loaded: capacityLoaded, refresh: refreshCapacity } = useEntryCapacity(tournamentId);
  const reduce = useReducedMotion();

  // Read once: ?category=<id> picks an event (e.g. from a partner's "Pay your
  // share" email), ?share=1 means they're paying their share of an entry that
  // named them, ?payment=success|cancelled is the way back from Stripe.
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const wantedCategory = params.get("category");
  const payingShare = params.get("share") === "1";
  // Paying a share of an entry that already named you, or coming back from a
  // cancelled card payment (whose entries still hold their spots): the form
  // stays open even when the count says full, and the server decides.
  const capBypass = payingShare || params.get("payment") === "cancelled";

  const [flow, setFlow] = useState<FlowState>(emptyFlow);
  const [step, setStep] = useState<StepKey>("you");
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState<Set<StepKey>>(new Set());
  const [status, setStatus] = useState<"idle" | "submitting" | "success">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [cardReturn, setCardReturn] = useState<"paid" | "cancelled" | null>(null);
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [done, setDone] = useState<{ events: string[]; name: string; namedPartners: number } | null>(null);
  const [welcomeBack, setWelcomeBack] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [errorTick, setErrorTick] = useState(0);
  // Honeypot: hidden from people; bots that fill it are dropped server-side.
  const [website, setWebsite] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pushed = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  // Once the old step has faded out: the top of the new step, or its first
  // problem (when submitting finds an earlier step incomplete).
  const afterStep = useRef<"top" | "error">("top");
  // Typing on a phone: the bottom bar steps aside, the field stays clear of
  // the keyboard (see ss/keyboard.ts).
  const typing = useTypingOnTouch();
  useKeepFieldInView();

  useEffect(() => { captureAttribution(); void initAnalytics(); }, []);

  // The browser's own scroll restore would put a reloaded or revisited form
  // at an old position (iOS lands mid-hero) and fight the step changes below.
  useEffect(() => {
    const h = window.history;
    if (!("scrollRestoration" in h)) return;
    const prev = h.scrollRestoration;
    h.scrollRestoration = "manual";
    return () => { h.scrollRestoration = prev; };
  }, []);

  const spotsLeft = capacity && !capBypass ? capacity.remaining : null;
  const ctx: FlowContext | null = useMemo(
    () => (tournament ? { tournament, categories, payingShareFor: payingShare ? wantedCategory : null, spotsLeft } : null),
    [tournament, categories, payingShare, wantedCategory, spotsLeft],
  );

  // When the page opened; the server enforces the deadline to the second.
  const [openedAt] = useState(() => Date.now());
  const deadlinePassed = !!tournament?.registration_deadline && new Date(tournament.registration_deadline).getTime() < openedAt;
  const formClosed = !!tournament && (!tournament.registration_open || deadlinePassed);

  // ---- Start: back from Stripe, a saved draft, or a fresh form ----
  // Runs once, after the tournament loads: it reads the URL and this device's
  // saved draft (outside React) into state.
  useEffect(() => {
    if (!tournament || !ctx || ready) return;
    const payment = params.get("payment");
    const reg = params.get("reg");
    const draft = loadDraft(tournament.id);
    const nameOf = (ids: string[]) => categories.filter((c) => ids.includes(c.id)).map((c) => c.name);

    if (payment === "success" && reg && UUID.test(reg)) {
      const s = draft?.state ?? emptyFlow();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time start from the URL and saved draft
      setRegistrationId(reg);
      setCardReturn("paid");
      setDone({ events: nameOf(s.category_ids), name: s.player_name, namedPartners: s.category_ids.filter((id) => s.partners[id]?.mode === "named" && !!s.partners[id]?.email.trim()).length });
      setStatus("success");
      if (!isTestEmail(s.player_email)) {
        trackRegistrationComplete(reg, { payment_method: "card", value: takePendingCardRegistration(), tournament_id: tournament.id, events: s.category_ids.length || undefined });
      }
      clearDraft(tournament.id);
    } else {
      let s = draft?.state ?? emptyFlow();
      // Only events that still exist come back from a draft.
      s = { ...s, category_ids: s.category_ids.filter((id) => categories.some((c) => c.id === id)) };
      if (wantedCategory && categories.some((c) => c.id === wantedCategory) && !s.category_ids.includes(wantedCategory)) {
        s = { ...s, category_ids: [...s.category_ids, wantedCategory] };
      }
      if (payingShare && wantedCategory && categories.some((c) => c.id === wantedCategory)) {
        s = { ...s, partners: { ...s.partners, [wantedCategory]: { ...(s.partners[wantedCategory] ?? emptyPartner()), mode: "named", split: "separate" } } };
      }
      let target: StepKey = payment === "cancelled" ? "pay" : draft?.step ?? "you";
      const steps = stepsFor(s, ctx);
      if (!steps.includes(target)) target = "you";
      // Never past a step that isn't complete.
      for (const k of steps.slice(0, steps.indexOf(target))) {
        if (hasErrors(stepErrors(k, s, ctx))) { target = k; break; }
      }
      if (payment === "cancelled") setCardReturn("cancelled");
      else if (draft && draftHasContent(s)) setWelcomeBack(true);
      setFlow(s);
      setStep(target);
    }
    if (payment) window.history.replaceState({ ssStep: "you" }, "", window.location.pathname);
    setReady(true);
  }, [tournament, ctx, ready, params, categories, wantedCategory, payingShare]);

  // The step in the browser history, so the phone's back button goes back a step.
  useEffect(() => {
    if (!ready) return;
    window.history.replaceState({ ...(window.history.state ?? {}), ssStep: step }, "");
    // Only on start; later steps are pushed by goNext.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const s = (e.state as { ssStep?: StepKey } | null)?.ssStep;
      if (s) {
        pushed.current = Math.max(0, pushed.current - 1);
        setStep(s);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ---- Keep progress on this device ----
  useEffect(() => {
    if (!ready || !tournament || status === "success") return;
    const id = setTimeout(() => saveDraft(tournament.id, step, flow), 300);
    return () => clearTimeout(id);
  }, [ready, tournament, step, flow, status]);

  // ---- Save the lead once name and email are typed (step 1), as before ----
  const leadOpen = !!tournament && !formClosed;
  const typedLead = useMemo(() => (step === "you" ? flowLead(tournamentId, flow, "you") : null), [step, tournamentId, flow]);
  const typedKey = typedLead ? `${typedLead.email}|${typedLead.name}|${typedLead.phone ?? ""}` : null;
  const savedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!typedLead || !typedKey || !leadOpen || typedKey === savedKey.current) return;
    const id = setTimeout(() => { savedKey.current = typedKey; void saveRegistrationLead(typedLead); }, 1500);
    return () => clearTimeout(id);
  }, [typedLead, typedKey, leadOpen]);

  // ---- Counted in the admins' live "on the registration form now" (no names) ----
  useFormVisitorPing(tournamentId, formSpot({
    loaded: !loading && ready && capacityLoaded,
    found: !error && !!tournament,
    success: status === "success",
    full: !!capacity?.full && !capBypass,
    closed: formClosed,
    step,
  }));

  // Computer keyboards: a field that gets focus is kept clear of the bar
  // pinned to the bottom of the screen.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.scrollPaddingBottom;
    root.style.scrollPaddingBottom = "190px";
    return () => { root.style.scrollPaddingBottom = prev; };
  }, []);

  // The keyboard's action key reads "Next" between fields, and "Go" on a
  // step's last field ("Done" on the payment step, where it never submits).
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const onFocus = (e: FocusEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || !isTextField(t)) return;
      const fields = textFields(form);
      t.enterKeyHint = fields[fields.length - 1] === t ? (step === "pay" ? "done" : "go") : "next";
    };
    form.addEventListener("focusin", onFocus);
    return () => form.removeEventListener("focusin", onFocus);
  }, [step, ready, status]);

  const set = useCallback(<K extends keyof FlowState>(key: K, value: FlowState[K]) => {
    setFlow((f) => ({ ...f, [key]: value }));
    setSubmitError(null);
  }, []);

  // A blocked step shows its messages; bring the first one into view.
  useEffect(() => {
    if (!errorTick) return;
    const el = document.querySelector<HTMLElement>("[data-field-error]");
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.querySelector<HTMLElement>("input, select, textarea, button, [tabindex='0']")?.focus({ preventScroll: true });
  }, [errorTick]);

  const steps = ctx ? stepsFor(flow, ctx) : (["you"] as StepKey[]);
  const index = Math.max(0, steps.indexOf(step));
  const errorsNow = ctx ? stepErrors(step, flow, ctx) : null;
  const visibleErrors = shown.has(step) ? errorsNow : null;
  const total = ctx ? totalFee(flow, ctx) : null;
  const cardAvailable = total !== null && total > 0;
  const payMethod = cardAvailable ? flow.payment_method : "etransfer";
  const picked = ctx ? selectedCategories(flow, ctx) : [];

  // Changing step: the old one fades out, then the page jumps to the top of
  // the new one while nothing is on screen (see onExitComplete below). No
  // smooth scroll racing the swap.
  const show = (s: StepKey) => setStep(s);

  const goNext = () => {
    if (!ctx || !tournament) return;
    if (errorsNow && hasErrors(errorsNow)) {
      setShown((p) => new Set(p).add(step));
      setErrorTick((n) => n + 1);
      return;
    }
    const next = steps[index + 1];
    if (!next) return;
    const lead = flowLead(tournament.id, flow, next);
    if (lead && leadOpen) void saveRegistrationLead(lead);
    trackRegistrationStep(next, index + 2, { events: flow.category_ids.length, value: total ?? undefined });
    setWelcomeBack(false);
    window.history.pushState({ ssStep: next }, "");
    pushed.current += 1;
    show(next);
  };

  const goBack = () => {
    const prev = steps[index - 1];
    if (!prev) return;
    if (pushed.current > 0) {
      window.history.back(); // popstate moves the step
    } else {
      window.history.replaceState({ ssStep: prev }, "");
      show(prev);
    }
  };

  const startOver = () => {
    if (!tournament) return;
    clearDraft(tournament.id);
    setFlow(emptyFlow());
    setShown(new Set());
    setWelcomeBack(false);
    show("you");
  };

  const onCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch { /* clipboard blocked */ }
  };

  const submit = async () => {
    if (!ctx || !tournament || status === "submitting") return;
    const bad = firstInvalidStep(flow, ctx);
    if (bad) {
      setShown(new Set(steps.slice(0, steps.indexOf(bad) + 1)));
      captureWarning("Registration blocked by form validation", { first_step: bad, payment_method: payMethod, events: String(flow.category_ids.length) });
      if (bad !== step) {
        afterStep.current = "error";
        show(bad);
      } else {
        setErrorTick((n) => n + 1);
      }
      return;
    }
    setStatus("submitting");
    setSubmitError(null);
    const payload = buildPayload(flow, ctx, { website, attribution: getAttribution(), payMethod });
    const result = await submitPublicRegistration(payload);
    if (result.success && result.checkoutUrl) {
      // Card: Stripe Checkout takes over and sends the player back here.
      if (total !== null) rememberPendingCardRegistration(total);
      saveDraft(tournament.id, "pay", flow);
      window.location.assign(result.checkoutUrl);
      return;
    }
    if (result.success) {
      setRegistrationId(result.registrationId ?? null);
      setDone({
        events: picked.map((c) => c.name),
        name: flow.player_name,
        namedPartners: picked.filter((c) => isDoubles(c) && partnerMode(flow, c) === "named" && !!partnerOf(flow, c).email.trim()).length,
      });
      setStatus("success");
      clearDraft(tournament.id);
      window.scrollTo({ top: 0 });
      if (!isTestEmail(flow.player_email)) {
        trackRegistrationComplete(result.registrationId ?? null, {
          payment_method: "etransfer", value: total ?? undefined, tournament_id: tournament.id, events: picked.length,
        });
      }
      return;
    }
    setStatus("idle");
    setSubmitError(result.error ?? "Submission failed. Please try again.");
    // Refused because the entries don't fit: read the count again. If it's
    // full, the page turns into the waitlist with these details filled in.
    if (result.full !== undefined || result.remaining !== undefined) void refreshCapacity();
    // status is undefined when the request never got a response (offline,
    // timeout, blocked). Some server messages quote ages, so digits are masked.
    const detail = {
      status: result.status ?? null,
      server_error: result.error?.replace(/\d+/g, "#") ?? null,
      payment_method: payMethod,
      events: picked.length,
    };
    if (result.status !== undefined && result.status < 500) {
      captureWarning(`Registration rejected by server: ${result.status}`, { status: String(result.status) }, detail);
    } else {
      captureError(new Error(`Registration submit failed: ${result.status ?? "no response"}`), detail);
    }
  };

  const enterAnother = () => {
    setFlow((f) => ({
      ...emptyFlow(),
      player_name: f.player_name || done?.name || "",
      player_email: f.player_email,
      player_phone: f.player_phone,
      player_age: f.player_age,
      player_student: f.player_student,
      guardian_name: f.guardian_name,
      payment_method: f.payment_method,
    }));
    setStatus("idle");
    setCardReturn(null);
    setDone(null);
    setShown(new Set());
    window.scrollTo(0, 0);
    show(flow.player_email ? "events" : "you");
  };

  // ---------- loading / not found / closed ----------
  if (loading || (tournament && !ready) || !capacityLoaded) {
    return (
      <Shell bottomSpace={false}>
        <TopBar deadline={null} />
        <div style={{ ...monoLabel, padding: "80px 0", textAlign: "center" }}>Loading…</div>
      </Shell>
    );
  }
  if (error || !tournament || !ctx) {
    return (
      <Shell bottomSpace={false}>
        <TopBar deadline={null} />
        <div style={{ padding: "60px 0" }}><Note tone="danger">{error ?? "Tournament not found"}</Note></div>
      </Shell>
    );
  }

  // ---------- after submitting ----------
  if (status === "success") {
    return (
      <Shell bottomSpace={false}>
        <TopBar deadline={null} />
        <Success
          tournament={tournament}
          events={done?.events ?? []}
          playerName={done?.name ?? flow.player_name}
          paidByCard={cardReturn === "paid"}
          registrationId={registrationId}
          namedPartners={done?.namedPartners ?? 0}
          onAnother={enterAnother}
        />
        {/* Beside Success, not in it: its entrance animation transforms it, and
            a transformed parent would pin the button to it, not the screen. */}
        {tournament.whatsapp_number && (
          <ChatWithUs clubNumber={tournament.whatsapp_number} tournamentName={tournament.name} events={done?.events ?? []} />
        )}
      </Shell>
    );
  }

  // ---------- every spot taken ----------
  if (capacity?.full && !capBypass) {
    return (
      <Shell bottomSpace={false}>
        <TopBar deadline={null} status="Entries full" />
        <Suspense fallback={<FullHouseLoading />}>
          <FullHouse
            tournament={tournament}
            capacity={capacity}
            eventCount={categories.length}
            prefill={{ name: flow.player_name, email: flow.player_email, phone: flow.player_phone }}
            socials={TOURNAMENT_SOCIALS[tournament.id]}
          />
        </Suspense>
      </Shell>
    );
  }

  if (formClosed) {
    return (
      <Shell bottomSpace={false}>
        <TopBar deadline={null} />
        <Hero tournament={tournament} />
        <Note tone="danger">Registration is closed for this tournament.</Note>
      </Shell>
    );
  }

  // ---------- the form ----------
  const soloOffered = categories.some((c) => isDoubles(c) && c.allow_solo_signup);
  const props: StepProps = { flow, set, ctx, tournament, errors: visibleErrors, headingRef };
  const isPay = step === "pay";
  const summary = (step === "events" || step === "partners" || isPay) && picked.length > 0 ? (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span style={monoLabel}>{picked.length} event{picked.length === 1 ? "" : "s"}</span>
      <span style={{ fontFamily: ss.mono, fontSize: 14, lineHeight: "20px", color: ss.bone }}>{total === null ? "" : money(total)}</span>
    </div>
  ) : null;

  const primary = isPay ? (
    <Button onClick={() => { submit().catch((err: unknown) => { setStatus("idle"); setSubmitError("Something went wrong. Please try again."); captureError(err, { where: "registration submit" }); }); }}
      disabled={status === "submitting"} style={{ flex: 1 }}>
      {status === "submitting"
        ? (payMethod === "card" ? "Opening secure checkout…" : "Submitting…")
        : payMethod === "card" && total !== null ? <>Pay {money(total)} securely <Arrow /></> : <>Submit entry{total !== null ? ` · ${money(total)}` : ""} <Arrow /></>}
    </Button>
  ) : (
    <Button onClick={goNext} style={{ flex: 1 }}>Continue <Arrow /></Button>
  );

  const payNotice = (
    <>
      {cardReturn === "cancelled" && !submitError && (
        <div style={{ margin: "0 0 16px" }}><Note>Card payment cancelled. You weren't charged. Try again, or choose e-Transfer.</Note></div>
      )}
      {submitError && <div style={{ margin: "0 0 16px" }}><Note tone="danger">{submitError}</Note></div>}
    </>
  );

  return (
    <Shell>
      <TopBar deadline={tournament.registration_deadline} />

      <form
        ref={formRef}
        noValidate
        onKeyDown={(e) => {
          // The keyboard's Next/Go key: on to the next field, and from a
          // step's last field on to the next step. Never submits the entry.
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          const t = e.target;
          if (!(t instanceof HTMLInputElement) || !isTextField(t)) return;
          e.preventDefault();
          const fields = textFields(e.currentTarget);
          const next = fields[fields.indexOf(t) + 1];
          if (next) next.focus();
          else if (isPay) t.blur();
          else goNext();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!isPay) goNext();
        }}
      >
        {/* Honeypot. Off-screen rather than display:none, which some bots skip. */}
        <div aria-hidden="true" style={{ position: "absolute", left: -10000, top: "auto", width: 1, height: 1, overflow: "hidden" }}>
          <label>
            Website (leave blank)
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>
        <AnimatePresence
          mode="wait"
          initial={false}
          onExitComplete={() => {
            const toError = afterStep.current === "error";
            afterStep.current = "top";
            if (toError) {
              setErrorTick((n) => n + 1);
              return;
            }
            window.scrollTo(0, 0);
            requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
          }}
        >
          {/* Everything that changes with the step moves as one block: the old
              step fades out where it is (the page keeps its height, so nothing
              jumps), the page goes to the top while nothing is on screen, and
              the new step fades in there. */}
          <motion.div
            key={step}
            initial={reduce ? false : { opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: -18 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {step === "you" && (
              <Hero tournament={tournament}>
                {capacity && !capBypass && <SpotsMeter capacity={capacity} />}
              </Hero>
            )}
            {step !== "you" && capacity && !capBypass && <SpotsStrip capacity={capacity} />}
            {/* Until events are picked, count the partner step (most entries are
                doubles) so the total doesn't jump on step 2. */}
            <Progress
              index={index}
              total={steps.length + (picked.length === 0 && !steps.includes("partners") && categories.some(isDoubles) ? 1 : 0)}
              label={STEP_LABEL[step]}
            />
            {welcomeBack && <WelcomeBack onStartOver={startOver} />}
            {step === "you" && <StepYou {...props} />}
            {step === "you" && <GoodToKnow highlights={TOURNAMENT_HIGHLIGHTS[tournament.id]} soloOffered={soloOffered} />}
            {step === "events" && <StepEvents {...props} />}
            {step === "partners" && <StepPartners {...props} />}
            {step === "waiver" && <StepWaiver {...props} />}
            {step === "pay" && (
              <StepPay {...props} cardAvailable={cardAvailable} onCopy={(k, v) => void onCopy(k, v)} copied={copied} notice={payNotice} />
            )}
          </motion.div>
        </AnimatePresence>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>

      {/* While typing on a phone the bottom bar is away: the step's buttons
          sit right under the form, where they can't cover a field. */}
      {typing && (
        <div style={{ marginTop: 24 }}>
          <ActionButtons keepFocus onBack={index > 0 ? goBack : undefined}>{primary}</ActionButtons>
        </div>
      )}

      {isPay && (
        <p style={{ margin: "24px 0 0", fontSize: 12, lineHeight: "16px", color: ss.mute }}>
          How we use your details: <a className="ss-link" href={PRIVACY_URL} target="_blank" rel="noopener" style={{ color: ss.body }}>privacy policy</a>
          {GA_MEASUREMENT_ID && (
            <>
              {" · "}
              <button type="button" data-consent-open className="ss-link"
                style={{ font: "inherit", color: ss.body, background: "none", border: 0, padding: 0, cursor: "pointer" }}>
                cookie settings
              </button>
            </>
          )}
        </p>
      )}

      <ActionBar hidden={typing} summary={summary} onBack={index > 0 ? goBack : undefined}>{primary}</ActionBar>
    </Shell>
  );
}

// While the full-house page loads: blocks shaped like its first screen.
function FullHouseLoading() {
  const block = (h: number, w = "100%", r = 24): React.CSSProperties => ({ height: h, width: w, borderRadius: r, background: ss.panel });
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: "grid", gap: 16, paddingTop: 12 }}>
      <div style={{ ...block(0), aspectRatio: "3 / 2", height: "auto" }} />
      <div style={block(48, "70%", 12)} />
      <div style={block(48, "90%", 12)} />
      <div style={block(48, "100%", 12)} />
    </div>
  );
}

export default PublicRegistrationPage;
