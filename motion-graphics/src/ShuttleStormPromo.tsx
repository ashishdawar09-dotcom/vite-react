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

// Marketing (9:16): the camera travels down the real Shuttle Storm home page
// (hero → "Eleven categories. Juniors to masters." → the numbers), marking the
// facts as it reaches them, and lands on the site film's end card.
// kickbacks-same-run-editor mechanism: the site is the world.

export const PROMO = { width: 1080, height: 1920, duration: 270 };

const S = 2.4;
const X = (1080 - 430 * S) / 2;
const HERO = { top: 240, height: 660 };
const STATEMENT = { top: 120, height: 400 };
const NUMBERS = { top: 140, height: 380 };

const heroY = 0;
const statementY = heroY + HERO.height * S + 96;
const numbersY = statementY + STATEMENT.height * S + 96;
const endY = numbersY + NUMBERS.height * S + 220;
const END_H = 1300;

const at = (top: number, cropTop: number, cssY: number) => top + (cssY - cropTop) * S;

export const ShuttleStormPromo: React.FC = () => {
  const frame = useCurrentFrame();

  const cam = cameraAt(frame, [
    { t: 0, x: 470, y: at(heroY, HERO.top, 606), z: 1.38 },
    { t: 10, x: 470, y: at(heroY, HERO.top, 606), z: 1.34 },
    { t: 36, x: 540, y: heroY + (HERO.height * S) / 2, z: 1 },
    { t: 58, x: 540, y: heroY + (HERO.height * S) / 2, z: 1 },
    { t: 82, x: 540, y: statementY + (STATEMENT.height * S) / 2, z: 1 },
    { t: 118, x: 540, y: statementY + (STATEMENT.height * S) / 2, z: 1 },
    { t: 142, x: 540, y: numbersY + (NUMBERS.height * S) / 2, z: 1 },
    { t: 188, x: 540, y: numbersY + (NUMBERS.height * S) / 2, z: 1 },
    { t: 214, x: 540, y: endY + END_H / 2, z: 1 },
    { t: PROMO.duration, x: 540, y: endY + END_H / 2, z: 1 },
  ]);

  const date = ramp(frame, 30, 44);
  const ages = ramp(frame, 42, 58);
  const claim = ramp(frame, 86, 106);
  const nums = [0, 1, 2, 3].map((i) => ramp(frame, 146 + i * 8, 156 + i * 8));
  const endLines = [0, 1].map((i) => ramp(frame, 206 + i * 6, 220 + i * 6));
  const deadline = ramp(frame, 228, 244);

  return (
    <AbsoluteFill style={{ backgroundColor: WORLD, overflow: "hidden" }}>
      <World cam={cam} width={PROMO.width} height={PROMO.height}>
        <SiteCrop file="site-home-hero" imageHeight={940} top={HERO.top} height={HERO.height} scale={S} x={X} y={heroY}>
          <Underline lines={m.homeHero.date} progress={date} />
          <Underline lines={m.homeHero.ages} progress={ages} />
        </SiteCrop>

        <SiteCrop
          file="site-home-statement"
          imageHeight={704}
          top={STATEMENT.top}
          height={STATEMENT.height}
          scale={S}
          x={X}
          y={statementY}
        >
          <Underline lines={m.homeStatement.claim} progress={claim} thickness={2.4} />
        </SiteCrop>

        <SiteCrop file="site-home-numbers" imageHeight={659} top={NUMBERS.top} height={NUMBERS.height} scale={S} x={X} y={numbersY}>
          {m.homeNumbers.numerals.map((n, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: n.x,
                top: n.y + n.h + 2,
                width: n.w * nums[i],
                height: 2.4,
                backgroundColor: VOLT,
              }}
            />
          ))}
        </SiteCrop>

        {/* End card: the site film's lockup, then the deadline and address. */}
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
            gap: 110,
          }}
        >
          <Lockup size={112} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30 }}>
            <RevealLines
              lines={[{ text: "Entries close" }, { text: "Nov 18", color: VOLT }]}
              progress={endLines}
              size={78}
              weight={800}
            />
            <div style={{ position: "relative", width: 640, height: 4 }}>
              <div style={{ position: "absolute", left: 0, top: 0, width: 640 * deadline, height: 4, backgroundColor: VOLT }} />
            </div>
            <Mono size={36} color={BONE} tracking="0.08em">
              shuttlestorm.adawar.org
            </Mono>
          </div>
        </div>
      </World>
    </AbsoluteFill>
  );
};
