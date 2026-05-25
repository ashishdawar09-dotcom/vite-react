import type { ButtonHTMLAttributes, ReactNode } from "react";
import { colors, radii, typography } from "../../lib/theme";

// Shared <Pill> primitive — the small chip-shaped buttons that show up as
// filter selectors across feature tabs (CheckInTab status filter,
// MatchesTab status/court filter, ProfilesTab category filter).
//
// Before this, every tab hand-rolled its own:
//   - border-radius drifted from 6 to 24 across tabs
//   - active state was sometimes a gradient, sometimes a tinted bg, sometimes
//     a 2px border
//   - accent colour was sometimes the cyan brand token, sometimes literal hex
//
// Behaviour:
//   - Two visual states: active (filled with `accent`) / inactive (outline).
//   - Optional `count` slot rendered as a muted suffix — useful for filters
//     where the number of items in that bucket is the affordance.
//   - 36px tall (just under the 44pt full-button target — chips are meant
//     to be grouped, not standalone primary actions).
//   - `accent` defaults to the cyan brand token; pass a state colour
//     (`colors.state.live`, etc.) for status filters.
//
// Surface — `dark` (default) for the broadcast/admin chrome; `light` for the
// brighter feature-tab backgrounds.

type Surface = "dark" | "light";

export type PillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  /** Hex / rgba — defaults to brand cyan. */
  accent?: string;
  /** Rendered as a muted suffix after `children`. */
  count?: number | string;
  surface?: Surface;
  /** Optional icon / emoji at the start. */
  leftIcon?: ReactNode;
};

export function Pill({
  active = false,
  accent = colors.brand.cyan,
  count,
  surface = "dark",
  leftIcon,
  style,
  children,
  ...rest
}: PillProps) {
  const dark = surface === "dark";

  const inactiveBg = dark ? "rgba(255,255,255,0.04)" : colors.bg.muted;
  const inactiveBorder = dark ? colors.border.dark : colors.border.light;
  const inactiveText = dark ? colors.text.mutedDark : colors.text.mutedLight;

  return (
    <button
      type="button"
      {...rest}
      aria-pressed={active}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 36,
        padding: "0 14px",
        borderRadius: radii.pill,
        // Active: tinted background + accent border + accent text. Inactive:
        // neutral surface + faint border + muted text.
        background: active ? `${accent}1F` : inactiveBg,
        border: `1px solid ${active ? accent : inactiveBorder}`,
        color: active ? accent : inactiveText,
        fontFamily: typography.body,
        fontSize: typography.scale.xs,
        fontWeight: active ? typography.weight.bold : typography.weight.medium,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        cursor: rest.disabled ? "not-allowed" : "pointer",
        transition: "background 0.12s ease, border-color 0.12s ease, color 0.12s ease",
        // -webkit-tap-highlight-color suppression handled globally in
        // index.css; this remains tap-friendly via the 36-px target.
        ...style,
      }}
    >
      {leftIcon}
      <span>{children}</span>
      {count !== undefined && (
        <span
          style={{
            ...typography.tabular,
            fontWeight: typography.weight.bold,
            opacity: active ? 1 : 0.7,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
