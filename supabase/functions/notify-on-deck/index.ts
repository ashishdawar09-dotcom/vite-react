// supabase/functions/notify-on-deck/index.ts
//
// "You're up soon": emails and push-notifies the players of a match that is
// about to be called, so they're close to the courts when it is. The admin
// app calls it (src/hooks/useOnDeckAlerts.ts) when a match reaches the front
// of Up next with its court call close; fire and forget.
//
// Once per match: the match is claimed in on_deck_alerts before anything is
// sent, so a second admin device or a retry sends nothing. Nothing is sent
// when the tournament has the alerts off (race_day_settings.on_deck_alerts),
// when the match has already been called, played or is a bye, or when one of
// its players is sitting out (the match becomes a walkover). No WhatsApp: the
// court call itself still goes there.
//
// Secrets: as notify-court-allocated (RESEND_API_KEY, RESEND_FROM_EMAIL,
// VAPID_*).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import webpush from "npm:web-push@3.6.7";
import { requireAdmin } from "../_shared/admin.ts";
import { isUuid, json, serveWithCors } from "../_shared/http.ts";
import { sendEmailDetailed } from "../_shared/mailer.ts";
import { onDeckEmail, onDeckKey, onDeckPush, parseExpected, stageName } from "../_shared/on_deck.ts";

type Player = { id: string; name: string; email: string | null; active: boolean };
type Team = { id: string; p1_id: string; p2_id: string | null };

serveWithCors(handle);

