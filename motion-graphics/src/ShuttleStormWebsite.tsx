import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import {
  BONE,
  Lockup,
  Mono,
  RevealLines,
  SiteCrop,
  Underline,
  VOLT,
  WORLD,
  cameraAt,
  clamp,
  ease,
  m,
  ramp,
  World,
} from "./shuttle/shared";

// Website film (16:9, 15 s), sized for the home page's "Watch the storm" film
// slot ("Fifteen seconds of speed, precision and Shuttle Storm"). The world is
// one column of real site pages, stacked as you'd scroll them. At each stop
// the camera arrives pushed in on the exact line being marked, the mark
// draws, and as the camera eases back the fact it marked lands as the
// headline beside the page. Stops alternate sides, so every move runs down
// the column from page to page. Ends on the site film's own end card.
// kickbacks-same-run-editor mechanism.

export const WEBSITE = { width: 1920, height: 1080, duration: 450 };

// Every page is shown at one scale: 774 px wide, about 40% of the frame.
const SC = 1.8;
const CARD_W = 430 * SC;
const GAP = 80;
// Settled framing: the card sits 86 px in from the right or left edge.
const MARGIN = 86;

type Rect = { x: number; y: number; w: number; h: number };
type Stop = {
  file: string;
  imageHeight: number;
  top: number;
  height: number;
  side: "right" | "left";
  push: number;
  // The marked line(s), in page CSS px; the camera holds on their middle, or
  // tracks from the first to the last.
  marks: Rect[];
  track?: boolean;
};

// From the table header down to a window that starts on a row and ends under the last row.
const CAT_TOP = [370, 513];
const STOPS: Stop[] = [
  {
    file: "site-home-hero",
    imageHeight: 940,
    top: 330,
    height: 560,
    side: "right",
    push: 1.3,
    marks: [...m.homeHero.venue, ...m.homeHero.date],
  },
  {
    file: "site-categories",
    imageHeight: Math.round(m.categories.h),
    top: CAT_TOP[0],
    height: 575,
    side: "left",
    push: 1.25,
    marks: m.categories.rows,
    track: true,
  },
  { file: "site-home-facts", imageHeight: 560, top: 0, height: 520, side: "right", push: 1.15, marks: m.homeFacts.feathersLine },
  {
    file: "site-register",
    imageHeight: 932,
    top: 110,
    height: Math.round(m.register.feesEnd - 110 + 16),
    side: "left",
    push: 1.3,
    marks: [...m.register.deadline, ...m.register.fees],
    track: true,
  },
];

// Card tops, stacked down the column.
const TOPS = STOPS.reduce<number[]>((acc, s, i) => [...acc, i === 0 ? 0 : acc[i - 1] + STOPS[i - 1].height * SC + GAP], []);
const last = STOPS.length - 1;
const END_Y = TOPS[last] + STOPS[last].height * SC + GAP + 540;

const settled = (i: number) => ({
  x: STOPS[i].side === "right" ? 960 - (1920 - MARGIN - CARD_W) : 960 - MARGIN,
  y: TOPS[i] + (STOPS[i].height * SC) / 2,
});
// Left edge of the headline column, in world px.
const textX = (i: number) => settled(i).x - 960 + (STOPS[i].side === "right" ? 130 : MARGIN + CARD_W + 120);

// Each stop: arrive pushed in (0), mark (2–22), ease back (22–40) while the
// headline lands (24–), hold, then a 24-frame move to the next stop's mark.
const ARRIVE = [0, 96, 186, 276, 366];
const MOVE = 24;

