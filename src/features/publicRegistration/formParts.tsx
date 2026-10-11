// Form building blocks shared by the public registration page and the
// partner waiver page.

import { colors, radii, shadows, spacing, typography } from "../../lib/theme";

export const CYAN = "#00d4ff";
export const CYAN_DARK = "#006d80";

// Only http(s) links reach an href; anything else (e.g. javascript:) is dropped.
export function safeHttpUrl(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

export type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
};

export function Field({ label, hint, error, required, children }: FieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          color: colors.text.mutedLight,
        }}
      >
        {label}{required && <span style={{ color: colors.state.live, marginLeft: 4 }}>*</span>}
      </label>
      {children}
      {/* Reserved 16px error slot prevents layout shift on blur validation */}
      <div style={{ minHeight: 16, fontSize: 12, color: colors.state.live }}>
        {error ? error : hint && <span style={{ color: colors.text.mutedLight }}>{hint}</span>}
      </div>
    </div>
  );
}

export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  fontSize: 16, // 16+ avoids iOS auto-zoom on focus
  border: `1px solid ${colors.border.lightStrong}`,
  borderRadius: radii.md,
  background: colors.bg.card,
  color: colors.text.primaryLight,
  fontFamily: typography.body,
  boxSizing: "border-box",
  minHeight: 44,
};

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      // dvh + safe-area padding so the form looks right whether opened in
      // mobile Safari, an installed PWA, or a desktop browser.
      minHeight: "100dvh",
      background: colors.bg.page,
      fontFamily: typography.body,
      color: colors.text.primaryLight,
      paddingTop: "env(safe-area-inset-top, 0px)",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
      paddingLeft: "env(safe-area-inset-left, 0px)",
      paddingRight: "env(safe-area-inset-right, 0px)",
    }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: `0 ${spacing.md}px` }}>
        {children}
      </div>
    </div>
  );
}

export function CheckRow({ checked, onChange, label, hint, error }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; error?: string;
}) {
  return (
    <label style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 22, height: 22, marginTop: 1, flex: "0 0 auto", accentColor: CYAN_DARK }} />
      <span style={{ fontSize: 14, lineHeight: 1.45, color: colors.text.primaryLight }}>
        {label}
        {hint && <span style={{ display: "block", fontSize: 12, color: colors.text.mutedLight, marginTop: 2 }}>{hint}</span>}
        {error && <span style={{ display: "block", fontSize: 12, color: colors.state.live, fontWeight: 700, marginTop: 2 }}>{error}</span>}
      </span>
    </label>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: colors.bg.card,
      borderRadius: radii.xl,
      padding: spacing.lg,
      marginBottom: spacing.md,
      boxShadow: shadows.md,
      border: `1px solid ${colors.border.light}`,
      display: "flex", flexDirection: "column", gap: spacing.md,
    }}>
      {children}
    </div>
  );
}
