// Server-side registration pricing. Mirrors src/features/publicRegistration/
// computeFee.ts; the amount charged by card is always computed here from the
// category row, never taken from the request.

// Card payments cost 3% more than Interac e-Transfer (presented to players as
// an e-Transfer discount, not a card surcharge).
export const CARD_MARKUP = 0.03;

export type PricedCategory = {
  team_size: number;
  price: number | string | null;
  price_basis: "per_player" | "per_team" | string;
};

// Amount owed by e-Transfer, in cents, or null when the category has no price.
// Doubles priced per player cost twice the price when one player pays for both.
export function etransferCents(category: PricedCategory, paysForBoth: boolean): number | null {
  if (category.price === null || category.price === undefined) return null;
  const price = Number(category.price);
  if (!Number.isFinite(price) || price < 0) return null;
  const perPlayer = category.team_size === 2 && category.price_basis === "per_player";
  const dollars = perPlayer && paysForBoth ? price * 2 : price;
  return Math.round(dollars * 100);
}

export function cardCents(etransfer: number): number {
  return Math.round(etransfer * (1 + CARD_MARKUP));
}
