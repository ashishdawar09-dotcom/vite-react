import { useState, useMemo } from "react";
import { CourtStatus } from "./CourtStatus";
import { Av } from "./ui";
import { fmtClock } from "../hooks/useScheduling";
import { useIsMobile } from "../hooks/useIsMobile";
import { knockoutShapeFor, defaultFormat, type KnockoutShape } from "../lib/formatPlanner";
import type { Category, Match, Player, PlayerCategory, ProjectedMatch, Team } from "../types";

type TeamView = Team & { p1: Player; p2: Player | null };

export function LiveTab({ teamsView, allTeamById, matches, groupMatches, phase, groups, getStandings, categories, numCourts, liveByCourt, projectedMatches, players, playerCategories, onShowProfile }: {
  teamsView: TeamView[];
  allTeamById: Record<string, TeamView | undefined>;
  matches: Match[];
  groupMatches: Match[];
  knockoutMatches: Match[];
  phase: "none" | "group" | "knockout";
  groups: TeamView[][];
  getStandings: (g: TeamView[], gi: number) => { team: TeamView; w: number; l: number; pts: number; pf: number; pa: number }[];
  categories: Category[];
  numCourts: number;
  liveByCourt: Record<number, ProjectedMatch | undefined>;
  projectedById: Record<string, ProjectedMatch>;
  projectedMatches: ProjectedMatch[];
  players: Player[];
  playerCategories: PlayerCategory[];
  onShowProfile: (playerId: string) => void;
}) {
  const isMobile = useIsMobile();
  const teamById = Object.fromEntries(teamsView.map(t => [t.id, t]));
  const catById = Object.fromEntries(categories.map(c => [c.id, c]));
  const tName = (id: string | null) => {
    if (!id) return "TBD";
    const t = allTeamById[id];
    if (!t?.p1) return "TBD";
    return t.p2 ? `${t.p1.name} & ${t.p2.name}` : t.p1.name;
  };

  // Search: matches a team or player name in any of live / upcoming / recent.
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const teamMatchesQuery = (id: string | null | undefined): boolean => {
    if (!q) return true;
    if (!id) return false;
    const t = allTeamById[id];
    if (!t) return false;
    const haystack = [t.name, t.p1?.name, t.p2?.name].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(q);
  };
  const matchInQuery = (m: ProjectedMatch) => !q || teamMatchesQuery(m.team_a_id) || teamMatchesQuery(m.team_b_id);

  const live = useMemo(
    () => projectedMatches.filter(m => m.status === "live").filter(matchInQuery),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectedMatches, q]
  );
  const upcoming = useMemo(
    () => projectedMatches
      .filter(m => m.status === "pending" && !m.confirmed && m.team_a_id && m.team_b_id && !m.is_bye)
      .filter(matchInQuery)
      .sort((a, b) => new Date(a.projected_start_at ?? 0).getTime() - new Date(b.projected_start_at ?? 0).getTime())
      .slice(0, q ? 20 : 5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectedMatches, q]
  );
  const recent = useMemo(
    () => [...projectedMatches.filter(m => m.confirmed && !m.is_bye).filter(matchInQuery)]
      .sort((a, b) => (b.confirmed_at ?? b.started_at ?? "").localeCompare(a.confirmed_at ?? a.started_at ?? ""))
      .slice(0, q ? 20 : 5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectedMatches, q]
  );

  // Player name results for the search box. Active players first, then by name.
  const playerResults = useMemo(() => {
    if (!q) return [];
    return players
      .filter(p => p.name.toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 12);
  }, [players, q]);

  const stats: Record<string, { team: TeamView; w: number; pts: number; pf: number; pa: number }> = {};
  teamsView.forEach(t => { stats[t.id] = { team: t, w: 0, pts: 0, pf: 0, pa: 0 }; });
  groupMatches.filter(m => m.confirmed).forEach(m => {
    const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
    if (m.team_a_id && stats[m.team_a_id]) { stats[m.team_a_id].pf += sa; stats[m.team_a_id].pa += sb; }
    if (m.team_b_id && stats[m.team_b_id]) { stats[m.team_b_id].pf += sb; stats[m.team_b_id].pa += sa; }
    if (m.winner_id && stats[m.winner_id]) { stats[m.winner_id].w++; stats[m.winner_id].pts += 3; }
  });
  const ranked = Object.values(stats).sort((a, b) => b.pts - a.pts || (b.pf - b.pa) - (a.pf - a.pa));
  const topTeam = ranked[0];
  const bestDiff = [...ranked].sort((a, b) => (b.pf - b.pa) - (a.pf - a.pa))[0];

  const matchesPlayed = matches.filter(m => m.confirmed).length;
  const totalMatches = matches.filter(m => m.team_a_id && m.team_b_id && !m.is_bye).length;

  if (teamsView.length === 0) {
    return (
      <div style={{ position: "relative", background: "#0a1628", borderRadius: 14, padding: 80, color: "#64748b", textAlign: "center", border: "1px solid #1a3050", overflow: "hidden", minHeight: 280 }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/images/B3.jpg)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.35 }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(10,22,40,0.6) 0%, rgba(10,22,40,0.95) 100%)" }} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: 64, marginBottom: 12, opacity: 0.6 }}>🏸</div>
          <p className="font-display" style={{ fontSize: 18, fontWeight: 600, color: "#fff", letterSpacing: 1, textTransform: "uppercase", margin: 0 }}>Tournament hasn't started</p>
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>Check back soon for live action.</p>
        </div>
      </div>
    );
  }

  const SectionHeader = ({ accent, children, badge }: { accent: string; children: React.ReactNode; badge?: React.ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <div style={{ width: 4, height: 22, background: accent, borderRadius: 1 }} />
      <h3 className="font-display" style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#fff", letterSpacing: 1.5, textTransform: "uppercase" }}>{children}</h3>
      {badge}
    </div>
  );

  const StatTile = ({ label, value, sub, color }: { label: string; value: React.ReactNode; sub?: string; color: string }) => (
    <div style={{ flex: "1 1 200px", background: "#0f1e36", borderRadius: 8, padding: "16px 18px", border: "1px solid #1a3050", borderLeft: `3px solid ${color}`, position: "relative", overflow: "hidden" }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 2, fontWeight: 700, marginBottom: 8 }}>{label}</div>
      <div className="font-display" style={{ fontSize: 26, fontWeight: 700, color: "#fff", lineHeight: 1.1, letterSpacing: 0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, fontWeight: 500 }}>{sub}</div>}
    </div>
  );

  const stageBadge = (m: Match) => m.stage === "group" ? `GROUP ${String.fromCharCode(65 + (m.group_idx ?? 0))}` : m.stage === "knockout" ? `ROUND ${(m.round_idx ?? 0) + 1}` : "";

  // Resolve a category's saved format → topN, groupsCount, knockout shape.
  // Used by the Standings panel to render dynamic per-group badges and to
  // highlight the qualifying rows. Falls back to the format planner's
  // default if the category was created before the recommender shipped.
  const formatForCategory = (catId: string): { topN: number; groupsCount: number; shape: KnockoutShape; category: Category } | null => {
    const c = catById[catId];
    if (!c) return null;
    let topN = c.top_n_advance > 0 ? c.top_n_advance : 0;
    let groupsCount = c.groups_count > 0 ? c.groups_count : 0;
    if (topN <= 0 || groupsCount <= 0) {
      // Fall back: use planner's default for the team count we actually see.
      const teamsInCat = teamsView.filter(t => t.category_id === catId).length;
      const plan = defaultFormat(teamsInCat);
      if (topN <= 0) topN = plan.topNAdvance;
      if (groupsCount <= 0) groupsCount = Math.max(1, plan.groupsCount);
    }
    const shape: KnockoutShape = topN <= 0
      ? "RR-only"
      : knockoutShapeFor(groupsCount * topN);
    return { topN, groupsCount, shape, category: c };
  };

  return (
    <div style={{ background: "#0a1628", borderRadius: 14, padding: 24, border: "1px solid #1a3050", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}>

      <CourtStatus numCourts={numCourts} liveByCourt={liveByCourt} categories={categories} teamById={allTeamById} />

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ position: "relative", flex: "1 1 280px", maxWidth: 520 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "#64748b", pointerEvents: "none" }}>🔍</span>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by player or team name…"
            aria-label="Search matches by player or team"
            style={{
              width: "100%", padding: "10px 14px 10px 36px", borderRadius: 8,
              border: "1px solid #1a3050", background: "#0f1e36", color: "#fff",
              fontSize: 13, fontWeight: 500, outline: "none",
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.3)",
            }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", padding: "4px 8px", borderRadius: 4, border: "none", background: "transparent", color: "#94a3b8", fontSize: 14, cursor: "pointer" }}
            >×</button>
          )}
        </div>
        {q && (
          <span className="font-display" style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: 1.5 }}>
            {playerResults.length} PLAYER{playerResults.length === 1 ? "" : "S"} · {live.length + upcoming.length + recent.length} MATCH{live.length + upcoming.length + recent.length === 1 ? "" : "ES"}
          </span>
        )}
      </div>

      {/* Player name results — clickable, navigate to player profile */}
      {q && playerResults.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <SectionHeader
            accent="#a855f7"
            badge={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.4)", padding: "3px 10px", borderRadius: 4 }}>
                <span className="font-display" style={{ fontSize: 10, fontWeight: 700, color: "#a855f7", letterSpacing: 1.5 }}>{playerResults.length} {playerResults.length === 1 ? "RESULT" : "RESULTS"}</span>
              </span>
            }
          >Matching Players</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(240px,1fr))", gap: 10 }}>
            {playerResults.map(p => {
              const cats = playerCategories
                .filter(pc => pc.player_id === p.id)
                .map(pc => catById[pc.category_id]?.name)
                .filter((n): n is string => Boolean(n));
              return (
                <button
                  key={p.id}
                  onClick={() => onShowProfile(p.id)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, border: "1px solid #1a3050", background: "#0f1e36", color: "#fff", cursor: "pointer", textAlign: "left", opacity: p.active ? 1 : 0.6, transition: "background .15s, border-color .15s" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#11243f"; e.currentTarget.style.borderColor = "#a855f7"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "#0f1e36"; e.currentTarget.style.borderColor = "#1a3050"; }}
                  title={`View ${p.name}'s profile`}
                >
                  <Av name={p.name} photo={p.photo_url} sz={36} color={p.color} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name}
                      {!p.active && <span style={{ marginLeft: 6, fontSize: 9, color: "#64748b", letterSpacing: 1, fontWeight: 700 }}>INACTIVE</span>}
                    </div>
                    {cats.length > 0 ? (
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cats.join(" · ")}</div>
                    ) : (
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, fontStyle: "italic" }}>No category</div>
                    )}
                  </div>
                  <span className="font-display" style={{ fontSize: 16, color: "#a855f7", fontWeight: 800 }}>→</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {upcoming.length > 0 && live.length === 0 && upcoming.slice(0, 3).some(m => {
        const start = m.projected_start_at ? new Date(m.projected_start_at).getTime() : 0;
        return start - Date.now() < 5 * 60_000;
      }) && (
        <div style={{ background: "linear-gradient(90deg,#1a0c2a 0%,#0a1628 60%)", borderRadius: 10, padding: "12px 18px", marginBottom: 20, border: "1px solid #a855f7", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span className="font-display" style={{ fontSize: 11, fontWeight: 800, color: "#a855f7", letterSpacing: 2 }}>▶ NEXT UP</span>
          {upcoming.slice(0, 3).map((m, i) => (
            <span key={m.id} style={{ fontSize: 12, color: i === 0 ? "#fff" : "#94a3b8", fontWeight: i === 0 ? 700 : 500 }}>
              {catById[m.category_id]?.name?.toUpperCase() ?? ""} · {tName(m.team_a_id)} vs {tName(m.team_b_id)} · {fmtClock(m.projected_start_at)}
              {i < 2 && i < upcoming.length - 1 && <span style={{ color: "#475569", marginLeft: 12 }}>•</span>}
            </span>
          ))}
        </div>
      )}

      <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", marginBottom: 28, minHeight: 180, background: "linear-gradient(135deg,#0d1f3a 0%,#0a1628 100%)", border: "1px solid #1a3050" }}>
        <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "60%", clipPath: "polygon(25% 0, 100% 0, 100% 100%, 0 100%)", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/images/B2.jpg)", backgroundSize: "cover", backgroundPosition: "center 30%", opacity: 0.95 }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, #0a1628 0%, rgba(10,22,40,0.7) 30%, rgba(10,22,40,0.1) 100%)" }} />
        </div>
        <div style={{ position: "absolute", top: -40, left: -40, width: 200, height: 200, background: "radial-gradient(circle, rgba(0,184,255,0.25) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1, padding: "26px 28px", maxWidth: "55%" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 4, background: "rgba(0,184,255,0.15)", border: "1px solid rgba(0,184,255,0.35)", marginBottom: 12 }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#00d4ff", boxShadow: "0 0 6px #00d4ff" }} />
            <span className="font-display" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#00d4ff" }}>{phase === "knockout" ? "KNOCKOUT STAGE" : phase === "group" ? "GROUP STAGE" : "TOURNAMENT"}</span>
          </div>
          <h2 className="font-display" style={{ margin: "0 0 8px", fontSize: 30, fontWeight: 700, letterSpacing: 0.5, color: "#fff", textTransform: "uppercase", lineHeight: 1.05 }}>
            {live.length > 0 ? <><span style={{ color: "#ef4444" }}>● LIVE</span> NOW</> : phase === "none" ? "Get Ready" : "Tournament Action"}
          </h2>
          <p style={{ margin: "0 0 14px", fontSize: 13, color: "#94a3b8", fontWeight: 500, maxWidth: 420 }}>
            {live.length > 0
              ? `${live.length} match${live.length > 1 ? "es" : ""} in progress · scores update in real time`
              : phase === "none"
                ? "Teams forming · matches will start soon"
                : `${matchesPlayed} of ${totalMatches} matches completed${topTeam && topTeam.pts > 0 ? ` · ${topTeam.team.p2 ? `${topTeam.team.p1.name} & ${topTeam.team.p2.name}` : topTeam.team.p1.name} leading` : ""}`}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 4, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Teams</span>
              <span className="font-display" style={{ fontSize: 16, fontWeight: 700, color: "#00d4ff" }}>{teamsView.length}</span>
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 4, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Played</span>
              <span className="font-display" style={{ fontSize: 16, fontWeight: 700, color: "#22c55e" }}>{matchesPlayed}/{totalMatches}</span>
            </div>
          </div>
        </div>
      </div>

      {live.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <SectionHeader accent="#ef4444" badge={<span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", padding: "4px 10px", borderRadius: 4 }}><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#ef4444", animation: "pulse-strong 1.4s ease-in-out infinite", boxShadow: "0 0 6px #ef4444" }} /><span className="font-display" style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", letterSpacing: 2 }}>LIVE</span><span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{live.length}</span></span>}>Now Playing</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(360px,1fr))", gap: 14 }}>
            {live.map(m => {
              const ta = m.team_a_id ? teamById[m.team_a_id] : null;
              const tb = m.team_b_id ? teamById[m.team_b_id] : null;
              const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
              const aLeading = sa > sb, bLeading = sb > sa;
              return (
                <div key={m.id} style={{ background: "linear-gradient(135deg,#0f1e36 0%,#11243f 100%)", borderRadius: 10, border: "1px solid #1a3050", overflow: "hidden", position: "relative" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,#ef4444,#f97316)" }} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "rgba(239,68,68,0.06)", borderBottom: "1px solid #1a3050" }}>
                    <span className="font-display" style={{ fontSize: 11, fontWeight: 700, color: "#00d4ff", letterSpacing: 2 }}>{stageBadge(m)}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: "#ef4444", letterSpacing: 2 }}>
                      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#ef4444", animation: "pulse-strong 1.4s ease-in-out infinite" }} />LIVE
                    </span>
                  </div>
                  <div style={{ padding: isMobile ? "12px 14px" : "16px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, padding: "8px 0" }}>
                      {ta?.p1 && <Av name={ta.p1.name} photo={ta.p1.photo_url} sz={isMobile ? 32 : 38} color={ta.p1.color} />}
                      <span style={{ fontWeight: aLeading ? 800 : 600, fontSize: 14, flex: 1, color: aLeading ? "#fff" : "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{tName(m.team_a_id)}</span>
                      <div className="font-display" style={{ minWidth: isMobile ? 56 : 70, padding: isMobile ? "6px 10px" : "8px 16px", background: aLeading ? "linear-gradient(135deg,#00b8ff,#0066ff)" : "rgba(255,255,255,0.04)", color: aLeading ? "#fff" : "#94a3b8", borderRadius: 6, fontSize: isMobile ? 26 : 32, fontWeight: 700, textAlign: "center", border: aLeading ? "1px solid #00d4ff" : "1px solid #1a3050", boxShadow: aLeading ? "0 4px 16px rgba(0,184,255,0.4)" : "none", letterSpacing: 1, transition: "all .2s", lineHeight: 1 }}>{sa}</div>
                    </div>
                    <div style={{ height: 1, background: "linear-gradient(90deg,transparent,#1a3050,transparent)", margin: "2px 0" }} />
                    <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, padding: "8px 0" }}>
                      {tb?.p1 && <Av name={tb.p1.name} photo={tb.p1.photo_url} sz={isMobile ? 32 : 38} color={tb.p1.color} />}
                      <span style={{ fontWeight: bLeading ? 800 : 600, fontSize: 14, flex: 1, color: bLeading ? "#fff" : "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{tName(m.team_b_id)}</span>
                      <div className="font-display" style={{ minWidth: isMobile ? 56 : 70, padding: isMobile ? "6px 10px" : "8px 16px", background: bLeading ? "linear-gradient(135deg,#00b8ff,#0066ff)" : "rgba(255,255,255,0.04)", color: bLeading ? "#fff" : "#94a3b8", borderRadius: 6, fontSize: isMobile ? 26 : 32, fontWeight: 700, textAlign: "center", border: bLeading ? "1px solid #00d4ff" : "1px solid #1a3050", boxShadow: bLeading ? "0 4px 16px rgba(0,184,255,0.4)" : "none", letterSpacing: 1, transition: "all .2s", lineHeight: 1 }}>{sb}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 32 }}>
        <SectionHeader accent="#00b8ff">Tournament Stats</SectionHeader>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <StatTile label="Stage" value={phase === "none" ? "Not Started" : phase === "group" ? "Group Stage" : "Knockout"} color="#00b8ff" />
          <StatTile
            label="Matches Played"
            value={
              <div>
                <span style={{ color: "#00d4ff" }}>{String(matchesPlayed).padStart(2, "0")}</span>
                <span style={{ color: "#475569", margin: "0 6px" }}>/</span>
                <span style={{ color: "#cbd5e1" }}>{String(totalMatches).padStart(2, "0")}</span>
              </div>
            }
            color="#22c55e"
            sub={totalMatches > 0 ? (
              <span>
                {Math.round(matchesPlayed / totalMatches * 100)}% complete
              </span>
            ) as any : undefined}
          />
          {topTeam && topTeam.pts > 0 && <StatTile label="Top Team" value={topTeam.team.p2 ? `${topTeam.team.p1.name} & ${topTeam.team.p2.name}` : topTeam.team.p1.name} sub={`${topTeam.pts} PTS · ${topTeam.w} W`} color="#f59e0b" />}
          {bestDiff && (bestDiff.pf - bestDiff.pa) !== 0 && <StatTile label="Best Diff" value={<><span style={{ color: bestDiff.pf - bestDiff.pa > 0 ? "#22c55e" : "#ef4444" }}>{bestDiff.pf - bestDiff.pa > 0 ? "+" : ""}{bestDiff.pf - bestDiff.pa}</span></>} sub={bestDiff.team.p2 ? `${bestDiff.team.p1.name} & ${bestDiff.team.p2.name}` : bestDiff.team.p1.name} color="#a855f7" />}
        </div>
        {totalMatches > 0 && (
          <div style={{ marginTop: 14, height: 4, background: "#0f1e36", borderRadius: 2, overflow: "hidden", border: "1px solid #1a3050" }}>
            <div style={{ height: "100%", width: `${Math.round(matchesPlayed / totalMatches * 100)}%`, background: "linear-gradient(90deg,#00b8ff,#00d4ff)", boxShadow: "0 0 12px rgba(0,212,255,0.6)", transition: "width .4s" }} />
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit,minmax(360px,1fr))", gap: 20, marginBottom: 32 }}>
        {upcoming.length > 0 && (
          <div>
            <SectionHeader accent="#00d4ff">Upcoming</SectionHeader>
            <div style={{ background: "#0f1e36", borderRadius: 8, border: "1px solid #1a3050", overflow: "hidden" }}>
              {upcoming.map((m, i) => (
                <div key={m.id} style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: i < upcoming.length - 1 ? "1px solid #1a3050" : "none", gap: 12, position: "relative", background: i === 0 ? "rgba(0,212,255,0.04)" : "transparent" }}>
                  {i === 0 && <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 3, background: "#00d4ff" }} />}
                  <div className="font-display" style={{ fontSize: 10, fontWeight: 700, color: i === 0 ? "#00d4ff" : "#64748b", letterSpacing: 1.5, minWidth: 70 }}>{i === 0 ? "▸ NEXT" : stageBadge(m)}</div>
                  <div style={{ flex: 1, fontWeight: 600, fontSize: 13, color: "#cbd5e1" }}>{tName(m.team_a_id)}</div>
                  <div className="font-display" style={{ fontSize: 10, color: "#475569", fontWeight: 700, letterSpacing: 2 }}>VS</div>
                  <div style={{ flex: 1, fontWeight: 600, fontSize: 13, textAlign: "right", color: "#cbd5e1" }}>{tName(m.team_b_id)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div>
            <SectionHeader accent="#22c55e">Recent Results</SectionHeader>
            <div style={{ background: "#0f1e36", borderRadius: 8, border: "1px solid #1a3050", overflow: "hidden" }}>
              {recent.map((m, i) => (
                <div key={m.id} style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: i < recent.length - 1 ? "1px solid #1a3050" : "none", gap: 12 }}>
                  <div className="font-display" style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: 1.5, minWidth: 70 }}>{stageBadge(m)}</div>
                  <div style={{ flex: 1, fontWeight: m.winner_id === m.team_a_id ? 700 : 500, color: m.winner_id === m.team_a_id ? "#22c55e" : "#94a3b8", fontSize: 13 }}>{tName(m.team_a_id)}</div>
                  <div className="font-display" style={{ fontWeight: 700, fontSize: 14, padding: "4px 10px", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 4, color: "#22c55e", letterSpacing: 1 }}>{m.score_a}–{m.score_b}</div>
                  <div style={{ flex: 1, fontWeight: m.winner_id === m.team_b_id ? 700 : 500, color: m.winner_id === m.team_b_id ? "#22c55e" : "#94a3b8", textAlign: "right", fontSize: 13 }}>{tName(m.team_b_id)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {phase !== "none" && groups.length > 0 && (() => {
        // Distinct categories represented by the visible groups — used to
        // render the format-summary lines above the cards.
        const categoryIdsInView = Array.from(
          new Set(groups.map(g => g[0]?.category_id).filter((id): id is string => Boolean(id))),
        );
        return (
          <div>
            <SectionHeader accent="#a855f7">Standings</SectionHeader>
            {/* Format summary — one line per visible category */}
            {categoryIdsInView.length > 0 && (
              <div style={{ marginTop: -4, marginBottom: 14, display: "flex", flexDirection: "column", gap: 4 }}>
                {categoryIdsInView.map(catId => {
                  const fmt = formatForCategory(catId);
                  if (!fmt) return null;
                  const shapeText = fmt.shape === "RR-only" ? "round-robin only"
                    : fmt.shape === "none" ? `top ${fmt.topN}`
                    : `top ${fmt.topN} ${fmt.groupsCount === 1 ? "" : "each "}→ ${fmt.shape}`;
                  return (
                    <div key={catId} style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 0.4 }}>
                      <span style={{ color: "#a855f7", fontWeight: 700, letterSpacing: 1 }}>{fmt.category.name.toUpperCase()}</span>
                      <span style={{ margin: "0 8px", color: "#475569" }}>·</span>
                      <span>{fmt.groupsCount} group{fmt.groupsCount === 1 ? "" : "s"} · {shapeText}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(340px,1fr))", gap: 14 }}>
              {groups.map((g, gi) => {
                const st = getStandings(g, gi);
                const groupBgs = ["/images/B5.jpg", "/images/B4.jpg", "/images/B1.jpg", "/images/B6.jpg"];
                const groupAccents = ["#00d4ff", "#22c55e", "#f59e0b", "#a855f7"];
                const accent = groupAccents[gi % groupAccents.length];
                const fmt = g[0]?.category_id ? formatForCategory(g[0].category_id) : null;
                const topN = fmt?.topN ?? 2;
                const badgeText = !fmt ? "TOP 2"
                  : fmt.shape === "RR-only" ? "ROUND-ROBIN"
                  : fmt.shape === "none" ? `TOP ${fmt.topN}`
                  : `TOP ${fmt.topN} → ${fmt.shape}`;
                return (
                  <div key={gi} style={{ background: "#0f1e36", borderRadius: 8, border: "1px solid #1a3050", overflow: "hidden", position: "relative" }}>
                    <div style={{ position: "relative", padding: "16px 16px 14px", borderBottom: "1px solid #1a3050", overflow: "hidden", minHeight: 76 }}>
                      <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${groupBgs[gi % groupBgs.length]})`, backgroundSize: "cover", backgroundPosition: "center 30%", opacity: 0.55 }} />
                      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, rgba(15,30,55,0.95) 0%, rgba(15,30,55,0.6) 60%, rgba(15,30,55,0.3) 100%)` }} />
                      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 3, background: accent }} />
                      <div style={{ position: "relative", zIndex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <span className="font-display" style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: 1.5, textTransform: "uppercase", textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>Group {String.fromCharCode(65 + gi)}</span>
                          <span className="font-display" style={{ fontSize: 10, color: accent, fontWeight: 700, letterSpacing: 1.5, padding: "3px 8px", background: "rgba(0,0,0,0.4)", borderRadius: 3, border: `1px solid ${accent}66`, whiteSpace: "nowrap" }}>{badgeText}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 4, fontWeight: 500, textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>{g.length} TEAMS · {st.reduce((acc, s) => acc + s.w + s.l, 0)} matches played</div>
                      </div>
                    </div>
                    <div>
                      {st.map((s, si) => {
                        const advancing = topN > 0 && si < topN;
                        const rankColor = si === 0 ? "#fbbf24" : advancing ? "#22c55e" : "#475569";
                        return (
                          <div key={s.team.id} style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderTop: si === 0 ? "none" : "1px solid #1a3050", background: advancing ? "rgba(34,197,94,0.04)" : "transparent", position: "relative" }}>
                            {advancing && <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 2, background: "#22c55e" }} />}
                            <div className="font-display" style={{ width: 24, fontSize: 14, fontWeight: 700, color: rankColor }}>{si + 1}</div>
                            <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>{s.team.p2 ? `${s.team.p1.name} & ${s.team.p2.name}` : s.team.p1.name}</div>
                            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                              <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{s.w}-{s.l}</span>
                              <span className="font-display" style={{ fontSize: 11, fontWeight: 700, color: s.pf - s.pa > 0 ? "#22c55e" : s.pf - s.pa < 0 ? "#ef4444" : "#64748b", minWidth: 30, textAlign: "right" }}>{s.pf - s.pa > 0 ? "+" : ""}{s.pf - s.pa}</span>
                              <span className="font-display" style={{ fontSize: 18, fontWeight: 700, color: advancing ? "#00d4ff" : "#cbd5e1", minWidth: 24, textAlign: "right", letterSpacing: 0.5 }}>{s.pts}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {live.length === 0 && upcoming.length === 0 && recent.length === 0 && (
        <div style={{ position: "relative", textAlign: "center", padding: 60, color: "#64748b", background: "#0f1e36", borderRadius: 10, border: "1px solid #1a3050", overflow: "hidden", minHeight: 220 }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "url(/images/B3.jpg)", backgroundSize: "cover", backgroundPosition: "center", opacity: 0.3 }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(15,30,55,0.6) 0%, rgba(15,30,55,0.95) 100%)" }} />
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ fontSize: 48, marginBottom: 10, opacity: 0.5 }}>🏸</div>
            <p className="font-display" style={{ margin: 0, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: "#fff" }}>No matches scheduled</p>
            <p style={{ margin: "4px 0 0", fontSize: 13 }}>The tournament will begin shortly.</p>
          </div>
        </div>
      )}
    </div>
  );
}
