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
// 430 CSS px (3x), every overlay position is measured from the DOM, and the end
// wall re-sets the categories page's own table data in the site's own styles.

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
// Site tokens (page.css).
const SITE_INK = "#06080D";
const VOLT = "#D4FF3A";
const BONE = "#ECEEF2";
const TD = "#C4CAD6";
const MUTE = "#8F97A8";
const LINE = "rgba(236, 238, 242, 0.12)";

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
const MENU_LINK = { x: 17.2, y: 315.3, w: 395.6, h: 57.8 };
const MENU_TEXT = { x: 54, y: 322, w: 250, h: 44 };
const CATEGORIES_PAGE_H = 2424;
const TABLE_X = 17.2;
const TABLE_W = 395.6;
const CATS_SCROLL = 360;

type Category = { name: string; fee: string; top: number; h: number };
type Group = { label: string; rows: Category[] };
// The categories page table, verbatim (rows measured from the DOM).
const GROUPS: Group[] = [
  {
    label: "Juniors · 8–12",
    rows: [
      { name: "Boys’ singles", fee: "$30", top: 426.1, h: 45.75 },
      { name: "Girls’ singles", fee: "$30", top: 471.8, h: 45.75 },
    ],
  },
  {
    label: "Youth · 13–17",
    rows: [
      { name: "Youth boys’ singles", fee: "$30", top: 517.6, h: 45.75 },
      { name: "Youth girls’ singles", fee: "$30", top: 563.3, h: 45.75 },
      { name: "Youth boys’ doubles", fee: "$30 per player", top: 609.1, h: 70.5 },
      { name: "Youth girls’ doubles", fee: "$30 per player", top: 679.6, h: 70.5 },
    ],
  },
  {
    label: "Adults · 18+",
    rows: [
      { name: "Men’s singles", fee: "$40", top: 750.1, h: 45.75 },
      { name: "Men’s doubles", fee: "$40 per player", top: 795.8, h: 70.5 },
      { name: "Women’s doubles", fee: "$40 per player", top: 866.3, h: 70.5 },
      { name: "Mixed doubles", fee: "$40 per player", top: 936.8, h: 70.5 },
    ],
  },
  {
    label: "Masters · 50+",
    rows: [
      { name: "Super doubles (men, women or mixed)", fee: "$40 per player", top: 1007.3, h: 70.5 },
    ],
  },
];
const ROWS = GROUPS.flatMap((g) => g.rows);

// End-frame layout (frame px).
const MARGIN = 56;
const WALL_W = WIDTH - MARGIN * 2;
const TILE_PAD = 26;
const HEADER_H = 58;
const NAME_SIZE = 50;
const ROW_H = 78;
const ROW_H_2 = 130; // the one two-line name
const GROUP_GAP = 22;
const LOCKUP_Y = 52;
const COUNTER_Y = 168;
const WALL_Y = 270;

type Box = { x: number; y: number; w: number; h: number };
const rowBoxes: Box[] = [];
const groupBoxes: Box[] = [];
{
  let y = WALL_Y;
  for (const g of GROUPS) {
    const top = y;
    y += TILE_PAD + HEADER_H;
    for (const r of g.rows) {
      const h = r.name.length > 24 ? ROW_H_2 : ROW_H;
      rowBoxes.push({ x: MARGIN + TILE_PAD, y, w: WALL_W - TILE_PAD * 2, h });
      y += h;
    }
    y += TILE_PAD - 8;
    groupBoxes.push({ x: MARGIN, y: top, w: WALL_W, h: y - top });
    y += GROUP_GAP;
  }
}
const DEADLINE_Y = groupBoxes[3].y + groupBoxes[3].h + 34;

const ease = Easing.inOut(Easing.cubic);
const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

const linkCenter = {
  x: SCREEN.x + (MENU_LINK.x + MENU_LINK.w / 2) * K,
  y: SCREEN.y + (MENU_LINK.y + MENU_LINK.h / 2) * K,
};
const scanFocusY =
  (COUNTER_Y + SCREEN.y + (ROWS[10].top + ROWS[10].h - CATS_SCROLL) * K) / 2;

// Camera: hold → travel → hold. Repeated keys are holds.
const KEY_T = [0, 18, 34, 76, 106, DURATION];
const KEY_X = [linkCenter.x, linkCenter.x, WIDTH / 2, WIDTH / 2, WIDTH / 2, WIDTH / 2];
const KEY_Y = [linkCenter.y, linkCenter.y, scanFocusY, scanFocusY, HEIGHT / 2, HEIGHT / 2];
const KEY_Z = [1.88, 1.88, 1.54, 1.54, 1, 1];

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

