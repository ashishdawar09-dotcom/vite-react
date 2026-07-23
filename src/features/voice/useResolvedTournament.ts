import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { getTournamentBySlug } from "../../lib/db";
import { getActiveTournament, subscribeActiveTournament } from "../../lib/activeTournament";

// Resolve the tournament id the voice widget should answer about, based on the
// current route:
//   /t/:slug, /t/:slug/tv, /t/:slug/results  → resolve slug → id
//   /register/:tournamentId                  → that id
//   everything else (the App shell, /p/:id)  → App's active tournament (store)
// Returns null until resolved / when unknown (widget then offers only general help).
export function useResolvedTournamentId(): string | null {
  const { pathname } = useLocation();
  const [id, setId] = useState<string | null>(() => getActiveTournament());

  useEffect(() => {
    let cancelled = false;

    const registerMatch = pathname.match(/^\/register\/([^/]+)/);
    const slugMatch = pathname.match(/^\/t\/([^/]+)/);

    if (registerMatch) {
      setId(registerMatch[1]);
      return () => { cancelled = true; };
    }

    if (slugMatch) {
      const slug = slugMatch[1];
      getTournamentBySlug(slug)
        .then((t) => { if (!cancelled) setId(t?.id ?? null); })
        .catch(() => { if (!cancelled) setId(null); });
      return () => { cancelled = true; };
    }

    // App shell / player-profile routes: track App's selected tournament.
    setId(getActiveTournament());
    const unsub = subscribeActiveTournament((next) => { if (!cancelled) setId(next); });
    return () => { cancelled = true; unsub(); };
  }, [pathname]);

  return id;
}
