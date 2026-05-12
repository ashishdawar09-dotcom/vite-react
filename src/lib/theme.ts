// Design tokens — single source of truth for colors, spacing, motion.
// Consumed via inline style={{}} in components: import { colors, motion } from "../lib/theme".
// Global CSS rules (focus rings, prefers-reduced-motion, keyframes) live in src/index.css.

export const colors = {
  bg: {
    // Dark frame — LIVE tab, venue TV, login overlay
    deep: "#070F1F",
    surface: "#0F1A2E",
    elevated: "#172339",
    // Light frame — admin tabs
    page: "#F7F9FC",
    card: "#FFFFFF",
    muted: "#F1F5F9",
  },
  border: {
    dark: "rgba(255, 255, 255, 0.08)",
    darkStrong: "rgba(255, 255, 255, 0.16)",
    light: "#E2E8F0",
    lightStrong: "#CBD5E1",
  },
  text: {
    primaryDark: "#FFFFFF",
    primaryLight: "#0F172A",
    mutedDark: "#94A3B8",
    mutedLight: "#64748B",
    subtleDark: "#64748B",
    subtleLight: "#94A3B8",
  },
  brand: {
    primary: "#3A86FF",
    primaryHover: "#1E5BC8",
    primarySubtle: "rgba(58, 134, 255, 0.16)",
  },
  // Match state machine — DO NOT change semantics.
  state: {
    pending: "#94A3B8",
    pendingSubtle: "rgba(148, 163, 184, 0.12)",
    warming: "#F59E0B",
    warmingSubtle: "rgba(245, 158, 11, 0.16)",
    live: "#EF4444",
    liveSubtle: "rgba(239, 68, 68, 0.16)",
    completed: "#16A34A",
    completedSubtle: "rgba(22, 163, 74, 0.12)",
  },
  // Aurora gradient — restricted to the login CTA only.
  gradient: {
    aurora: "linear-gradient(123deg, #18011F 7%, #B600A8 37%, #7621B0 72%, #BE4C00 100%)",
  },
} as const;

export const radii = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const shadows = {
  // Light-frame elevations (admin tabs)
  sm: "0 1px 2px rgba(15, 23, 42, 0.04)",
  md: "0 1px 3px rgba(15, 23, 42, 0.04), 0 1px 2px rgba(15, 23, 42, 0.06)",
  lg: "0 4px 12px rgba(15, 23, 42, 0.08), 0 2px 4px rgba(15, 23, 42, 0.04)",
  // Dark-frame depth (LIVE tab cards)
  glow: "0 0 0 1px rgba(255, 255, 255, 0.04), 0 8px 24px rgba(0, 0, 0, 0.32)",
  // Focus ring colour token (matches outline used in index.css)
  focus: "0 0 0 3px rgba(58, 134, 255, 0.32)",
} as const;

// Framer Motion easings & spring config.
// Tuples typed for the BezierDefinition shape framer-motion expects.
export const easings = {
  standard: [0.4, 0.0, 0.2, 1] as [number, number, number, number],
  decelerate: [0.0, 0.0, 0.2, 1] as [number, number, number, number],
  accelerate: [0.4, 0.0, 1.0, 1] as [number, number, number, number],
  spring: { type: "spring" as const, stiffness: 260, damping: 20 },
} as const;

export const motion = {
  duration: {
    fast: 0.15,   // hover, tap-feedback
    base: 0.25,   // card entrance, modal
    slow: 0.4,    // multi-step transitions
    pulse: 1.4,   // live-pulse cycle
  },
  // Reusable Framer Motion variants — drop into <motion.div {...motion.fadeUp} />.
  fadeUp: {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.25, ease: [0.4, 0.0, 0.2, 1] as [number, number, number, number] },
  },
  pulse: {
    animate: { opacity: [1, 0.4, 1] },
    transition: { duration: 1.4, repeat: Infinity, ease: "easeInOut" as const },
  },
} as const;

export const typography = {
  body: "'Inter', system-ui, 'Segoe UI', Roboto, sans-serif",
  display: "'Oswald', 'Inter', system-ui, sans-serif",
  // Spread into style={{ ...typography.tabular }} on score/stat numerals.
  tabular: { fontVariantNumeric: "tabular-nums" as const },
} as const;

export const theme = {
  colors,
  radii,
  spacing,
  shadows,
  easings,
  motion,
  typography,
} as const;

export type Theme = typeof theme;
