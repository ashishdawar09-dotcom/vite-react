import React, { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion"; /* NEW: live-court pulse */
import type { Category, ProjectedMatch, Team, Player } from "../types";
import { fmtElapsed } from "../hooks/useScheduling";

/**
 * Three-state per-court display:
 *   🟢 FREE        — no allocation, no live match
 *   🟡 WARMING UP  — court allocated, scoring not yet begun (variable duration)
 *   🔴 IN PLAY     — match live (current play clock running)
 *
 * `liveByCourt` keys are the courts with status="live". For warming-up courts,
 * the caller passes `warmingByCourt` (matches with court_allocated_at set and
 * started_at null). Both maps are needed because the projection only tags
 * one of the two states.
 */
export const CourtStatus = React.memo(function CourtStatus({
  numCourts,
  liveByCourt,
  warmingByCourt,
  categories,
  teamById,
}: {
  numCourts: number;
  liveByCourt: Record<number, ProjectedMatch | undefined>;
  /** Matches with court_allocated_at set but not yet started (warm-up state). */
  warmingByCourt?: Record<number, ProjectedMatch | undefined>;
  categories: Category[];
  teamById: Record<string, (Team & { p1: Player; p2: Player | null }) | undefined>;
}) {
  const [now, setNow] = useState(Date.now());
  const reduceMotion = useReducedMotion(); /* NEW: motion gate for IN-PLAY pulse */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const catById = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories]);
  const courts = useMemo(
    () => Array.from({ length: Math.max(1, numCourts) }, (_, i) => i + 1),
    [numCourts],
  );
  const warming = warmingByCourt ?? {};

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ width: 4, height: 18, background: "#00d4ff", borderRadius: 1 }} />
        {/* h2 (not h3) so the heading hierarchy on the spectator page goes
            h1 (PublicPageShell tournament name) -> h2 (this section) without
            skipping h2. Same visual styling. */}
        <h2 className="font-display" style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#fff", letterSpacing: 1.5, textTransform: "uppercase" }}>Court Status</h2>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill,minmax(${courts.length === 1 ? 200 : 240}px,1fr))`, gap: 10 }}>
        {courts.map(n => {
          const live = liveByCourt[n];
          const warm = !live ? warming[n] : undefined;
          // Either live OR warming OR free. Live takes precedence (shouldn't
          // happen in practice — a court is live OR warming, never both).
          const m = live ?? warm;
          const isLive = !!live;
          const isWarming = !!warm && !live;
          const cat = m ? catById[m.category_id] : null;
          const ta = m?.team_a_id ? teamById[m.team_a_id] : null;
          const tb = m?.team_b_id ? teamById[m.team_b_id] : null;
          const matchMin = cat?.match_minutes ?? 12;
          const elapsed = isLive && m?.started_at ? (now - new Date(m.started_at).getTime()) / 60000 : 0;
          const over = isLive && elapsed > matchMin;
          const wayOver = isLive && elapsed > matchMin + 3;

          // Background + border by state
          let bg: string, border: string;
          if (isLive) {
            bg = wayOver ? "linear-gradient(135deg,#3a0c0c,#1f0808)"
               : over   ? "linear-gradient(135deg,#3a2a0c,#1f1408)"
                        : "linear-gradient(135deg,#0c2a3a,#081f2e)";
            border = `1px solid ${wayOver ? "#ef4444" : over ? "#f59e0b" : "#00d4ff"}`;
          } else if (isWarming) {
            bg = "linear-gradient(135deg,#3a2e0c,#1f1908)"; // amber-ish
            border = "1px solid #fbbf24";
          } else {
            bg = "#0f1e36";
            border = "1px solid #1a3050";
          }

          return (
            <div key={n} style={{ background: bg, border, borderRadius: 8, padding: 14, minHeight: 88 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span className="font-display" style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: 2 }}>COURT {n}</span>
                {isLive ? (
                  /* MAKEOVER: pulsing red dot beside the elapsed time, broadcast feel from across a gym */
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <motion.span
                      aria-hidden
                      style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: wayOver ? "#ef4444" : over ? "#fbbf24" : "#ef4444", boxShadow: `0 0 6px ${wayOver ? "#ef4444" : over ? "#fbbf24" : "#ef4444"}` }}
                      animate={reduceMotion ? undefined : { opacity: [1, 0.4, 1] }}
                      transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                    />
                    <span className="font-display" style={{ fontSize: 13, fontWeight: 800, color: wayOver ? "#ef4444" : over ? "#fbbf24" : "#00d4ff", letterSpacing: 0.5 }}>{fmtElapsed(m!.started_at, now)}</span>
                  </span>
                ) : isWarming ? (
                  <span className="font-display" style={{ fontSize: 10, fontWeight: 700, color: "#fbbf24", letterSpacing: 2, padding: "2px 8px", background: "rgba(251,191,36,0.1)", borderRadius: 3, border: "1px solid rgba(251,191,36,0.3)" }}>
                    🟡 WARMING UP · {fmtElapsed(m!.court_allocated_at, now)}
                  </span>
                ) : (
                  <span className="font-display" style={{ fontSize: 10, fontWeight: 700, color: "#22c55e", letterSpacing: 2, padding: "2px 8px", background: "rgba(34,197,94,0.1)", borderRadius: 3, border: "1px solid rgba(34,197,94,0.3)" }}>FREE</span>
                )}
              </div>
              {m ? (
                <>
                  <div style={{ fontSize: 11, color: "#cbd5e1", marginBottom: 4, fontWeight: 600 }}>
                    {cat?.name?.toUpperCase()} · {m.stage === "group" ? `GROUP ${String.fromCharCode(65 + (m.group_idx ?? 0))}` : `RD ${(m.round_idx ?? 0) + 1}`}
                  </div>
                  <div style={{ fontSize: 13, color: "#fff", fontWeight: 700, lineHeight: 1.3 }}>
                    {tName(ta)} <span style={{ color: isWarming ? "#fbbf24" : "#ef4444" }}>vs</span> {tName(tb)}
                  </div>
                  {isLive && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                      <span className="font-display" style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: 1 }}>{m.score_a ?? 0}–{m.score_b ?? 0}</span>
                      {wayOver && <span className="font-display" style={{ fontSize: 10, fontWeight: 800, color: "#ef4444", letterSpacing: 1.5 }}>OVERTIME</span>}
                      {over && !wayOver && <span className="font-display" style={{ fontSize: 10, fontWeight: 800, color: "#fbbf24", letterSpacing: 1.5 }}>OVER {Math.round(elapsed - matchMin)}M</span>}
                    </div>
                  )}
                  {isWarming && (
                    <div className="font-display" style={{ fontSize: 10, fontWeight: 700, color: "#fbbf24", letterSpacing: 1.5, marginTop: 6 }}>
                      WAITING TO BEGIN SCORING
                    </div>
                  )}
                </>
              ) : (
                // Color bumped from #475569 to #94A3B8 in the 2026-05-25 perf
                // pass — Lighthouse flagged the prior value as 2.2:1 contrast
                // (italic 12px on the #0f1e36 elevated surface). #94A3B8 gives
                // ~5.8:1 and still reads as a "muted hint".
                <div style={{ fontSize: 12, color: "#94A3B8", fontStyle: "italic", marginTop: 4 }}>Available for next match</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

function tName(t: (Team & { p1: Player; p2: Player | null }) | null | undefined): string {
  if (!t || !t.p1) return "TBD";
  return t.p2 ? `${t.p1.name} & ${t.p2.name}` : t.p1.name;
}
