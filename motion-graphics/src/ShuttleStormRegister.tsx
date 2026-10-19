import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { loadFont } from "@remotion/fonts";

// Shuttle Storm ’26 — one tap on Categories opens eleven events, juniors to
// masters; entries close Nov 18. 9:16, warm-light world, tsenta-one-click-wall
// mechanism. Every surface is a real screenshot of shuttlestorm-site/public at
// 430 CSS px (3x) and every overlay position is measured from the DOM; the end
// wall is the page's own table rows, scaled up, never re-typed.

// The site's own typefaces, bundled locally (OFL) so renders work offline.
const ARCHIVO = "Archivo";
const MONO = "JetBrains Mono";
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

export const FPS = 30;
export const DURATION = 210;
export const WIDTH = 1080;
export const HEIGHT = 1920;

const PAPER = "#F3EEE4";
const INK = "#1B1A17";
const MUTED = "#6F6A60";
const DEVICE = "#14161B";
const SITE_INK = "#06080D";
const VOLT = "#D4FF3A";

// Phone geometry (world px). The screen shows a 430×932 CSS viewport.
const CSS_W = 430;
const CSS_H = 932;
const SCR_W = 600;
const K = SCR_W / CSS_W;
const SCR_H = CSS_H * K;
const BEZ = 20;
const PHONE_W = SCR_W + BEZ * 2;
const PHONE_H = SCR_H + BEZ * 2;
// The final camera is the identity, so world px equal frame px at the end.
const PHONE = { x: (WIDTH - PHONE_W) / 2, y: (HEIGHT - PHONE_H) / 2 };
const SCREEN = { x: PHONE.x + BEZ, y: PHONE.y + BEZ };

// Measured DOM rects (CSS px).
// Menu link "05 Categories" → /categories; its text spans x 56–299, y 321–367.
const MENU_TEXT = { x: 54, y: 322, w: 250, h: 44 };
const CATEGORIES_PAGE_H = 2424;
const TABLE_X = 17.2;
const TABLE_W = 395.6;
// Row crops keep 10 CSS px of page margin each side so the marker sits beside the text.
const CROP_X = TABLE_X - 10;
const CROP_W = TABLE_W + 20;
const CATS_SCROLL = 360;
// [top, height, group] for the eleven rows: Juniors, Youth, Adults, Masters.
const ROWS: [number, number, number][] = [
  [426.1, 45.75, 0],
  [471.8, 45.75, 0],
  [517.6, 45.75, 1],
  [563.3, 45.75, 1],
  [609.1, 70.5, 1],
  [679.6, 70.5, 1],
  [750.1, 45.75, 2],
  [795.8, 70.5, 2],
  [866.3, 70.5, 2],
  [936.8, 70.5, 2],
  [1007.3, 70.5, 3],
];
// Register page eyebrow: "Entries close 11:59 pm, Wednesday, / November 18, 2026".
const DEADLINE_CROP = { y: 148, h: 50 };
const DEADLINE_LINES = [
  { y: 168.5, x0: 17.2, x1: 333 },
  { y: 187.5, x0: 17.2, x1: 175 },
];

// End-frame layout (frame px).
const WALL_S = 2.2;
const WALL_W = CROP_W * WALL_S;
const MARGIN = (WIDTH - WALL_W) / 2;
const GROUP_GAP = 22;
const LOCKUP_Y = 44;
const WALL_Y = 160;
const wallTops: number[] = [];
{
  let y = WALL_Y;
  ROWS.forEach(([, h, g], i) => {
    if (i > 0 && g !== ROWS[i - 1][2]) y += GROUP_GAP;
    wallTops.push(y);
    y += h * WALL_S;
  });
}
const WALL_BOTTOM = wallTops[10] + ROWS[10][1] * WALL_S;
const DEADLINE_S = 2.65;
const DEADLINE_Y = WALL_BOTTOM + 24;

const ease = Easing.inOut(Easing.cubic);
const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

const tap = {
  x: SCREEN.x + (MENU_TEXT.x + MENU_TEXT.w * 0.55) * K,
  y: SCREEN.y + (MENU_TEXT.y + MENU_TEXT.h / 2) * K,
};
const linkFocus = {
  x: SCREEN.x + (MENU_TEXT.x + MENU_TEXT.w / 2) * K,
  y: tap.y,
};
const scanFocusY = (PHONE.y - 96 + SCREEN.y + (ROWS[10][0] + ROWS[10][1] - CATS_SCROLL) * K) / 2 + 20;

// Camera: hold → travel → hold. Repeated keys are holds.
const KEY_T = [0, 18, 36, 76, 104, DURATION];
const KEY_X = [linkFocus.x, linkFocus.x, WIDTH / 2, WIDTH / 2, WIDTH / 2, WIDTH / 2];
const KEY_Y = [linkFocus.y, linkFocus.y, scanFocusY, scanFocusY, HEIGHT / 2, HEIGHT / 2];
const KEY_Z = [2.9, 2.9, 1.5, 1.5, 1, 1];

