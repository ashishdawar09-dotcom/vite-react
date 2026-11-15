import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import {
  CSS_W,
  LINE,
  Lockup,
  Mono,
  BONE,
  RevealLines,
  SiteCrop,
  Underline,
  VOLT,
  WORLD,
  cameraAt,
  clamp,
  m,
  ramp,
  World,
} from "./shuttle/shared";

// Sponsors (9:16): the sponsors page's own thank-you, with the seven sponsors'
// real logo tiles scattered below it; they converge into one wall under the
// presenting sponsor, and that wall then lifts to dock the page's own ask,
// "Back the storm.", with the club phone number. openmontage-hook mechanism:
// separate businesses collapse into one system, and the ask is its consequence.

export const SPONSORS = { width: 1080, height: 1920, duration: 240 };

const S = 2.4;
const X = (1080 - CSS_W * S) / 2;
const sp = m.sponsors;
const TILE_RATIO = sp.tile.h / sp.tile.w;
// Presenting block: cropped at the card's own edges, down to just under its tag line.
const ADW = { left: sp.presenting.x, width: sp.presenting.w, height: sp.presentingTag[0].y + sp.presentingTag[0].h + 22 };
const JOIN = { left: sp.join.x, width: sp.join.w, height: sp.join.h };

type Layout = { adw: { y: number; s: number }; tiles: { x: number; y: number; w: number }[] };

// Wall: the presenting block over a 3×2 grid of supporter tiles, centred.
const wall = (top: number, s: number, gap: number): Layout => {
  const w = ADW.width * s;
  const left = (1080 - w) / 2;
  const tw = (w - 2 * gap) / 3;
  const th = tw * TILE_RATIO;
  const tilesTop = top + ADW.height * s + gap;
  return {
    adw: { y: top, s },
    tiles: sp.tiles.map((_, i) => ({
      x: left + (i % 3) * (tw + gap),
      y: tilesTop + Math.floor(i / 3) * (th + gap),
      w: tw,
    })),
  };
};

const introY = 70;
const WALL = wall(830, 2.3, 18);
const DOCKED = wall(56, 1.8, 14);
const dockedBottom = DOCKED.tiles[5].y + DOCKED.tiles[5].w * TILE_RATIO;
const JOIN_S = 1.8;
const joinY = dockedBottom + 30;
const joinX = (1080 - JOIN.width * JOIN_S) / 2;
const contactY = joinY + JOIN.height * JOIN_S + 34;

