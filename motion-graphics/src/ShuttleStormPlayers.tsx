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
// One volt thread then runs down into the register page's real "Your day,
// start to finish", becoming each step's marker as that step lights, and on
// past step 5 as the margin rule of the end card.
// openmontage-claude-pipeline mechanism: one connected path, camera on its head.

export const PLAYERS = { width: 1080, height: 1920, duration: 300 };

const S = 2.4;
const X = (1080 - CSS_W * S) / 2;
const ART = { top: 300, height: 300 };
const FEATHERS = { top: 160, height: 170 };

// The register card sits with ~67 px gutters so its step markers stay in frame.
const SD = 2.2;
const XD = (1080 - CSS_W * SD) / 2;
const steps = m.registerDay.steps;
const BAR_W = 4 * SD;
const BAR_X = XD + (steps[0].x - 28) * SD;
const TEXT_X = BAR_X;

const artY = 0;
const headlineY = artY + ART.height * S + 60;
const factY = headlineY + 290;
const prizesY = factY + FEATHERS.height * S + 60;
const prizesBottom = prizesY + 270;
const dayY = prizesBottom + 260;
const dayH = m.registerDay.h * SD;
const dayBottom = dayY + dayH;

const stepTop = (i: number) => dayY + (steps[i].y + 2) * SD;
const stepBottom = (i: number) => dayY + (steps[i].y + steps[i].h - 6) * SD;
// The card nearly fills the frame; the camera drifts a little with the active step.
const stepCam = (i: number) => dayY + dayH / 2 + (i - 2) * 70;

// End card: a left-ruled fact stack continuing the thread, then the lockup.
const endTop = dayBottom + 150;
const deadlineTop = endTop + 210;
const urlTop = deadlineTop + 86;
const barEnd = urlTop + 50;
const lockupTop = barEnd + 190;
// Framed from the step-5 card's bottom to the lockup's date line.
const endCenter = (dayBottom - 220 + lockupTop + 270) / 2;

// Timeline (frames).
const T = {
  leave: 66,
  thread1: [66, 88],
  step0: 90,
  stepEvery: 26,
  travel: 8,
};
const stepAt = (i: number) => T.step0 + i * T.stepEvery;
const END = stepAt(4) + T.travel + 18;

