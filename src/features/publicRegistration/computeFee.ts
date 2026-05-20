import type { AgeBand, Category, TournamentFees } from "../../types";

export type PaymentSplit = "full" | "separate";

// Computes the dollar amount the submitter owes RIGHT NOW.
// - Singles: base fee for their (age_band, member) cell.
// - Doubles + 'separate' split: base fee (submitter pays own share only).
// - Doubles + 'full' split: 2× base fee (submitter pays for both).
// Returns null when the fee can't be resolved (missing age_band or missing
// entry in the tournament's fees table) — caller should render a friendly
// "Contact organizer" hint instead of NaN.
export function computeFee(
  fees: TournamentFees,
  category: Pick<Category, "age_band" | "team_size"> | null,
  isMember: boolean | null,
  paymentSplit: PaymentSplit = "separate",
): number | null {
  if (!category || !category.age_band || isMember === null) return null;
  const band: AgeBand = category.age_band;
  const cell = fees[band];
  if (!cell) return null;
  const base = isMember ? cell.member : cell.non_member;
  if (typeof base !== "number" || !Number.isFinite(base)) return null;
  if (category.team_size === 2 && paymentSplit === "full") {
    return base * 2;
  }
  return base;
}
