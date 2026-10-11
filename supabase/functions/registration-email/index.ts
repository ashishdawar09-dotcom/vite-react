// supabase/functions/registration-email/index.ts
//
// Sends the "You're in!" email (player + doubles partner, with a calendar
// invite) for an approved registration. Called by the admin client right
// after `approve_registration` succeeds; safe to call again (an email that
// was sent is never resent, a failed one is retried).
//
// Secrets: RESEND_API_KEY (and the platform's SUPABASE_* values).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { requireAdmin } from "../_shared/admin.ts";
import { isUuid, json, serveWithCors } from "../_shared/http.ts";
import { sendRegistrationApproved } from "../_shared/registration_emails.ts";

serveWithCors(handle);

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  // Admin-only: registration IDs must never let anyone else trigger emails.
  if (!(await requireAdmin(req))) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const regId: unknown = body?.registration_id;
  if (!isUuid(regId)) return json({ error: "registration_id required" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const result = await sendRegistrationApproved(supabase, regId);
  return json(result, 200);
}
