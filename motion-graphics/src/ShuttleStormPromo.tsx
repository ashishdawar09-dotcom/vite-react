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

// Marketing (9:16): the camera travels down the real Shuttle Storm home page
// (hero → "Eleven categories. Juniors to masters." → the numbers), pushing in
// so each fact is marked at readable size, and lands on the site film's end
// card. kickbacks-same-run-editor mechanism: the site is the world.

export const PROMO = { width: 1080, height: 1920, duration: 240 };

const S = 2.4;
const X = (1080 - CSS_W * S) / 2;
const HERO = { top: 0, height: 900 };
const STATEMENT = { top: 120, height: 400 };
const NUMBERS = { top: 140, height: 380 };

const heroY = 0;
const statementY = heroY + HERO.height * S + 96;
const numbersY = statementY + STATEMENT.height * S + 96;
const END_H = 1440;
const endY = numbersY + NUMBERS.height * S + (1920 - END_H) / 2 + 40;

const at = (top: number, cropTop: number, cssY: number) => top + (cssY - cropTop) * S;
const atX = (cssX: number) => X + cssX * S;

// Opening: the whole hero from the nav down to the title (h1 at CSS y 554–658),
// framed so the meta paragraph below (y 685–865) starts just under the frame.
const OPEN_Z = 1.15;
const titleFocus = { x: 540, y: at(heroY, HERO.top, 685) - 960 / OPEN_Z - 6 };
const paraFocus = { x: atX(215), y: at(heroY, HERO.top, 742) };

export const ShuttleStormPromo: React.FC = () => {
  const frame = useCurrentFrame();

  const cam = cameraAt(frame, [
    { t: 0, ...titleFocus, z: OPEN_Z },
    { t: 8, ...titleFocus, z: OPEN_Z - 0.02 },
    { t: 26, ...paraFocus, z: 1.12 },
    { t: 48, ...paraFocus, z: 1.12 },
    { t: 70, x: 540, y: statementY + (STATEMENT.height * S) / 2, z: 1 },
    { t: 88, x: 540, y: statementY + (STATEMENT.height * S) / 2, z: 1 },
    { t: 108, x: 540, y: numbersY + (NUMBERS.height * S) / 2, z: 1.08 },
    { t: 134, x: 540, y: numbersY + (NUMBERS.height * S) / 2, z: 1.08 },
    { t: 154, x: 540, y: endY + END_H / 2, z: 1 },
    { t: PROMO.duration, x: 540, y: endY + END_H / 2, z: 1 },
  ]);

  const date = ramp(frame, 22, 34);
  const ages = ramp(frame, 32, 48);
  const claim = ramp(frame, 70, 88);
  const nums = [0, 1, 2, 3].map((i) => ramp(frame, 110 + i * 6, 118 + i * 6));
  const endLines = [0, 1].map((i) => ramp(frame, 150 + i * 6, 164 + i * 6));
  const rule = ramp(frame, 160, 172);
  const url = ramp(frame, 166, 176);

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
          {m.homeNumbers.numeralText.map((n, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: n.x,
                top: n.y + n.h - 4,
                width: n.w * nums[i],
                height: 2.6,
                backgroundColor: VOLT,
              }}
            />
          ))}
        </SiteCrop>

        {/* End card, centred on one axis: the site film's lockup, the deadline, the address. */}
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
            gap: 120,
          }}
        >
          <Lockup size={128} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
            <RevealLines
              lines={[{ text: "Entries close" }, { text: "Nov 18", color: VOLT }]}
              progress={endLines}
              size={92}
              align="center"
            />
            <div style={{ position: "relative", width: 700, height: 5 }}>
              <div style={{ position: "absolute", left: (700 * (1 - rule)) / 2, top: 0, width: 700 * rule, height: 5, backgroundColor: VOLT }} />
            </div>
            <div style={{ opacity: url }}>
              <Mono size={40} color={BONE} tracking="0.06em">
                shuttlestorm.adawar.org
              </Mono>
            </div>
          </div>
        </div>
      </World>
    </AbsoluteFill>
  );
};
