#!/usr/bin/env node
// run-scratch.js — sub-asserts for scratch blueprint helpers.
// Hosts HC-V0841-A1 (_coerceDay regression on Date inputs) +
// HC-V0841-A2 (ScratchDayMigrate behavior).
//
// Usage: node platform/test/run-scratch.js
// Exit: 0 = all pass; 1 = any fail.

"use strict";

const fs = require("fs");
const path = require("path");

const WORKSHOP = path.resolve(__dirname, "../..");
const SDL_PATH = path.join(WORKSHOP, "platform/blueprints/scratch/helpers/scratch-day-list.js");
const SDM_PATH = path.join(WORKSHOP, "platform/blueprints/scratch/helpers/scratch-day-migrate.js");

let pass = 0;
let fail = 0;
const failures = [];

function assertTrue(label, cond, hint) {
  if (!cond) {
    fail++;
    failures.push(`FAIL: ${label}${hint ? ` — ${hint}` : ""}`);
    console.log(`  FAIL: ${label}${hint ? ` — ${hint}` : ""}`);
    return false;
  }
  pass++;
  console.log(`  PASS: ${label}`);
  return true;
}

function assertEq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    fail++;
    failures.push(`FAIL: ${label}\n  expected ${e}\n  actual   ${a}`);
    console.log(`  FAIL: ${label}`);
    return false;
  }
  pass++;
  console.log(`  PASS: ${label}`);
  return true;
}

// Load ScratchDayList class via new Function() wrap; expose it for
// _coerceDay testing without an Obsidian runtime.
function loadScratchDayList() {
  const src = fs.readFileSync(SDL_PATH, "utf8");
  const wrapper = new Function("module", "exports",
    src + "\nmodule.exports = ScratchDayList;");
  const mod = { exports: {} };
  wrapper(mod, mod.exports);
  return mod.exports;
}

console.log("\n--- HC-V0841-A1: scratch-day-list._coerceDay() regression ---");

const ScratchDayList = loadScratchDayList();
const sdl = new ScratchDayList();

// A1.1: string YYYY-MM-DD passes through.
assertEq("HC-V0841-A1.1 _coerceDay('2026-06-01') → '2026-06-01'",
  sdl._coerceDay("2026-06-01"), "2026-06-01");

// A1.2: string with extra trailing chars sliced to first 10.
assertEq("HC-V0841-A1.2 _coerceDay('2026-06-01T05:00:00Z') → '2026-06-01'",
  sdl._coerceDay("2026-06-01T05:00:00Z"), "2026-06-01");

// A1.3: Luxon-like object (duck-typed via toISODate()) passes through.
const fakeLuxon = { toISODate: () => "2026-06-01" };
assertEq("HC-V0841-A1.3 _coerceDay(Luxon-like) → '2026-06-01'",
  sdl._coerceDay(fakeLuxon), "2026-06-01");

// A1.4: Date input → null (the regression fix). Old code would have
// returned getFullYear/Month/Date local-extracted from UTC instant,
// silently flipping the day for any user west of UTC.
const utcMidnight = new Date("2026-06-01T00:00:00.000Z");
assertEq("HC-V0841-A1.4 _coerceDay(new Date('2026-06-01T00:00:00Z')) → null",
  sdl._coerceDay(utcMidnight), null);

// A1.5: null / undefined / nonsense → null.
assertEq("HC-V0841-A1.5a _coerceDay(null) → null", sdl._coerceDay(null), null);
assertEq("HC-V0841-A1.5b _coerceDay(undefined) → null", sdl._coerceDay(undefined), null);
assertEq("HC-V0841-A1.5c _coerceDay({}) → null", sdl._coerceDay({}), null);

console.log("\n--- HC-V0841-A2: ScratchDayMigrate behavior ---");

// Load ScratchDayMigrate class.
function loadScratchDayMigrate() {
  const src = fs.readFileSync(SDM_PATH, "utf8");
  const wrapper = new Function("module", "exports",
    src + "\nmodule.exports = ScratchDayMigrate;");
  const mod = { exports: {} };
  wrapper(mod, mod.exports);
  return mod.exports;
}

const ScratchDayMigrate = loadScratchDayMigrate();
const sdm = new ScratchDayMigrate();

// A2.1: quoted string day passes through unchanged.
{
  const fm = { type: "scratch", day: "2026-05-31", created_at: "2026-05-31T22:30:00-06:00" };
  const fakeFile = { path: "spice/scratch/2026/05-May/2026-05-31/Scratch-2026-05-31-22-30.md" };
  const before = JSON.stringify(fm);
  const changed = sdm._migrateFrontmatter(fm, fakeFile);
  assertTrue("HC-V0841-A2.1a quoted string day → no change",
    changed === false);
  assertEq("HC-V0841-A2.1b quoted string day → frontmatter byte-stable",
    JSON.stringify(fm), before);
}

