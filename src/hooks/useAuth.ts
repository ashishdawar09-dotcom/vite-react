import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { isEmailAdmin } from "../lib/db";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const email = session?.user?.email?.toLowerCase() ?? null;

  // Hydrate session from storage on mount + subscribe to auth changes.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Re-check admin status whenever the email changes (login / logout).
  // Source of truth is the tournament_admins table — not env vars.
  const refreshAdmin = useCallback(async () => {
    if (!email) { setIsAdmin(false); return; }
    try {
      const ok = await isEmailAdmin(email);
      setIsAdmin(ok);
    } catch {
      setIsAdmin(false);
    }
  }, [email]);

  useEffect(() => { refreshAdmin(); }, [refreshAdmin]);

  return { session, loading, email, isAdmin, refreshAdmin };
}
