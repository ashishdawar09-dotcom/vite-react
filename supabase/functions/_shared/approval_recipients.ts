// Who gets the "You're in" email for an approved entry.
//
// When both partners register separately (each paying their own share), the
// second entry is approved onto the team the first one created, and both of
// them were already emailed by the first approval. Anyone the pair's other
// entries already emailed is skipped. Only an approval email that fully sent
// counts, so a failed or still-sending one never causes a skip.

export type TeamEntry = {
  player_email: string | null;
  partner_email: string | null;
  approval_email_status: string | null;
};

const norm = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();

export function approvalRecipients(
  reg: { player_email: string; partner_email: string | null },
  otherTeamEntries: TeamEntry[],
): { player: boolean; partner: boolean } {
  const emailed = new Set<string>();
  for (const o of otherTeamEntries) {
    if (o.approval_email_status !== "sent") continue;
    for (const e of [o.player_email, o.partner_email]) if (norm(e)) emailed.add(norm(e));
  }
  return {
    player: !emailed.has(norm(reg.player_email)),
    partner: !!norm(reg.partner_email) && !emailed.has(norm(reg.partner_email)),
  };
}
