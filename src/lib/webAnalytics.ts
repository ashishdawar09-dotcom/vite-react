// Vercel Web Analytics: cookieless page-view counts for the public pages.
//
// The admin app and the payments page aren't counted, so directors checking
// the roster don't inflate visitor numbers. The partner waiver link carries a
// private consent token, so its path is sent with the token blanked out.

import type { BeforeSendEvent } from "@vercel/analytics/react";

const PUBLIC_PATH = /^\/(register|waiver|t|p)(\/|$)/;

export function webAnalyticsBeforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  let url: URL;
  try { url = new URL(event.url); } catch { return null; }
  if (!PUBLIC_PATH.test(url.pathname)) return null;
  if (url.pathname.startsWith("/waiver/")) url.pathname = "/waiver/[token]";
  return { ...event, url: url.toString() };
}
