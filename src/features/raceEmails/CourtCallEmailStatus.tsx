import { useEffect, useState } from "react";
import * as db from "../../lib/db";
import { courtCallSettled, summarizeCourtCall, type CourtCallSummary } from "./model";

/**
 * Admin-only line on a warming-up match card: did the "Court N is yours"
 * email reach every player? Delivery comes back from Resend through the
 * resend-webhook function, usually within seconds. A bounce, a missing
 * address or a failed send turns it red so the desk can find the player in
 * person. Checks every 15 seconds while the court is waiting, and stops once
 * every email has an answer.
 */
export function CourtCallEmailStatus({
  matchId,
  allocatedAt,
  names,
  tone = "light",
}: {
  matchId: string;
  allocatedAt: string | null;
  names: [string, string][];
  /** "dark" on the navy Matches tab, "light" on the white match cards. */
  tone?: "light" | "dark";
}) {
  const [summary, setSummary] = useState<CourtCallSummary | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const nameKey = JSON.stringify(names);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const nameById = new Map(JSON.parse(nameKey) as [string, string][]);
    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") {
        try {
          const s = summarizeCourtCall(await db.getCourtCallEmails(matchId), allocatedAt, nameById);
          if (stop) return;
          setSummary(s);
          if (courtCallSettled(s)) return;
        } catch (e) {
          // 42703: the delivery columns aren't there yet (database update not applied).
          if ((e as { code?: string })?.code === "42703") { setUnavailable(true); return; }
        }
      }
      timer = setTimeout(tick, 15_000);
    };
    // First look a few seconds after the call, when the emails have gone out.
    timer = setTimeout(tick, 4_000);
    return () => { stop = true; clearTimeout(timer); };
  }, [matchId, allocatedAt, nameKey]);

  if (unavailable || !summary) return null;
  const palette = {
    light: { wait: ["#f8fafc", "#e2e8f0", "#64748b"], warn: ["#fffbeb", "#fcd34d", "#92400e"], bad: ["#fef2f2", "#fca5a5", "#b91c1c"], good: ["#f0fdf4", "#bbf7d0", "#15803d"] },
    dark: { wait: ["transparent", "#1a3050", "#94a3b8"], warn: ["rgba(251,191,36,0.1)", "rgba(251,191,36,0.4)", "#fbbf24"], bad: ["rgba(239,68,68,0.14)", "#ef4444", "#fecaca"], good: ["rgba(34,197,94,0.1)", "rgba(34,197,94,0.35)", "#4ade80"] },
  }[tone];
  const box = ([bg, border, color]: string[]): React.CSSProperties => ({
    marginTop: tone === "dark" ? 0 : 10, padding: "8px 10px", borderRadius: 8, background: bg, border: `1px solid ${border}`,
    color, fontSize: 12.5, fontWeight: 600, lineHeight: 1.45, width: tone === "dark" ? "100%" : undefined, boxSizing: "border-box",
  });

  if (summary.kind === "waiting") {
    return <div data-testid="court-call-email" style={box(palette.wait)}>✉️ Court-call emails going out…</div>;
  }
  if (summary.kind === "none") {
    return (
      <div data-testid="court-call-email" role="alert" style={box(palette.warn)}>
        ✉️ No court-call email went out for this match. Tell the players in person.
      </div>
    );
  }
  if (summary.kind === "problem") {
    return (
      <div data-testid="court-call-email" role="alert" style={box(palette.bad)}>
        ✉️ The court call didn't reach{" "}
        {summary.problems.map((p, i) => (
          <span key={i}>{i ? ", " : ""}<strong>{p.name}</strong> ({p.reason})</span>
        ))}
        . Find them in person.
      </div>
    );
  }
  const all = summary.delivered === summary.total;
  return (
    <div data-testid="court-call-email" style={box(all ? palette.good : palette.wait)}>
      ✉️ {all
        ? `Court call delivered to ${summary.total === 1 ? "the player" : `all ${summary.total} players`}`
        : `Court call sent to ${summary.total} · ${summary.delivered} delivered so far${summary.delayed ? ` · ${summary.delayed} delayed` : ""}`}
    </div>
  );
}
