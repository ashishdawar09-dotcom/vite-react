// Date-only columns (e.g. tournaments.event_date) arrive as "YYYY-MM-DD".
// `new Date("2026-11-21")` parses that as UTC midnight, which is the previous
// evening in Pacific time, so the weekday and day render one day early.
// These helpers build the Date from the calendar parts in local time instead.

const YMD = /^(\d{4})-(\d{2})-(\d{2})/;

/** Parse a "YYYY-MM-DD" string as a local calendar date, or null if it isn't one. */
export function parseLocalDate(ymd: string | null | undefined): Date | null {
  const m = ymd ? YMD.exec(ymd) : null;
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format a "YYYY-MM-DD" string as a local calendar date. Returns the input unchanged if it can't be parsed. */
export function formatLocalDate(
  ymd: string,
  options: Intl.DateTimeFormatOptions,
  locale?: string | string[],
): string {
  const d = parseLocalDate(ymd);
  return d ? d.toLocaleDateString(locale, options) : ymd;
}

/** Today's local calendar date as "YYYY-MM-DD", for comparing against date-only columns. */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
