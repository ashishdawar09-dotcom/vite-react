// Retakes the Shuttle Storm site screenshots used by the video, from the
// static site source in ../shuttlestorm-site/public, at the same phone size
// (430×932 CSS px, 3x) the overlay measurements in src/ assume.
//
//   node scripts/capture-site.mjs
//
// If a page's layout changed, re-measure the rects in src/ShuttleStormRegister.tsx.
import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../shuttlestorm-site/public");
const out = path.resolve(here, "../public/research");
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const server = http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file)) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader("content-type", types[path.extname(file)] ?? "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  })
  .listen(8765);

const browser = await chromium.launch();
const page = await (
  await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 3,
    reducedMotion: "reduce",
  })
).newPage();

const open = async (name) => {
  await page.goto(`http://localhost:8765/${name}.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
};

await open("index");
await page.click("[data-menu-toggle]");
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/site-menu.png` });

await open("categories");
await page.screenshot({ path: `${out}/site-categories.png`, fullPage: true });

await open("register");
await page.screenshot({ path: `${out}/site-register.png` });

await browser.close();
server.close();
console.log(`Saved screenshots to ${out}`);
