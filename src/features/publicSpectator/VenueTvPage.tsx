import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LottieLoader } from "../../components/ui/lottie-loader";
import { fmtClock } from "../../hooks/useScheduling";
import { usePublicTournament } from "./usePublicTournament";
import { derivePublicTournamentState } from "./publicDerive";
import type { Category, ProjectedMatch } from "../../types";

/**
 * Venue-TV hero card — /t/:slug/tv
 *
 * A simplified, high-contrast layout meant for a TV pointed at the courts.
 * No interactions. Three blocks:
 *   - LIVE — biggest visual weight, one card per live court
 *   - NEXT UP — court projections for the next three matches
 *   - PROGRESS — matches played / total + projected event-end clock
 *
 * Polls live_snapshot every 5s via usePublicTournament (same as the
 * spectator page). One-second wall-clock heartbeat for the running clock.
 */
export function VenueTvPage() {
  const { slug } = useParams<{ slug: string }>();
  const ctx = usePublicTournament(slug);

  // 1-second wall-clock heartbeat — drives the "now" clock + relative
  // "starts in 3m" labels. Separate from the 15s scheduling tick.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const derived = useMemo(() => {
    if (!ctx.tournament) return null;
    return derivePublicTournamentState(ctx.players, ctx.teams, ctx.matches, ctx.categories);
  }, [ctx.tournament, ctx.players, ctx.teams, ctx.matches, ctx.categories]);

  if (ctx.resolving || (!ctx.notFound && !derived)) {
    return <LottieLoader fullScreen label="Loading venue view…" />;
  }
  if (ctx.notFound || !ctx.tournament || !derived) {
    return (
      <div style={fullScreenStyle}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 64, marginBottom: 12 }}>🏸</div>
          <h1 className="font-display" style={{ fontSize: 32, letterSpacing: 1 }}>Tournament not found</h1>
        </div>
      </div>
    );
  }

  const tName = (id: string | null): string => {
    if (!id) return "TBD";
    const t = derived.allTeamById[id];
    if (!t?.p1) return "TBD";
    return t.p2 ? `${t.p1.name} & ${t.p2.name}` : t.p1.name;
  };
  const catById = Object.fromEntries(ctx.categories.map(c => [c.id, c])) as Record<string, Category>;

  const live = ctx.projected.filter(m => m.status === "live");
  const upcoming = ctx.projected
    .filter(m => m.status === "pending" && !m.confirmed && m.team_a_id && m.team_b_id && !m.is_bye)
    .sort((a, b) => new Date(a.projected_start_at ?? 0).getTime() - new Date(b.projected_start_at ?? 0).getTime())
    .slice(0, 3);
  const totalMatches = ctx.matches.filter(m => m.team_a_id && m.team_b_id && !m.is_bye).length;
  const matchesPlayed = ctx.matches.filter(m => m.confirmed).length;

  // Projected event-end clock: latest projected start across pending matches
  // + that match's category match_minutes. Falls back to "—" if nothing is
  // currently queued. The court projection in useScheduling already accounts
  // for queue depth, so the last-scheduled start is the practical event end.
  const projectedEndMs = (() => {
    const candidates: number[] = [];
    for (const m of ctx.projected) {
      if (m.confirmed || m.is_bye) continue;
      const start = m.projected_start_at ? new Date(m.projected_start_at).getTime() : null;
      if (start === null) continue;
      const cat = catById[m.category_id];
      const dur = (cat?.match_minutes ?? 12) + (m.extended_minutes ?? 0);
      candidates.push(start + dur * 60_000);
    }
    return candidates.length > 0 ? Math.max(...candidates) : null;
  })();

  const minutesUntilEnd = projectedEndMs !== null
    ? Math.max(0, Math.round((projectedEndMs - now.getTime()) / 60_000))
    : null;
  const eventEndLabel = projectedEndMs !== null
    ? new Date(projectedEndMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "—";

  return (
    <div style={{ ...fullScreenStyle, padding: "max(env(safe-area-inset-top), 18px) 24px max(env(safe-area-inset-bottom), 18px)" }}>
      {/* Top bar — tournament name + clock */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, marginBottom: 18 }}>
        <div>
          <div className="font-display" style={{ fontSize: 11, letterSpacing: 2, color: "#00d4ff", textTransform: "uppercase", fontWeight: 700 }}>Live · Venue View</div>
          <h1 className="font-display" style={{ margin: "4px 0 0", fontSize: "clamp(28px, 3.6vw, 56px)", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", lineHeight: 1 }}>
            {ctx.tournament.name}
          </h1>
        </div>
        <div className="font-display" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Now</div>
          <div style={{ fontSize: "clamp(28px, 3vw, 48px)", fontWeight: 700, color: "#fff", lineHeight: 1 }}>
            {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </div>
        </div>
      </div>

      {/* LIVE block */}
      {live.length > 0 ? (
        <section style={{ marginBottom: 18 }}>
          <BlockHeader accent="#ef4444" label="🔴 Live Now" right={`${live.length} on court`} />
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(live.length, 2)}, minmax(0, 1fr))`,
            gap: 14,
          }}>
            {live.map(m => <LiveScoreCard key={m.id} m={m} tName={tName} catById={catById} />)}
          </div>
        </section>
      ) : (
        <section style={{ marginBottom: 18, padding: 28, background: "#0a1628", borderRadius: 14, border: "1px dashed #1a3050", textAlign: "center", color: "#64748b" }}>
          <div className="font-display" style={{ fontSize: 14, letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 }}>No matches live right now</div>
        </section>
      )}

      {/* NEXT UP + PROGRESS row */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 14, alignItems: "stretch" }}>
        <section>
          <BlockHeader accent="#00d4ff" label="▸ Next Up" right={upcoming.length === 0 ? "queue clear" : `${upcoming.length} match${upcoming.length === 1 ? "" : "es"}`} />
          <div style={{ background: "#0f1e36", borderRadius: 12, border: "1px solid #1a3050", overflow: "hidden" }}>
            {upcoming.length === 0 ? (
              <div style={{ padding: 28, textAlign: "center", color: "#64748b" }}>
                <span className="font-display" style={{ fontSize: 14, letterSpacing: 2, fontWeight: 700, textTransform: "uppercase" }}>Schedule clear</span>
              </div>
            ) : upcoming.map((m, i) => (
              <UpNextRow key={m.id} m={m} catName={catById[m.category_id]?.name ?? ""} tName={tName} isNext={i === 0} />
            ))}
          </div>
        </section>

        <section>
          <BlockHeader accent="#22c55e" label="Progress" />
          <div style={{ background: "#0f1e36", borderRadius: 12, border: "1px solid #1a3050", padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
            <Stat label="Played" big={
              <>
                <span style={{ color: "#22c55e" }}>{String(matchesPlayed).padStart(2, "0")}</span>
                <span style={{ color: "#475569", margin: "0 6px" }}>/</span>
                <span style={{ color: "#cbd5e1" }}>{String(totalMatches).padStart(2, "0")}</span>
              </>
            } />
            <div style={{ height: 6, background: "#0a1628", borderRadius: 3, overflow: "hidden", border: "1px solid #1a3050" }}>
              <div style={{ width: totalMatches > 0 ? `${Math.round(matchesPlayed / totalMatches * 100)}%` : "0%", height: "100%", background: "linear-gradient(90deg,#00b8ff,#22c55e)", transition: "width .4s" }} />
            </div>
            <Stat
              label="Projected end"
              big={eventEndLabel}
              sub={minutesUntilEnd !== null ? `~${minutesUntilEnd} min remaining` : undefined}
            />
            <Stat label="Courts" big={`${ctx.numCourts}`} sub={live.length > 0 ? `${live.length} active` : "idle"} />
          </div>
        </section>
      </div>

      {/* Footer / back link */}
      <div style={{ marginTop: 20, textAlign: "center" }}>
        <Link to={`/t/${ctx.tournament.slug}`} style={{ color: "#64748b", fontSize: 12, textDecoration: "none" }}>
          ← back to full spectator view
        </Link>
      </div>
    </div>
  );
}

const fullScreenStyle: React.CSSProperties = {
  minHeight: "100dvh",
  background: "linear-gradient(180deg,#070F1F 0%,#0a1628 100%)",
  color: "#fff",
  fontFamily: "'Inter Variable', system-ui, sans-serif",
};

function BlockHeader({ accent, label, right }: { accent: string; label: string; right?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
      <div style={{ width: 5, height: 22, background: accent, borderRadius: 1 }} />
      <h2 className="font-display" style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#fff" }}>{label}</h2>
      {right && (
        <span className="font-display" style={{ marginLeft: "auto", fontSize: 11, letterSpacing: 2, color: accent, fontWeight: 700, textTransform: "uppercase" }}>{right}</span>
      )}
    </div>
  );
}

function LiveScoreCard({ m, tName, catById }: { m: ProjectedMatch; tName: (id: string | null) => string; catById: Record<string, Category> }) {
  const sa = m.score_a ?? 0;
  const sb = m.score_b ?? 0;
  const aLeading = sa > sb;
  const bLeading = sb > sa;
  return (
    <div style={{
      background: "linear-gradient(135deg,#0f1e36,#11243f)",
      borderRadius: 14,
      border: "1px solid #1a3050",
      borderLeft: "4px solid #ef4444",
      padding: 18,
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="font-display" style={{ fontSize: 12, letterSpacing: 2, color: "#00d4ff", fontWeight: 700, textTransform: "uppercase" }}>
          Court {m.court_number ?? "—"} · {catById[m.category_id]?.name ?? ""}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#ef4444", letterSpacing: 2, textTransform: "uppercase" }}>
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#ef4444", boxShadow: "0 0 8px #ef4444" }} />
          Live
        </span>
      </div>
      <ScoreRow leading={aLeading} team={tName(m.team_a_id)} score={sa} />
      <div style={{ height: 1, background: "linear-gradient(90deg,transparent,#1a3050,transparent)" }} />
      <ScoreRow leading={bLeading} team={tName(m.team_b_id)} score={sb} />
    </div>
  );
}

function ScoreRow({ leading, team, score }: { leading: boolean; team: string; score: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <span style={{
        flex: 1,
        fontSize: "clamp(20px, 1.8vw, 28px)",
        fontWeight: leading ? 800 : 600,
        color: leading ? "#fff" : "#cbd5e1",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>{team}</span>
      <span className="font-display" style={{
        minWidth: "1.6em",
        textAlign: "right",
        fontSize: "clamp(48px, 6vw, 96px)",
        fontWeight: 700,
        color: leading ? "#00d4ff" : "#94a3b8",
        fontVariantNumeric: "tabular-nums",
        letterSpacing: -1,
        lineHeight: 0.9,
      }}>{score}</span>
    </div>
  );
}

function UpNextRow({ m, catName, tName, isNext }: { m: ProjectedMatch; catName: string; tName: (id: string | null) => string; isNext: boolean }) {
  const isWarming = !!m.court_allocated_at && !m.started_at;
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "14px 18px",
      borderBottom: "1px solid #1a3050",
      background: isWarming ? "rgba(251,191,36,0.06)" : isNext ? "rgba(0,212,255,0.05)" : "transparent",
      position: "relative",
    }}>
      {(isWarming || isNext) && <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 3, background: isWarming ? "#fbbf24" : "#00d4ff" }} />}
      <div className="font-display" style={{ minWidth: 110, fontSize: 11, fontWeight: 700, color: isWarming ? "#fbbf24" : isNext ? "#00d4ff" : "#64748b", letterSpacing: 1.5, textTransform: "uppercase" }}>
        {isWarming ? `🟡 Court ${m.court_number} · warm-up` : isNext ? `▸ Up Next` : catName}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: "clamp(15px, 1.4vw, 18px)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {tName(m.team_a_id)} <span style={{ color: "#475569", margin: "0 6px" }}>vs</span> {tName(m.team_b_id)}
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 0.4 }}>{catName}</div>
      </div>
      <div className="font-display" style={{ minWidth: 110, textAlign: "right", fontSize: 14, fontWeight: 700, color: isWarming ? "#fbbf24" : "#cbd5e1", letterSpacing: 0.5, fontVariantNumeric: "tabular-nums" }}>
        {m.delta_label === "BYE" ? "Bye" : fmtClock(m.projected_start_at) || m.delta_label}
      </div>
    </div>
  );
}

function Stat({ label, big, sub }: { label: string; big: React.ReactNode; sub?: string }) {
  return (
    <div>
      <div className="font-display" style={{ fontSize: 10, letterSpacing: 2, color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div className="font-display" style={{ fontSize: "clamp(24px, 2.2vw, 38px)", fontWeight: 700, color: "#fff", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{big}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, fontWeight: 500 }}>{sub}</div>}
    </div>
  );
}
