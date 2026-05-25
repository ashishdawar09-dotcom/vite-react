import { ShuttleSVG } from "../ui";

interface LottieLoaderProps {
  /** Render as a full-viewport overlay (e.g. initial app boot / route transition). @default false */
  fullScreen?: boolean;
  /** Pixel size of the animation. @default 200 */
  size?: number;
  /** Optional caption below the animation. Pass null to hide. @default "Loading…" */
  label?: string | null;
}

/**
 * Loader — broadcast-aesthetic spinner used across the app during boot,
 * lazy-chunk Suspense fallbacks, and tournament-data refetches.
 *
 * History: this used to render an animated cat Lottie from lottie.host (37 KB
 * gzipped on the critical path because the Suspense fallback paints early in
 * boot). The cat was cute but broke the broadcast aesthetic and ate ~83% of
 * the lottie chunk budget. Replaced with a hand-rolled SVG ring + ShuttleSVG
 * combo that's ~0.5 KB inlined.
 *
 * The export name stays `LottieLoader` so call sites don't need to change;
 * the file/identifier are kept for git-history continuity.
 *
 * Animation runs via CSS keyframes (`spinner-ring` in src/index.css) so it
 * doesn't depend on framer-motion being loaded yet — important because this
 * component renders during the initial Suspense fallback before the motion
 * chunk has parsed.
 */
export function LottieLoader({ fullScreen = false, size = 200, label = "Loading…" }: LottieLoaderProps) {
  const wrapperStyle: React.CSSProperties = fullScreen
    ? {
        position: "fixed",
        inset: 0,
        background: "#070F1F",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        zIndex: 9999,
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }
    : {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 40,
      };

  // The visual is sized in proportion to `size` so callers can ask for an
  // inline 80px loader or a full-screen 200px one without weird empty space.
  const ringStroke = Math.max(3, Math.round(size * 0.022));
  const shuttleSize = Math.round(size * 0.42);

  return (
    <div style={wrapperStyle} role="status" aria-live="polite">
      <div
        style={{
          position: "relative",
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Dim background ring — communicates "this is a track" so the arc
            looks like it's running on something. */}
        <svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          style={{ position: "absolute", inset: 0 }}
          aria-hidden="true"
        >
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="rgba(0, 212, 255, 0.08)"
            strokeWidth={ringStroke}
          />
        </svg>

        {/* Bright animated arc — rotates 360° via CSS keyframe. The dasharray
            shows ~28% of the circumference (276 full circumference ≈ 78 dash). */}
        <svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          style={{
            position: "absolute",
            inset: 0,
            transformOrigin: "50% 50%",
            animation: "spinner-ring 1.2s linear infinite",
            // GPU-accelerate the rotation so it stays smooth on iOS Safari
            // even when the JS thread is busy doing the lazy-chunk parse
            // this loader is covering for.
            willChange: "transform",
          }}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="spinner-ring-gradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#00d4ff" stopOpacity="1" />
              <stop offset="100%" stopColor="#0066ff" stopOpacity="0.4" />
            </linearGradient>
          </defs>
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="url(#spinner-ring-gradient)"
            strokeWidth={ringStroke}
            strokeLinecap="round"
            strokeDasharray="78 280"
          />
        </svg>

        {/* Static shuttlecock in the center — on-brand badge. */}
        <ShuttleSVG sz={shuttleSize} color="#fff" opacity={0.95} />
      </div>

      {label && (
        <p
          className="font-display"
          style={{
            margin: 0,
            color: "#94a3b8",
            fontSize: 12,
            letterSpacing: 2,
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          {label}
        </p>
      )}
    </div>
  );
}
