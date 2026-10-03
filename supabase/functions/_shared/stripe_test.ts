import { assertEquals } from "jsr:@std/assert@1";
import { verifyStripeSignature } from "./stripe.ts";

async function sign(payload: string, secret: string, t: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("accepts a valid signature and rejects tampering, wrong secret, old timestamps", async () => {
  const secret = "whsec_test_secret";
  const payload = '{"id":"evt_1","type":"checkout.session.completed"}';
  const now = Math.floor(Date.now() / 1000);
  const v1 = await sign(payload, secret, now);
  assertEquals(await verifyStripeSignature(payload, `t=${now},v1=${v1}`, secret), true);
  assertEquals(await verifyStripeSignature(payload + " ", `t=${now},v1=${v1}`, secret), false);
  assertEquals(await verifyStripeSignature(payload, `t=${now},v1=${v1}`, "whsec_other"), false);
  const old = now - 600;
  assertEquals(await verifyStripeSignature(payload, `t=${old},v1=${await sign(payload, secret, old)}`, secret), false);
  assertEquals(await verifyStripeSignature(payload, null, secret), false);
});
