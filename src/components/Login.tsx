import { useState } from "react";
import { supabase } from "../lib/supabase";
import { colors, radii, spacing, typography } from "../lib/theme";

type Stage = "email" | "code";

// Detect installed standalone PWAs so we can hide the Google button there.
// Google OAuth on iOS PWAs opens in SFSafariViewController (separate cookie
// context from the PWA), so the redirect never re-enters our app. OTP works
// reliably in the same window — no redirects at all.
function isInstalledPwa(): boolean {
  if (typeof window === "undefined") return false;
  // @ts-expect-error iOS-only non-standard
  if (navigator.standalone === true) return true;
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

export function Login({ onClose }: { onClose: () => void }) {
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyOAuth, setBusyOAuth] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resentAt, setResentAt] = useState<number | null>(null);
  const inPwa = isInstalledPwa();

  const cleanEmail = () => email.trim().toLowerCase();

  const sendOtp = async () => {
    setErr(null);
    const e = cleanEmail();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setErr("Enter a valid email address.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: e,
      // emailRedirectTo: the magic link in the email lands here. We keep it
      // for desktop users who prefer clicking; PWA users use the 6-digit code.
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setStage("code");
    setResentAt(Date.now());
  };

  const verifyOtp = async () => {
    setErr(null);
    const e = cleanEmail();
    const tok = code.replace(/\D/g, ""); // strip non-digits, just in case
    if (tok.length < 6) {
      setErr("Enter the full code from your email (usually 6–8 digits).");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({
      email: e,
      token: tok,
      type: "email",
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    // Session is now established in this browser's storage. Close the modal —
    // useAuth's onAuthStateChange will fire and surface the signed-in state.
    onClose();
  };

  const resendCode = async () => {
    // Throttle: 30s between resends
    if (resentAt && Date.now() - resentAt < 30_000) {
      setErr("Hold on a few seconds before resending.");
      return;
    }
    await sendOtp();
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
    // On success the browser is redirected; no need to clear busy.
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2, 6, 14, 0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
        // safe-area padding so the modal never sits under the notch / home
        // indicator if the user opens it in landscape or on a notched device.
        padding: `max(env(safe-area-inset-top, 0px), 16px) max(env(safe-area-inset-right, 0px), 16px) max(env(safe-area-inset-bottom, 0px), 16px) max(env(safe-area-inset-left, 0px), 16px)`,
        backdropFilter: "blur(8px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: colors.bg.elevated,
          border: `1px solid ${colors.brand.cyanBorder}`,
          borderRadius: radii.xl,
          padding: 32,
          maxWidth: 400,
          width: "100%",
          color: colors.text.primaryDark,
          fontFamily: typography.body,
          boxShadow: "0 24px 64px rgba(0,0,0,0.45), 0 0 0 1px rgba(0, 212, 255, 0.05)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          className="font-display"
          style={{
            margin: "0 0 6px",
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: 1.2,
            textAlign: "center",
            color: colors.text.primaryDark,
            textTransform: "uppercase",
          }}
        >
          Sign In
        </h3>
        <p
          style={{
            margin: "0 0 24px",
            fontSize: 13,
            color: colors.text.mutedDark,
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          {stage === "email"
            ? "Sign in to manage your tournament. Players: registration links don't require an account."
            : <>Enter the verification code we sent to <strong style={{ color: colors.brand.cyan }}>{cleanEmail()}</strong>.</>}
        </p>

        {stage === "email" ? (
          <>
            {/* Google sign-in only shown OUTSIDE installed PWAs because in-app
                OAuth browsers don't return cookies to the PWA reliably */}
            {!inPwa && (
              <>
                <button
                  type="button"
                  onClick={signInWithGoogle}
                  disabled={busyOAuth || busy}
                  style={{
                    width: "100%",
                    minHeight: 52,
                    padding: "14px 16px",
                    background: "#fff",
                    color: "#1f1f1f",
                    border: "1.5px solid #d0d7de",
                    borderRadius: radii.md,
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: busyOAuth ? "wait" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    marginBottom: 16,
                    opacity: busyOAuth ? 0.7 : 1,
                  }}
                  aria-label="Continue with Google"
                >
                  {busyOAuth ? <Spinner color="#1f1f1f" /> : <GoogleLogo />}
                  {busyOAuth ? "Redirecting…" : "Continue with Google"}
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                  <div style={{ flex: 1, height: 1, background: colors.border.dark }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: colors.text.mutedDark, letterSpacing: 1.5 }}>OR</span>
                  <div style={{ flex: 1, height: 1, background: colors.border.dark }} />
                </div>
              </>
            )}

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void sendOtp()}
              placeholder="you@email.com"
              autoComplete="email"
              autoFocus
              style={{
                width: "100%",
                // 56px keeps the input above iOS 44pt minimum and gives a
                // calm, premium rhythm; 16px font prevents iOS auto-zoom.
                height: 56,
                padding: "0 16px",
                borderRadius: radii.md,
                border: `2px solid ${colors.border.darkStrong}`,
                background: colors.bg.surface,
                color: colors.text.primaryDark,
                fontSize: 16,
                outline: "none",
                boxSizing: "border-box",
                marginBottom: 12,
              }}
            />
            {err && (
              <div style={{ color: colors.state.live, fontSize: 13, marginBottom: 12 }}>
                {err}
              </div>
            )}
            <button
              disabled={busy || busyOAuth}
              onClick={() => void sendOtp()}
              style={{
                width: "100%",
                minHeight: 56,
                padding: "16px",
                background: colors.gradient.brandCta,
                color: "#fff",
                border: "none",
                borderRadius: radii.md,
                fontWeight: 800,
                fontSize: 15,
                letterSpacing: 0.5,
                cursor: busy ? "wait" : "pointer",
                opacity: busy ? 0.7 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                boxShadow: "0 8px 24px rgba(0, 184, 255, 0.35)",
              }}
            >
              {busy && <Spinner color="#fff" />}
              {busy ? "Sending…" : "Send Code"}
            </button>
            <p
              style={{
                marginTop: 14,
                marginBottom: 0,
                fontSize: 11,
                color: colors.text.mutedDark,
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              Anyone can sign in. Admin powers are granted by an existing tournament admin.
            </p>
          </>
        ) : (
          <>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
              onKeyDown={(e) => e.key === "Enter" && void verifyOtp()}
              placeholder="Code from email"
              autoComplete="one-time-code"
              autoFocus
              style={{
                width: "100%",
                height: 64,
                padding: "0 16px",
                borderRadius: radii.md,
                border: `2px solid ${colors.brand.cyanBorder}`,
                background: colors.bg.surface,
                color: colors.text.primaryDark,
                fontSize: 24,
                outline: "none",
                boxSizing: "border-box",
                marginBottom: 12,
                textAlign: "center",
                letterSpacing: 6,
                fontFamily: "Menlo, monospace",
                fontWeight: 700,
              }}
            />
            {err && (
              <div style={{ color: colors.state.live, fontSize: 13, marginBottom: 12 }}>
                {err}
              </div>
            )}
            <button
              disabled={busy || code.length < 6}
              onClick={() => void verifyOtp()}
              style={{
                width: "100%",
                minHeight: 56,
                padding: "16px",
                background: colors.gradient.brandCta,
                color: "#fff",
                border: "none",
                borderRadius: radii.md,
                fontWeight: 800,
                fontSize: 15,
                letterSpacing: 0.5,
                cursor: busy ? "wait" : "pointer",
                opacity: busy || code.length < 6 ? 0.5 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                boxShadow: "0 8px 24px rgba(0, 184, 255, 0.35)",
              }}
            >
              {busy && <Spinner color="#fff" />}
              {busy ? "Verifying…" : "Verify & Sign In"}
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
              <button
                type="button"
                onClick={() => { setStage("email"); setCode(""); setErr(null); }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: colors.text.mutedDark,
                  fontSize: 12,
                  cursor: "pointer",
                  padding: spacing.sm,
                  minHeight: 44,
                }}
              >
                ← Use different email
              </button>
              <button
                type="button"
                onClick={() => void resendCode()}
                disabled={busy}
                style={{
                  background: "transparent",
                  border: "none",
                  color: colors.brand.cyan,
                  fontSize: 12,
                  cursor: "pointer",
                  padding: spacing.sm,
                  minHeight: 44,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                }}
              >
                Resend code
              </button>
            </div>
            <p
              style={{
                marginTop: 14,
                marginBottom: 0,
                fontSize: 11,
                color: colors.text.mutedDark,
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              The code is also a tappable magic link in the email — works either way.
            </p>
          </>
        )}
        <button
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 14,
            minHeight: 44,
            padding: 12,
            background: "transparent",
            border: `1px solid ${colors.border.dark}`,
            color: colors.text.mutedDark,
            cursor: "pointer",
            fontSize: 13,
            borderRadius: radii.sm,
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function Spinner({ color }: { color: string }) {
  // Small inline animated SVG; rotates via CSS keyframes registered in
  // src/index.css (`spin`). Lightweight — no framer-motion dependency
  // because Login can be opened pre-Suspense-boundary if a chunk fails.
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 50 50"
      style={{ animation: "spin 0.85s linear infinite", flexShrink: 0 }}
      aria-hidden="true"
    >
      <circle
        cx="25" cy="25" r="20"
        fill="none"
        stroke={color}
        strokeOpacity="0.25"
        strokeWidth="5"
      />
      <path
        d="M25 5 a20 20 0 0 1 20 20"
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
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
