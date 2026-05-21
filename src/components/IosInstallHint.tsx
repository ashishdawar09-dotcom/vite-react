import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { colors, easings, radii, spacing, typography } from "../lib/theme";

const CYAN = "#00d4ff";
const STORAGE_KEY = "ios-install-hint-dismissed";

// Detect iOS Safari that has NOT been installed to the home screen.
// We only nudge users who can actually act on the nudge.
function shouldShow(): boolean {
  if (typeof window === "undefined") return false;
  // Already dismissed?
  try { if (localStorage.getItem(STORAGE_KEY) === "1") return false; } catch { /* private mode */ }

  const ua = window.navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua);
  if (!isIos) return false;

  // Standalone mode = already installed (legacy iOS prop)
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return false;
  // Modern standalone check via media query
  if (window.matchMedia?.("(display-mode: standalone)")?.matches) return false;

  return true;
}

export function IosInstallHint() {
  const reduce = useReducedMotion();
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Defer slightly so we don't compete with first paint
    const t = window.setTimeout(() => setShow(shouldShow()), 1500);
    return () => window.clearTimeout(t);
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
    setShow(false);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={reduce ? false : { y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: 80, opacity: 0 }}
          transition={{ duration: 0.3, ease: easings.standard }}
          style={{
            position: "fixed",
            left: spacing.md,
            right: spacing.md,
            // Sit just above the iOS safe-area + a touch more so it doesn't
            // collide with the Safari toolbar peek.
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
            zIndex: 3000,
            background: colors.bg.card,
            border: `1px solid ${CYAN}`,
            borderRadius: radii.lg,
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.4)",
            padding: spacing.md,
            color: colors.text.primaryLight,
            display: "flex",
            alignItems: "flex-start",
            gap: spacing.md,
            fontFamily: typography.body,
          }}
          role="dialog"
          aria-label="Install this app"
        >
          <div style={{ flex: 1, lineHeight: 1.45 }}>
            <div style={{
              fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
              textTransform: "uppercase", color: CYAN, marginBottom: 4,
            }}>
              Install the app
            </div>
            <div style={{ fontSize: 13, color: colors.text.primaryLight }}>
              Tap <ShareIcon /> then <strong>Add to Home Screen</strong> for the full-screen app experience.
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss install hint"
            style={{
              border: "none",
              background: "transparent",
              color: colors.text.mutedLight,
              fontSize: 20,
              fontWeight: 700,
              cursor: "pointer",
              padding: 4,
              lineHeight: 1,
            }}
          >×</button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Small inline SVG of the iOS share icon — keeps the hint actionable without
// loading an external icon font.
function ShareIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={CYAN}
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ verticalAlign: "-2px", display: "inline-block" }}
      aria-hidden="true"
    >
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}
