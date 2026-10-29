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
    entries: new Set(approved.map(entryKey)).size,
    players: people.size,
    payments: approved.length,
    total: sum(approved),
    etransfer: sum(approved.filter(r => r.payment_method !== "card")),
    card: sum(approved.filter(r => r.payment_method === "card")),
  };
}

export type PaymentNote = "paid for both" | "paid separately" | "share paid twice" | "partner's share not paid yet";

// What each approved row needs a director to know about its partner's share:
// - "paid separately": each partner paid their own share.
// - "share paid twice": a second payment on the entry where one of them had
//   paid for both, so one share is owed back.
// - "partner's share not paid yet": an own-share doubles entry whose partner
//   hasn't registered (registering is how they pay). `rows` holds every
//   pending and approved row, so a partner's entry awaiting approval counts.
export function paymentNotes(
  approved: Row[],
  rows: Pick<Row, "category_id" | "status" | "player_email">[],
  categories: Pick<Category, "id" | "team_size" | "price_basis">[],
): Map<string, PaymentNote> {
  const byEntry = new Map<string, Row[]>();
  for (const r of approved) byEntry.set(entryKey(r), [...(byEntry.get(entryKey(r)) ?? []), r]);
  const entered = new Set(rows.filter(r => r.status === "pending" || r.status === "approved")
    .map(r => `${r.category_id}|${norm(r.player_email)}`));
  const ownShareDoubles = new Set(categories
    .filter(c => c.team_size === 2 && c.price_basis === "per_player").map(c => c.id));

  const notes = new Map<string, PaymentNote>();
  for (const r of approved) {
    const group = byEntry.get(entryKey(r))!;
    if (group.length > 1) {
      notes.set(r.id, group.some(g => g.payment_paid_full_for_partner) ? "share paid twice" : "paid separately");
    } else if (r.payment_paid_full_for_partner) {
      if (r.partner_name) notes.set(r.id, "paid for both");
    } else if (r.partner_email && ownShareDoubles.has(r.category_id) &&
      !entered.has(`${r.category_id}|${norm(r.partner_email)}`)) {
      notes.set(r.id, "partner's share not paid yet");
    }
  }
  return notes;
}
