import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";

/**
 * SectionReveal — gentle fade-up reveal when the section enters the viewport.
 * Drop-in wrapper. Honours prefers-reduced-motion (renders children static).
 *
 * Usage:
 *   <SectionReveal delay={0.1}>
 *     <div>my section</div>
 *   </SectionReveal>
 */
export interface SectionRevealProps {
  children: React.ReactNode;
  /** Delay in seconds before the reveal kicks off. @default 0 */
  delay?: number;
  /** Y-axis distance the content travels during the reveal (px). @default 12 */
  yOffset?: number;
  /** Reveal once and stay (true), or every time the section re-enters view (false). @default true */
  once?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function SectionReveal({
  children,
  delay = 0,
  yOffset = 12,
  once = true,
  className,
  style,
}: SectionRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once, amount: 0.15 });
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return <div ref={ref} className={className} style={style}>{children}</div>;
  }

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: yOffset }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: yOffset }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}

export default SectionReveal;
