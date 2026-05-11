import * as db from "../../lib/db";
import { CategoryFilter } from "../../components/CategoryFilter";
import { Av } from "../../components/ui";
import { toast } from "../../components/Toast";
import type { Category, Player } from "../../types";

/**
 * Player roster + management. Admins can add players with category
 * assignments, inline-edit names, toggle active state, choose
 * partners, and delete players. Auto-Pair button at the bottom for
 * batch team formation in the current category.
 *
 * Heavy prop surface (~22 props) reflecting the breadth of in-place
 * actions on a player card. Could shrink with a TournamentContext
 * in a future pass.
 */
export function RegisterTab({
  categories,
  currentCategoryId,
  setCurrentCategoryId,
  catById,
  players,
  playerCategoryMap,
  isAdmin,
  newName,
  setNewName,
  addPlayer,
  addPlayerCats,
  setAddPlayerCats,
  editingId,
  editName,
  setEditName,
  startEdit,
  saveEdit,
  editingPlayerCats,
  setEditingPlayerCats,
  pendingPlayerCats,
  setPendingPlayerCats,
  toggleActive,
  handleDeletePlayer,
  handlePhoto,
  openPartnerPicker,
  autoGen,
  fileRefs,
  paired,
  unpaired,
  btn,
}: {
  categories: Category[];
  currentCategoryId: string | null;
  setCurrentCategoryId: (id: string | null) => void;
  catById: Record<string, Category | undefined>;
  players: Player[];
  playerCategoryMap: Map<string, Set<string>>;
  isAdmin: boolean;
  newName: string;
  setNewName: (s: string) => void;
  addPlayer: () => Promise<void>;
  addPlayerCats: Set<string>;
  setAddPlayerCats: (s: Set<string>) => void;
  editingId: string | null;
  editName: string;
  setEditName: (s: string) => void;
  startEdit: (p: Player) => void;
  saveEdit: (id: string) => Promise<void>;
  editingPlayerCats: string | null;
  setEditingPlayerCats: (id: string | null) => void;
  pendingPlayerCats: Set<string> | null;
  setPendingPlayerCats: React.Dispatch<React.SetStateAction<Set<string> | null>>;
  toggleActive: (id: string) => Promise<void>;
  handleDeletePlayer: (id: string) => Promise<void>;
  handlePhoto: (id: string, e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  openPartnerPicker: (pid: string) => void;
  autoGen: () => Promise<void>;
  fileRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  paired: Set<string>;
  unpaired: Player[];
  btn: (bg?: string, clr?: string) => React.CSSProperties;
}) {
  const filteredPlayers = currentCategoryId
    ? players.filter(p => playerCategoryMap.get(p.id)?.has(currentCategoryId))
    : players;

  return (
    <div>
      <CategoryFilter categories={categories} currentCategoryId={currentCategoryId} onSelect={setCurrentCategoryId} />

      {/* Add player with category checkboxes */}
      {isAdmin && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addPlayer()}
              placeholder="Enter new player name..."
              style={{ flex: 1, minWidth: 220, padding: "12px 16px", borderRadius: 12, border: "2px solid #e2e8f0", background: "#fff", fontSize: 15, outline: "none" }}
            />
            <button onClick={addPlayer} style={{ ...btn(), padding: "12px 24px", fontSize: 15 }}>+ Add Player</button>
          </div>
          {categories.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1 }}>ASSIGN TO:</span>
              {categories.map(c => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, border: addPlayerCats.has(c.id) ? "2px solid #3A86FF" : "1px solid #e2e8f0", background: addPlayerCats.has(c.id) ? "#eff6ff" : "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, color: addPlayerCats.has(c.id) ? "#3A86FF" : "#475569" }}>
                  <input
                    type="checkbox"
                    checked={addPlayerCats.has(c.id)}
                    onChange={e => {
                      const next = new Set(addPlayerCats);
                      if (e.target.checked) next.add(c.id); else next.delete(c.id);
                      setAddPlayerCats(next);
                    }}
                    style={{ accentColor: "#3A86FF" }}
                  />
                  {c.team_size === 1 ? "👤" : "👥"} {c.name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Player list */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
        {filteredPlayers.map((p, i) => {
          const pCats = playerCategoryMap.get(p.id);
          const isEditingCats = editingPlayerCats === p.id;
          return (
            <div key={p.id} style={{ background: "#fff", borderRadius: 14, padding: 16, display: "flex", alignItems: "center", gap: 14, border: "1px solid #e8ecf1", opacity: p.active ? 1 : 0.4, boxShadow: "0 2px 8px rgba(0,0,0,0.03)", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: p.color, borderRadius: "0 4px 4px 0" }} />
              <div style={{ position: "relative", cursor: isAdmin ? "pointer" : "default", marginLeft: 4 }} onClick={() => isAdmin && fileRefs.current[p.id]?.click()}>
                <Av name={p.name} photo={p.photo_url} sz={64} color={p.color} />
                {isAdmin && <div style={{ position: "absolute", bottom: -1, right: -1, background: "#3A86FF", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, border: "2px solid #fff", color: "#fff" }}>📷</div>}
                <input ref={el => { fileRefs.current[p.id] = el; }} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handlePhoto(p.id, e)} />
              </div>
              <div style={{ flex: 1 }}>
                {editingId === p.id ? (
                  <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} onBlur={() => saveEdit(p.id)} onKeyDown={e => e.key === "Enter" && saveEdit(p.id)} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "2px solid #3A86FF", fontSize: 15, outline: "none" }} />
                ) : (
                  <div style={{ fontWeight: 700, fontSize: 16, cursor: isAdmin ? "pointer" : "default" }} onClick={() => isAdmin && startEdit(p)}>
                    <span style={{ color: "#94a3b8", marginRight: 6, fontSize: 12, fontWeight: 500 }}>#{i + 1}</span>{p.name}
                  </div>
                )}
                {p.note && <div style={{ fontSize: 12, color: "#E63946", marginTop: 3 }}>⚠️ {p.note}</div>}
                {isEditingCats ? (
                  <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                    {categories.map(c => {
                      const has = pendingPlayerCats?.has(c.id) ?? false;
                      return (
                        <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: has ? "#eff6ff" : "#f8fafc", color: has ? "#3A86FF" : "#94a3b8", border: has ? "1px solid #bfdbfe" : "1px solid #e2e8f0", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={has}
                            onChange={async () => {
                              setPendingPlayerCats(prev => {
                                const next = new Set(prev ?? []);
                                if (has) next.delete(c.id); else next.add(c.id);
                                return next;
                              });
                              try {
                                if (has) await db.removePlayerFromCategory(p.id, c.id);
                                else await db.addPlayerToCategory(p.id, c.id);
                              } catch (e: any) {
                                setPendingPlayerCats(prev => {
                                  const next = new Set(prev ?? []);
                                  if (has) next.add(c.id); else next.delete(c.id);
                                  return next;
                                });
                                toast(e?.message ?? "Failed to update category assignment", "error");
                              }
                            }}
                            style={{ accentColor: "#3A86FF", width: 12, height: 12 }}
                          />
                          {c.name}
                        </label>
                      );
                    })}
                    <button onClick={() => setEditingPlayerCats(null)} style={{ fontSize: 10, padding: "2px 6px", border: "none", background: "transparent", color: "#3A86FF", cursor: "pointer", fontWeight: 700 }}>Done</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                    {pCats && pCats.size > 0 ? [...pCats].map(cid => {
                      const c = catById[cid];
                      return c ? <span key={cid} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "#eff6ff", color: "#3A86FF", border: "1px solid #bfdbfe" }}>{c.name}</span> : null;
                    }) : <span style={{ fontSize: 10, color: "#94a3b8" }}>No category</span>}
                    {isAdmin && <button onClick={() => setEditingPlayerCats(p.id)} style={{ fontSize: 10, padding: "2px 6px", border: "none", background: "transparent", color: "#3A86FF", cursor: "pointer", fontWeight: 700 }}>Edit</button>}
                  </div>
                )}
                {paired.has(p.id) && <div style={{ fontSize: 12, color: "#16a34a", marginTop: 3, fontWeight: 600 }}>✓ Team assigned</div>}
              </div>
              {isAdmin && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                  <button onClick={() => toggleActive(p.id)} style={{ ...btn(p.active ? "#e2e8f0" : "#2A9D8F", p.active ? "#475569" : "#fff"), padding: "6px 12px", fontSize: 12, borderRadius: 8, boxShadow: "none" }}>{p.active ? "Sit Out" : "Activate"}</button>
                  {p.active && !paired.has(p.id) && unpaired.length >= 2 && (
                    <button onClick={() => openPartnerPicker(p.id)} style={{ ...btn("#3A86FF"), padding: "6px 12px", fontSize: 12, borderRadius: 8 }}>Choose Partner</button>
                  )}
                  <button onClick={() => handleDeletePlayer(p.id)} style={{ ...btn("#dc2626"), padding: "6px 12px", fontSize: 12, borderRadius: 8 }}>Delete</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {isAdmin && unpaired.length >= 2 && currentCategoryId && (
        <div style={{ textAlign: "center", marginTop: 28 }}>
          <button onClick={autoGen} style={{ ...btn("#2A9D8F"), padding: "14px 36px", fontSize: 16, borderRadius: 14 }}>🎲 Auto-Pair All Players</button>
        </div>
      )}
      {unpaired.length === 1 && currentCategoryId && (
        <div style={{ textAlign: "center", marginTop: 16, padding: 14, background: "#fef3c7", borderRadius: 12, border: "1px solid #fde68a", color: "#92400e", fontSize: 14 }}>
          ⚠️ Odd player out: <strong>{unpaired[0].name}</strong>
        </div>
      )}
    </div>
  );
}
