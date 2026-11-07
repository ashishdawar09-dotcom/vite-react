import { afterEach, describe, expect, it, vi } from "vitest";

const URL = "https://example-project.supabase.co";
const KEY = "sb_publishable_test_key";
const ping = { id: "0c4a7700-aaaa-4000-8000-000000000001", n: 1, at: "you", visible: true, since: 1 };

async function load(env: { url?: string; key?: string }) {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", env.url ?? "");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", env.key ?? "");
  return (await import("../sendVisitorPing")).sendVisitorPing;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendVisitorPing", () => {
  it("posts one visitor message to the Realtime broadcast API with the public key", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
    vi.stubGlobal("fetch", fetchMock);
    const send = await load({ url: URL, key: KEY });
    send("reg-form:t-1", ping);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL}/realtime/v1/api/broadcast`);
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(false);
    expect(init.headers).toEqual({ apikey: KEY, "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ messages: [{ topic: "reg-form:t-1", event: "visitor", payload: ping, private: false }] });
  });
  it("lets a bye go out while the page closes", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
    vi.stubGlobal("fetch", fetchMock);
    const send = await load({ url: URL, key: KEY });
    send("reg-form:t-1", { id: ping.id, n: 2, bye: true }, true);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].keepalive).toBe(true);
  });
  it("says bye with a beacon: form-encoded, key in the address, no CORS check needed", async () => {
    const beacon = vi.fn(() => true);
    const fetchMock = vi.fn();
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone)", sendBeacon: beacon });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", KEY);
    const { sendVisitorBye } = await import("../sendVisitorPing");
    sendVisitorBye("site:x", ping.id, 7);
    expect(fetchMock).not.toHaveBeenCalled();
    const [to, body] = beacon.mock.calls[0] as unknown as [string, URLSearchParams];
    expect(to).toBe(`${URL}/realtime/v1/api/broadcast?apikey=${KEY}`);
    expect([...body.entries()]).toEqual([
      ["messages[][topic]", "site:x"],
      ["messages[][event]", "visitor"],
      ["messages[][payload][id]", ping.id],
      ["messages[][payload][n]", "7"],
      ["messages[][payload][bye]", "true"],
    ]);
  });
  it("falls back to a keepalive request when there's no beacon or it's refused", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone)", sendBeacon: vi.fn(() => false) });
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", URL);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", KEY);
    const { sendVisitorBye } = await import("../sendVisitorPing");
    sendVisitorBye("site:x", ping.id, 8);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body)).messages[0].payload).toEqual({ id: ping.id, n: 8, bye: true });
  });
  it("sends nothing for crawlers and page-speed tools", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1)", "Mozilla/5.0 HeadlessChrome/140.0", "Mozilla/5.0 Chrome-Lighthouse"]) {
      vi.stubGlobal("navigator", { userAgent: ua });
      (await load({ url: URL, key: KEY }))("reg-form:t-1", ping);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends nothing without the project settings", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const send = await load({});
    send("reg-form:t-1", ping);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("never throws, whether fetch throws or fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new TypeError("blocked"); }));
    let send = await load({ url: URL, key: KEY });
    expect(() => send("reg-form:t-1", ping)).not.toThrow();
    const rejected = vi.fn(() => Promise.reject(new TypeError("offline")));
    vi.stubGlobal("fetch", rejected);
    send = await load({ url: URL, key: KEY });
    expect(() => send("reg-form:t-1", ping)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(rejected).toHaveBeenCalledTimes(1);
  });
});
