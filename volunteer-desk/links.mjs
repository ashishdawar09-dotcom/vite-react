#!/usr/bin/env node
// Makes volunteer desk links. Prints, for each volunteer, their private link
// and the SQL row to add. Only a hash of the link goes into the database, so
// the link shown here cannot be shown again: send it, or make a new one.
//
//   node links.mjs --tournament <id> --from <time> --until <time> [--site https://desk.adawar.org] "Name" ["Name" ...]
//
// Times need their offset, e.g. "2026-11-21T07:00:00-07:00".
import { createHash, randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const opt = { site: "https://desk.adawar.org" };
const names = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (["--tournament", "--from", "--until", "--site"].includes(a)) opt[a.slice(2)] = args[++i];
  else names.push(a);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hasOffset = (s) => typeof s === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s));
const fail = (msg) => { console.error(`${msg}\n\nUsage: node links.mjs --tournament <id> --from <time> --until <time> "Name" ["Name" ...]`); process.exit(2); };

if (!UUID.test(opt.tournament ?? "")) fail("--tournament must be the tournament's id.");
if (!hasOffset(opt.from) || !hasOffset(opt.until)) fail('--from and --until need a time with its offset, e.g. "2026-11-21T07:00:00-07:00".');
if (Date.parse(opt.until) <= Date.parse(opt.from)) fail("--until must be after --from.");
if (!names.length) fail("Give at least one volunteer name.");
for (const n of names) if (!n.trim() || n.trim().length > 60) fail(`"${n}" is not a usable name (1 to 60 characters).`);
if (new Set(names.map((n) => n.trim().toLowerCase())).size !== names.length) fail("Each volunteer needs a different name.");

const quote = (s) => `'${s.replace(/'/g, "''")}'`;
const rows = [];
const links = [];
for (const name of names.map((n) => n.trim())) {
  const key = randomBytes(32).toString("base64url"); // 43 characters
  const hash = createHash("sha256").update(key).digest("hex");
  rows.push(`  (${quote(opt.tournament)}, ${quote(name)}, ${quote(hash)}, ${quote(opt.from)}, ${quote(opt.until)})`);
  links.push({ name, url: `${opt.site.replace(/\/$/, "")}/#k=${key}` });
}

console.log("-- Run this once:");
console.log("insert into public.desk_links (tournament_id, label, token_hash, valid_from, valid_until) values");
console.log(`${rows.join(",\n")};`);
console.log("\n-- Links (shown only now):");
for (const l of links) console.log(`${l.name}: ${l.url}`);
