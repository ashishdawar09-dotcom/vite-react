import type { Category } from "../../types";
import { ageProblem } from "./ageEligibility";

export type FormState = {
  player_email: string;
  player_name: string;
  player_phone: string;
  player_is_member: boolean | null;
  group_choice: "open" | "members" | null;
  category_id: string | null;
  partner_name: string;
  partner_phone: string;
  partner_email: string;
  partner_is_member: boolean | null;
  payment_split: "full" | "separate";
  payment_method: "etransfer" | "card";
  payment_reference: string;
  comments: string;
  // Age on the event date: drives the youth fee and whether a parent or
  // guardian must accept the waiver (under 19, BC's age of majority).
  player_age: string;
  player_student: boolean;
  partner_age: string;
  partner_student: boolean;
  guardian_name: string;
  signature: string;
  accepted_rules: boolean;
  accepted_waiver: boolean;
  accepted_codes: boolean;
};

export const AGE_OF_MAJORITY = 19;

export function parseAge(v: string): number | null {
  if (!/^\d{1,3}$/.test(v.trim())) return null;
  const n = Number(v);
  return n >= 4 && n <= 110 ? n : null;
}

const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export type FormErrors = Partial<Record<keyof FormState, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emptyFormState(): FormState {
  return {
    player_email: "",
    player_name: "",
    player_phone: "",
    player_is_member: null,
    group_choice: null,
    category_id: null,
    partner_name: "",
    partner_phone: "",
    partner_email: "",
    partner_is_member: null,
    payment_split: "separate",
    payment_method: "etransfer",
    payment_reference: "",
    comments: "",
    player_age: "",
    player_student: false,
    partner_age: "",
    partner_student: false,
    guardian_name: "",
    signature: "",
    accepted_rules: false,
    accepted_waiver: false,
    accepted_codes: false,
  };
}

export function validate(
  form: FormState,
  selectedCategory: Category | null,
  options: {
    requireMembership?: boolean;
    requireAge?: boolean;         // tournament has a waiver or a youth fee
    requireWaiver?: boolean;      // tournament has a waiver
    requirePartnerAge?: boolean;  // paying for both, and shares are priced by age
  } = {},
): FormErrors {
  const { requireMembership = true, requireAge = false, requireWaiver = false, requirePartnerAge = false } = options;
  const errs: FormErrors = {};

  if (!form.player_email.trim()) errs.player_email = "Required";
  else if (!EMAIL_RE.test(form.player_email.trim())) errs.player_email = "Invalid email";

  if (!form.player_name.trim()) errs.player_name = "Required";

  const phoneDigits = form.player_phone.replace(/\D/g, "");
  if (!phoneDigits) errs.player_phone = "Required";
  else if (phoneDigits.length < 10) errs.player_phone = "At least 10 digits";

  if (requireMembership && form.player_is_member === null) {
    errs.player_is_member = "Please choose Yes or No";
  }

  if (!form.category_id) errs.category_id = "Please pick a category";

  if (form.payment_method === "etransfer" && !form.payment_reference.trim()) errs.payment_reference = "Required";

  if (selectedCategory && selectedCategory.team_size === 2) {
    const partnerRequired = !selectedCategory.allow_solo_signup;
    const partnerProvided =
      !!form.partner_name.trim() ||
      !!form.partner_email.trim() ||
      !!form.partner_phone.trim() ||
      form.partner_is_member !== null;

    if (partnerRequired) {
      if (!form.partner_name.trim()) errs.partner_name = "Required";
      if (!form.partner_email.trim()) errs.partner_email = "Required";
      else if (!EMAIL_RE.test(form.partner_email.trim())) errs.partner_email = "Invalid email";
      const pPhoneDigits = form.partner_phone.replace(/\D/g, "");
      if (!pPhoneDigits) errs.partner_phone = "Required";
      else if (pPhoneDigits.length < 10) errs.partner_phone = "At least 10 digits";
      if (requireMembership && form.partner_is_member === null) {
        errs.partner_is_member = "Please choose Yes or No";
      }
    } else if (partnerProvided) {
      // optional but if any partner field touched, validate the ones that exist
      if (form.partner_email.trim() && !EMAIL_RE.test(form.partner_email.trim())) {
        errs.partner_email = "Invalid email";
      }
      const pPhoneDigits = form.partner_phone.replace(/\D/g, "");
      if (pPhoneDigits && pPhoneDigits.length < 10) {
        errs.partner_phone = "At least 10 digits";
      }
    }

    // Same-email guard
    if (
      form.partner_email.trim() &&
      form.player_email.trim() &&
      form.partner_email.trim().toLowerCase() === form.player_email.trim().toLowerCase()
    ) {
      errs.partner_email = "Must differ from your email";
    }
  }

  if (form.comments.length > 500) errs.comments = "Max 500 characters";

  const age = parseAge(form.player_age);
  if (requireAge && age === null) errs.player_age = "Enter the player's age (4–110)";
  const tooOld = ageProblem(selectedCategory, age);
  if (tooOld) errs.category_id = tooOld;
  const partnerAge = parseAge(form.partner_age);
  const ageBandedPartner = partnerAgeRequired(form, selectedCategory);
  if ((requirePartnerAge || ageBandedPartner) && partnerAge === null) {
    errs.partner_age = "Enter your partner's age (4–110)";
  }
  if (ageBandedPartner) {
    const partnerTooYoung = ageProblem(selectedCategory, partnerAge, "partner");
    if (partnerTooYoung) errs.partner_age = partnerTooYoung;
  }

  if (requireWaiver) {
    if (!form.accepted_rules) errs.accepted_rules = "Required";
    if (!form.accepted_waiver) errs.accepted_waiver = "Required";
    if (!form.accepted_codes) errs.accepted_codes = "Required";
    const minor = age !== null && age < AGE_OF_MAJORITY;
    if (minor && form.guardian_name.trim().length < 2) errs.guardian_name = "Required for players under 19";
    const signer = minor ? form.guardian_name : form.player_name;
    if (!form.signature.trim()) errs.signature = "Type the full name to sign";
    else if (signer.trim() && normName(form.signature) !== normName(signer)) {
      errs.signature = minor ? "Must match the parent or guardian's name" : "Must match the player name above";
    }
  }

  return errs;
}

// A doubles category with a minimum age (e.g. 35+) needs the partner's age
// whenever a partner is named, because both partners must meet it. Solo
// entries are checked on the submitter's age only; the directors pair them.
export function partnerAgeRequired(form: FormState, category: Category | null): boolean {
  if (!category || category.team_size !== 2 || category.min_age == null) return false;
  return !!form.partner_name.trim() || !!form.partner_email.trim();
}

// True when validate() returns no errors. Useful for disabling submit.
export function isValid(errs: FormErrors): boolean {
  return Object.keys(errs).length === 0;
}
