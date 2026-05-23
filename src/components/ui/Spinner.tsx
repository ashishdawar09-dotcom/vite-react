// Small inline SVG spinner — rotation driven by a global @keyframes rule in
// src/index.css so the component works even before framer-motion's chunk
// has loaded (auth screens, error states, fallback UIs).
//
// Sizing follows the standard scale used elsewhere in the design system:
//   sm = 14px (inside small buttons / chips)
//   md = 18px (inside primary CTAs)
//   lg = 28px (centered card-level loading)

type Size = "sm" | "md" | "lg";

const SIZE_PX: Record<Size, number> = { sm: 14, md: 18, lg: 28 };

export function Spinner({
  size = "md",
  color = "currentColor",
  label,
}: {
  size?: Size;
  color?: string;
  label?: string;
}) {
  const px = SIZE_PX[size];
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 50 50"
      style={{ animation: "spin 0.85s linear infinite", flexShrink: 0 }}
      role={label ? "img" : "presentation"}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="25" cy="25" r="20" fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={5} />
      <path d="M25 5 a20 20 0 0 1 20 20" fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" />
    </svg>
  );
}
