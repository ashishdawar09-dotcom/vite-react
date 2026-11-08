import { useCallback, useEffect, useRef, useState } from "react";
import { listRegistrationWaitlist, type WaitlistRow } from "../../lib/db";

// How often an open Players tab re-reads the waitlist, and the shortest gap
// between reads when the director comes back to the tab.
const POLL_MS = 60_000;
const MIN_GAP_MS = 10_000;

type State = {
  rows: WaitlistRow[];
  loaded: boolean;
  error: string | null;
  readAt: number | null;
};

// Admin-only: the tournament's waitlist, read when the tab opens, every
// minute while it's on screen, and when the director comes back to it. The
// table isn't in the realtime publication, so this polls instead of
// subscribing. A failed read keeps the last list and shows the error.
export function useRegistrationWaitlist(tournamentId: string | null | undefined, enabled: boolean) {
  const [state, setState] = useState<State>({ rows: [], loaded: false, error: null, readAt: null });
  const lastRead = useRef(0);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!tournamentId || !enabled) return;
    lastRead.current = Date.now();
    try {
      const rows = await listRegistrationWaitlist(tournamentId);
      if (alive.current) setState({ rows, loaded: true, error: null, readAt: Date.now() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (alive.current) setState((s) => ({ ...s, loaded: true, error: msg }));
    }
  }, [tournamentId, enabled]);

  useEffect(() => {
    // No reset here: the panel is keyed by tournament, so a new tournament
    // mounts a fresh hook with an empty list.
    alive.current = true;
    if (!tournamentId || !enabled) return;
    const first = setTimeout(() => void refresh(), 0);
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onBack = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRead.current > MIN_GAP_MS) void refresh();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      alive.current = false;
      clearTimeout(first);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [tournamentId, enabled, refresh]);

  return { ...state, refresh };
}
