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

// Website film (16:9, 15 s), sized for the home page's "Watch the storm"
// film slot ("Fifteen seconds of speed, precision and Shuttle Storm"). One
// horizontal world: each stop pairs a real site page with its fact in the
// site's display type, ending on the site film's own end card.
// kickbacks-same-run-editor mechanism: the camera travels page to page.

export const WEBSITE = { width: 1920, height: 1080, duration: 450 };

const PANEL = 1920;
const CARD_X = 1240;
const TEXT_X = 150;

type Stop = {
  file: string;
  imageHeight: number;
  top: number;
  height: number;
  scale: number;
};
const STOPS: Stop[] = [
  { file: "site-home-hero", imageHeight: 940, top: 250, height: 640, scale: 1.34 },
  { file: "site-categories", imageHeight: Math.round(m.categories.h), top: 362, height: 724, scale: 1.2 },
  { file: "site-home-facts", imageHeight: 560, top: 0, height: 560, scale: 1.5 },
  { file: "site-register", imageHeight: 932, top: 110, height: 640, scale: 1.34 },
];
const cardY = (s: Stop) => (1080 - s.height * s.scale) / 2;

// Holds and travels (frames): each stop holds ~2.4 s, travels in 24 frames.
const ARRIVE = [0, 96, 186, 276, 366];

export const ShuttleStormWebsite: React.FC = () => {
  const frame = useCurrentFrame();

  const keys = ARRIVE.flatMap((t, i) => {
    const x = i * PANEL + PANEL / 2;
    const k = [{ t, x, y: 540, z: 1 }];
    if (i < ARRIVE.length - 1) {
      const leave = ARRIVE[i + 1] - 24;
      k.push({ t: leave, x, y: 540, z: 1 });
      k.push({ t: leave + 12, x: x + PANEL / 2, y: 540, z: 0.84 });
    }
    return k;
  });
  keys.push({ t: WEBSITE.duration, x: 4 * PANEL + PANEL / 2, y: 540, z: 1 });
  const cam = cameraAt(frame, keys);

  const lines = (i: number, n: number) =>
    Array.from({ length: n }, (_, j) => ramp(frame, ARRIVE[i] + 6 + j * 6, ARRIVE[i] + 20 + j * 6));
  const mark = (i: number, from = 26, to = 46) => ramp(frame, ARRIVE[i] + from, ARRIVE[i] + to);
  const rows = m.categories.rows.map((_, r) => ramp(frame, ARRIVE[1] + 24 + r * 3, ARRIVE[1] + 30 + r * 3));

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
            {i === 0 ? (
              <>
                <Underline lines={m.homeHero.date} progress={mark(0)} />
                <Underline lines={m.homeHero.ages} progress={mark(0, 40, 62)} />
              </>
            ) : null}
            {i === 1
              ? m.categories.rows.map((r, j) => (
                  <div key={j} style={{ position: "absolute", left: r.x - 10, top: r.y + 8, width: 3, height: (r.h - 16) * rows[j], backgroundColor: VOLT }} />
                ))
              : null}
            {i === 2 ? <Underline lines={m.homeFacts.feathersLine} progress={mark(2)} offsetY={10} thickness={2.4} /> : null}
            {i === 3 ? <Underline lines={m.register.deadline} progress={mark(3)} /> : null}
          </SiteCrop>
        ))}

        {text(0, (
          <>
            <RevealLines lines={[{ text: "Sat · Nov 21" }, { text: "UFV North Gym", color: VOLT }]} progress={lines(0, 2)} size={84} />
            <div style={{ opacity: lines(0, 3)[2] }}>
              <Mono size={30} color={BONE}>Abbotsford, BC</Mono>
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
            <RevealLines lines={[{ text: "$30–40" }, { text: "Entries close", color: VOLT }, { text: "Nov 18", color: VOLT }]} progress={lines(3, 3)} size={84} />
            <div style={{ opacity: lines(3, 4)[3] }}>
              <Mono size={30} color={BONE}>Per player, per category</Mono>
            </div>
          </>
        ))}

        <div style={{ position: "absolute", left: 4 * PANEL, top: 0, width: PANEL, height: 1080, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 70 }}>
          <Lockup size={150} />
          <div style={{ opacity: ramp(frame, ARRIVE[4] + 10, ARRIVE[4] + 22) }}>
            <Mono size={34} color={BONE} tracking="0.08em">shuttlestorm.adawar.org</Mono>
          </div>
        </div>
      </World>
    </AbsoluteFill>
  );
};
