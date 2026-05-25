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

  // Tell Sentry who the user is (or clear identity on logout) so error
  // breadcrumbs are filterable by user in the Sentry UI. Lazy-imports
  // @sentry/react so this code-path doesn't force-load the Sentry chunk
  // any earlier than necessary — it already initializes via idleCallback.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const Sentry = await import("@sentry/react");
        if (cancelled) return;
        if (email) Sentry.setUser({ email });
        else Sentry.setUser(null);
      } catch {
        // Sentry isn't critical to app function; swallow.
      }
    })();
    return () => { cancelled = true; };
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
