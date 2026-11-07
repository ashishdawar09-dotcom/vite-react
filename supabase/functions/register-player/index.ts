// supabase/functions/register-player/index.ts
//
// Public ingress for tournament registration forms. The form lives at
// /register/<tournament_id> on the SPA; players (unauthenticated) submit
// via POST here. The function validates the payload server-side using the
// service-role key and inserts into `pending_registrations` (admin-only RLS).
// An admin later approves/rejects via the RPCs in schema_v12.
//
// One submission can enter several events: `entries` lists them, each with
// its own partner. Every event becomes its own pending_registrations row
// (so approval, teams and emails work per event as before); rows from one
// submission share a submission_id and one payment covers them all. The
// older single-event payload (category_id and partner_* at the top level) is
// still accepted unchanged, so forms cached on phones keep working.
//
// Required Supabase function secrets (auto-set by the platform — no config):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { allow, allowClient, appOrigin, isUuid, json, serveWithCors, SITE_URL } from "../_shared/http.ts";
import { cardCents, etransferCents, playerShare, STATEMENT_SUFFIX } from "../_shared/pricing.ts";
import { stripeConfigured, stripePost } from "../_shared/stripe.ts";
import { sendRegistrationReceived } from "../_shared/registration_emails.ts";
import { adminRefusedRepeat } from "../_shared/emails.ts";
import { sendEmail } from "../_shared/mailer.ts";
import { type ConsentInput, parseAge, recordConsent, validateConsent } from "../_shared/waiver.ts";
import { ageProblem } from "../_shared/ages.ts";
import { cleanAttribution, cleanHeardFrom } from "../_shared/attribution.ts";
import { markLeadCompleted } from "../_shared/leads.ts";

// One event in a submission, with the partner for that event.
type EntryInput = {
  category_id?: unknown;
  partner_name?: unknown;
  partner_email?: unknown;
  partner_phone?: unknown;
  partner_is_member?: unknown;
  partner_age?: unknown;      // prices the partner's share when paying for both; required for min-age doubles
  partner_student?: unknown;
  payment_paid_full_for_partner?: unknown;
};

type Payload = {
  tournament_id: string;
  category_id?: string;       // single-event payload (older forms)
  entries?: unknown;          // EntryInput[]; several events in one submission
  player_name: string;
  player_email: string;
  player_phone?: string;
  player_is_member: boolean;
  partner_name?: string;
  partner_email?: string;
  partner_phone?: string;
  partner_is_member?: boolean;
  payment_method?: "etransfer" | "card";
  payment_reference?: string;
  payment_paid_full_for_partner?: boolean;
  comments?: string;
  group_choice?: "open" | "members";
  heard_from?: unknown;      // validated by cleanHeardFrom
  attribution?: unknown;     // validated by cleanAttribution
  website?: string; // honeypot: hidden from people, filled in by form bots
  player_age?: number;
  player_student?: boolean;
  partner_age?: number;
  partner_student?: boolean;
  consent?: ConsentInput;    // required when the tournament has a waiver
};

type Category = {
  id: string; name: string; tournament_id: string; team_size: number; allow_solo_signup: boolean;
  price: number | string | null; price_basis: string; age_band: string | null; min_age: number | null;
};

// An entry that passed validation, ready to insert.
type Prepared = {
  id: string;
  c: Category;
  partnerName: string | null;
  partnerEmail: string | null;
  partnerPhone: string | null;
  partnerIsMember: boolean | null;
  partnerNamed: boolean;
  partnerProvided: boolean;
  paysForBoth: boolean;
  partnerAge: number | null;
  amountDue: number | null;
  playerFeeType: string;
  partnerFeeType: string | null;
};

// Emails are stored trimmed and lowercased, and matched exactly; % and * are
// refused because they would act as wildcards in a pattern match.
const EMAIL_RE = /^[^\s@%*]+@[^\s@%*]+\.[^\s@%*]+$/;

// Most events one submission can enter. Matches the per-email cap below.
const MAX_ENTRIES = 8;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

