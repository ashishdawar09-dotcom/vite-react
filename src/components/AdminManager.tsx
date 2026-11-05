import { useEffect, useRef, useState } from "react";
import * as db from "../lib/db";
import { toast } from "./Toast";
import { Modal } from "./ui/Modal";
import type { Category, Match, Player, Team, Tournament } from "../types";

// The Admin panel (header "⚙️ ADMIN"): who the admins are, and, tucked away
// under "Delete", the only place a category or the whole tournament can be
// deleted. Both used to sit one tap and an OK away on the main screens
// (TournamentPicker, the category editor), next to buttons used all day.
export function AdminManager({
  currentEmail,
  onClose,
  tournament,
  categories,
  players,
  teams,
  matches,
  onTournamentDeleted,
}: {
  currentEmail: string | null;
  onClose: () => void;
  tournament: Tournament | null;
  categories: Category[];
  players: Player[];
  teams: Team[];
  matches: Match[];
  onTournamentDeleted: () => void | Promise<void>;
}) {
  const [admins, setAdmins] = useState<db.TournamentAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newEmail, setNewEmail] = useState("");

  const reload = async () => {
    setLoading(true);
    try {
      const list = await db.listTournamentAdmins();
      setAdmins(list);
    } catch (e: any) {
      toast(e?.message ?? "Failed to load admins", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const handleAdd = async () => {
    const clean = newEmail.trim().toLowerCase();
    if (!clean) return;
    setAdding(true);
    try {
      await db.addTournamentAdmin(clean);
      toast(`Added ${clean} as admin`, "success");
      setNewEmail("");
      await reload();
    } catch (e: any) {
      toast(e?.message ?? "Failed to add admin", "error");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (a: db.TournamentAdmin) => {
    if (!confirm(`Remove ${a.email} from admins? They will lose admin powers immediately.`)) return;
    try {
      await db.removeTournamentAdmin(a.email);
      toast(`Removed ${a.email}`, "success");
      await reload();
    } catch (e: any) {
      toast(e?.message ?? "Failed to remove admin", "error");
    }
  };

  return (
    <Modal open onClose={onClose} size="md" surface="dark" zIndex={2000} ariaLabel="Admin">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{ width: 4, height: 22, background: "#00d4ff", borderRadius: 1 }} />
          <h3 className="font-display" style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>
            Manage Admins
          </h3>
        </div>
        <p style={{ margin: "0 0 20px 14px", fontSize: 12, color: "#94a3b8" }}>
          Admins can score matches, configure categories, and manage other admins.
        </p>

        {/* Add form */}
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            placeholder="new-admin@example.com"
            autoComplete="off"
            disabled={adding}
            style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid #1a3050", background: "#0a1628", color: "#fff", fontSize: 13, outline: "none" }}
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newEmail.trim()}
            className="font-display"
            style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: adding ? "#1a3050" : "#22c55e", color: "#fff", fontWeight: 800, fontSize: 12, letterSpacing: 1, cursor: adding ? "wait" : "pointer", textTransform: "uppercase" }}
          >
            {adding ? "Adding…" : "+ Add"}
          </button>
        </div>

        {/* List */}
        <div style={{ borderRadius: 8, border: "1px solid #1a3050", maxHeight: 360, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Loading…</div>
          ) : admins.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No admins. Add one above.</div>
          ) : (
            admins.map((a) => {
              const isSelf = currentEmail && a.email.toLowerCase() === currentEmail.toLowerCase();
              return (
                <div
                  key={a.id}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid #1a3050" }}
                >
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.email}
                      {isSelf && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: "#00d4ff", letterSpacing: 1 }}>(YOU)</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                      Added {new Date(a.added_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(a)}
                    disabled={!!isSelf}
                    title={isSelf ? "You can't remove yourself" : "Remove admin"}
                    style={{
                      padding: "6px 12px", borderRadius: 6, border: "1px solid #ef4444",
                      background: "transparent", color: isSelf ? "#475569" : "#ef4444",
                      borderColor: isSelf ? "#1a3050" : "#ef4444",
                      fontWeight: 700, fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
                      cursor: isSelf ? "not-allowed" : "pointer",
                      opacity: isSelf ? 0.5 : 1,
                    }}
                  >
                    Remove
                  </button>
                </div>
              );
            })
          )}
        </div>

      {tournament && (
        <DeleteSection
          tournament={tournament}
          categories={categories}
          players={players}
          teams={teams}
          matches={matches}
          onTournamentDeleted={async () => { await onTournamentDeleted(); onClose(); }}
        />
      )}

      <button
        onClick={onClose}
        className="font-display"
        style={{ width: "100%", marginTop: 18, padding: "10px 14px", borderRadius: 8, border: "1px solid #1a3050", background: "transparent", color: "#94a3b8", fontWeight: 700, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", minHeight: 44 }}
      >
        Close
      </button>
    </Modal>
  );
}

type Target = { kind: "category"; category: Category } | { kind: "tournament"; tournament: Tournament };

