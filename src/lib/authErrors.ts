// Sign-in is for tournament organizers only. On Nov 14, 2026 a player typed her email into Sign In and
// Supabase created an account for her and sent its bare "Confirm Your Signup" email. Since then new
// accounts are switched off in Supabase Auth and the email code never creates one, so a player who tries
// gets the errors below. These helpers turn them into one plain sentence.

export const ORGANIZERS_ONLY =
  "This sign-in is for tournament organizers only. Players don't need an account: your registration, waiver and photo links work without one.";

type AuthErrorLike = { message?: string | null; code?: string | null } | null | undefined;

const ORGANIZER_ONLY_CODES = new Set(["otp_disabled", "signup_disabled", "user_not_found"]);

/** The message to show for a failed sign-in (null when there is no error). */
export function friendlyAuthError(e: AuthErrorLike): string | null {
  if (!e) return null;
  const code = (e.code ?? "").toLowerCase();
  const msg = (e.message ?? "").trim();
  if (ORGANIZER_ONLY_CODES.has(code)) return ORGANIZERS_ONLY;
  if (/signups? not allowed|signups? (are |is )?disabled|user not found/i.test(msg)) return ORGANIZERS_ONLY;
  return msg || "Something went wrong. Please try again.";
}

const URL_ERROR_KEYS = ["error", "error_code", "error_description"];

function params(part: string): URLSearchParams | null {
  const s = part.replace(/^[?#]/, "");
  return s ? new URLSearchParams(s) : null;
}

/** A Google sign-in that Supabase refused comes back as ?error=…&error_description=… (or the same in the #hash). */
export function authErrorFromUrl(search: string, hash: string): string | null {
  for (const part of [search, hash]) {
    const p = params(part);
    if (!p) continue;
    const description = p.get("error_description");
    const code = p.get("error_code");
    if (description || code) return friendlyAuthError({ message: description ?? code, code });
  }
  return null;
}

/** The same address without the sign-in error, so a refresh doesn't show it again. */
export function stripAuthErrorParams(href: string): string {
  const u = new URL(href);
  for (const k of URL_ERROR_KEYS) u.searchParams.delete(k);
  const h = params(u.hash);
  if (h && URL_ERROR_KEYS.some((k) => h.has(k))) {
    for (const k of URL_ERROR_KEYS) h.delete(k);
    const rest = h.toString();
    u.hash = rest ? `#${rest}` : "";
  }
  return u.pathname + u.search + u.hash;
}
