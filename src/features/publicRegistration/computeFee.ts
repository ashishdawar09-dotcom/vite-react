import type { Category, PriceBasis } from "../../types";

export type PaymentSplit = "full" | "separate";

// Card payments cost 3% more than Interac e-Transfer. Presented as an
// e-Transfer discount, not a card surcharge. Must match
// supabase/functions/_shared/pricing.ts, which computes the actual charge.
export const CARD_MARKUP = 0.03;

export function cardAmount(etransfer: number): number {
  return Math.round(Math.round(etransfer * 100) * (1 + CARD_MARKUP)) / 100;
}

type Priced = Pick<Category, "team_size" | "price" | "price_basis">;

// Singles are always priced per player, whatever is stored.
export function priceBasis(category: Priced): PriceBasis {
  return category.team_size === 2 ? category.price_basis : "per_player";
}

function priceOf(category: Priced): number | null {
  if (category.price === null || category.price === undefined) return null;
  const n = Number(category.price);
  return Number.isFinite(n) ? n : null;
}

// Computes the dollar amount the submitter owes RIGHT NOW.
// - Singles, or doubles priced per team: the category price.
// - Doubles priced per player + 'separate': one player's share.
// - Doubles priced per player + 'full': both players' shares.
// Returns null when the category has no price set.
export function computeFee(category: Priced | null, paymentSplit: PaymentSplit = "separate"): number | null {
  if (!category) return null;
  const price = priceOf(category);
  if (price === null) return null;
  if (category.team_size === 2 && priceBasis(category) === "per_player" && paymentSplit === "full") {
    return price * 2;
  }
  return price;
}

export function fmtMoney(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

// Short label for pickers: "$25 per player", "$40 per team".
export function priceLabel(category: Priced): string | null {
  const price = priceOf(category);
  if (price === null) return null;
  return `${fmtMoney(price)} ${priceBasis(category) === "per_team" ? "per team" : "per player"}`;
}

// Full sentence shown once a category is picked, so per-player vs per-team
// can't be misread.
export function priceDescription(category: Priced): string | null {
  const price = priceOf(category);
  if (price === null) return null;
  if (category.team_size === 1) return `${fmtMoney(price)} per player.`;
  if (priceBasis(category) === "per_team") {
    return `${fmtMoney(price)} per team. One payment covers both players.`;
  }
  return `${fmtMoney(price)} per player (${fmtMoney(price * 2)} for the team). Each player pays their own share unless you pay for both below.`;
}
