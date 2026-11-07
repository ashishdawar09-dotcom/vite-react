// State and rules for the step-by-step registration form: one player, one or
// more events, a partner per doubles event, one waiver, one payment.
//
// Every per-event rule (partner, ages, pay-for-both, waiver) is checked by the
// same validate() the single-event form used, run once per event, so the
// rules can't drift from the server's (register-player mirrors them).

import type { Category, ConsentPayload, PublicRegistrationPayload, RegistrationEntryPayload, Tournament } from "../../types";
import { ageProblem } from "./ageEligibility";
import { computeFee, priceBasis, type Concessions, type Participant, type PaymentSplit } from "./computeFee";
import { AGE_OF_MAJORITY, emptyFormState, parseAge, partnerAgeRequired, validate, type FormErrors, type FormState } from "./validate";
import { overCapacityMessage, spotsNeeded } from "./capacity";

export type StepKey = "you" | "events" | "partners" | "waiver" | "pay";

export const STEP_LABEL: Record<StepKey, string> = {
  you: "You",
  events: "Events",
  partners: "Partners",
  waiver: "Waiver",
  pay: "Payment",
};

// The partner for one doubles event. "solo" asks the directors to pair them.
export type PartnerDraft = {
  mode: "named" | "solo" | null;
  name: string;
  email: string;
  phone: string;
  age: string;
  student: boolean;
  split: PaymentSplit;
};

export type FlowState = {
  player_name: string;
  player_email: string;
  player_phone: string;
  player_age: string;
  player_student: boolean;
  guardian_name: string;
  category_ids: string[];
  partners: Record<string, PartnerDraft>;
  signature: string;
  accepted_rules: boolean;
  accepted_waiver: boolean;
  accepted_codes: boolean;
  payment_method: "etransfer" | "card";
  payment_reference: string;
  comments: string;
  heard_from: string;
};

export function emptyFlow(): FlowState {
  return {
    player_name: "",
    player_email: "",
    player_phone: "",
    player_age: "",
    player_student: false,
    guardian_name: "",
    category_ids: [],
    partners: {},
    signature: "",
    accepted_rules: false,
    accepted_waiver: false,
    accepted_codes: false,
    payment_method: "etransfer",
    payment_reference: "",
    comments: "",
    heard_from: "",
  };
}

export function emptyPartner(): PartnerDraft {
  return { mode: null, name: "", email: "", phone: "", age: "", student: false, split: "separate" };
}

// What the form needs to know about the tournament and the visit.
export type FlowContext = {
  tournament: Pick<Tournament, "youth_price" | "student_price" | "waiver_text" | "waiver_version" | "id">;
  categories: Category[];
  // ?share=1: paying their share of an entry that named them, for this event.
  payingShareFor: string | null;
  // Entries still open when the tournament has a cap; null or absent means no
  // limit is checked here (the server always checks).
  spotsLeft?: number | null;
};

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const waiverRequired = (ctx: FlowContext) => !!ctx.tournament.waiver_text;
export const ageRequired = (ctx: FlowContext) => waiverRequired(ctx) || num(ctx.tournament.youth_price) !== null;
export const concessionsOf = (ctx: FlowContext): Concessions => ({
  youth_price: ctx.tournament.youth_price ?? null,
  student_price: ctx.tournament.student_price ?? null,
});

// Selected events in the tournament's own order.
export function selectedCategories(state: FlowState, ctx: FlowContext): Category[] {
  const picked = new Set(state.category_ids);
  return ctx.categories.filter((c) => picked.has(c.id));
}

export const isDoubles = (c: Pick<Category, "team_size">) => c.team_size === 2;

export function stepsFor(state: FlowState, ctx: FlowContext): StepKey[] {
  const doubles = selectedCategories(state, ctx).some(isDoubles);
  return ["you", "events", ...(doubles ? ["partners" as const] : []), ...(waiverRequired(ctx) ? ["waiver" as const] : []), "pay"];
}

export function partnerOf(state: FlowState, c: Category): PartnerDraft {
  return state.partners[c.id] ?? emptyPartner();
}

// Events without solo entries always need a named partner.
export function partnerMode(state: FlowState, c: Category): PartnerDraft["mode"] {
  if (!isDoubles(c)) return null;
  if (!c.allow_solo_signup) return "named";
  return partnerOf(state, c).mode;
}

// The student rate is offered to adults when it beats a per-player price.
export function studentOffered(c: Category, ctx: FlowContext, age: number | null): boolean {
  const student = num(ctx.tournament.student_price);
  const price = num(c.price);
  return price !== null && student !== null && priceBasis(c) === "per_player" && student < price && (age === null || age >= 18);
}

