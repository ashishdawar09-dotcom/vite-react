// Retakes the Shuttle Storm site screenshots used by the videos, from the
// static site source in ../shuttlestorm-site/public, at phone size
// (430×932 CSS px, 3x), and writes public/research/measurements.json with the
// positions (CSS px, relative to each crop) the videos use for their overlays.
//
//   node scripts/capture-site.mjs
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
    if (!path.extname(p)) p += ".html";
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
const shot = (file, y, height) =>
  page.screenshot({
    path: `${out}/${file}.png`,
    fullPage: true,
    clip: { x: 0, y, width: 430, height },
  });
// Bounding box of an element (by selector, nth match) in page CSS px.
const box = (selector, nth = 0) =>
  page.$$eval(
    selector,
    (els, n) => {
      const r = els[n].getBoundingClientRect();
      return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height };
    },
    nth,
  );
// Line boxes of a text phrase in page CSS px.
const phrase = (text) =>
  page.evaluate((t) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.textContent.indexOf(t);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + t.length);
      return [...range.getClientRects()].map((r) => ({
        x: r.x,
        y: r.y + scrollY,
        w: r.width,
        h: r.height,
      }));
    }
    throw new Error(`phrase not found: ${t}`);
  }, text);
const rel = (rects, top) =>
  (Array.isArray(rects) ? rects : [rects]).map((r) => ({ ...r, y: r.y - top }));

const m = {};

// Home page.
await open("index");
await page.click("[data-menu-toggle]");
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/site-menu.png` });
await open("index");
const hero = await box("section.hero");
const statement = await box("section.statement");
const nums = await box("section.nums");
const sport = await box("section.sport");
const facts = await box(".fact", 0);
const xp = await box("section.xp");
await shot("site-home-hero", 0, hero.y + hero.h);
await shot("site-home-statement", statement.y, statement.h);
await shot("site-home-numbers", nums.y, nums.h);
await shot("site-home-facts", facts.y - 40, sport.y + sport.h - facts.y + 40);
await shot("site-home-everypoint", xp.y, xp.h);
m.homeHero = {
  h: hero.y + hero.h,
  date: rel(await phrase("Saturday, November 21"), 0),
  ages: rel(await phrase("Eleven categories for juniors, youth and adults, from age 8 to 50+."), 0),
};
m.homeStatement = {
  h: statement.h,
  claim: rel(await phrase("Eleven categories. Juniors to masters."), statement.y),
};
m.homeNumbers = {
  h: nums.h,
  nums: rel(
    await Promise.all([0, 1, 2, 3].map((i) => box(".num", i))),
    nums.y,
  ),
  // The big numerals themselves (first child of each .num).
  numerals: rel(
    await Promise.all([0, 1, 2, 3].map((i) => box(".num > :first-child", i))),
    nums.y,
  ),
};
m.homeFacts = {
  h: sport.y + sport.h - facts.y + 40,
  feathers: rel(await box(".fact", 1), facts.y - 40),
  feathersLine: rel(await phrase("16 feathers"), facts.y - 40),
};
m.homeEveryPoint = {
  h: xp.h,
  matches: rel(
    await phrase("Everyone in an event with three or more entries plays at least two matches."),
    xp.y,
  ),
};

// Categories page.
await open("categories");
await page.screenshot({ path: `${out}/site-categories.png`, fullPage: true });
m.categories = {
  h: await page.evaluate(() => document.documentElement.scrollHeight),
  rows: await page.$$eval("tbody tr", (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height };
    }),
  ),
};

// Register page.
await open("register");
await page.screenshot({ path: `${out}/site-register.png` });
m.register = { deadline: await phrase("Entries close 11:59 pm, Wednesday, November 18, 2026") };
const dayTitle = await phrase("Your day, start to finish");
const steps = await page.$$eval("ol li", (els) =>
  els.slice(0, 5).map((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height };
  }),
);
const dayTop = dayTitle[0].y - 24;
const dayBottom = steps[4].y + steps[4].h + 24;
await shot("site-register-day", dayTop, dayBottom - dayTop);
m.registerDay = { h: dayBottom - dayTop, steps: rel(steps, dayTop) };

// Sponsors page.
await open("sponsors");
const intro = await box("section.intro");
const presenting = await box(".presenting");
const join = await box("section.join");
await shot("site-sponsors-intro", intro.y, intro.h);
await shot("site-sponsors-adw", presenting.y, presenting.h);
await shot("site-sponsors-join", join.y, join.h);
const tiles = await page.$$eval(".sponsor .tile", (els) =>
  els.map((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height, id: e.closest(".sponsor").id };
  }),
);
for (const t of tiles) {
  // Logos are lazy-loaded: bring each into view and wait for it first.
  await page.locator(`#${t.id} img`).scrollIntoViewIfNeeded();
  await page.waitForFunction((id) => document.querySelector(`#${id} img`).complete, t.id);
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `${out}/site-sponsor-${t.id.replace(/^s-/, "")}.png`,
    fullPage: true,
    clip: { x: t.x, y: t.y, width: t.w, height: t.h },
  });
}
m.sponsors = {
  intro: { h: intro.h, lede: rel(await phrase("local businesses back local badminton"), intro.y) },
  presenting: { w: presenting.w, h: presenting.h },
  tile: { w: tiles[0].w, h: tiles[0].h },
  tiles: tiles.map((t) => t.id.replace(/^s-/, "")),
  join: {
    h: join.h,
    title: rel(await phrase("Back the"), join.y),
  },
};

fs.writeFileSync(`${out}/measurements.json`, `${JSON.stringify(m, null, 2)}\n`);
await browser.close();
server.close();
console.log(`Saved screenshots and measurements to ${out}`);
