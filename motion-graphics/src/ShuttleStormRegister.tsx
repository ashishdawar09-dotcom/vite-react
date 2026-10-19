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
// 430 CSS px (3x), and every overlay position below is measured from the DOM.

// The site's own typefaces, bundled locally (OFL) so renders work offline.
const ARCHIVO = "Archivo";
const MONO = "JetBrains Mono";
loadFont({
  family: ARCHIVO,
  url: staticFile("fonts/Archivo-latin-variable.woff2"),
  weight: "100 900",
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
const VOLT = "#D4FF3A";
const DEVICE = "#14161B";
const SITE_INK = "#06080D";

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
// Menu link "05 Categories" → /categories (text spans x 56–299).
const MENU_LINK = { x: 17.2, y: 315.3, w: 395.6, h: 57.8 };
const MENU_TEXT_CX = 178;
const CATEGORIES_PAGE_H = 2424;
const TABLE_X = 17.2;
const TABLE_W = 395.6;
// Row crops keep 10 CSS px of page margin each side so the marker tick sits beside the text.
const CROP_X = TABLE_X - 10;
const CROP_W = TABLE_W + 20;
const CATS_SCROLL = 360;
// [top, height, group index] for the eleven rows of the category table.
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
const DEADLINE_CROP = { x: 17.2, y: 150, h: 46 };
const DEADLINE_LINES = [
  { y: 168.5, x0: 17.2, x1: 333 },
  { y: 187.5, x0: 17.2, x1: 175 },
];

// End-frame wall: the same eleven rows, grouped Juniors / Youth / Adults / Masters.
const WALL_S = 2.05;
const WALL_X = (WIDTH - CROP_W * WALL_S) / 2;
const WALL_Y = 262;
const GROUP_GAP = 26;
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
const DEADLINE_Y = WALL_BOTTOM + 24;
const DEADLINE_S = 2.5;
const COUNTER_Y = 150;

const ease = Easing.inOut(Easing.cubic);
const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

const linkFocus = {
  x: SCREEN.x + MENU_TEXT_CX * K,
  y: SCREEN.y + (MENU_LINK.y + MENU_LINK.h / 2) * K,
};
const tableBottom = SCREEN.y + (ROWS[10][0] + ROWS[10][1] - CATS_SCROLL) * K;

// Camera: hold → travel → hold. Repeated keys are holds.
const KEY_T = [0, 16, 34, 96, 128, DURATION];
const KEY_X = [linkFocus.x, linkFocus.x, WIDTH / 2, WIDTH / 2, WIDTH / 2, WIDTH / 2];
const KEY_Y = [
  linkFocus.y,
  linkFocus.y,
  (COUNTER_Y + tableBottom) / 2,
  (COUNTER_Y + tableBottom) / 2,
  HEIGHT / 2,
  HEIGHT / 2,
];
const KEY_Z = [2.4, 2.4, 1.54, 1.54, 1, 1];

// A row of the real category table, cropped from the screenshot at scale s.
const RowCrop: React.FC<{ index: number; s: number; marked: number }> = ({
  index,
  s,
  marked,
}) => {
  const [top, h] = ROWS[index];
  return (
    <div
      style={{
        position: "relative",
        width: CROP_W * s,
        height: h * s,
        overflow: "hidden",
        backgroundColor: SITE_INK,
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
          left: 0,
          top: 0,
          width: CROP_W * s,
          height: h * s,
          backgroundColor: `rgba(212, 255, 58, ${marked * 0.13})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 8 * s,
          width: 3 * s,
          height: (h - 16) * s * marked,
          backgroundColor: VOLT,
        }}
      />
    </div>
  );
};

const Cursor: React.FC<{ x: number; y: number; opacity: number; pressed: number }> = ({
  x,
  y,
  opacity,
  pressed,
}) => (
  <svg
    width={44}
    height={60}
    viewBox="0 0 22 30"
    style={{
      position: "absolute",
      left: x,
      top: y,
      opacity,
      transform: `scale(${1 - pressed * 0.12})`,
      transformOrigin: "0 0",
    }}
  >
    <path
      d="M1.5 1.5 L1.5 24 L7.2 18.6 L11 27.5 L14.6 26 L10.9 17.2 L18.6 17.2 Z"
      fill={INK}
      stroke="#FFFFFF"
      strokeWidth={1.6}
      strokeLinejoin="round"
    />
  </svg>
);

export const ShuttleStormRegister: React.FC = () => {
  const frame = useCurrentFrame();

  const fx = interpolate(frame, KEY_T, KEY_X, { ...clamp, easing: ease });
  const fy = interpolate(frame, KEY_T, KEY_Y, { ...clamp, easing: ease });
  const z = interpolate(frame, KEY_T, KEY_Z, { ...clamp, easing: ease });

  // Tap on the real "05 Categories" menu link.
  const cursorX = interpolate(frame, [0, 11], [linkFocus.x + 150, linkFocus.x + 70], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const cursorY = interpolate(frame, [0, 11], [linkFocus.y + 120, linkFocus.y + 4], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const pressed = interpolate(frame, [11, 14, 17, 21], [0, 1, 1, 0], clamp);
  const cursorOpacity = interpolate(frame, [20, 28], [1, 0], clamp);

  // The link navigates: /categories replaces the menu, then scrolls to its table.
  const pageIn = interpolate(frame, [17, 24], [0, 1], clamp);
  const scroll = interpolate(frame, [26, 42], [0, CATS_SCROLL], { ...clamp, easing: ease });

  // A marker passes all eleven real rows; the counter follows it.
  const ROW_START = 46;
  const ROW_STEP = 4.2;
  const markedAt = (i: number) =>
    interpolate(frame, [ROW_START + i * ROW_STEP, ROW_START + i * ROW_STEP + 4], [0, 1], clamp);
  const rowsDone = Math.max(1, Math.min(11, Math.floor((frame - ROW_START) / ROW_STEP) + 1));

  // The rows lift out of the phone and regroup as a wall; the phone drops away.
  const LIFT_START = 98;
  const liftAt = (i: number) =>
    interpolate(frame, [LIFT_START + i * 1.6, LIFT_START + i * 1.6 + 22], [0, 1], {
      ...clamp,
      easing: ease,
    });
  const phoneDrop = interpolate(frame, [100, 126], [0, 2300], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  });

  // The register page's real deadline line arrives under the wall.
  const deadlineIn = interpolate(frame, [134, 148], [0, 1], { ...clamp, easing: ease });
  const line1 = interpolate(frame, [148, 158], [0, 1], { ...clamp, easing: ease });
  const line2 = interpolate(frame, [156, 164], [0, 1], { ...clamp, easing: ease });
  const lockupIn = interpolate(frame, [112, 128], [0, 1], clamp);

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
        {/* Identity lockup, revealed by the pullback. */}
        <div
          style={{
            position: "absolute",
            left: WALL_X,
            top: 46,
            display: "flex",
            alignItems: "center",
            gap: 26,
            opacity: lockupIn,
          }}
        >
          <Img src={staticFile("research/shuttle-storm-mark.svg")} style={{ width: 84, height: 84 }} />
          <div
            style={{
              fontFamily: ARCHIVO,
              fontWeight: 500,
              fontSize: 50,
              letterSpacing: "0.04em",
              color: INK,
              textTransform: "uppercase",
              lineHeight: 1,
              whiteSpace: "nowrap",
            }}
          >
            Shuttle Storm ’26
          </div>
        </div>

        {/* Counter on the paper, tied to the row marker. */}
        <div
          style={{
            position: "absolute",
            left: interpolate(liftAt(0), [0, 1], [SCREEN.x + CROP_X * K, WALL_X]),
            top: COUNTER_Y,
            fontFamily: MONO,
            fontWeight: 500,
            color: INK,
            display: "flex",
            alignItems: "baseline",
            gap: 22,
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
            opacity: interpolate(frame, [ROW_START - 4, ROW_START + 2], [0, 1], clamp),
          }}
        >
          <span style={{ fontSize: 76, lineHeight: 1 }}>{String(rowsDone).padStart(2, "0")}</span>
          <span style={{ fontSize: 34, letterSpacing: "0.16em", color: MUTED }}>/ 11 CATEGORIES</span>
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
              <Img
                src={staticFile("research/site-menu.png")}
                style={{ position: "absolute", width: CSS_W, height: CSS_H }}
              />
              <div
                style={{
                  position: "absolute",
                  left: MENU_LINK.x,
                  top: MENU_LINK.y,
                  width: MENU_LINK.w,
                  height: MENU_LINK.h,
                  backgroundColor: `rgba(236, 238, 242, ${pressed * 0.1})`,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  width: CSS_W,
                  height: CATEGORIES_PAGE_H,
                  transform: `translateY(${-scroll}px)`,
                  opacity: pageIn,
                }}
              >
                <Img
                  src={staticFile("research/site-categories.png")}
                  style={{ width: CSS_W, height: CATEGORIES_PAGE_H, display: "block" }}
                />
                {ROWS.map(([top, h], i) => (
                  <React.Fragment key={i}>
                    <div
                      style={{
                        position: "absolute",
                        left: TABLE_X,
                        top,
                        width: TABLE_W,
                        height: h,
                        backgroundColor: `rgba(212, 255, 58, ${markedAt(i) * 0.13})`,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: CROP_X,
                        top: top + 8,
                        width: 3,
                        height: (h - 16) * markedAt(i),
                        backgroundColor: VOLT,
                      }}
                    />
                    {/* Once a row lifts out, its slot in the page is left empty. */}
                    {liftAt(i) > 0 ? (
                      <div
                        style={{
                          position: "absolute",
                          left: CROP_X,
                          top,
                          width: CROP_W,
                          height: h,
                          backgroundColor: SITE_INK,
                        }}
                      />
                    ) : null}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Lifted rows: from their place in the phone to the grouped wall. */}
        {ROWS.map(([top, , g], i) => {
          const t = liftAt(i);
          if (t <= 0) return null;
          const fromX = SCREEN.x + CROP_X * K;
          const fromY = SCREEN.y + (top - CATS_SCROLL) * K;
          const s = interpolate(t, [0, 1], [K, WALL_S]);
          const first = i === 0 || ROWS[i - 1][2] !== g;
          const last = i === 10 || ROWS[i + 1][2] !== g;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: interpolate(t, [0, 1], [fromX, WALL_X]),
                top: interpolate(t, [0, 1], [fromY, wallTops[i]]),
                borderTopLeftRadius: first ? 16 * t : 0,
                borderTopRightRadius: first ? 16 * t : 0,
                borderBottomLeftRadius: last ? 16 * t : 0,
                borderBottomRightRadius: last ? 16 * t : 0,
                overflow: "hidden",
                boxShadow: `0 ${12 * t}px ${28 * t}px rgba(40, 32, 20, ${0.1 * t})`,
              }}
            >
              <RowCrop index={i} s={s} marked={markedAt(i)} />
            </div>
          );
        })}

        {/* The real deadline line from /register, underlined. */}
        <div
          style={{
            position: "absolute",
            left: WALL_X,
            top: DEADLINE_Y + (1 - deadlineIn) * 40,
            width: CROP_W * WALL_S,
            height: (DEADLINE_CROP.h + 12) * DEADLINE_S,
            borderRadius: 16,
            overflow: "hidden",
            backgroundColor: SITE_INK,
            opacity: deadlineIn,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: (10 - DEADLINE_CROP.x) * DEADLINE_S,
              top: 6 * DEADLINE_S,
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
                  height: 2.5 * DEADLINE_S,
                  width: (l.x1 - l.x0) * DEADLINE_S * (i === 0 ? line1 : line2),
                  backgroundColor: VOLT,
                }}
              />
            ))}
          </div>
        </div>

        <Cursor x={cursorX} y={cursorY} opacity={cursorOpacity} pressed={pressed} />
      </div>
    </AbsoluteFill>
  );
};