// Scattered starting spots: each tile starts out along its own ray from the
// grid's centre (so no two paths cross), some cut by the frame edges.
const gridCx = (WALL.tiles[0].x + WALL.tiles[2].x + WALL.tiles[2].w) / 2;
const gridCy = (WALL.tiles[0].y + WALL.tiles[5].y + WALL.tiles[5].w * TILE_RATIO) / 2;
const SCATTER = WALL.tiles.map((t) => {
  const cx = t.x + t.w / 2;
  const cy = t.y + (t.w * TILE_RATIO) / 2;
  const w = t.w * 1.08;
  return { x: gridCx + (cx - gridCx) * 2.1 - w / 2, y: gridCy + (cy - gridCy) * 2.3 + 110 - (w * TILE_RATIO) / 2, w };
});
const ADW_SCATTER = { x: -620, y: WALL.adw.y, s: WALL.adw.s };

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export const ShuttleStormSponsors: React.FC = () => {
  const frame = useCurrentFrame();

  const cam = cameraAt(frame, [
    { t: 0, x: 540, y: 960, z: 1.03 },
    { t: 30, x: 540, y: 960, z: 1 },
    { t: SPONSORS.duration, x: 540, y: 960, z: 1 },
  ]);

  const lede = ramp(frame, 6, 24);
  // Tiles converge staggered; ADW slides in on its own row.
  const convergeAt = (i: number) => ramp(frame, 26 + i * 4, 56 + i * 4);
  const converge = ramp(frame, 26, 60);
  // The wall rises and tightens first; the ask then docks under it.
  const dock = ramp(frame, 96, 118);
  const askIn = interpolate(frame, [112, 132], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) });
  const backTheStorm = ramp(frame, 134, 148);
  const contact = ramp(frame, 138, 152);
  const lockup = ramp(frame, 146, 160);

  const placeTile = (i: number) => {
    const a = SCATTER[i];
    const b = WALL.tiles[i];
    const c = DOCKED.tiles[i];
    const k = convergeAt(i);
    const x = mix(mix(a.x, b.x, k), c.x, dock);
    const y = mix(mix(a.y, b.y, k), c.y, dock);
    const w = mix(mix(a.w, b.w, k), c.w, dock);
    return { x, y, w };
  };
  const last = placeTile(5);
  const wallBottom = last.y + last.w * TILE_RATIO;
  // The ask never overlaps the wall: its top stays at least 30 px under it.
  const askY = Math.max(interpolate(askIn, [0, 1], [1930, joinY]), wallBottom + 30);
  const adwX = mix(mix(ADW_SCATTER.x, (1080 - ADW.width * WALL.adw.s) / 2, converge), (1080 - ADW.width * DOCKED.adw.s) / 2, dock);
  const adwY = mix(mix(ADW_SCATTER.y, WALL.adw.y, converge), DOCKED.adw.y, dock);
  const adwS = mix(mix(ADW_SCATTER.s, WALL.adw.s, converge), DOCKED.adw.s, dock);

  return (
    <AbsoluteFill style={{ backgroundColor: WORLD, overflow: "hidden" }}>
      <World cam={cam} width={SPONSORS.width} height={SPONSORS.height}>
        {/* The page's thank-you; it leaves as the wall docks. */}
        <SiteCrop
          file="site-sponsors-intro"
          imageHeight={278}
          height={sp.intro.h}
          scale={S}
          x={X}
          y={interpolate(dock, [0, 1], [introY, -760], clamp)}
        >
          <Underline lines={sp.intro.lede} progress={lede} />
        </SiteCrop>

        <SiteCrop
          file="site-sponsors-adw"
          imageHeight={605}
          left={ADW.left}
          width={ADW.width}
          height={ADW.height}
          scale={adwS}
          x={adwX}
          y={adwY}
          radius={6}
        />

        {sp.tiles.map((id, i) => {
          const t = placeTile(i);
          return (
            <div
              key={id}
              style={{
                position: "absolute",
                left: t.x,
                top: t.y,
                width: t.w,
                height: t.w * TILE_RATIO,
                borderRadius: 4,
                overflow: "hidden",
                boxShadow: `0 0 0 1.5px ${LINE}`,
              }}
            >
              <Img src={staticFile(`research/site-sponsor-${id}.png`)} style={{ width: "100%", height: "100%", display: "block" }} />
            </div>
          );
        })}

        {/* The ask docks under the wall, as its consequence. */}
        <SiteCrop
          file="site-sponsors-join"
          imageHeight={414}
          left={JOIN.left}
          width={JOIN.width}
          height={JOIN.height}
          scale={JOIN_S}
          x={joinX}
          y={askY}
          radius={6}
        >
          <Underline lines={sp.join.title} progress={backTheStorm} thickness={2.4} />
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
            gap: 14,
          }}
        >
          <RevealLines lines={[{ text: "(778) 964-6999", color: VOLT }]} progress={[contact]} size={66} align="center" />
          <div style={{ opacity: contact }}>
            <Mono size={30} color={BONE} tracking="0.06em">
              shuttlestorm.adawar.org/sponsors
            </Mono>
          </div>
          <div style={{ marginTop: 18, transform: `translateY(${(1 - lockup) * 260}px)` }}>
            <Lockup size={52} dateLine={false} />
          </div>
        </div>
      </World>
    </AbsoluteFill>
  );
};
