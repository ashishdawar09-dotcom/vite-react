import { useState } from "react";
import { CategoryFilter } from "../../components/CategoryFilter";
import { Av } from "../../components/ui";
import { recommendFormats, describeFormat, type FormatPlan } from "../../lib/formatPlanner";
import type { Category, Player, TeamWithPlayers, Tournament } from "../../types";
import { TeamDetailModal } from "./TeamDetailModal";

/**
 * Team formation + tournament format chooser.
 *
 * Three logical sections:
 *   1. Invalid-teams cleanup banner (admin, only when invalid teams
 *      exist in the current category).
 *   2. Teams grid — one card per team, category badge when "All" filter
 *      is active. Admins tap a card to open it; deleting from there asks
 *      for a reason (no one-tap delete on the card itself).
 *   3. Format chooser (admin, phase==="none", >=2 teams) — three
 *      cards (Recommended / More games / Compact / Super / Ultra Compact) leading to a
 *      "Start Group Stage" CTA.
 *
 * Singles categories before the group stage list every active player in
 * the category instead: they are all entered when the stage starts, so
 * there is no pairing step and no per-player remove (use Sit Out).
 *
 * There is deliberately no reset button: wiping teams and matches is done
 * by hand on request, never from the app.
 */
export function TeamsTab({
  tournament,
  categories,
  currentCategoryId,
  setCurrentCategoryId,
  currentCategory,
  catById,
  teamsView,
  singlesEntrants,
  invalidTeamsInCategory,
  phase,
  isAdmin,
  deleteTeam,
  cleanupInvalidTeams,
  selectedFormatLabel,
  setSelectedFormatLabel,
  onStartGroupStage,
  btn,
}: {
  tournament: Tournament;
  categories: Category[];
  currentCategoryId: string | null;
  setCurrentCategoryId: (id: string | null) => void;
  currentCategory: Category | null;
  catById: Record<string, Category | undefined>;
  teamsView: TeamWithPlayers[];
  singlesEntrants: Player[];
  invalidTeamsInCategory: TeamWithPlayers[];
  phase: "none" | "group" | "knockout";
  isAdmin: boolean;
  deleteTeam: (id: string, reason: string) => Promise<void>;
  cleanupInvalidTeams: () => Promise<void>;
  selectedFormatLabel: FormatPlan["label"];
  setSelectedFormatLabel: (l: FormatPlan["label"]) => void;
  onStartGroupStage: (override?: { groupsCount: number; topNAdvance: number; roundsPerPair: number }) => void;
  btn: (bg?: string, clr?: string) => React.CSSProperties;
}) {
  const singlesDraw = currentCategory?.team_size === 1 && phase === "none";
  const cards = singlesDraw
    ? singlesEntrants.map(p => ({ key: p.id, teamId: null, category_id: currentCategory.id, p1: p, p2: null }))
    : teamsView.map(t => ({ key: t.id, teamId: t.id, category_id: t.category_id, p1: t.p1, p2: t.p2 }));
  const [openTeamKey, setOpenTeamKey] = useState<string | null>(null);
  const canManage = isAdmin && phase === "none";
  const teamLabel = (i: number) => (currentCategory?.team_size === 1 ? `Player ${i + 1}` : `Team ${i + 1}`);
  const openIndex = cards.findIndex(c => c.key === openTeamKey && c.teamId);
  const openCard = openIndex >= 0 ? cards[openIndex] : null;
  const formatOptions = cards.length >= 2 ? recommendFormats(cards.length) : [];
  const selectedPlan = formatOptions.find(o => o.label === selectedFormatLabel) ?? formatOptions[0];
  const courts = Math.max(1, tournament.num_courts || 1);
  const matchMinutes = currentCategory?.match_minutes ?? 12;
  const accentFor = (label: FormatPlan["label"]) =>
    label === "Recommended" ? "#84cc16" :
    label === "More games" ? "#a855f7" :
    label === "Super Compact" ? "#f59e0b" :
    label === "Ultra Compact" ? "#f43f5e" : "#3b82f6";

  const handleStart = () => {
    if (!selectedPlan) return onStartGroupStage();
    onStartGroupStage({
      groupsCount: selectedPlan.groupsCount,
      topNAdvance: selectedPlan.topNAdvance,
      roundsPerPair: selectedPlan.roundsPerPair,
    });
  };

  return (
    <div>
      <CategoryFilter categories={categories} currentCategoryId={currentCategoryId} onSelect={setCurrentCategoryId} />

      {isAdmin && phase === "none" && currentCategoryId && invalidTeamsInCategory.length > 0 && (
        <div style={{ background: "linear-gradient(90deg, rgba(239,68,68,0.08), rgba(239,68,68,0.04))", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 12, padding: "14px 18px", marginBottom: 18, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="font-display" style={{ fontSize: 12, fontWeight: 800, color: "#ef4444", letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 4 }}>
              ⚠ {invalidTeamsInCategory.length} invalid team{invalidTeamsInCategory.length === 1 ? "" : "s"} detected
            </div>
            <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.4 }}>
              {invalidTeamsInCategory.length === 1 ? "One team has" : "These teams have"} a player who isn't assigned to <strong>{currentCategory?.name ?? "this category"}</strong>. Clean them up to restore correct counts.
            </div>
          </div>
          <button
            onClick={cleanupInvalidTeams}
            className="font-display"
            style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontWeight: 800, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", cursor: "pointer", boxShadow: "0 2px 8px rgba(220,38,38,0.4)" }}
          >
            Clean Up Invalid Teams
          </button>
        </div>
      )}

      {cards.length === 0 ? (
        <div style={{ textAlign: "center", padding: 50, color: "#94a3b8" }}><p>{singlesDraw ? "No active players in this category yet." : "No teams yet."}</p></div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 14 }}>
            {cards.map((t, i) => {
              const clickable = canManage && !!t.teamId;
              return (
              <div
                key={t.key}
                {...(clickable && {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": `Open ${teamLabel(i)}`,
                  onClick: () => setOpenTeamKey(t.key),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenTeamKey(t.key); }
                  },
                  onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.borderColor = "#93c5fd"; },
                  onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.borderColor = "#e8ecf1"; },
                })}
                style={{ background: "#fff", borderRadius: 16, padding: 20, border: "1px solid #e8ecf1", boxShadow: "0 4px 16px rgba(0,0,0,0.04)", position: "relative", overflow: "hidden", cursor: clickable ? "pointer" : undefined, transition: "border-color .15s" }}
              >
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: `linear-gradient(90deg,${t.p1.color},${t.p2?.color ?? t.p1.color})` }} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <span style={{ fontWeight: 800, fontSize: 12, color: "#3A86FF", textTransform: "uppercase", letterSpacing: 2 }}>
                    {teamLabel(i)}
                  </span>
                  {!currentCategoryId && (() => {
                    const c = catById[t.category_id];
                    return c ? <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "#eff6ff", color: "#3A86FF", border: "1px solid #bfdbfe" }}>{c.name}</span> : null;
                  })()}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <Av name={t.p1.name} photo={t.p1.photo_url} sz={40} color={t.p1.color} />
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{t.p1.name}</span>
                </div>
                {t.p2 && (
                  <>
                    <div style={{ textAlign: "center", color: "#3A86FF", fontWeight: 900, fontSize: 14, margin: "4px 0", letterSpacing: 2 }}>&amp;</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                      <Av name={t.p2.name} photo={t.p2.photo_url} sz={40} color={t.p2.color} />
                      <span style={{ fontWeight: 700, fontSize: 16 }}>{t.p2.name}</span>
                    </div>
                  </>
                )}
                {clickable && (
                  <div style={{ marginTop: 12, fontSize: 11, color: "#94a3b8", textAlign: "right" }}>Tap to manage</div>
                )}
              </div>
              );
            })}
          </div>

          {openCard?.teamId && (
            <TeamDetailModal
              teamLabel={teamLabel(openIndex)}
              categoryName={catById[openCard.category_id]?.name ?? null}
              p1={openCard.p1}
              p2={openCard.p2}
              onDelete={(reason) => deleteTeam(openCard.teamId!, reason)}
              onClose={() => setOpenTeamKey(null)}
            />
          )}

          {isAdmin && cards.length >= 2 && phase === "none" && formatOptions.length > 0 && (
            <div style={{ marginTop: 32, padding: "26px 28px", background: "linear-gradient(135deg,#1a1a2e,#2d3a5c)", borderRadius: 18, color: "#fff" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
                <div>
                  <div className="font-display" style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2.5, color: "#93c5fd", textTransform: "uppercase", marginBottom: 4 }}>Tournament Format</div>
                  <div style={{ fontSize: 14, color: "#cbd5e1" }}>Choose how the {cards.length} {singlesDraw ? "players" : "teams"} will compete.</div>
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "right", lineHeight: 1.6 }}>
                  Estimates assume<br />{courts} court{courts === 1 ? "" : "s"} · {matchMinutes} min/match
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))`, gap: 12, marginBottom: 22 }}>
                {formatOptions.map(opt => {
                  const selected = opt.label === selectedFormatLabel;
                  const accent = accentFor(opt.label);
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setSelectedFormatLabel(opt.label)}
                      style={{
                        padding: "14px 16px",
                        borderRadius: 12,
                        border: selected ? `2px solid ${accent}` : "2px solid rgba(255,255,255,0.08)",
                        background: selected ? `${accent}1A` : "rgba(255,255,255,0.03)",
                        color: "#fff",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "border-color .15s, background .15s",
                        boxShadow: selected ? `0 8px 24px ${accent}33` : "none",
                      }}
                    >
                      <div className="font-display" style={{ fontSize: 11, fontWeight: 800, color: accent, letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                        {selected ? "✓" : "○"} {opt.label}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 8, lineHeight: 1.35 }}>{describeFormat(opt)}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 11, color: "#94a3b8", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
                        <span><strong style={{ color: "#fff", fontSize: 13 }}>{opt.totalMatches}</strong> matches</span>
                        <span>~{opt.estimatedMinutes(matchMinutes, courts)} min</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {singlesDraw && (
                <div style={{ fontSize: 13, color: "#cbd5e1", marginBottom: 12, textAlign: "center" }}>
                  All {cards.length} active players will be entered. To leave someone out, use Sit Out on the Players tab.
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "center" }}>
                <button onClick={handleStart} style={{ ...btn("#84cc16"), padding: "16px 44px", fontSize: 17, borderRadius: 14, fontWeight: 800 }}>
                  📊 Start Group Stage
                </button>
              </div>
              {selectedPlan && (
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 10, textAlign: "center" }}>
                  {selectedPlan.totalGroupGames} group games + {selectedPlan.totalKnockoutGames} knockout
                  {selectedPlan.knockoutShape !== "RR-only" && selectedPlan.knockoutShape !== "none" && " · top advances per " + (selectedPlan.groupsCount === 1 ? "category" : "group")}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
