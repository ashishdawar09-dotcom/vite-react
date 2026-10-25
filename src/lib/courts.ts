// Errors from the allocate_court RPC (see db.allocateCourtAndNotify).

/** allocate_court refused: another unfinished match already holds the court. */
export function isCourtTaken(err: unknown): boolean {
  return !!err && typeof (err as { message?: unknown }).message === "string" &&
    (err as { message: string }).message.includes("court_taken");
}

/** What to tell the admin; the server names the match holding the court. */
export function courtTakenMessage(err: unknown, court: number): string {
  const msg = (err as { message?: string } | null)?.message ?? "";
  const detail = msg.replace(/^.*?court_taken:?\s*/, "").trim();
  return detail || `Court ${court} was just taken by another match. Pick another court.`;
}
