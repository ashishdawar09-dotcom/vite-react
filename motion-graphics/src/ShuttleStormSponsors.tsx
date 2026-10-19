import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import {
  BONE,
  CSS_W,
  LINE,
  Lockup,
  Mono,
  RevealLines,
  SiteCrop,
  Underline,
  VOLT,
  WORLD,
  cameraAt,
  clamp,
  easeOut,
  m,
  ramp,
  World,
} from "./shuttle/shared";

// Sponsors (9:16): the sponsors page's own thank-you, then the presenting
// sponsor and the six supporters' real logo tiles converge into one wall, then
// the page's own ask, "Back the storm.", with the directors' phone number.
// openmontage-hook mechanism: separate businesses collapse into one system.

export const SPONSORS = { width: 1080, height: 1920, duration: 270 };

const S = 2.4;
const X = (1080 - CSS_W * S) / 2;
const WALL_W = CSS_W * S;
const GAP = 36;
const TILE_W = (WALL_W - GAP) / 2;
const TILE_H = (TILE_W * m.sponsors.tile.h) / m.sponsors.tile.w;
// The presenting block down to (not including) its repeated "ADW" heading.
const ADW = { top: 0, height: 182 };

const introY = 0;
const introH = m.sponsors.intro.h * S;
const adwY = introH + 200;
const tilesY = adwY + ADW.height * S + GAP;
const wallBottom = tilesY + 3 * TILE_H + 2 * GAP;
const joinY = wallBottom + 420;
const joinH = m.sponsors.join.h * S;
const contactY = joinY + joinH + 90;
const endBottom = contactY + 560;

const wallCenter = (adwY + wallBottom) / 2;
const endCenter = (joinY + endBottom) / 2;

export const ShuttleStormSponsors: React.FC = () => {
  const frame = useCurrentFrame();

  const cam = cameraAt(frame, [
    { t: 0, x: 540, y: introY + introH / 2, z: 1.0 },
    { t: 40, x: 540, y: introY + introH / 2 + 60, z: 0.96 },
    { t: 66, x: 540, y: wallCenter, z: 0.92 },
    { t: 156, x: 540, y: wallCenter, z: 0.92 },
    { t: 186, x: 540, y: endCenter, z: 0.94 },
    { t: SPONSORS.duration, x: 540, y: endCenter, z: 0.94 },
  ]);

  const lede = ramp(frame, 10, 30);
  // The presenting sponsor and the supporters converge from the sides.
  const adwIn = ramp(frame, 50, 70, easeOut);
  const tileIn = (i: number) => ramp(frame, 58 + i * 5, 78 + i * 5, easeOut);
  const backTheStorm = ramp(frame, 194, 208);
  const contact = [0, 1].map((i) => ramp(frame, 196 + i * 6, 210 + i * 6));

  return (
    <AbsoluteFill style={{ backgroundColor: WORLD, overflow: "hidden" }}>
      <World cam={cam} width={SPONSORS.width} height={SPONSORS.height}>
        <SiteCrop file="site-sponsors-intro" imageHeight={278} height={m.sponsors.intro.h} scale={S} x={X} y={introY}>
          <Underline lines={m.sponsors.intro.lede} progress={lede} />
        </SiteCrop>

        {adwIn > 0 ? (
          <div style={{ transform: `translateX(${(1 - adwIn) * -1200}px)` }}>
            <SiteCrop file="site-sponsors-adw" imageHeight={605} top={ADW.top} height={ADW.height} scale={S} x={X} y={adwY} />
          </div>
        ) : null}

        {m.sponsors.tiles.map((id, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const t = tileIn(i);
          const fromX = col === 0 ? -1200 : 1200;
          return (
            <div
              key={id}
              style={{
                position: "absolute",
                left: X + col * (TILE_W + GAP) + interpolate(t, [0, 1], [fromX, 0], clamp),
                top: tilesY + row * (TILE_H + GAP),
                width: TILE_W,
                height: TILE_H,
                borderRadius: 22,
                overflow: "hidden",
                boxShadow: `0 0 0 1.5px ${LINE}`,
              }}
            >
              <Img
                src={staticFile(`research/site-sponsor-${id}.png`)}
                style={{ width: TILE_W, height: TILE_H, display: "block" }}
              />
            </div>
          );
        })}

        <SiteCrop file="site-sponsors-join" imageHeight={414} height={m.sponsors.join.h} scale={S} x={X} y={joinY}>
          <Underline lines={m.sponsors.join.title} progress={backTheStorm} thickness={2.4} />
        </SiteCrop>

        <div
          style={{
            position: "absolute",
            left: 0,
            top: contactY,
            width: 1080,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 26,
          }}
        >
          <RevealLines
            lines={[{ text: "(778) 964-6999", color: VOLT }]}
            progress={[contact[0]]}
            size={92}
            weight={800}
          />
          <div style={{ opacity: contact[1] }}>
            <Mono size={34} color={BONE} tracking="0.08em">
              shuttlestorm.adawar.org/sponsors
            </Mono>
          </div>
          <div style={{ marginTop: 70 }}>
            <Lockup size={64} dateLine={false} />
          </div>
        </div>
      </World>
    </AbsoluteFill>
  );
};
