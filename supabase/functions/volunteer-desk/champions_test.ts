// Run: npx -y deno test supabase/functions/volunteer-desk/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type ChampMatch, championTeamId, winnersEvents, winnersPathFromUrl, winnersPhotoPath } from "./champions.ts";

const KO = { id: "c-ko", name: "Men's Doubles 18–34", sort_order: 2, groups_count: 4, top_n_advance: 2 };
const RR = { id: "c-rr", name: "Youth Girls' Singles", sort_order: 1, groups_count: 1, top_n_advance: 0 };
const m = (over: Partial<ChampMatch>): ChampMatch => ({
  category_id: "c-ko", stage: "knockout", round_idx: 0, slot_idx: 0, team_a_id: "A", team_b_id: "B", winner_id: null, confirmed: false, is_bye: false, is_bronze: false, ...over,
});
const g = (a: string, b: string, winner: string | null, confirmed = true): ChampMatch =>
  m({ category_id: "c-rr", stage: "group", round_idx: null, team_a_id: a, team_b_id: b, winner_id: winner, confirmed });

Deno.test("knockout: no champion until the Final itself is confirmed", () => {
  const bracket = [
    m({ round_idx: 0, slot_idx: 0, winner_id: "A", confirmed: true }), // a semi-final, finished
    m({ round_idx: 0, slot_idx: 1, team_a_id: "C", team_b_id: "D", winner_id: "C", confirmed: true }),
    m({ round_idx: 1, slot_idx: 0, team_a_id: "A", team_b_id: "C" }), // the Final, not played
  ];
  assertEquals(championTeamId(KO, bracket), null);
  bracket[2] = m({ round_idx: 1, slot_idx: 0, team_a_id: "A", team_b_id: "C", winner_id: "C", confirmed: false });
  assertEquals(championTeamId(KO, bracket), null); // score entered but not confirmed
  bracket[2] = m({ round_idx: 1, slot_idx: 0, team_a_id: "A", team_b_id: "C", winner_id: "C", confirmed: true });
  assertEquals(championTeamId(KO, bracket), "C");
});

Deno.test("knockout: the bronze match never decides the champion", () => {
  const bracket = [
    m({ round_idx: 1, slot_idx: 0, team_a_id: "A", team_b_id: "C" }),
    m({ round_idx: 1, slot_idx: 1, team_a_id: "B", team_b_id: "D", winner_id: "B", confirmed: true, is_bronze: true }),
    m({ round_idx: 1, slot_idx: 0, team_a_id: "B", team_b_id: "D", winner_id: "D", confirmed: true, is_bronze: true }), // even in slot 0
  ];
  assertEquals(championTeamId(KO, bracket), null);
});

Deno.test("knockout: group results are ignored once a knockout exists", () => {
  const all = [g("A", "B", "A"), m({ category_id: "c-ko", round_idx: 0, slot_idx: 0 })];
  assertEquals(championTeamId(KO, all.map((x) => ({ ...x, category_id: "c-ko" }))), null);
});

Deno.test("an event with groups and no knockout yet has no champion", () => {
  assertEquals(championTeamId(KO, [m({ stage: "group", round_idx: null, winner_id: "A", confirmed: true })]), null);
  assertEquals(championTeamId(KO, []), null);
});

Deno.test("round robin only: the clear winner, once every match is confirmed", () => {
  assertEquals(championTeamId(RR, [g("A", "B", "A")]), "A"); // two players, one match
  assertEquals(championTeamId(RR, [g("A", "B", "A"), g("A", "C", "A"), g("B", "C", "B")]), "A");
  assertEquals(championTeamId(RR, [g("A", "B", "A"), g("A", "C", "A"), g("B", "C", null, false)]), null); // one still to play
  assertEquals(championTeamId(RR, [g("A", "B", "A"), g("A", "C", "A"), g("B", "C", "B", false)]), null); // not confirmed
  assertEquals(championTeamId(RR, []), null);
});

