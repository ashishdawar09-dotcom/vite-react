import { useEffect, useState } from "react";
import * as db from "../lib/db";
import { toast } from "./Toast";

export function AdminManager({ currentEmail, onClose }: { currentEmail: string | null; onClose: () => void }) {
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
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16, backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#0f1e36", borderRadius: 14, padding: 28, maxWidth: 500, width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.5)", border: "1px solid #1a3050", color: "#fff" }}
        onClick={(e) => e.stopPropagation()}
      >
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

        <button
          onClick={onClose}
          className="font-display"
          style={{ width: "100%", marginTop: 18, padding: "10px 14px", borderRadius: 8, border: "1px solid #1a3050", background: "transparent", color: "#94a3b8", fontWeight: 700, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
