// Age rules for categories, shown on the form. Mirrors
// supabase/functions/_shared/ages.ts, which register-player enforces.
//
// Ages are as of the tournament day. Junior (kid) events are 8–12 and youth
// (teen) events are for under-18s; younger players may still play up into an
// older category. Events named "50+" are for players aged 50 and over.

export type AgedCategory = { name: string; age_band?: string | null };

const BANDS: Record<string, { min?: number; max?: number; label: string }> = {
  kid: { min: 8, max: 12, label: "8–12" },
  teen: { max: 17, label: "13–17" },
};

// Null when the age fits the category, otherwise a message for the player.
export function ageProblem(category: AgedCategory | null | undefined, age: number | null): string | null {
  if (!category || age === null) return null;
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
