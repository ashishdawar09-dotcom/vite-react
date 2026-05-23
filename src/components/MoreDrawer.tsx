import { AnimatePresence, motion } from "framer-motion";

// All tab IDs the admin/spectator shell can switch between. Exported so
// App.tsx and MoreDrawer share the same union — single source of truth.
export type TabId =
  | "live"
  | "matches"
  | "register"
  | "checkin"
  | "profiles"
  | "teams"
  | "groups"
  | "knockout"
  | "scoreboard"
  | "categories";

// Mobile "More" drawer — slides up from the bottom on small screens,
// shows the 7 secondary tabs that didn't fit in the primary nav bar.
//
// Two explicit `key` props on AnimatePresence children: without them iOS
// WebKit can lose track of element identity across enter/exit and throw
// DOMException NotFoundError during reconciliation (originally caught by
// Sentry ad68e220a5ff…).
export function MoreDrawer({
  open,
  onClose,
  currentTab,
  onPickTab,
  phase,
  isAdmin,
}: {
  open: boolean;
  onClose: () => void;
  currentTab: TabId;
  onPickTab: (id: TabId) => void;
  phase: "none" | "group" | "knockout";
  isAdmin: boolean;
}) {
  const items: { id: TabId; label: string; icon: string; visible: boolean }[] = [
    { id: "register", label: "Players", icon: "📋", visible: true },
    { id: "checkin", label: "Check-In", icon: "✅", visible: true },
    { id: "teams", label: "Teams", icon: "🤝", visible: true },
    { id: "groups", label: "Groups", icon: "📊", visible: phase !== "none" },
    { id: "knockout", label: "Knockout", icon: "⚔️", visible: phase === "knockout" },
    { id: "scoreboard", label: "Scoreboard", icon: "🏅", visible: true },
    { id: "categories", label: "Categories", icon: "🏷️", visible: isAdmin },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="more-drawer-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)",
            zIndex: 200,
            display: "flex",
            alignItems: "flex-end",
          }}
        >
          <motion.div
            key="more-drawer-sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              background: "#0a1628",
              borderTop: "1px solid #1a3050",
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              // Top 12, sides 16, bottom = 24 + safe-area so the last
              // button clears the iOS home indicator on iPhone 14+ through 17.
              padding: "12px 16px calc(env(safe-area-inset-bottom, 0px) + 24px)",
              maxHeight: "70vh",
              overflowY: "auto",
            }}
          >
            <div style={{ width: 40, height: 4, background: "#475569", borderRadius: 2, margin: "0 auto 16px" }} />
            <div
              className="font-display"
              style={{
                fontSize: 11,
                color: "#94a3b8",
                textTransform: "uppercase",
                letterSpacing: 2,
                fontWeight: 700,
                marginBottom: 12,
                padding: "0 4px",
              }}
            >
              More Tabs
            </div>
            {items.filter((t) => t.visible).map((t) => {
              const isActive = currentTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => { onPickTab(t.id); onClose(); }}
                  className="font-display"
                  style={{
                    width: "100%",
                    padding: 14,
                    background: isActive ? "rgba(0,212,255,0.12)" : "transparent",
                    border: isActive ? "1px solid rgba(0,212,255,0.3)" : "1px solid #1a3050",
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    color: isActive ? "#00d4ff" : "#cbd5e1",
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    cursor: "pointer",
                    marginBottom: 6,
                    minHeight: 48,
                  }}
                >
                  <span style={{ fontSize: 18 }}>{t.icon}</span>
                  {t.label}
                </button>
              );
            })}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