export const ShuttleStormRegister: React.FC = () => {
  const frame = useCurrentFrame();

  const fx = interpolate(frame, KEY_T, KEY_X, { ...clamp, easing: ease });
  const fy = interpolate(frame, KEY_T, KEY_Y, { ...clamp, easing: ease });
  const z = interpolate(frame, KEY_T, KEY_Z, { ...clamp, easing: ease });

  // A touch lands on the real "05 Categories" link; the site's :active state
  // (menu.js: a:active{color:#D4FF3A}) turns its text volt.
  const touchIn = interpolate(frame, [3, 9], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const pressed = interpolate(frame, [9, 12, 16, 19], [0, 1, 1, 0], clamp);
  const touchOut = interpolate(frame, [17, 21], [1, 0], clamp);
  const active = frame >= 11 && frame < 20 ? 1 : 0;

  // The link navigates: a clean cut to /categories, which scrolls to its table.
  const onCategories = frame >= 20;
  const scroll = interpolate(frame, [22, 38], [0, CATS_SCROLL], { ...clamp, easing: ease });

  // A flat volt bar marks each of the eleven real rows; the counter follows it.
  const ROW_START = 40;
  const ROW_STEP = 2.6;
  const markedAt = (i: number) =>
    interpolate(frame, [ROW_START + i * ROW_STEP, ROW_START + i * ROW_STEP + 3], [0, 1], clamp);
  const rowsDone = Math.max(1, Math.min(11, Math.floor((frame - ROW_START) / ROW_STEP) + 1));

  // The rows lift out of the page together (no overlap) and scale up into the
  // wall; the emptied phone drops away beneath them. Marker bars retract.
  const lift = interpolate(frame, [78, 104], [0, 1], { ...clamp, easing: ease });
  const markerKeep = interpolate(frame, [104, 116], [1, 0], { ...clamp, easing: ease });
  const phoneDrop = interpolate(frame, [80, 100], [0, 2300], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  });

  // Lockup slides down into frame, the deadline card slides up, both opaque.
  const lockupIn = interpolate(frame, [96, 112], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const deadlineIn = interpolate(frame, [104, 120], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const line1 = interpolate(frame, [122, 134], [0, 1], { ...clamp, easing: ease });
  const line2 = interpolate(frame, [132, 140], [0, 1], { ...clamp, easing: ease });

  const s = interpolate(lift, [0, 1], [K, WALL_S]);

  return (
    <AbsoluteFill style={{ backgroundColor: PAPER, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transform: `translate(${WIDTH / 2 - fx}px, ${HEIGHT / 2 - fy}px) scale(${z})`,
          transformOrigin: `${fx}px ${fy}px`,
        }}
      >
        {/* Identity lockup in the site's brand style (600, 125% wide, .14em). */}
        <div
          style={{
            position: "absolute",
            left: MARGIN,
            top: interpolate(lockupIn, [0, 1], [-200, LOCKUP_Y]),
            display: "flex",
            alignItems: "center",
            gap: 22,
          }}
        >
          <Img src={staticFile("research/shuttle-storm-mark.svg")} style={{ width: 76, height: 76 }} />
          <div
            style={{
              fontFamily: ARCHIVO,
              fontWeight: 600,
              fontStretch: "125%",
              fontSize: 38,
              letterSpacing: "0.14em",
              color: INK,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            Shuttle Storm ’26
          </div>
        </div>

        {/* Counter on the paper, tied to the row marker; it settles beside the lockup. */}
        <div
          style={{
            position: "absolute",
            left: interpolate(lift, [0, 1], [SCREEN.x + CROP_X * K, WIDTH - MARGIN]),
            top: interpolate(lift, [0, 1], [PHONE.y - 96, LOCKUP_Y + 14]),
            transform: `translateX(${-100 * lift}%)`,
            fontFamily: MONO,
            fontWeight: 500,
            color: INK,
            display: "flex",
            alignItems: "baseline",
            gap: 16,
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
            opacity: interpolate(frame, [ROW_START - 4, ROW_START + 2], [0, 1], clamp),
          }}
        >
          <span style={{ fontSize: 56, lineHeight: 1 }}>{String(rowsDone).padStart(2, "0")}</span>
          <span style={{ fontSize: 28, letterSpacing: "0.16em", color: MUTED }}>
            {lift < 0.5 ? "/ 11 CATEGORIES" : "/ 11"}
          </span>
        </div>

        {/* The phone: menu → categories page. */}
        <div
          style={{
            position: "absolute",
            left: PHONE.x,
            top: PHONE.y,
            width: PHONE_W,
            height: PHONE_H,
            borderRadius: 72,
            backgroundColor: DEVICE,
            transform: `translateY(${phoneDrop}px)`,
            boxShadow: "0 40px 80px rgba(40, 32, 20, 0.16), 0 8px 18px rgba(40, 32, 20, 0.12)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: BEZ,
              top: BEZ,
              width: SCR_W,
              height: SCR_H,
              borderRadius: 54,
              overflow: "hidden",
              backgroundColor: SITE_INK,
            }}
          >
            <div
              style={{
                position: "absolute",
                width: CSS_W,
                height: CSS_H,
                transform: `scale(${K})`,
                transformOrigin: "0 0",
              }}
            >
              {onCategories ? (
                lift > 0 ? null : (
                  <div
                    style={{
                      position: "absolute",
                      width: CSS_W,
                      height: CATEGORIES_PAGE_H,
                      transform: `translateY(${-scroll}px)`,
                    }}
                  >
                    <Img
                      src={staticFile("research/site-categories.png")}
                      style={{ width: CSS_W, height: CATEGORIES_PAGE_H, display: "block" }}
                    />
                    {ROWS.map(([top, h], i) => (
                      <div
                        key={i}
                        style={{
                          position: "absolute",
                          left: CROP_X + 2,
                          top: top + 8,
                          width: 3,
                          height: (h - 16) * markedAt(i),
                          backgroundColor: VOLT,
                        }}
                      />
                    ))}
                  </div>
                )
              ) : (
                <>
                  <Img
                    src={staticFile("research/site-menu.png")}
                    style={{ position: "absolute", width: CSS_W, height: CSS_H }}
                  />
                  {/* :active — the white link text turns volt (multiply keeps the ink black). */}
                  <div
                    style={{
                      position: "absolute",
                      left: MENU_TEXT.x,
                      top: MENU_TEXT.y,
                      width: MENU_TEXT.w,
                      height: MENU_TEXT.h,
                      backgroundColor: VOLT,
                      mixBlendMode: "multiply",
                      opacity: active,
                    }}
                  />
                </>
              )}
            </div>
          </div>
        </div>

        {/* The real rows, lifted out and scaled up into the grouped wall. */}
        {lift > 0
          ? ROWS.map(([top, h, g], i) => {
              const first = i === 0 || ROWS[i - 1][2] !== g;
              const last = i === 10 || ROWS[i + 1][2] !== g;
              const r = 18 * lift;
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: interpolate(lift, [0, 1], [SCREEN.x + CROP_X * K, MARGIN]),
                    top: interpolate(lift, [0, 1], [SCREEN.y + (top - CATS_SCROLL) * K, wallTops[i]]),
                    width: CROP_W * s,
                    height: h * s,
                    overflow: "hidden",
                    backgroundColor: SITE_INK,
                    borderTopLeftRadius: first ? r : 0,
                    borderTopRightRadius: first ? r : 0,
                    borderBottomLeftRadius: last ? r : 0,
                    borderBottomRightRadius: last ? r : 0,
                  }}
                >
                  <Img
                    src={staticFile("research/site-categories.png")}
                    style={{
                      position: "absolute",
                      left: -CROP_X * s,
                      top: -top * s,
                      width: CSS_W * s,
                      height: CATEGORIES_PAGE_H * s,
                      maxWidth: "none",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: 2 * s,
                      top: 8 * s,
                      width: 3 * s,
                      height: (h - 16) * s * markerKeep,
                      backgroundColor: VOLT,
                    }}
                  />
                </div>
              );
            })
          : null}

        {/* The register page's own deadline line, scaled up, with a flat volt underline. */}
        <div
          style={{
            position: "absolute",
            left: MARGIN,
            top: interpolate(deadlineIn, [0, 1], [HEIGHT + 60, DEADLINE_Y]),
            width: WALL_W,
            height: (DEADLINE_CROP.h + 10) * DEADLINE_S,
            borderRadius: 18,
            overflow: "hidden",
            backgroundColor: SITE_INK,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: -(TABLE_X - 12) * DEADLINE_S,
              top: 5 * DEADLINE_S,
              width: CSS_W * DEADLINE_S,
              height: DEADLINE_CROP.h * DEADLINE_S,
              overflow: "hidden",
            }}
          >
            <Img
              src={staticFile("research/site-register.png")}
              style={{
                position: "absolute",
                left: 0,
                top: -DEADLINE_CROP.y * DEADLINE_S,
                width: CSS_W * DEADLINE_S,
                height: CSS_H * DEADLINE_S,
                maxWidth: "none",
              }}
            />
            {DEADLINE_LINES.map((l, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: l.x0 * DEADLINE_S,
                  top: (l.y - DEADLINE_CROP.y) * DEADLINE_S,
                  height: 1.4 * DEADLINE_S,
                  width: (l.x1 - l.x0) * DEADLINE_S * (i === 0 ? line1 : line2),
                  backgroundColor: VOLT,
                }}
              />
            ))}
          </div>
        </div>

        {/* Touch indicator: a flat fingertip mark on the phone menu. */}
        <div
          style={{
            position: "absolute",
            left: tap.x - 30,
            top: tap.y - 30,
            width: 60,
            height: 60,
            borderRadius: 30,
            backgroundColor: "rgba(236, 238, 242, 0.55)",
            border: "2px solid rgba(236, 238, 242, 0.9)",
            transform: `scale(${(0.6 + 0.4 * touchIn) * (1 - 0.18 * pressed)})`,
            opacity: touchIn * touchOut,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
