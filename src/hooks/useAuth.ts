import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import * as Sentry from "@sentry/react";
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

  // Tell Sentry who the user is (or clear identity on logout) so error
  // breadcrumbs are filterable by user in the Sentry UI. Static import —
  // a dynamic `await import("@sentry/react")` here breaks tree-shaking
  // and dumps the whole Sentry SDK into the chunk (146 KB vs 26 KB).
  // Sentry is already in the App chunk graph via lib/sentry.ts and
  // ErrorBoundary, so this adds zero bundle weight.
  useEffect(() => {
    try {
      if (email) Sentry.setUser({ email });
      else Sentry.setUser(null);
    } catch {
      // Sentry isn't critical to app function; swallow.
    }
  }, [email]);

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
