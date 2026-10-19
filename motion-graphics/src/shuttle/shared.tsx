import React from "react";
import { Easing, Img, interpolate, staticFile } from "remotion";
import { loadFont } from "@remotion/fonts";
import measurements from "../../public/research/measurements.json";

// Shared pieces for the Shuttle Storm videos. Clean-dark world (neutral
// charcoal, flat volt accents, no glow), the site's own type, real site
// screenshots (430 CSS px wide at 3x) and their measured positions.

export const m = measurements;

export const ARCHIVO = "Archivo";
export const MONO = "JetBrains Mono";
loadFont({
  family: ARCHIVO,
  url: staticFile("fonts/Archivo-latin-variable.woff2"),
  weight: "100 900",
  stretch: "62% 125%",
});
loadFont({
  family: MONO,
  url: staticFile("fonts/JetBrainsMono-latin-variable.woff2"),
  weight: "100 800",
});

// Site tokens (page.css) plus the clean-dark world behind the site surfaces.
export const WORLD = "#101218";
export const SITE_INK = "#06080D";
export const VOLT = "#D4FF3A";
export const BONE = "#ECEEF2";
export const MUTE = "#8F97A8";
export const LINE = "rgba(236, 238, 242, 0.12)";

export const FPS = 30;
export const CSS_W = 430;

export const ease = Easing.inOut(Easing.cubic);
export const easeOut = Easing.out(Easing.cubic);
export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

export const ramp = (frame: number, from: number, to: number, easing = ease) =>
  interpolate(frame, [from, to], [0, 1], { ...clamp, easing });

// Camera over a world larger than the frame: keyframed focal point and zoom.
export const cameraAt = (
  frame: number,
  keys: { t: number; x: number; y: number; z: number }[],
) => {
  const t = keys.map((k) => k.t);
  const opts = { ...clamp, easing: ease };
  return {
    x: interpolate(frame, t, keys.map((k) => k.x), opts),
    y: interpolate(frame, t, keys.map((k) => k.y), opts),
    z: interpolate(frame, t, keys.map((k) => k.z), opts),
  };
};

export const World: React.FC<{
  cam: { x: number; y: number; z: number };
  width: number;
  height: number;
  children: React.ReactNode;
}> = ({ cam, width, height, children }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      top: 0,
      transform: `translate(${width / 2 - cam.x}px, ${height / 2 - cam.y}px) scale(${cam.z})`,
      transformOrigin: `${cam.x}px ${cam.y}px`,
    }}
  >
    {children}
  </div>
);

// A band of a real site screenshot, shown at `scale` world px per CSS px.
// `top`/`height` pick the band in CSS px; overlays are positioned in the same
// CSS px (relative to the band) inside a scaled layer.
export const SiteCrop: React.FC<{
  file: string;
  imageHeight: number;
  top?: number;
  height: number;
  scale: number;
  x: number;
  y: number;
  radius?: number;
  children?: React.ReactNode;
}> = ({ file, imageHeight, top = 0, height, scale, x, y, radius = 28, children }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: CSS_W * scale,
      height: height * scale,
      overflow: "hidden",
      borderRadius: radius,
      backgroundColor: SITE_INK,
      boxShadow: `inset 0 0 0 1.5px ${LINE}`,
    }}
  >
    <div
      style={{
        position: "absolute",
        left: 0,
        top: -top * scale,
        width: CSS_W,
        height: imageHeight,
        transform: `scale(${scale})`,
        transformOrigin: "0 0",
      }}
    >
      <Img
        src={staticFile(`research/${file}.png`)}
        style={{ position: "absolute", width: CSS_W, height: imageHeight }}
      />
      {children}
    </div>
  </div>
);

type Rect = { x: number; y: number; w: number; h: number };

// A flat volt underline drawn across one or more measured text lines, in order.
export const Underline: React.FC<{
  lines: Rect[];
  progress: number;
  offsetY?: number;
  thickness?: number;
}> = ({ lines, progress, offsetY = 0, thickness = 2 }) => {
  const total = lines.reduce((a, l) => a + l.w, 0);
  let done = 0;
  return (
    <>
      {lines.map((l, i) => {
        const share = Math.min(1, Math.max(0, (progress * total - done) / l.w));
        done += l.w;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: l.x,
              top: l.y + l.h + 1 - offsetY,
              width: l.w * share,
              height: thickness,
              backgroundColor: VOLT,
            }}
          />
        );
      })}
    </>
  );
};

// Headline lines in the site's display style, each rising out of its own mask.
export const RevealLines: React.FC<{
  lines: { text: string; color?: string }[];
  progress: number[];
  size: number;
  weight?: number;
  stretch?: string;
  font?: string;
  tracking?: string;
  lineHeight?: number;
}> = ({
  lines,
  progress,
  size,
  weight = 800,
  stretch = "125%",
  font = ARCHIVO,
  tracking = "-0.01em",
  lineHeight = 0.98,
}) => (
  <div>
    {lines.map((l, i) => (
      <div key={i} style={{ overflow: "hidden", paddingBottom: size * 0.06 }}>
        <div
          style={{
            transform: `translateY(${(1 - (progress[i] ?? 1)) * 110}%)`,
            fontFamily: font,
            fontWeight: weight,
            fontStretch: stretch,
            fontSize: size,
            lineHeight,
            letterSpacing: tracking,
            textTransform: "uppercase",
            color: l.color ?? BONE,
            whiteSpace: "nowrap",
          }}
        >
          {l.text}
        </div>
      </div>
    ))}
  </div>
);

export const Mono: React.FC<{
  children: React.ReactNode;
  size: number;
  color?: string;
  tracking?: string;
}> = ({ children, size, color = MUTE, tracking = "0.18em" }) => (
  <div
    style={{
      fontFamily: MONO,
      fontWeight: 500,
      fontSize: size,
      letterSpacing: tracking,
      textTransform: "uppercase",
      color,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </div>
);

// End card lockup in the style of the site's own film: the mark, SHUTTLE in
// bone over STORM in volt, heavy and wide, with the mono date line under it.
export const Lockup: React.FC<{ size: number; dateLine?: boolean }> = ({
  size,
  dateLine = true,
}) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.28 }}>
      <Img
        src={staticFile("research/shuttle-storm-mark.svg")}
        style={{ width: size * 1.7, height: size * 1.7 }}
      />
      <div
        style={{
          fontFamily: ARCHIVO,
          fontWeight: 900,
          fontStretch: "125%",
          fontSize: size,
          lineHeight: 0.9,
          textTransform: "uppercase",
        }}
      >
        <div style={{ color: BONE }}>Shuttle</div>
        <div style={{ color: VOLT }}>Storm</div>
      </div>
    </div>
    {dateLine ? (
      <div style={{ marginTop: size * 0.5, display: "flex", gap: size * 0.22, alignItems: "center" }}>
        {["Nov 21 2026", "UFV North Gym", "Abbotsford BC"].map((t, i) => (
          <React.Fragment key={t}>
            {i > 0 ? (
              <div style={{ width: size * 0.06, height: size * 0.06, borderRadius: size, backgroundColor: VOLT }} />
            ) : null}
            <Mono size={size * 0.22} color={BONE}>
              {t}
            </Mono>
          </React.Fragment>
        ))}
      </div>
    ) : null}
  </div>
);
