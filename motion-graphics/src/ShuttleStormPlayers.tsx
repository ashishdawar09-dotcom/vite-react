import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
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
  m,
  ramp,
  World,
} from "./shuttle/shared";

// Players (9:16): open on the site's own shuttle art, then the club's two
// promises (feather shuttles, great prizes — supplied by the organisers) with
// the site's "16 feathers" fact, then the register page's real "Your day,
// start to finish" steps, then the categories and the entry deadline.
// openmontage-claude-pipeline mechanism: one path from the hook to finals.

export const PLAYERS = { width: 1080, height: 1920, duration: 300 };

const S = 2.4;
const X = (1080 - CSS_W * S) / 2;
const ART = { top: 300, height: 300 };
const FEATHERS = { top: 160, height: 170 };
const MARGIN = X + 36;

const artY = 0;
const headlineY = artY + ART.height * S + 70;
const factY = headlineY + 300;
const prizesY = factY + FEATHERS.height * S + 80;
const dayY = prizesY + 330 + 260;
const dayH = m.registerDay.h * S;
const endY = dayY + dayH + 260;
const END_H = 1300;

const stepCenter = (i: number) => dayY + (m.registerDay.steps[i].y + m.registerDay.steps[i].h / 2) * S;

export const ShuttleStormPlayers: React.FC = () => {
  const frame = useCurrentFrame();

  const hookCenter = (artY + prizesY + 330) / 2;
  const cam = cameraAt(frame, [
    { t: 0, x: 540, y: artY + (ART.height * S) / 2, z: 1.5 },
    { t: 14, x: 540, y: artY + (ART.height * S) / 2, z: 1.42 },
    { t: 40, x: 540, y: hookCenter, z: 0.96 },
    { t: 112, x: 540, y: hookCenter, z: 0.96 },
    { t: 138, x: 540, y: stepCenter(0) + 300, z: 1.05 },
    { t: 192, x: 540, y: stepCenter(4) - 300, z: 1.05 },
    { t: 222, x: 540, y: endY + END_H / 2, z: 1 },
    { t: PLAYERS.duration, x: 540, y: endY + END_H / 2, z: 1 },
  ]);

  const feather = [0, 1].map((i) => ramp(frame, 30 + i * 6, 44 + i * 6));
  const feathersLine = ramp(frame, 50, 64);
  const prizes = [0, 1].map((i) => ramp(frame, 70 + i * 6, 84 + i * 6));
  const steps = [0, 1, 2, 3, 4].map((i) => ramp(frame, 146 + i * 10, 154 + i * 10));
  const endLines = [0, 1].map((i) => ramp(frame, 214 + i * 6, 228 + i * 6));
  const deadline = ramp(frame, 236, 252);

  return (
    <AbsoluteFill style={{ backgroundColor: WORLD, overflow: "hidden" }}>
      <World cam={cam} width={PLAYERS.width} height={PLAYERS.height}>
        <SiteCrop file="site-home-everypoint" imageHeight={932} top={ART.top} height={ART.height} scale={S} x={X} y={artY} />

        <div style={{ position: "absolute", left: MARGIN, top: headlineY }}>
          <RevealLines
            lines={[{ text: "Feather" }, { text: "shuttles.", color: VOLT }]}
            progress={feather}
            size={118}
          />
        </div>

        <SiteCrop file="site-home-facts" imageHeight={560} top={FEATHERS.top} height={FEATHERS.height} scale={S} x={X} y={factY}>
          <Underline lines={m.homeFacts.feathersLine} progress={feathersLine} offsetY={10} thickness={2.4} />
        </SiteCrop>

        <div style={{ position: "absolute", left: MARGIN, top: prizesY }}>
          <RevealLines lines={[{ text: "Great" }, { text: "prizes.", color: VOLT }]} progress={prizes} size={118} />
        </div>

        <SiteCrop file="site-register-day" imageHeight={624} height={m.registerDay.h} scale={S} x={X} y={dayY}>
          {m.registerDay.steps.map((st, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: st.x - 26,
                top: st.y + 2,
                width: 3,
                height: (st.h - 8) * steps[i],
                backgroundColor: VOLT,
              }}
            />
          ))}
        </SiteCrop>

        <div
          style={{
            position: "absolute",
            left: 0,
            top: endY,
            width: 1080,
            height: END_H,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 90,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
            <RevealLines
              lines={[{ text: "11 categories" }, { text: "Ages 8 to 50+", color: VOLT }]}
              progress={endLines}
              size={80}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
            <Mono size={40} color={BONE} tracking="0.12em">
              Entries close Nov 18
            </Mono>
            <div style={{ position: "relative", width: 560, height: 4 }}>
              <div style={{ position: "absolute", left: 0, top: 0, width: 560 * deadline, height: 4, backgroundColor: VOLT }} />
            </div>
            <Mono size={32} color={BONE} tracking="0.08em">
              shuttlestorm.adawar.org/register
            </Mono>
          </div>
          <Lockup size={84} />
        </div>
      </World>
    </AbsoluteFill>
  );
};
