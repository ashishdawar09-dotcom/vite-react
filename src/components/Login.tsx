import { useState } from "react";
import { supabase, ADMIN_EMAIL } from "../lib/supabase";

export function Login({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    setErr(null);
    if (email.trim().toLowerCase() !== ADMIN_EMAIL) {
      setErr("Only the admin email can sign in.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16, backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 32, maxWidth: 400, width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800, textAlign: "center" }}>🔐 Admin Sign In</h3>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "#64748b", textAlign: "center" }}>We'll email you a magic link.</p>
        {sent ? (
          <div style={{ padding: 16, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, color: "#16a34a", textAlign: "center", fontSize: 14 }}>
            ✓ Check your inbox at <strong>{email}</strong>
          </div>
        ) : (
          <>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@email.com" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "2px solid #e2e8f0", fontSize: 15, outline: "none", boxSizing: "border-box", marginBottom: 12 }} />
            {err && <div style={{ color: "#E63946", fontSize: 13, marginBottom: 12 }}>{err}</div>}
            <button disabled={busy} onClick={send} style={{ width: "100%", padding: 14, background: "#3A86FF", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Sending..." : "Send Magic Link"}
            </button>
          </>
        )}
        <button onClick={onClose} style={{ width: "100%", marginTop: 12, padding: 10, background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: 13 }}>Close</button>
      </div>
    </div>
  );
}
