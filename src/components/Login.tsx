import { useState } from "react";
import { supabase } from "../lib/supabase";

export function Login({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyOAuth, setBusyOAuth] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sendMagicLink = async () => {
    setErr(null);
    const clean = email.trim().toLowerCase();
    if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setErr("Enter a valid email address.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: clean,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  };

  const signInWithGoogle = async () => {
    setErr(null);
    setBusyOAuth(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setBusyOAuth(false);
      setErr(error.message);
    }
    // On success, browser is redirected — no need to clear busy.
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16, backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 20, padding: 32, maxWidth: 400, width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800, textAlign: "center" }}>🔐 Sign In</h3>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "#64748b", textAlign: "center" }}>
          Use Google for instant access, or get a magic link by email.
        </p>

        {sent ? (
          <div style={{ padding: 16, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, color: "#16a34a", textAlign: "center", fontSize: 14 }}>
            ✓ Check your inbox at <strong>{email}</strong>
            <div style={{ marginTop: 8, fontSize: 12, color: "#15803d" }}>
              The link logs you in. If you're not yet an admin, ask the tournament organizer to grant access.
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={busyOAuth || busy}
              style={{
                width: "100%", padding: "12px 14px", background: "#fff", color: "#1f1f1f",
                border: "1.5px solid #d0d7de", borderRadius: 10, fontWeight: 600, fontSize: 14,
                cursor: busyOAuth ? "wait" : "pointer", display: "flex", alignItems: "center",
                justifyContent: "center", gap: 10, marginBottom: 16,
                opacity: busyOAuth ? 0.7 : 1,
              }}
              aria-label="Continue with Google"
            >
              <GoogleLogo />
              {busyOAuth ? "Redirecting…" : "Continue with Google"}
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", letterSpacing: 1 }}>OR</span>
              <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
            </div>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              autoComplete="email"
              style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "2px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 12 }}
            />
            {err && <div style={{ color: "#E63946", fontSize: 13, marginBottom: 12 }}>{err}</div>}
            <button
              disabled={busy || busyOAuth}
              onClick={sendMagicLink}
              style={{ width: "100%", padding: 14, background: "#3A86FF", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1 }}
            >
              {busy ? "Sending…" : "Send Magic Link"}
            </button>
            <p style={{ marginTop: 12, marginBottom: 0, fontSize: 11, color: "#94a3b8", textAlign: "center", lineHeight: 1.4 }}>
              Anyone can sign in. Admin powers are granted by an existing tournament admin.
            </p>
          </>
        )}
        <button
          onClick={onClose}
          style={{ width: "100%", marginTop: 12, padding: 10, background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: 13 }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function GoogleLogo() {
  // Inlined Google logo SVG to avoid network dep.
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" />
    </svg>
  );
}
