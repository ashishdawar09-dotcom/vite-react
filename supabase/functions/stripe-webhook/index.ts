// supabase/functions/stripe-webhook/index.ts
//
// Receives Stripe events for card registrations. Deployed with JWT checks off
// (Stripe can't send a Supabase token); every request must carry a valid
// Stripe-Signature instead.
//
// The Stripe account is shared with Little Computer School, so this endpoint
// may also receive events for other products: anything without
// metadata.app = "badminton" is acknowledged and ignored.
//
// Events subscribed (Stripe dashboard → Webhooks):
//   checkout.session.completed  → registration becomes 'pending' (admin review), paid
//   checkout.session.expired    → 'payment_expired'
//   charge.refunded             → card_payment_status 'refunded'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { verifyStripeSignature } from "../_shared/stripe.ts";
import { sendRegistrationReceived } from "../_shared/registration_emails.ts";
import { markLeadCompleted } from "../_shared/leads.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> & { metadata?: Record<string, string> } };
};

const ok = (body: Record<string, unknown> = { received: true }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const payload = await req.text();
  if (!secret || !(await verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret))) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const obj = event.data.object;

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.expired") {
      if (obj.metadata?.app !== "badminton") return ok({ received: true, ignored: true });
      const regId = obj.metadata?.registration_id;
      const sessionId = obj.id as string;
      // Several events paid in one checkout: the session id is on the first
      // row only, and every row of the submission shares submission_id.
      const submissionId = obj.metadata?.submission_id;
      if (submissionId) {
        if (!UUID.test(submissionId) || !regId || !UUID.test(regId)) return ok({ received: true, ignored: true });
        // The session must be the one stored on the submission's first row.
        const { data: first, error: firstErr } = await supabase
          .from("pending_registrations")
          .select("id, tournament_id, player_email")
          .eq("id", regId)
          .eq("submission_id", submissionId)
          .eq("stripe_checkout_session_id", sessionId)
          .maybeSingle();
        if (firstErr) throw new Error(firstErr.message);
        if (!first) return ok({ received: true, ignored: true });

        if (event.type === "checkout.session.completed" && obj.payment_status === "paid") {
          const paymentIntent = obj.payment_intent as string | null;
          // Each row keeps its own amount_due_cents (its share of the total).
          // Also accepts rows that had been marked expired (a late completion
          // still means we were paid; the admin sees them as paid).
          const { data: paid, error } = await supabase
            .from("pending_registrations")
            .update({
              status: "pending",
              card_payment_status: "paid",
              stripe_payment_intent_id: paymentIntent,
              payment_reference: paymentIntent ? `Stripe ${paymentIntent}` : `Stripe ${sessionId}`,
              paid_at: new Date().toISOString(),
            })
            .eq("submission_id", submissionId)
            .in("status", ["awaiting_payment", "payment_expired"])
            .select("id");
          if (error) throw new Error(error.message);
          await markLeadCompleted(supabase, first.tournament_id, first.player_email);
          // Confirmations go out once per event, however often Stripe retries
          // (each is claimed per registration).
          const { data: group } = await supabase
            .from("pending_registrations")
            .select("id")
            .eq("submission_id", submissionId)
            .eq("card_payment_status", "paid")
            .order("id");
          const ids = (group ?? paid ?? []).map((r: { id: string }) => r.id);
          for (const [i, id] of ids.entries()) {
            if (i > 0) await new Promise((r) => setTimeout(r, 1200));
            await sendRegistrationReceived(supabase, id, "https://badminton.adawar.org");
          }
        }

        if (event.type === "checkout.session.expired") {
          const { error } = await supabase
            .from("pending_registrations")
            .update({ status: "payment_expired", card_payment_status: "expired" })
            .eq("submission_id", submissionId)
            .eq("status", "awaiting_payment");
          if (error) throw new Error(error.message);
        }
        return ok();
      }

      if (event.type === "checkout.session.completed" && obj.payment_status === "paid") {
        const paymentIntent = obj.payment_intent as string | null;
        // Also accepts a session that had been marked expired (a late
        // completion still means we were paid; the admin sees it as paid).
        const { data: paidRows, error } = await supabase
          .from("pending_registrations")
          .update({
            status: "pending",
            card_payment_status: "paid",
            stripe_payment_intent_id: paymentIntent,
            payment_reference: paymentIntent ? `Stripe ${paymentIntent}` : `Stripe ${sessionId}`,
            amount_due_cents: obj.amount_total as number,
            paid_at: new Date().toISOString(),
          })
          .eq("id", regId)
          .eq("stripe_checkout_session_id", sessionId)
          .in("status", ["awaiting_payment", "payment_expired"])
          .select("tournament_id, player_email");
        if (error) throw new Error(error.message);
        const paidRow = paidRows?.[0];
        if (paidRow) await markLeadCompleted(supabase, paidRow.tournament_id, paidRow.player_email);
        // Paid: confirmation to the player and partner (with the partner's
        // waiver link). Sent once, however often Stripe retries.
        if (regId) await sendRegistrationReceived(supabase, regId, "https://badminton.adawar.org");
      }

      if (event.type === "checkout.session.expired") {
        const { error } = await supabase
          .from("pending_registrations")
          .update({ status: "payment_expired", card_payment_status: "expired" })
          .eq("id", regId)
          .eq("stripe_checkout_session_id", sessionId)
          .eq("status", "awaiting_payment");
        if (error) throw new Error(error.message);
      }
      return ok();
    }

    if (event.type === "charge.refunded") {
      // Matched by payment intent, which only ever hits badminton rows.
      const fullyRefunded = obj.refunded === true;
      if (fullyRefunded && obj.payment_intent) {
        const { error } = await supabase
          .from("pending_registrations")
          .update({ card_payment_status: "refunded" })
          .eq("stripe_payment_intent_id", obj.payment_intent as string);
        if (error) throw new Error(error.message);
      }
      return ok();
    }

    return ok({ received: true, ignored: true });
  } catch (e) {
    // 500 makes Stripe retry; updates above are idempotent.
    console.error("stripe-webhook failed:", event.type, e instanceof Error ? e.message : String(e));
    return new Response("Webhook processing failed", { status: 500 });
  }
});
