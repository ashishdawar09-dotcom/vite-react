import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion"; /* NEW: makeover slide-in/out */

type ToastKind = "info" | "success" | "warn" | "error";
type Toast = { id: number; kind: ToastKind; msg: string };

type Ctx = {
  show: (msg: string, kind?: ToastKind) => void;
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((msg: string, kind: ToastKind = "info") => {
    const id = nextId++;
    setToasts(t => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);

  const ctx: Ctx = {
    show,
    success: (m) => show(m, "success"),
    error: (m) => show(m, "error"),
    info: (m) => show(m, "info"),
  };

  return (
    <ToastCtx.Provider value={ctx}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          bottom: 16, right: 16, zIndex: 9999,
          display: "flex", flexDirection: "column", gap: 8,
          pointerEvents: "none",
        }}
      >
        {/* MAKEOVER: AnimatePresence + motion.div for slide-in from right, fade-out on dismiss */}
        {/* HOTFIX: mode="popLayout" so exiting toasts position: absolute, can't race the layout
            reflow on iOS WebKit (defensive companion to the drawer key-prop fix). */}
        <AnimatePresence mode="popLayout">
          {toasts.map(t => (
            <motion.div
              key={t.id}
              role="status"
              initial={{ x: 80, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 80, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0, 0, 0.2, 1] }}
              layout
              style={{
                padding: "12px 16px", borderRadius: 8, minWidth: 240, maxWidth: 360,
                fontSize: 13, fontWeight: 600, color: "#fff",
                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                border: `1px solid ${kindBorder(t.kind)}`,
                background: kindBg(t.kind),
                pointerEvents: "auto",
              }}
            >
              {t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

function kindBg(k: ToastKind): string {
  switch (k) {
    case "success": return "linear-gradient(135deg,#0a3a1f,#082815)";
    case "error":   return "linear-gradient(135deg,#3a0c0c,#1f0808)";
    case "warn":    return "linear-gradient(135deg,#3a2a0c,#1f1408)";
    default:        return "linear-gradient(135deg,#0c2a3a,#081f2e)";
  }
}
function kindBorder(k: ToastKind): string {
  switch (k) {
    case "success": return "#22c55e";
    case "error":   return "#ef4444";
    case "warn":    return "#f59e0b";
    default:        return "#00d4ff";
  }
}

export function useToast(): Ctx {
  const c = useContext(ToastCtx);
  if (!c) {
    // Fallback: degrade to console.warn / alert so callers always work even
    // if provider isn't mounted (e.g. in tests).
    return {
      show: (m) => console.log("[toast]", m),
      success: (m) => console.log("[toast:success]", m),
      error: (m) => { console.error("[toast:error]", m); },
      info: (m) => console.log("[toast:info]", m),
    };
  }
  return c;
}

// Module-level shim so non-React code can trigger toasts (set by Provider).
let _show: ((m: string, k?: ToastKind) => void) | null = null;
export function setGlobalToast(fn: (m: string, k?: ToastKind) => void) { _show = fn; }
export function toast(msg: string, kind: ToastKind = "info") {
  if (_show) _show(msg, kind);
  else console.log(`[toast:${kind}]`, msg);
}

// Hook variant of the global setter — Provider mounts this once.
export function ToastBridge() {
  const { show } = useToast();
  useEffect(() => { setGlobalToast(show); return () => setGlobalToast(() => {}); }, [show]);
  return null;
}
