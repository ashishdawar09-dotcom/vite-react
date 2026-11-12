// Regression test for register-player's "already paid for by the partner"
// branch. The email a submitter types isn't verified, so that branch must not
// write anything to the other person's entry: recording a partner waiver
// acceptance there let anyone who knew both addresses fill in the partner's
// waiver (any name, any adult age, no guardian) and lock the partner's own
// emailed waiver link out, because an entry holds one partner acceptance.
//
// The real handler runs against a small in-memory stand-in for PostgREST:
// Deno.serve is captured instead of listening, and fetch answers the REST
// calls supabase-js makes. Run with:
//   deno test --allow-env supabase/functions/register-player/index_test.ts

import { assertEquals } from "jsr:@std/assert@1";

const TOURNAMENT = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";
const ALICE_ENTRY = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {
  tournaments: [{
    id: TOURNAMENT, name: "Dummy Open", registration_open: true, registration_deadline: null,
    waiver_text: "Waiver", waiver_version: "v1", youth_price: null, student_price: null,
    admin_notify_emails: ["director@example.test"],
  }],
  categories: [{
    id: EVENT, name: "Mixed Doubles", tournament_id: TOURNAMENT, team_size: 2, allow_solo_signup: false,
    price: 30, price_basis: "per_player", age_band: null, min_age: null,
  }],
  // Alice entered with Bob and paid for both of them.
  pending_registrations: [{
    id: ALICE_ENTRY, category_id: EVENT, status: "pending", player_name: "Alice",
    player_email: "alice@example.test", partner_name: "Bob", partner_email: "bob@example.test",
    payment_paid_full_for_partner: true,
  }],
  waiver_consents: [],
};
const writes: string[] = [];
const emailsTo: string[][] = [];

// Only the eq and in filters this handler uses before it refuses the entry.
function matches(row: Row, params: URLSearchParams): boolean {
  for (const [column, condition] of params) {
    if (["select", "limit", "order", "offset"].includes(column)) continue;
    const dot = condition.indexOf(".");
    const op = condition.slice(0, dot);
    const value = condition.slice(dot + 1);
    const cell = String(row[column]);
    if (op === "eq" && cell !== value) return false;
    if (op === "in" && !value.slice(1, -1).split(",").map((v) => v.replace(/^"|"$/g, "")).includes(cell)) return false;
  }
  return true;
}

(globalThis as { fetch: typeof fetch }).fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.hostname === "api.resend.com") {
    emailsTo.push(((await req.json()) as { to: string[] }).to);
    return Response.json({ id: "dummy" });
  }
  if (url.pathname.startsWith("/rest/v1/rpc/")) return Response.json(true); // rate limiter: allowed
  const table = url.pathname.replace("/rest/v1/", "");
  if (req.method !== "GET" && req.method !== "HEAD") {
    writes.push(`${req.method} ${table}`);
    return new Response(null, { status: 201 });
  }
  const found = (tables[table] ?? []).filter((r) => matches(r, url.searchParams));
  const single = req.headers.get("accept")?.includes("vnd.pgrst.object");
  return Response.json(single ? found[0] ?? null : found);
};

let handler: ((req: Request) => Promise<Response>) | undefined;
(Deno as unknown as { serve: (h: (req: Request) => Promise<Response>) => unknown }).serve = (h) => {
  handler = h;
  return {};
};
Deno.env.set("SUPABASE_URL", "http://supabase.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "dummy-service-role");
Deno.env.set("RESEND_API_KEY", "re_dummy");
await import("./index.ts");

Deno.test("someone typing the partner's email is refused and writes nothing to the paid-for entry", async () => {
  const res = await handler!(new Request("http://localhost/functions/v1/register-player", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.50" },
    body: JSON.stringify({
      tournament_id: TOURNAMENT,
      category_id: EVENT,
      player_name: "Mallory Q",
      player_email: "bob@example.test",       // Bob's address, typed by someone else
      player_is_member: false,
      player_age: 30,
      partner_name: "Alice",
      partner_email: "alice@example.test",
      payment_method: "etransfer",
      payment_reference: "DUMMYREF1",
      consent: {
        accepted_rules: true, accepted_waiver: true, accepted_codes_of_conduct: true,
        waiver_version: "v1", signature: "Mallory Q",
      },
    }),
  }));

  assertEquals(res.status, 409);
  // No waiver acceptance (or anything else) is written to Alice's entry; Bob
  // accepts only through his own emailed link.
  assertEquals(writes, []);
  // The e-Transfer heads-up goes to the directors only.
  assertEquals(emailsTo, [["director@example.test"]]);
});
