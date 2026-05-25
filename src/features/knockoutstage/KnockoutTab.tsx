import { motion, useReducedMotion } from "framer-motion"; /* NEW: bracket reveal */
import { CategoryFilter } from "../../components/CategoryFilter";
import { KnockoutSanityBanner } from "../../components/KnockoutSanityBanner";
import type { Category, Match, TeamWithPlayers } from "../../types";

/**
 * Knockout bracket view. Renders the rounds horizontally, surfaces the
 * sanity banner when bye/TBD slots are present, and pins a Champions
 * card at the top once the final is confirmed.
 *
 * MatchCard is passed in (rather than imported) because it currently
 * closes over App-level state — keeping it inside App.tsx avoids
 * threading 15+ props through every tab that uses it.
 */
function roundName(numRounds: number, i: number, hasBronze: boolean): string {
  if (i === numRounds - 1) return hasBronze ? "🏆 Final · 🥉 3rd Place" : "🏆 Final";
  if (i === numRounds - 2) return "Semi-Final";
  if (i === numRounds - 3) return "Quarter-Final";
  return `Round ${i + 1}`;
}

export function KnockoutTab({
  categories,
  currentCategoryId,
  setCurrentCategoryId,
  currentCategory,
  groups,
  knockout,
  knockoutMatches,
  champion,
  MatchCard,
}: {
  categories: Category[];
  currentCategoryId: string | null;
  setCurrentCategoryId: (id: string | null) => void;
  currentCategory: Category | null;
  groups: TeamWithPlayers[][];
  knockout: Match[][];
  knockoutMatches: Match[];
  champion: TeamWithPlayers | null;
  MatchCard: React.ComponentType<{ match: Match; editable?: boolean; matchMinutes?: number }>;
}) {
  const reduceMotion = useReducedMotion();
  const expectedQualifiers = currentCategory
    ? Math.max(0, (currentCategory.groups_count || groups.length) * (currentCategory.top_n_advance || 2))
    : 0;
  const round1Matches = knockoutMatches.filter(m => m.round_idx === 0);
  const actualQualifiers = round1Matches.reduce(
    (n, m) => n + (m.team_a_id ? 1 : 0) + (m.team_b_id ? 1 : 0), 0,
  );

  return (
    <div>
      <CategoryFilter categories={categories} currentCategoryId={currentCategoryId} onSelect={setCurrentCategoryId} />

      {champion && (
        <div style={{ textAlign: "center", padding: 32, background: "linear-gradient(135deg,#fef3c7,#fde68a,#fef3c7)", borderRadius: 20, border: "3px solid #f59e0b", marginBottom: 28 }}>
          <div style={{ fontSize: 56, marginBottom: 8 }}>🏆</div>
          <div style={{ fontWeight: 900, fontSize: 14, color: "#b45309", textTransform: "uppercase", letterSpacing: 3 }}>Champions</div>
          <div style={{ fontWeight: 900, fontSize: 22, color: "#78350f", marginTop: 10 }}>
            {champion.p2 ? `${champion.p1.name} & ${champion.p2.name}` : champion.p1.name}
          </div>
        </div>
      )}

      {!champion && knockoutMatches.length > 0 && (
        <KnockoutSanityBanner
          knockoutMatches={knockoutMatches}
          expectedQualifiers={expectedQualifiers}
          actualQualifiers={actualQualifiers}
        />
      )}

      {/* Bracket reveal — columns sweep in left-to-right with a small slide;
         cards fade-up inside each column. Gives the feel of the bracket
         drawing itself round by round on first paint. Reduced-motion: static. */}
      <div style={{ overflowX: "auto", paddingBottom: 20 }}>
        <div style={{ display: "flex", gap: 0, minWidth: knockout.length * 290 }}>
          {knockout.map((round, ri) => {
            const isFinalRound = ri === knockout.length - 1;
            const hasBronze = round.some(m => m.is_bronze);
            return (
              <motion.div
                key={ri}
                initial={reduceMotion ? false : { opacity: 0, x: -16 }}
                animate={reduceMotion ? false : { opacity: 1, x: 0 }}
                transition={reduceMotion ? undefined : { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const, delay: ri * 0.12 }}
                style={{ flex: 1, minWidth: 270, display: "flex", flexDirection: "column" }}
              >
                <div style={{ textAlign: "center", fontWeight: 800, color: "#1a1a2e", fontSize: 13, textTransform: "uppercase", letterSpacing: 1, padding: "10px 12px", background: "linear-gradient(90deg,#e0e7ff,#ede9fe,#e0e7ff)", borderRadius: 10, margin: "0 8px 16px" }}>
                  {roundName(knockout.length, ri, hasBronze)}
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-around", gap: 14, padding: "0 8px" }}>
                  {round.map((m, mi) => {
                    // Per-card subtitle for the final round when bronze is present;
                    // distinguishes 🏆 Final from 🥉 3rd Place at a glance.
                    const subtitle = isFinalRound && hasBronze
                      ? (m.is_bronze ? "🥉 3RD PLACE" : "🏆 FINAL")
                      : null;
                    return (
                      <motion.div
                        key={m.id}
                        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                        animate={reduceMotion ? false : { opacity: 1, y: 0 }}
                        transition={reduceMotion ? undefined : { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const, delay: ri * 0.12 + 0.18 + mi * 0.04 }}
                      >
                        {subtitle && (
                          <div style={{
                            textAlign: "center",
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: 1.5,
                            color: m.is_bronze ? "#b45309" : "#f59e0b",
                            marginBottom: 6,
                            textTransform: "uppercase",
                          }}>{subtitle}</div>
                        )}
                        <MatchCard match={m} editable={!m.is_bye} matchMinutes={currentCategory?.match_minutes} />
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
