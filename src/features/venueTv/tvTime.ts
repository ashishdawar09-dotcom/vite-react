// Times on the venue TV.
//
// British Columbia stays on UTC-7 after Nov 1, 2026, but many smart TV
// browsers carry old time zone data and would show America/Vancouver an hour
// early (UTC-8). The TV is only ever used at the venue, so it formats every
// time in a fixed UTC-7 zone. "Etc/GMT+7" is the IANA name for UTC-7 (the
// sign is inverted by convention).
export const TV_TIME_ZONE = "Etc/GMT+7";

const clockFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TV_TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true });

/** "2:05" (no am/pm), in venue time. */
export function hm(ms: number): string {
  const parts = clockFmt.formatToParts(new Date(ms));
  const h = parts.find(p => p.type === "hour")?.value ?? "";
  const m = parts.find(p => p.type === "minute")?.value ?? "";
  return `${h}:${m}`;
}

/** "am" or "pm", in venue time. */
export function ampm(ms: number): "am" | "pm" {
  const parts = clockFmt.formatToParts(new Date(ms));
  const p = (parts.find(x => x.type === "dayPeriod")?.value ?? "").toLowerCase();
  return p.startsWith("p") ? "pm" : "am";
}

/**
 * The TV's own clock can be minutes off. The feed carries the server's time
 * (generated_at, seconds since the epoch), so the TV keeps the offset and uses
 * server time for the clock, countdowns and estimates.
 */
export function clockSkewMs(generatedAtSec: number | null | undefined, receivedAtMs: number): number {
  if (typeof generatedAtSec !== "number" || !Number.isFinite(generatedAtSec) || generatedAtSec <= 0) return 0;
  const skew = generatedAtSec * 1000 - receivedAtMs;
  // A snapshot served from the CDN can be a few seconds old; ignore small
  // differences so the clock doesn't jitter, and cap absurd ones.
  if (Math.abs(skew) < 15_000 || Math.abs(skew) > 12 * 3_600_000) return 0;
  return skew;
}
