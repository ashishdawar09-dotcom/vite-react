import type { Env, Snapshot } from "./types";

// Public tournament state via the anon key; the RPC filters out private fields.
export async function fetchSnapshot(env: Env, tournamentId: string): Promise<Snapshot> {
  const url = `${env.SUPABASE_URL}/rest/v1/rpc/live_snapshot`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ p_tournament_id: tournamentId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`live_snapshot ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as Partial<Snapshot> | null;
  return {
    tournament: data?.tournament ?? null,
    players: data?.players ?? [],
    teams: data?.teams ?? [],
    matches: data?.matches ?? [],
    categories: data?.categories ?? [],
    player_categories: data?.player_categories ?? [],
    generated_at: data?.generated_at ?? 0,
  };
}

export async function resolveTournamentIdBySlug(env: Env, slug: string): Promise<string | null> {
  const url = `${env.SUPABASE_URL}/rest/v1/tournaments?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as { id: string }[];
  return rows?.[0]?.id ?? null;
}
