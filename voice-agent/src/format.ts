import type { Snapshot } from "./types";

export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Spoken team name: the players' names when known, else the team label.
export function teamName(snap: Snapshot, teamId: string | null | undefined): string {
  if (!teamId) return "TBD";
  const t = snap.teams.find((x) => x.id === teamId);
  if (!t) return "TBD";
  const p1 = snap.players.find((p) => p.id === t.p1_id)?.name;
  const p2 = t.p2_id ? snap.players.find((p) => p.id === t.p2_id)?.name : null;
  if (p1 && p2) return `${p1} & ${p2}`;
  if (p1) return p1;
  return t.name;
}

// Words of a category name or spoken query. Apostrophes are dropped so
// "women's" becomes one word that "men's" can never match inside, plurals are
// folded ("doubles" = "double"), and age bands become "18", "34" / "35+".
const FILLER = new Set(["to", "the", "category", "division", "event"]);
function categoryWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/\b(and (over|up|older)|plus)\b/g, "+")
    .replace(/(\d)\s*\+/g, "$1+")
    .split(/[^a-z0-9+]+/)
    .filter((w) => w && !FILLER.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
}

function containsRun(words: string[], run: string[]): boolean {
  if (!run.length || run.length > words.length) return false;
  for (let i = 0; i + run.length <= words.length; i++) {
    if (run.every((w, j) => words[i + j] === w)) return true;
  }
  return false;
}

// Categories a spoken name refers to, best tier first: the exact name; names
// containing the query as consecutive whole words ("men's doubles" → both
// "Men's Doubles 18–34" and "Men's Doubles 35+"); names containing every query
// word; names said in full inside a longer query. Empty when nothing matches.
export function matchCategories<C extends { name: string }>(categories: C[], query: string): C[] {
  const q = categoryWords(query);
  if (!q.length) return [];
  const named = categories.map((c) => ({ c, w: categoryWords(c.name) }));
  const tiers: ((w: string[]) => boolean)[] = [
    (w) => w.length === q.length && containsRun(w, q),
    (w) => containsRun(w, q),
    (w) => q.every((x) => w.includes(x)),
  ];
  for (const test of tiers) {
    const hit = named.filter((n) => test(n.w));
    if (hit.length) return hit.map((n) => n.c);
  }
  const inside = named.filter((n) => containsRun(q, n.w));
  const longest = Math.max(0, ...inside.map((n) => n.w.length));
  return inside.filter((n) => n.w.length === longest).map((n) => n.c);
}
