import type { Category, TournamentFees } from "../../types";

// True when at least one age band has a different member vs non_member price.
// Drives whether the form shows the "Are you a member?" question — flat-fee
// tournaments don't need to ask.
export function hasMemberDiscount(fees: TournamentFees): boolean {
  for (const band of Object.values(fees)) {
    if (!band) continue;
    if (typeof band.member === "number" && typeof band.non_member === "number" && band.member !== band.non_member) {
      return true;
    }
  }
  return false;
}

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
  payment_reference: string;
  comments: string;
};

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
    payment_reference: "",
    comments: "",
  };
}

export function validate(
  form: FormState,
  selectedCategory: Category | null,
  options: { requireMembership?: boolean } = {},
): FormErrors {
  const { requireMembership = true } = options;
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

  if (!form.payment_reference.trim()) errs.payment_reference = "Required";

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

  return errs;
}

// True when validate() returns no errors. Useful for disabling submit.
export function isValid(errs: FormErrors): boolean {
  return Object.keys(errs).length === 0;
}