// One category, set like the site's table (name in bone, fee in td grey).
const RowText: React.FC<{ row: Category; last: boolean }> = ({ row, last }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 24,
      paddingLeft: 22,
      paddingRight: 22,
      borderBottom: last ? "none" : `1.5px solid ${LINE}`,
    }}
  >
    <div
      style={{
        fontFamily: ARCHIVO,
        fontWeight: 600,
        fontSize: NAME_SIZE,
        lineHeight: 1.12,
        color: BONE,
        maxWidth: 620,
      }}
    >
      {row.name}
    </div>
    <div
      style={{
        fontFamily: ARCHIVO,
        fontWeight: 500,
        fontSize: 32,
        color: TD,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {row.fee}
    </div>
  </div>
);

export const ShuttleStormRegister: React.FC = () => {
  const frame = useCurrentFrame();

  const fx = interpolate(frame, KEY_T, KEY_X, { ...clamp, easing: ease });
  const fy = interpolate(frame, KEY_T, KEY_Y, { ...clamp, easing: ease });
  const z = interpolate(frame, KEY_T, KEY_Z, { ...clamp, easing: ease });

  // Tap on the real "05 Categories" menu link; the site's :active state turns it volt.
  const textCenterX = SCREEN.x + (MENU_TEXT.x + MENU_TEXT.w * 0.62) * K;
  const cursorX = interpolate(frame, [0, 10], [textCenterX + 120, textCenterX], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const cursorY = interpolate(frame, [0, 10], [linkCenter.y + 150, linkCenter.y], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const pressed = interpolate(frame, [10, 13, 17, 20], [0, 1, 1, 0], clamp);
  const active = frame >= 11 && frame < 20 ? 1 : 0;
  const cursorOpacity = frame < 20 ? 1 : 0;

  // The link navigates: a clean cut to /categories, which scrolls to its table.
  const onCategories = frame >= 20;
  const scroll = interpolate(frame, [22, 38], [0, CATS_SCROLL], { ...clamp, easing: ease });

  // A marker passes all eleven real rows; the counter follows it.
  const ROW_START = 40;
  const ROW_STEP = 2.7;
  const markedAt = (i: number) =>
    interpolate(frame, [ROW_START + i * ROW_STEP, ROW_START + i * ROW_STEP + 3], [0, 1], clamp);
  const rowsDone = Math.max(1, Math.min(11, Math.floor((frame - ROW_START) / ROW_STEP) + 1));

  // The rows lift out together (no overlap), grow into the wall, and the phone
  // drops away beneath them.
  const lift = interpolate(frame, [78, 106], [0, 1], { ...clamp, easing: ease });
  // Clean swap from the screenshot crop to the re-set row once it is near full size.
  const swap = lift >= 0.94 ? 1 : 0;
  const phoneDrop = interpolate(frame, [80, 104], [0, 2300], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  });
  const groupsIn = interpolate(frame, [101, 105], [0, 1], clamp);
  const lockupIn = interpolate(frame, [100, 114], [0, 1], clamp);

  // The register page's deadline, set in the site's eyebrow style, then underlined.
  const deadlineIn = interpolate(frame, [114, 128], [0, 1], { ...clamp, easing: ease });
  const line1 = interpolate(frame, [128, 140], [0, 1], { ...clamp, easing: ease });
  const line2 = interpolate(frame, [138, 148], [0, 1], { ...clamp, easing: ease });

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
            top: LOCKUP_Y,
            display: "flex",
            alignItems: "center",
            gap: 24,
            opacity: lockupIn,
          }}
        >
          <Img src={staticFile("research/shuttle-storm-mark.svg")} style={{ width: 82, height: 82 }} />
          <div
            style={{
              fontFamily: ARCHIVO,
              fontWeight: 600,
              fontStretch: "125%",
              fontSize: 44,
              letterSpacing: "0.14em",
              color: INK,
              textTransform: "uppercase",
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
            left: interpolate(lift, [0, 1], [SCREEN.x + (TABLE_X - 6) * K, MARGIN]),
            top: COUNTER_Y,
            fontFamily: MONO,
            fontWeight: 500,
            color: INK,
            display: "flex",
            alignItems: "baseline",
            gap: 20,
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
            opacity: interpolate(frame, [ROW_START - 4, ROW_START + 2], [0, 1], clamp),
          }}
        >
          <span style={{ fontSize: 72, lineHeight: 1 }}>{String(rowsDone).padStart(2, "0")}</span>
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
              {onCategories ? (
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
                  {ROWS.map((r, i) => (
                    <React.Fragment key={i}>
                      <div
                        style={{
                          position: "absolute",
                          left: TABLE_X,
                          top: r.top,
                          width: TABLE_W,
                          height: r.h,
                          backgroundColor: `rgba(212, 255, 58, ${markedAt(i) * 0.13})`,
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          left: TABLE_X - 10,
                          top: r.top + 8,
                          width: 3,
                          height: (r.h - 16) * markedAt(i),
                          backgroundColor: VOLT,
                        }}
                      />
                    </React.Fragment>
                  ))}
                  {/* Once the rows lift out, the table area is left empty. */}
                  {lift > 0 ? (
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: ROWS[0].top,
                        width: CSS_W,
                        height: ROWS[10].top + ROWS[10].h - ROWS[0].top,
                        backgroundColor: SITE_INK,
                      }}
                    />
                  ) : null}
                </div>
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

        {/* Group tiles: Juniors / Youth / Adults / Masters, from the Group and Ages columns. */}
        {GROUPS.map((g, gi) => (
          <div
            key={g.label}
            style={{
              position: "absolute",
              left: groupBoxes[gi].x,
              top: groupBoxes[gi].y,
              width: groupBoxes[gi].w,
              height: groupBoxes[gi].h,
              borderRadius: 22,
              backgroundColor: SITE_INK,
              opacity: groupsIn,
              boxShadow: "0 18px 40px rgba(40, 32, 20, 0.12)",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: TILE_PAD + 22,
                top: TILE_PAD + 4,
                fontFamily: MONO,
                fontWeight: 500,
                fontSize: 28,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: MUTE,
              }}
            >
              {g.label}
            </div>
          </div>
        ))}

        {/* Each real row travels from the phone to its slot, then is re-set at wall size. */}
        {ROWS.map((r, i) => {
          if (lift <= 0) return null;
          const from: Box = {
            x: SCREEN.x + TABLE_X * K,
            y: SCREEN.y + (r.top - CATS_SCROLL) * K,
            w: TABLE_W * K,
            h: r.h * K,
          };
          const to = rowBoxes[i];
          const box = {
            x: interpolate(lift, [0, 1], [from.x, to.x]),
            y: interpolate(lift, [0, 1], [from.y, to.y]),
            w: interpolate(lift, [0, 1], [from.w, to.w]),
            h: interpolate(lift, [0, 1], [from.h, to.h]),
          };
          const s = box.w / TABLE_W;
          const groupIndex = GROUPS.findIndex((g) => g.rows.includes(r));
          const groupRows = GROUPS[groupIndex].rows;
          const lastInGroup = groupRows[groupRows.length - 1] === r;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: box.x,
                top: box.y,
                width: box.w,
                height: box.h,
                overflow: "hidden",
                backgroundColor: SITE_INK,
              }}
            >
              <div style={{ position: "absolute", inset: 0, opacity: 1 - swap }}>
                <Img
                  src={staticFile("research/site-categories.png")}
                  style={{
                    position: "absolute",
                    left: -TABLE_X * s,
                    top: -r.top * s,
                    width: CSS_W * s,
                    height: CATEGORIES_PAGE_H * s,
                    maxWidth: "none",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    backgroundColor: "rgba(212, 255, 58, 0.13)",
                  }}
                />
              </div>
              <div style={{ position: "absolute", inset: 0, opacity: swap }}>
                <RowText row={r} last={lastInGroup} />
              </div>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 12,
                  width: 4,
                  height: box.h - 24,
                  backgroundColor: VOLT,
                }}
              />
            </div>
          );
        })}

        {/* The register page's deadline line, in its eyebrow style, underlined. */}
        <div
          style={{
            position: "absolute",
            left: MARGIN,
            top: DEADLINE_Y + (1 - deadlineIn) * 40,
            width: WALL_W,
            borderRadius: 22,
            backgroundColor: SITE_INK,
            padding: "26px 48px 30px",
            opacity: deadlineIn,
            fontFamily: MONO,
            fontWeight: 500,
            fontSize: 38,
            lineHeight: 1.5,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: BONE,
          }}
        >
          {["Entries close 11:59 pm,", "Wednesday, November 18, 2026"].map((text, i) => (
            <div key={text} style={{ position: "relative", width: "fit-content" }}>
              {text}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  bottom: 2,
                  height: 4,
                  width: `${(i === 0 ? line1 : line2) * 100}%`,
                  backgroundColor: VOLT,
                }}
              />
            </div>
          ))}
        </div>

        <Cursor x={cursorX} y={cursorY} opacity={cursorOpacity} pressed={pressed} />
      </div>
    </AbsoluteFill>
  );
};
