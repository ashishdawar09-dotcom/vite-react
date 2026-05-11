import * as Sentry from "@sentry/react";
import { supabase } from "./supabase";
import type { Match, Player, Team } from "../types";

/**
 * Fire-and-forget call into the `notify-court-allocated` edge function. Used
 * right after `allocateCourtForMatch` succeeds. Never throws — any failure
 * becomes a Sentry breadcrumb plus a console.warn so the admin's UI flow is
 * never blocked by an email problem.
 */
export async function notifyCourtAllocated(matchId: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("notify-court-allocated", {
      body: { match_id: matchId },
    });
    if (error) throw error;
  } catch (e) {
    Sentry.addBreadcrumb({
      category: "notification",
      level: "warning",
      message: "notify-court-allocated failed",
      data: { matchId, error: String(e) },
    });
    console.warn("notify-court-allocated failed for", matchId, e);
  }
}

export type Recipient = { player_id: string; email: string };

/**
 * Pure helper — given a match and the rosters of both teams, return the
 * unique list of players that should receive an email. Mirrored (in spirit)
 * by the edge function; we keep this version here so it can be unit-tested
 * with Vitest. If you change the dedupe / filter rules in one place, update
 * the edge function too.
 */
export function pickRecipients(
  _match: Pick<Match, "team_a_id" | "team_b_id">,
  teamA: Team | null,
  teamB: Team | null,
  players: Player[],
): Recipient[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const team of [teamA, teamB]) {
    if (!team) continue;
    const pids = [team.p1_id, team.p2_id].filter(
      (v): v is string => typeof v === "string",
    );
    for (const pid of pids) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      const p = byId.get(pid);
      if (p && p.email) {
        out.push({ player_id: p.id, email: p.email });
      }
    }
  }
  return out;
}
