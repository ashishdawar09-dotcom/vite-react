import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import {
  BONE,
  CSS_W,
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

// Players (9:16): open on the site's own shuttle art, then the organisers' two
// promises (feather shuttles, great prizes) with the site's "16 feathers" fact.
// One volt thread then carries the viewer down into the register page's real
// "Your day, start to finish" — the camera stops on each step as it lights —
// and on to the categories, the deadline and the end card.
// openmontage-claude-pipeline mechanism: one connected path, camera on its head.

export const PLAYERS = { width: 1080, height: 1920, duration: 300 };

const S = 2.4;
const X = (1080 - CSS_W * S) / 2;
const ART = { top: 300, height: 300 };
const FEATHERS = { top: 160, height: 170 };
const MARGIN = X + 36;
const THREAD_X = 540;

const artY = 0;
const headlineY = artY + ART.height * S + 60;
const factY = headlineY + 290;
const prizesY = factY + FEATHERS.height * S + 60;
const prizesBottom = prizesY + 270;
const dayY = prizesBottom + 260;
const dayH = m.registerDay.h * S;
const dayBottom = dayY + dayH;
const END_H = 1300;
const endY = dayBottom + (1920 - END_H) / 2 + 60;
// The end card's content block (~960 px tall) is centred in its band.
const END_CONTENT_H = 900;
const endContentY = endY + (END_H - END_CONTENT_H) / 2;

const steps = m.registerDay.steps;
const stepY = (i: number) => dayY + (steps[i].y + steps[i].h / 2) * S;

// Timeline (frames).
const T = {
  thread1: [56, 82],
  step0: 86,
  stepEvery: 17,
  thread2: [176, 198],
  end: 196,
};

export const ShuttleStormPlayers: React.FC = () => {
  const frame = useCurrentFrame();

  const hookCenter = (artY + prizesBottom) / 2;
  const stepKeys = steps.flatMap((_, i) => {
    const t = T.step0 + i * T.stepEvery;
    return [
      { t, x: 540, y: stepY(i), z: 1.12 },
      { t: t + 9, x: 540, y: stepY(i), z: 1.12 },
    ];
  });
  const cam = cameraAt(frame, [
    { t: 0, x: 540, y: artY + (ART.height * S) / 2, z: 1.4 },
    { t: 4, x: 540, y: artY + (ART.height * S) / 2, z: 1.38 },
    { t: 30, x: 540, y: hookCenter, z: 0.93 },
    { t: T.thread1[0], x: 540, y: hookCenter, z: 0.93 },
    ...stepKeys,
    { t: T.thread2[1], x: 540, y: endY + END_H / 2, z: 1 },
    { t: PLAYERS.duration, x: 540, y: endY + END_H / 2, z: 1 },
  ]);

  const feather = [0, 1].map((i) => ramp(frame, 12 + i * 5, 26 + i * 5));
  const feathersLine = ramp(frame, 28, 40);
  const prizes = [0, 1].map((i) => ramp(frame, 36 + i * 5, 50 + i * 5));

  // The thread: from "GREAT PRIZES." down to step 1, then from step 5 to the end card.
  const thread1 = ramp(frame, T.thread1[0], T.thread1[1]);
  const thread2 = ramp(frame, T.thread2[0], T.thread2[1]);
  const lit = steps.map((_, i) => ramp(frame, T.step0 + i * T.stepEvery, T.step0 + i * T.stepEvery + 8));
  const active = Math.max(0, Math.min(4, Math.floor((frame - T.step0) / T.stepEvery)));
  const inSteps = frame >= T.step0 - 4 && frame < T.thread2[0] + 4;

  const endLines = [0, 1].map((i) => ramp(frame, T.end + 6 + i * 5, T.end + 18 + i * 5));
  const deadline = ramp(frame, T.end + 18, T.end + 28);
  const url = ramp(frame, T.end + 24, T.end + 32);
  const lockup = ramp(frame, T.end + 28, T.end + 42);

  return (
    <AbsoluteFill style={{ backgroundColor: WORLD, overflow: "hidden" }}>
      <World cam={cam} width={PLAYERS.width} height={PLAYERS.height}>
        <SiteCrop file="site-home-everypoint" imageHeight={932} top={ART.top} height={ART.height} scale={S} x={X} y={artY} />

        <div style={{ position: "absolute", left: MARGIN, top: headlineY }}>
          <RevealLines lines={[{ text: "Feather" }, { text: "shuttles.", color: VOLT }]} progress={feather} size={118} />
        </div>

        <SiteCrop file="site-home-facts" imageHeight={560} top={FEATHERS.top} height={FEATHERS.height} scale={S} x={X} y={factY}>
          <Underline lines={m.homeFacts.feathersLine} progress={feathersLine} offsetY={10} thickness={2.4} />
        </SiteCrop>

        <div style={{ position: "absolute", left: MARGIN, top: prizesY }}>
          <RevealLines lines={[{ text: "Great" }, { text: "prizes.", color: VOLT }]} progress={prizes} size={118} />
        </div>

        {/* Thread, part 1: from the promises into step 1. */}
        <div
          style={{
            position: "absolute",
            left: THREAD_X - 4,
            top: prizesBottom + 20,
            width: 8,
            height: (dayY + (steps[0].y + 4) * S - prizesBottom - 20) * thread1,
            backgroundColor: VOLT,
          }}
        />

        <SiteCrop file="site-register-day" imageHeight={624} height={m.registerDay.h} scale={S} x={X} y={dayY}>
          {steps.map((st, i) => (
            <React.Fragment key={i}>
              {/* Steps not in focus recede while the camera is on the list. */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: st.y - 4,
                  width: CSS_W,
                  height: st.h + 6,
                  backgroundColor: `rgba(6, 8, 13, ${inSteps && i !== active ? 0.55 : 0})`,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: st.x - 28,
                  top: st.y + 2,
                  width: 4,
                  height: (st.h - 8) * lit[i],
                  backgroundColor: VOLT,
                }}
              />
            </React.Fragment>
          ))}
        </SiteCrop>

        {/* Thread, part 2: from step 5 down to the end card. */}
        <div
          style={{
            position: "absolute",
            left: THREAD_X - 4,
            top: dayBottom + 20,
            width: 8,
            height: (endContentY - 40 - dayBottom - 20) * thread2,
            backgroundColor: VOLT,
          }}
        />

        <div
          style={{
            position: "absolute",
            left: 0,
            top: endContentY,
            width: 1080,
            height: END_CONTENT_H,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <RevealLines
            lines={[{ text: "11 categories" }, { text: "Ages 8 to 50+", color: VOLT }]}
            progress={endLines}
            size={92}
            align="center"
          />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
            <div style={{ opacity: deadline }}>
              <Mono size={52} color={BONE} tracking="0.1em">
                Entries close Nov 18
              </Mono>
            </div>
            <div style={{ position: "relative", width: 640, height: 5 }}>
              <div style={{ position: "absolute", left: (640 * (1 - deadline)) / 2, width: 640 * deadline, height: 5, backgroundColor: VOLT }} />
            </div>
            <div style={{ opacity: url }}>
              <Mono size={40} color={BONE} tracking="0.04em">
                shuttlestorm.adawar.org/register
              </Mono>
            </div>
          </div>
          <div style={{ transform: `translateY(${interpolate(lockup, [0, 1], [1300, 0], { ...clamp, easing: ease })}px)` }}>
            <Lockup size={116} />
          </div>
        </div>
      </World>
    </AbsoluteFill>
  );
};
