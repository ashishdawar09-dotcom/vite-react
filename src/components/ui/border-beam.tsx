import { motion, useReducedMotion } from "framer-motion";

/**
 * BorderBeam — animated "comet" sweep around a rectangular border.
 * Uses SVG `strokeDasharray` + animated `strokeDashoffset` so it works
 * across all browsers (no CSS custom-property animation needed).
 *
 * Drop it INSIDE a `position: relative` container that has a border-radius;
 * the SVG fills the container and the visible comet traces the border.
 *
 * Modelled on Magic UI's BorderBeam, inlined to fit the project's no-Tailwind constraint.
 */
export interface BorderBeamProps {
  /** Seconds for one full sweep around the border. @default 4 */
  duration?: number;
  /** Stroke colour. @default "#00d4ff" */
  color?: string;
  /** Stroke width in CSS px (vector-effect non-scaling-stroke preserves this). @default 1.5 */
  strokeWidth?: number;
  /** Border-radius of the host container, in px. Set this to match. @default 8 */
  radius?: number;
}

export function BorderBeam({ duration = 4, color = "#00d4ff", strokeWidth = 1.5, radius = 8 }: BorderBeamProps) {
  const reduceMotion = useReducedMotion();

  /* Total perimeter in viewBox units. 4 sides of length 100 ≈ 400, minus
     a tiny radius-corner adjustment that we ignore visually. */
  const perimeter = 400;
  const segment = 30; // visible length of the comet — bigger = longer comet, dimmer
  const gap = perimeter - segment;

  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        borderRadius: "inherit",
      }}
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
      aria-hidden
    >
      <motion.rect
        x="0.5"
        y="0.5"
        width="99"
        height="99"
        rx={radius / 4 /* scale roughly into viewBox units */}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${segment} ${gap}`}
        vectorEffect="non-scaling-stroke"
        initial={{ strokeDashoffset: 0 }}
        animate={reduceMotion ? { strokeDashoffset: 0 } : { strokeDashoffset: -perimeter }}
        transition={{ duration, repeat: Infinity, ease: "linear" }}
        style={{
          filter: `drop-shadow(0 0 4px ${color})`,
        }}
      />
    </svg>
  );
}

export default BorderBeam;
