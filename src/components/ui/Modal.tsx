import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { colors, radii } from "../../lib/theme";

// Shared <Modal> primitive used by every overlay surface in the app.
//
// Replaces the inline `position: fixed; inset: 0; background: rgba(...)`
// patterns that were duplicated across Login, AdminManager, the partner
// picker, the court picker, etc. — each with slightly different padding,
// radii, and z-indexes.
//
// Behavior:
//   - Portals into document.body so z-index battles with parent stacking
//     contexts can't crop the modal.
//   - Escape key closes (when `onClose` provided).
//   - Click on backdrop closes; click inside the sheet does not bubble.
//   - Safe-area padding on the backdrop so the sheet never crops to a
//     notch/home-indicator in landscape.
//   - Body scroll-lock while open (prevents iOS rubber-banding behind it).
//
// Variants:
//   surface = "dark"  (default) — broadcast aesthetic, used by Login,
//                                  partner picker, etc.
//   surface = "light"           — bright admin tools (AdminManager,
//                                  category editor).

type Size = "sm" | "md" | "lg";
type Surface = "dark" | "light";

const MAX_W: Record<Size, number> = { sm: 360, md: 440, lg: 560 };

export function Modal({
  open,
  onClose,
  size = "md",
  surface = "dark",
  zIndex = 2000,
  ariaLabel,
  children,
}: {
  open: boolean;
  onClose?: () => void;
  size?: Size;
  surface?: Surface;
  zIndex?: number;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // Esc to close.
  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Body scroll-lock while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const dark = surface === "dark";

  const node = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: dark ? "rgba(2, 6, 14, 0.72)" : "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex,
        padding: `max(env(safe-area-inset-top, 0px), 16px) max(env(safe-area-inset-right, 0px), 16px) max(env(safe-area-inset-bottom, 0px), 16px) max(env(safe-area-inset-left, 0px), 16px)`,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: dark ? colors.bg.elevated : colors.bg.card,
          color: dark ? colors.text.primaryDark : colors.text.primaryLight,
          border: dark ? `1px solid ${colors.brand.cyanBorder}` : `1px solid ${colors.border.light}`,
          borderRadius: radii.xl,
          padding: 28,
          maxWidth: MAX_W[size],
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: dark
            ? "0 24px 64px rgba(0,0,0,0.45), 0 0 0 1px rgba(0, 212, 255, 0.05)"
            : "0 24px 64px rgba(15, 23, 42, 0.25)",
        }}
      >
        {children}
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
