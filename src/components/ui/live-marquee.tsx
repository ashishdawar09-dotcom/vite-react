import { motion, useReducedMotion } from "framer-motion";

/**
 * LiveMarquee — horizontal scrolling ticker. Items concatenated into a
 * scrolling row; doubled internally so the loop is seamless.
 *
 * Use this for the broadcast-style "🔴 LIVE NOW · Court 1: …" strip at
 * the top of the LIVE tab when matches are in play.
 *
 * Honours prefers-reduced-motion (renders a static, non-scrolling row).
 */
export interface LiveMarqueeProps {
  /** Items to scroll. Each becomes a text run separated by `separator`. */
  items: string[];
  /** Seconds for one full loop. @default 40 (relaxed gym-TV pace) */
  speed?: number;
  /** Separator string between items. @default "  ·  " */
  separator?: string;
  /** Inline style for the outer wrapper. */
  style?: React.CSSProperties;
  /** Class for the outer wrapper. */
  className?: string;
}

export function LiveMarquee({ items, speed = 40, separator = "  ·  ", style, className }: LiveMarqueeProps) {
  const reduceMotion = useReducedMotion();

  if (items.length === 0) return null;

  const text = items.join(separator);

  /* Reduced-motion: render the first ~140 chars statically with no animation. */
  if (reduceMotion) {
    return (
      <div className={className} style={{ overflow: "hidden", whiteSpace: "nowrap", ...style }}>
        <span>{text.substring(0, 140)}{text.length > 140 ? "…" : ""}</span>
      </div>
    );
  }

  return (
    <div className={className} style={{ overflow: "hidden", whiteSpace: "nowrap", ...style }}>
      <motion.div
        style={{ display: "inline-block", whiteSpace: "nowrap", willChange: "transform" }}
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: speed, repeat: Infinity, ease: "linear" }}
      >
        {/* Doubled — first copy + identical second copy with leading separator
           gives a perfect seamless loop when x crosses -50%. */}
        {text}{separator}{text}{separator}
      </motion.div>
    </div>
  );
}

export default LiveMarquee;
