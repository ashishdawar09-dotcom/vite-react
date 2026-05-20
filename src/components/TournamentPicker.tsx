import { useEffect, useState } from "react";
import type { Tournament } from "../types";
import * as db from "../lib/db";
import { toast } from "./Toast";

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
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [seed, setSeed] = useState(true);
  const [numCourts, setNumCourts] = useState(4);
  const [busy, setBusy] = useState(false);

  // When opening the edit modal, pre-fill from the current tournament.
  useEffect(() => {
    if (editing && current) {
      setName(current.name);
      setDate(current.event_date ?? "");
      setNumCourts(current.num_courts || 4);
    }
  }, [editing, current]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const t = await db.createTournament(name.trim(), date || null, seed);
      setCreating(false);
      setName(""); setDate(""); setSeed(true);
      onSelect(t.id);
      onChange();
    } catch (e: any) {
      toast(e?.message ?? "Failed to create tournament", "error");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!current || !name.trim()) return;
    setBusy(true);
    try {
      await db.updateTournament(current.id, {
        name: name.trim(),
        event_date: date || null,
        num_courts: numCourts,
      });
      setEditing(false);
      onChange();
      toast("Tournament updated", "success");
    } catch (e: any) {
      toast(e?.message ?? "Failed to update tournament", "error");
    } finally {
      setBusy(false);
    }
  };

  const removeCurrent = async () => {
    if (!current) return;
    if (!confirm(`Delete "${current.name}" and all its data? This cannot be undone.`)) return;
    await db.deleteTournament(current.id);
    onChange();
  };

  const copyRegistrationLink = async () => {
    if (!current) return;
    const url = `${window.location.origin}/register/${current.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(`Link copied — share via WhatsApp/text: ${url}`, "success");
    } catch {
      // Clipboard API may fail in non-secure contexts. Fall back to a prompt.
      window.prompt("Copy this registration link:", url);
    }
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
          {current && <button onClick={() => setEditing(true)} title="Edit tournament name, date, or court count" style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(168,85,247,0.4)", background: "rgba(168,85,247,0.2)", color: "#c4b5fd", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✏️ Edit</button>}
          {current && <button onClick={copyRegistrationLink} title="Copy public registration link — share via WhatsApp/text" style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(0,212,255,0.5)", background: "rgba(0,212,255,0.2)", color: "#7dd3fc", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>📋 Copy Registration Link</button>}
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
              <button onClick={() => setCreating(false)} disabled={busy} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", background: "#e2e8f0", color: "#475569", fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={create} disabled={busy || !name.trim()} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", background: "#16a34a", color: "#fff", fontWeight: 700, cursor: busy ? "wait" : "pointer", opacity: busy || !name.trim() ? 0.6 : 1 }}>{busy ? "Creating…" : "Create"}</button>
            </div>
          </div>
        </div>
      )}
      {editing && current && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16, backdropFilter: "blur(4px)" }} onClick={() => setEditing(false)}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 28, maxWidth: 420, width: "100%", color: "#1a1a2e" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 800 }}>✏️ Edit Tournament</h3>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Tournament name" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "2px solid #e2e8f0", fontSize: 14, marginTop: 4, marginBottom: 12, boxSizing: "border-box", outline: "none" }} autoFocus />
            <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Event date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "2px solid #e2e8f0", fontSize: 14, marginTop: 4, marginBottom: 12, boxSizing: "border-box", outline: "none" }} />
            <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Number of courts</label>
            <input type="number" min={1} max={20} value={numCourts} onChange={e => setNumCourts(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "2px solid #e2e8f0", fontSize: 14, marginTop: 4, marginBottom: 16, boxSizing: "border-box", outline: "none" }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setEditing(false)} disabled={busy} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", background: "#e2e8f0", color: "#475569", fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={saveEdit} disabled={busy || !name.trim()} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", background: "#a855f7", color: "#fff", fontWeight: 700, cursor: busy ? "wait" : "pointer", opacity: busy || !name.trim() ? 0.6 : 1 }}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
