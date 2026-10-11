// Verify the caller is a tournament admin. `supabase.functions.invoke` from the
// admin client auto-attaches the logged-in user's access token as the
// Authorization header. We validate that token to resolve the user's email,
// then confirm membership in `tournament_admins` using the service-role client.
// (We can't reuse the SQL `is_admin()` here — the service-role client carries no
// JWT, so `auth.jwt()` would be empty.) Returns the admin email, or null.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

export async function requireAdmin(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user?.email) return null;
    const email = user.email.toLowerCase();
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data } = await admin
      .from("tournament_admins")
      .select("email")
      .eq("email", email)
      .maybeSingle();
    return data ? email : null;
  } catch {
    return null;
  }
}
