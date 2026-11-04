import { describe, expect, it } from "vitest";
import { registrationLead } from "../registrationLead";

const T = "e7bb59ca-5cfc-4e5e-a4f6-0649ece00feb";
const form = (over: Partial<Record<"player_email" | "player_name" | "player_phone" | "category_id", string>> = {}) => ({
  player_email: "", player_name: "", player_phone: "", category_id: "", ...over,
});

describe("registrationLead", () => {
  it("waits for both a name and a valid email", () => {
    expect(registrationLead(T, form())).toBeNull();
    expect(registrationLead(T, form({ player_email: "amrit@gmail.com" }))).toBeNull();
    expect(registrationLead(T, form({ player_name: "Amritpal" }))).toBeNull();
    expect(registrationLead(T, form({ player_name: "Amritpal", player_email: "amrit@gmail" }))).toBeNull();
    expect(registrationLead(T, form({ player_name: "A", player_email: "amrit@gmail.com" }))).toBeNull();
  });

  it("needs the tournament", () => {
    expect(registrationLead(undefined, form({ player_name: "Amritpal", player_email: "amrit@gmail.com" }))).toBeNull();
  });

  it("trims and lowercases, and leaves out what isn't filled in", () => {
    expect(registrationLead(T, form({ player_name: "  Amritpal Gill ", player_email: " Amrit@Gmail.com " }))).toEqual({
      tournament_id: T, email: "amrit@gmail.com", name: "Amritpal Gill",
    });
  });

  it("adds the phone once it's a full number, and the chosen event", () => {
    expect(registrationLead(T, form({ player_name: "Amritpal", player_email: "a@b.co", player_phone: "604-123" }))?.phone).toBeUndefined();
    expect(registrationLead(T, form({
      player_name: "Amritpal", player_email: "a@b.co", player_phone: "(604) 123-4567", category_id: "c1",
    }))).toEqual({ tournament_id: T, email: "a@b.co", name: "Amritpal", phone: "6041234567", category_id: "c1" });
  });
});
