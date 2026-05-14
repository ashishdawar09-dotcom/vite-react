import { motion } from "framer-motion";
import React, { useEffect, useRef } from "react";

/**
 * AnimatedGradientBackground
 *
 * Customizable animated radial gradient with an optional breathing effect.
 * Adapted from a 21st.dev component — original used Tailwind classes;
 * this version uses inline styles to match the project's styling constraint.
 *
 * - Outer motion.div: entrance fade + scale via framer-motion
 * - Inner div: receives a JS-driven `background: radial-gradient(...)` on every animation frame
 */

interface AnimatedGradientBackgroundProps {
  /** Initial size of the radial gradient, defining the starting width. @default 110 */
  startingGap?: number;

  /** Enables or disables the breathing animation effect. @default false */
  Breathing?: boolean;

  /**
   * Array of colors for the radial gradient. Must be the same length as `gradientStops`.
   * @default ["#0A0A0A", "#2979FF", "#FF80AB", "#FF6D00", "#FFD600", "#00E676", "#3D5AFE"]
   */
  gradientColors?: string[];

  /** Stop percentages (0-100) per color. Must match `gradientColors` length. @default [35, 50, 60, 70, 80, 90, 100] */
  gradientStops?: number[];

  /** Speed of the breathing animation. Lower = slower. @default 0.02 */
  animationSpeed?: number;

  /** Breathing amplitude in percentage points around `startingGap`. @default 5 */
  breathingRange?: number;

  /** Extra inline styles for the inner gradient container. @default {} */
  containerStyle?: React.CSSProperties;

  /** Extra class names for the outer wrapper (kept for API parity; unused in inline-only projects). @default "" */
  containerClassName?: string;

  /** Additional top offset for the gradient. @default 0 */
  topOffset?: number;
}

const AnimatedGradientBackground: React.FC<AnimatedGradientBackgroundProps> = ({
  startingGap = 125,
  Breathing = false,
  gradientColors = [
    "#0A0A0A",
    "#2979FF",
    "#FF80AB",
    "#FF6D00",
    "#FFD600",
    "#00E676",
    "#3D5AFE",
  ],
  gradientStops = [35, 50, 60, 70, 80, 90, 100],
  animationSpeed = 0.02,
  breathingRange = 5,
  containerStyle = {},
  topOffset = 0,
  containerClassName = "",
}) => {
  if (gradientColors.length !== gradientStops.length) {
    throw new Error(
      `gradientColors and gradientStops must have the same length. ` +
        `Received gradientColors length: ${gradientColors.length}, gradientStops length: ${gradientStops.length}`
    );
  }

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let animationFrame: number;
    let width = startingGap;
    let directionWidth = 1;

    const animateGradient = () => {
      if (width >= startingGap + breathingRange) directionWidth = -1;
      if (width <= startingGap - breathingRange) directionWidth = 1;

      if (!Breathing) directionWidth = 0;
      width += directionWidth * animationSpeed;

      const gradientStopsString = gradientStops
        .map((stop, index) => `${gradientColors[index]} ${stop}%`)
        .join(", ");

      const gradient = `radial-gradient(${width}% ${width + topOffset}% at 50% 20%, ${gradientStopsString})`;

      if (containerRef.current) {
        containerRef.current.style.background = gradient;
      }

      animationFrame = requestAnimationFrame(animateGradient);
    };

    animationFrame = requestAnimationFrame(animateGradient);

    return () => cancelAnimationFrame(animationFrame);
  }, [
    startingGap,
    Breathing,
    gradientColors,
    gradientStops,
    animationSpeed,
    breathingRange,
    topOffset,
  ]);

  return (
    <motion.div
      key="animated-gradient-background"
      initial={{ opacity: 0, scale: 1.5 }}
      animate={{
        opacity: 1,
        scale: 1,
        transition: { duration: 2, ease: [0.25, 0.1, 0.25, 1] },
      }}
      /* MAKEOVER: Tailwind `absolute inset-0 overflow-hidden` -> inline styles */
      className={containerClassName || undefined}
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    >
      <div
        ref={containerRef}
        /* MAKEOVER: Tailwind `absolute inset-0 transition-transform` -> inline.
           Drop transition-transform — JS animation drives `background`, not transform. */
        style={{ position: "absolute", inset: 0, ...containerStyle }}
      />
    </motion.div>
  );
};

export default AnimatedGradientBackground;
