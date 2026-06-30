// supabase/functions/notify-court-allocated/index.ts
//
// Sends a court-allocation email to each player on a match. Triggered by
// the browser right after `allocateCourtForMatch` succeeds. Fire-and-forget
// from the client side.
//
// Required Supabase function secrets (set via `supabase secrets set ...`):
//   RESEND_API_KEY     - from resend.com dashboard
//   RESEND_FROM_EMAIL  - e.g. `Tournament <onboarding@resend.dev>` until a
//                        verified domain is added
//
// `onboarding@resend.dev` can only send to the Resend account owner during
// development. To deliver to real players, verify a domain in Resend and
// switch RESEND_FROM_EMAIL to e.g. `notify@yourdomain.com`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import webpush from "npm:web-push@3.6.7";

// Allowed browser origins: the production app + this project's Vercel domains
// (default + preview deploys). Anything else gets the prod origin echoed back,
// which the browser then blocks. CORS is a browser-only control — server-side
// callers ignore it — so the real protection is the requireAdmin gate below.
const ALLOWED_ORIGIN =
  /^https:\/\/(badminton\.adawar\.org|badminton-ad\.vercel\.app|vite-react-[a-z0-9-]+\.vercel\.app)$/;

const corsHeaders = {
  // Access-Control-Allow-Origin is overwritten per-request by the wrapper in Deno.serve.
  "Access-Control-Allow-Origin": "https://badminton.adawar.org",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Player = { id: string; name: string; email: string | null };
type Team = { id: string; p1_id: string; p2_id: string | null };

// Verify the caller is a tournament admin. `supabase.functions.invoke` from the
// admin client auto-attaches the logged-in user's access token as the
// Authorization header. We validate that token to resolve the user's email,
// then confirm membership in `tournament_admins` using the service-role client.
// (We can't reuse the SQL `is_admin()` here — the service-role client carries no
// JWT, so `auth.jwt()` would be empty.) Returns the admin email, or null.
async function requireAdmin(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user?.email) return null;
    const email = user.email.toLowerCase();
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data } = await admin
      .from("tournament_admins")
      .select("email")
      .eq("email", email)
      .maybeSingle();
    return data ? email : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const res = await handle(req);
  const origin = req.headers.get("Origin") ?? "";
  res.headers.set(
    "Access-Control-Allow-Origin",
    ALLOWED_ORIGIN.test(origin) ? origin : "https://badminton.adawar.org",
  );
  res.headers.set("Vary", "Origin");
  return res;
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Admin-only. This function emails + push-notifies every player on a match.
  // Match IDs are world-readable, so without this gate anyone with the public
  // anon key could enumerate them and spam players (and burn Resend/push quota).
  const adminEmail = await requireAdmin(req);
  if (!adminEmail) {
    return json({ error: "forbidden" }, 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const matchId: string | undefined = body?.match_id;
    if (!matchId) {
      return json({ error: "match_id required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Match
    const { data: match, error: matchErr } = await supabase
      .from("matches")
      .select("id, court_number, tournament_id, team_a_id, team_b_id")
      .eq("id", matchId)
      .single();
    if (matchErr || !match) {
      return json({ error: `match not found: ${matchErr?.message ?? "no row"}` }, 404);
    }

    // 2. Tournament name
    const { data: tournament } = await supabase
      .from("tournaments")
      .select("name")
      .eq("id", match.tournament_id)
      .single();
    const tournamentName: string = tournament?.name ?? "Tournament";

    // 3. Both teams (skip nulls — match may be a bye/incomplete)
    const teamIds: string[] = [match.team_a_id, match.team_b_id].filter(
      (v): v is string => typeof v === "string",
    );
    const { data: teamsRaw } = await supabase
      .from("teams")
      .select("id, p1_id, p2_id")
      .in("id", teamIds);
    const teams: Team[] = (teamsRaw ?? []) as Team[];
    const teamA = teams.find((t) => t.id === match.team_a_id) ?? null;
    const teamB = teams.find((t) => t.id === match.team_b_id) ?? null;

    // 4. All involved players
    const playerIds = new Set<string>();
    for (const t of [teamA, teamB]) {
      if (!t) continue;
      playerIds.add(t.p1_id);
      if (t.p2_id) playerIds.add(t.p2_id);
    }
    if (playerIds.size === 0) {
      return json({ sent: 0, skipped: 0, failed: 0, note: "no players on match" }, 200);
    }
    const { data: playersRaw } = await supabase
      .from("players")
      .select("id, name, email")
      .in("id", Array.from(playerIds));
    const players: Player[] = (playersRaw ?? []) as Player[];
    const playerById = new Map(players.map((p) => [p.id, p]));

    const teamLabel = (t: Team | null): string => {
      if (!t) return "TBD";
      const p1 = playerById.get(t.p1_id);
      const p2 = t.p2_id ? playerById.get(t.p2_id) : null;
      if (!p1) return "TBD";
      return p2 ? `${p1.name} & ${p2.name}` : p1.name;
    };

    // 5. Build recipient list (dedupe by player_id; same player on both teams
    //    is data noise but shouldn't double-send).
    type Recipient = { player: Player; opponentLabel: string };
    const recipients: Recipient[] = [];
    const seen = new Set<string>();
    const teamAOpponent = teamLabel(teamB);
    const teamBOpponent = teamLabel(teamA);
    for (const [team, opponentLabel] of [
      [teamA, teamAOpponent] as const,
      [teamB, teamBOpponent] as const,
    ]) {
      if (!team) continue;
      const pids: string[] = [team.p1_id, team.p2_id].filter(
        (v): v is string => typeof v === "string",
      );
      for (const pid of pids) {
        if (seen.has(pid)) continue;
        seen.add(pid);
        const p = playerById.get(pid);
        if (p) recipients.push({ player: p, opponentLabel });
      }
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
    const RESEND_FROM_EMAIL =
      Deno.env.get("RESEND_FROM_EMAIL") ?? "onboarding@resend.dev";
    const courtNumber = match.court_number ?? "?";

    let sent = 0, skipped = 0, failed = 0;

    for (const { player, opponentLabel } of recipients) {
      if (!player.email) {
        await supabase.from("notification_log").insert({
          match_id: matchId,
          player_id: player.id,
          channel: "email",
          status: "skipped",
          error_message: "no email on file",
        });
        skipped++;
        continue;
      }

      const subject = `🏸 Court ${courtNumber} is yours — ${tournamentName}`;
      const text =
`🏸 MATCH ALERT — Court ${courtNumber}

Hi ${player.name},

You're up next on Court ${courtNumber} for the ${tournamentName}.
Opponent: ${opponentLabel}

What's next:
  1. Head over to Court ${courtNumber}
  2. Warm up with your opponents
  3. The umpire starts the clock when everyone's ready

Good luck out there!
— Tournament Admin
`;
      const safePlayer = esc(player.name);
      const safeTournament = esc(tournamentName);
      const safeOpponent = esc(opponentLabel);
      const html =
`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Match Alert</title>
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef2f7;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.12);">

          <!-- HERO: gradient banner -->
          <tr>
            <td style="background:#3A86FF;background-image:linear-gradient(135deg,#3A86FF 0%,#8338EC 55%,#FF006E 100%);padding:34px 32px 28px;text-align:center;">
              <div style="font-size:50px;line-height:1;margin-bottom:8px;">🏸</div>
              <div style="color:#ffffff;opacity:0.9;font-size:11px;font-weight:800;letter-spacing:4px;text-transform:uppercase;">Match Alert</div>
              <div style="color:#ffffff;font-size:26px;font-weight:900;letter-spacing:-0.5px;margin-top:6px;">You're up next!</div>
            </td>
          </tr>

          <!-- COURT NUMBER: dark hero -->
          <tr>
            <td style="background:#0f172a;background-image:linear-gradient(180deg,#1e293b 0%,#0f172a 100%);padding:38px 32px 34px;text-align:center;">
              <div style="color:#94a3b8;font-size:11px;font-weight:800;letter-spacing:3px;text-transform:uppercase;margin-bottom:6px;">Your court</div>
              <div style="color:#fbbf24;font-size:96px;font-weight:900;line-height:0.95;letter-spacing:-4px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${courtNumber}</div>
              <div style="margin:14px auto 0;display:inline-block;background:rgba(251,191,36,0.15);color:#fbbf24;font-size:11px;font-weight:800;letter-spacing:2px;padding:6px 14px;border-radius:20px;">▶ HEAD THERE NOW</div>
            </td>
          </tr>

          <!-- GREETING -->
          <tr>
            <td style="padding:30px 32px 6px;">
              <div style="font-size:18px;color:#1a1a2e;font-weight:700;line-height:1.3;">Hey ${safePlayer},</div>
              <div style="font-size:14px;color:#475569;margin-top:6px;line-height:1.5;">Time to bring your A-game.</div>
            </td>
          </tr>

          <!-- OPPONENT CARD -->
          <tr>
            <td style="padding:18px 32px 6px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fef3c7;background-image:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);border-radius:14px;border-left:5px solid #f59e0b;">
                <tr>
                  <td style="padding:16px 20px;">
                    <div style="color:#92400e;font-size:10px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;">⚔️ Facing</div>
                    <div style="color:#1a1a2e;font-size:17px;font-weight:800;margin-top:4px;line-height:1.3;">${safeOpponent}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- STEPS -->
          <tr>
            <td style="padding:24px 32px 8px;">
              <div style="color:#475569;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px;">What's next</div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td valign="top" width="44" style="padding-bottom:12px;">
                    <div style="background:#3A86FF;color:#ffffff;width:30px;height:30px;border-radius:50%;text-align:center;line-height:30px;font-size:13px;font-weight:800;">1</div>
                  </td>
                  <td valign="middle" style="padding-bottom:12px;color:#1a1a2e;font-size:14px;line-height:1.4;">Head over to <strong style="color:#3A86FF;">Court ${courtNumber}</strong></td>
                </tr>
                <tr>
                  <td valign="top" width="44" style="padding-bottom:12px;">
                    <div style="background:#8338EC;color:#ffffff;width:30px;height:30px;border-radius:50%;text-align:center;line-height:30px;font-size:13px;font-weight:800;">2</div>
                  </td>
                  <td valign="middle" style="padding-bottom:12px;color:#1a1a2e;font-size:14px;line-height:1.4;">Warm up with your opponents</td>
                </tr>
                <tr>
                  <td valign="top" width="44">
                    <div style="background:#FF006E;color:#ffffff;width:30px;height:30px;border-radius:50%;text-align:center;line-height:30px;font-size:13px;font-weight:800;">3</div>
                  </td>
                  <td valign="middle" style="color:#1a1a2e;font-size:14px;line-height:1.4;">Umpire starts the clock when everyone's ready</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- PEP TALK -->
          <tr>
            <td style="padding:24px 32px 28px;text-align:center;">
              <div style="display:inline-block;background:#f1f5f9;color:#1a1a2e;font-size:13px;padding:11px 22px;border-radius:24px;font-weight:700;letter-spacing:0.3px;">
                🔥 Smash it out there!
              </div>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#1a1a2e;padding:22px 32px;text-align:center;">
              <div style="color:#fbbf24;font-size:11px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;line-height:1.3;">🏸 ${safeTournament}</div>
              <div style="color:#64748b;font-size:11px;margin-top:8px;letter-spacing:0.5px;">Sent automatically by Tournament Admin</div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

      try {
        if (!RESEND_API_KEY) {
          throw new Error("RESEND_API_KEY not configured");
        }
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: RESEND_FROM_EMAIL,
            to: [player.email],
            subject,
            text,
            html,
          }),
        });
        if (!resp.ok) {
          const respBody = await resp.text();
          throw new Error(`Resend ${resp.status}: ${respBody.slice(0, 300)}`);
        }
        await supabase.from("notification_log").insert({
          match_id: matchId,
          player_id: player.id,
          channel: "email",
          status: "sent",
        });
        sent++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("send failed for", player.email, msg);
        await supabase.from("notification_log").insert({
          match_id: matchId,
          player_id: player.id,
          channel: "email",
          status: "failed",
          error_message: msg.slice(0, 500),
        });
        failed++;
      }
    }

    // ========================================================================
    // PUSH FAN-OUT — best-effort parallel channel alongside email.
    // For every player on the match, look up active push_subscriptions and
    // send a Web Push notification. Each push is logged to notification_log
    // with channel='push'. Failures are caught per-sub so a single bad
    // endpoint doesn't take down the rest.
    // ========================================================================
    const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "";
    let pushSent = 0, pushFailed = 0;

    if (VAPID_PUBLIC && VAPID_PRIVATE && VAPID_SUBJECT && recipients.length > 0) {
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

      const recipientPlayerIds = recipients.map((r) => r.player.id);
      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth, player_id")
        .in("player_id", recipientPlayerIds);

      for (const sub of (subs ?? []) as Array<{
        id: string; endpoint: string; p256dh: string; auth: string; player_id: string;
      }>) {
        const recipient = recipients.find((r) => r.player.id === sub.player_id);
        if (!recipient) continue;
        const payload = JSON.stringify({
          title: `🏸 Court ${courtNumber} is yours`,
          body: `${tournamentName} — opponent: ${recipient.opponentLabel}`,
          url: "/",
          tag: `match-${matchId}`,
          requireInteraction: true,
        });
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
          await supabase.from("notification_log").insert({
            match_id: matchId,
            player_id: sub.player_id,
            channel: "push",
            status: "sent",
          });
          await supabase.from("push_subscriptions")
            .update({ last_used_at: new Date().toISOString(), last_error: null })
            .eq("id", sub.id);
          pushSent++;
        } catch (e) {
          const err = e as { statusCode?: number; body?: string; message?: string };
          const msg = `push ${err.statusCode ?? "?"}: ${err.body ?? err.message ?? String(e)}`;
          console.error("push failed for sub", sub.id, msg);
          await supabase.from("notification_log").insert({
            match_id: matchId,
            player_id: sub.player_id,
            channel: "push",
            status: "failed",
            error_message: msg.slice(0, 500),
          });
          await supabase.from("push_subscriptions")
            .update({ last_error: msg.slice(0, 500) })
            .eq("id", sub.id);
          // 404 / 410 = endpoint dead — clean it up so we don't keep trying.
          if (err.statusCode === 404 || err.statusCode === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          }
          pushFailed++;
        }
      }
    }

    return json({ sent, skipped, failed, pushSent, pushFailed }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("notify-court-allocated error:", msg);
    return json({ error: msg }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}