Deno.test("round robin only: a tie on wins is left undecided (the app's tie rules decide it)", () => {
  assertEquals(championTeamId(RR, [g("A", "B", "A"), g("B", "C", "B"), g("C", "A", "C")]), null); // 1 win each
  assertEquals(championTeamId(RR, [g("A", "B", "A"), g("C", "D", "C"), g("A", "C", "A"), g("B", "D", "D"), g("A", "D", "D"), g("B", "C", "C")]), null); // A, C, D on 2
});

Deno.test("round robin only: byes don't count as matches", () => {
  assertEquals(championTeamId(RR, [g("A", "B", "B"), { ...g("A", null as unknown as string, "A"), is_bye: true }]), "B");
});

Deno.test("round robin only with a knockout started anyway follows the knockout", () => {
  const all = [g("A", "B", "A"), m({ category_id: "c-rr", round_idx: 0, slot_idx: 0, team_a_id: "A", team_b_id: "B", winner_id: "B", confirmed: true })];
  assertEquals(championTeamId(RR, all), "B");
});

Deno.test("events come out in the app's order with champions and the winners photo", () => {
  const out = winnersEvents(
    [KO, RR, { id: "c-none", name: "Mixed Doubles 35+", sort_order: 3, groups_count: 1, top_n_advance: 2 }],
    [m({ round_idx: 0, slot_idx: 0, winner_id: "T1", team_a_id: "T1", team_b_id: "T2", confirmed: true }), g("T3", "T4", "T4")],
    [{ id: "T1", p1_id: "p1", p2_id: "p2" }, { id: "T2", p1_id: "p3", p2_id: "p4" }, { id: "T4", p1_id: "p5", p2_id: null }],
    [{ id: "p1", name: " Amy ", photo_url: "https://x/a.jpg" }, { id: "p2", name: "Ben", photo_url: null }, { id: "p5", name: "Chloé", photo_url: null }],
    [{ category_id: "c-ko", photo_url: "https://x/w.jpg", uploaded_by: "Priya", updated_at: "2026-11-21T20:00:00Z" }],
  );
  assertEquals(out.map((e) => e.name), ["Youth Girls' Singles", "Men's Doubles 18–34", "Mixed Doubles 35+"]);
  assertEquals(out[0], { id: "c-rr", name: "Youth Girls' Singles", champions: [{ id: "p5", name: "Chloé", photo_url: null }], photo_url: null, photo_by: null, photo_at: null });
  assertEquals(out[1].champions, [{ id: "p1", name: "Amy", photo_url: "https://x/a.jpg" }, { id: "p2", name: "Ben", photo_url: null }]);
  assertEquals([out[1].photo_url, out[1].photo_by], ["https://x/w.jpg", "Priya"]);
  assertEquals(out[2].champions, []);
});

Deno.test("a photo can be uploaded before the champion is known, and a champion can lack a photo", () => {
  const out = winnersEvents([KO], [], [], [], [{ category_id: "c-ko", photo_url: "https://x/w.jpg" }]);
  assertEquals([out[0].champions.length, out[0].photo_url], [0, "https://x/w.jpg"]);
});

Deno.test("winners photos live under winners/<tournament>/<event>/ and only those are recognised", () => {
  const T = "11111111-1111-4111-8111-111111111111", C = "22222222-2222-4222-8222-222222222222", C2 = "33333333-3333-4333-8333-333333333333";
  const base = "https://x.supabase.co/storage/v1/object/public/player-photos/";
  assertEquals(winnersPhotoPath(T, C, "jpg", 5), `winners/${T}/${C}/5.jpg`);
  assertEquals(winnersPathFromUrl(`${base}winners/${T}/${C}/5.jpg`, T, C), `winners/${T}/${C}/5.jpg`);
  assertEquals(winnersPathFromUrl(`${base}winners/${T}/${C2}/5.jpg`, T, C), null); // another event's
  assertEquals(winnersPathFromUrl(`${base}winners/${C}/${C}/5.jpg`, T, C), null); // another tournament's
  assertEquals(winnersPathFromUrl(`${base}desk/${C}/5.jpg`, T, C), null); // a player's desk photo
  assertEquals(winnersPathFromUrl(`${base}self/${C}/5.jpg`, T, C), null);
  assertEquals(winnersPathFromUrl(null, T, C), null);
});
