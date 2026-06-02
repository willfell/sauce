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

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\n--- failures ---");
  failures.forEach(f => console.log(f));
  process.exit(1);
}
process.exit(0);