// Delete a category or the whole tournament. Hidden until "Show" is tapped;
// says what will be erased (the database cascades: a category takes its
// teams, matches and registrations with their payment details; the
// tournament takes everything, players and waivers included); and the exact
// name has to be typed before the button works. No bulk or reset controls.
function DeleteSection({ tournament, categories, players, teams, matches, onTournamentDeleted }: {
  tournament: Tournament;
  categories: Category[];
  players: Player[];
  teams: Team[];
  matches: Match[];
  onTournamentDeleted: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [targetKey, setTargetKey] = useState("");
  const [typed, setTyped] = useState("");
  const [regs, setRegs] = useState<{ total: number; approved: number } | null>(null);
  const [regsError, setRegsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  const target: Target | null = targetKey === "tournament"
    ? { kind: "tournament", tournament }
    : (() => { const c = categories.find(x => `category:${x.id}` === targetKey); return c ? { kind: "category", category: c } : null; })();
  const name = target ? (target.kind === "tournament" ? target.tournament.name : target.category.name) : "";
  const nameMatches = !!target && typed.trim() === name.trim();

  const pick = (key: string) => {
    setTargetKey(key);
    setTyped("");
    setRegs(null);
    setRegsError(false);
    if (!key) return;
    const id = ++request.current;
    const categoryId = key.startsWith("category:") ? key.slice("category:".length) : undefined;
    db.countRegistrations(tournament.id, categoryId)
      .then(r => { if (request.current === id) setRegs(r); })
      .catch(() => { if (request.current === id) setRegsError(true); });
  };

  const inScope = <T extends { category_id: string }>(rows: T[]) =>
    target?.kind === "category" ? rows.filter(r => r.category_id === target.category.id) : rows;
  const teamCount = inScope(teams).length;
  const scopedMatches = inScope(matches).filter(m => !m.is_bye);
  const played = scopedMatches.filter(m => m.confirmed).length;

  const erase: string[] = [];
  if (target?.kind === "tournament") {
    erase.push(`${categories.length} categor${categories.length === 1 ? "y" : "ies"} and ${players.length} player${players.length === 1 ? "" : "s"}`);
  }
  erase.push(`${teamCount} team${teamCount === 1 ? "" : "s"}`);
  erase.push(`${scopedMatches.length} match${scopedMatches.length === 1 ? "" : "es"}${played ? ` (${played} with results)` : ""}`);
  erase.push(regsError ? "its registrations and their payment details (couldn't count them)"
    : regs ? `${regs.total} registration${regs.total === 1 ? "" : "s"} with their payment details${regs.approved ? ` (${regs.approved} approved)` : ""}`
    : "registrations and their payment details (counting…)");
  if (target?.kind === "tournament") erase.push("every waiver, check-in and registration link");

  const doDelete = async () => {
    if (!target || !nameMatches || busy) return;
    setBusy(true);
    try {
      if (target.kind === "category") {
        await db.deleteCategory(target.category.id);
        toast(`Deleted "${target.category.name}".`, "success");
        pick("");
      } else {
        await db.deleteTournament(target.tournament.id);
        toast(`Deleted "${target.tournament.name}".`, "success");
        await onTournamentDeleted();
      }
    } catch (e: unknown) {
      toast(`Not deleted: ${e instanceof Error ? e.message : (e as { message?: string })?.message ?? "error"}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const label = { fontSize: 11, color: "#94a3b8", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" as const, display: "block", margin: "14px 0 6px" };
  const field = { width: "100%", boxSizing: "border-box" as const, padding: "10px 12px", borderRadius: 8, border: "1px solid #1a3050", background: "#0a1628", color: "#fff", fontSize: 13, outline: "none" };

  return (
    <div style={{ marginTop: 22, borderRadius: 10, border: "1px solid rgba(239,68,68,0.35)", padding: "14px 16px", background: "rgba(239,68,68,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="font-display" style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "#f87171" }}>Delete</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>A category or the whole tournament. Can't be undone.</div>
        </div>
        <button
          onClick={() => { setOpen(o => !o); pick(""); }}
          aria-expanded={open}
          style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #1a3050", background: "transparent", color: "#cbd5e1", fontWeight: 700, fontSize: 12, letterSpacing: 1, cursor: "pointer", minHeight: 40 }}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open && (
        <div>
          <label style={label} htmlFor="admin-delete-target">What to delete</label>
          <select id="admin-delete-target" value={targetKey} onChange={e => pick(e.target.value)} style={{ ...field, cursor: "pointer" }}>
            <option value="">Choose…</option>
            {categories.length > 0 && (
              <optgroup label="A category">
                {categories.map(c => <option key={c.id} value={`category:${c.id}`}>{c.name}</option>)}
              </optgroup>
            )}
            <optgroup label="Everything">
              <option value="tournament">The whole tournament: {tournament.name}</option>
            </optgroup>
          </select>

          {target && (
            <>
              <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", fontSize: 12, color: "#fecaca", lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>This erases for good:</div>
                {erase.map(line => <div key={line}>• {line}</div>)}
                {target.kind === "category" && <div style={{ marginTop: 4, color: "#94a3b8" }}>The players stay; they just lose this event.</div>}
              </div>
              <label style={label} htmlFor="admin-delete-confirm">Type <span style={{ color: "#fff", textTransform: "none", letterSpacing: 0 }}>{name}</span> to confirm</label>
              <input
                id="admin-delete-confirm"
                value={typed}
                onChange={e => setTyped(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void doDelete(); }}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={busy}
                style={field}
              />
              <button
                onClick={() => void doDelete()}
                disabled={!nameMatches || busy}
                className="font-display"
                style={{ width: "100%", marginTop: 12, padding: "11px 14px", borderRadius: 8, border: "none", background: nameMatches ? "#dc2626" : "#3b1d24", color: nameMatches ? "#fff" : "#94a3b8", fontWeight: 800, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", cursor: nameMatches && !busy ? "pointer" : "not-allowed", minHeight: 44 }}
              >
                {busy ? "Deleting…" : target.kind === "tournament" ? "Delete the whole tournament" : "Delete this category"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
