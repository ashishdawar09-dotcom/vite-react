// Sends one email through Resend. Returns null on success or a short error.
// Secrets: RESEND_API_KEY (required); REGISTRATION_FROM_EMAIL optionally
// overrides the sender (default "<fromName> <no-reply@adawar.org>", a domain
// verified in Resend).

export type Mail = {
  to: string;
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
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        ...(mail.attachments?.length ? { attachments: mail.attachments } : {}),
      }),
    });
    if (res.ok) return null;
    return `${res.status} ${(await res.text()).slice(0, 160)}`;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