serveWithCors(handle);

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json({ success: false, error: "POST only" }, 405);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Flood guard per client. Generous because families and club sessions share
    // one network; the per-tournament cap below bounds the total.
    if (!(await allowClient(supabase, req, "register-player", 15, 600))) {
      return json({ success: false, error: "Too many submissions. Please wait a few minutes and try again." }, 429);
    }

    // Cap raw body size before parsing — prevents oversized payloads from
    // bloating storage or exhausting memory. 16 KB covers eight events.
    const rawBody = await req.text();
    if (rawBody.length > 16384) {
      return json({ success: false, error: "Payload too large" }, 413);
    }
    let body: Partial<Payload> = {};
    try {
      body = rawBody ? (JSON.parse(rawBody) as Partial<Payload>) : {};
    } catch {
      return json({ success: false, error: "Invalid JSON" }, 400);
    }

    // Honeypot: the form's hidden "website" field is invisible to people.
    // Bots that fill it get a normal-looking success and nothing is stored.
    if (typeof body.website === "string" && body.website.trim()) {
      console.warn("register-player: honeypot tripped");
      return json({ success: true }, 200);
    }

    // ---- The events entered: `entries`, or the single-event fields ----
    let rawEntries: EntryInput[];
    if (body.entries !== undefined) {
      if (!Array.isArray(body.entries) || body.entries.length < 1 || body.entries.length > MAX_ENTRIES) {
        return json({ success: false, error: `Choose between 1 and ${MAX_ENTRIES} events.` }, 400);
      }
      rawEntries = body.entries.map((e) => (e && typeof e === "object" ? e as EntryInput : {}));
    } else {
      rawEntries = [{
        category_id: body.category_id,
        partner_name: body.partner_name,
        partner_email: body.partner_email,
        partner_phone: body.partner_phone,
        partner_is_member: body.partner_is_member,
        partner_age: body.partner_age,
        partner_student: body.partner_student,
        payment_paid_full_for_partner: body.payment_paid_full_for_partner,
      }];
    }
    const multi = rawEntries.length > 1;
    // Entry-specific messages name the event when several were entered.
    const about = (c: { name: string }, msg: string) => (multi ? `${c.name}: ${msg}` : msg);

    // ---- Validation: required scalars ----
    const requiredStrings: (keyof Payload)[] = [
      "tournament_id",
      "player_name",
      "player_email",
    ];
    for (const k of requiredStrings) {
      const v = body[k];
      if (typeof v !== "string" || !v.trim()) {
        return json({ success: false, error: `Missing field: ${k}` }, 400);
      }
    }
    for (const e of rawEntries) {
      const v = str(e.category_id);
      if (!v || !v.trim()) return json({ success: false, error: "Missing field: category_id" }, 400);
    }
    const payByCard = body.payment_method === "card";
    if (!payByCard && (typeof body.payment_reference !== "string" || !body.payment_reference.trim())) {
      return json({ success: false, error: "Missing field: payment_reference" }, 400);
    }
    if (payByCard && !stripeConfigured()) {
      return json({ success: false, error: "Card payments aren't available right now. Please pay by e-Transfer." }, 503);
    }
    if (!isUuid(body.tournament_id) || rawEntries.some((e) => !isUuid(e.category_id))) {
      return json({ success: false, error: "Tournament not found" }, 404);
    }
    if (typeof body.player_is_member !== "boolean") {
      return json({ success: false, error: "player_is_member must be boolean" }, 400);
    }

    // ---- Validation: per-field length caps (flood / abuse guard) ----
    const lenCaps: Partial<Record<keyof Payload, number>> = {
      tournament_id: 64, category_id: 64,
      player_name: 80, player_email: 120, player_phone: 30,
      partner_name: 80, partner_email: 120, partner_phone: 30,
      payment_reference: 100, comments: 500, group_choice: 16,
    };
    for (const k of Object.keys(lenCaps) as (keyof Payload)[]) {
      const v = body[k];
      if (typeof v === "string" && v.length > (lenCaps[k] as number)) {
        return json({ success: false, error: `Field too long: ${k}` }, 400);
      }
    }
    const entryCaps: Record<string, number> = { category_id: 64, partner_name: 80, partner_email: 120, partner_phone: 30 };
    for (const e of rawEntries) {
      for (const [k, cap] of Object.entries(entryCaps)) {
        const v = (e as Record<string, unknown>)[k];
        if (typeof v === "string" && v.length > cap) {
          return json({ success: false, error: `Field too long: ${k}` }, 400);
        }
      }
    }

    const playerEmail = body.player_email!.trim().toLowerCase();
    if (!EMAIL_RE.test(playerEmail)) {
      return json({ success: false, error: "Invalid player email" }, 400);
    }

    // ---- Validation: tournament exists, open, not past deadline ----
    const { data: t, error: tErr } = await supabase
      .from("tournaments")
      .select("id, name, registration_open, registration_deadline, waiver_text, waiver_version, youth_price, student_price, admin_notify_emails")
      .eq("id", body.tournament_id)
      .maybeSingle();
    if (tErr || !t) {
      return json({ success: false, error: "Tournament not found" }, 404);
    }
    if (!t.registration_open) {
      return json({ success: false, error: "Registration is closed for this tournament" }, 400);
    }
    if (t.registration_deadline && new Date(t.registration_deadline).getTime() < Date.now()) {
      return json({ success: false, error: "Registration deadline has passed" }, 400);
    }

    // Overall cap per tournament, which per-client limits can't get around.
    if (!(await allow(supabase, "register-player-tournament", t.id, 200, 3600))) {
      return json({ success: false, error: "Registration is busy right now. Please try again shortly." }, 429);
    }

    // ---- Validation: each event belongs to the tournament, once ----
    const categoryIds = rawEntries.map((e) => e.category_id as string);
    if (new Set(categoryIds).size !== categoryIds.length) {
      return json({ success: false, error: "Each event can only be entered once per submission." }, 400);
    }
    const { data: cats, error: cErr } = await supabase
      .from("categories")
      .select("id, name, tournament_id, team_size, allow_solo_signup, price, price_basis, age_band, min_age")
      .in("id", categoryIds);
    const byId = new Map(((cats ?? []) as Category[]).map((c) => [c.id, c]));
    if (cErr || categoryIds.some((id) => byId.get(id)?.tournament_id !== body.tournament_id)) {
      return json({ success: false, error: "Category not found in this tournament" }, 404);
    }

    // ---- Per event: partner, age and price ----
    const waiverRequired = !!t.waiver_text;
    const concessions = { youth_price: t.youth_price, student_price: t.student_price };
    const ageNeeded = waiverRequired || t.youth_price !== null;
    const playerAge = parseAge(body.player_age);
    const player = { age: playerAge, student: body.player_student === true };

    const prepared: Prepared[] = [];
    for (const e of rawEntries) {
      const c = byId.get(e.category_id as string)!;

      // A partner counts as provided with a name and an email; events that
      // allow solo entries also accept just a name (they pay their own share).
      const isDoubles = c.team_size === 2;
      const partnerName = isDoubles ? str(e.partner_name)?.trim() || null : null;
      const partnerEmailRaw = isDoubles ? str(e.partner_email)?.trim() || null : null;
      const partnerNamed = !!partnerName;
      const partnerProvided = partnerNamed && !!partnerEmailRaw;
      if (isDoubles && !c.allow_solo_signup && !partnerProvided) {
        return json(
          { success: false, error: about(c, "Partner name and email are required for this category") },
          400,
        );
      }
      let partnerEmail: string | null = null;
      if (partnerProvided) {
        partnerEmail = partnerEmailRaw!.toLowerCase();
        if (!EMAIL_RE.test(partnerEmail)) {
          return json({ success: false, error: about(c, "Invalid partner email") }, 400);
        }
        if (partnerEmail === playerEmail) {
          return json(
            { success: false, error: about(c, "Partner email must differ from your email") },
            400,
          );
        }
      }
      // Paying for both needs the partner's email: it's how the entry is matched
      // to them, how approval adds them to the team and how they get the waiver.
      // Per-team prices always cover both players (the form sends this flag for
      // any named partner there), so only per-player doubles are checked.
      const flaggedFull = e.payment_paid_full_for_partner === true;
      if (isDoubles && c.price_basis === "per_player" && flaggedFull && !partnerProvided) {
        return json({
          success: false,
          error: about(c, "To pay for your partner too, enter their name and email address. " +
            "If they'll pay their own share, choose that option instead."),
        }, 400);
      }

      if (ageNeeded && playerAge === null) {
        return json({ success: false, error: "Please enter the player's age." }, 400);
      }
      const ageErr = ageProblem(c, playerAge);
      if (ageErr) return json({ success: false, error: ageErr }, 400);
      // Age-banded doubles (e.g. 35+): both partners must meet the minimum, so
      // a named partner's age is required and checked too, with or without
      // their email.
      if (isDoubles && c.min_age != null && partnerNamed) {
        const namedPartnerAge = parseAge(e.partner_age);
        if (namedPartnerAge === null) {
          return json({ success: false, error: about(c, "Please enter your partner's age on tournament day.") }, 400);
        }
        const partnerAgeErr = ageProblem(c, namedPartnerAge, "partner");
        if (partnerAgeErr) return json({ success: false, error: partnerAgeErr }, 400);
      }

      // ---- Amount, computed from the category and ages, never from the request ----
      const paysForBoth = flaggedFull && partnerProvided;
      const sharedByAge = isDoubles && c.price_basis === "per_player" && paysForBoth && ageNeeded;
      const partnerAge = parseAge(e.partner_age);
      if (sharedByAge && partnerAge === null) {
        return json({ success: false, error: about(c, "Please enter your partner's age so we can price their share.") }, 400);
      }
      const partner = { age: partnerAge, student: e.partner_student === true };
      const etransfer = etransferCents(c, paysForBoth, player, partner, concessions);
      const categoryPrice = c.price === null ? null : Number(c.price);
      const playerFeeType = categoryPrice === null || c.price_basis === "per_team"
        ? "standard"
        : playerShare(categoryPrice, player, concessions).type;
      const partnerFeeType = sharedByAge && categoryPrice !== null
        ? playerShare(categoryPrice, partner, concessions).type
        : null;
      if (payByCard && etransfer === null) {
        return json({ success: false, error: about(c, "Card payment isn't available for this category. Please pay by e-Transfer.") }, 400);
      }

      prepared.push({
        id: crypto.randomUUID(),
        c,
        partnerName,
        partnerEmail,
        partnerPhone: isDoubles ? str(e.partner_phone)?.trim() || null : null,
        partnerIsMember: typeof e.partner_is_member === "boolean" ? e.partner_is_member : null,
        partnerNamed,
        partnerProvided,
        paysForBoth,
        partnerAge,
        amountDue: etransfer === null ? null : payByCard ? cardCents(etransfer) : etransfer,
        playerFeeType,
        partnerFeeType,
      });
    }

    // ---- Waiver consent (one acceptance covers every event entered) ----
    let consent = null;
    if (waiverRequired) {
      const v = validateConsent({ ...body.consent, age: playerAge }, t, body.player_name!.trim());
      if (!v.ok) return json({ success: false, error: v.error }, v.status);
      consent = v.value;
    }

    // ---- Dedup: no existing pending/approved row for (email, category) ----
    const { data: dups } = await supabase
      .from("pending_registrations")
      .select("id, status, category_id")
      .in("category_id", categoryIds)
      .in("status", ["pending", "approved"])
      .eq("player_email", playerEmail);
    for (const p of prepared) {
      const dup = (dups ?? []).find((d: { category_id: string }) => d.category_id === p.c.id);
      if (dup) {
        const label = dup.status === "approved" ? "already approved" : "already submitted";
        return json(
          { success: false, error: multi ? `You are ${label} for ${p.c.name}. Untick it and submit again.` : `You are ${label} for this category` },
          409,
        );
      }
    }

    // ---- Already paid for by the partner ----
    // The partner's entry names this player and paid for both of them, and
    // this entry names that partner back: it would pay the same share twice.
    // Only an exact match is refused, and the message names nobody, so typing
    // someone's email doesn't reveal who entered with them. The waiver they
    // just accepted is kept as the partner's acceptance on that entry, and an
    // e-Transfer (sent before submitting) is flagged to the directors.
    for (const p of prepared) {
      if (!p.partnerEmail) continue;
      const { data: covered } = await supabase
        .from("pending_registrations")
        .select("id, player_name")
        .eq("category_id", p.c.id)
        .in("status", ["pending", "approved"])
        .eq("player_email", p.partnerEmail)
        .eq("partner_email", playerEmail)
        .eq("payment_paid_full_for_partner", true)
        .limit(1);
      if (!covered?.length) continue;
      if (consent) {
        const err = await recordConsent(supabase, req, t, {
          registration_id: covered[0].id,
          role: "partner",
          participant_name: body.player_name!.trim(),
          participant_email: playerEmail,
          consent,
        });
        // Already accepted on that entry: nothing to add.
        if (err && !/duplicate key/i.test(err)) console.error("register-player: refused entry's waiver not saved:", err);
      }
      const directors = ((t.admin_notify_emails ?? []) as string[]).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
      if (!payByCard && directors.length) {
        const err = await sendEmail({
          to: directors, fromName: t.name, replyTo: playerEmail,
          ...adminRefusedRepeat({
            category: p.c, playerName: body.player_name!, playerEmail, paidBy: covered[0].player_name,
            reference: body.payment_reference ?? null,
          }),
        });
        if (err) console.error("register-player: refused-entry alert failed:", err);
      }
      const already = multi
        ? `You've already been entered and paid for in ${p.c.name}, so untick it and submit the rest.`
        : "You've already been entered and paid for in this event, so you don't need to register again.";
      return json({
        success: false,
        error: already +
          (payByCard ? "" : " If you've already sent an e-Transfer for this, reply to the email you got when you were entered and we'll refund it."),
      }, 409);
    }

    // ---- Flood guard: cap total registrations per email per tournament ----
    // The per-category dedup above is trivially bypassed by varying the
    // category; this bounds how many rows one email can create overall.
    const { count: emailCount } = await supabase
      .from("pending_registrations")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", body.tournament_id)
      .neq("status", "payment_expired")
      .eq("player_email", playerEmail);
    if ((emailCount ?? 0) + prepared.length > MAX_ENTRIES) {
      return json(
        { success: false, error: "Too many registrations for this email" },
        429,
      );
    }

    // A new card attempt replaces any unfinished one for the same entry, so a
    // player can't end up paying twice by retrying.
    if (payByCard) {
      const { data: stale } = await supabase
        .from("pending_registrations")
        .update({ status: "payment_expired", card_payment_status: "expired" })
        .in("category_id", categoryIds)
        .eq("status", "awaiting_payment")
        .eq("player_email", playerEmail)
        .select("stripe_checkout_session_id");
      for (const row of stale ?? []) {
        if (!row.stripe_checkout_session_id) continue;
        await stripePost(`/checkout/sessions/${row.stripe_checkout_session_id}/expire`, {}).catch(() => {});
      }
    }

    // ---- Insert: one row per event ----
    const submissionId = multi ? crypto.randomUUID() : null;
    const rows = prepared.map((p) => {
      const isDoubles = p.c.team_size === 2;
      return {
        id: p.id,
        submission_id: submissionId,
        tournament_id: body.tournament_id,
        category_id: p.c.id,
        player_name: body.player_name!.trim(),
        player_email: playerEmail,
        player_phone: body.player_phone?.trim() || null,
        player_is_member: body.player_is_member,
        partner_name: p.partnerName,
        partner_email: p.partnerEmail,
        partner_phone: p.partnerPhone,
        partner_is_member: p.partnerIsMember,
        payment_method: payByCard ? "card" : "etransfer",
        payment_reference: payByCard ? null : body.payment_reference!.trim(),
        payment_paid_full_for_partner: p.paysForBoth || (isDoubles && p.c.price_basis === "per_team" && p.partnerProvided),
        amount_due_cents: p.amountDue,
        status: payByCard ? "awaiting_payment" : "pending",
        card_payment_status: payByCard ? "awaiting" : null,
        comments: body.comments?.trim() || null,
        group_choice: body.group_choice ?? null,
        player_age: playerAge,
        partner_age: p.partnerNamed ? p.partnerAge : null,
        player_fee_type: p.playerFeeType,
        partner_fee_type: p.partnerFeeType,
        partner_consent_token: waiverRequired && p.partnerProvided ? crypto.randomUUID() : null,
        // Store a bounded, validated subset rather than the raw request body
        // (previously persisted verbatim and unbounded).
        raw_payload: {
          player_name: body.player_name!.trim(),
          player_email: playerEmail,
          player_phone: body.player_phone?.trim() || null,
          partner_name: p.partnerName,
          partner_email: p.partnerEmail,
          partner_phone: p.partnerPhone,
          payment_method: payByCard ? "card" : "etransfer",
          payment_reference: payByCard ? null : body.payment_reference!.trim(),
          comments: body.comments?.trim() || null,
          group_choice: body.group_choice ?? null,
          heard_from: cleanHeardFrom(body.heard_from),
          attribution: cleanAttribution(body.attribution),
          ...(multi ? { events_in_submission: prepared.length } : {}),
        },
      };
    });
    const ids = rows.map((r) => r.id);

    const { error: insErr } = await supabase.from("pending_registrations").insert(rows);
    if (insErr) {
      // The tournament's entry cap (enforce_entry_cap in the database) undid
      // the insert: these entries don't fit in what's left.
      if (/entry_cap_reached/.test(insErr.message ?? "")) {
        const { data: cap } = await supabase.rpc("registration_capacity", { p_tournament_id: t.id });
        const remaining = typeof cap?.remaining === "number" ? cap.remaining : 0;
        const total = typeof cap?.cap === "number" ? cap.cap : null;
        console.warn(`register-player: entry cap reached (remaining ${remaining})`);
        return json({
          success: false,
          full: remaining === 0,
          remaining,
          error: remaining === 0
            ? `Sorry, entries are full: all ${total ?? "the"} spots are taken. Refresh this page to join the waitlist.`
            : `Only ${remaining} ${remaining === 1 ? "spot is" : "spots are"} left, and this entry needs more. ` +
              "A doubles event takes 2 spots (you and your partner), singles 1. Remove an event and try again.",
        }, 409);
      }
      console.error("register-player insert failed:", insErr.message);
      return json({ success: false, error: "Failed to save registration. Please try again." }, 500);
    }

    // The consent record is part of each entry: without it, the whole
    // submission is undone.
    if (consent) {
      for (const id of ids) {
        const consentErr = await recordConsent(supabase, req, t, {
          registration_id: id,
          role: "player",
          participant_name: body.player_name!.trim(),
          participant_email: playerEmail,
          consent,
        });
        if (consentErr) {
          console.error("register-player consent insert failed:", consentErr);
          await supabase.from("waiver_consents").delete().in("registration_id", ids);
          await supabase.from("pending_registrations").delete().in("id", ids);
          return json({ success: false, error: "Failed to save registration. Please try again." }, 500);
        }
      }
    }

    if (!payByCard) {
      await markLeadCompleted(supabase, t.id, playerEmail);
      // Confirmation to the player and partner (with the partner's waiver
      // link). Card entries get theirs once payment completes (stripe-webhook).
      // A group's emails are spaced out to stay under Resend's rate limit.
      for (const [i, id] of ids.entries()) {
        if (i > 0) await new Promise((r) => setTimeout(r, 1200));
        await sendRegistrationReceived(supabase, id, SITE_URL);
      }
      return json({ success: true, registrationId: ids[0], registrationIds: ids }, 200);
    }

    // ---- Card: hand off to Stripe Checkout (one session for every event) ----
    const origin = appOrigin(req);
    const back = `${origin}/register/${body.tournament_id}`;
    const meta: Record<string, string> = { app: "badminton", registration_id: ids[0], tournament_id: body.tournament_id! };
    if (submissionId) meta.submission_id = submissionId;
    const entryFor = (p: Prepared) =>
      p.c.team_size !== 2
        ? "Entry for 1 player"
        : p.c.price_basis === "per_team" || p.paysForBoth
          ? "Entry for a team of 2"
          : "Entry for 1 player of a doubles team";
    try {
      const session = await stripePost<{ id: string; url: string }>("/checkout/sessions", {
        mode: "payment",
        customer_email: playerEmail,
        client_reference_id: ids[0],
        line_items: prepared.map((p) => ({
          quantity: 1,
          price_data: {
            currency: "cad",
            unit_amount: p.amountDue,
            product_data: { name: `${t.name} — ${p.c.name}`, description: entryFor(p) },
          },
        })),
        metadata: meta,
        // Ordinary card payment, not Stripe Managed Payments (merchant of
        // record for digital goods, +3.5% per transaction), which is the
        // account default.
        managed_payments: { enabled: false },
        // The success page tells players Stripe emails their receipt; this
        // makes sure it does, whatever the account's email settings.
        payment_intent_data: { metadata: meta, receipt_email: playerEmail, statement_descriptor_suffix: STATEMENT_SUFFIX },
        success_url: `${back}?payment=success&reg=${ids[0]}`,
        cancel_url: multi ? `${back}?payment=cancelled` : `${back}?payment=cancelled&category=${prepared[0].c.id}`,
        expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      }, `badminton-checkout-${ids[0]}`);
      // The session id goes on the first row only (it's unique per row); the
      // webhook finds the others by submission_id.
      await supabase
        .from("pending_registrations")
        .update({ stripe_checkout_session_id: session.id })
        .eq("id", ids[0]);
      return json({ success: true, registrationId: ids[0], registrationIds: ids, checkoutUrl: session.url }, 200);
    } catch (e) {
      console.error("register-player checkout failed:", e instanceof Error ? e.message : String(e));
      await supabase
        .from("pending_registrations")
        .update({ status: "payment_expired", card_payment_status: "expired" })
        .in("id", ids);
      return json({ success: false, error: "Card payment couldn't be started. Please try again or pay by e-Transfer." }, 502);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("register-player error:", msg);
    return json({ success: false, error: "Something went wrong. Please try again." }, 500);
  }
}
