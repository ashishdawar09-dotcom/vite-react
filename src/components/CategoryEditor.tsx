import { useState } from "react";
import * as db from "../lib/db";
import type { Category, Player, PlayerCategory } from "../types";

export function CategoryEditor({
  tournamentId,
  category,
  players,
  playerCategories,
  onClose,
}: {
  tournamentId: string;
  category?: Category;
  players: Player[];
  playerCategories: PlayerCategory[];
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [teamSize, setTeamSize] = useState<1 | 2>(category?.team_size ?? 2);
  const [matchMin, setMatchMin] = useState(category?.match_minutes ?? 12);
  const [startsAt, setStartsAt] = useState<string>(category?.starts_at ? toLocalInput(category.starts_at) : "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) { alert("Category name required"); return; }
    setBusy(true);
    try {
      const startsIso = startsAt ? new Date(startsAt).toISOString() : null;
      if (category) {
        await db.updateCategory(category.id, { name: name.trim(), team_size: teamSize, match_minutes: matchMin, starts_at: startsIso });
      } else {
        await db.createCategory(tournamentId, name.trim(), teamSize, startsIso, matchMin);
      }
      onClose();
    } catch (e: any) { alert(e?.message ?? "Save failed"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!category) return;
    if (!confirm(`Delete "${category.name}" — all teams + matches in this category will be removed. Continue?`)) return;
    setBusy(true);
    try { await db.deleteCategory(category.id); onClose(); }
    catch (e: any) { alert(e?.message ?? "Delete failed"); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16, backdropFilter: "blur(6px)" }} onClick={onClose}>
      <div style={{ background: "#0f1e36", borderRadius: 14, padding: 28, maxWidth: 460, width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.5)", border: "1px solid #1a3050", color: "#fff" }} onClick={e => e.stopPropagation()}>
        <h3 className="font-display" style={{ margin: "0 0 18px", fontSize: 20, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>{category ? "Edit Category" : "New Category"}</h3>

        <Field label="Name">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Men's Singles" style={inputStyle} autoFocus />
        </Field>

        <Field label="Format">
          <div style={{ display: "flex", gap: 8 }}>
            <FormatBtn active={teamSize === 1} onClick={() => setTeamSize(1)}>👤 SINGLES</FormatBtn>
            <FormatBtn active={teamSize === 2} onClick={() => setTeamSize(2)}>👥 DOUBLES</FormatBtn>
          </div>
        </Field>

        <Field label="Match duration (default minutes)">
          <input type="number" min={5} max={60} value={matchMin} onChange={e => setMatchMin(parseInt(e.target.value) || 12)} style={inputStyle} />
        </Field>

        <Field label="Start time (optional)">
          <input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} style={inputStyle} />
        </Field>

        {category && (() => {
          const assignedIds = new Set(playerCategories.filter(pc => pc.category_id === category.id).map(pc => pc.player_id));
          const sorted = [...players].sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1;
            return a.sort_order - b.sort_order;
          });
          return (
            <Field label={`Players in this category (${assignedIds.size})`}>
              <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid #1a3050", borderRadius: 6, background: "#0a1628" }}>
                {sorted.map(p => {
                  const has = assignedIds.has(p.id);
                  return (
                    <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #1a3050", opacity: p.active ? 1 : 0.5 }}>
                      <input type="checkbox" checked={has} onChange={async () => {
                        if (has) await db.removePlayerFromCategory(p.id, category.id);
                        else await db.addPlayerToCategory(p.id, category.id);
                      }} style={{ accentColor: "#00d4ff", width: 16, height: 16 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: has ? "#00d4ff" : "#94a3b8" }}>{p.name}</span>
                      {!p.active && <span style={{ fontSize: 10, color: "#64748b" }}>(inactive)</span>}
                    </label>
                  );
                })}
              </div>
            </Field>
          );
        })()}

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          {category && <button disabled={busy} onClick={remove} style={{ padding: "10px 16px", background: "transparent", color: "#ef4444", border: "1px solid #ef4444", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 12, letterSpacing: 1 }}>DELETE</button>}
          <div style={{ flex: 1 }} />
          <button disabled={busy} onClick={onClose} style={{ padding: "10px 18px", background: "transparent", color: "#94a3b8", border: "1px solid #1a3050", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 12, letterSpacing: 1 }}>CANCEL</button>
          <button disabled={busy} onClick={save} className="font-display" style={{ padding: "10px 24px", background: "linear-gradient(135deg,#00b8ff,#0066ff)", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: busy ? "wait" : "pointer", fontSize: 13, letterSpacing: 1.5, opacity: busy ? 0.6 : 1 }}>SAVE</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 6, letterSpacing: 1.5, textTransform: "uppercase" }}>{label}</label>
      {children}
    </div>
  );
}

function FormatBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="font-display" style={{ flex: 1, padding: "10px 12px", borderRadius: 6, border: active ? "2px solid #00d4ff" : "1px solid #1a3050", background: active ? "rgba(0,184,255,0.15)" : "transparent", color: active ? "#00d4ff" : "#94a3b8", fontWeight: 700, cursor: "pointer", fontSize: 12, letterSpacing: 1.5, transition: "all .15s" }}>
      {children}
    </button>
  );
}

const inputStyle: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 6, border: "1px solid #1a3050", background: "#0a1628", color: "#fff", fontSize: 14, outline: "none", boxSizing: "border-box" };

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  // produce YYYY-MM-DDTHH:MM in LOCAL time
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
