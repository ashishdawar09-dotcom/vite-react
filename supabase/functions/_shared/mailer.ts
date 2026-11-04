// Sends one email through Resend. Returns null on success or a short error.
// Secrets: RESEND_API_KEY (required); REGISTRATION_FROM_EMAIL optionally
// overrides the sender (default "<fromName> <no-reply@adawar.org>", a domain
// verified in Resend).

export type Mail = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  fromName: string;
  replyTo?: string | null;
  attachments?: { filename: string; content: string }[]; // base64 content
};

export async function sendEmail(mail: Mail): Promise<string | null> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return "email not configured";
  const from = Deno.env.get("REGISTRATION_FROM_EMAIL") ??
    `${mail.fromName.replace(/[<>"\r\n]/g, "").slice(0, 60)} <no-reply@adawar.org>`;
  const body = JSON.stringify({
    from,
    to: Array.isArray(mail.to) ? mail.to : [mail.to],
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
    ...(mail.attachments?.length ? { attachments: mail.attachments } : {}),
  });
  try {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body,
      });
      if (res.ok) return null;
      // Resend allows a few requests a second; a burst (one entry for several
      // events) can hit it. Wait and try once more.
      if (res.status === 429 && attempt === 0) {
        await res.body?.cancel();
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      return `${res.status} ${(await res.text()).slice(0, 160)}`;
    }
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