export const ShuttleStormWebsite: React.FC = () => {
  const frame = useCurrentFrame();

  // The categories page scrolls inside its card as its rows light.
  const catTop = interpolate(frame, [ARRIVE[1], ARRIVE[1] + 22], CAT_TOP, { ...clamp, easing: ease });
  const tops = STOPS.map((s, i) => (i === 1 ? catTop : s.top));
  const worldAt = (i: number, cssX: number, cssY: number, top = tops[i]) => ({
    x: cssX * SC,
    y: TOPS[i] + (cssY - top) * SC,
  });
  const centre = (i: number, r: Rect, top?: number) => worldAt(i, r.x + r.w / 2, r.y + r.h / 2, top);

  const keys: { t: number; x: number; y: number; z: number }[] = [];
  STOPS.forEach((s, i) => {
    const a = ARRIVE[i];
    const first = centre(i, s.marks[0], i === 1 ? CAT_TOP[0] : undefined);
    const lastMark = centre(i, s.marks[s.marks.length - 1], i === 1 ? CAT_TOP[1] : undefined);
    const mid = { x: (first.x + lastMark.x) / 2, y: (first.y + lastMark.y) / 2 };
    keys.push({ t: a, ...(s.track ? first : mid), z: s.push });
    keys.push({ t: a + 22, ...(s.track ? lastMark : mid), z: s.push });
    keys.push({ t: a + 40, ...settled(i), z: 1 });
    keys.push({ t: ARRIVE[i + 1] - MOVE, ...settled(i), z: 1 });
  });
  keys.push({ t: ARRIVE[4], x: CARD_W / 2, y: END_Y, z: 1 });
  keys.push({ t: WEBSITE.duration, x: CARD_W / 2, y: END_Y, z: 1 });
  const cam = cameraAt(frame, keys);

  const mark = (i: number) => ramp(frame, ARRIVE[i] + 2, ARRIVE[i] + 22);
  const rows = m.categories.rows.map((_, r) => ramp(frame, ARRIVE[1] + 1 + r * 2, ARRIVE[1] + 6 + r * 2));
  const deadline = ramp(frame, ARRIVE[3] + 2, ARRIVE[3] + 12);
  const fees = ramp(frame, ARRIVE[3] + 12, ARRIVE[3] + 22);
  const lines = (i: number, n: number) =>
    Array.from({ length: n }, (_, j) => ramp(frame, ARRIVE[i] + 24 + j * 6, ARRIVE[i] + 38 + j * 6));

  const text = (i: number, content: React.ReactNode) => (
    <div
      style={{
        position: "absolute",
        left: textX(i),
        top: settled(i).y - 540,
        height: 1080,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 34,
      }}
    >
      {content}
    </div>
  );

  const end = ramp(frame, ARRIVE[4] - 6, ARRIVE[4] + 14);

  return (
    <AbsoluteFill style={{ backgroundColor: WORLD, overflow: "hidden" }}>
      <World cam={cam} width={WEBSITE.width} height={WEBSITE.height}>
        {STOPS.map((s, i) => (
          <SiteCrop key={s.file} file={s.file} imageHeight={s.imageHeight} top={tops[i]} height={s.height} scale={SC} x={0} y={TOPS[i]}>
            {i === 0 ? <Underline lines={s.marks} progress={mark(0)} /> : null}
            {i === 1
              ? m.categories.rows.map((r, j) => (
                  <div key={j} style={{ position: "absolute", left: r.x - 10, top: r.y + 8, width: 3, height: (r.h - 16) * rows[j], backgroundColor: VOLT }} />
                ))
              : null}
            {i === 2 ? <Underline lines={s.marks} progress={mark(2)} offsetY={10} thickness={2.4} /> : null}
            {i === 3 ? (
              <>
                <Underline lines={m.register.deadline} progress={deadline} />
                <Underline lines={m.register.fees} progress={fees} />
              </>
            ) : null}
          </SiteCrop>
        ))}

        {text(0, (
          <>
            <RevealLines lines={[{ text: "Sat · Nov 21" }, { text: "UFV North Gym", color: VOLT }]} progress={lines(0, 2)} size={72} />
            <div style={{ opacity: lines(0, 3)[2] }}>
              <Mono size={36} color={BONE}>Abbotsford, BC</Mono>
            </div>
          </>
        ))}
        {text(1, (
          <RevealLines lines={[{ text: "11 categories" }, { text: "Juniors to", color: VOLT }, { text: "masters.", color: VOLT }]} progress={lines(1, 3)} size={72} />
        ))}
        {text(2, (
          <RevealLines lines={[{ text: "Feather" }, { text: "shuttles." }, { text: "Great prizes.", color: VOLT }]} progress={lines(2, 3)} size={72} />
        ))}
        {text(3, (
          <>
            <RevealLines lines={[{ text: "Entries close" }, { text: "Nov 18", color: VOLT }, { text: "$30–40" }]} progress={lines(3, 3)} size={72} />
            <div style={{ opacity: lines(3, 4)[3] }}>
              <Mono size={36} color={BONE}>Per player, per category</Mono>
            </div>
          </>
        ))}

        <div
          style={{
            position: "absolute",
            left: CARD_W / 2 - 960,
            top: END_Y - 540,
            width: 1920,
            height: 1080,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 70,
            opacity: end,
          }}
        >
          <Lockup size={150} />
          <div style={{ opacity: ramp(frame, ARRIVE[4] + 8, ARRIVE[4] + 18) }}>
            <Mono size={40} color={BONE} tracking="0.06em">shuttlestorm.adawar.org</Mono>
          </div>
        </div>
      </World>
    </AbsoluteFill>
  );
};
