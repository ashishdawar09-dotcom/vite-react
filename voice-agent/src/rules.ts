import type { Category, Snapshot } from "./types";

export function groupLetter(idx: number): string {
  return String.fromCharCode(65 + idx);
}

// Groups actually generated can differ from the configured groups_count.
function observedGroupCount(snap: Snapshot, categoryId: string): number {
  const idxs = new Set<number>();
  for (const m of snap.matches) {
    if (m.category_id === categoryId && m.stage === "group" && m.group_idx != null) {
      idxs.add(m.group_idx);
    }
  }
  return idxs.size;
}

function describeCategory(snap: Snapshot, cat: Category): string {
  const kind = cat.team_size === 1 ? "singles" : "doubles (teams of two)";
  const parts = [`${cat.name}: ${kind}, ${cat.match_minutes}-minute matches`];
  if (cat.age_band) parts.push(`${cat.age_band} age band`);
  const groups = observedGroupCount(snap, cat.id) || cat.groups_count;
  if (cat.phase === "knockout") {
    parts.push("currently in the knockout stage");
  } else if (groups > 0) {
    const advance =
      cat.top_n_advance > 0 ? `top ${cat.top_n_advance} of each group advance` : "top teams of each group advance";
    const letters = Array.from({ length: groups }, (_, i) => groupLetter(i)).join(", ");
    parts.push(`${groups} group${groups > 1 ? "s" : ""} (${letters}), then a knockout bracket; ${advance}`);
  } else {
    parts.push("group stage then a knockout bracket");
  }
  if (cat.has_bronze_match) parts.push("with a third-place playoff");
  return parts.join(", ") + ".";
}

const STATIC_RULES = [
  "Scoring in the group stage: 3 points for a win, 0 for a loss — there are no draws.",
  "Group standings are ranked by total points; ties are broken first by point differential (points scored minus points conceded), then by total points scored.",
  "A bye counts as no match played and does not affect standings. A walkover awards the win to the present team.",
  "Match flow: a match is queued, then a court is allocated and the teams warm up, then scoring begins, and finally the result is confirmed.",
  "After the group stage, the top teams from each group advance to a single-elimination knockout bracket to decide the winner.",
].join(" ");

function buildRules(snap: Snapshot): string {
  const cats = [...snap.categories].sort((a, b) => a.sort_order - b.sort_order);
  const catLines = cats.map((c) => describeCategory(snap, c)).join(" ");
  const name = snap.tournament?.name ?? "this tournament";
  const courts = snap.tournament?.num_courts ? ` It runs on ${snap.tournament.num_courts} courts.` : "";
  return `${name} categories: ${catLines} ${STATIC_RULES}${courts}`;
}

export function buildRulesForTopic(snap: Snapshot, topic?: string): string {
  if (topic) {
    const t = topic.toLowerCase();
    const match = snap.categories.find(
      (c) => c.name.toLowerCase().includes(t) || t.includes(c.name.toLowerCase()),
    );
    if (match) {
      return `${describeCategory(snap, match)} ${STATIC_RULES}`;
    }
  }
  return buildRules(snap);
}
