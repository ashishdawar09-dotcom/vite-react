// supabase/functions/volunteer-desk/index.ts
//
// Endpoint behind the game-day volunteer desk page (volunteer-desk/, served
// from its own site, not from the app). A volunteer is not an admin: their
// private link (desk_links, stored as a hash) is the only credential, and it
// allows exactly this, for that link's tournament only:
//
//   POST { action: "list", key }                                → the players (name, events, check-in, photo)
//   POST { action: "check_in", key, player_id }                 → sets players.checked_in_at
//   POST { action: "undo_check_in", key, player_id }            → clears it
//   POST { action: "photo", key, player_id, image, consent }    → stores the photo, sets players.photo_url
//   POST { action: "undo_photo", key, player_id }               → puts back the photo from before the desk photo
//   POST { action: "winners", key }                              → every event, its champions (if decided) and winners photo
//   POST { action: "winner_photo", key, category_id, image, consent } → stores that event's winners photo
//   POST { action: "remove_winner_photo", key, category_id }     → takes it off
//
// Every change is written to desk_actions with the volunteer's name. The app
// needs no change: it already reads these two player fields and follows
// changes to them live.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { allow, allowClient, isUuid, json } from "../_shared/http.ts";
import { CONTENT_TYPE, decodePhotoDataUrl, imageKind, MAX_PHOTO_BYTES } from "../_shared/photos.ts";
import { WINNERS_CONSENT_TEXT, winnersPathFromUrl, winnersPhotoPath } from "./champions.ts";
import { loadWinners } from "./winners_data.ts";
import {
  allowedOrigin, DEFAULT_DESK_ORIGIN, DESK_CONSENT_TEXT, type DeskLink, deskPathFromUrl, deskPhotoPath, isDeskKey, linkState,
  sha256Hex, shapePlayers,
} from "./desk.ts";

const BUCKET = "player-photos";
const BAD_LINK = "This link isn't valid. Please ask the organizer for a new one.";
const DESK_ORIGIN = Deno.env.get("DESK_ORIGIN") ?? DEFAULT_DESK_ORIGIN;

type Player = { id: string; name: string; photo_url: string | null; checked_in_at: string | null };

