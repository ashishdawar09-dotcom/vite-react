// Renders the PWA icons + iOS splash screens from a tiny SVG source.
// Usage: node scripts/gen-pwa-icons.mjs
//
// Outputs (placed in /public so Vite serves them at the root):
//   icon-192.png                          (Android home screen)
//   icon-512.png                          (Android install dialog + splash)
//   icon-512-maskable.png                 (Android adaptive icons — extra padding)
//   apple-touch-icon.png                  (iOS home screen, 180x180)
//   apple-splash-{WxH}.png × 7            (iOS standalone-launch splashes)
//
// Replace `STANDARD_SVG` / `MASKABLE_SVG` below if a real brand logo arrives.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "public");

// Brand cyan + dark navy. The "B" stands in until a real logo lands.
const CYAN = "#00d4ff";
const NAVY = "#070F1F";

const STANDARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="100" fill="${CYAN}"/>
  <text x="256" y="365" font-family="system-ui, -apple-system, 'Segoe UI', Helvetica, sans-serif" font-size="320" font-weight="900" fill="${NAVY}" text-anchor="middle">B</text>
</svg>`;

// Maskable variant: the "B" shrinks ~15% so Android adaptive cropping
// doesn't clip it. Background extends to the edges (no rounded corners).
const MASKABLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${CYAN}"/>
  <text x="256" y="335" font-family="system-ui, -apple-system, 'Segoe UI', Helvetica, sans-serif" font-size="240" font-weight="900" fill="${NAVY}" text-anchor="middle">B</text>
</svg>`;

const standard = Buffer.from(STANDARD_SVG);
const maskable = Buffer.from(MASKABLE_SVG);

await mkdir(PUBLIC, { recursive: true });

async function render(svg, size, outName) {
  const buf = await sharp(svg, { density: 300 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  const path = join(PUBLIC, outName);
  await writeFile(path, buf);
  console.log(`  ✓ ${outName} (${size}x${size}, ${buf.length} bytes)`);
}

console.log("Generating PWA icons → public/");
await render(standard, 192, "icon-192.png");
await render(standard, 512, "icon-512.png");
await render(maskable, 512, "icon-512-maskable.png");
await render(standard, 180, "apple-touch-icon.png");

// ---------- iOS splash screens ---------------------------------------------
//
// When a PWA is launched from the iOS home screen in standalone mode, iOS
// shows a static splash image while the page bootstraps. Without splash
// PNGs the user gets a blank white flash that feels like a broken app.
// We render device-sized PNGs (native pixel resolution) of the cyan
// background + centered logo so the splash is indistinguishable from
// the first paint of the running app.
//
// Sizes cover the iPhones the user/team are most likely on. Older
// devices fall back to the white default — acceptable.

const SPLASH_SVG = (w, h, logoSize) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${NAVY}"/>
  <g transform="translate(${(w - logoSize) / 2}, ${(h - logoSize) / 2})">
    <rect width="${logoSize}" height="${logoSize}" rx="${logoSize * 0.2}" fill="${CYAN}"/>
    <text x="${logoSize / 2}" y="${logoSize * 0.72}" font-family="system-ui, -apple-system, 'Segoe UI', Helvetica, sans-serif" font-size="${logoSize * 0.62}" font-weight="900" fill="${NAVY}" text-anchor="middle">B</text>
  </g>
</svg>`;

// [device-portrait-width, device-portrait-height, device-pixel-ratio]
const IOS_SPLASHES = [
  // iPhone 17 Pro Max / 16 Pro Max / 15 Pro Max
  [430, 932, 3],
  // iPhone 14 Pro Max / 13 Pro Max / 12 Pro Max
  [428, 926, 3],
  // iPhone 17 Pro / 16 Pro / 15 Pro / 14 Pro / 13 Pro / 12 Pro / 12 / 13 / 14
  [393, 852, 3],
  // iPhone 12/13/14 mini, iPhone X / XS / 11 Pro
  [390, 844, 3],
  // iPhone 11 Pro Max / XS Max / XR / 11
  [414, 896, 3],
  // iPad Pro 12.9"
  [1024, 1366, 2],
  // iPad Pro 11" / iPad Air 10.9" / iPad 10.2"
  [834, 1194, 2],
];

async function renderSplash(cssW, cssH, dpr) {
  const pxW = cssW * dpr;
  const pxH = cssH * dpr;
  // Logo at ~22% of shorter edge — looks balanced on portrait + landscape.
  const logoSize = Math.round(Math.min(pxW, pxH) * 0.22);
  const svg = Buffer.from(SPLASH_SVG(pxW, pxH, logoSize));
  const buf = await sharp(svg, { density: 300 })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const name = `apple-splash-${pxW}x${pxH}.png`;
  await writeFile(join(PUBLIC, name), buf);
  console.log(`  ✓ ${name} (${pxW}x${pxH} @${dpr}x, ${buf.length} bytes)`);
}

for (const [w, h, dpr] of IOS_SPLASHES) {
  await renderSplash(w, h, dpr);
}

console.log("Done. Commit the PNGs along with this script.");
