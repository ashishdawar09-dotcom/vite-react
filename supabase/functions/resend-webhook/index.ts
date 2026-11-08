// supabase/functions/resend-webhook/index.ts
//
// Receives Resend delivery events (delivered, delayed, bounced, complained,
// failed, suppressed) and records them on the matching court-call or briefing
// email, so the admin screens can flag a player whose email never arrived.
// Deployed with JWT checks off (Resend can't send a Supabase token); every
// request must carry a valid Svix signature made with RESEND_WEBHOOK_SECRET.
//
// The Resend account is shared with other apps and with Supabase sign-in
// codes. Events for emails this app didn't log match no row and are dropped:
// nothing about them is stored.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { deliveryFromEvent, verifySvix } from "../_shared/raceday.ts";

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";
  const body = await req.text();
  const signed = await verifySvix(secret, {
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
  }, body);
  if (!signed) return reply(403, { error: "invalid signature" });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return reply(400, { error: "invalid JSON" });
  }

  const update = deliveryFromEvent(payload);
  if (!update) return reply(200, { ignored: true });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase.rpc("record_email_delivery", {
    p_email_id: update.emailId,
    p_status: update.status,
    p_detail: update.detail,
    p_at: update.at,
  });
  if (error) {
    // 500 makes Resend retry later (it backs off for about a day).
    console.error("record_email_delivery failed:", error.message);
    return reply(500, { error: "not recorded" });
  }
  return reply(200, { recorded: data ?? 0 });
});
