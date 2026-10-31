import { describe, expect, it } from "vitest";
import { approvalEmailFailedMessage, approvalEmailOk, approvedMessage, errorMessage } from "../approvalMessages";

const pair = { player_name: "Ryan Joseph", partner_name: "Duong Hoac" };
const sent = { sent: true, status: "sent" };
const failed = { sent: false, status: "failed: player failed: 500" };

describe("approvedMessage", () => {
  it("says the team was added for a new pair", () => {
    expect(approvedMessage(pair, { player_id: "p", partner_id: "q", team_id: "t", linked_existing_team: false }, sent))
      .toBe("Approved — Ryan Joseph & Duong Hoac added · “You're in” email sent");
  });

  it("names the existing team when the entry was linked", () => {
    expect(approvedMessage(pair, {
      player_id: "p", partner_id: "q", team_id: "t",
      linked_existing_team: true, team_name: "Duong Hoac & Ryan Joseph",
    }, sent)).toBe("Approved — Ryan Joseph linked to existing team Duong Hoac & Ryan Joseph · confirmation email sent");
  });

  it("treats a result without the new fields as a new team", () => {
    expect(approvedMessage(pair, { player_id: "p", partner_id: "q", team_id: "t" }, failed))
      .toBe("Approved — Ryan Joseph & Duong Hoac added");
  });

  it("handles a solo entry and a missing result", () => {
    expect(approvedMessage({ player_name: "Sam", partner_name: null }, null, failed)).toBe("Approved — Sam added");
  });
});

describe("approval email", () => {
  it("counts the database's own send as done, and a failure as not", () => {
    expect(approvalEmailOk({ sent: false, status: "already sent" })).toBe(true);
    expect(approvalEmailOk(failed)).toBe(false);
  });
});

describe("approval email toasts whichever registration-email version is live", () => {
  const linked = { player_id: "p", partner_id: "q", team_id: "t", linked_existing_team: true, team_name: "Duong Hoac & Ryan Joseph" };

  it("says nobody was emailed again when the older version skipped the email", () => {
    expect(approvedMessage(pair, linked, { sent: true, status: "not needed: already emailed for this team" }))
      .toBe("Approved — Ryan Joseph linked to existing team Duong Hoac & Ryan Joseph · both already had their “You're in” email");
  });

  it("names the email that failed", () => {
    expect(approvalEmailFailedMessage(linked, failed))
      .toBe("The “Your share is paid” confirmation email didn't send (failed: player failed: 500). Let them know directly.");
    expect(approvalEmailFailedMessage({ ...linked, linked_existing_team: false }, failed))
      .toBe("The “You're in” email didn't send (failed: player failed: 500). Let them know directly.");
  });
});

describe("errorMessage", () => {
  it("shows a message raised by our own function without the error code", () => {
    const e = {
      message: 'Ryan Joseph is already on team "Ryan Joseph & X" in Men\'s Doubles 35+. Change that team before approving.',
      details: null, hint: null, code: "P0001",
    };
    expect(errorMessage(e)).toBe(e.message);
  });

  it("keeps the code for other database errors", () => {
    expect(errorMessage({ message: "permission denied", code: "42501" })).toBe("permission denied · 42501");
  });

  it("reads Error instances and plain values", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("x")).toBe("x");
  });
});
