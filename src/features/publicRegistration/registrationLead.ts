// What the registration form saves about someone who has started it, so a
// director can remind them if they never finish (save-registration-lead).
// Null until there's a real name and email worth saving.

import type { FormState } from "./validate";

export type RegistrationLead = {
  tournament_id: string;
  email: string;
  name: string;
  phone?: string;
  category_id?: string;
};

// Same rule the server applies.
const EMAIL_RE = /^[^\s@%*]+@[^\s@%*]+\.[^\s@%*]+$/;

export function registrationLead(
  tournamentId: string | undefined,
  form: Pick<FormState, "player_email" | "player_name" | "player_phone" | "category_id">,
): RegistrationLead | null {
  const email = form.player_email.trim().toLowerCase();
  const name = form.player_name.trim();
  if (!tournamentId || !EMAIL_RE.test(email) || email.length > 254 || name.length < 2 || name.length > 120) return null;
  const phone = form.player_phone.replace(/\D/g, "");
  return {
    tournament_id: tournamentId,
    email,
    name,
    ...(phone.length >= 10 && phone.length <= 30 ? { phone } : {}),
    ...(form.category_id ? { category_id: form.category_id } : {}),
  };
}
