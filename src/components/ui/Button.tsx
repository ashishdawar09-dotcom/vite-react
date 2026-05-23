import type { ButtonHTMLAttributes, ReactNode } from "react";
import { colors, radii } from "../../lib/theme";
import { Spinner } from "./Spinner";

// Shared <Button> primitive.
//
// Variants encode INTENT, not visual styling specifics:
//   primary   — the dominant CTA on a screen (cyan gradient on dark bg).
//   secondary — the "I want this but not the main action" (light/outline).
//   ghost     — neutral, low-emphasis (transparent, used in toolbars).
//   danger    — destructive actions (red).
//
// Sizes default to "md" which yields a 44pt-tall touch target. "sm" is
// 36px (use sparingly — only when nested inside small UI like chips).
// "lg" is 56px for hero CTAs.
//
// All variants honor `loading` (renders Spinner + disables clicks) and
// `disabled` (visual + interaction lockout). `style` overrides are kept
// last so callers can still tweak without forking — escape hatch, not
// replacement.

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const HEIGHT_PX: Record<Size, number> = { sm: 36, md: 44, lg: 56 };
const FONT_PX: Record<Size, number> = { sm: 12, md: 13, lg: 15 };
const PAD_X_PX: Record<Size, number> = { sm: 14, md: 20, lg: 24 };

function variantStyle(variant: Variant): React.CSSProperties {
  switch (variant) {
    case "primary":
      return {
        background: colors.gradient.brandCta,
        color: "#fff",
        border: "none",
        boxShadow: "0 4px 16px rgba(0, 184, 255, 0.32)",
      };
    case "secondary":
      return {
        background: colors.bg.card,
        color: colors.text.primaryLight,
        border: `1.5px solid ${colors.border.lightStrong}`,
      };
    case "ghost":
      return {
        background: "transparent",
        color: colors.text.mutedDark,
        border: `1px solid ${colors.border.dark}`,
      };
    case "danger":
      return {
        background: colors.state.live,
        color: "#fff",
        border: "none",
      };
  }
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  disabled,
  style,
  children,
  ...rest
}: ButtonProps) {
  const isInactive = loading || disabled;
  return (
    <button
      {...rest}
      disabled={isInactive}
      aria-busy={loading || undefined}
      style={{
        ...variantStyle(variant),
        minHeight: HEIGHT_PX[size],
        padding: `0 ${PAD_X_PX[size]}px`,
        borderRadius: radii.md,
        fontSize: FONT_PX[size],
        fontWeight: variant === "primary" ? 800 : 600,
        letterSpacing: variant === "primary" ? 0.5 : 0.3,
        cursor: isInactive ? (loading ? "wait" : "not-allowed") : "pointer",
        opacity: isInactive ? 0.6 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        width: fullWidth ? "100%" : undefined,
        transition: "transform 0.12s ease, opacity 0.12s ease",
        ...style,
      }}
    >
      {loading ? <Spinner size={size === "lg" ? "md" : "sm"} color={variant === "primary" || variant === "danger" ? "#fff" : "currentColor"} /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}
