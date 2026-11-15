import { describe, expect, it } from "vitest";
import { ORGANIZERS_ONLY, authErrorFromUrl, friendlyAuthError, stripAuthErrorParams } from "../authErrors";

describe("friendlyAuthError (organizer-only sign-in, Nov 14)", () => {
  it("turns 'no new accounts' errors into the organizers-only sentence", () => {
    expect(friendlyAuthError({ message: "Signups not allowed for otp", code: "otp_disabled" })).toBe(ORGANIZERS_ONLY);
    expect(friendlyAuthError({ message: "Signups not allowed for this instance" })).toBe(ORGANIZERS_ONLY);
    expect(friendlyAuthError({ message: "whatever", code: "signup_disabled" })).toBe(ORGANIZERS_ONLY);
    expect(friendlyAuthError({ message: "User not found" })).toBe(ORGANIZERS_ONLY);
  });
  it("keeps other errors as they are", () => {
    expect(friendlyAuthError({ message: "Token has expired or is invalid", code: "otp_expired" })).toBe("Token has expired or is invalid");
    expect(friendlyAuthError({ message: "" })).toBe("Something went wrong. Please try again.");
    expect(friendlyAuthError(null)).toBeNull();
  });
});

describe("authErrorFromUrl / stripAuthErrorParams (Google sign-in refused)", () => {
  it("reads the error from the query or the hash", () => {
    expect(authErrorFromUrl("?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance", "")).toBe(ORGANIZERS_ONLY);
    expect(authErrorFromUrl("", "#error=server_error&error_description=Database+error+saving+new+user")).toBe("Database error saving new user");
  });
  it("ignores addresses without a sign-in error", () => {
    expect(authErrorFromUrl("", "")).toBeNull();
    expect(authErrorFromUrl("?tab=players", "#top")).toBeNull();
  });
  it("removes only the error parts of the address", () => {
    expect(stripAuthErrorParams("https://x.org/?error=access_denied&error_code=signup_disabled&error_description=No#error=access_denied&error_description=No"))
      .toBe("/");
    expect(stripAuthErrorParams("https://x.org/t/a?tab=players&error_description=No#top")).toBe("/t/a?tab=players#top");
  });
});
