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
