// Sends one email through Resend. Returns null on success or a short error.
// Secrets: RESEND_API_KEY (required); REGISTRATION_FROM_EMAIL optionally
// overrides the sender (default "<fromName> <no-reply@adawar.org>", a domain
// verified in Resend).
//
// sendEmailDetailed is the same send, plus what the race-day emails need:
// Resend's email id back (delivery webhooks match on it), an idempotency key
// (a double-tapped "allocate" or a retried batch sends once), tags, a fixed
// sender, and scheduling.

export type Mail = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  fromName: string;
  replyTo?: string | null;
  attachments?: { filename: string; content: string }[]; // base64 content
};

export type MailOptions = {
  // A full "Name <address>" sender; replaces fromName and REGISTRATION_FROM_EMAIL.
  from?: string | null;
  // Same key within 24 hours: Resend sends once and answers with the first email's id.
  idempotencyKey?: string | null;
  tags?: { name: string; value: string }[];
  // ISO 8601 time to deliver at instead of now.
  scheduledAt?: string | null;
};

export type SendResult = { id: string | null; error: string | null };

// RESEND_API_BASE is for tests only (a local fake Resend); never set it on production.
const API = Deno.env.get("RESEND_API_BASE") ?? "https://api.resend.com";

// Tag names and values: ASCII letters, numbers, underscores and dashes only.
export const tagValue = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);

export function buildBody(mail: Mail, opts: MailOptions = {}): string {
  const from = opts.from?.trim() || (Deno.env.get("REGISTRATION_FROM_EMAIL") ??
    `${mail.fromName.replace(/[<>"\r\n]/g, "").slice(0, 60)} <no-reply@adawar.org>`);
  return JSON.stringify({
    from,
    to: Array.isArray(mail.to) ? mail.to : [mail.to],
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
    ...(mail.attachments?.length ? { attachments: mail.attachments } : {}),
    ...(opts.tags?.length ? { tags: opts.tags.map((t) => ({ name: tagValue(t.name), value: tagValue(t.value) })) } : {}),
    ...(opts.scheduledAt ? { scheduled_at: opts.scheduledAt } : {}),
  });
}

async function post(path: string, body: string | null, idempotencyKey?: string | null): Promise<SendResult> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { id: null, error: "email not configured" };
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey.slice(0, 256);
  try {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API}${path}`, { method: "POST", headers, ...(body === null ? {} : { body }) });
      if (res.ok) {
        const data = await res.json().catch(() => ({})) as { id?: unknown };
        return { id: typeof data.id === "string" ? data.id : null, error: null };
      }
      // Resend allows a few requests a second; a burst (one entry for several
      // events) can hit it. Wait and try once more. The daily quota also
      // answers 429, and the retry fails the same way.
      if (res.status === 429 && attempt === 0) {
        await res.body?.cancel();
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const text = await res.text();
      // A second call with the same idempotency key while the first is still
      // in flight (a double tap): wait, then Resend answers with the first send.
      if (res.status === 409 && attempt === 0 && text.includes("concurrent_idempotent_requests")) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      return { id: null, error: `${res.status} ${text.slice(0, 160)}` };
    }
  } catch (e) {
    return { id: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export function sendEmailDetailed(mail: Mail, opts: MailOptions = {}): Promise<SendResult> {
  return post("/emails", buildBody(mail, opts), opts.idempotencyKey);
}

export async function sendEmail(mail: Mail): Promise<string | null> {
  return (await sendEmailDetailed(mail)).error;
}

// Cancels an email that was scheduled and hasn't gone out yet.
export async function cancelScheduledEmail(id: string): Promise<string | null> {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return "bad email id";
  return (await post(`/emails/${id}/cancel`, null)).error;
}
