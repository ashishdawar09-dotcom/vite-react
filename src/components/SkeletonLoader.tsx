import { motion, useReducedMotion } from "framer-motion";

/**
 * MAKEOVER: skeleton shimmer for Suspense fallbacks. Replaces the bare
 * "Loading…" text shown when MatchesTab and CategoriesTab lazy-load.
 * Three stacked rectangles + a sweeping gradient shimmer over them.
 */
export function SkeletonLoader({ rows = 3 }: { rows?: number }) {
  const reduceMotion = useReducedMotion();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "20px 4px" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            position: "relative",
            height: 64,
            borderRadius: 10,
            background: "#0f1e36",
            border: "1px solid #1a3050",
            overflow: "hidden",
          }}
        >
          {!reduceMotion && (
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: "100%" }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "linear", delay: i * 0.15 }}
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)",
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
