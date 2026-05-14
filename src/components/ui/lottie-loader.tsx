import { DotLottieReact } from "@lottiefiles/dotlottie-react";

interface LottieLoaderProps {
  /** Render as a full-viewport overlay (e.g. initial app boot / route transition). @default false */
  fullScreen?: boolean;
  /** Pixel size of the Lottie animation. @default 200 */
  size?: number;
  /** Optional caption below the animation. Pass null to hide. @default "Loading…" */
  label?: string | null;
}

/**
 * LottieLoader — reusable loading state using the placeholder cat Lottie
 * from the 21st.dev demo (lottie.host). Swap `src` for a badminton-themed
 * Lottie when one is sourced; everything else stays the same.
 *
 * Use `fullScreen` for initial app boot or route changes; use the inline
 * variant inside a panel when only a part of the UI is loading.
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
        gap: 12,
        zIndex: 9999,
      }
    : {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 40,
      };

  return (
    <div style={wrapperStyle} role="status" aria-live="polite">
      <div style={{ width: size, height: size }}>
        <DotLottieReact
          src="https://lottie.host/8cf4ba71-e5fb-44f3-8134-178c4d389417/0CCsdcgNIP.json"
          loop
          autoplay
        />
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
