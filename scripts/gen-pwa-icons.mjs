// Renders the PWA icons from a tiny SVG source — run once, commit the PNGs.
// Usage: node scripts/gen-pwa-icons.mjs
//
// Outputs (placed in /public so Vite serves them at the root):
//   icon-192.png            (Android home screen)
//   icon-512.png            (Android install dialog + splash)
//   icon-512-maskable.png   (Android adaptive icons — extra padding)
//   apple-touch-icon.png    (iOS home screen, 180x180)
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
console.log("Done. Commit the PNGs along with this script.");
