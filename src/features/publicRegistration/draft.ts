// The registration form's progress, kept on this device so a refresh, a
// cancelled card payment or coming back later (e.g. from the reminder email)
// picks up where the player left off. Waiver acceptance and the signature are
// never stored: they're given fresh each time.

import { emptyFlow, type FlowState, type StepKey } from "./multiEntry";

const PREFIX = "ss-registration-draft:";
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

type Stored = { v: 1; saved_at: number; step: StepKey; state: Partial<FlowState> };

const NOT_STORED: (keyof FlowState)[] = ["signature", "accepted_rules", "accepted_waiver", "accepted_codes"];

export function loadDraft(tournamentId: string): { step: StepKey; state: FlowState } | null {
  try {
    const raw = localStorage.getItem(PREFIX + tournamentId);
    if (!raw) return null;
    const d = JSON.parse(raw) as Stored;
    if (d.v !== 1 || Date.now() - d.saved_at > TTL_MS) {
      localStorage.removeItem(PREFIX + tournamentId);
      return null;
    }
    const base = emptyFlow();
    const state: FlowState = { ...base };
    // Only known fields of the right type come back.
    for (const k of Object.keys(base) as (keyof FlowState)[]) {
      if (NOT_STORED.includes(k)) continue;
      const v = d.state[k];
      if (v !== undefined && typeof v === typeof base[k] && (Array.isArray(base[k]) === Array.isArray(v))) {
        (state as Record<string, unknown>)[k] = v;
      }
    }
    state.category_ids = state.category_ids.filter((id) => typeof id === "string");
    return { step: d.step, state };
  } catch {
    return null;
  }
}

export function saveDraft(tournamentId: string, step: StepKey, state: FlowState): void {
  try {
    const kept: Partial<FlowState> = { ...state };
    for (const k of NOT_STORED) delete kept[k];
    const d: Stored = { v: 1, saved_at: Date.now(), step, state: kept };
    localStorage.setItem(PREFIX + tournamentId, JSON.stringify(d));
  } catch { /* storage off or full: the form still works */ }
}

export function clearDraft(tournamentId: string): void {
  try { localStorage.removeItem(PREFIX + tournamentId); } catch { /* storage off */ }
}