async function handle(req: Request): Promise<Response> {
  // Admin only, like the court call: match ids are public, so without this
  // anyone could make the function email players.
  if (!(await requireAdmin(req))) return json({ error: "forbidden" }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    const matchId: unknown = body?.match_id;
    if (!isUuid(matchId)) return json({ error: "match_id required" }, 400);
    const expectedAt = parseExpected(body?.expected_at, Date.now());

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: match, error: matchErr } = await supabase
      .from("matches")
      .select("id, tournament_id, category_id, stage, group_idx, round_idx, is_bronze, is_bye, status, confirmed, court_allocated_at, team_a_id, team_b_id")
      .eq("id", matchId)
      .maybeSingle();
    if (matchErr) throw new Error(matchErr.message);
    if (!match) return json({ error: "match not found" }, 404);
    if (match.status !== "pending" || match.confirmed || match.is_bye || match.court_allocated_at || !match.team_a_id || !match.team_b_id) {
      return json({ skipped: "not waiting for a court call" }, 200);
    }

    const { data: settings } = await supabase
      .from("race_day_settings")
      .select("on_deck_alerts")
      .eq("tournament_id", match.tournament_id)
      .maybeSingle();
    if (settings?.on_deck_alerts === false) return json({ skipped: "alerts are off" }, 200);

    const { data: teamsRaw } = await supabase.from("teams").select("id, p1_id, p2_id").in("id", [match.team_a_id, match.team_b_id]);
    const teams = (teamsRaw ?? []) as Team[];
    const teamA = teams.find((t) => t.id === match.team_a_id) ?? null;
    const teamB = teams.find((t) => t.id === match.team_b_id) ?? null;
    const ids = [...new Set([teamA, teamB].flatMap((t) => (t ? [t.p1_id, t.p2_id] : [])).filter((v): v is string => !!v))];
    if (ids.length === 0) return json({ skipped: "no players on the match" }, 200);
    const { data: playersRaw } = await supabase.from("players").select("id, name, email, active").in("id", ids);
    const players = (playersRaw ?? []) as Player[];
    if (players.some((p) => p.active === false)) return json({ skipped: "a player is sitting out" }, 200);
    const byId = new Map(players.map((p) => [p.id, p]));

    // Claim the match first: only one device's call ever sends.
    const { error: claimErr } = await supabase
      .from("on_deck_alerts")
      .insert({ match_id: matchId, tournament_id: match.tournament_id, expected_at: expectedAt ? new Date(expectedAt).toISOString() : null });
    if (claimErr) {
      if (claimErr.code === "23505") return json({ skipped: "already sent" }, 200);
      throw new Error(claimErr.message);
    }

    const [{ data: tournament }, { data: category }, { data: rounds }] = await Promise.all([
      supabase.from("tournaments").select("name, reply_to_email").eq("id", match.tournament_id).single(),
      supabase.from("categories").select("name").eq("id", match.category_id).single(),
      supabase.from("matches").select("round_idx").eq("category_id", match.category_id).eq("stage", "knockout").eq("is_bronze", false),
    ]);
    const lastRound = (rounds ?? []).reduce((mx: number | null, r: { round_idx: number | null }) => Math.max(mx ?? 0, r.round_idx ?? 0), null);
    const tournamentName: string = tournament?.name ?? "Tournament";
    const replyTo: string | null = tournament?.reply_to_email?.trim() || null;
    const label = (t: Team | null) => {
      if (!t) return "TBD";
      const p1 = byId.get(t.p1_id)?.name ?? "TBD";
      const p2 = t.p2_id ? byId.get(t.p2_id)?.name : null;
      return p2 ? `${p1} & ${p2}` : p1;
    };

    type Recipient = { player: Player; opponent: string };
    const recipients: Recipient[] = [];
    const seen = new Set<string>();
    for (const [team, opponent] of [[teamA, label(teamB)], [teamB, label(teamA)]] as const) {
      for (const pid of team ? [team.p1_id, team.p2_id] : []) {
        if (!pid || seen.has(pid)) continue;
        seen.add(pid);
        const p = byId.get(pid);
        if (p) recipients.push({ player: p, opponent });
      }
    }

    const base = {
      tournament: tournamentName,
      event: category?.name ?? "Your event",
      stage: stageName(match, lastRound),
      expectedAt,
      replyTo: !!replyTo,
    };
    const from = Deno.env.get("RESEND_FROM_EMAIL") ?? null;
    let emailed = 0, emailFailed = 0, noEmail = 0, pushed = 0, pushFailed = 0;

    for (const { player, opponent } of recipients) {
      if (!player.email) { noEmail++; continue; }
      const mail = onDeckEmail({ ...base, player: player.name, opponent });
      const result = await sendEmailDetailed(
        { to: player.email, subject: mail.subject, text: mail.text, html: mail.html, fromName: tournamentName, replyTo },
        { from, idempotencyKey: onDeckKey(matchId, player.id), tags: [{ name: "app", value: "badminton" }, { name: "kind", value: "on_deck" }] },
      );
      if (result.error) {
        console.error("on-deck email failed for player", player.id, result.error);
        emailFailed++;
      } else {
        emailed++;
      }
    }

    const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "";
    if (VAPID_PUBLIC && VAPID_PRIVATE && VAPID_SUBJECT && recipients.length > 0) {
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth, player_id")
        .in("player_id", recipients.map((r) => r.player.id));
      for (const sub of (subs ?? []) as Array<{ id: string; endpoint: string; p256dh: string; auth: string; player_id: string }>) {
        const r = recipients.find((x) => x.player.id === sub.player_id);
        if (!r) continue;
        const push = onDeckPush({ ...base, player: r.player.name, opponent: r.opponent });
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: push.title, body: push.body, url: "/", tag: `on-deck-${matchId}` }),
          );
          await supabase.from("push_subscriptions").update({ last_used_at: new Date().toISOString(), last_error: null }).eq("id", sub.id);
          pushed++;
        } catch (e) {
          const err = e as { statusCode?: number; body?: string; message?: string };
          const msg = `push ${err.statusCode ?? "?"}: ${err.body ?? err.message ?? String(e)}`.slice(0, 500);
          console.error("on-deck push failed for sub", sub.id, msg);
          await supabase.from("push_subscriptions").update({ last_error: msg }).eq("id", sub.id);
          // 404 / 410: the phone dropped the subscription; stop trying it.
          if (err.statusCode === 404 || err.statusCode === 410) await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          pushFailed++;
        }
      }
    }

    await supabase
      .from("on_deck_alerts")
      .update({ emailed, email_failed: emailFailed, no_email: noEmail, pushed, push_failed: pushFailed })
      .eq("match_id", matchId);

    return json({ emailed, email_failed: emailFailed, no_email: noEmail, pushed, push_failed: pushFailed }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("notify-on-deck error:", msg);
    return json({ error: msg }, 500);
  }
}