Deno.serve(async (req: Request) => {
  const res = req.method === "OPTIONS"
    ? new Response("ok", { status: 200 })
    : await handle(req).catch((e) => {
      console.error("volunteer-desk failed:", e instanceof Error ? e.message : e);
      return json({ success: false, error: "Something went wrong. Please try again." }, 500);
    });
  res.headers.set("Access-Control-Allow-Origin", allowedOrigin(req.headers.get("Origin") ?? "", DESK_ORIGIN));
  res.headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Vary", "Origin");
  res.headers.set("Cache-Control", "no-store");
  return res;
});

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ success: false, error: "POST only" }, 405);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Generous per connection: every volunteer shares the venue Wi-Fi, and each
  // page re-reads the list twice a minute. Links are 256-bit random, not guessable.
  if (!(await allowClient(supabase, req, "volunteer-desk", 3000, 600))) {
    return json({ success: false, error: "Too many requests. Please wait a minute and try again." }, 429);
  }

  const raw = await req.text();
  if (raw.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 2048) return json({ success: false, error: "That photo is too large. Please take it again." }, 413);
  let body: { action?: unknown; key?: unknown; player_id?: unknown; category_id?: unknown; image?: unknown; consent?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ success: false, error: "Invalid request" }, 400);
  }

  // A wrong link is tried only a few times from one connection.
  const badLink = async () => {
    if (!(await allowClient(supabase, req, "volunteer-desk-bad", 30, 600))) {
      return json({ success: false, error: "Too many tries. Please wait a few minutes and try again." }, 429);
    }
    return json({ success: false, code: "bad_link", error: BAD_LINK }, 403);
  };
  if (!isDeskKey(body.key)) return await badLink();
  const { data: link } = await supabase.from("desk_links")
    .select("id, tournament_id, label, valid_from, valid_until, revoked_at, last_used_at")
    .eq("token_hash", await sha256Hex(body.key)).maybeSingle();
  if (!link) return await badLink();

  const now = new Date();
  const state = linkState(link as DeskLink, now);
  if (state === "revoked") return json({ success: false, code: "revoked", error: "This link has been switched off. Please see the organizer." }, 403);
  if (state === "expired") return json({ success: false, code: "expired", error: "This link has ended. Thank you for helping today." }, 403);
  if (state === "not_yet") {
    return json({ success: false, code: "not_yet", starts_at: link.valid_from, error: "This link isn't open yet. It works on game day." }, 403);
  }
  const desk = link as DeskLink & { last_used_at: string | null };

  if (body.action === "list") {
    const [{ data: t }, { data: players, error: pErr }, { data: cats }, { data: teams }] = await Promise.all([
      supabase.from("tournaments").select("name, event_date").eq("id", desk.tournament_id).maybeSingle(),
      supabase.from("players").select("id, name, photo_url, checked_in_at").eq("tournament_id", desk.tournament_id).eq("active", true).limit(2000),
      supabase.from("categories").select("id, name, sort_order").eq("tournament_id", desk.tournament_id),
      supabase.from("teams").select("category_id, p1_id, p2_id").eq("tournament_id", desk.tournament_id).limit(2000),
    ]);
    if (pErr) return json({ success: false, error: "Couldn't load the players. Please try again." }, 500);
    const catIds = (cats ?? []).map((c) => c.id as string);
    const { data: memberships } = catIds.length
      ? await supabase.from("player_categories").select("player_id, category_id").in("category_id", catIds).limit(5000)
      : { data: [] };
    if (!desk.last_used_at) await supabase.from("desk_links").update({ last_used_at: now.toISOString() }).eq("id", desk.id);
    return json({
      success: true,
      volunteer: desk.label,
      tournament: { name: t?.name ?? "", event_date: t?.event_date ?? null },
      ends_at: desk.valid_until,
      consent_text: DESK_CONSENT_TEXT,
      players: shapePlayers(players ?? [], cats ?? [], memberships ?? [], teams ?? []),
    }, 200);
  }

  // ── Winners tab: one photo of the winners per event ────────────────────
  if (body.action === "winners") {
    return json({ success: true, volunteer: desk.label, consent_text: WINNERS_CONSENT_TEXT, events: await loadWinners(supabase, desk.tournament_id) }, 200);
  }
  if (body.action === "winner_photo" || body.action === "remove_winner_photo") {
    if (!isUuid(body.category_id)) return json({ success: false, error: "That event isn't on today's list. Please refresh." }, 404);
    const { data: cat } = await supabase.from("categories").select("id, name")
      .eq("id", body.category_id).eq("tournament_id", desk.tournament_id).maybeSingle();
    if (!cat) return json({ success: false, error: "That event isn't on today's list. Please refresh." }, 404);
    if (!(await allow(supabase, "volunteer-desk-photo", desk.id, 300, 3600))) {
      return json({ success: false, error: "That's a lot of photos in a short time. Please try again later." }, 429);
    }
    const { data: current } = await supabase.from("category_winner_photos").select("photo_url").eq("category_id", cat.id).maybeSingle();
    const oldUrl = (current?.photo_url as string | undefined) ?? null;
    const logWinners = async (action: string, extra: Record<string, unknown>) => {
      const { error } = await supabase.from("desk_actions").insert({
        link_id: desk.id, volunteer: desk.label, tournament_id: desk.tournament_id,
        category_id: cat.id, player_name: cat.name, action, ...extra,
      });
      if (error) console.error("desk log failed:", action, error.message);
    };
    const deleteOld = async () => {
      const old = winnersPathFromUrl(oldUrl, desk.tournament_id, cat.id as string);
      if (!old) return;
      const { error } = await supabase.storage.from(BUCKET).remove([old]);
      if (error) console.error("couldn't delete the old winners photo:", error.message);
    };

    if (body.action === "remove_winner_photo") {
      if (!oldUrl) return json({ success: true, already: true, photo_url: null }, 200);
      const { error } = await supabase.from("category_winner_photos").delete().eq("category_id", cat.id);
      if (error) return json({ success: false, error: "Couldn't remove the photo. Please try again." }, 500);
      await logWinners("remove_winner_photo", { prev_photo_url: oldUrl });
      await deleteOld();
      await supabase.from("desk_links").update({ last_used_at: now.toISOString() }).eq("id", desk.id);
      return json({ success: true, already: false, photo_url: null }, 200);
    }

    if (body.consent !== true) return json({ success: false, error: "Please tick the box to confirm everyone in the photo agreed." }, 400);
    const wBytes = decodePhotoDataUrl(body.image);
    const wKind = wBytes ? imageKind(wBytes) : null;
    if (!wBytes || !wKind) return json({ success: false, error: "That isn't a photo we can use. Please take it again." }, 400);
    const wPath = winnersPhotoPath(desk.tournament_id, cat.id as string, wKind === "jpeg" ? "jpg" : wKind, now.getTime());
    const wUp = await supabase.storage.from(BUCKET).upload(wPath, wBytes, { contentType: CONTENT_TYPE[wKind], cacheControl: "3600", upsert: false });
    if (wUp.error) return json({ success: false, error: "Couldn't save the photo. Please try again." }, 500);
    const { data: wPub } = supabase.storage.from(BUCKET).getPublicUrl(wPath);
    const { error: saveErr } = await supabase.from("category_winner_photos").upsert({
      category_id: cat.id, tournament_id: desk.tournament_id, photo_url: wPub.publicUrl,
      uploaded_by: desk.label, consent_text: WINNERS_CONSENT_TEXT, updated_at: now.toISOString(),
    }, { onConflict: "category_id" });
    if (saveErr) {
      await supabase.storage.from(BUCKET).remove([wPath]);
      return json({ success: false, error: "Couldn't save the photo. Please try again." }, 500);
    }
    await logWinners("winner_photo", { prev_photo_url: oldUrl, new_photo_url: wPub.publicUrl, consent_text: WINNERS_CONSENT_TEXT });
    await deleteOld();
    await supabase.from("desk_links").update({ last_used_at: now.toISOString() }).eq("id", desk.id);
    return json({ success: true, photo_url: wPub.publicUrl }, 200);
  }

  const actions = ["check_in", "undo_check_in", "photo", "undo_photo"];
  if (typeof body.action !== "string" || !actions.includes(body.action)) return json({ success: false, error: "Unknown action" }, 400);
  if (!isUuid(body.player_id)) return json({ success: false, error: "Unknown player" }, 404);
  const { data: found } = await supabase.from("players").select("id, name, photo_url, checked_in_at")
    .eq("id", body.player_id).eq("tournament_id", desk.tournament_id).eq("active", true).maybeSingle();
  if (!found) return json({ success: false, error: "That player isn't on today's list. Please refresh." }, 404);
  const player = found as Player;

  const log = async (action: string, extra: Record<string, unknown>) => {
    const { error } = await supabase.from("desk_actions").insert({
      link_id: desk.id, volunteer: desk.label, tournament_id: desk.tournament_id,
      player_id: player.id, player_name: player.name, action, ...extra,
    });
    if (error) console.error("desk log failed:", action, error.message);
  };
  const touch = () => supabase.from("desk_links").update({ last_used_at: now.toISOString() }).eq("id", desk.id);

  if (body.action === "check_in") {
    if (player.checked_in_at) return json({ success: true, already: true, checked_in_at: player.checked_in_at }, 200);
    // Only if still empty: two volunteers tapping the same player keep the first time.
    const { data: done, error } = await supabase.from("players").update({ checked_in_at: now.toISOString() })
      .eq("id", player.id).is("checked_in_at", null).select("checked_in_at");
    if (error) return json({ success: false, error: "Couldn't check them in. Please try again." }, 500);
    if (!done?.length) {
      const { data: again } = await supabase.from("players").select("checked_in_at").eq("id", player.id).maybeSingle();
      return json({ success: true, already: true, checked_in_at: again?.checked_in_at ?? null }, 200);
    }
    await log("check_in", {});
    await touch();
    return json({ success: true, already: false, checked_in_at: done[0].checked_in_at }, 200);
  }

  if (body.action === "undo_check_in") {
    if (!player.checked_in_at) return json({ success: true, already: true, checked_in_at: null }, 200);
    const { error } = await supabase.from("players").update({ checked_in_at: null }).eq("id", player.id);
    if (error) return json({ success: false, error: "Couldn't undo that. Please try again." }, 500);
    await log("undo_check_in", { prev_checked_in_at: player.checked_in_at });
    await touch();
    return json({ success: true, already: false, checked_in_at: null }, 200);
  }

  // Photos: a link can store a few hundred an hour, far above one desk's pace.
  if (!(await allow(supabase, "volunteer-desk-photo", desk.id, 300, 3600))) {
    return json({ success: false, error: "That's a lot of photos in a short time. Please try again later." }, 429);
  }

  if (body.action === "undo_photo") {
    const { data: last } = await supabase.from("desk_actions").select("id, prev_photo_url, new_photo_url")
      .eq("player_id", player.id).eq("action", "photo").order("id", { ascending: false }).limit(1).maybeSingle();
    if (!last || !last.new_photo_url || last.new_photo_url !== player.photo_url) {
      return json({ success: false, code: "nothing_to_undo", error: "There's no desk photo to undo for this player." }, 409);
    }
    const { error } = await supabase.from("players").update({ photo_url: last.prev_photo_url ?? null })
      .eq("id", player.id).eq("photo_url", last.new_photo_url);
    if (error) return json({ success: false, error: "Couldn't undo the photo. Please try again." }, 500);
    await log("undo_photo", { prev_photo_url: last.new_photo_url, new_photo_url: last.prev_photo_url ?? null });
    await deleteDeskPhoto(supabase, last.new_photo_url as string, player.id);
    await touch();
    return json({ success: true, photo_url: last.prev_photo_url ?? null }, 200);
  }

  // action === "photo"
  if (body.consent !== true) return json({ success: false, error: "Please tick the box to confirm the player agreed." }, 400);
  const bytes = decodePhotoDataUrl(body.image);
  const kind = bytes ? imageKind(bytes) : null;
  if (!bytes || !kind) return json({ success: false, error: "That isn't a photo we can use. Please take it again." }, 400);
  const path = deskPhotoPath(player.id, kind, now.getTime());
  const up = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: CONTENT_TYPE[kind], cacheControl: "3600", upsert: false });
  if (up.error) return json({ success: false, error: "Couldn't save the photo. Please try again." }, 500);
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const { error: setErr } = await supabase.from("players").update({ photo_url: pub.publicUrl }).eq("id", player.id);
  if (setErr) {
    await supabase.storage.from(BUCKET).remove([path]);
    return json({ success: false, error: "Couldn't save the photo. Please try again." }, 500);
  }
  // The photo it replaced is kept (file and address), so Undo can put it back.
  await log("photo", { prev_photo_url: player.photo_url ?? null, new_photo_url: pub.publicUrl, consent_text: DESK_CONSENT_TEXT });
  await touch();
  return json({ success: true, photo_url: pub.publicUrl }, 200);
}

/** Deletes a photo taken at the desk. A player's own upload or an admin's is never touched. */
async function deleteDeskPhoto(supabase: SupabaseClient, url: string, playerId: string) {
  const path = deskPathFromUrl(url, playerId);
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.error("couldn't delete the undone desk photo:", error.message);
}