// A2.2: Date day (the unquoted-YAML case) → rewritten to local YYYY-MM-DD string.
// Mirrors the YAML parser's behavior: an unquoted `day: 2026-05-31` becomes
// new Date("2026-05-31T00:00:00.000Z"). The migration must use the FILE PATH
// segment to recover the user-intended local date (not the Date's getDate()).
{
  const fm = { type: "scratch", day: new Date("2026-05-31T00:00:00.000Z"), created_at: "2026-05-31T22:30:00-06:00" };
  const fakeFile = { path: "spice/scratch/2026/05-May/2026-05-31/Scratch-2026-05-31-22-30.md" };
  const changed = sdm._migrateFrontmatter(fm, fakeFile);
  assertTrue("HC-V0841-A2.2a Date day → migration recorded change",
    changed === true);
  assertEq("HC-V0841-A2.2b Date day → rewritten as quoted string from path",
    fm.day, "2026-05-31");
}

// A2.3: missing day but path encodes /YYYY-MM-DD/ → day synthesized.
{
  const fm = { type: "scratch", created_at: "2026-05-31T22:30:00-06:00" };
  const fakeFile = { path: "spice/scratch/2026/05-May/2026-05-31/Scratch-2026-05-31-22-30.md" };
  const changed = sdm._migrateFrontmatter(fm, fakeFile);
  assertTrue("HC-V0841-A2.3a missing day, path has date → migration recorded change",
    changed === true);
  assertEq("HC-V0841-A2.3b missing day, path has date → synthesized",
    fm.day, "2026-05-31");
}

// A2.4: missing day, filename encodes Scratch-*-YYYY-MM-DD → day synthesized.
{
  const fm = { type: "scratch", created_at: "2026-05-31T22:30:00-06:00" };
  const fakeFile = { path: "spice/scratch/Scratch-2026-05-31-22-30.md" };
  const changed = sdm._migrateFrontmatter(fm, fakeFile);
  assertTrue("HC-V0841-A2.4a missing day, filename has date → migration recorded change",
    changed === true);
  assertEq("HC-V0841-A2.4b missing day, filename has date → synthesized",
    fm.day, "2026-05-31");
}

// A2.5: missing day, no date anywhere → no change, returns false.
{
  const fm = { type: "scratch", created_at: "2026-05-31T22:30:00-06:00" };
  const fakeFile = { path: "spice/scratch/Untitled.md" };
  const changed = sdm._migrateFrontmatter(fm, fakeFile);
  assertTrue("HC-V0841-A2.5 unrecoverable day → no change",
    changed === false);
}

// A2.6: idempotency — running again on post-migration state is a no-op.
{
  const fm = { type: "scratch", day: "2026-05-31", created_at: "2026-05-31T22:30:00-06:00" };
  const fakeFile = { path: "spice/scratch/2026/05-May/2026-05-31/Scratch-2026-05-31-22-30.md" };
  const before = JSON.stringify(fm);
  sdm._migrateFrontmatter(fm, fakeFile);
  sdm._migrateFrontmatter(fm, fakeFile);
  assertEq("HC-V0841-A2.6 re-migrate post-migration → byte-stable",
    JSON.stringify(fm), before);
}

// A2.7: manifest wiring — scratch manifest declares both classes and the
// startup-script + files entries.
{
  const SCRATCH_MANIFEST = path.join(WORKSHOP, "platform/blueprints/scratch/manifest.json");
  const m = JSON.parse(fs.readFileSync(SCRATCH_MANIFEST, "utf8"));
  assertTrue("HC-V0841-A2.7a customjs_classes contains ScratchDayMigrate",
    Array.isArray(m.customjs_classes) && m.customjs_classes.indexOf("ScratchDayMigrate") >= 0);
  assertTrue("HC-V0841-A2.7b customjs_classes contains ScratchDayMigrateInit",
    Array.isArray(m.customjs_classes) && m.customjs_classes.indexOf("ScratchDayMigrateInit") >= 0);
  assertTrue("HC-V0841-A2.7c customjs_startup_scripts contains ScratchDayMigrateInit",
    Array.isArray(m.customjs_startup_scripts) && m.customjs_startup_scripts.indexOf("ScratchDayMigrateInit") >= 0);
  const fileSources = (m.files || []).map(f => f && f.source);
  assertTrue("HC-V0841-A2.7d files[] includes scratch-day-migrate.js",
    fileSources.indexOf("helpers/scratch-day-migrate.js") >= 0);
  assertTrue("HC-V0841-A2.7e files[] includes scratch-day-migrate-init.js",
    fileSources.indexOf("helpers/scratch-day-migrate-init.js") >= 0);
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\n--- failures ---");
  failures.forEach(f => console.log(f));
  process.exit(1);
}
process.exit(0);
