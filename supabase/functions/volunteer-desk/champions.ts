// supabase/functions/volunteer-desk/champions.ts
//
// Who won each event, worked out from the matches, for the desk's Winners
// tab and the public winners feed. No database here.
//
// It follows the app's own rule (src/features/publicSpectator/ResultsPage.tsx):
//   - an event with a knockout: the winner of the confirmed Final (last
//     round, first slot, not the bronze match);
//   - a round-robin-only event (one group, nobody advances): the group
//     winner once every match is confirmed.
// For the round robin this side is deliberately cautious: it names a
// champion only when one team has more wins than every other. Anything the
// app settles by point difference, head-to-head or a coin toss is left
// undecided here, so this can be late but never wrong.

export type ChampCategory = { id: string; name: string; sort_order: number | null; groups_count: number | null; top_n_advance: number | null };
export type ChampMatch = {
  category_id: string; stage: string; round_idx: number | null; slot_idx: number | null;
  team_a_id: string | null; team_b_id: string | null; winner_id: string | null;
  confirmed: boolean; is_bye?: boolean | null; is_bronze?: boolean | null;
};
export type ChampTeam = { id: string; p1_id: string | null; p2_id: string | null };
export type ChampPlayer = { id: string; name: string; photo_url: string | null };
export type WinnerPhoto = { category_id: string; photo_url: string; uploaded_by?: string | null; updated_at?: string | null };

export const isRoundRobinOnly = (c: Pick<ChampCategory, "groups_count" | "top_n_advance">) =>
  c.groups_count === 1 && (c.top_n_advance ?? 0) === 0;

/** The champion team of one event, or null while it is undecided. `matches` are that event's only. */
export function championTeamId(cat: ChampCategory, matches: ChampMatch[]): string | null {
  const ko = matches.filter((m) => m.stage === "knockout");
  if (ko.length > 0) {
    const maxRound = Math.max(...ko.map((m) => m.round_idx ?? 0));
    const final = ko.find((m) => (m.round_idx ?? 0) === maxRound && m.slot_idx === 0 && !m.is_bronze);
    return final?.confirmed && final.winner_id ? final.winner_id : null;
  }
  if (!isRoundRobinOnly(cat)) return null;
  const played = matches.filter((m) => m.stage === "group" && !m.is_bye);
  if (played.length === 0 || played.some((m) => !m.confirmed || !m.winner_id)) return null;
  const wins = new Map<string, number>();
  for (const m of played) {
    for (const t of [m.team_a_id, m.team_b_id]) if (t && !wins.has(t)) wins.set(t, 0);
    wins.set(m.winner_id!, (wins.get(m.winner_id!) ?? 0) + 1);
  }
  const ranked = [...wins.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  return ranked.length === 1 || ranked[0][1] > ranked[1][1] ? ranked[0][0] : null;
}

export type WinnersEvent = {
  id: string;
  name: string;
  /** The champion players (one for singles, two for doubles); empty while undecided. */
  champions: { id: string; name: string; photo_url: string | null }[];
  photo_url: string | null;
  photo_by: string | null;
  photo_at: string | null;
};

/** Every event in the app's order, with its champions (if decided) and winners photo (if uploaded). */
export function winnersEvents(
  categories: ChampCategory[], matches: ChampMatch[], teams: ChampTeam[], players: ChampPlayer[], photos: WinnerPhoto[],
): WinnersEvent[] {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const playerById = new Map(players.map((p) => [p.id, p]));
  const photoByCat = new Map(photos.map((p) => [p.category_id, p]));
  const byCat = new Map<string, ChampMatch[]>();
  for (const m of matches) byCat.set(m.category_id, [...(byCat.get(m.category_id) ?? []), m]);
  return [...categories]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
    .map((c) => {
      const team = teamById.get(championTeamId(c, byCat.get(c.id) ?? []) ?? "");
      const champions = team
        ? [team.p1_id, team.p2_id].map((id) => (id ? playerById.get(id) : undefined)).filter((p): p is ChampPlayer => !!p)
          .map((p) => ({ id: p.id, name: p.name.trim(), photo_url: p.photo_url ?? null }))
        : [];
      const photo = photoByCat.get(c.id);
      return { id: c.id, name: c.name, champions, photo_url: photo?.photo_url ?? null, photo_by: photo?.uploaded_by ?? null, photo_at: photo?.updated_at ?? null };
    });
}

/** Where a winners photo lives in the player-photos bucket. */
export function winnersPhotoPath(tournamentId: string, categoryId: string, ext: string, now: number): string {
  return `winners/${tournamentId}/${categoryId}/${now}.${ext}`;
}

/** The bucket path of a winners photo from its public URL (so a replaced or removed one can be deleted). Null for anything else. */
export function winnersPathFromUrl(url: string | null | undefined, tournamentId: string, categoryId: string): string | null {
  if (!url) return null;
  const m = /\/storage\/v1\/object\/public\/player-photos\/(winners\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/\d+\.(?:jpg|png|webp))(?:\?.*)?$/.exec(url);
  return m && m[2] === tournamentId && m[3] === categoryId ? m[1] : null;
}

/** What the volunteer ticks before a winners photo is stored. Saved with the photo. */
export const WINNERS_CONSENT_TEXT =
  "Everyone in this photo, or their parent or guardian if they're under 19, agreed at the desk that it can be shown in the Shuttle Storm live app and on the Shuttle Storm website.";
