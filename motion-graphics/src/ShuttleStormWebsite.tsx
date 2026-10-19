import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
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
  m,
  ramp,
  World,
} from "./shuttle/shared";

// Website film (16:9, 15 s), sized for the home page's "Watch the storm" film
// slot ("Fifteen seconds of speed, precision and Shuttle Storm"). One
// horizontal world of real site pages. At each stop the camera arrives pushed
// in on the exact line being marked, the mark draws, the camera eases back and
// the fact it marked lands as the headline beside the page. Ends on the site
// film's own end card. kickbacks-same-run-editor mechanism.

export const WEBSITE = { width: 1920, height: 1080, duration: 450 };

const PANEL = 1920;
const CARD_X = 1240;
const TEXT_X = 150;
const PUSH = 1.75;

type Rect = { x: number; y: number; w: number; h: number };
type Stop = {
  file: string;
  imageHeight: number;
  top: number;
  height: number;
  scale: number;
  // The marked line(s), in page CSS px.
  marks: Rect[];
};

const registerHeight = Math.round(m.register.feesEnd - 110 + 16);
const STOPS: Stop[] = [
  { file: "site-home-hero", imageHeight: 940, top: 250, height: 640, scale: 1.34, marks: [...m.homeHero.date, ...m.homeHero.ages] },
  { file: "site-categories", imageHeight: Math.round(m.categories.h), top: 362, height: 724, scale: 1.2, marks: m.categories.rows },
  { file: "site-home-facts", imageHeight: 560, top: 0, height: 560, scale: 1.5, marks: m.homeFacts.feathersLine },
  { file: "site-register", imageHeight: 932, top: 110, height: registerHeight, scale: 1.34, marks: m.register.deadline },
];
const cardY = (s: Stop) => (1080 - s.height * s.scale) / 2;
// World position of a point given in page CSS px for stop i.
const worldAt = (i: number, cssX: number, cssY: number) => ({
  x: i * PANEL + CARD_X + cssX * STOPS[i].scale,
  y: cardY(STOPS[i]) + (cssY - STOPS[i].top) * STOPS[i].scale,
});
const markCenter = (i: number, r: Rect) => worldAt(i, r.x + r.w / 2, r.y + r.h / 2);

// Each stop: arrive pushed in (0), mark (0–24), ease back (24–42), headline
// (38–56), hold, then a 22-frame pan to the next stop.
const ARRIVE = [0, 96, 186, 276, 366];
const PAN = 22;

export const ShuttleStormWebsite: React.FC = () => {
  const frame = useCurrentFrame();

  const keys: { t: number; x: number; y: number; z: number }[] = [];
  STOPS.forEach((s, i) => {
    const a = ARRIVE[i];
    const first = markCenter(i, s.marks[0]);
    const last = markCenter(i, s.marks[s.marks.length - 1]);
    // Hero/register: hold on the marked lines; categories: track down the rows.
    const mid = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
    const isTable = s.marks.length > 4;
    keys.push({ t: a, ...(isTable ? first : mid), z: isTable ? 1.55 : PUSH });
    keys.push({ t: a + 22, ...(isTable ? last : mid), z: isTable ? 1.55 : PUSH });
    keys.push({ t: a + 42, x: i * PANEL + PANEL / 2, y: 540, z: 1 });
    keys.push({ t: ARRIVE[i + 1] - PAN, x: i * PANEL + PANEL / 2, y: 540, z: 1 });
  });
  keys.push({ t: ARRIVE[4], x: 4 * PANEL + PANEL / 2, y: 540, z: 1 });
  keys.push({ t: WEBSITE.duration, x: 4 * PANEL + PANEL / 2, y: 540, z: 1 });
  const cam = cameraAt(frame, keys);

  const mark = (i: number) => ramp(frame, ARRIVE[i] + 2, ARRIVE[i] + 22);
  const rows = m.categories.rows.map((_, r) => ramp(frame, ARRIVE[1] + 1 + r * 2, ARRIVE[1] + 6 + r * 2));
  const lines = (i: number, n: number) =>
    Array.from({ length: n }, (_, j) => ramp(frame, ARRIVE[i] + 38 + j * 6, ARRIVE[i] + 52 + j * 6));

  const text = (i: number, content: React.ReactNode) => (
    <div style={{ position: "absolute", left: i * PANEL + TEXT_X, top: 0, height: 1080, display: "flex", flexDirection: "column", justifyContent: "center", gap: 34 }}>
      {content}
    </div>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: WORLD, overflow: "hidden" }}>
      <World cam={cam} width={WEBSITE.width} height={WEBSITE.height}>
        {STOPS.map((s, i) => (
          <SiteCrop
            key={s.file}
            file={s.file}
            imageHeight={s.imageHeight}
            top={s.top}
            height={s.height}
            scale={s.scale}
            x={i * PANEL + CARD_X}
            y={cardY(s)}
          >
            {i === 1 ? (
              m.categories.rows.map((r, j) => (
                <div key={j} style={{ position: "absolute", left: r.x - 10, top: r.y + 8, width: 3, height: (r.h - 16) * rows[j], backgroundColor: VOLT }} />
              ))
            ) : (
              <Underline lines={s.marks} progress={mark(i)} offsetY={i === 2 ? 10 : 0} thickness={i === 2 ? 2.4 : 2} />
            )}
          </SiteCrop>
        ))}

        {text(0, (
          <>
            <RevealLines lines={[{ text: "Sat · Nov 21" }, { text: "UFV North Gym", color: VOLT }]} progress={lines(0, 2)} size={84} />
            <div style={{ opacity: lines(0, 3)[2] }}>
              <Mono size={36} color={BONE}>Abbotsford, BC</Mono>
            </div>
          </>
        ))}
        {text(1, (
          <RevealLines lines={[{ text: "11 categories" }, { text: "Juniors to", color: VOLT }, { text: "masters.", color: VOLT }]} progress={lines(1, 3)} size={84} />
        ))}
        {text(2, (
          <RevealLines lines={[{ text: "Feather" }, { text: "shuttles." }, { text: "Great prizes.", color: VOLT }]} progress={lines(2, 3)} size={84} />
        ))}
        {text(3, (
          <>
            <RevealLines lines={[{ text: "Entries close" }, { text: "Nov 18", color: VOLT }, { text: "$30–40" }]} progress={lines(3, 3)} size={84} />
            <div style={{ opacity: lines(3, 4)[3] }}>
              <Mono size={36} color={BONE}>Per player, per category</Mono>
            </div>
          </>
        ))}

        <div style={{ position: "absolute", left: 4 * PANEL, top: 0, width: PANEL, height: 1080, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 70 }}>
          <Lockup size={150} />
          <div style={{ opacity: ramp(frame, ARRIVE[4] + 8, ARRIVE[4] + 18) }}>
            <Mono size={40} color={BONE} tracking="0.06em">shuttlestorm.adawar.org</Mono>
          </div>
        </div>
      </World>
    </AbsoluteFill>
  );
};
