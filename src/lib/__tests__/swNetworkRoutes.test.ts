import { afterEach, describe, expect, it, vi } from "vitest";
import { addNetworkRoutes, type InstallEventLike } from "../swNetworkRoutes";

type Rule = { condition: { urlPattern: { test(url: string): boolean } }; source: string };

function fakeInstallEvent(addRoutes?: (rules: unknown) => Promise<void>) {
  const waited: Promise<unknown>[] = [];
  const event: InstallEventLike = { waitUntil: (p) => { waited.push(p); }, addRoutes };
  return { event, waited };
}

describe("addNetworkRoutes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends only the visitor count's broadcast endpoint straight to the network", async () => {
    const rules: Rule[] = [];
    const { event, waited } = fakeInstallEvent(async (r) => { rules.push(r as Rule); });

    expect(addNetworkRoutes(event)).toBe(true);
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("network");

    const matches = (url: string) => rules[0].condition.urlPattern.test(url);
    // The beacon ("bye") and the JSON "here" pings, on production and scratch
    expect(matches("https://wdqooznwzesmjdvlcrxw.supabase.co/realtime/v1/api/broadcast?apikey=sb_publishable_x")).toBe(true);
    expect(matches("https://wdqooznwzesmjdvlcrxw.supabase.co/realtime/v1/api/broadcast")).toBe(true);
    expect(matches("https://aabsbcvzknsdbirrmlfr.supabase.co/realtime/v1/api/broadcast")).toBe(true);
    // Everything else keeps the routes it has today
    expect(matches("https://wdqooznwzesmjdvlcrxw.supabase.co/rest/v1/tournaments?select=*")).toBe(false);
    expect(matches("https://wdqooznwzesmjdvlcrxw.supabase.co/functions/v1/save-registration-lead")).toBe(false);
    expect(matches("https://wdqooznwzesmjdvlcrxw.supabase.co/auth/v1/token?grant_type=refresh_token")).toBe(false);
    expect(matches("https://wdqooznwzesmjdvlcrxw.supabase.co/realtime/v1/api/broadcast/extra")).toBe(false);
    expect(matches("https://badminton.adawar.org/realtime/v1/api/broadcast")).toBe(false);
    expect(matches("https://supabase.co.example.com/realtime/v1/api/broadcast")).toBe(false);
    expect(matches("http://wdqooznwzesmjdvlcrxw.supabase.co/realtime/v1/api/broadcast")).toBe(false);

    // The install waits for the route, so it is in place before the worker takes over
    expect(waited).toHaveLength(1);
    await expect(waited[0]).resolves.toBeUndefined();
  });

  it("does nothing where the browser has no static routing (Safari, iPhone, Firefox, older Chrome)", () => {
    const { event, waited } = fakeInstallEvent(undefined);
    expect(addNetworkRoutes(event)).toBe(false);
    expect(waited).toHaveLength(0);
  });

  it("does nothing without URLPattern", () => {
    vi.stubGlobal("URLPattern", undefined);
    const addRoutes = vi.fn(async () => {});
    const { event, waited } = fakeInstallEvent(addRoutes);
    expect(addNetworkRoutes(event)).toBe(false);
    expect(addRoutes).not.toHaveBeenCalled();
    expect(waited).toHaveLength(0);
  });

  it("never fails the install when the browser rejects the rule", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { event, waited } = fakeInstallEvent(() => Promise.reject(new TypeError("unsupported rule")));
    expect(addNetworkRoutes(event)).toBe(true);
    expect(waited).toHaveLength(1);
    await expect(waited[0]).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("never fails the install when addRoutes throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { event, waited } = fakeInstallEvent(() => {
      throw new DOMException("addRoutes outside the install event", "InvalidStateError");
    });
    expect(addNetworkRoutes(event)).toBe(false);
    expect(waited).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
  });
});
