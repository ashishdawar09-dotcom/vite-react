import { CategoryFilter } from "../../components/CategoryFilter";
import { Av } from "../../components/ui";
import { recommendFormats, describeFormat, type FormatPlan } from "../../lib/formatPlanner";
import type { Category, TeamWithPlayers, Tournament } from "../../types";

/**
 * Team formation + tournament format chooser.
 *
 * Three logical sections:
 *   1. Invalid-teams cleanup banner (admin, only when invalid teams
 *      exist in the current category).
 *   2. Teams grid — one card per team, X-button to remove (admin),
 *      category badge when "All" filter is active.
 *   3. Format chooser (admin, phase==="none", >=2 teams) — three
 *      cards (Recommended / More games / Compact) leading to a
 *      "Start Group Stage" CTA.
 *
 * Plus a "Reset This Tournament" admin button at the bottom.
 */
export function TeamsTab({
  tournament,
  categories,
  currentCategoryId,
  setCurrentCategoryId,
  currentCategory,
  catById,
  teamsView,
  invalidTeamsInCategory,
  phase,
  isAdmin,
  removeTeam,
  cleanupInvalidTeams,
  selectedFormatLabel,
  setSelectedFormatLabel,
  onStartGroupStage,
  resetAll,
  btn,
}: {
  tournament: Tournament;
  categories: Category[];
  currentCategoryId: string | null;
  setCurrentCategoryId: (id: string | null) => void;
  currentCategory: Category | null;
  catById: Record<string, Category | undefined>;
  teamsView: TeamWithPlayers[];
  invalidTeamsInCategory: TeamWithPlayers[];
  phase: "none" | "group" | "knockout";
  isAdmin: boolean;
  removeTeam: (id: string) => Promise<void>;
  cleanupInvalidTeams: () => Promise<void>;
  selectedFormatLabel: FormatPlan["label"];
  setSelectedFormatLabel: (l: FormatPlan["label"]) => void;
  onStartGroupStage: (override?: { groupsCount: number; topNAdvance: number; roundsPerPair: number }) => void;
  resetAll: () => Promise<void>;
  btn: (bg?: string, clr?: string) => React.CSSProperties;
}) {
  const formatOptions = teamsView.length >= 2 ? recommendFormats(teamsView.length) : [];
  const selectedPlan = formatOptions.find(o => o.label === selectedFormatLabel) ?? formatOptions[0];
  const courts = Math.max(1, tournament.num_courts || 1);
  const matchMinutes = currentCategory?.match_minutes ?? 12;
  const accentFor = (label: FormatPlan["label"]) =>
    label === "Recommended" ? "#84cc16" :
    label === "More games" ? "#a855f7" : "#3b82f6";

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
              {invalidTeamsInCategory.length === 1 ? "One team has" : "These teams have"} a player who isn't assigned to <strong>{currentCategory?.name ?? "this category"}</strong>. Likely from an Auto-Pair bug now fixed. Clean them up to restore correct counts.
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

      {teamsView.length === 0 ? (
        <div style={{ textAlign: "center", padding: 50, color: "#94a3b8" }}><p>No teams yet.</p></div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 14 }}>
            {teamsView.map((t, i) => (
              <div key={t.id} style={{ background: "#fff", borderRadius: 16, padding: 20, border: "1px solid #e8ecf1", boxShadow: "0 4px 16px rgba(0,0,0,0.04)", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: `linear-gradient(90deg,${t.p1.color},${t.p2?.color ?? t.p1.color})` }} />
                {isAdmin && phase === "none" && (
                  <button onClick={() => removeTeam(t.id)} title="Remove team" style={{ position: "absolute", top: 10, right: 10, width: 26, height: 26, borderRadius: "50%", border: "none", background: "#fef2f2", color: "#dc2626", cursor: "pointer", fontSize: 16, fontWeight: 700, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
                )}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <span style={{ fontWeight: 800, fontSize: 12, color: "#3A86FF", textTransform: "uppercase", letterSpacing: 2 }}>
                    {currentCategory?.team_size === 1 ? `Player ${i + 1}` : `Team ${i + 1}`}
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
              </div>
            ))}
          </div>

          {isAdmin && teamsView.length >= 2 && phase === "none" && formatOptions.length > 0 && (
            <div style={{ marginTop: 32, padding: "26px 28px", background: "linear-gradient(135deg,#1a1a2e,#2d3a5c)", borderRadius: 18, color: "#fff" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
                <div>
                  <div className="font-display" style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2.5, color: "#93c5fd", textTransform: "uppercase", marginBottom: 4 }}>Tournament Format</div>
                  <div style={{ fontSize: 14, color: "#cbd5e1" }}>Choose how the {teamsView.length} teams will compete.</div>
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

      {isAdmin && (
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button onClick={resetAll} style={{ ...btn("#E63946"), padding: "10px 22px", fontSize: 13, borderRadius: 10 }}>🔄 Reset This Tournament</button>
        </div>
      )}
    </div>
  );
}
