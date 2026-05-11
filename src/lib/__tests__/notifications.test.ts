import { describe, expect, it } from "vitest";
import { pickRecipients } from "../notifications";
import type { Player, Team } from "../../types";

// Minimal Player builder — only fields pickRecipients reads (id, email) matter.
function p(id: string, email: string | null): Player {
  return {
    id,
    tournament_id: "t",
    name: id,
    color: "#000",
    photo_url: null,
    note: null,
    active: true,
    sort_order: 0,
    checked_in_at: null,
    email,
  };
}

function team(id: string, p1_id: string, p2_id: string | null): Team {
  return { id, tournament_id: "t", category_id: "c", name: id, p1_id, p2_id, sort_order: 0 };
}

describe("pickRecipients", () => {
  it("returns all four players when both doubles teams have emails", () => {
    const players = [p("a1", "a1@x"), p("a2", "a2@x"), p("b1", "b1@x"), p("b2", "b2@x")];
    const teamA = team("A", "a1", "a2");
    const teamB = team("B", "b1", "b2");
    const out = pickRecipients({ team_a_id: "A", team_b_id: "B" }, teamA, teamB, players);
    expect(out.map(r => r.player_id)).toEqual(["a1", "a2", "b1", "b2"]);
    expect(out.map(r => r.email)).toEqual(["a1@x", "a2@x", "b1@x", "b2@x"]);
  });

  it("handles singles (p2 null on each team)", () => {
    const players = [p("a1", "a1@x"), p("b1", "b1@x")];
    const teamA = team("A", "a1", null);
    const teamB = team("B", "b1", null);
    const out = pickRecipients({ team_a_id: "A", team_b_id: "B" }, teamA, teamB, players);
    expect(out.map(r => r.player_id)).toEqual(["a1", "b1"]);
  });

  it("filters out players with null email", () => {
    const players = [p("a1", "a1@x"), p("a2", null), p("b1", "b1@x"), p("b2", null)];
    const teamA = team("A", "a1", "a2");
    const teamB = team("B", "b1", "b2");
    const out = pickRecipients({ team_a_id: "A", team_b_id: "B" }, teamA, teamB, players);
    expect(out.map(r => r.player_id)).toEqual(["a1", "b1"]);
  });

  it("filters out players with empty-string email", () => {
    const players = [p("a1", ""), p("b1", "b1@x")];
    const teamA = team("A", "a1", null);
    const teamB = team("B", "b1", null);
    const out = pickRecipients({ team_a_id: "A", team_b_id: "B" }, teamA, teamB, players);
    expect(out.map(r => r.player_id)).toEqual(["b1"]);
  });

  it("dedupes when the same player is on both teams", () => {
    const players = [p("x", "x@x"), p("a2", "a2@x"), p("b2", "b2@x")];
    const teamA = team("A", "x", "a2");
    const teamB = team("B", "x", "b2");
    const out = pickRecipients({ team_a_id: "A", team_b_id: "B" }, teamA, teamB, players);
    expect(out.map(r => r.player_id)).toEqual(["x", "a2", "b2"]);
  });

  it("returns just one team's players when the other team is null", () => {
    const players = [p("a1", "a1@x"), p("a2", "a2@x")];
    const teamA = team("A", "a1", "a2");
    const out = pickRecipients({ team_a_id: "A", team_b_id: null }, teamA, null, players);
    expect(out.map(r => r.player_id)).toEqual(["a1", "a2"]);
  });

  it("returns empty when both teams are null", () => {
    const out = pickRecipients({ team_a_id: null, team_b_id: null }, null, null, []);
    expect(out).toEqual([]);
  });

  it("ignores players not on either team", () => {
    const players = [p("a1", "a1@x"), p("b1", "b1@x"), p("stranger", "s@x")];
    const teamA = team("A", "a1", null);
    const teamB = team("B", "b1", null);
    const out = pickRecipients({ team_a_id: "A", team_b_id: "B" }, teamA, teamB, players);
    expect(out.map(r => r.player_id)).toEqual(["a1", "b1"]);
  });

  it("silently skips a referenced player_id that isn't in the players array", () => {
    const players = [p("a1", "a1@x")];
    const teamA = team("A", "a1", "missing");
    const out = pickRecipients({ team_a_id: "A", team_b_id: null }, teamA, null, players);
    expect(out.map(r => r.player_id)).toEqual(["a1"]);
  });
});
