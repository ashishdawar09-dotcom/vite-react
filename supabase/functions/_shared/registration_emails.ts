// Sends the registration emails for one entry, to the player and (doubles)
// the partner. Each email is claimed in the row before sending, so Stripe
// retries or a double-clicked Approve never send twice; the outcome is stored
// for the admin card. Never throws: an email problem must not fail a
// registration, a payment webhook or an approval.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { approvalRecipients, type TeamEntry } from "./approval_recipients.ts";
import { adminNewEntry, buildIcs, type EmailData, registrationApproved, registrationReceived, shareConfirmed } from "./emails.ts";
import { sendEmail } from "./mailer.ts";

const ASSET_BASE = Deno.env.get("EMAIL_ASSET_BASE") ?? "https://shuttlestorm.adawar.org/email";
const PRIVACY_URL = Deno.env.get("EMAIL_PRIVACY_URL") ?? "https://shuttlestorm.adawar.org/privacy";

// Single literals so supabase-js can infer the row types.
const REG_COLUMNS =
  "id, tournament_id, category_id, status, submitted_at, player_name, player_email, player_phone, player_age, player_fee_type, partner_name, partner_email, partner_phone, partner_age, partner_fee_type, payment_method, payment_reference, amount_due_cents, payment_paid_full_for_partner, partner_consent_token, comments";
const T_COLUMNS =
  "id, name, event_date, event_time, venue_name, venue_address, venue_map_url, rules_url, waiver_url, contact_info, waiver_text, reply_to_email, admin_notify_emails";

type Kind = "confirmation" | "approval" | "admin";

const short = (s: string) => s.slice(0, 200);

