import type { Category, PendingRegistration } from "../../types";

type Row = Pick<PendingRegistration,
  "id" | "category_id" | "status" | "approved_team_id" | "player_email" | "partner_name" | "partner_email" |
  "payment_method" | "amount_due_cents" | "payment_paid_full_for_partner">;

const norm = (e: string) => e.trim().toLowerCase();

// One key per entry. When both partners register and each names the other,
// their two registrations share a key: the same email match approve_registration
// uses to link them, so it still holds if the team is deleted later.
export function entryKey(r: Pick<Row, "id" | "category_id" | "approved_team_id" | "player_email" | "partner_email">): string {
  if (r.partner_email) return `${r.category_id}|${[r.player_email, r.partner_email].map(norm).sort().join("|")}`;
  return r.approved_team_id ?? r.id;
}

// Which approved rows are the same entry: a pair's two registrations (same
// key), and a solo registration from someone another row names as partner in
// that event (they paid their share without naming anyone). Returns one group
// key per row id.
export function entryGroups(approved: Pick<Row, "id" | "category_id" | "approved_team_id" | "player_email" | "partner_email">[]) {
  const group = new Map(approved.map(r => [r.id, entryKey(r)]));
  const named = new Map<string, string>();
  for (const r of approved) if (r.partner_email) named.set(`${r.category_id}|${norm(r.partner_email)}`, group.get(r.id)!);
  for (const r of approved) {
    const pairKey = r.partner_email ? undefined : named.get(`${r.category_id}|${norm(r.player_email)}`);
    if (pairKey) group.set(r.id, pairKey);
  }
  return group;
}

// Headline numbers for approved entries: a pair who paid in two payments is
// one entry. Players are counted once each, by email.
export function paymentTotals(approved: Row[]) {
  const sum = (list: Row[]) => list.reduce((s, r) => s + (r.amount_due_cents ?? 0), 0);
  const people = new Set<string>();
  for (const r of approved) {
    people.add(norm(r.player_email));
    if (r.partner_email) people.add(norm(r.partner_email));
    else if (r.partner_name) people.add(`${r.id}:partner`);
  }
  return {
    entries: new Set(entryGroups(approved).values()).size,
    players: people.size,
    payments: approved.length,
    total: sum(approved),
    etransfer: sum(approved.filter(r => r.payment_method !== "card")),
    card: sum(approved.filter(r => r.payment_method === "card")),
  };
}

export type PaymentNote =
  | "paid for both" | "paid separately" | "share paid twice" | "partner's share not paid yet"
  | "partner has no email: check their share";

// What each approved row needs a director to know about its partner's share:
// - "paid separately": each partner paid their own share.
// - "share paid twice": a second payment on the entry where one of them had
//   paid for both, so one share is owed back.
// - "partner's share not paid yet": an own-share doubles entry whose partner
//   hasn't registered (registering is how they pay). `rows` holds every
//   pending and approved row, so a partner's entry awaiting approval counts.
// - "partner has no email: check their share": the same, but the partner was
//   named without an email, so only a registration under the same name in the
//   event can be matched; otherwise a director has to check.
export function paymentNotes(
  approved: Row[],
  rows: (Pick<Row, "category_id" | "status" | "player_email"> & { player_name: string })[],
  categories: Pick<Category, "id" | "team_size" | "price_basis">[],
): Map<string, PaymentNote> {
  const groups = entryGroups(approved);
  const byEntry = new Map<string, Row[]>();
  for (const r of approved) byEntry.set(groups.get(r.id)!, [...(byEntry.get(groups.get(r.id)!) ?? []), r]);
  const live = rows.filter(r => r.status === "pending" || r.status === "approved");
  const entered = new Set(live.map(r => `${r.category_id}|${norm(r.player_email)}`));
  const enteredByName = new Set(live.map(r => `${r.category_id}|${norm(r.player_name)}`));
  const ownShareDoubles = new Set(categories
    .filter(c => c.team_size === 2 && c.price_basis === "per_player").map(c => c.id));

  const notes = new Map<string, PaymentNote>();
  for (const r of approved) {
    const group = byEntry.get(groups.get(r.id)!)!;
    if (group.length > 1) {
      notes.set(r.id, group.some(g => g.payment_paid_full_for_partner) ? "share paid twice" : "paid separately");
    } else if (r.payment_paid_full_for_partner) {
      if (r.partner_name) notes.set(r.id, "paid for both");
    } else if (!ownShareDoubles.has(r.category_id)) {
      continue;
    } else if (r.partner_email) {
      if (!entered.has(`${r.category_id}|${norm(r.partner_email)}`)) notes.set(r.id, "partner's share not paid yet");
    } else if (r.partner_name?.trim() && !enteredByName.has(`${r.category_id}|${norm(r.partner_name)}`)) {
      notes.set(r.id, "partner has no email: check their share");
    }
  }
  return notes;
}
