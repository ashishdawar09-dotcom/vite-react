import { CategoryFilter } from "../../components/CategoryFilter";
import { Av } from "../../components/ui";
import { PlayerProfileView } from "../../components/PlayerProfileView";
import type { Category, Player, PlayerCategory, ProjectedMatch, TeamWithPlayers } from "../../types";
import type { GroupStanding } from "../groupstage/GroupsTab";

/**
 * Player Profiles tab. Two modes:
 *
 *   1. Grid view (default): cards for every player, photo + name +
 *      categories + status + "View Profile" CTA.
 *   2. Single-player view: PlayerProfileView shown when
 *      profileViewPlayerId is non-null.
 *
 * Admins can click the photo to upload, click the name to edit
 * inline; everyone can use the View Profile button.
 */
export function ProfilesTab({
  categories,
  currentCategoryId,
  setCurrentCategoryId,
  catById,
  players,
  allTeamsView,
  projectedMatches,
  playerCategories,
  playerCategoryMap,
  paired,
  groups,
  getStandings,
  profileViewPlayerId,
  setProfileViewPlayerId,
  isAdmin,
  editingId,
  editName,
  setEditName,
  startEdit,
  saveEdit,
  fileRefs,
  handlePhoto,
}: {
  categories: Category[];
  currentCategoryId: string | null;
  setCurrentCategoryId: (id: string | null) => void;
  catById: Record<string, Category | undefined>;
  players: Player[];
  allTeamsView: TeamWithPlayers[];
  projectedMatches: ProjectedMatch[];
  playerCategories: PlayerCategory[];
  playerCategoryMap: Map<string, Set<string>>;
  paired: Set<string>;
  groups: TeamWithPlayers[][];
  getStandings: (g: TeamWithPlayers[], gi: number) => GroupStanding[];
  profileViewPlayerId: string | null;
  setProfileViewPlayerId: (id: string | null) => void;
  isAdmin: boolean;
  editingId: string | null;
  editName: string;
  setEditName: (s: string) => void;
  startEdit: (p: Player) => void;
  saveEdit: (id: string) => Promise<void>;
  fileRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  handlePhoto: (id: string, e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}) {
  // Single-player profile view takes precedence over the grid.
  if (profileViewPlayerId) {
    const p = players.find(x => x.id === profileViewPlayerId);
    if (!p) {
      // Player was deleted while their profile was open — bail back to grid.
      setProfileViewPlayerId(null);
      return null;
    }
    return (
      <PlayerProfileView
        player={p}
        allTeams={allTeamsView}
        matches={projectedMatches}
        categories={categories}
        playerCategories={playerCategories}
        groups={groups}
        getStandings={getStandings}
        onBack={() => setProfileViewPlayerId(null)}
        onShowProfile={(pid) => setProfileViewPlayerId(pid)}
      />
    );
  }

  const filteredProfiles = currentCategoryId
    ? players.filter(p => playerCategoryMap.get(p.id)?.has(currentCategoryId))
    : players;

  return (
    <div>
      <CategoryFilter categories={categories} currentCategoryId={currentCategoryId} onSelect={setCurrentCategoryId} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: 28 }}>👤</span>
        <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Player Profiles</h2>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "#94a3b8" }}>
          {isAdmin ? "Click photo to upload, name to edit, or VIEW for full profile" : "Click VIEW for full profile"}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 18 }}>
        {filteredProfiles.map((p, i) => (
          <div key={p.id} style={{ background: "#fff", borderRadius: 18, overflow: "hidden", border: "1px solid #e8ecf1", boxShadow: "0 4px 20px rgba(0,0,0,0.06)", opacity: p.active ? 1 : 0.55, position: "relative" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 6, background: p.color }} />
            <div style={{ padding: "26px 16px 18px", textAlign: "center" }}>
              <div style={{ position: "relative", display: "inline-block", cursor: isAdmin ? "pointer" : "default" }} onClick={() => isAdmin && fileRefs.current[`prof-${p.id}`]?.click()}>
                <Av name={p.name} photo={p.photo_url} sz={120} color={p.color} />
                {isAdmin && (
                  <div style={{ position: "absolute", bottom: 4, right: 4, background: "#3A86FF", color: "#fff", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, border: "3px solid #fff", boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}>📷</div>
                )}
                <input ref={el => { fileRefs.current[`prof-${p.id}`] = el; }} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handlePhoto(p.id, e)} />
              </div>
              {editingId === p.id ? (
                <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} onBlur={() => saveEdit(p.id)} onKeyDown={e => e.key === "Enter" && saveEdit(p.id)} style={{ width: "85%", marginTop: 14, padding: "8px 12px", borderRadius: 8, border: "2px solid #3A86FF", fontSize: 17, outline: "none", textAlign: "center", fontWeight: 700 }} />
              ) : (
                <div onClick={() => isAdmin && startEdit(p)} style={{ marginTop: 14, fontSize: 18, fontWeight: 800, cursor: isAdmin ? "pointer" : "default", color: "#1a1a2e" }}>
                  <span style={{ color: "#94a3b8", fontSize: 13, fontWeight: 500, marginRight: 6 }}>#{i + 1}</span>{p.name}
                </div>
              )}
              {p.note && <div style={{ fontSize: 12, color: "#E63946", marginTop: 6, padding: "3px 10px", background: "#fef2f2", borderRadius: 12, display: "inline-block" }}>⚠️ {p.note}</div>}
              {(() => {
                const pCats = playerCategoryMap.get(p.id);
                return pCats && pCats.size > 0 ? (
                  <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap", justifyContent: "center" }}>
                    {[...pCats].map(cid => {
                      const c = catById[cid];
                      return c ? <span key={cid} style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "#eff6ff", color: "#3A86FF", border: "1px solid #bfdbfe" }}>{c.name}</span> : null;
                    })}
                  </div>
                ) : null;
              })()}
              <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>{p.active ? (paired.has(p.id) ? "✓ On a team" : "Available") : "Inactive"}</div>
              <button
                onClick={() => setProfileViewPlayerId(p.id)}
                style={{ marginTop: 14, width: "100%", padding: "9px 14px", borderRadius: 10, border: "1px solid #3A86FF", background: "transparent", color: "#3A86FF", fontSize: 11, fontWeight: 800, letterSpacing: 1.5, cursor: "pointer", textTransform: "uppercase", transition: "all .15s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "#3A86FF"; e.currentTarget.style.color = "#fff"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#3A86FF"; }}
              >
                View Profile →
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
