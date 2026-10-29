import type { PendingRegistration } from "../../types";

type Row = Pick<PendingRegistration,
  "id" | "approved_team_id" | "player_email" | "partner_name" | "partner_email" | "payment_method" | "amount_due_cents">;

// Headline numbers for approved entries. When both partners register and pay
// their own share, the two entries are linked to one team: that's one entry
// and two payments. Players are counted once each, by email.
export function paymentTotals(approved: Row[]) {
  const sum = (list: Row[]) => list.reduce((s, r) => s + (r.amount_due_cents ?? 0), 0);
  const entries = new Set(approved.map(r => r.approved_team_id ?? r.id));
  const people = new Set<string>();
  for (const r of approved) {
    people.add(r.player_email.trim().toLowerCase());
    if (r.partner_email) people.add(r.partner_email.trim().toLowerCase());
    else if (r.partner_name) people.add(`${r.id}:partner`);
  }
  return {
    entries: entries.size,
    players: people.size,
    payments: approved.length,
    total: sum(approved),
    etransfer: sum(approved.filter(r => r.payment_method !== "card")),
    card: sum(approved.filter(r => r.payment_method === "card")),
  };
}

// Teams paid for in more than one payment (each partner paid their share).
export function splitPaidTeams(approved: Pick<PendingRegistration, "approved_team_id">[]): Set<string> {
  const seen = new Set<string>();
  const split = new Set<string>();
  for (const { approved_team_id: t } of approved) {
    if (!t) continue;
    if (seen.has(t)) split.add(t);
    seen.add(t);
  }
  return split;
}
