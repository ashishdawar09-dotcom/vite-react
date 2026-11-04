// supabase/functions/save-registration-lead/index.ts
//
// Public endpoint behind the registration form: once someone has typed their
// name and email, the form saves them here, so a director can send one
// reminder if they never finish. Saves nothing for a closed tournament.
//
//   POST { tournament_id, email, name, phone?, category_id?, step?, selections? } → { success }
//
// The step-by-step form also sends how far the person got (`step`: you,
// events, partners, waiver, pay; the furthest step reached is kept) and what
// they picked (`selections`: category ids and payment method), so directors
// can see where people stop.
//
// Typing again updates the same row (one per address per tournament); a
// reminder already sent is never cleared.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { allow, allowClient, isUuid, json, serveWithCors } from "../_shared/http.ts";

const EMAIL_RE = /^[^\s@%*]+@[^\s@%*]+\.[^\s@%*]+$/;
const STEPS = ["you", "events", "partners", "waiver", "pay"];

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
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

  const email = text(body.email, 254)?.toLowerCase() ?? null;
  const name = text(body.name, 120);
  if (!isUuid(body.tournament_id) || !email || !EMAIL_RE.test(email) || !name || name.length < 2) {
    return json({ success: false, error: "Invalid input" }, 400);
  }
  const phone = text(body.phone, 30);
  const categoryId = isUuid(body.category_id) ? body.category_id : null;
  const step = typeof body.step === "string" && STEPS.includes(body.step) ? body.step : null;
  const sel = body.selections && typeof body.selections === "object" ? body.selections as Record<string, unknown> : null;
  const selectedIds = Array.isArray(sel?.category_ids)
    ? [...new Set((sel!.category_ids as unknown[]).filter(isUuid))].slice(0, 10)
    : null;
  const payMethod = sel?.payment_method === "card" || sel?.payment_method === "etransfer" ? sel.payment_method : null;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await allowClient(supabase, req, "save-registration-lead", 30, 600))) {
    return json({ success: false, error: "Too many requests" }, 429);
  }

  const { data: t } = await supabase.from("tournaments")
    .select("id, registration_open, registration_deadline").eq("id", body.tournament_id).maybeSingle();
  const open = t?.registration_open &&
    !(t.registration_deadline && new Date(t.registration_deadline).getTime() < Date.now());
  if (!open) return json({ success: false, error: "Registration is closed" }, 400);
  // Overall cap per tournament, which per-client limits can't get around.
  if (!(await allow(supabase, "save-registration-lead-tournament", t.id, 500, 3600))) {
    return json({ success: false, error: "Too many requests" }, 429);
  }

  // Categories from another tournament are dropped rather than refused.
  const wanted = [...new Set([...(categoryId ? [categoryId] : []), ...(selectedIds ?? [])])];
  let valid = new Set<string>();
  if (wanted.length) {
    const { data: cs } = await supabase.from("categories").select("id").eq("tournament_id", t.id).in("id", wanted);
    valid = new Set((cs ?? []).map((c: { id: string }) => c.id));
  }
  const category = categoryId && valid.has(categoryId) ? categoryId : (selectedIds ?? []).find((id) => valid.has(id)) ?? null;
  const selections = selectedIds || payMethod
    ? { category_ids: (selectedIds ?? []).filter((id) => valid.has(id)), ...(payMethod ? { payment_method: payMethod } : {}) }
    : null;

  const { data: existing } = await supabase.from("registration_leads")
    .select("id, last_step").eq("tournament_id", t.id).eq("email", email).maybeSingle();
  // Keep the furthest step reached; going back a step doesn't lower it.
  const furthest = step && (!existing?.last_step || STEPS.indexOf(step) > STEPS.indexOf(existing.last_step))
    ? step
    : null;
  const row = {
    name,
    ...(phone ? { phone } : {}),
    ...(category ? { category_id: category } : {}),
    ...(furthest ? { last_step: furthest } : {}),
    ...(selections ? { selections } : {}),
    updated_at: new Date().toISOString(),
  };
  const { error } = existing
    ? await supabase.from("registration_leads").update(row).eq("id", existing.id)
    : await supabase.from("registration_leads").insert({ tournament_id: t.id, email, ...row });
  // A race between two first saves hits the unique index; the other one won.
  if (error && !/duplicate key/i.test(error.message)) {
    console.error("save-registration-lead failed:", error.message);
    return json({ success: false, error: "Couldn't save" }, 500);
  }
  return json({ success: true }, 200);
});