// Marks the email as being sent; false if it's already sending or sent.
// A failed send can be claimed again (retry).
async function claim(supabase: SupabaseClient, regId: string, kind: Kind): Promise<boolean> {
  const col = `${kind}_email_status`;
  const { data, error } = await supabase
    .from("pending_registrations")
    .update({ [col]: "sending" })
    .eq("id", regId)
    .or(`${col}.is.null,${col}.like.failed*`)
    .select("id");
  if (error) {
    console.error(`${kind} email claim failed:`, error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

async function finish(supabase: SupabaseClient, regId: string, kind: Kind, status: string) {
  await supabase.from("pending_registrations").update({
    [`${kind}_email_status`]: short(status),
    [`${kind}_emailed_at`]: new Date().toISOString(),
  }).eq("id", regId);
}

async function load(supabase: SupabaseClient, regId: string) {
  const { data: reg } = await supabase.from("pending_registrations").select(REG_COLUMNS).eq("id", regId).maybeSingle();
  if (!reg) return null;
  const [{ data: t }, { data: c }] = await Promise.all([
    supabase.from("tournaments").select(T_COLUMNS).eq("id", reg.tournament_id).maybeSingle(),
    supabase.from("categories").select("name, team_size, price_basis").eq("id", reg.category_id).maybeSingle(),
  ]);
  if (!t || !c) return null;
  return { reg, t, c };
}

const outcome = (who: string, err: string | null) => (err ? `${who} failed: ${err}` : null);

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

// Where the named partner stands. When each partner pays their own share,
// the partner pays theirs by entering themselves: "due" until they have, and
// "entered" once their own entry is in. Someone who accepted the waiver on
// their own entry doesn't need the partner waiver link as well.
export async function partnerContext(supabase: SupabaseClient, { reg, c }: Loaded, appOrigin: string) {
  const email = reg.partner_email?.trim().toLowerCase();
  if (!email) return { partnerShare: null, partnerConsented: false, registerUrl: null };
  const ownShare = c.team_size === 2 && c.price_basis === "per_player" && !reg.payment_paid_full_for_partner;
  const [{ count: entries }, { count: consents }] = await Promise.all([
    supabase.from("pending_registrations").select("id", { count: "exact", head: true })
      .eq("category_id", reg.category_id).eq("player_email", email).in("status", ["pending", "approved"]),
    supabase.from("waiver_consents").select("id", { count: "exact", head: true })
      .eq("tournament_id", reg.tournament_id).eq("participant_email", email),
  ]);
  return {
    partnerShare: ownShare ? ((entries ?? 0) > 0 ? "entered" as const : "due" as const) : null,
    partnerConsented: (consents ?? 0) > 0,
    registerUrl: `${appOrigin}/register/${reg.tournament_id}?category=${reg.category_id}`,
  };
}

// "We've got your registration" to the player and partner, then the
// directors' alert. For card entries call only once paid.
export async function sendRegistrationReceived(
  supabase: SupabaseClient,
  regId: string,
  appOrigin: string,
): Promise<void> {
  await confirmToPlayers(supabase, regId, appOrigin);
  await notifyDirectors(supabase, regId, appOrigin);
}

// Replaces the separate partner waiver email: the partner's copy carries
// their waiver link, and partner_waiver_email_status records that send.
async function confirmToPlayers(supabase: SupabaseClient, regId: string, appOrigin: string): Promise<void> {
  try {
    if (!(await claim(supabase, regId, "confirmation"))) return;
    const loaded = await load(supabase, regId);
    if (!loaded) return await finish(supabase, regId, "confirmation", "failed: registration not found");
    const { reg, t, c } = loaded;
    const partner = await partnerContext(supabase, loaded, appOrigin);

    // A partner who still owes their share accepts the waiver on the form
    // they pay with, so they get that link instead of this one.
    let partnerNeedsWaiver = false;
    if (t.waiver_text && reg.partner_email && reg.partner_consent_token && !partner.partnerConsented &&
      partner.partnerShare !== "due") {
      const { count } = await supabase.from("waiver_consents").select("id", { count: "exact", head: true })
        .eq("registration_id", reg.id).eq("role", "partner");
      partnerNeedsWaiver = (count ?? 0) === 0;
    }

    const base: Omit<EmailData, "role"> = {
      tournament: t,
      category: c,
      reg,
      assetBase: ASSET_BASE,
      privacyUrl: PRIVACY_URL,
      partnerWaiverPending: partnerNeedsWaiver,
    };
    const mine = registrationReceived({ ...base, role: "player" });
    const playerErr = await sendEmail({ to: reg.player_email, fromName: t.name, replyTo: t.reply_to_email, ...mine });

    let partnerErr: string | null = null;
    if (reg.partner_email) {
      const waiverLink = partnerNeedsWaiver ? `${appOrigin}/waiver/${reg.partner_consent_token}` : null;
      const theirs = registrationReceived({
        ...base, role: "partner", waiverLink, partnerShare: partner.partnerShare, registerUrl: partner.registerUrl,
      });
      partnerErr = await sendEmail({ to: reg.partner_email, fromName: t.name, replyTo: t.reply_to_email, ...theirs });
      if (waiverLink) {
        await supabase.from("pending_registrations").update({
          partner_waiver_email_status: partnerErr ? short(`failed: ${partnerErr}`) : "sent",
          partner_waiver_emailed_at: new Date().toISOString(),
        }).eq("id", reg.id);
      }
    }

    const problems = [outcome("player", playerErr), outcome("partner", partnerErr)].filter(Boolean);
    if (problems.length) console.error("registration email:", problems.join("; "));
    await finish(supabase, regId, "confirmation", problems.length ? `failed: ${problems.join("; ")}` : "sent");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("registration email failed:", msg);
    await finish(supabase, regId, "confirmation", `failed: ${msg}`);
  }
}

// Directors' alert for a new entry, to tournaments.admin_notify_emails.
// Replies go to the player. Claimed separately from the player's email.
async function notifyDirectors(supabase: SupabaseClient, regId: string, appOrigin: string): Promise<void> {
  try {
    const loaded = await load(supabase, regId);
    const to = (loaded?.t.admin_notify_emails ?? []).filter((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (!loaded || !to.length) return;
    if (!(await claim(supabase, regId, "admin"))) return;
    const { reg, t, c } = loaded;
    const { data: consents } = await supabase.from("waiver_consents").select("role").eq("registration_id", reg.id);
    const roles = new Set((consents ?? []).map((x: { role: string }) => x.role));
    const mail = adminNewEntry({
      tournament: t,
      category: c,
      reg,
      waiverRequired: !!t.waiver_text,
      playerWaiver: roles.has("player"),
      partnerWaiver: roles.has("partner"),
      adminUrl: Deno.env.get("ADMIN_APP_URL") ?? appOrigin,
    });
    const err = await sendEmail({ to, fromName: t.name, replyTo: reg.player_email, ...mail });
    if (err) console.error("directors' email failed:", err);
    await finish(supabase, regId, "admin", err ? `failed: ${err}` : "sent");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("directors' email failed:", msg);
    await finish(supabase, regId, "admin", `failed: ${msg}`);
  }
}

// "You're in!", with a calendar invite. Only for approved entries. When the
// pair's other entry already sent it (each paid their own share), the player
// gets a short "your share is paid" email instead and the partner nothing.
export async function sendRegistrationApproved(
  supabase: SupabaseClient,
  regId: string,
  appOrigin: string,
): Promise<{ sent: boolean; status: string }> {
  try {
    const { data: row } = await supabase.from("pending_registrations")
      .select("status, approved_team_id").eq("id", regId).maybeSingle();
    if (row?.status !== "approved") return { sent: false, status: "not approved" };
    if (!(await claim(supabase, regId, "approval"))) return { sent: false, status: "already sent" };
    const loaded = await load(supabase, regId);
    if (!loaded) {
      await finish(supabase, regId, "approval", "failed: registration not found");
      return { sent: false, status: "registration not found" };
    }
    const { reg, t, c } = loaded;

    let others: TeamEntry[] = [];
    if (row.approved_team_id) {
      const { data } = await supabase.from("pending_registrations")
        .select("player_email, partner_email, approval_email_status")
        .eq("approved_team_id", row.approved_team_id).eq("status", "approved").neq("id", regId);
      others = data ?? [];
    }
    const to = approvalRecipients(reg, others);
    const partner = await partnerContext(supabase, loaded, appOrigin);

    const ics = buildIcs(t, reg.id);
    const attachments = ics ? [{ filename: "event.ics", content: btoa(unescape(encodeURIComponent(ics))) }] : [];
    const base: Omit<EmailData, "role"> = { tournament: t, category: c, reg, assetBase: ASSET_BASE, privacyUrl: PRIVACY_URL };

    const playerErr = to.player
      ? await sendEmail({
        to: reg.player_email, fromName: t.name, replyTo: t.reply_to_email, attachments,
        ...registrationApproved({ ...base, role: "player" }),
      })
      : await sendEmail({
        to: reg.player_email, fromName: t.name, replyTo: t.reply_to_email,
        ...shareConfirmed({ ...base, role: "player" }),
      });
    const partnerErr = to.partner && reg.partner_email
      ? await sendEmail({
        to: reg.partner_email, fromName: t.name, replyTo: t.reply_to_email, attachments,
        ...registrationApproved({
          ...base, role: "partner", partnerShare: partner.partnerShare, registerUrl: partner.registerUrl,
        }),
      })
      : null;

    const problems = [outcome("player", playerErr), outcome("partner", partnerErr)].filter(Boolean);
    const status = problems.length ? `failed: ${problems.join("; ")}` : "sent";
    if (problems.length) console.error("approval email:", status);
    await finish(supabase, regId, "approval", status);
    return { sent: !problems.length, status: short(status) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("approval email failed:", msg);
    await finish(supabase, regId, "approval", `failed: ${msg}`);
    return { sent: false, status: short(`failed: ${msg}`) };
  }
}
