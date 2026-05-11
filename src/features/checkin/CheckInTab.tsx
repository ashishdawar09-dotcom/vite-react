import { useState } from "react";
import * as db from "../../lib/db";
import { CategoryFilter } from "../../components/CategoryFilter";
import { Av } from "../../components/ui";
import { toast } from "../../components/Toast";
import type { Category, Player, Tournament } from "../../types";

/**
 * Tournament-day player check-in screen.
 *
 * Filter, search, and bulk-toggle player presence. Visible to all users
 * (read-only for non-admin); admin can toggle individual players and run
 * bulk actions.
 */
export function CheckInTab({
  tournament,
  players,
  categories,
  currentCategoryId,
  setCurrentCategoryId,
  playerCategoryMap,
  isAdmin,
}: {
  tournament: Tournament;
  players: Player[];
  categories: Category[];
  currentCategoryId: string | null;
  setCurrentCategoryId: (id: string | null) => void;
  playerCategoryMap: Map<string, Set<string>>;
  isAdmin: boolean;
}) {
  // Tab-local filter and search state — not used outside this view, so we
  // keep it here rather than promoting to App.tsx.
  const [filter, setFilter] = useState<"all" | "checked" | "missing">("all");
  const [search, setSearch] = useState("");

  const inCategory = (p: Player) =>
    !currentCategoryId || (playerCategoryMap.get(p.id)?.has(currentCategoryId) ?? false);
  const matchesSearch = (p: Player) =>
    !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase());
  const matchesStatus = (p: Player) => {
    if (filter === "all") return true;
    const checkedIn = !!p.checked_in_at;
    return filter === "checked" ? checkedIn : !checkedIn;
  };
  const visible = players.filter(p => inCategory(p) && matchesSearch(p) && matchesStatus(p));
  const allInScope = players.filter(p => inCategory(p));
  const checkedCount = allInScope.filter(p => p.checked_in_at).length;
  const missingCount = allInScope.length - checkedCount;
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const requireAdmin = () => {
    if (!isAdmin) {
      toast("Sign in as admin to make changes", "warn");
      return false;
    }
    return true;
  };

  const toggle = async (p: Player) => {
    if (!requireAdmin()) return;
    try {
      await db.setPlayerCheckin(p.id, !p.checked_in_at);
    } catch (e: any) {
      toast(e?.message ?? "Failed to toggle check-in", "error");
    }
  };

  const checkInAllVisible = async () => {
    if (!requireAdmin()) return;
    const toCheck = visible.filter(p => !p.checked_in_at).map(p => p.id);
    if (toCheck.length === 0) {
      toast("All visible players are already checked in", "info");
      return;
    }
    if (!confirm(`Check in ${toCheck.length} player${toCheck.length === 1 ? "" : "s"}?`)) return;
    try {
      await db.bulkSetCheckin(toCheck, true);
      toast(`Checked in ${toCheck.length} player${toCheck.length === 1 ? "" : "s"}`, "success");
    } catch (e: any) {
      toast(e?.message ?? "Bulk check-in failed", "error");
    }
  };

  const resetAllCheckins = async () => {
    if (!requireAdmin()) return;
    if (!confirm("Reset check-ins for ALL players in this tournament? This clears tournament-day status for everyone.")) return;
    try {
      await db.resetCheckins(tournament.id);
      toast("All check-ins cleared", "success");
    } catch (e: any) {
      toast(e?.message ?? "Reset failed", "error");
    }
  };

  const pill = (label: string, value: typeof filter, color: string) => (
    <button
      key={value}
      onClick={() => setFilter(value)}
      className="font-display"
      style={{
        padding: "8px 16px",
        borderRadius: 20,
        border: filter === value ? `2px solid ${color}` : "1px solid #e2e8f0",
        background: filter === value ? `${color}1A` : "#fff",
        color: filter === value ? color : "#64748b",
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: 0.8,
        cursor: "pointer",
        textTransform: "uppercase",
        transition: "all .15s",
      }}
    >
      {label}
    </button>
  );

  return (
    <div>
      <CategoryFilter categories={categories} currentCategoryId={currentCategoryId} onSelect={setCurrentCategoryId} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <span style={{ fontSize: 28 }}>✅</span>
        <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Player Check-In</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginLeft: "auto", fontSize: 13, color: "#64748b", flexWrap: "wrap" }}>
          <span><strong style={{ color: "#16a34a", fontSize: 18 }}>{checkedCount}</strong> checked in</span>
          <span style={{ color: "#cbd5e1" }}>/</span>
          <span><strong style={{ color: "#1a1a2e", fontSize: 18 }}>{allInScope.length}</strong> total</span>
          {missingCount > 0 && <span style={{ color: "#cbd5e1" }}>·</span>}
          {missingCount > 0 && <span><strong style={{ color: "#dc2626", fontSize: 18 }}>{missingCount}</strong> missing</span>}
        </div>
      </div>

      {/* Toolbar: filter pills + search + admin bulk actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {pill("All", "all", "#3A86FF")}
        {pill(`Checked In · ${checkedCount}`, "checked", "#16a34a")}
        {pill(`Missing · ${missingCount}`, "missing", "#dc2626")}
        <div style={{ position: "relative", flex: "1 1 200px", maxWidth: 320, marginLeft: 4 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "#94a3b8", pointerEvents: "none" }}>🔍</span>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search players…"
            style={{ width: "100%", padding: "8px 12px 8px 34px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, outline: "none", boxSizing: "border-box" }}
          />
        </div>
        {isAdmin && (
          <>
            <button onClick={checkInAllVisible} className="font-display" style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontSize: 12, fontWeight: 700, letterSpacing: 0.8, cursor: "pointer", textTransform: "uppercase" }}>✓ Check In Visible</button>
            <button onClick={resetAllCheckins} className="font-display" style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #dc2626", background: "transparent", color: "#dc2626", fontSize: 12, fontWeight: 700, letterSpacing: 0.8, cursor: "pointer", textTransform: "uppercase" }}>Reset All</button>
          </>
        )}
      </div>

      {/* Grid */}
      {visible.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, background: "#f8fafc", borderRadius: 12, border: "1px solid #e2e8f0", color: "#64748b" }}>
          {players.length === 0 ? "No players in this tournament yet." : "No players match the current filter."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {visible.map(p => {
            const checkedIn = !!p.checked_in_at;
            return (
              <button
                key={p.id}
                onClick={() => isAdmin && toggle(p)}
                disabled={!isAdmin}
                title={!isAdmin ? "View only — sign in as admin to toggle" : checkedIn ? "Click to undo check-in" : "Click to check in"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: checkedIn ? "2px solid #16a34a" : "2px solid #fecaca",
                  background: checkedIn ? "rgba(34,197,94,0.06)" : "#fff",
                  cursor: isAdmin ? "pointer" : "default",
                  textAlign: "left",
                  transition: "all .15s",
                  opacity: p.active ? 1 : 0.55,
                  boxShadow: checkedIn ? "0 2px 8px rgba(34,197,94,0.15)" : "0 2px 6px rgba(220,38,38,0.08)",
                }}
              >
                <Av name={p.name} photo={p.photo_url} sz={42} color={p.color} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                  {checkedIn ? (
                    <div style={{ fontSize: 11, color: "#16a34a", fontWeight: 600, marginTop: 2 }}>✓ Checked in · {fmtTime(p.checked_in_at!)}</div>
                  ) : (
                    <div style={{ fontSize: 11, color: "#dc2626", fontWeight: 600, marginTop: 2 }}>⚠ Not checked in</div>
                  )}
                </div>
                <span style={{ fontSize: 22, color: checkedIn ? "#16a34a" : "#fecaca" }}>{checkedIn ? "✅" : "⭕"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
