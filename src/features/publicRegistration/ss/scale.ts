// Named text styles, spacing, radius and motion for the capacity meter and
// the "we're full" page, in the Shuttle Storm typefaces (Archivo for words,
// JetBrains Mono only for counts). Sizes sit on the Tailwind type scale with
// its paired line heights; spacing and radius come from fixed steps.

import type { CSSProperties } from "react";
import { ss } from "./theme";

// Spacing steps (px). Nothing between them.
export const space = {
  0: 0, 25: 2, 50: 4, 75: 8, 100: 12, 200: 16, 300: 24, 400: 32, 500: 40, 600: 48, 700: 64, 800: 80, 900: 96,
} as const;

// Radius steps (px): Tailwind's scale.
export const radius = { none: 0, sm: 2, base: 4, md: 6, lg: 8, xl: 12, "2xl": 16, "3xl": 24, full: 9999 } as const;

// lineHeight: px, or "1" for the display steps (48 px and up), as on the scale.
const style = (size: number, lineHeight: number | "1", weight: number, mono = false): CSSProperties => ({
  fontFamily: mono ? ss.mono : ss.display,
  fontSize: size,
  lineHeight: lineHeight === "1" ? 1 : `${lineHeight}px`,
  fontWeight: weight,
  ...(mono ? { fontVariantNumeric: "tabular-nums", letterSpacing: 0 } : {}),
});

export const type = {
  heading1: { ...style(60, "1", 600), letterSpacing: "-0.03em" },
  heading2: { ...style(48, "1", 600), letterSpacing: "-0.03em" },
  heading3: { ...style(36, 40, 600), letterSpacing: "-0.02em" },
  heading4: { ...style(30, 36, 600), letterSpacing: "-0.02em" },
  heading5: { ...style(24, 32, 600), letterSpacing: "-0.01em" },
  heading6: style(20, 28, 600),
  title1: style(20, 28, 500),
  title2: style(18, 28, 500),
  title3: style(16, 24, 500),
  title4: style(14, 20, 500),
  body2: style(16, 24, 500),
  body3: style(16, 24, 400),
  body5: style(14, 20, 500),
  body6: style(14, 20, 400),
  buttonMd: style(16, 24, 600),
  buttonSm: style(14, 20, 600),
  caption2: style(14, 20, 400),
  caption5: style(12, 16, 400),
  // Counts and measurements: mono with tabular figures.
  count1: style(60, "1", 500, true),
  count2: style(48, "1", 500, true),
  countCaption: style(12, 16, 400, true),
  countBody: style(14, 20, 500, true),
} satisfies Record<string, CSSProperties>;

// Motion: weighted, decelerating. 500 ms for movement, 300 ms for colour and
// opacity.
export const ease = [0.22, 1, 0.36, 1] as const;
export const easeCss = "cubic-bezier(0.22, 1, 0.36, 1)";