export function playerOf(state: FlowState, ctx: FlowContext): Participant {
  const age = parseAge(state.player_age);
  const offered = selectedCategories(state, ctx).some((c) => studentOffered(c, ctx, age));
  return { age, student: offered && state.player_student };
}

function partnerParticipant(state: FlowState, c: Category, ctx: FlowContext): Participant {
  const p = partnerOf(state, c);
  const age = parseAge(p.age);
  return { age, student: studentOffered(c, ctx, age) && p.student };
}

// "Pay for both" applies to doubles priced per player once a partner is named.
export function splitOffered(state: FlowState, c: Category): boolean {
  return isDoubles(c) && priceBasis(c) === "per_player" && num(c.price) !== null &&
    partnerMode(state, c) === "named" && !!partnerOf(state, c).name.trim();
}

export function splitOf(state: FlowState, c: Category): PaymentSplit {
  return splitOffered(state, c) ? partnerOf(state, c).split : "separate";
}

// The partner's age prices their share when paying for both (where fees vary
// by age), and is required in min-age doubles whenever a partner is named.
export function partnerAgeForPrice(state: FlowState, c: Category, ctx: FlowContext): boolean {
  return ageRequired(ctx) && splitOf(state, c) === "full";
}
export function partnerAgeForBand(state: FlowState, c: Category): boolean {
  return partnerAgeRequired(legacyForm(state, c), c);
}

// The single-event form state for one event, so validate() and the fee rules
// can be reused as they are.
export function legacyForm(state: FlowState, c: Category): FormState {
  const named = partnerMode(state, c) === "named";
  const p = partnerOf(state, c);
  return {
    ...emptyFormState(),
    player_email: state.player_email,
    player_name: state.player_name,
    player_phone: state.player_phone,
    player_age: state.player_age,
    player_student: state.player_student,
    guardian_name: state.guardian_name,
    category_id: c.id,
    partner_name: named ? p.name : "",
    partner_email: named ? p.email : "",
    partner_phone: named ? p.phone : "",
    partner_age: named ? p.age : "",
    partner_student: named ? p.student : false,
    payment_split: splitOf(state, c),
    payment_method: state.payment_method,
    payment_reference: state.payment_reference,
    comments: state.comments,
    signature: state.signature,
    accepted_rules: state.accepted_rules,
    accepted_waiver: state.accepted_waiver,
    accepted_codes: state.accepted_codes,
    heard_from: state.heard_from,
  };
}

// What this event costs the player now (their share, or both shares).
export function entryFee(state: FlowState, c: Category, ctx: FlowContext): number | null {
  return computeFee(c, splitOf(state, c), playerOf(state, ctx), partnerParticipant(state, c, ctx), concessionsOf(ctx));
}

// Total for every selected event; null when any of them has no price (then
// only e-Transfer is offered, as before).
export function totalFee(state: FlowState, ctx: FlowContext): number | null {
  let sum = 0;
  for (const c of selectedCategories(state, ctx)) {
    const fee = entryFee(state, c, ctx);
    if (fee === null) return null;
    sum += fee;
  }
  return Math.round(sum * 100) / 100;
}

export type StepErrors = {
  fields: Partial<Record<keyof FormState | "events", string>>;
  // Per event: the event's own problems (age) and its partner fields.
  events: Record<string, string>;
  partners: Record<string, FormErrors & { mode?: string }>;
};

const emptyErrors = (): StepErrors => ({ fields: {}, events: {}, partners: {} });

export function hasErrors(e: StepErrors): boolean {
  return Object.keys(e.fields).length > 0 || Object.keys(e.events).length > 0 ||
    Object.values(e.partners).some((p) => Object.keys(p).length > 0);
}

function validateEvent(state: FlowState, c: Category, ctx: FlowContext): FormErrors {
  const split = splitOf(state, c);
  return validate(legacyForm(state, c), c, {
    requireMembership: false,
    requireAge: ageRequired(ctx),
    requireWaiver: waiverRequired(ctx),
    requirePartnerAge: partnerAgeForPrice(state, c, ctx),
    requirePartner: ctx.payingShareFor === c.id || split === "full",
  });
}

const pick = (errs: FormErrors, keys: (keyof FormState)[]) => {
  const out: FormErrors = {};
  for (const k of keys) if (errs[k]) out[k] = errs[k];
  return out;
};

