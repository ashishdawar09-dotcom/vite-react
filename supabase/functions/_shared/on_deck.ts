// "You're up soon" alerts (notify-on-deck): the stage name, the venue time
// and the message each player gets. Pure, so it's tested without a network.

const MIN = 60_000;

/** A time at the venue (BC: UTC-7 all year since Nov 2026), like "10:42 am". */
export function venueClock(ms: number): string {
  const d = new Date(ms - 420 * MIN);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** The same player and match always give the same key, so a retry emails once. */
export function onDeckKey(matchId: string, playerId: string): string {
  return `on-deck/${matchId}/${playerId}`;
}

/**
 * The projected court call the app sent, if it's believable: an ISO time
 * from an hour ago to three hours ahead. Anything else is left out of the
 * message rather than shown wrong.
 */
export function parseExpected(v: unknown, now: number): number | null {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms) || ms < now - 60 * MIN || ms > now + 180 * MIN) return null;
  return ms;
}

export type StageMatch = { stage: string; group_idx: number | null; round_idx: number | null; is_bronze: boolean };

/** "Group B", "Quarter-final", "Semi-final", "Final", "3rd place". `lastRound` is the event's final round. */
export function stageName(m: StageMatch, lastRound: number | null): string {
  if (m.stage === "group") return `Group ${String.fromCharCode(65 + (m.group_idx ?? 0))}`;
  if (m.is_bronze) return "3rd place";
  const fromFinal = (lastRound ?? m.round_idx ?? 0) - (m.round_idx ?? 0);
  if (fromFinal <= 0) return "Final";
  if (fromFinal === 1) return "Semi-final";
  if (fromFinal === 2) return "Quarter-final";
  return `Round ${(m.round_idx ?? 0) + 1}`;
}

export type OnDeckMessage = {
  tournament: string;
  event: string;
  stage: string;
  player: string;
  opponent: string;
  expectedAt: number | null;
  replyTo: boolean;
};

export function onDeckEmail(i: OnDeckMessage): { subject: string; text: string; html: string } {
  const when = i.expectedAt != null ? `about ${venueClock(i.expectedAt)}` : "in the next few minutes";
  const subject = `🏸 You're up soon: ${i.event} · ${i.tournament}`;
  const text =
`🏸 YOU'RE UP SOON

Hi ${i.player},

Your ${i.event} match (${i.stage}) against ${i.opponent} is close to the front of the queue.
Expected court call: ${when}.

Please stay close to the courts and be ready to warm up. You'll get another message with your court number when it's called.
${i.replyTo ? "\nRunning late or can't play? Reply to this email and it reaches the tournament directors.\n" : ""}
— ${i.tournament}
`;
  const e = esc;
  const html =
`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>You're up soon</title>
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef2f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;">
        <tr><td style="background:#0f172a;padding:28px 28px 24px;text-align:center;">
          <div style="color:#94a3b8;font-size:11px;font-weight:800;letter-spacing:3px;text-transform:uppercase;">${e(i.tournament)}</div>
          <div style="color:#ffffff;font-size:26px;font-weight:900;margin-top:8px;">You're up soon</div>
          <div style="margin:14px auto 0;display:inline-block;background:rgba(251,191,36,0.15);color:#fbbf24;font-size:12px;font-weight:800;letter-spacing:1.5px;padding:7px 14px;border-radius:20px;">COURT CALL ${e(when.toUpperCase())}</div>
        </td></tr>
        <tr><td style="padding:26px 28px 6px;">
          <div style="font-size:17px;color:#1a1a2e;font-weight:700;">Hi ${e(i.player)},</div>
          <div style="font-size:15px;color:#334155;margin-top:8px;line-height:1.5;">Your <strong>${e(i.event)}</strong> match (${e(i.stage)}) is close to the front of the queue.</div>
        </td></tr>
        <tr><td style="padding:14px 28px 6px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fef3c7;border-radius:12px;border-left:5px solid #f59e0b;">
            <tr><td style="padding:14px 18px;">
              <div style="color:#92400e;font-size:10px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;">Facing</div>
              <div style="color:#1a1a2e;font-size:16px;font-weight:800;margin-top:4px;">${e(i.opponent)}</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:18px 28px 26px;font-size:15px;color:#334155;line-height:1.5;">
          Please stay close to the courts and be ready to warm up. You'll get another message with your court number when it's called.
        </td></tr>
        <tr><td style="background:#1a1a2e;padding:18px 28px;text-align:center;color:#94a3b8;font-size:12px;line-height:1.5;">
          🏸 ${e(i.tournament)}${i.replyTo ? "<br>Running late or can't play? Reply to this email and it reaches the tournament directors." : ""}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, text, html };
}

export function onDeckPush(i: OnDeckMessage): { title: string; body: string } {
  const when = i.expectedAt != null ? `about ${venueClock(i.expectedAt)}` : "soon";
  return {
    title: "🏸 You're up soon",
    body: `${i.event} (${i.stage}) vs ${i.opponent}: court call ${when}. Stay close to the courts.`,
  };
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}
