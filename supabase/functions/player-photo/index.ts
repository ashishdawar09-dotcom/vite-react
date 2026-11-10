// supabase/functions/player-photo/index.ts
//
// Public endpoint behind /photo/<token>: a player (or their parent) adds,
// replaces or removes the photo on their own player profile. The photo
// shows on /p/<player>, in the live app and on the hall TV's player cards.
// The token (player_photo_links.token, emailed by the photo invite) is the
// only credential, so responses carry no more than that one player needs.
//
//   POST { action: "get", token }                     → first name, tournament, current photo
//   POST { action: "upload", token, image, consent }   → stores the photo, sets players.photo_url
//   POST { action: "remove", token }                  → takes the photo off the profile
//
// The page shrinks the picture to a JPEG on the phone (which also drops its
// location data); here the bytes are checked again before anything is kept.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { allow, allowClient, isUuid, json, serveWithCors } from "../_shared/http.ts";
import {
  CONTENT_TYPE, decodePhotoDataUrl, firstName, imageKind, MAX_PHOTO_BYTES, PHOTO_CONSENT_TEXT, selfPathFromUrl, selfPhotoPath,
} from "../_shared/photos.ts";

const BUCKET = "player-photos";
const BAD_LINK = "This link isn't valid. Please ask the organizers for a new one.";

serveWithCors(async (req: Request) => {
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Generous per connection: on game day many players share the venue Wi-Fi. Links are random
  // UUIDs (not guessable), and each link has its own limit below.
  if (!(await allowClient(supabase, req, "player-photo", 120, 600))) {
    return json({ success: false, error: "Too many tries. Please wait a few minutes and try again." }, 429);
  }

  const raw = await req.text();
  if (raw.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 2048) return json({ success: false, error: "That photo is too large. Please choose a smaller one." }, 413);
  let body: { action?: unknown; token?: unknown; image?: unknown; consent?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ success: false, error: "Invalid request" }, 400);
  }
  if (!isUuid(body.token)) return json({ success: false, error: BAD_LINK }, 404);

  const { data: link } = await supabase.from("player_photo_links").select("player_id").eq("token", body.token).maybeSingle();
  if (!link) return json({ success: false, error: BAD_LINK }, 404);
  const { data: player } = await supabase.from("players")
    .select("id, name, photo_url, active, tournament_id").eq("id", link.player_id).maybeSingle();
  if (!player || !player.active) return json({ success: false, error: BAD_LINK }, 404);
  const { data: t } = await supabase.from("tournaments").select("name, event_date").eq("id", player.tournament_id).maybeSingle();

  if (body.action === "get") {
    return json({
      success: true,
      first_name: firstName(player.name as string),
      name: (player.name as string).trim(),
      tournament: { name: t?.name ?? "", event_date: t?.event_date ?? null },
      photo_url: player.photo_url ?? null,
      consent_text: PHOTO_CONSENT_TEXT,
      profile_path: `/p/${player.id}`,
    }, 200);
  }

  if (body.action !== "upload" && body.action !== "remove") return json({ success: false, error: "Unknown action" }, 400);
  // A link can change its photo a handful of times an hour, whoever has it.
  if (!(await allow(supabase, "player-photo-link", String(body.token), 8, 3600))) {
    return json({ success: false, error: "That's a lot of changes in a short time. Please try again in an hour." }, 429);
  }
  const now = new Date();

  if (body.action === "remove") {
    const { error } = await supabase.from("players").update({ photo_url: null }).eq("id", player.id);
    if (error) return json({ success: false, error: "Couldn't remove the photo. Please try again." }, 500);
    await supabase.from("player_photo_links").update({ removed_at: now.toISOString() }).eq("player_id", player.id);
    await deleteOwn(supabase, player.photo_url as string | null, player.id as string);
    return json({ success: true, photo_url: null }, 200);
  }

  if (body.consent !== true) return json({ success: false, error: "Please tick the box to agree before uploading." }, 400);
  const bytes = decodePhotoDataUrl(body.image);
  const kind = bytes ? imageKind(bytes) : null;
  if (!bytes || !kind) return json({ success: false, error: "That file isn't a photo we can use. Please choose a JPEG or PNG photo." }, 400);

  const path = selfPhotoPath(player.id as string, kind, now.getTime());
  const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: CONTENT_TYPE[kind], cacheControl: "3600", upsert: false }); // an hour: a removed photo leaves the CDN soon
  if (up.error) return json({ success: false, error: "Couldn't save the photo. Please try again." }, 500);
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const { error: setErr } = await supabase.from("players").update({ photo_url: pub.publicUrl }).eq("id", player.id);
  if (setErr) {
    await supabase.storage.from(BUCKET).remove([path]);
    return json({ success: false, error: "Couldn't save the photo. Please try again." }, 500);
  }
  const { data: prev } = await supabase.from("player_photo_links").select("uploads").eq("player_id", player.id).maybeSingle();
  await supabase.from("player_photo_links").update({
    uploaded_at: now.toISOString(),
    uploads: ((prev?.uploads as number | undefined) ?? 0) + 1,
    consent_at: now.toISOString(),
    consent_text: PHOTO_CONSENT_TEXT,
    removed_at: null,
  }).eq("player_id", player.id);
  await deleteOwn(supabase, player.photo_url as string | null, player.id as string);
  return json({ success: true, photo_url: pub.publicUrl }, 200);
});

/** Deletes the player's previous self-added photo file. An admin's upload is never touched. */
async function deleteOwn(supabase: SupabaseClient, oldUrl: string | null, playerId: string) {
  const old = selfPathFromUrl(oldUrl, playerId);
  if (!old) return;
  const { error } = await supabase.storage.from(BUCKET).remove([old]);
  if (error) console.error("couldn't delete the old photo:", error.message);
}
