// Shuttle Storm tokens for the registration form (see parts.tsx).

export const ss = {
  ink: "#06080D",
  ink2: "#0C1018",
  panel: "rgba(236, 238, 242, .035)",
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
  display: "'Archivo', 'Helvetica Neue', Arial, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, Menlo, monospace",
} as const;

export const monoLabel: React.CSSProperties = {
  fontFamily: ss.mono,
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: ".16em",
  textTransform: "uppercase",
  color: ss.mute,
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 54,
  padding: "0 16px",
  borderRadius: 14,
  border: `1px solid ${ss.line}`,
  background: ss.ink2,
  color: ss.bone,
  fontFamily: ss.display,
  fontSize: 17, // 16+ keeps iOS from zooming on focus
};

export function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}
