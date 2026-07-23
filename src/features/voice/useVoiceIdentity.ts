import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";

// If the user is logged in, resolve their own player id for this tournament via
// the my_player() RPC (SECURITY DEFINER — matches the JWT email server-side,
// never exposes anyone else's email). That id is passed to the voice agent so
// "my next match" works without the user saying their name. Not logged in →
// null, and the agent falls back to the name-based path.
export function useVoicePlayerId(tournamentId: string | null): string | null {
  const { email } = useAuth();
  const [playerId, setPlayerId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!email || !tournamentId) {
      setPlayerId(null);
      return () => { cancelled = true; };
    }
    supabase
      .rpc("my_player", { p_tournament_id: tournamentId })
      .then(({ data, error }) => {
        if (cancelled || error) { if (!cancelled && error) setPlayerId(null); return; }
        const pid = (data as { player?: { id?: string } } | null)?.player?.id ?? null;
        setPlayerId(pid);
      });
    return () => { cancelled = true; };
  }, [email, tournamentId]);

  return playerId;
}
