// Bundle-size budget guard.
// Runs after `vite build`. Fails the build if any chunk crosses its budget.
//
// Why a hand-rolled script instead of @size-limit?
//   - One file, zero extra dependencies
//   - Reads the actual files vite already wrote to dist/
//   - Simple to reason about + tweak budgets without learning a new config
//
// Budgets are intentionally generous of the current sizes — they're guard
// rails against regression, not aspirational targets. Tighten as we ship.
//
// Usage:   node scripts/check-bundle-size.mjs
//          npm run build:check    (runs build then this script)

import { readdir, stat, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "..", "dist", "assets");

// Match by filename prefix (Vite appends a content hash). Budgets are
// in KILOBYTES of GZIPPED output, the only thing the user actually pays
// for over the wire. Tighten over time — current sizes shown for reference.
const BUDGETS_KB = {
  // The route-aware index chunk that ships on every page load. Should stay
  // tiny — most of the app's weight is in lazy chunks. Current: ~19 KB.
  "index-": 30,
  // The full App admin/spectator shell. Current: ~28 KB.
  "App-": 50,
  // The redesigned Login surface. Current: tiny.
  "Login-": 15,
  // Framer Motion + variants. Current: ~38 KB.
  "motion-": 60,
  // Supabase client. Hard to slim. Current: ~50 KB.
  "supabase-": 80,
  // React + ReactDOM. Hard to slim. Current: ~60 KB.
  "react-vendor-": 80,
  // Sentry — eager-loaded would dominate; lazy-loaded chunk OK. Current: ~27 KB.
  "sentry-": 50,
  // Lottie player (@lottiefiles/dotlottie-react). Lazy-loaded.
  // Current: ~37 KB. Could be slimmer if we ship raw lottie-web instead,
  // but the dotlottie player accepts both lottie.json + .lottie bundles
  // which is a real ergonomic win. Hold the line; revisit if it grows.
  "lottie-": 45,
  // Public registration page. Current: ~8 KB.
  "PublicRegistrationPage-": 25,
  // Heavy admin tab. Current: ~22 KB.
  "MatchesTab-": 40,
};

const ANSI = { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", reset: "\x1b[0m", bold: "\x1b[1m" };

async function main() {
  let files;
  try {
    files = await readdir(DIST);
  } catch {
    console.error(`${ANSI.red}No dist/assets directory. Run 'npm run build' first.${ANSI.reset}`);
    process.exit(1);
  }

  const jsFiles = files.filter((f) => f.endsWith(".js"));
  if (jsFiles.length === 0) {
    console.error(`${ANSI.red}No .js files in dist/assets. Build seems empty.${ANSI.reset}`);
    process.exit(1);
  }

  let overBudget = 0;
  const rows = [];

  for (const f of jsFiles) {
    const path = join(DIST, f);
    const raw = await readFile(path);
    const gzipped = gzipSync(raw, { level: 9 });
    const rawKb = raw.length / 1024;
    const gzipKb = gzipped.length / 1024;

    // Find the matching budget by prefix.
    let prefix = null;
    let budget = null;
    for (const [p, b] of Object.entries(BUDGETS_KB)) {
      if (f.startsWith(p)) {
        prefix = p;
        budget = b;
        break;
      }
    }

    let status;
    if (budget === null) {
      status = `${ANSI.yellow}no budget${ANSI.reset}`;
    } else if (gzipKb > budget) {
      status = `${ANSI.red}OVER ${budget} KB${ANSI.reset}`;
      overBudget++;
    } else {
      const pct = Math.round((gzipKb / budget) * 100);
      status = `${ANSI.green}OK${ANSI.reset} (${pct}% of ${budget} KB)`;
    }

    rows.push({ name: f, gzipKb, rawKb, status, prefix });
  }

  // Print sorted by gzip size descending.
  rows.sort((a, b) => b.gzipKb - a.gzipKb);
  console.log(`${ANSI.bold}Bundle-size check (gzipped):${ANSI.reset}\n`);
  for (const r of rows) {
    console.log(`  ${r.gzipKb.toFixed(1).padStart(6)} KB   ${r.name.padEnd(48)} ${r.status}`);
  }

  if (overBudget > 0) {
    console.error(`\n${ANSI.red}${ANSI.bold}✗ ${overBudget} chunk(s) over budget.${ANSI.reset}`);
    console.error("Tighten the code or update the budget in scripts/check-bundle-size.mjs.");
    process.exit(1);
  }
  console.log(`\n${ANSI.green}${ANSI.bold}✓ All chunks within budget.${ANSI.reset}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
