import type { ApproveRegistrationResult } from "../../lib/db";

// Supabase error objects are NOT instances of Error. They look like
// { message, details, hint, code }. This helper extracts a usable string
// from any of: Error, PostgrestError, plain object with .message, or other.
// P0001 is a RAISE EXCEPTION from our own functions: the message is written
// for the director, so the code is left off.
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    const code = obj.code === "P0001" ? null : obj.code;
    const parts = [obj.message, obj.details, obj.hint, code]
      .filter((v) => typeof v === "string" && v) as string[];
    if (parts.length) return parts.join(" · ");
    try { return JSON.stringify(e); } catch { /* fall through */ }
  }
  return String(e);
}

export type ApprovalEmail = { sent: boolean; status: string };

// True when nobody is left without their "You're in" email. "already sent"
// means the database trigger got there first.
export function approvalEmailOk(email: ApprovalEmail): boolean {
  return email.sent || email.status === "already sent";
}

// The success toast after Approve. Results from before linking existed have
// no linked_existing_team, which reads as a new team.
export function approvedMessage(
  reg: { player_name: string; partner_name: string | null },
  result: Partial<ApproveRegistrationResult> | null,
  emailResult: ApprovalEmail,
): string {
  const email = !approvalEmailOk(emailResult) ? ""
    : emailResult.status.startsWith("not needed") ? " · both already had their “You're in” email"
    : " · “You're in” email sent";
  if (result?.linked_existing_team) {
    const team = result.team_name || `${reg.player_name} & ${reg.partner_name ?? ""}`;
    return `Approved — ${reg.player_name} linked to existing team ${team}${email}`;
  }
  return `Approved — ${reg.player_name}${reg.partner_name ? " & " + reg.partner_name : ""} added${email}`;
}
