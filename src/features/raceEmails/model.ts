// What the admin sees about race-day emails: whether a court call reached
// each player, and which briefings bounced. Pure, so it's unit-tested.

export type EmailLogRow = {
  player_id: string;
  status: string;                  // sent | failed | skipped
  error_message: string | null;
  delivery_status: string | null;  // from the resend-webhook function
  delivery_detail: string | null;
  sent_at: string;
};

const PROBLEM: Record<string, string> = {
  bounced: "bounced",
  complained: "marked as spam",
  failed: "failed",
  suppressed: "blocked (bounced before)",
};

export type CourtCallSummary =
  | { kind: "waiting" }                                   // nothing logged yet
  | { kind: "none"; }                                     // a minute on and still nothing: the call didn't go out
  | { kind: "problem"; problems: { name: string; reason: string }[]; total: number }
  | { kind: "ok"; delivered: number; total: number; delayed: number };

// Rows for this match's current allocation, latest per player. Rows from an
// earlier allocation of the same match (re-allocated) are left out.
export function summarizeCourtCall(
  rows: EmailLogRow[],
  allocatedAt: string | null,
  nameById: Map<string, string>,
  nowMs = Date.now(),
): CourtCallSummary {
  const since = allocatedAt ? Date.parse(allocatedAt) - 5_000 : -Infinity;
  const latest = new Map<string, EmailLogRow>();
  for (const r of rows) {
    if (Date.parse(r.sent_at) < since) continue;
    const prev = latest.get(r.player_id);
    if (!prev || Date.parse(r.sent_at) >= Date.parse(prev.sent_at)) latest.set(r.player_id, r);
  }
  if (latest.size === 0) {
    const waited = allocatedAt ? nowMs - Date.parse(allocatedAt) : 0;
    return waited > 60_000 ? { kind: "none" } : { kind: "waiting" };
  }
  const name = (id: string) => nameById.get(id) ?? "A player";
  const problems: { name: string; reason: string }[] = [];
  let delivered = 0, delayed = 0;
  for (const r of latest.values()) {
    if (r.status === "skipped") problems.push({ name: name(r.player_id), reason: "no email on file" });
    else if (r.status === "failed") problems.push({ name: name(r.player_id), reason: "couldn't send" });
    else if (r.delivery_status && PROBLEM[r.delivery_status]) problems.push({ name: name(r.player_id), reason: PROBLEM[r.delivery_status] });
    else if (r.delivery_status === "delivered") delivered++;
    else if (r.delivery_status === "delivery_delayed") delayed++;
  }
  if (problems.length) return { kind: "problem", problems, total: latest.size };
  return { kind: "ok", delivered, total: latest.size, delayed };
}

// Keep checking until every email has an answer (delivered or a problem).
export function courtCallSettled(s: CourtCallSummary): boolean {
  return s.kind === "none" || (s.kind === "ok" && s.delivered === s.total);
}

export type BriefingRow = {
  player_id: string;
  kind: string;
  status: string;                  // sending | sent | scheduled | failed | cancelled
  error_message: string | null;
  scheduled_at: string | null;
  delivery_status: string | null;
  delivery_detail: string | null;
};

export type BriefingCounts = {
  sent: number; scheduled: number; failed: number; cancelled: number; delivered: number;
  problems: { player_id: string; reason: string }[];
  scheduledFor: string | null;     // the earliest scheduled time
};

export function briefingCounts(rows: BriefingRow[], kind: string): BriefingCounts {
  const c: BriefingCounts = { sent: 0, scheduled: 0, failed: 0, cancelled: 0, delivered: 0, problems: [], scheduledFor: null };
  for (const r of rows) {
    if (r.kind !== kind) continue;
    if (r.status === "sent" || r.status === "sending") c.sent++;
    else if (r.status === "scheduled") {
      c.scheduled++;
      if (r.scheduled_at && (!c.scheduledFor || r.scheduled_at < c.scheduledFor)) c.scheduledFor = r.scheduled_at;
    } else if (r.status === "failed") c.failed++;
    else if (r.status === "cancelled") c.cancelled++;
    if (r.delivery_status === "delivered") c.delivered++;
    if (r.status === "failed") c.problems.push({ player_id: r.player_id, reason: `couldn't send (${r.error_message ?? "error"})` });
    else if (r.delivery_status && PROBLEM[r.delivery_status]) {
      c.problems.push({ player_id: r.player_id, reason: PROBLEM[r.delivery_status] + (r.delivery_detail ? `: ${r.delivery_detail}` : "") });
    }
  }
  return c;
}
