import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion"; /* NEW: makeover motion */
import { Av } from "./ui";
import { fmtClock } from "../hooks/useScheduling";
import { updatePlayer } from "../lib/db";
import type { Category, Player, PlayerCategory, ProjectedMatch, Team } from "../types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  isAdmin,
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
  isAdmin: boolean;
}) {
  const reduceMotion = useReducedMotion(); /* NEW: motion gate for WinRateRing draw-on-view */
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState(player.email ?? "");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);

  const startEditEmail = () => {
    setEmailDraft(player.email ?? "");
    setEmailError(null);
    setEditingEmail(true);
  };
  const cancelEditEmail = () => {
    setEditingEmail(false);
    setEmailError(null);
  };
  const saveEmail = async () => {
    const trimmed = emailDraft.trim().toLowerCase();
    if (trimmed && !EMAIL_RE.test(trimmed)) {
      setEmailError("Doesn't look like a valid email address.");
      return;
    }
    setSavingEmail(true);
    setEmailError(null);
    try {
      await updatePlayer(player.id, { email: trimmed || null });
      setEditingEmail(false);
    } catch (e: unknown) {
      setEmailError(e instanceof Error ? e.message : "Failed to save email.");
    } finally {
      setSavingEmail(false);
    }
  };
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

          {/* Stats column — MAKEOVER: WIN RATE tile replaced with WinRateRing (annular SVG drawn on view) */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "stretch" }}>
            <StatTile label="MATCHES" value={recent.length} color="#3A86FF" />
            <StatTile label="WINS" value={wins} color="#22c55e" />
            <StatTile label="LOSSES" value={losses} color="#ef4444" />
            <WinRateRing percentage={recent.length > 0 ? Math.round(wins / recent.length * 100) : null} reduceMotion={!!reduceMotion} />
          </div>
        </div>
      </div>

      {/* Contact */}
      <div style={{ background: "#fff", borderRadius: 14, padding: "14px 18px", border: "1px solid #e8ecf1", marginBottom: 22, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18 }}>✉️</span>
          <div style={{ fontSize: 10, color: "#94a3b8", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, minWidth: 60 }}>Email</div>
          {editingEmail && isAdmin ? (
            <>
              <input
                type="email"
                value={emailDraft}
                onChange={e => { setEmailDraft(e.target.value); if (emailError) setEmailError(null); }}
                onKeyDown={e => {
                  if (e.key === "Enter") void saveEmail();
                  if (e.key === "Escape") cancelEditEmail();
                }}
                placeholder="player@example.com"
                autoFocus
                disabled={savingEmail}
                style={{ flex: 1, minWidth: 200, padding: "7px 12px", borderRadius: 8, border: `2px solid ${emailError ? "#ef4444" : "#3A86FF"}`, fontSize: 13, outline: "none", fontFamily: "inherit" }}
              />
              <button
                onClick={() => void saveEmail()}
                disabled={savingEmail}
                style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: "#3A86FF", color: "#fff", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, cursor: savingEmail ? "wait" : "pointer", opacity: savingEmail ? 0.7 : 1 }}
              >
                {savingEmail ? "Saving…" : "Save"}
              </button>
              <button
                onClick={cancelEditEmail}
                disabled={savingEmail}
                style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, cursor: "pointer" }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <div style={{ flex: 1, fontSize: 14, color: player.email ? "#1a1a2e" : "#94a3b8", fontWeight: player.email ? 600 : 500, fontStyle: player.email ? "normal" : "italic" }}>
                {player.email ?? "No email on file"}
              </div>
              {isAdmin && (
                <button
                  onClick={startEditEmail}
                  style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#3A86FF", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, cursor: "pointer" }}
                >
                  ✏️ Edit
                </button>
              )}
            </>
          )}
        </div>
        {emailError && (
          <div style={{ marginTop: 8, marginLeft: 30, fontSize: 12, color: "#ef4444", fontWeight: 600 }}>
            {emailError}
          </div>
        )}
        {!editingEmail && isAdmin && (
          <div style={{ marginTop: 6, marginLeft: 30, fontSize: 11, color: "#94a3b8" }}>
            Used to notify the player when their court is allocated.
          </div>
        )}
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
          <SectionHeader color="#3A86FF" emoji="📊">Group Standings</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14 }}>
            {playerGroups.map(({ groupIdx, group }) => {
              const standings = getStandings(group, groupIdx);
              const groupCat = group[0] ? catById[group[0].category_id] : null;
              return (
                <div key={`${groupCat?.id ?? "?"}-${groupIdx}`} style={{ background: "#fff", borderRadius: 14, border: "1px solid #e8ecf1", overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,0.04)" }}>
                  <div style={{ padding: "12px 16px", background: "linear-gradient(90deg,#f8fafc 0%, #fff 70%)", borderBottom: "1px solid #e8ecf1", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ display: "inline-block", width: 4, height: 18, background: "#3A86FF", borderRadius: 1 }} />
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
                            <td style={{ padding: "10px 12px", fontWeight: isMine ? 800 : 600, color: isMine ? "#3A86FF" : "#1a1a2e" }}>
                              {s.team.p2 ? `${s.team.p1.name} & ${s.team.p2.name}` : s.team.p1.name}
                              {isMine && <span style={{ marginLeft: 8, fontSize: 10, color: "#3A86FF", letterSpacing: 1.2, fontWeight: 700 }}>YOU</span>}
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
    <div style={{ minWidth: 94, padding: "12px 14px", background: "#f8fafc", border: "1px solid #e8ecf1", borderRadius: 10, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 9, color: "#94a3b8", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700 }}>{label}</div>
      {/* MAKEOVER: 22 -> 30 px value, tabular-nums for digit alignment */}
      <div style={{ fontSize: 30, fontWeight: 800, color: "#1a1a2e", marginTop: 6, letterSpacing: -0.5, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

/* NEW: WinRateRing — annular SVG ring that draws on view via Framer Motion.
   Replaces the flat WIN RATE StatTile to give the profile a visual centerpiece. */
function WinRateRing({ percentage, reduceMotion }: { percentage: number | null; reduceMotion: boolean }) {
  const size = 76;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = percentage !== null ? circumference * (1 - percentage / 100) : circumference;
  return (
    <div style={{ minWidth: 110, padding: "10px 14px", background: "#f8fafc", border: "1px solid #e8ecf1", borderRadius: 10, borderLeft: "3px solid #3A86FF", display: "flex", flexDirection: "column", alignItems: "stretch", gap: 4 }}>
      <div style={{ fontSize: 9, color: "#94a3b8", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700 }}>WIN RATE</div>
      <div style={{ position: "relative", width: size, height: size, alignSelf: "center", marginTop: 2 }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e8ecf1" strokeWidth={stroke} />
          {percentage !== null && (
            <motion.circle
              cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#3A86FF" strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: reduceMotion ? offset : circumference }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: reduceMotion ? 0 : 1.1, ease: [0.0, 0.0, 0.2, 1], delay: 0.15 }}
            />
          )}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, color: "#1a1a2e", letterSpacing: -0.5, fontVariantNumeric: "tabular-nums" }}>
          {percentage !== null ? `${percentage}%` : "—"}
        </div>
      </div>
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
