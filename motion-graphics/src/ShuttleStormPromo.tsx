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

// Marketing (9:16): the camera travels down the real Shuttle Storm home page
// (hero → "Eleven categories. Juniors to masters." → the numbers), pushing in
// so each fact is marked at readable size. The volt mark then leaves the
// numbers card as one rule that carries the end card: the deadline, the
// address and the site film's lockup. kickbacks-same-run-editor mechanism:
// the site is the world.

export const PROMO = { width: 1080, height: 1920, duration: 240 };

const S = 2.4;
const X = (1080 - CSS_W * S) / 2;
const HERO = { top: 0, height: 900 };
const STATEMENT = { top: 120, height: 400 };
const NUMBERS = { top: 140, height: 380 };

const heroY = 0;
const statementY = heroY + HERO.height * S + 96;
const numbersY = statementY + STATEMENT.height * S + 96;
const numbersBottom = numbersY + NUMBERS.height * S;

const at = (top: number, cropTop: number, cssY: number) => top + (cssY - cropTop) * S;
const atX = (cssX: number) => X + cssX * S;

// Opening: the whole hero card, nav to paragraph, with its own side padding.
const OPEN_Z = 0.95;
const heroFocus = { x: 540, y: 1010 };
// Push in on "Saturday, November 21", then ease back to the full ages sentence.
const date = m.homeHero.date[0];
// Pivot so the hero's left text edge stays in frame at 1.3×.
const DATE_Z = 1.3;
const dateFocus = { x: atX(18) + 540 / DATE_Z - 24, y: at(heroY, HERO.top, date.y + date.h / 2) };
const paraFocus = { x: atX(205), y: at(heroY, HERO.top, 737) };

// The "$30–40" numeral wraps onto two lines; each line gets its own mark at
// its measured glyph run. The others are single-line.
const NUM_MARKS = m.homeNumbers.numeralText.map((n, i) =>
  i === 3
    ? [
        { x: n.x + 2, y: 399, w: 135 },
        { x: n.x + 2, y: 449, w: 68 },
      ]
    : [{ x: n.x, y: n.y + n.h - 4, w: n.w }],
);

// End card: the volt rule leaves the numbers card and runs down as the margin
// rule of the deadline and address, over the site film's lockup. The final
// frame holds the whole numbers card above it, so the stack reads as one page.
const RULE_X = atX(25);
const endTop = numbersBottom + 80;
const urlTop = endTop + 190;
const ruleEnd = urlTop + 58;
const lockupTop = ruleEnd + 90;
const endBottom = lockupTop + 330;
const END_Z = 0.96;
// Nudged down so the statement card above stays just out of frame.
const endCenter = (numbersY + endBottom) / 2 + 80;

export const ShuttleStormPromo: React.FC = () => {
  const frame = useCurrentFrame();

  const cam = cameraAt(frame, [
    { t: 0, ...heroFocus, z: OPEN_Z },
    { t: 8, ...heroFocus, z: OPEN_Z + 0.01 },
    { t: 26, ...dateFocus, z: DATE_Z },
    { t: 40, ...dateFocus, z: DATE_Z },
    { t: 52, ...paraFocus, z: 1.1 },
    { t: 66, ...paraFocus, z: 1.1 },
    { t: 86, x: 540, y: statementY + (STATEMENT.height * S) / 2, z: 1 },
    { t: 102, x: 540, y: statementY + (STATEMENT.height * S) / 2, z: 1 },
    // The card sits low in frame, under the statement's last lines, so the
    // rule has room to leave it.
    { t: 120, x: 540, y: numbersY + (NUMBERS.height * S) / 2 - 200, z: 1.08 },
    { t: 138, x: 540, y: numbersY + (NUMBERS.height * S) / 2 - 200, z: 1.08 },
    // The camera rides down with the rule's head.
    { t: 164, x: 540, y: endCenter, z: END_Z },
    { t: PROMO.duration, x: 540, y: endCenter, z: END_Z },
  ]);

  const dateMark = ramp(frame, 26, 38);
  const ages = ramp(frame, 50, 64);
  const claim = ramp(frame, 86, 100);
  const nums = [0, 1, 2, 3].map((i) => ramp(frame, 120 + i * 5, 130 + i * 5));
  const rule = ramp(frame, 136, 162);
  const endLines = [0, 1].map((i) => ramp(frame, 146 + i * 6, 162 + i * 6));
  const url = ramp(frame, 166, 176);
  // The lockup rises on the same curve as the rule's descent.
  const lockup = ramp(frame, 152, 178);

  return (
    <AbsoluteFill style={{ backgroundColor: WORLD, overflow: "hidden" }}>
      <World cam={cam} width={PROMO.width} height={PROMO.height}>
        <SiteCrop file="site-home-hero" imageHeight={940} top={HERO.top} height={HERO.height} scale={S} x={X} y={heroY}>
          <Underline lines={m.homeHero.date} progress={dateMark} />
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
          {NUM_MARKS.map((marks, i) => (
            <Underline key={i} lines={marks.map((r) => ({ ...r, y: r.y - 1 - 2.6, h: 2.6 }))} progress={nums[i]} thickness={2.6} />
          ))}
        </SiteCrop>

        <div
          style={{
            position: "absolute",
            left: RULE_X,
            top: numbersBottom,
            width: 9,
            height: (ruleEnd - numbersBottom) * rule,
            backgroundColor: VOLT,
          }}
        />
        <div style={{ position: "absolute", left: RULE_X + 44, top: endTop }}>
          <RevealLines lines={[{ text: "Entries close" }, { text: "Nov 18", color: VOLT }]} progress={endLines} size={86} />
        </div>
        <div style={{ position: "absolute", left: RULE_X + 44, top: urlTop, opacity: url }}>
          <Mono size={44} color={BONE} tracking="0.05em">
            shuttlestorm.adawar.org
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
            transform: `translateY(${interpolate(lockup, [0, 1], [360, 0], { ...clamp, easing: ease })}px)`,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <Lockup size={96} dateLine={false} />
            {/* The site film's date line, set large on two lines for phones. */}
            <div style={{ marginTop: 30 }}>
              <Mono size={42} color={BONE} tracking="0.02em">
                Nov 21 2026
              </Mono>
            </div>
            <Mono size={42} color={BONE} tracking="0.02em">
              UFV North Gym · Abbotsford BC
            </Mono>
          </div>
        </div>
      </World>
    </AbsoluteFill>
  );
};
