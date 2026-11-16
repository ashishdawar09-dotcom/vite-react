// Run: npx -y deno test supabase/functions/volunteer-desk/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  allowedOrigin, deskPathFromUrl, deskPhotoPath, isDeskKey, linkState, sha256Hex, shapePlayers,
} from "./desk.ts";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";

Deno.test("a desk key is exactly 43 URL-safe characters", () => {
  assertEquals(isDeskKey("A".repeat(43)), true);
  assertEquals(isDeskKey("aZ09_-".repeat(7) + "x"), true);
  assertEquals(isDeskKey("A".repeat(42)), false);
  assertEquals(isDeskKey("A".repeat(44)), false);
  assertEquals(isDeskKey("A".repeat(42) + "+"), false);
  assertEquals(isDeskKey("A".repeat(42) + "/"), false);
  assertEquals(isDeskKey(""), false);
  assertEquals(isDeskKey(null), false);
  assertEquals(isDeskKey(123), false);
  assertEquals(isDeskKey({ key: "A".repeat(43) }), false);
});

Deno.test("sha256Hex matches the known value", async () => {
  assertEquals(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

Deno.test("a link is live only inside its window", () => {
  const link = { valid_from: "2026-11-21T14:00:00Z", valid_until: "2026-11-22T05:00:00Z", revoked_at: null };
  assertEquals(linkState(link, new Date("2026-11-21T13:59:59Z")), "not_yet");
  assertEquals(linkState(link, new Date("2026-11-21T14:00:00Z")), "active");
  assertEquals(linkState(link, new Date("2026-11-22T04:59:59Z")), "active");
  assertEquals(linkState(link, new Date("2026-11-22T05:00:00Z")), "expired");
});

Deno.test("a switched-off link stays off, whatever the time", () => {
  const link = { valid_from: "2026-11-21T14:00:00Z", valid_until: "2026-11-22T05:00:00Z", revoked_at: "2026-11-21T15:00:00Z" };
  assertEquals(linkState(link, new Date("2026-11-21T13:00:00Z")), "revoked");
  assertEquals(linkState(link, new Date("2026-11-21T16:00:00Z")), "revoked");
  assertEquals(linkState(link, new Date("2026-11-23T00:00:00Z")), "revoked");
});

Deno.test("only the desk page and local dev are echoed as an allowed origin", () => {
  assertEquals(allowedOrigin("https://desk.adawar.org"), "https://desk.adawar.org");
  assertEquals(allowedOrigin("http://localhost:8811"), "http://localhost:8811");
  assertEquals(allowedOrigin("https://badminton.adawar.org"), "https://desk.adawar.org");
  assertEquals(allowedOrigin("https://desk.adawar.org.evil.example"), "https://desk.adawar.org");
  assertEquals(allowedOrigin("https://evil.example"), "https://desk.adawar.org");
  assertEquals(allowedOrigin("http://localhost.evil.example:80"), "https://desk.adawar.org");
  assertEquals(allowedOrigin(""), "https://desk.adawar.org");
  assertEquals(allowedOrigin("https://other.example", "https://other.example"), "https://other.example");
});

Deno.test("desk photos live under desk/<player>/", () => {
  assertEquals(deskPhotoPath(P1, "jpeg", 1795000000000), `desk/${P1}/1795000000000.jpg`);
  assertEquals(deskPhotoPath(P1, "png", 5), `desk/${P1}/5.png`);
  assertEquals(deskPhotoPath(P1, "webp", 5), `desk/${P1}/5.webp`);
});

Deno.test("only this player's own desk photo is recognised for deletion", () => {
  const base = "https://x.supabase.co/storage/v1/object/public/player-photos/";
  assertEquals(deskPathFromUrl(`${base}desk/${P1}/1795000000000.jpg`, P1), `desk/${P1}/1795000000000.jpg`);
  assertEquals(deskPathFromUrl(`${base}desk/${P1}/1795000000000.jpg?v=2`, P1), `desk/${P1}/1795000000000.jpg`);
  assertEquals(deskPathFromUrl(`${base}desk/${P2}/1795000000000.jpg`, P1), null); // another player's
  assertEquals(deskPathFromUrl(`${base}self/${P1}/1795000000000.jpg`, P1), null); // the player's own upload
  assertEquals(deskPathFromUrl(`${base}${P1}.jpg`, P1), null); // an admin upload
  assertEquals(deskPathFromUrl(`${base}desk/${P1}/../../self/x.jpg`, P1), null);
  assertEquals(deskPathFromUrl("https://evil.example/desk.jpg", P1), null);
  assertEquals(deskPathFromUrl(null, P1), null);
  assertEquals(deskPathFromUrl(undefined, P1), null);
});

Deno.test("the list shows events in order, with the doubles partner", () => {
  const players = [
    { id: P2, name: " Zed Young ", photo_url: null, checked_in_at: null },
    { id: P1, name: "amy Adams", photo_url: "https://x/p.jpg", checked_in_at: "2026-11-21T16:00:00Z" },
    { id: P3, name: "Bo Solo", photo_url: null, checked_in_at: null },
  ];
  const cats = [
    { id: "c-md", name: "Men's Doubles 18–34", sort_order: 2 },
    { id: "c-ms", name: "Men's Singles", sort_order: 1 },
    { id: "c-xd", name: "Mixed Doubles 18–34", sort_order: 3 },
  ];
  const memberships = [
    { player_id: P1, category_id: "c-md" },
    { player_id: P1, category_id: "c-ms" },
    { player_id: P2, category_id: "c-md" },
    { player_id: P3, category_id: "c-xd" }, // signed up alone, no team yet
    { player_id: P3, category_id: "c-gone" }, // a category of another tournament
  ];
  const teams = [
    { category_id: "c-md", p1_id: P1, p2_id: P2 },
    { category_id: "c-ms", p1_id: P1, p2_id: null },
  ];
  const out = shapePlayers(players, cats, memberships, teams);
  assertEquals(out.map((p) => p.name), ["amy Adams", "Bo Solo", "Zed Young"]);
  assertEquals(out[0], {
    id: P1, name: "amy Adams", photo_url: "https://x/p.jpg", checked_in_at: "2026-11-21T16:00:00Z",
    events: [{ name: "Men's Singles", partner: null }, { name: "Men's Doubles 18–34", partner: "Zed Young" }],
  });
  assertEquals(out[1].events, [{ name: "Mixed Doubles 18–34", partner: null }]);
  assertEquals(out[2].events, [{ name: "Men's Doubles 18–34", partner: "amy Adams" }]);
});

Deno.test("the list carries nothing but the five allowed fields", () => {
  const players = [{ id: P1, name: "Amy", photo_url: null, checked_in_at: null, email: "a@x.test", age: 12, note: "private" }];
  const out = shapePlayers(players, [], [], []);
  assertEquals(Object.keys(out[0]).sort(), ["checked_in_at", "events", "id", "name", "photo_url"]);
});

Deno.test("a team can add an event the membership rows miss, and a partner who left is not shown", () => {
  const players = [{ id: P1, name: "Amy", photo_url: null, checked_in_at: null }];
  const cats = [{ id: "c-wd", name: "Women's Doubles 35+", sort_order: null }];
  const out = shapePlayers(players, cats, [], [{ category_id: "c-wd", p1_id: P2, p2_id: P1 }]);
  assertEquals(out[0].events, [{ name: "Women's Doubles 35+", partner: null }]);
});