// Problems that block leaving `step`. Uses the first selected event (or none)
// for the player-level fields, which don't depend on the event.
export function stepErrors(step: StepKey, state: FlowState, ctx: FlowContext): StepErrors {
  const out = emptyErrors();
  const cats = selectedCategories(state, ctx);
  const playerOnly = validate(legacyForm(state, cats[0] ?? ({ id: "", team_size: 1 } as Category)), null, {
    requireMembership: false,
    requireAge: ageRequired(ctx),
    requireWaiver: waiverRequired(ctx),
  });

  if (step === "you") {
    out.fields = pick(playerOnly, ["player_email", "player_name", "player_phone"]);
    return out;
  }
  if (step === "events") {
    out.fields = pick(playerOnly, ["player_age"]);
    if (!cats.length) out.fields.events = "Pick at least one event";
    const age = parseAge(state.player_age);
    for (const c of cats) {
      const problem = ageProblem(c, age);
      if (problem) out.events[c.id] = problem;
    }
    if (cats.length && ctx.spotsLeft != null) {
      const short = overCapacityMessage(ctx.spotsLeft, spotsNeeded(ctx.categories, state.category_ids, ctx.payingShareFor));
      if (short) out.fields.events = short;
    }
    return out;
  }
  if (step === "partners") {
    for (const c of cats.filter(isDoubles)) {
      const errs: FormErrors & { mode?: string } = pick(validateEvent(state, c, ctx), ["partner_name", "partner_email", "partner_phone", "partner_age"]);
      const mode = partnerMode(state, c);
      if (!mode) errs.mode = "Choose one";
      else if (mode === "named" && !partnerOf(state, c).name.trim()) errs.partner_name = "Required";
      if (Object.keys(errs).length) out.partners[c.id] = errs;
    }
    return out;
  }
  if (step === "waiver") {
    out.fields = pick(playerOnly, ["accepted_rules", "accepted_waiver", "accepted_codes", "guardian_name", "signature"]);
    return out;
  }
  // pay
  out.fields = pick(playerOnly, ["payment_reference", "comments"]);
  return out;
}

// Everything before `step` must be valid to get there (e.g. after a refresh).
export function firstInvalidStep(state: FlowState, ctx: FlowContext): StepKey | null {
  for (const s of stepsFor(state, ctx)) {
    if (hasErrors(stepErrors(s, state, ctx))) return s;
  }
  return null;
}

export const isMinor = (state: FlowState) => {
  const age = parseAge(state.player_age);
  return age !== null && age < AGE_OF_MAJORITY;
};

// The request register-player accepts, one entry per event.
export function buildPayload(
  state: FlowState,
  ctx: FlowContext,
  extra: { website: string; attribution: PublicRegistrationPayload["attribution"]; payMethod: "etransfer" | "card" },
): PublicRegistrationPayload {
  const player = playerOf(state, ctx);
  const entries: RegistrationEntryPayload[] = selectedCategories(state, ctx).map((c) => {
    const entry: RegistrationEntryPayload = { category_id: c.id };
    if (!isDoubles(c)) return entry;
    const p = partnerOf(state, c);
    const named = partnerMode(state, c) === "named" && !!p.name.trim();
    const split = splitOf(state, c);
    entry.payment_paid_full_for_partner = priceBasis(c) === "per_team" ? named : split === "full";
    if (named) {
      entry.partner_name = p.name.trim();
      entry.partner_email = p.email.trim() || undefined;
      entry.partner_phone = p.phone.trim() || undefined;
      const partner = partnerParticipant(state, c, ctx);
      if (partnerAgeForPrice(state, c, ctx) && split === "full") {
        entry.partner_age = partner.age ?? undefined;
        entry.partner_student = partner.student;
      } else if (partnerAgeForBand(state, c)) {
        entry.partner_age = partner.age ?? undefined;
      }
    }
    return entry;
  });
  const payload: PublicRegistrationPayload = {
    tournament_id: ctx.tournament.id,
    entries,
    player_name: state.player_name.trim(),
    player_email: state.player_email.trim(),
    player_phone: state.player_phone.trim() || undefined,
    player_is_member: false,
    payment_method: extra.payMethod,
    payment_reference: extra.payMethod === "etransfer" ? state.payment_reference.trim() : undefined,
    comments: state.comments.trim() || undefined,
    website: extra.website || undefined,
    player_age: player.age ?? undefined,
    player_student: player.student,
    heard_from: state.heard_from || undefined,
    attribution: extra.attribution,
  };
  if (waiverRequired(ctx)) {
    const consent: ConsentPayload = {
      guardian_name: isMinor(state) ? state.guardian_name.trim() : undefined,
      signature: state.signature.trim(),
      accepted_rules: state.accepted_rules,
      accepted_waiver: state.accepted_waiver,
      accepted_codes_of_conduct: state.accepted_codes,
      waiver_version: ctx.tournament.waiver_version,
    };
    payload.consent = consent;
  }
  return payload;
}
