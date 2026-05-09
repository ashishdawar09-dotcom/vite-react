import { useMemo } from "react";
import { Av } from "./ui";
import { fmtClock } from "../hooks/useScheduling";
import type { Category, Player, PlayerCategory, ProjectedMatch, Team } from "../types";

type TeamView = Team & { p1: Player; p2: Player | null };

export function PlayerProfileView({
  player,
  allTeams,
  matches,
  categories,
  playerCategories,
  groups,
  getStandings,
  onBack,
  onShowProfile,
}: {
  player: Player;
  allTeams: TeamView[];
  matches: ProjectedMatch[];
  categories: Category[];
  playerCategories: PlayerCategory[];
  groups: TeamView[][];
  getStandings: (g: TeamView[], gi: number) => { team: TeamView; w: number; l: number; pts: number; pf: number; pa: number }[];
  onBack: () => void;
  onShowProfile: (playerId: string) => void;
}) {
  const playerTeams = useMemo(
    () => allTeams.filter(t => t.p1_id === player.id || t.p2_id === player.id),
    [allTeams, player.id]
  );
  const teamIds = useMemo(() => new Set(playerTeams.map(t => t.id)), [playerTeams]);
  const teamById = useMemo(() => Object.fromEntries(allTeams.map(t => [t.id, t])), [allTeams]);
  const catById = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c])), [categories]);

  const playerMatches = useMemo(
    () => matches.filter(m =>
      (m.team_a_id && teamIds.has(m.team_a_id)) || (m.team_b_id && teamIds.has(m.team_b_id))
    ),
    [matches, teamIds]
  );

  const upcoming = useMemo(
    () => playerMatches
      .filter(m => (m.status === "pending" || m.status === "live") && !m.is_bye)
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "live" ? -1 : 1;
        return new Date(a.projected_start_at ?? 0).getTime() - new Date(b.projected_start_at ?? 0).getTime();
      })
      .slice(0, 8),
    [playerMatches]
  );

  const recent = useMemo(
    () => playerMatches
      .filter(m => m.confirmed)
      .sort((a, b) => (b.confirmed_at ?? "").localeCompare(a.confirmed_at ?? ""))
      .slice(0, 12),
    [playerMatches]
  );

  const wins = recent.filter(m => m.winner_id && teamIds.has(m.winner_id)).length;
  const losses = recent.filter(m => m.winner_id && !teamIds.has(m.winner_id)).length;

  const playerCatIds = useMemo(
    () => new Set(playerCategories.filter(pc => pc.player_id === player.id).map(pc => pc.category_id)),
    [playerCategories, player.id]
  );
  const playerCats = useMemo(
    () => categories.filter(c => playerCatIds.has(c.id)).sort((a, b) => a.sort_order - b.sort_order),
    [categories, playerCatIds]
  );

  const playerGroups = useMemo(() => {
    const out: { groupIdx: number; group: TeamView[] }[] = [];
    groups.forEach((g, gi) => {
      if (g.some(t => teamIds.has(t.id))) out.push({ groupIdx: gi, group: g });
    });
    return out;
  }, [groups, teamIds]);

  const tName = (id: string | null) => {
    if (!id) return "TBD";
    const t = teamById[id];
    if (!t?.p1) return "TBD";
    return t.p2 ? `${t.p1.name} & ${t.p2.name}` : t.p1.name;
  };

  // Partner name(s) — players that share a team with this player.
  const partners = useMemo(() => {
    const set = new Map<string, Player>();
    for (const t of playerTeams) {
      const partner = t.p1_id === player.id ? t.p2 : t.p1;
      if (partner && partner.id !== player.id) set.set(partner.id, partner);
    }
    return [...set.values()];
  }, [playerTeams, player.id]);

  const stageLabel = (m: ProjectedMatch) => {
    if (m.stage === "group") return `GROUP ${String.fromCharCode(65 + (m.group_idx ?? 0))}`;
    return `RD ${(m.round_idx ?? 0) + 1}`;
  };

  return (
    <div>
      {/* Back button */}
      <button
        onClick={onBack}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 18, boxShadow: "0 2px 6px rgba(0,0,0,0.04)" }}
      >
        ← Back to All Players
      </button>

      {/* Header card */}
      <div style={{ background: "#fff", borderRadius: 22, overflow: "hidden", border: "1px solid #e8ecf1", boxShadow: "0 8px 30px rgba(0,0,0,0.06)", marginBottom: 22 }}>
        <div style={{ height: 8, background: player.color }} />
        <div style={{ display: "flex", gap: 22, padding: "26px 28px", alignItems: "center", flexWrap: "wrap" }}>
          <Av name={player.name} photo={player.photo_url} sz={140} color={player.color} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 1.8, textTransform: "uppercase", fontWeight: 700, marginBottom: 4 }}>Player Profile</div>
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, color: "#1a1a2e", letterSpacing: -0.5, lineHeight: 1.1 }}>{player.name}</h1>
            {player.note && <div style={{ marginTop: 8, fontSize: 13, color: "#E63946", padding: "4px 12px", background: "#fef2f2", borderRadius: 12, display: "inline-block" }}>⚠️ {player.note}</div>}

            {/* Categories */}
            {playerCats.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                {playerCats.map(c => (
                  <span key={c.id} style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6, background: "#eff6ff", color: "#3A86FF", border: "1px solid #bfdbfe", letterSpacing: 0.5 }}>{c.name}</span>
                ))}
              </div>
            )}

            {/* Partners */}
            {partners.length > 0 && (
              <div style={{ marginTop: 14, fontSize: 13, color: "#64748b" }}>
                <span style={{ fontWeight: 600, color: "#475569" }}>Partners: </span>
                {partners.map((p, i) => (
                  <span key={p.id}>
                    <button
                      onClick={() => onShowProfile(p.id)}
                      style={{ padding: 0, border: "none", background: "transparent", color: "#3A86FF", fontWeight: 700, cursor: "pointer", fontSize: 13, textDecoration: "underline" }}
                    >{p.name}</button>
                    {i < partners.length - 1 && <span style={{ color: "#cbd5e1" }}>, </span>}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Stats column */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "stretch" }}>
            <StatTile label="MATCHES" value={recent.length} color="#3A86FF" />
            <StatTile label="WINS" value={wins} color="#22c55e" />
            <StatTile label="LOSSES" value={losses} color="#ef4444" />
            <StatTile label="WIN RATE" value={recent.length > 0 ? `${Math.round(wins / recent.length * 100)}%` : "—"} color="#a855f7" />
          </div>
        </div>
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <SectionHeader color="#3A86FF" emoji="🗓️">Upcoming</SectionHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {upcoming.map(m => <MatchRow key={m.id} m={m} player={player} teamIds={teamIds} categories={categories} catById={catById} stageLabel={stageLabel} tName={tName} variant="upcoming" />)}
          </div>
        </div>
      )}

      {/* Recent */}
      {recent.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <SectionHeader color="#22c55e" emoji="🏆">Recent Results</SectionHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {recent.map(m => <MatchRow key={m.id} m={m} player={player} teamIds={teamIds} categories={categories} catById={catById} stageLabel={stageLabel} tName={tName} variant="recent" />)}
          </div>
        </div>
      )}

      {/* Standings — one section per group the player is in */}
      {playerGroups.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <SectionHeader color="#a855f7" emoji="📊">Group Standings</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14 }}>
            {playerGroups.map(({ groupIdx, group }) => {
              const standings = getStandings(group, groupIdx);
              const groupCat = group[0] ? catById[group[0].category_id] : null;
              return (
                <div key={`${groupCat?.id ?? "?"}-${groupIdx}`} style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8ecf1", overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,0.04)" }}>
                  <div style={{ padding: "12px 16px", background: "linear-gradient(90deg,#f8fafc 0%, #fff 70%)", borderBottom: "1px solid #e8ecf1", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ display: "inline-block", width: 4, height: 18, background: "#a855f7", borderRadius: 1 }} />
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#1a1a2e", letterSpacing: 1.3, textTransform: "uppercase" }}>{groupCat?.name ?? "Group"} · Group {String.fromCharCode(65 + groupIdx)}</span>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", color: "#64748b", fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase" }}>
                        <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 700 }}>#</th>
                        <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 700 }}>Team</th>
                        <th style={{ textAlign: "center", padding: "8px 8px", fontWeight: 700 }}>W-L</th>
                        <th style={{ textAlign: "center", padding: "8px 8px", fontWeight: 700 }}>+/-</th>
                        <th style={{ textAlign: "center", padding: "8px 8px", fontWeight: 700 }}>PTS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((s, i) => {
                        const isMine = teamIds.has(s.team.id);
                        return (
                          <tr key={s.team.id} style={{ background: isMine ? "rgba(168,85,247,0.08)" : i % 2 === 0 ? "#fff" : "#fafbfc", borderTop: "1px solid #e8ecf1" }}>
                            <td style={{ padding: "10px 12px", fontWeight: 800, color: i === 0 ? "#f59e0b" : i === 1 ? "#94a3b8" : "#cbd5e1" }}>{i + 1}</td>
                            <td style={{ padding: "10px 12px", fontWeight: isMine ? 800 : 600, color: isMine ? "#a855f7" : "#1a1a2e" }}>
                              {s.team.p2 ? `${s.team.p1.name} & ${s.team.p2.name}` : s.team.p1.name}
                              {isMine && <span style={{ marginLeft: 8, fontSize: 10, color: "#a855f7", letterSpacing: 1.2, fontWeight: 700 }}>YOU</span>}
                            </td>
                            <td style={{ padding: "10px 8px", textAlign: "center", color: "#475569", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.w}-{s.l}</td>
                            <td style={{ padding: "10px 8px", textAlign: "center", fontWeight: 700, color: (s.pf - s.pa) > 0 ? "#22c55e" : (s.pf - s.pa) < 0 ? "#ef4444" : "#94a3b8", fontVariantNumeric: "tabular-nums" }}>{(s.pf - s.pa) > 0 ? "+" : ""}{s.pf - s.pa}</td>
                            <td style={{ padding: "10px 8px", textAlign: "center", fontWeight: 800, color: "#1a1a2e", fontVariantNumeric: "tabular-nums" }}>{s.pts}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {upcoming.length === 0 && recent.length === 0 && playerGroups.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 14, padding: 40, textAlign: "center", border: "1px solid #e8ecf1", color: "#94a3b8" }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🏸</div>
          <p style={{ margin: 0, fontSize: 14, color: "#64748b", fontWeight: 600 }}>No matches yet for this player.</p>
          {playerCats.length === 0 && <p style={{ margin: "6px 0 0", fontSize: 12 }}>Add categories from the Players tab to assign them to a tournament category.</p>}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ minWidth: 84, padding: "12px 14px", background: "#f8fafc", border: "1px solid #e8ecf1", borderRadius: 10, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 9, color: "#94a3b8", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#1a1a2e", marginTop: 4, letterSpacing: -0.5, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function SectionHeader({ color, emoji, children }: { color: string; emoji: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <span style={{ fontSize: 22 }}>{emoji}</span>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#1a1a2e", letterSpacing: 0.3 }}>{children}</h2>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${color}55, transparent)`, marginLeft: 6 }} />
    </div>
  );
}

function MatchRow({
  m, player, teamIds, categories, catById, stageLabel, tName, variant,
}: {
  m: ProjectedMatch;
  player: Player;
  teamIds: Set<string>;
  categories: Category[];
  catById: Record<string, Category | undefined>;
  stageLabel: (m: ProjectedMatch) => string;
  tName: (id: string | null) => string;
  variant: "upcoming" | "recent";
}) {
  void categories; void player;
  const isLive = m.status === "live";
  const isWin = m.confirmed && m.winner_id && teamIds.has(m.winner_id);
  const isLoss = m.confirmed && m.winner_id && !teamIds.has(m.winner_id);
  const myTeamA = m.team_a_id && teamIds.has(m.team_a_id);
  const myTeamB = m.team_b_id && teamIds.has(m.team_b_id);
  const cat = catById[m.category_id];

  const accent = isLive ? "#ef4444" : isWin ? "#22c55e" : isLoss ? "#ef4444" : "#3A86FF";

  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: "12px 16px", border: "1px solid #e8ecf1", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", boxShadow: "0 1px 3px rgba(0,0,0,0.03)", borderLeft: `4px solid ${accent}` }}>
      {/* Category + stage */}
      <div style={{ minWidth: 110 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: "#3A86FF", letterSpacing: 1.2, textTransform: "uppercase" }}>{cat?.name ?? ""}</div>
        <div style={{ fontSize: 9, color: "#94a3b8", letterSpacing: 1, fontWeight: 600, marginTop: 2 }}>{stageLabel(m)}</div>
      </div>

      {/* Teams + score */}
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: myTeamA ? 800 : 600, color: myTeamA ? "#1a1a2e" : "#475569" }}>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tName(m.team_a_id)}</span>
          {variant === "recent" && <span style={{ fontSize: 18, fontWeight: 800, color: m.winner_id === m.team_a_id ? "#22c55e" : "#94a3b8", minWidth: 24, textAlign: "right" }}>{m.score_a ?? 0}</span>}
        </div>
        <div style={{ height: 1, background: "#f1f5f9", margin: "4px 0" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: myTeamB ? 800 : 600, color: myTeamB ? "#1a1a2e" : "#475569" }}>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tName(m.team_b_id)}</span>
          {variant === "recent" && <span style={{ fontSize: 18, fontWeight: 800, color: m.winner_id === m.team_b_id ? "#22c55e" : "#94a3b8", minWidth: 24, textAlign: "right" }}>{m.score_b ?? 0}</span>}
        </div>
      </div>

      {/* Right side meta */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, minWidth: 90 }}>
        {variant === "upcoming" && (
          <>
            {isLive ? (
              <span style={{ fontSize: 10, fontWeight: 800, color: "#ef4444", letterSpacing: 1.5, padding: "3px 8px", background: "#fef2f2", borderRadius: 4, border: "1px solid #fecaca", display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#ef4444" }} />LIVE
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "#475569", fontWeight: 700 }}>{fmtClock(m.projected_start_at)}</span>
            )}
            {m.court_number != null && <span style={{ fontSize: 10, fontWeight: 700, color: "#475569", padding: "2px 6px", background: "#f1f5f9", borderRadius: 4 }}>COURT {m.court_number}</span>}
          </>
        )}
        {variant === "recent" && (
          <>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, padding: "3px 8px", borderRadius: 4, color: isWin ? "#22c55e" : isLoss ? "#ef4444" : "#94a3b8", background: isWin ? "#dcfce7" : isLoss ? "#fef2f2" : "#f8fafc", border: `1px solid ${isWin ? "#bbf7d0" : isLoss ? "#fecaca" : "#e2e8f0"}` }}>
              {isWin ? "WON" : isLoss ? "LOST" : "—"}
            </span>
            {m.confirmed_at && <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{fmtClock(m.confirmed_at)}</span>}
          </>
        )}
      </div>
    </div>
  );
}
