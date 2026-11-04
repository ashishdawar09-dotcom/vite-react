// registration_leads: people who started the public form (save-registration-lead).
// register-player and stripe-webhook mark a lead completed once the entry is
// in (e-Transfer submitted, or card paid), so the funnel shows who finished
// and reminders skip them.

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

// Best effort: a failure is logged and never affects the registration.
export async function markLeadCompleted(supabase: SupabaseClient, tournamentId: string, email: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("registration_leads")
      .update({ completed_at: new Date().toISOString() })
      .eq("tournament_id", tournamentId)
      .eq("email", email.trim().toLowerCase())
      .is("completed_at", null);
    if (error) console.error("lead completion not saved:", error.message);
  } catch (e) {
    console.error("lead completion not saved:", e instanceof Error ? e.message : String(e));
  }
}
