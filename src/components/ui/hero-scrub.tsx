import { useRef } from "react";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";

/**
 * HeroScrub — simplified scroll-driven hero adapted from a 21st.dev GSAP
 * component. This version uses Framer Motion's `useScroll` + `useTransform`
 * (no GSAP dependency, no 300-frame sequence — just one image).
 *
 * Behaviour as the user scrolls through the section:
 *   • Card image scales up smoothly (0.7 → 1.7 of viewport coverage)
 *   • Top title slides off-screen to the left
 *   • Bottom title slides off-screen to the right
 *   • Both titles fade out as the card immerses
 *   • Honours prefers-reduced-motion (renders a static fallback)
 *
 * The section is tall (default 200 vh); the inner element is `position: sticky`
 * so it stays in the viewport while the page scrolls past — same visual as the
 * original component's GSAP pin, but without the pin gymnastics.
 */

export interface HeroScrubProps {
  /** Hero image URL. Single image — no frame sequence. */
  image: string;
  imageAlt?: string;
  /** Top headline (e.g. tournament name). */
  titleTop: string;
  /** Bottom headline (e.g. tagline). */
  titleBottom: string;
  /** Backdrop colour behind the card. Use a brand-deep tone. @default "#070F1F" */
  accentColor?: string;
  /** Image aspect ratio (w / h). @default 16/9 */
  aspect?: number;
  /** Total section height — controls how much scroll the effect plays over. @default "200vh" */
  sectionHeight?: string;
  /** Optional class on the outer section. */
  className?: string;
}

export function HeroScrub({
  image,
  imageAlt = "",
  titleTop,
  titleBottom,
  accentColor = "#070F1F",
  aspect = 16 / 9,
  sectionHeight = "200vh",
  className,
}: HeroScrubProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();

  /* useScroll tracks the section's scroll progress from when its top hits the
     top of the viewport to when its bottom hits the bottom — i.e. 0 → 1 across
     the full sectionHeight of scroll. */
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end end"],
  });

  /* Phase mapping:
     0.00 → 0.40 : card scales from 0.7 → 1.0, titles slide outward
     0.40 → 0.60 : card scales 1.0 → 1.7 (overfill viewport), titles fade out
     0.60 → 1.00 : everything held; user finishes scrolling the tall section */
  const cardScale = useTransform(scrollYProgress, [0, 0.4, 0.6], [0.7, 1.0, 1.7]);
  const titleTopX = useTransform(scrollYProgress, [0, 0.4], ["0vw", "-60vw"]);
  const titleBottomX = useTransform(scrollYProgress, [0, 0.4], ["0vw", "60vw"]);
  const titleOpacity = useTransform(scrollYProgress, [0.35, 0.55], [1, 0]);
  /* Entrance: gentle fade-up from below on first paint. */

  /* Reduced-motion fallback — show the same content statically with no transforms. */
  if (reduceMotion) {
    return (
      <section
        className={className}
        style={{
          position: "relative",
          padding: "40px 16px",
          background: accentColor,
          color: "#fff",
          textAlign: "center",
          overflow: "hidden",
        }}
        aria-label="Tournament hero"
      >
        <h2 style={{
          fontFamily: "'Oswald', 'Inter', sans-serif",
          fontSize: "clamp(2rem, 6vw, 4rem)",
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: "-0.02em",
          lineHeight: 0.9,
          margin: "0 0 16px",
        }}>{titleTop}</h2>
        <div style={{
          maxWidth: "min(96vw, 800px)",
          aspectRatio: aspect,
          margin: "0 auto",
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          <img src={image} alt={imageAlt} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        <h2 style={{
          fontFamily: "'Oswald', 'Inter', sans-serif",
          fontSize: "clamp(2rem, 6vw, 4rem)",
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: "-0.02em",
          lineHeight: 0.9,
          margin: "16px 0 0",
        }}>{titleBottom}</h2>
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      className={className}
      style={{
        position: "relative",
        height: sectionHeight,
        background: accentColor,
        color: "#fff",
        overflow: "clip",
      }}
      aria-label="Cinematic scroll-scrubbed hero"
    >
      {/* Sticky inner — stays in the viewport while the outer section scrolls. */}
      <div style={{
        position: "sticky",
        top: 0,
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}>
        {/* Soft radial spotlight for depth, behind everything */}
        <div aria-hidden style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at 50% 38%, rgba(255,255,255,0.08) 0%, transparent 55%)",
          pointerEvents: "none",
        }} />
        {/* Vignette */}
        <div aria-hidden style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)",
          pointerEvents: "none",
        }} />

        {/* Top title */}
        <motion.h2
          aria-hidden
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          style={{
            x: titleTopX,
            opacity: titleOpacity,
            fontFamily: "'Oswald', 'Inter', sans-serif",
            fontSize: "clamp(3rem, 11vw, 9rem)",
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: "-0.04em",
            lineHeight: 0.85,
            margin: 0,
            textAlign: "center",
            whiteSpace: "nowrap",
            willChange: "transform",
          }}
        >
          {titleTop}
        </motion.h2>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.0, ease: [0.16, 1, 0.3, 1], delay: 0.35 }}
          style={{
            scale: cardScale,
            margin: "clamp(12px, 2vh, 28px) 0",
            width: `min(96vw, calc(60svh * ${aspect}))`,
            height: `min(60svh, 96vw / ${aspect})`,
            aspectRatio: aspect,
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: "0 20px 80px rgba(0,0,0,0.55)",
            border: "1px solid rgba(255,255,255,0.10)",
            willChange: "transform",
            position: "relative",
          }}
        >
          <img
            src={image}
            alt={imageAlt}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
          {/* Inner shadow / inset highlight for depth on the card itself */}
          <div aria-hidden style={{
            position: "absolute",
            inset: 0,
            boxShadow: "inset 0 0 120px rgba(0,0,0,0.45)",
            pointerEvents: "none",
          }} />
        </motion.div>

        {/* Bottom title */}
        <motion.h2
          aria-hidden
          initial={{ opacity: 0, y: -24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.32 }}
          style={{
            x: titleBottomX,
            opacity: titleOpacity,
            fontFamily: "'Oswald', 'Inter', sans-serif",
            fontSize: "clamp(3rem, 11vw, 9rem)",
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: "-0.04em",
            lineHeight: 0.85,
            margin: 0,
            textAlign: "center",
            whiteSpace: "nowrap",
            willChange: "transform",
          }}
        >
          {titleBottom}
        </motion.h2>
      </div>
    </section>
  );
}

export default HeroScrub;
