import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, ADMIN_EMAILS } from "../lib/supabase";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const email = session?.user?.email?.toLowerCase() ?? null;
  const isAdmin = !!email && ADMIN_EMAILS.includes(email);

  return { session, loading, email, isAdmin };
}
