import { useState } from "react";
import type { Match } from "../types";
import { resultConfirmText, resultOptions, type ResultOption } from "../lib/resultOptions";

// "⋯ No-show / Injury" (Ashish, Nov 15 2026): Walkover before play, and
// Walkover / Retired (injury) / Select Winner at any time during play, not
// only at time over. Shared by the match cards (light) and the Live tab
// (dark). Every choice asks first (lib/resultOptions.ts resultConfirmText).

const LABEL: Record<ResultOption, string> = { walkover: "Walkover", retired: "Retired (injury)", winner: "Select Winner" };
const PROMPT: Record<ResultOption, string> = {
  walkover: "Who showed up? They win:",
  retired: "Who is retiring? The other side wins:",
  winner: "Who wins?",
};

export function ResultOptions({
  match: m, nameOf, shown, tone, onPick, startOpen = false,
}: {
  match: Match;
  nameOf: (teamId: string | null) => string;
  /** The scores on screen (may be ahead of `match` while a save is in flight). */
  shown: () => { a: number | null; b: number | null };
  tone: "light" | "dark";
  /** Called after the director confirms. `teamId` = winner (walkover, winner) or the side retiring. */
  onPick: (kind: ResultOption, teamId: string) => Promise<void>;
  /** Time over: show the options without the extra tap. */
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [kind, setKind] = useState<ResultOption | null>(null);
  const [busy, setBusy] = useState(false);
  // Close when the match moves on (started, confirmed, rescheduled), here or on another device.
  const state = `${m.status}|${m.confirmed}|${m.court_allocated_at ?? ""}`;
  const [seen, setSeen] = useState(state);
  if (seen !== state) { setSeen(state); setKind(null); setOpen(startOpen); }

  const options = resultOptions(m);
  if (!options.length || !m.team_a_id || !m.team_b_id) return null;
  const dark = tone === "dark";
  const small = { padding: dark ? "6px 12px" : "10px 12px", borderRadius: dark ? 5 : 10, fontSize: dark ? 10 : 12, fontWeight: 700, cursor: "pointer", letterSpacing: 0.5 } as const;
  const ghost = { ...small, border: `1px solid ${dark ? "#475569" : "#cbd5e1"}`, background: "transparent", color: dark ? "#94a3b8" : "#475569" };
  const choice = (k: ResultOption) => ({
    ...small, border: "1px solid " + (k === "retired" ? "#f43f5e" : k === "walkover" ? "#f59e0b" : "#22c55e"),
    background: k === "retired" ? "rgba(244,63,94,0.12)" : k === "walkover" ? "rgba(245,158,11,0.15)" : "rgba(34,197,94,0.15)",
    color: dark ? (k === "retired" ? "#fda4af" : k === "walkover" ? "#fbbf24" : "#4ade80") : (k === "retired" ? "#be123c" : k === "walkover" ? "#b45309" : "#15803d"),
  });

  const pick = async (teamId: string) => {
    if (!kind || busy) return;
    if (!resultOptions(m).includes(kind)) { setKind(null); return; }
    if (!window.confirm(resultConfirmText(kind, m, teamId, shown(), nameOf))) return;
    setBusy(true);
    try { await onPick(kind, teamId); setKind(null); setOpen(startOpen); } finally { setBusy(false); }
  };

  return (
    <div data-testid="result-options" style={{ display: "flex", gap: 6, flexWrap: "wrap", width: "100%", alignItems: "center", padding: open ? "8px 0 0" : 0 }}>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} style={ghost} aria-expanded={false}>⋯ No-show / Injury</button>
      )}
      {open && !kind && (
        <>
          {options.map(k => (
            <button type="button" key={k} onClick={() => setKind(k)} style={choice(k)}>{LABEL[k]}</button>
          ))}
          {!startOpen && <button type="button" onClick={() => setOpen(false)} style={ghost} aria-label="Close">✕</button>}
        </>
      )}
      {open && kind && (
        <>
          <span style={{ fontSize: dark ? 10 : 12, color: dark ? "#94a3b8" : "#64748b", fontWeight: 600, width: "100%" }}>{LABEL[kind]}: {PROMPT[kind]}</span>
          {[m.team_a_id, m.team_b_id].map(id => (
            <button type="button" key={id} disabled={busy} onClick={() => void pick(id!)} style={{ ...choice(kind), flex: 1, minWidth: 120 }}>{nameOf(id)}</button>
          ))}
          <button type="button" onClick={() => setKind(null)} style={ghost}>Back</button>
        </>
      )}
    </div>
  );
}
