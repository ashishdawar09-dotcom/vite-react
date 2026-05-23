import { lazy, Suspense } from "react";

// ParticleTextEffect is heavy (canvas animation loop) so it stays lazy
// — its own chunk only loads when this footer mounts.
const ParticleTextEffect = lazy(() =>
  import("./ui/particle-text-effect").then((m) => ({ default: m.ParticleTextEffect })),
);

// Branded particle-canvas footer used by the admin/spectator shell. The
// fallback is a zero-content spacer at the canvas's natural height so the
// page doesn't shift when the chunk arrives.
export function AppFooter() {
  return (
    <footer
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        // Top 8, side = max(safe-area, 16), bottom = safe-area + 8.
        // Side insets cover iPad landscape; bottom inset clears the iOS
        // home indicator so the canvas isn't cropped.
        padding:
          "8px max(env(safe-area-inset-right, 0px), 16px) calc(env(safe-area-inset-bottom, 0px) + 8px) max(env(safe-area-inset-left, 0px), 16px)",
        background: "#050d1a",
        borderTop: "1px solid #1a3050",
      }}
    >
      <Suspense fallback={<div style={{ height: 110, width: "100%" }} />}>
        <ParticleTextEffect
          words={["Built by Ashish Dawar"]}
          width={800}
          height={110}
          fontSize={36}
          color="#00d4ff"
          pixelSteps={4}
          pointSize={2}
          backgroundFade="rgba(5, 13, 26, 0.1)"
        />
      </Suspense>
    </footer>
  );
}
