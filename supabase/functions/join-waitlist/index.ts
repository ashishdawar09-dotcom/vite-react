// supabase/functions/join-waitlist/index.ts
//
// Public endpoint behind the "we're full" page: puts someone on a
// tournament's waitlist (name, mobile number, email) and emails the
// directors (tournaments.admin_notify_emails), who contact them if a spot
// opens up. Joining again with the same email updates the name and number
// and sends no second email.
//
//   POST { tournament_id, name, email, phone, website? } → { success, already? }
//
// `website` is the form's hidden honeypot: bots that fill it get a normal
// answer and nothing is stored.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { allow, allowClient, isUuid, json, serveWithCors } from "../_shared/http.ts";
import { sendEmail } from "../_shared/mailer.ts";
import { waitlistAlert } from "../_shared/waitlist.ts";

const EMAIL_RE = /^[^\s@%*]+@[^\s@%*]+\.[^\s@%*]+$/;

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  return s && s.length <= max ? s : null;
};

serveWithCors(async (req: Request) => {
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  const raw = await req.text();
  if (raw.length > 4096) return json({ success: false, error: "Payload too large" }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }
  if (!body || typeof body !== "object") return json({ success: false, error: "Invalid JSON" }, 400);

  if (typeof body.website === "string" && body.website.trim()) {
    console.warn("join-waitlist: honeypot tripped");
    return json({ success: true }, 200);
  }

  if (!isUuid(body.tournament_id)) return json({ success: false, error: "Tournament not found" }, 404);
  const name = text(body.name, 120);
  const email = text(body.email, 254)?.toLowerCase() ?? null;
  const phone = typeof body.phone === "string" ? body.phone.replace(/\D/g, "") : "";
  if (!name || name.length < 2) return json({ success: false, error: "Enter your full name." }, 400);
  if (phone.length < 10 || phone.length > 15) {
    return json({ success: false, error: "Enter a mobile number with 10 to 15 digits." }, 400);
  }
  if (!email || !EMAIL_RE.test(email)) return json({ success: false, error: "Enter an email address like name@example.com." }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await allowClient(supabase, req, "join-waitlist", 10, 600))) {
    return json({ success: false, error: "Too many requests" }, 429);
  }

  const { data: t } = await supabase.from("tournaments")
    .select("id, name, admin_notify_emails").eq("id", body.tournament_id).maybeSingle();
  if (!t) return json({ success: false, error: "Tournament not found" }, 404);
  // Overall cap per tournament, which per-client limits can't get around.
  if (!(await allow(supabase, "join-waitlist-tournament", t.id, 300, 3600))) {
    return json({ success: false, error: "Too many requests" }, 429);
  }

  const { data: existing } = await supabase.from("registration_waitlist")
    .select("id").eq("tournament_id", t.id).eq("email", email).maybeSingle();
  if (existing) {
    const { error } = await supabase.from("registration_waitlist")
      .update({ name, phone, updated_at: new Date().toISOString() }).eq("id", existing.id);
    if (error) console.error("join-waitlist update failed:", error.message);
    return json({ success: true, already: true }, 200);
  }

  const { data: row, error } = await supabase.from("registration_waitlist")
    .insert({ tournament_id: t.id, name, email, phone }).select("id").single();
  if (error || !row) {
    // Two joins with one address at once: the other one saved it.
    if (error && /duplicate key/i.test(error.message)) return json({ success: true, already: true }, 200);
    console.error("join-waitlist insert failed:", error?.message);
    return json({ success: false, error: "Couldn't save. Please try again." }, 500);
  }

  const { count } = await supabase.from("registration_waitlist")
    .select("id", { count: "exact", head: true }).eq("tournament_id", t.id);
  const directors = ((t.admin_notify_emails ?? []) as string[]).filter((e) => EMAIL_RE.test(e));
  let status = "not configured";
  if (directors.length) {
    const err = await sendEmail({
      to: directors, fromName: t.name, replyTo: email,
      ...waitlistAlert({ tournament: t.name, name, email, phone, position: count ?? 1 }),
    });
    status = err ? `failed: ${err.slice(0, 160)}` : "sent";
    if (err) console.error("join-waitlist alert failed:", err);
  }
  await supabase.from("registration_waitlist").update({ admin_email_status: status }).eq("id", row.id);
  return json({ success: true }, 200);
});
