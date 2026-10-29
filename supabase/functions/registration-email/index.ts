// supabase/functions/registration-email/index.ts
//
// Sends the "You're in!" email (player + doubles partner, with a calendar
// invite) for an approved registration. Called two ways, both safe to repeat
// (a sent email is never resent, a failed one is retried):
//   - by the database on approval (trigger + pg_net), with x-internal-secret
//   - by the admin client right after approving, with the admin's token
// Deployed with JWT checks off (the database sends no JWT); every request
// must carry the secret or an admin's token.
//
// Secrets: RESEND_API_KEY, REGISTRATION_EMAIL_SECRET (matches Vault's
// registration_email_secret), and the platform's SUPABASE_* values.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { requireAdmin } from "../_shared/admin.ts";
import { appOrigin, isUuid, json, serveWithCors } from "../_shared/http.ts";
import { sendRegistrationApproved } from "../_shared/registration_emails.ts";

// True when the request carries the database's shared secret. Compares
// digests so the check takes the same time whatever the input.
async function fromDatabase(req: Request): Promise<boolean> {
  const expected = Deno.env.get("REGISTRATION_EMAIL_SECRET");
  const given = req.headers.get("x-internal-secret");
  if (!expected || !given) return false;
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(expected), digest(given)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

serveWithCors(handle);

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  // Registration IDs must never let anyone else trigger emails.
  if (!(await fromDatabase(req)) && !(await requireAdmin(req))) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const regId: unknown = body?.registration_id;
  if (!isUuid(regId)) return json({ error: "registration_id required" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const result = await sendRegistrationApproved(supabase, regId, appOrigin(req));
  return json(result, 200);
}
