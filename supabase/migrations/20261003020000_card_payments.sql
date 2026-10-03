-- Card payments through Stripe Checkout, alongside Interac e-Transfer.
--
-- A card registration is inserted as 'awaiting_payment' and only becomes
-- 'pending' (visible for admin approval) once the stripe-webhook function
-- receives checkout.session.completed. Abandoned or expired checkouts end
-- as 'payment_expired'.

alter table public.pending_registrations
  add column payment_method text not null default 'etransfer',
  add column amount_due_cents integer,
  add column card_payment_status text,
  add column stripe_checkout_session_id text,
  add column stripe_payment_intent_id text,
  add column paid_at timestamptz;

alter table public.pending_registrations alter column payment_reference drop not null;

alter table public.pending_registrations
  drop constraint pending_registrations_status_check,
  add constraint pending_registrations_status_check
    check (status in ('pending', 'approved', 'rejected', 'awaiting_payment', 'payment_expired')),
  add constraint pending_registrations_payment_method_check
    check (payment_method in ('etransfer', 'card')),
  add constraint pending_registrations_card_payment_status_check
    check (card_payment_status is null or card_payment_status in ('awaiting', 'paid', 'expired', 'refunded')),
  add constraint pending_registrations_etransfer_reference
    check (payment_method = 'card' or payment_reference is not null),
  add constraint pending_registrations_amount_nonnegative
    check (amount_due_cents is null or amount_due_cents >= 0),
  add constraint pending_registrations_stripe_session_unique unique (stripe_checkout_session_id);

create index pending_registrations_payment_intent
  on public.pending_registrations (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
