// Age rules for categories. Mirrors src/features/publicRegistration/ageEligibility.ts,
// which shows the same message on the form; this copy is the one enforced.
//
// Ages are as of the tournament day. Junior (kid) events are 8–12 and youth
// (teen) events are for under-18s; younger players may still play up into an
// older category. Events named "50+" are for players aged 50 and over.
// A category's min_age (e.g. 35 for "Men's Doubles 35+") applies to every
// player in the entry, so a doubles pair qualifies only if both partners are
// old enough; there is no upper limit, and anyone may enter a younger band.

export type AgedCategory = { name: string; age_band?: string | null; min_age?: number | null };

const BANDS: Record<string, { min?: number; max?: number; label: string }> = {
  kid: { min: 8, max: 12, label: "8–12" },
  teen: { max: 17, label: "13–17" },
};

// Null when the age fits the category, otherwise a message for the player.
// `who` words the message for the partner's age in a doubles entry.
export function ageProblem(
  category: AgedCategory | null | undefined,
  age: number | null,
  who: "player" | "partner" = "player",
): string | null {
  if (!category || age === null) return null;
  if (category.min_age != null && age < category.min_age) {
    return who === "partner"
      ? `${category.name} is for players ${category.min_age} and over on tournament day, ` +
        `and both partners must be ${category.min_age}+. At ${age}, your partner is too young for it.`
      : `${category.name} is for players ${category.min_age} and over on tournament day.`;
  }
  if (/50\s*\+/.test(category.name) && age < 50) {
    return `${category.name} is for players aged 50 and over on tournament day.`;
  }
  const band = category.age_band ? BANDS[category.age_band] : undefined;
  if (!band) return null;
  if (band.max !== undefined && age > band.max) {
    return `${category.name} is for ages ${band.label} on tournament day. ` +
      `At ${age}, please choose ${age >= 18 ? "an adult" : "a youth"} category.`;
  }
  if (band.min !== undefined && age < band.min) {
    return `${category.name} is for ages ${band.label} on tournament day.`;
  }
  return null;
}
