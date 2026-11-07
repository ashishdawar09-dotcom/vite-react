// Chrome on iPhone and the top of the page (Nov 7, 2026).
//
// index.html asks for `viewport-fit=cover` so the installed app can draw
// under the status bar. Chrome on iOS reads the viewport tag when the page
// loads, and again whenever <head> changes (Chromium
// ios/web/js_features/fullscreen/resources/fullscreen.ts). When the tag has
// `viewport-fit=cover`, Chrome stretches the page over the whole screen.
// Then, as its address bar shrinks at the top of the page, the top of the
// registration form slid under the bar and could not be scrolled back into
// view (screen recording, iPhone 17 Pro Max, Nov 7).
//
// So in Chrome on iOS, and only there, the tag loses `viewport-fit` before
// the page finishes loading. Chrome then lays the page out below its bars,
// as it does for nearly every other site. Safari and the installed app
// keep `cover`.

type ViewportMeta = Pick<Element, "getAttribute" | "setAttribute">;
type ViewportDocument = { querySelectorAll(selector: string): ArrayLike<ViewportMeta> };
type ViewportWindow = {
  navigator: { userAgent?: string; standalone?: boolean };
  matchMedia?: (query: string) => { matches: boolean };
};

/** Chrome on iPhone or iPad. Its user agent carries "CriOS/<version>". */
export function isChromeOnIos(userAgent: string): boolean {
  return /\bCriOS\/\d/.test(userAgent);
}

/** The viewport tag's content without its `viewport-fit` entry. */
export function withoutViewportFit(content: string): string {
  return content
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "" && entry.split("=")[0].trim().toLowerCase() !== "viewport-fit")
    .join(", ");
}

function runsAsInstalledApp(win: ViewportWindow): boolean {
  if (win.navigator.standalone === true) return true;
  try {
    return win.matchMedia?.("(display-mode: standalone)").matches === true;
  } catch {
    return false;
  }
}

/**
 * Drops `viewport-fit` from the viewport tag in Chrome on iOS, unless the page
 * runs as the installed app. Call it before the page's load event. Returns
 * true when it changed the tag. Never throws.
 */
export function fitViewportForChromeOnIos(
  doc: ViewportDocument = document,
  win: ViewportWindow = window as unknown as ViewportWindow,
): boolean {
  try {
    if (!isChromeOnIos(win.navigator.userAgent || "")) return false;
    if (runsAsInstalledApp(win)) return false;
    let changed = false;
    const metas = doc.querySelectorAll('meta[name="viewport"]');
    for (let i = 0; i < metas.length; i++) {
      const meta = metas[i];
      const content = meta.getAttribute("content");
      if (!content || !/viewport-fit/i.test(content)) continue;
      meta.setAttribute("content", withoutViewportFit(content));
      changed = true;
    }
    return changed;
  } catch {
    // The page works either way; this only changes where Chrome draws it.
    return false;
  }
}