export const ShuttleStormPlayers: React.FC = () => {
  const frame = useCurrentFrame();

  const hookCenter = (artY + prizesBottom) / 2;
  const stepKeys = steps.flatMap((_, i) => [
    { t: i === 0 ? stepAt(0) : stepAt(i) + T.travel, x: 540, y: stepCam(i), z: 1 },
    { t: stepAt(i + 1), x: 540, y: stepCam(i), z: 1 },
  ]);
  const cam = cameraAt(frame, [
    { t: 0, x: 540, y: artY + (ART.height * S) / 2, z: 1.4 },
    { t: 4, x: 540, y: artY + (ART.height * S) / 2, z: 1.38 },
    { t: 30, x: 540, y: hookCenter, z: 0.93 },
    { t: T.leave, x: 540, y: hookCenter, z: 0.93 },
    ...stepKeys.slice(0, -1),
    { t: END, x: 540, y: stepCam(4), z: 1 },
    { t: END + 22, x: 540, y: endCenter, z: 1 },
    { t: PLAYERS.duration, x: 540, y: endCenter, z: 1 },
  ]);

  const feather = [0, 1].map((i) => ramp(frame, 10 + i * 5, 24 + i * 5));
  // The fact card arrives once the pull-back has it whole in frame.
  const factIn = ramp(frame, 18, 26);
  const feathersLine = ramp(frame, 26, 38);
  const prizes = [0, 1].map((i) => ramp(frame, 32 + i * 5, 46 + i * 5));

  // The thread's head: down to step 1, through each step as it lights, then
  // on past step 5 alongside the end card's facts.
  const barKeys: [number, number][] = [
    [T.thread1[0], prizesBottom + 20],
    [T.thread1[1], stepTop(0)],
    [stepAt(0), stepTop(0)],
    [stepAt(0) + T.travel, stepBottom(0)],
    ...[1, 2, 3, 4].flatMap((i): [number, number][] => [
      [stepAt(i), stepBottom(i - 1)],
      [stepAt(i) + T.travel, stepBottom(i)],
    ]),
    [END, stepBottom(4)],
    [END + 20, barEnd],
  ];
  const head = interpolate(
    frame,
    barKeys.map((k) => k[0]),
    barKeys.map((k) => k[1]),
    { ...clamp, easing: ease },
  );
  const showBar = frame >= T.thread1[0];
  const active = Math.max(0, Math.min(4, Math.floor((frame - stepAt(0)) / T.stepEvery)));
  const inSteps = frame >= stepAt(0) - 4 && frame < END + 4;

  const endLines = [0, 1].map((i) => ramp(frame, END + 6 + i * 5, END + 20 + i * 5));
  const deadline = ramp(frame, END + 18, END + 28);
  const url = ramp(frame, END + 22, END + 32);
  const lockup = ramp(frame, END + 26, END + 40);

  return (
    <AbsoluteFill style={{ backgroundColor: WORLD, overflow: "hidden" }}>
      <World cam={cam} width={PLAYERS.width} height={PLAYERS.height}>
        <SiteCrop file="site-home-everypoint" imageHeight={932} top={ART.top} height={ART.height} scale={S} x={X} y={artY} />

        <div style={{ position: "absolute", left: TEXT_X, top: headlineY }}>
          <RevealLines lines={[{ text: "Feather" }, { text: "shuttles.", color: VOLT }]} progress={feather} size={118} />
        </div>

        <div style={{ opacity: factIn }}>
          <SiteCrop file="site-home-facts" imageHeight={560} top={FEATHERS.top} height={FEATHERS.height} scale={S} x={X} y={factY}>
            <Underline lines={m.homeFacts.feathersLine} progress={feathersLine} offsetY={10} thickness={2.4} />
          </SiteCrop>
        </div>

        <div style={{ position: "absolute", left: TEXT_X, top: prizesY }}>
          <RevealLines lines={[{ text: "Great" }, { text: "prizes.", color: VOLT }]} progress={prizes} size={118} />
        </div>

        <SiteCrop file="site-register-day" imageHeight={624} height={m.registerDay.h} scale={SD} x={XD} y={dayY}>
          {steps.map((st, i) => (
            // Steps not in focus recede while the thread is on the list.
            <div
              key={i}
              style={{
                position: "absolute",
                left: 0,
                top: st.y - 4,
                width: CSS_W,
                height: st.h + 6,
                backgroundColor: `rgba(6, 8, 13, ${inSteps && i !== active ? 0.55 : 0})`,
              }}
            />
          ))}
        </SiteCrop>

        {/* The thread: one volt bar, which is also each step's marker. */}
        {showBar ? (
          <div
            style={{
              position: "absolute",
              left: BAR_X,
              top: prizesBottom + 20,
              width: BAR_W,
              height: Math.max(0, head - prizesBottom - 20),
              backgroundColor: VOLT,
            }}
          />
        ) : null}

        <div style={{ position: "absolute", left: TEXT_X + 44, top: endTop }}>
          <RevealLines lines={[{ text: "11 categories" }, { text: "Ages 8 to 50+", color: VOLT }]} progress={endLines} size={86} />
        </div>
        <div style={{ position: "absolute", left: TEXT_X + 44, top: deadlineTop, opacity: deadline }}>
          <Mono size={54} color={BONE} tracking="0.08em">
            Entries close <span style={{ color: VOLT }}>Nov 18</span>
          </Mono>
        </div>
        <div style={{ position: "absolute", left: TEXT_X + 44, top: urlTop, opacity: url }}>
          <Mono size={38} color={BONE} tracking="0.04em">
            shuttlestorm.adawar.org/register
          </Mono>
        </div>

        <div
          style={{
            position: "absolute",
            left: 0,
            top: lockupTop,
            width: 1080,
            display: "flex",
            justifyContent: "center",
            transform: `translateY(${interpolate(lockup, [0, 1], [900, 0], { ...clamp, easing: ease })}px)`,
          }}
        >
          <Lockup size={100} />
        </div>
      </World>
    </AbsoluteFill>
  );
};
