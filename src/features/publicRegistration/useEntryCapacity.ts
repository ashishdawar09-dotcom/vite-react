import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { type Capacity, parseCapacity } from "./capacity";

// How often an open form re-reads the count, and how long the page waits for
// the first answer before opening the form without a counter.
const POLL_MS = 45_000;
const FIRST_ANSWER_MS = 5_000;
// Coming back to the tab re-reads the count, but not more often than this.
const MIN_GAP_MS = 10_000;

// Live entry count for the public form (registration_capacity RPC). Read when
// the page opens, every 45 s while it's on screen, and when the visitor comes
// back to it. `capacity` is null when the tournament has no cap. A failed read
// keeps the last count; the server enforces the cap either way.
export function useEntryCapacity(tournamentId: string | undefined) {
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [loaded, setLoaded] = useState(false);
  const lastRead = useRef(0);
  const alive = useRef(true);

  // Resolves to the fresh count, null for no cap, or undefined if the read failed.
  const refresh = useCallback(async (): Promise<Capacity | null | undefined> => {
    if (!tournamentId) return undefined;
    lastRead.current = Date.now();
    try {
      const { data, error } = await supabase.rpc("registration_capacity", { p_tournament_id: tournamentId });
      if (error) throw error;
      const c = parseCapacity(data);
      if (alive.current) {
        setCapacity(c);
        setLoaded(true);
      }
      return c;
    } catch {
      if (alive.current) setLoaded(true);
      return undefined;
    }
  }, [tournamentId]);

  useEffect(() => {
    alive.current = true;
    if (!tournamentId) return;
    const first = setTimeout(() => void refresh(), 0);
    const fallback = setTimeout(() => setLoaded(true), FIRST_ANSWER_MS);
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
      clearTimeout(fallback);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [tournamentId, refresh]);

  return { capacity, loaded: loaded || !tournamentId, refresh };
}
