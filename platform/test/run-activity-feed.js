#!/usr/bin/env node
// run-activity-feed.js — sub-asserts for v0.62.0's NEW activity-feed
// mechanism. Two passes: manifest sanity (AF-1..3) + class source lint
// (AF-4..15). No Obsidian runtime needed — Node-only.
//
// Mirrors run-backlink-panel.js exactly.
//
// Usage: node platform/test/run-activity-feed.js
// Exit: 0 = all pass; 1 = any fail.

"use strict";

const fs = require("fs");
const path = require("path");

const WORKSHOP = path.resolve(__dirname, "../..");
const MECH_DIR = path.join(WORKSHOP, "platform/mechanisms/activity-feed");
const MANIFEST_PATH = path.join(MECH_DIR, "manifest.json");
const SOURCE_PATH = path.join(MECH_DIR, "activity-feed.js");

let pass = 0;
let fail = 0;
const failures = [];

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

// ── Pass 1: manifest sanity ───────────────────────────────────────────────

console.log("\n--- Pass 1: activity-feed/manifest.json sanity ---");

assertTrue("AF-1a: manifest.json exists", fs.existsSync(MANIFEST_PATH));

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
} catch (e) {
  assertTrue("AF-1b: manifest.json parses as JSON", false, e && e.message);
}
if (manifest) {
  assertTrue("AF-1b: manifest.json parses as JSON", true);
  assertEq("AF-1c: manifest.name === 'activity-feed'", manifest.name, "activity-feed");
  assertEq("AF-1d: manifest.version === '0.1.0'", manifest.version, "0.1.0");
  assertEq("AF-1e: manifest.kind === 'mechanism'", manifest.kind, "mechanism");

  assertEq("AF-2: customjs_classes is ['ActivityFeed']", manifest.customjs_classes, ["ActivityFeed"]);

  const deps = manifest.depends_on || [];
  const depNames = deps.map((d) => d && d.name).filter(Boolean);
  assertTrue("AF-3a: depends_on includes customjs-guard", depNames.indexOf("customjs-guard") >= 0);
  assertTrue("AF-3b: depends_on includes cards", depNames.indexOf("cards") >= 0);

  const files = manifest.files || [];
  const hasJsEntry = files.some((f) =>
    f && f.source === "activity-feed.js" &&
    typeof f.dest === "string" &&
    f.dest.indexOf("activity-feed/activity-feed.js") >= 0
  );
  assertTrue("AF-3c: files[] declares activity-feed.js → scripts_path/activity-feed/", hasJsEntry);
}

// ── Pass 2: class source lint ─────────────────────────────────────────────

console.log("\n--- Pass 2: activity-feed.js source lint ---");

assertTrue("AF-4a: activity-feed.js exists", fs.existsSync(SOURCE_PATH));

let src = "";
try {
  src = fs.readFileSync(SOURCE_PATH, "utf8");
} catch (e) {
  assertTrue("AF-4b: readFileSync succeeds", false, e && e.message);
}

if (src.length > 0) {
  // AF-4: source parses via new Function (with stub free vars).
  let parseErr = null;
  try {
    new Function("app", "customJS", "Notice", "window", src + "\nreturn ActivityFeed;");
  } catch (e) {
    parseErr = e;
  }
  assertTrue("AF-4b: source parses via new Function() without throwing",
    !parseErr, parseErr && parseErr.message);

  // AF-5: exactly one `class ActivityFeed` declaration.
  const classMatches = src.match(/class\s+ActivityFeed\b/g) || [];
  assertEq("AF-5: exactly one 'class ActivityFeed' declaration", classMatches.length, 1);

  // AF-6: all 3 scope literals present.
  for (const sc of ["today", "week", "month"]) {
    assertTrue(`AF-6.${sc}: scope literal '${sc}' present in source`,
      new RegExp("\"" + sc + "\"|'" + sc + "'").test(src));
  }

  // AF-7: canonical default blueprint types — at least these 10.
  const canonical = ["daily", "meeting", "scratch", "cowork-daily", "to-do", "journal", "project", "person", "team", "trip"];
  for (const t of canonical) {
    assertTrue(`AF-7.${t}: default blueprint type '${t}' present in source`,
      new RegExp("\"" + t + "\"").test(src));
  }

  // AF-8: default limit 50.
  assertTrue("AF-8: default limit literal 50 present",
    /\b50\b/.test(src) && /\blimit\b/.test(src));

  // AF-9: created_at reference.
  assertTrue("AF-9: 'created_at' reference present in source", /created_at/.test(src));

  // AF-10: useStatusChangedAt opt + status_changed_at branch.
  assertTrue("AF-10a: useStatusChangedAt opt referenced", /useStatusChangedAt/.test(src));
  assertTrue("AF-10b: status_changed_at branch present", /status_changed_at/.test(src));

  // AF-11: _resolveTimeWindow helper present.
  assertTrue("AF-11: _resolveTimeWindow helper present", /_resolveTimeWindow/.test(src));

  // AF-12: customJS.BeaconCards.render delegation.
  assertTrue("AF-12: customJS.BeaconCards.render delegation present",
    /customJS\.BeaconCards\.render/.test(src));

  // AF-13: dv.pages() Dataview query call.
  assertTrue("AF-13: dv.pages() query call present", /dv\.pages\(\)/.test(src));

  // AF-14: window.moment reference (or native Date fallback indicator).
  assertTrue("AF-14a: window.moment reference present (primary code path)",
    /window\.moment/.test(src));
  assertTrue("AF-14b: native Date fallback present", /new Date\(/.test(src));

  // AF-15: Notice on degraded paths.
  assertTrue("AF-15a: Notice on invalid scope / unresolved window present",
    /unable to resolve|invalid scope|time-window/i.test(src));
  assertTrue("AF-15b: Notice on BeaconCards unavailable present",
    /BeaconCards.*unavailable|unavailable.*BeaconCards/i.test(src));
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\nrun-activity-feed.js: ${pass} pass · ${fail} fail`);
if (fail > 0) {
  console.log("\n--- Failures ---");
  for (const f of failures) console.log(f);
  process.exit(1);
}
process.exit(0);
