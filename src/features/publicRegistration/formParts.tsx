// Form building blocks shared by the public registration page and the
// partner waiver page.

import { cloneElement, isValidElement, useId } from "react";
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

const LABELLABLE = new Set(["input", "select", "textarea"]);

export function Field({ label, hint, error, required, children }: FieldProps) {
  const autoId = useId();
  const messageId = `${autoId}-msg`;
  // A single native control gets an id so the <label> names it for screen
  // readers; groups (radio cards, pickers) are left as they are.
  const control = isValidElement<{ id?: string; "aria-describedby"?: string }>(children)
    && typeof children.type === "string" && LABELLABLE.has(children.type)
    ? children : null;
  const controlId = control?.props.id ?? autoId;
  const hasMessage = !!(error || hint);
  return (
    <div data-field-error={error ? "" : undefined} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label
        htmlFor={control ? controlId : undefined}
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
      {control
        ? cloneElement(control, {
            id: controlId,
            "aria-describedby": control.props["aria-describedby"] ?? (hasMessage ? messageId : undefined),
          })
        : children}
      {/* Reserved 16px error slot prevents layout shift on blur validation */}
      <div id={messageId} style={{ minHeight: 16, fontSize: 12, color: colors.state.live }}>
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
    <label data-field-error={error ? "" : undefined} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", cursor: "pointer" }}>
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

// Numbered heading at the top of each form card.
export function SectionHeader({ step, title, sub }: { step: number; title: string; sub?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: spacing.md, alignItems: "flex-start" }}>
      <span aria-hidden="true" style={{
        flex: "0 0 auto", width: 30, height: 30, borderRadius: radii.pill,
        display: "grid", placeItems: "center",
        background: colors.brand.cyanSubtle, color: CYAN_DARK,
        fontFamily: typography.display, fontWeight: 800, fontSize: 14,
      }}>{step}</span>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, fontFamily: typography.display, fontSize: 19, fontWeight: 750, color: colors.text.primaryLight, lineHeight: 1.3 }}>
          {title}
        </h2>
        {sub && <div style={{ fontSize: 13, color: colors.text.mutedLight, marginTop: 3, lineHeight: 1.5 }}>{sub}</div>}
      </div>
    </div>
  );
}

// "No partner? No problem." — shown wherever doubles accept solo entries.
export function PartnerPromise({ compact = false }: { compact?: boolean }) {
  return (
    <div role="note" style={{
      display: "flex", gap: spacing.md, alignItems: "center",
      padding: compact ? "12px 14px" : "18px 20px",
      marginBottom: compact ? 0 : spacing.md,
      borderRadius: radii.xl,
      background: "linear-gradient(135deg, rgba(0,212,255,0.14), rgba(0,102,255,0.08))",
      border: `1px solid ${colors.brand.cyanBorder}`,
    }}>
      <span aria-hidden="true" style={{
        flex: "0 0 auto", width: compact ? 36 : 46, height: compact ? 36 : 46, borderRadius: radii.pill,
        display: "grid", placeItems: "center", background: colors.bg.card, boxShadow: shadows.sm,
      }}>
        <svg width={compact ? 20 : 24} height={compact ? 20 : 24} viewBox="0 0 24 24" fill="none" stroke={CYAN_DARK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="3.2" /><circle cx="16.5" cy="8" r="3.2" />
          <path d="M2.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" /><path d="M13.6 15.2c.9-.5 1.9-.7 2.9-.7 3 0 5.5 2.2 5.5 5.5" />
        </svg>
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: typography.display, fontWeight: 800, fontSize: compact ? 15 : 18, lineHeight: 1.25, color: colors.text.primaryLight }}>
          No partner? No problem. We'll find you a partner.
        </div>
        <div style={{ fontSize: 13, color: colors.text.mutedLight, marginTop: 3, lineHeight: 1.45 }}>
          {compact
            ? "Leave the partner fields blank and we'll pair you with another player."
            : "Pick a doubles category and leave the partner fields blank."}
        </div>
      </div>
    </div>
  );
}

export type Highlight = { icon: "shield" | "feather" | "trophy"; title: string; sub: string; href?: string };

const ICON_PATHS: Record<Highlight["icon"], React.ReactNode> = {
  shield: <><path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6z" /><path d="M8.8 12.2l2.2 2.2 4.4-4.6" /></>,
  feather: <><path d="M20 4c-6 0-11 4-12.5 10.5L6 20" /><path d="M20 4c0 6-4 11-10.5 12.5" /><path d="M9 15l5-5" /></>,
  trophy: <><path d="M8 4h8v5a4 4 0 01-8 0z" /><path d="M8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4" /><path d="M12 13v4M8.5 20h7M10 17h4" /></>,
};

// Event highlights under the hero (only for tournaments configured with them).
export function Highlights({ items, isMobile }: { items: Highlight[]; isMobile: boolean }) {
  return (
    <ul style={{
      listStyle: "none", margin: `0 0 ${spacing.md}px`, padding: 0,
      display: "grid", gridTemplateColumns: isMobile ? "1fr" : `repeat(${items.length}, minmax(0, 1fr))`, gap: spacing.sm,
    }}>
      {items.map((h) => {
        const body = (
          <>
            <span aria-hidden="true" style={{
              flex: "0 0 auto", width: 34, height: 34, borderRadius: radii.md,
              display: "grid", placeItems: "center", background: colors.brand.cyanSubtle,
            }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={CYAN_DARK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {ICON_PATHS[h.icon]}
              </svg>
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 800, color: colors.text.primaryLight, lineHeight: 1.25 }}>{h.title}</span>
              <span style={{ display: "block", fontSize: 12, color: colors.text.mutedLight, marginTop: 2, lineHeight: 1.35 }}>{h.sub}</span>
            </span>
          </>
        );
        const boxStyle: React.CSSProperties = {
          display: "flex", gap: 10, alignItems: isMobile ? "center" : "flex-start", height: "100%", boxSizing: "border-box",
          padding: "12px 12px", borderRadius: radii.lg, background: colors.bg.card,
          border: `1px solid ${colors.border.light}`, boxShadow: shadows.sm, textDecoration: "none",
        };
        return (
          <li key={h.title}>
            {h.href
              ? <a href={h.href} target="_blank" rel="noopener noreferrer" style={boxStyle}>{body}</a>
              : <div style={boxStyle}>{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}
