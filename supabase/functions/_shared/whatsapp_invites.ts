// Who gets the "updates on WhatsApp" invitation: people who entered before
// the opt-in button existed. One email per person (an address can belong to
// a parent with two children, so it's per address and name). The pure part
// (pickInvitees) is unit-tested; loadInvitees fetches the rows for it.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { optinCode } from "./whatsapp.ts";

export type InviteRow = {
  id: string;
  status: string;
  submitted_at: string;
  player_name: string;
  player_email: string;
  partner_name: string | null;
  partner_email: string | null;
  category: string;
  // Whether the linked player record is still active (null while pending),
  // and its name: updates follow that record, which approval finds by email.
  player_active: boolean | null;
  partner_active: boolean | null;
  player_record?: string | null;
  partner_record?: string | null;
};

export type Invitee = {
  key: string; // the person: address and first name (whatsapp_invites.person_key)
  email: string;
  name: string;
  role: "player" | "partner";
  code: string;
  registration_id: string;
  categories: string[];
  // Player: their doubles partner on the entry whose code they get.
  // Partner: the person who entered them.
  other: string | null;
  // Player: that partner is being invited too.
  otherInvited: boolean;
  // The name on the player record their updates will follow (null while
  // pending). A second child under a parent's address can share the first
  // child's record; the dry run lists names that don't match.
  record_name: string | null;
};

export type InviteSkips = {
  after_launch: number;
  status: number;
  withdrawn: number;
  opted_in: number;
  no_email: number;
};

const live = (status: string) => status === "approved" || status === "pending";
const clean = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
// One person = one address and first name: a parent's two children differ,
// while "Jordan K Lee" typed by a partner and "Jordan Lee" typed by Jordan
// are the same person (approve_registration matches players by email).
const personKey = (email: string, name: string) => `${email}|${name.split(" ")[0].toLowerCase()}`;

// `optedIn` holds "<registration id>:<role>" for every opt-in on file and
// `stopped` the ones that sent STOP. Anyone opted in through a live entry,
// or who sent STOP through any entry, isn't asked again, whichever entry
// the opt-in came through. `launchedAt` is when the button went live:
// later entrants saw it.
export function pickInvitees(
  rows: InviteRow[],
  optedIn: Set<string>,
  launchedAt: string,
  stopped: Set<string> = new Set(),
): { invitees: Invitee[]; skipped: InviteSkips } {
  const skipped: InviteSkips = { after_launch: 0, status: 0, withdrawn: 0, opted_in: 0, no_email: 0 };
  const person = (role: "player" | "partner", r: InviteRow) => {
    const name = clean(role === "player" ? r.player_name : r.partner_name);
    const email = clean(role === "player" ? r.player_email : r.partner_email).toLowerCase();
    return { name, email, key: personKey(email, name) };
  };

  const optedPeople = new Set<string>();
  for (const r of rows) {
    for (const role of ["player", "partner"] as const) {
      const k = `${r.id}:${role}`;
      if (optedIn.has(k) && (live(r.status) || stopped.has(k))) optedPeople.add(person(role, r).key);
    }
  }

  const people = new Map<string, Invitee>();
  const skippedOpted = new Set<string>();
  const partnerOf = new Map<string, string>(); // registration id -> its partner's key
  const add = (role: "player" | "partner", r: InviteRow) => {
    const { name, email, key } = person(role, r);
    if (!name) return;
    if (!validEmail(email)) { skipped.no_email++; return; }
    const active = role === "player" ? r.player_active : r.partner_active;
    if (active === false) { skipped.withdrawn++; return; }
    if (role === "partner") partnerOf.set(r.id, key);
    if (optedPeople.has(key)) { skippedOpted.add(key); return; }
    const seen = people.get(key);
    if (seen) {
      if (!seen.categories.includes(r.category)) seen.categories.push(r.category);
      return;
    }
    people.set(key, {
      key,
      email,
      name,
      role,
      code: optinCode(r.id, role),
      registration_id: r.id,
      categories: [r.category],
      other: clean(role === "player" ? r.partner_name : r.player_name) || null,
      otherInvited: false,
      record_name: (role === "player" ? r.player_record : r.partner_record) ?? null,
    });
  };

  // Oldest entry first: that entry's code is used.
  const current = [...rows].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at)).filter((r) => {
    if (!live(r.status)) { skipped.status++; return false; }
    if (r.submitted_at >= launchedAt) { skipped.after_launch++; return false; }
    return true;
  });
  // Approved entries before pending ones (a pending duplicate may still be
  // rejected, taking its code with it), and within each, registrants first:
  // someone who entered themselves and is also another entry's partner gets
  // their own entry's code.
  for (const approved of [true, false]) {
    const tier = current.filter((r) => (r.status === "approved") === approved);
    for (const r of tier) add("player", r);
    for (const r of tier) add("partner", r);
  }
  skipped.opted_in = skippedOpted.size;
  const invitees = [...people.values()];
  for (const i of invitees) {
    const partner = partnerOf.get(i.registration_id);
    i.otherInvited = i.role === "player" && !!partner && people.has(partner);
  }
  return { invitees, skipped };
}

export async function loadInvitees(supabase: SupabaseClient, tournamentId: string, launchedAt: string) {
  const { data, error } = await supabase
    .from("pending_registrations")
    .select(
      "id, status, submitted_at, player_name, player_email, partner_name, partner_email, " +
        "categories(name), player:players!pending_registrations_approved_player_id_fkey(active, name), " +
        "partner:players!pending_registrations_approved_partner_id_fkey(active, name)",
    )
    .eq("tournament_id", tournamentId);
  if (error) throw new Error(`registrations: ${error.message}`);
  // The select string is built from parts, so supabase-js can't infer a type.
  const raw = (data ?? []) as unknown as Record<string, unknown>[];
  const linked = (v: unknown) => v as { active?: boolean; name?: string } | null;
  const rows: InviteRow[] = raw.map((r) => ({
    id: r.id as string,
    status: r.status as string,
    submitted_at: r.submitted_at as string,
    player_name: r.player_name as string,
    player_email: r.player_email as string,
    partner_name: r.partner_name as string | null,
    partner_email: r.partner_email as string | null,
    category: ((r.categories as { name?: string } | null)?.name) ?? "",
    player_active: linked(r.player)?.active ?? null,
    partner_active: linked(r.partner)?.active ?? null,
    player_record: linked(r.player)?.name ?? null,
    partner_record: linked(r.partner)?.name ?? null,
  }));
  const { data: opts, error: optErr } = await supabase
    .from("whatsapp_optins").select("registration_id, role, opted_out_at").eq("tournament_id", tournamentId);
  if (optErr) throw new Error(`opt-ins: ${optErr.message}`);
  const optedIn = new Set((opts ?? []).map((o) => `${o.registration_id}:${o.role}`));
  const stopped = new Set((opts ?? []).filter((o) => o.opted_out_at).map((o) => `${o.registration_id}:${o.role}`));
  return pickInvitees(rows, optedIn, launchedAt, stopped);
}
