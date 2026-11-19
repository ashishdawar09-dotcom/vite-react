import { useEffect, useState } from "react";
import { fetchWinnerPhoto } from "./winnerPhoto";

const RECHECK_MS = 60_000;

/**
 * The winners photo for an event, looked up when a champion card is on
 * screen and re-checked once a minute (a volunteer may upload it later).
 * A failed read keeps whatever was shown before; it never throws.
 */
export function useWinnerPhoto(categoryId: string | null | undefined): string | null {
  const [state, setState] = useState<{ id: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!categoryId) return;
    const ctl = new AbortController();
    let alive = true;
    const load = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchWinnerPhoto(categoryId, ctl.signal)
        .then((url) => { if (alive) setState({ id: categoryId, url }); })
        .catch(() => { /* keep what we have: the card works without a photo */ });
    };
    load();
    const timer = window.setInterval(load, RECHECK_MS);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      ctl.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [categoryId]);

  // A photo fetched for another event is never shown for this one.
  return state && state.id === categoryId ? state.url : null;
}
