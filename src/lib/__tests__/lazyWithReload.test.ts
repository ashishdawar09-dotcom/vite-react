import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadOrReload } from "../lazyWithReload";

const SAFARI = new TypeError("Importing a module script failed.");
const CHROME = new TypeError("Failed to fetch dynamically imported module: https://x/assets/TeamsTab-old.js");

let store: Record<string, string>;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = {};
  reload = vi.fn();
  vi.stubGlobal("window", { location: { pathname: "/", reload } });
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
});
afterEach(() => vi.unstubAllGlobals());

const settled = (p: Promise<unknown>) =>
  Promise.race([p.then(() => "resolved", () => "rejected"), new Promise((r) => setTimeout(() => r("pending"), 20))]);

describe("loadOrReload", () => {
  it("returns the module when the chunk loads", async () => {
    await expect(loadOrReload(async () => ({ default: "Tab" }))).resolves.toEqual({ default: "Tab" });
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([["Safari", SAFARI], ["Chrome", CHROME]])("reloads once when a %s chunk is gone after a deploy", async (_, err) => {
    const p = loadOrReload(() => Promise.reject(err));
    expect(await settled(p)).toBe("pending"); // waits for the reload, no error shown
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("gives up on a second failure on the same page instead of reloading forever", async () => {
    void loadOrReload(() => Promise.reject(SAFARI));
    await expect(loadOrReload(() => Promise.reject(SAFARI))).rejects.toBe(SAFARI);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("still reloads once when sessionStorage is unavailable", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } });
    expect(await settled(loadOrReload(() => Promise.reject(SAFARI)))).toBe("pending");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("passes other errors straight through", async () => {
    const boom = new Error("boom");
    await expect(loadOrReload(() => Promise.reject(boom))).rejects.toBe(boom);
    expect(reload).not.toHaveBeenCalled();
  });
});

// Every lazily loaded component must recover from a deploy; a plain
// React.lazy() here is what let the admin tabs break on Oct 25.
describe("lazy imports", () => {
  const sources = import.meta.glob<string>(["../../**/*.{ts,tsx}", "!../../**/__tests__/**", "!../lazyWithReload.ts"], {
    query: "?raw",
    import: "default",
    eager: true,
  });

  it("all go through lazyWithReload", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    const offenders = Object.entries(sources)
      .filter(([, src]) => /\b(React\.)?lazy\(/.test(src.replace(/lazyWithReload\(/g, "")))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
