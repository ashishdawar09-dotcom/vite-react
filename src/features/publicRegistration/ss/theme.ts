// Shuttle Storm tokens for the registration form (see parts.tsx).

// Surfaces are flat and come from one dark palette (#000000, #181818,
// #1F1F1F, #272727, #313131); volt is the one accent.
export const ss = {
  ink: "#000000",
  ink2: "#1F1F1F",
  panel: "#181818",
  bone: "#ECEEF2",
  body: "#C4CAD6",
  mute: "#8F97A8",
  line: "rgba(236, 238, 242, .13)",
  lineStrong: "rgba(236, 238, 242, .24)",
  volt: "#D4FF3A",
  voltSoft: "rgba(212, 255, 58, .07)",
  voltGlow: "0 0 0 1px rgba(212, 255, 58, .9), 0 10px 30px -12px rgba(212, 255, 58, .35)",
  danger: "#FF8A8A",
  dangerSoft: "rgba(255, 138, 138, .08)",
  // One typeface for the form (Geist), Geist Mono only for counts and codes.
  // Archivo stays for the Shuttle Storm wordmark, which is part of the logo.
  display: "'Geist', ui-sans-serif, system-ui, sans-serif",
  mono: "'Geist Mono', ui-monospace, Menlo, monospace",
  brand: "'Archivo', ui-sans-serif, system-ui, sans-serif",
} as const;

// Field labels and small headings: Caption, sentence case.
export const monoLabel: React.CSSProperties = {
  fontFamily: ss.display,
  fontSize: 14,
  lineHeight: "20px",
  fontWeight: 500,
  color: ss.mute,
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 48,
  padding: "0 16px",
  borderRadius: 12,
  border: `1px solid ${ss.line}`,
  background: ss.ink2,
  color: ss.bone,
  fontFamily: ss.display,
  fontSize: 16, // 16+ keeps iOS from zooming on focus
  lineHeight: "24px",
};

export function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}
