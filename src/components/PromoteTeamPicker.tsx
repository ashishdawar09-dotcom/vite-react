import { useMemo, useState } from "react";
import type { Player, Team } from "../types";

type TeamView = Team & { p1: Player; p2: Player | null };

export type PromotePickerStatus = "eligible" | "in-bracket" | "eliminated" | "not-qualified";

export type PromoteTeamPickerProps = {
  /** Title shown at the top of the modal. */
  title?: string;
  /** Subtitle / context line under the title. */
  subtitle?: string;
  /** All teams in the relevant category (the picker filters from this set). */
  candidates: TeamView[];
  /** Team IDs currently placed somewhere in the knockout bracket. */
  bracketTeamIds: Set<string>;
  /** Team IDs that have been eliminated (lost a knockout match). */
  eliminatedTeamIds: Set<string>;
  /** Team IDs that came through groups and qualified for knockout. */
  qualifiedTeamIds: Set<string>;
  /** Already-placed team in this slot (if swapping rather than filling). */
  currentTeamId?: string | null;
  /**
   * Called when admin confirms a team. Receives the chosen team's id.
   * The caller is responsible for the actual DB write (db.updateMatch etc).
   */
  onSelect: (teamId: string) => Promise<void> | void;
  onClose: () => void;
};

/**
 * Modal team-picker. Used for:
 *   1. Filling a TBD slot in the knockout bracket
 *   2. Swapping an existing team in a bracket slot
 *
 * Surfaces eligibility status so admins see at a glance which teams are safe
 * to place vs. which require an override (already in bracket, eliminated, or
 * not yet qualified from groups).
 */
export function PromoteTeamPicker({
  title = "Select Team",
  subtitle,
  candidates,
  bracketTeamIds,
  eliminatedTeamIds,
  qualifiedTeamIds,
  currentTeamId,
  onSelect,
  onClose,
}: PromoteTeamPickerProps) {
  const [filter, setFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return candidates
      .filter(t => {
        if (!q) return true;
        const hay = [t.p1?.name, t.p2?.name, t.name].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
      .map(t => {
        let status: PromotePickerStatus = "eligible";
        if (eliminatedTeamIds.has(t.id)) status = "eliminated";
        else if (bracketTeamIds.has(t.id) && t.id !== currentTeamId) status = "in-bracket";
        else if (qualifiedTeamIds.size > 0 && !qualifiedTeamIds.has(t.id)) status = "not-qualified";
        return { team: t, status };
      })
      .sort((a, b) => {
        // Eligible first, then warnings, then errors.
        const order: Record<PromotePickerStatus, number> = {
          "eligible": 0, "not-qualified": 1, "in-bracket": 2, "eliminated": 3,
        };
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return (a.team.p1?.name ?? "").localeCompare(b.team.p1?.name ?? "");
      });
  }, [candidates, filter, bracketTeamIds, eliminatedTeamIds, qualifiedTeamIds, currentTeamId]);

  const handlePick = async (teamId: string, status: PromotePickerStatus) => {
    if (status === "in-bracket") {
      if (!confirm("This team is already placed in the bracket. Move them here anyway? (Their other slot will become empty.)")) return;
    } else if (status === "eliminated") {
      if (!confirm("This team has been eliminated. Place them anyway?")) return;
    } else if (status === "not-qualified") {
      if (!confirm("This team didn't qualify from the group stage. Place them anyway?")) return;
    }
    setBusyId(teamId);
    try {
      await onSelect(teamId);
      onClose();
    } finally {
      setBusyId(null);
    }
  };

  const tName = (t: TeamView) => t.p1
    ? (t.p2 ? `${t.p1.name} & ${t.p2.name}` : t.p1.name)
    : (t.name ?? "(team)");

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16, backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#0f1e36", borderRadius: 14, padding: 24, maxWidth: 560, width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.5)", border: "1px solid #1a3050", color: "#fff" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{ width: 4, height: 22, background: "#a855f7", borderRadius: 1 }} />
          <h3 className="font-display" style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>{title}</h3>
        </div>
        {subtitle && <p style={{ margin: "0 0 14px 14px", fontSize: 12, color: "#94a3b8" }}>{subtitle}</p>}

        <input
          type="search"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter teams…"
          autoFocus
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #1a3050", background: "#0a1628", color: "#fff", fontSize: 13, outline: "none", marginBottom: 12, boxSizing: "border-box" }}
        />

        <div style={{ flex: 1, overflowY: "auto", borderRadius: 8, border: "1px solid #1a3050", background: "#0a1628" }}>
          {rows.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#64748b", fontSize: 13 }}>No teams match.</div>
          ) : rows.map(({ team: t, status }) => {
            const meta = STATUS_META[status];
            const isBusy = busyId === t.id;
            const disabled = isBusy;
            return (
              <button
                key={t.id}
                onClick={() => handlePick(t.id, status)}
                disabled={disabled}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", border: "none", borderBottom: "1px solid #11243f", background: "transparent", color: "#fff", textAlign: "left", cursor: disabled ? "wait" : "pointer", opacity: status === "eliminated" || status === "in-bracket" ? 0.6 : 1, transition: "background .12s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "#11243f"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tName(t)}</div>
                </div>
                <span className="font-display" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, padding: "3px 8px", border: `1px solid ${meta.color}55`, background: `${meta.color}10`, color: meta.color, borderRadius: 4, textTransform: "uppercase", whiteSpace: "nowrap" }}>
                  {meta.icon} {meta.label}
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={onClose}
          className="font-display"
          style={{ marginTop: 14, padding: "10px 14px", borderRadius: 8, border: "1px solid #1a3050", background: "transparent", color: "#94a3b8", fontWeight: 700, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const STATUS_META: Record<PromotePickerStatus, { icon: string; label: string; color: string }> = {
  "eligible":      { icon: "✓", label: "Eligible",      color: "#22c55e" },
  "not-qualified": { icon: "💤", label: "Not qualified", color: "#fbbf24" },
  "in-bracket":    { icon: "🏆", label: "In bracket",    color: "#3b82f6" },
  "eliminated":    { icon: "✗", label: "Eliminated",    color: "#ef4444" },
};
