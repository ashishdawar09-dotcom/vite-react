import { useState } from "react";
import type { Tournament } from "../types";
import * as db from "../lib/db";

export function TournamentPicker({
  tournaments,
  current,
  onSelect,
  isAdmin,
  onChange,
}: {
  tournaments: Tournament[];
  current: Tournament | null;
  onSelect: (id: string) => void;
  isAdmin: boolean;
  onChange: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [seed, setSeed] = useState(true);

  const create = async () => {
    if (!name.trim()) return;
    const t = await db.createTournament(name.trim(), date || null, seed);
    setCreating(false);
    setName(""); setDate(""); setSeed(true);
    onSelect(t.id);
    onChange();
  };

  const removeCurrent = async () => {
    if (!current) return;
    if (!confirm(`Delete "${current.name}" and all its data? This cannot be undone.`)) return;
    await db.deleteTournament(current.id);
    onChange();
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
      <select
        value={current?.id ?? ""}
        onChange={e => onSelect(e.target.value)}
        style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
      >
        {tournaments.length === 0 && <option value="">— No tournaments —</option>}
        {tournaments.map(t => <option key={t.id} value={t.id} style={{ color: "#000" }}>{t.name}{t.event_date ? ` (${t.event_date})` : ""}</option>)}
      </select>
      {isAdmin && (
        <>
          <button onClick={() => setCreating(true)} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(58,134,255,0.4)", background: "rgba(58,134,255,0.2)", color: "#93c5fd", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ New</button>
          {current && <button onClick={removeCurrent} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(230,57,70,0.4)", background: "rgba(230,57,70,0.2)", color: "#fca5a5", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Delete</button>}
        </>
      )}
      {creating && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16, backdropFilter: "blur(4px)" }} onClick={() => setCreating(false)}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 28, maxWidth: 420, width: "100%", color: "#1a1a2e" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 800 }}>🏸 New Tournament</h3>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Summer Cup 2026" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "2px solid #e2e8f0", fontSize: 14, marginTop: 4, marginBottom: 12, boxSizing: "border-box", outline: "none" }} />
            <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Event date (optional)</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "2px solid #e2e8f0", fontSize: 14, marginTop: 4, marginBottom: 12, boxSizing: "border-box", outline: "none" }} />
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, marginBottom: 16, cursor: "pointer" }}>
              <input type="checkbox" checked={seed} onChange={e => setSeed(e.target.checked)} />
              Seed with the default 14 players
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setCreating(false)} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", background: "#e2e8f0", color: "#475569", fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={create} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", background: "#16a34a", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
