import { useEffect, useState } from "react";
import * as db from "../lib/db";
import { toast } from "./Toast";
import type { Match } from "../types";

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  if (diffSec < 30) return "just now";
  if (diffMin < 1) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago · ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const FIELD_LABELS: Record<string, string> = {
  score_a: "Score (A)",
  score_b: "Score (B)",
  status: "Status",
  court_number: "Court",
  winner_id: "Winner",
  confirmed: "Confirmed",
  is_walkover: "Walkover",
  started_at: "Started at",
  confirmed_at: "Confirmed at",
  extended_minutes: "Extended (min)",
  queue_position: "Queue position",
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function formatValue(field: string, value: unknown, match: Match, teamAName: string, teamBName: string): string {
  if (value === null || value === undefined) return "—";
  if (field === "winner_id") {
    if (value === match.team_a_id) return teamAName;
    if (value === match.team_b_id) return teamBName;
    return String(value).slice(0, 8) + "…";
  }
  if (field === "started_at" || field === "confirmed_at") {
    try {
      return new Date(String(value)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return String(value);
    }
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function actionSummary(entry: db.MatchAuditEntry): string {
  if (entry.action === "insert") return "Match created";
  if (entry.action === "delete") return "Match deleted";
  const fields = entry.changed_fields ?? [];
  if (fields.length === 0) return "Updated";
  if (fields.length === 1) return `Changed ${fieldLabel(fields[0]).toLowerCase()}`;
  return `Changed ${fields.length} fields`;
}

function actionColor(action: db.MatchAuditEntry["action"]): string {
  if (action === "insert") return "#22c55e";
  if (action === "delete") return "#ef4444";
  return "#00d4ff";
}

export function MatchHistoryModal({
  match,
  teamAName,
  teamBName,
  onClose,
}: {
  match: Match;
  teamAName: string;
  teamBName: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<db.MatchAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await db.listMatchAudit(match.id);
        if (!cancelled) setEntries(data);
      } catch (e: any) {
        if (!cancelled) toast(e?.message ?? "Failed to load history", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [match.id]);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16, backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#0f1e36", borderRadius: 14, padding: 28, maxWidth: 600, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.5)", border: "1px solid #1a3050", color: "#fff" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{ width: 4, height: 22, background: "#a855f7", borderRadius: 1 }} />
          <h3 className="font-display" style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>
            Match History
          </h3>
        </div>
        <p style={{ margin: "0 0 18px 14px", fontSize: 12, color: "#94a3b8" }}>
          {teamAName} <span style={{ color: "#475569" }}>vs</span> {teamBName}
        </p>

        <div style={{ flex: 1, overflowY: "auto", borderRadius: 8, border: "1px solid #1a3050", minHeight: 80 }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Loading…</div>
          ) : entries.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
              No history yet for this match.
            </div>
          ) : (
            entries.map((e, i) => {
              const fields = e.changed_fields ?? [];
              const showDiff = e.action === "update" && fields.length > 0;
              return (
                <div
                  key={e.id}
                  style={{ padding: "12px 14px", borderBottom: i < entries.length - 1 ? "1px solid #1a3050" : "none" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <span className="font-display" style={{ fontSize: 11, fontWeight: 700, color: actionColor(e.action), letterSpacing: 1.2, textTransform: "uppercase" }}>
                      {actionSummary(e)}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                      {formatTimestamp(e.changed_at)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#cbd5e1", marginBottom: showDiff ? 6 : 0 }}>
                    {e.changed_by ?? <span style={{ color: "#64748b", fontStyle: "italic" }}>System</span>}
                  </div>
                  {showDiff && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 4 }}>
                      {fields.map(f => {
                        const before = e.before_data?.[f];
                        const after = e.after_data?.[f];
                        return (
                          <div key={f} style={{ fontSize: 11, color: "#94a3b8", display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600, color: "#cbd5e1", minWidth: 90 }}>{fieldLabel(f)}:</span>
                            <span style={{ color: "#64748b" }}>{formatValue(f, before, match, teamAName, teamBName)}</span>
                            <span style={{ color: "#475569" }}>→</span>
                            <span style={{ color: "#fff", fontWeight: 600 }}>{formatValue(f, after, match, teamAName, teamBName)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
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
