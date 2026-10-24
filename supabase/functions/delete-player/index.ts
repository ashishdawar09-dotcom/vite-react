// supabase/functions/delete-player/index.ts
//
// Deletes a player only after a one-time code emailed to the owner.
//   { action: "request", player_id }        → emails a 6-digit code (10 min)
//   { action: "confirm", player_id, code }  → checks it, then deletes
// Both need an admin's token. Admins have no DELETE on players (RLS), so this
// is the only way to delete one.
//
// Secrets: RESEND_API_KEY, optional PLAYER_DELETE_EMAIL (defaults to the
// owner's address), and the platform's SUPABASE_* values.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { requireAdmin } from "../_shared/admin.ts";
import { esc } from "../_shared/emails.ts";
import { allow, isUuid, json, serveWithCors } from "../_shared/http.ts";
import { sendEmail } from "../_shared/mailer.ts";

const OWNER_EMAIL = Deno.env.get("PLAYER_DELETE_EMAIL") ?? "ashishdawar09@gmail.com";
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Hash ties the code to its player, so a code for one can't delete another.
const hashCode = (playerId: string, code: string) => sha256(`${playerId}:${code}`);

function newCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

// "a•••@gmail.com" — enough for the admin to know where to look.
function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}•••@${domain}`;
}

function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serveWithCors(handle);

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const adminEmail = await requireAdmin(req);
  if (!adminEmail) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const playerId: unknown = body?.player_id;
  if (!isUuid(playerId)) return json({ error: "player_id required" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: player } = await supabase.from("players").select("id, name").eq("id", playerId).maybeSingle();
  if (!player) return json({ error: "Player not found." }, 404);

  if (body.action === "request") {
    if (!(await allow(supabase, "player-delete-code", adminEmail, 5, 600))) {
      return json({ error: "Too many codes requested. Try again in a few minutes." }, 429);
    }
    const code = newCode();
    // A new code replaces any earlier unused one for this player.
    await supabase.from("player_delete_codes").update({ used_at: new Date().toISOString() })
      .eq("player_id", playerId).is("used_at", null);
    const { error } = await supabase.from("player_delete_codes").insert({
      player_id: playerId,
      code_hash: await hashCode(playerId, code),
      requested_by: adminEmail,
      expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
    });
    if (error) return json({ error: "Couldn't create a code." }, 500);

    const name = esc(player.name);
    const failed = await sendEmail({
      to: OWNER_EMAIL,
      fromName: "Badminton Admin",
      subject: `Code to delete ${player.name}: ${code}`,
      text: `${adminEmail} asked to delete the player "${player.name}".\n\nCode: ${code}\n\nIt expires in ${CODE_TTL_MINUTES} minutes. If you didn't ask for this, ignore this email; nothing is deleted without the code.`,
      html: `<p>${esc(adminEmail)} asked to delete the player <strong>${name}</strong>.</p>` +
        `<p style="font-size:28px;font-weight:800;letter-spacing:6px">${code}</p>` +
        `<p>It expires in ${CODE_TTL_MINUTES} minutes. If you didn't ask for this, ignore this email; nothing is deleted without the code.</p>`,
    });
    if (failed) {
      console.error("delete code email failed:", failed);
      return json({ error: "Couldn't send the code email." }, 502);
    }
    return json({ sent: true, to: maskEmail(OWNER_EMAIL), expires_minutes: CODE_TTL_MINUTES }, 200);
  }

  if (body.action === "confirm") {
    const code = typeof body.code === "string" ? body.code.replace(/\s/g, "") : "";
    if (!/^\d{6}$/.test(code)) return json({ error: "Enter the 6-digit code." }, 400);

    const { data: row } = await supabase.from("player_delete_codes")
      .select("id, code_hash, attempts, expires_at")
      .eq("player_id", playerId).is("used_at", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!row || new Date(row.expires_at) < new Date()) {
      return json({ error: "Code expired. Send a new one." }, 400);
    }
    if (row.attempts >= MAX_ATTEMPTS) return json({ error: "Too many wrong tries. Send a new code." }, 400);
    if (!sameHash(row.code_hash, await hashCode(playerId, code))) {
      await supabase.from("player_delete_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      return json({ error: "Wrong code." }, 400);
    }
    await supabase.from("player_delete_codes").update({ used_at: new Date().toISOString() }).eq("id", row.id);

    // Same rule the app showed before: never delete someone mid-match.
    const { data: teams } = await supabase.from("teams").select("id").or(`p1_id.eq.${playerId},p2_id.eq.${playerId}`);
    const teamIds = (teams ?? []).map((t) => t.id);
    if (teamIds.length) {
      const ids = teamIds.join(",");
      const { count } = await supabase.from("matches").select("id", { count: "exact", head: true })
        .eq("status", "live").or(`team_a_id.in.(${ids}),team_b_id.in.(${ids})`);
      if (count) return json({ error: `"${player.name}" is in a live match and can't be deleted right now.` }, 409);
    }

    // Teams, categories and push subscriptions cascade from the player row.
    const { error } = await supabase.from("players").delete().eq("id", playerId);
    if (error) return json({ error: "Delete failed." }, 500);
    console.log(`player ${playerId} (${player.name}) deleted by ${adminEmail}`);
    return json({ deleted: true }, 200);
  }

  return json({ error: "unknown action" }, 400);
}
