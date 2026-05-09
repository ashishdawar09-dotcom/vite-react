import type { Match } from "../types";

export type KnockoutSanityProps = {
  /** All knockout matches in the current category. */
  knockoutMatches: Match[];
  /** Total qualifiers expected (groups × topNAdvance). */
  expectedQualifiers: number;
  /** Actual qualifiers placed in round 1 (excluding nulls). */
  actualQualifiers: number;
};

/**
 * Status indicator above the knockout bracket. Surfaces:
 *   ✓ Clean — bracket is full and balanced (no byes, no TBDs)
 *   ⚠ Byes — bracket has bye matches (auto-advancing teams)
 *   ⚠ TBDs — round-1 slots that aren't filled (admin needs to populate)
 *
 * Returns null when the bracket is clean (no banner needed).
 */
export function KnockoutSanityBanner({ knockoutMatches, expectedQualifiers, actualQualifiers }: KnockoutSanityProps) {
  const round1 = knockoutMatches.filter(m => m.round_idx === 0);
  const byes = round1.filter(m => m.is_bye).length;
  // TBD slots = round-1 matches whose team_a or team_b is null AND it's not a bye.
  const tbds = round1.filter(m => !m.is_bye && (m.team_a_id == null || m.team_b_id == null)).length;

  const isClean = byes === 0 && tbds === 0 && actualQualifiers === expectedQualifiers;
  if (isClean) return null;

  const status: "byes" | "tbds" | "incomplete" =
    tbds > 0 ? "tbds" : byes > 0 ? "byes" : "incomplete";

  const config = {
    byes: {
      color: "#fbbf24",
      bg: "rgba(251,191,36,0.08)",
      border: "rgba(251,191,36,0.4)",
      icon: "⚠",
      title: `${byes} bye${byes === 1 ? "" : "s"} in this bracket`,
      desc: byes === 1
        ? "One top seed advances directly to the next round. To balance the bracket, consider re-running the format with different group settings."
        : `${byes} top seeds advance directly to the next round. To balance the bracket, consider re-running the format with different group settings.`,
    },
    tbds: {
      color: "#ef4444",
      bg: "rgba(239,68,68,0.08)",
      border: "rgba(239,68,68,0.4)",
      icon: "✕",
      title: `${tbds} empty slot${tbds === 1 ? "" : "s"} in round 1`,
      desc: "Some bracket positions don't have a team assigned. Click the empty slot below to select a team manually.",
    },
    incomplete: {
      color: "#3b82f6",
      bg: "rgba(59,130,246,0.08)",
      border: "rgba(59,130,246,0.4)",
      icon: "ℹ",
      title: `${actualQualifiers} of ${expectedQualifiers} qualifiers placed`,
      desc: "Bracket is not fully populated. Use the Promote Team button on each empty slot.",
    },
  }[status];

  return (
    <div style={{ background: config.bg, border: `1px solid ${config.border}`, borderRadius: 10, padding: "14px 18px", marginBottom: 16, display: "flex", alignItems: "flex-start", gap: 14 }}>
      <span style={{ fontSize: 24, color: config.color, lineHeight: 1, marginTop: 2 }}>{config.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="font-display" style={{ fontSize: 13, fontWeight: 800, color: config.color, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
          {config.title}
        </div>
        <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.5 }}>{config.desc}</div>
      </div>
    </div>
  );
}
