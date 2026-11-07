import { describe, expect, it } from "vitest";
import indexHtml from "../../../index.html?raw";
import mainSource from "../../main.tsx?raw";
import { fitViewportForChromeOnIos, isChromeOnIos, withoutViewportFit } from "../chromeIosViewport";

const UA = {
  chromeIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.96 Mobile/15E148 Safari/604.1",
  chromeIpad: "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.96 Mobile/15E148 Safari/604.1",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  firefoxIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15",
  edgeIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/141.0.3537.71 Mobile/15E148 Safari/605.1.15",
  googleAppIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/389.0.792386014 Mobile/15E148 Safari/604.1",
  instagramIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22G86 Instagram 400.0.0.33.86 (iPhone17,2; iOS 18_6; en_CA; en; scale=3.00; 1320x2868; 812437310)",
  facebookIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22G86 [FBAN/FBIOS;FBAV/530.0.0.43.109;FBBV/780105440;FBDV/iPhone17,2;FBMD/iPhone;FBSN/iOS;FBSV/18.6;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

const INDEX_HTML_VIEWPORT = "width=device-width, initial-scale=1.0, viewport-fit=cover";

// Chrome on iOS decides with exactly this check (fullscreen.ts).
const chromeSeesCover = (content: string | null) => !!content?.includes("viewport-fit=cover");

function fakeMeta(content: string | null) {
  const attrs = new Map<string, string>();
  if (content !== null) attrs.set("content", content);
  return {
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
  };
}

function fakePage(opts: {
  ua: string;
  metas?: ReturnType<typeof fakeMeta>[];
  standalone?: boolean;
  displayStandalone?: boolean;
  matchMediaThrows?: boolean;
}) {
  const metas = opts.metas ?? [fakeMeta(INDEX_HTML_VIEWPORT)];
  const selectors: string[] = [];
  const doc = {
    querySelectorAll: (selector: string) => {
      selectors.push(selector);
      return metas;
    },
  };
  const win = {
    navigator: { userAgent: opts.ua, standalone: opts.standalone },
    matchMedia: (query: string) => {
      if (opts.matchMediaThrows) throw new Error("no matchMedia here");
      return { matches: query === "(display-mode: standalone)" && opts.displayStandalone === true };
    },
  };
  return { doc, win, metas, selectors };
}

describe("isChromeOnIos", () => {
  it("is Chrome on iPhone and iPad", () => {
    expect(isChromeOnIos(UA.chromeIphone)).toBe(true);
    expect(isChromeOnIos(UA.chromeIpad)).toBe(true);
  });
  it("is not Safari, other iPhone browsers, in-app browsers, or Chrome elsewhere", () => {
    for (const ua of [UA.safariIphone, UA.firefoxIphone, UA.edgeIphone, UA.googleAppIphone, UA.instagramIphone, UA.facebookIphone, UA.chromeAndroid, UA.chromeMac, ""]) {
      expect(isChromeOnIos(ua)).toBe(false);
    }
  });
});

describe("withoutViewportFit", () => {
  it("drops viewport-fit from the tag in index.html and keeps the rest", () => {
    expect(withoutViewportFit(INDEX_HTML_VIEWPORT)).toBe("width=device-width, initial-scale=1.0");
  });
  it("drops it wherever it sits, however it is spaced, cased or separated", () => {
    expect(withoutViewportFit("viewport-fit=cover, width=device-width")).toBe("width=device-width");
    expect(withoutViewportFit("width=device-width; Viewport-Fit = cover ;initial-scale=1")).toBe("width=device-width, initial-scale=1");
    expect(withoutViewportFit("width=device-width,,viewport-fit=contain")).toBe("width=device-width");
  });
  it("leaves a tag without viewport-fit as it was", () => {
    expect(withoutViewportFit("width=device-width, initial-scale=1")).toBe("width=device-width, initial-scale=1");
  });
});

describe("fitViewportForChromeOnIos", () => {
  it("in Chrome on iPhone, takes viewport-fit=cover out so Chrome stops drawing under its bar", () => {
    const page = fakePage({ ua: UA.chromeIphone });
    expect(fitViewportForChromeOnIos(page.doc, page.win)).toBe(true);
    const content = page.metas[0].getAttribute("content");
    expect(content).toBe("width=device-width, initial-scale=1.0");
    expect(chromeSeesCover(content)).toBe(false);
    expect(page.selectors).toEqual(['meta[name="viewport"]']);
  });
  it("does the same in Chrome on iPad", () => {
    const page = fakePage({ ua: UA.chromeIpad });
    expect(fitViewportForChromeOnIos(page.doc, page.win)).toBe(true);
    expect(chromeSeesCover(page.metas[0].getAttribute("content"))).toBe(false);
  });
  it("keeps cover in Safari and every other browser", () => {
    for (const ua of [UA.safariIphone, UA.firefoxIphone, UA.edgeIphone, UA.googleAppIphone, UA.instagramIphone, UA.facebookIphone, UA.chromeAndroid, UA.chromeMac]) {
      const page = fakePage({ ua });
      expect(fitViewportForChromeOnIos(page.doc, page.win)).toBe(false);
      expect(page.metas[0].getAttribute("content")).toBe(INDEX_HTML_VIEWPORT);
    }
  });
  it("keeps cover in the installed app, either way it says so", () => {
    for (const opts of [{ standalone: true }, { displayStandalone: true }]) {
      const page = fakePage({ ua: UA.chromeIphone, ...opts });
      expect(fitViewportForChromeOnIos(page.doc, page.win)).toBe(false);
      expect(page.metas[0].getAttribute("content")).toBe(INDEX_HTML_VIEWPORT);
    }
  });
  it("still fixes Chrome when matchMedia is missing or throws", () => {
    const throws = fakePage({ ua: UA.chromeIphone, matchMediaThrows: true });
    expect(fitViewportForChromeOnIos(throws.doc, throws.win)).toBe(true);
    const missing = fakePage({ ua: UA.chromeIphone });
    const winWithout = { navigator: missing.win.navigator };
    expect(fitViewportForChromeOnIos(missing.doc, winWithout)).toBe(true);
    expect(chromeSeesCover(missing.metas[0].getAttribute("content"))).toBe(false);
  });
  it("changes every viewport tag, and nothing when there is nothing to change", () => {
    const two = fakePage({ ua: UA.chromeIphone, metas: [fakeMeta(INDEX_HTML_VIEWPORT), fakeMeta("viewport-fit=cover")] });
    expect(fitViewportForChromeOnIos(two.doc, two.win)).toBe(true);
    expect(two.metas.map((m) => chromeSeesCover(m.getAttribute("content")))).toEqual([false, false]);

    const none = fakePage({ ua: UA.chromeIphone, metas: [] });
    expect(fitViewportForChromeOnIos(none.doc, none.win)).toBe(false);
    const plain = fakePage({ ua: UA.chromeIphone, metas: [fakeMeta("width=device-width, initial-scale=1"), fakeMeta(null)] });
    expect(fitViewportForChromeOnIos(plain.doc, plain.win)).toBe(false);
    expect(plain.metas[0].getAttribute("content")).toBe("width=device-width, initial-scale=1");
    expect(plain.metas[1].getAttribute("content")).toBeNull();
  });
  it("is safe to run twice", () => {
    const page = fakePage({ ua: UA.chromeIphone });
    expect(fitViewportForChromeOnIos(page.doc, page.win)).toBe(true);
    expect(fitViewportForChromeOnIos(page.doc, page.win)).toBe(false);
    expect(page.metas[0].getAttribute("content")).toBe("width=device-width, initial-scale=1.0");
  });
  it("never throws", () => {
    const broken = { querySelectorAll: () => { throw new Error("broken document"); } };
    expect(fitViewportForChromeOnIos(broken, fakePage({ ua: UA.chromeIphone }).win)).toBe(false);
    expect(fitViewportForChromeOnIos(fakePage({ ua: UA.chromeIphone }).doc, { navigator: {} })).toBe(false);
  });
});

describe("wiring", () => {
  it("index.html still asks for cover, for Safari and the installed app", () => {
    const tag = indexHtml.match(/<meta name="viewport" content="([^"]*)"/);
    expect(tag?.[1]).toBe(INDEX_HTML_VIEWPORT);
  });
  it("main.tsx fixes the tag before React renders anything", () => {
    const main = mainSource;
    const call = main.indexOf("\nfitViewportForChromeOnIos()");
    expect(call).toBeGreaterThan(0);
    expect(call).toBeLessThan(main.indexOf("createRoot("));
    expect(call).toBeLessThan(main.indexOf("registerSW("));
  });
});
