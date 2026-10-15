// Server-side registration pricing. Mirrors src/features/publicRegistration/
// computeFee.ts; the amount charged by card is always computed here from the
// category and tournament rows, never taken from the request.

// Card payments cost 3% more than Interac e-Transfer (presented to players as
// an e-Transfer discount, not a card surcharge).
export const CARD_MARKUP = 0.03;

// What card payments show on bank statements. "ADAWAR" is the Stripe account's
// shortened descriptor (Dashboard → Settings → Business details); the suffix is
// sent with each payment. The account is shared with Little Computer School,
// whose payments keep the full descriptor "LITTLE COMPUTER SCHOOL".
export const STATEMENT_SUFFIX = "SHUTTLE STORM";
export const STATEMENT_NAME = `ADAWAR* ${STATEMENT_SUFFIX}`;

export type PricedCategory = {
  team_size: number;
  price: number | string | null;
  price_basis: "per_player" | "per_team" | string;
};

// Reduced per-player fees set on the tournament (null = not offered).
export type Concessions = {
  youth_price?: number | string | null;
  student_price?: number | string | null;
};

export type FeeType = "standard" | "youth" | "student";

// Who a per-player share is for: age on the event date, and whether they
// claimed the student rate.
export type Participant = { age: number | null; student: boolean };

function money(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// One player's share of a per-player price. Under-18s get the youth fee and
// students the student fee, but only when it's lower than the category price
// (youth categories are already priced at the youth fee).
export function playerShare(
  categoryPrice: number,
  who: Participant | undefined,
  concessions: Concessions = {},
): { price: number; type: FeeType } {
  const youth = money(concessions.youth_price);
  const student = money(concessions.student_price);
  if (who && who.age !== null && who.age < 18 && youth !== null && youth < categoryPrice) {
    return { price: youth, type: "youth" };
  }
  if (who?.student && student !== null && student < categoryPrice) {
    return { price: student, type: "student" };
  }
  return { price: categoryPrice, type: "standard" };
}

// Amount owed by e-Transfer, in cents, or null when the category has no price.
// Doubles priced per player cost both shares when one player pays for both.
// Per-team prices ignore concessions.
export function etransferCents(
  category: PricedCategory,
  paysForBoth: boolean,
  player?: Participant,
  partner?: Participant,
  concessions: Concessions = {},
): number | null {
  const price = money(category.price);
  if (price === null) return null;
  if (category.team_size === 2 && category.price_basis === "per_team") return Math.round(price * 100);
  const own = playerShare(price, player, concessions).price;
  const perPlayerDoubles = category.team_size === 2;
  const dollars = perPlayerDoubles && paysForBoth ? own + playerShare(price, partner, concessions).price : own;
  return Math.round(dollars * 100);
}

export function cardCents(etransfer: number): number {
  return Math.round(etransfer * (1 + CARD_MARKUP));
}
