import { useEffect, useRef } from "react";
import { motion, useInView, useSpring, useTransform, useReducedMotion } from "framer-motion";

/**
 * NumberTicker — counts a number up from 0 to `value` when the component
 * enters the viewport. Springs naturally, no easing curve to fight with.
 * Honours prefers-reduced-motion (jumps to final value instantly).
 *
 * Modelled on Magic UI's NumberTicker but inlined to fit the project's
 * inline-styles / no-Tailwind constraint.
 */
export interface NumberTickerProps {
  /** Target number to count up to. */
  value: number;
  /** Approximate seconds for the count to reach `value`. @default 1.2 */
  duration?: number;
  /** Zero-pad the displayed number to this many digits (e.g. 2 → "07"). @default 0 (no padding) */
  padLength?: number;
  /** Inline style for the wrapping span. */
  style?: React.CSSProperties;
  /** Class for the wrapping span. */
  className?: string;
}

export function NumberTicker({ value, duration = 1.2, padLength = 0, style, className }: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduceMotion = useReducedMotion();

  /* Spring with a long settling time so the count feels deliberate, not jumpy. */
  const spring = useSpring(0, {
    stiffness: 60,
    damping: 22,
    mass: 1,
    duration: duration * 1000,
  });

  /* Transform the float into a (optionally zero-padded) integer string. */
  const display = useTransform(spring, (v) => {
    const n = Math.max(0, Math.round(v));
    return padLength > 0 ? String(n).padStart(padLength, "0") : String(n);
  });

  useEffect(() => {
    if (reduceMotion) {
      /* Reduced-motion: jump straight to final value. */
      spring.jump(value);
      return;
    }
    if (inView) spring.set(value);
  }, [inView, value, spring, reduceMotion]);

  return (
    <motion.span ref={ref} className={className} style={style}>
      {display}
    </motion.span>
  );
}

export default NumberTicker;
