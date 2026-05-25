import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { LottieLoader } from "../../components/ui/lottie-loader";
import { usePublicTournament } from "./usePublicTournament";
import { derivePublicTournamentState, type TeamView } from "./publicDerive";
import type { Category } from "../../types";

/**
 * Printable results page — /t/:slug/results
 *
 * White background, black text, page-break hints for paper. Uses the
 * browser's native window.print() so we don't pull in jsPDF / html2canvas
 * (would add ~80 KB to the bundle for a feature used a handful of times
 * per event). Users get "Save as PDF" through the print dialog.
 *
 * Sections:
 *   1. Tournament header (name, venue, date)
 *   2. Champions (per category) — only when knockout has a confirmed final
 *   3. Knockout results (all confirmed knockout matches)
 *   4. Group standings (final tables per category)
 */
export function ResultsPage() {
  const { slug } = useParams<{ slug: string }>();
  const ctx = usePublicTournament(slug);

  const derived = useMemo(() => {
    if (!ctx.tournament) return null;
    return derivePublicTournamentState(ctx.players, ctx.teams, ctx.matches, ctx.categories);
  }, [ctx.tournament, ctx.players, ctx.teams, ctx.matches, ctx.categories]);

  if (ctx.resolving || (!ctx.notFound && !derived)) {
    return <LottieLoader fullScreen label="Loading results…" />;
  }
  if (ctx.notFound || !ctx.tournament || !derived) {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: "center", padding: 60 }}>
          <h1>Tournament not found</h1>
          <Link to="/">← back to home</Link>
        </div>
      </div>
    );
  }

  const t = ctx.tournament;
  const knockoutByCategory = groupBy(derived.knockoutMatches, m => m.category_id);
  const groupsByCategory = groupBy(
    derived.groupMatches,
    m => m.category_id,
  );
  const catById = Object.fromEntries(ctx.categories.map(c => [c.id, c])) as Record<string, Category>;

  // Champions per category: the Final (slot_idx=0, last round) confirmed winner.
  const champions: { category: Category; champion: TeamView | null; runnerUp: TeamView | null; bronze: TeamView | null }[] = [];
  for (const cat of ctx.categories) {
    const koMatches = knockoutByCategory.get(cat.id) ?? [];
    if (koMatches.length === 0) continue;
    const maxRound = Math.max(...koMatches.map(m => m.round_idx ?? 0));
    const finalMatch = koMatches.find(m => m.round_idx === maxRound && m.slot_idx === 0 && !m.is_bronze);
    const bronzeMatch = koMatches.find(m => m.is_bronze);
    const finalWinner = finalMatch?.confirmed && finalMatch.winner_id
      ? derived.allTeamById[finalMatch.winner_id] ?? null
      : null;
    const finalLoser = finalMatch?.confirmed && finalMatch.winner_id
      ? (finalMatch.team_a_id === finalMatch.winner_id ? finalMatch.team_b_id : finalMatch.team_a_id)
      : null;
    const finalRunner = finalLoser ? derived.allTeamById[finalLoser] ?? null : null;
    const bronzeWinner = bronzeMatch?.confirmed && bronzeMatch.winner_id
      ? derived.allTeamById[bronzeMatch.winner_id] ?? null
      : null;
    champions.push({
      category: cat,
      champion: finalWinner,
      runnerUp: finalRunner,
      bronze: bronzeWinner,
    });
  }

  const handlePrint = () => {
    if (typeof window !== "undefined") window.print();
  };

  return (
    <div style={pageStyle}>
      {/* Print-only CSS — keeps the screen view ergonomic while the printed
          page strips chrome, expands to A4-friendly width, and avoids
          breaking inside a single match row. */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .results-page { background: #fff !important; padding: 0 !important; }
          .results-section { page-break-inside: avoid; }
          a { color: #000 !important; text-decoration: none !important; }
        }
        @media screen {
          .results-page { max-width: 880px; margin: 0 auto; padding: 24px; }
        }
      `}</style>

      <div className="results-page" style={{ background: "#fff", color: "#0a1628" }}>
        <div className="no-print" style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <Link to={`/t/${t.slug}`} style={{ color: "#3A86FF", fontSize: 13, textDecoration: "none" }}>← back to live view</Link>
          <button
            type="button"
            onClick={handlePrint}
            style={{
              padding: "10px 20px",
              background: "linear-gradient(135deg,#00b8ff,#0066ff)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: 1,
              cursor: "pointer",
              boxShadow: "0 4px 16px rgba(0,184,255,0.3)",
            }}
          >🖨️ Print / Save as PDF</button>
        </div>

        {/* Header */}
        <header className="results-section" style={{ borderBottom: "3px solid #0a1628", paddingBottom: 14, marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 3, color: "#64748b", textTransform: "uppercase" }}>Tournament Results</div>
          <h1 style={{ margin: "6px 0 4px", fontSize: 28, fontWeight: 900, letterSpacing: -0.5 }}>{t.name}</h1>
          <div style={{ fontSize: 13, color: "#475569" }}>
            {[
              t.venue_name,
              t.event_date && new Date(t.event_date).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
            ].filter(Boolean).join(" · ")}
          </div>
        </header>

        {/* Champions */}
        {champions.some(c => c.champion) && (
          <section className="results-section" style={{ marginBottom: 28 }}>
            <SectionHeader>🏆 Champions</SectionHeader>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14 }}>
              {champions.filter(c => c.champion).map(c => (
                <div key={c.category.id} style={{ border: "2px solid #f59e0b", borderRadius: 12, padding: "14px 16px", background: "#fef9c3" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: "#92400e", textTransform: "uppercase" }}>{c.category.name}</div>
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                    <Podium rank="1st" color="#f59e0b" team={c.champion} />
                    {c.runnerUp && <Podium rank="2nd" color="#94a3b8" team={c.runnerUp} />}
                    {c.bronze && <Podium rank="3rd" color="#b45309" team={c.bronze} />}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Knockout per category */}
        {[...knockoutByCategory.entries()].filter(([, ms]) => ms.some(m => m.confirmed && !m.is_bye)).map(([catId, ms]) => {
          const cat = catById[catId];
          if (!cat) return null;
          const byRound = groupBy(ms, m => m.round_idx ?? 0);
          const rounds = [...byRound.keys()].sort((a, b) => a - b);
          return (
            <section key={catId} className="results-section" style={{ marginBottom: 24 }}>
              <SectionHeader>Knockout · {cat.name}</SectionHeader>
              <table style={tableStyle}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #0a1628" }}>
                    <th style={thStyle}>Round</th>
                    <th style={thStyle}>Match</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Score</th>
                    <th style={thStyle}>Winner</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.flatMap(ri => byRound.get(ri)!
                    .filter(m => m.confirmed && !m.is_bye)
                    .sort((a, b) => a.slot_idx - b.slot_idx)
                    .map(m => (
                      <tr key={m.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={tdStyle}>
                          {m.is_bronze ? "🥉 3rd Place"
                            : ri === rounds[rounds.length - 1] ? "🏆 Final"
                              : ri === rounds[rounds.length - 2] ? "Semi"
                                : ri === rounds[rounds.length - 3] ? "Quarter"
                                  : `Round ${ri + 1}`}
                        </td>
                        <td style={tdStyle}>{teamName(derived.allTeamById, m.team_a_id)} vs {teamName(derived.allTeamById, m.team_b_id)}</td>
                        <td style={{ ...tdStyle, textAlign: "center", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{m.score_a ?? 0} – {m.score_b ?? 0}</td>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>{teamName(derived.allTeamById, m.winner_id)}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </section>
          );
        })}

        {/* Group standings per category */}
        {[...groupsByCategory.entries()].filter(([, ms]) => ms.length > 0).map(([catId, _ms]) => {
          const cat = catById[catId];
          if (!cat) return null;
          const groupIndices = Array.from(new Set(_ms.map(m => m.group_idx).filter((g): g is number => g != null))).sort();
          return (
            <section key={catId} className="results-section" style={{ marginBottom: 24 }}>
              <SectionHeader>Group Stage · {cat.name}</SectionHeader>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14 }}>
                {groupIndices.map(gi => {
                  // Reconstruct the group's team set from the matches that
                  // reference it; mirrors the runtime grouping logic.
                  const teamIds = new Set<string>();
                  _ms.forEach(m => {
                    if (m.group_idx !== gi) return;
                    if (m.team_a_id) teamIds.add(m.team_a_id);
                    if (m.team_b_id) teamIds.add(m.team_b_id);
                  });
                  const groupTeams = derived.teamsView.filter(t => teamIds.has(t.id));
                  const standings = derived.getStandings(groupTeams, gi);
                  return (
                    <div key={gi} style={{ border: "1px solid #cbd5e1", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ padding: "10px 14px", borderBottom: "1px solid #cbd5e1", background: "#f8fafc", fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", fontSize: 12 }}>
                        Group {String.fromCharCode(65 + gi)}
                      </div>
                      <table style={{ ...tableStyle, marginTop: 0 }}>
                        <thead>
                          <tr style={{ background: "#f8fafc", borderBottom: "1px solid #cbd5e1" }}>
                            <th style={{ ...thStyle, padding: "6px 10px" }}>#</th>
                            <th style={{ ...thStyle, padding: "6px 10px" }}>Team</th>
                            <th style={{ ...thStyle, padding: "6px 10px", textAlign: "center" }}>W-L</th>
                            <th style={{ ...thStyle, padding: "6px 10px", textAlign: "center" }}>+/-</th>
                            <th style={{ ...thStyle, padding: "6px 10px", textAlign: "center" }}>PTS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {standings.map((s, i) => (
                            <tr key={s.team.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                              <td style={{ ...tdStyle, padding: "6px 10px", fontWeight: 800, color: i === 0 ? "#f59e0b" : "#475569" }}>{i + 1}</td>
                              <td style={{ ...tdStyle, padding: "6px 10px" }}>{teamLabel(s.team)}</td>
                              <td style={{ ...tdStyle, padding: "6px 10px", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{s.w}-{s.l}</td>
                              <td style={{ ...tdStyle, padding: "6px 10px", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{s.pf - s.pa > 0 ? "+" : ""}{s.pf - s.pa}</td>
                              <td style={{ ...tdStyle, padding: "6px 10px", textAlign: "center", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{s.pts}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        {/* Footer — small print-time stamp so multiple printouts are distinguishable. */}
        <footer style={{ marginTop: 24, paddingTop: 14, borderTop: "1px solid #cbd5e1", fontSize: 11, color: "#94a3b8", textAlign: "center" }}>
          Generated {new Date().toLocaleString()}
        </footer>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100dvh",
  background: "#f8fafc",
  fontFamily: "'Inter', system-ui, sans-serif",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
  marginTop: 8,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontWeight: 800,
  fontSize: 11,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: "#475569",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
  color: "#0a1628",
};

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 900, letterSpacing: 0.5, color: "#0a1628", borderBottom: "1px solid #cbd5e1", paddingBottom: 6 }}>
      {children}
    </h2>
  );
}

function Podium({ rank, color, team }: { rank: string; color: string; team: TeamView | null }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color, minWidth: 32 }}>{rank}</span>
      <span style={{ fontWeight: 700, color: "#0a1628" }}>{teamLabel(team)}</span>
    </div>
  );
}

function teamLabel(t: TeamView | null): string {
  if (!t || !t.p1) return "—";
  return t.p2 ? `${t.p1.name} & ${t.p2.name}` : t.p1.name;
}

function teamName(byId: Record<string, TeamView | undefined>, id: string | null): string {
  if (!id) return "—";
  return teamLabel(byId[id] ?? null);
}

function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(it);
  }
  return out;
}
