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

      if (event.type === "checkout.session.completed" && obj.payment_status === "paid") {
        const paymentIntent = obj.payment_intent as string | null;
        // Also accepts a session that had been marked expired (a late
        // completion still means we were paid; the admin sees it as paid).
        const { error } = await supabase
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
          .in("status", ["awaiting_payment", "payment_expired"]);
        if (error) throw new Error(error.message);
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
