#!/usr/bin/env node
// run-backlink-panel.js — sub-asserts for v0.61.0's NEW backlink-panel
// mechanism. Two passes: manifest sanity (BP-1..3) + class source lint
// (BP-4..16). No Obsidian runtime needed — Node-only.
//
// Usage: node platform/test/run-backlink-panel.js
// Exit: 0 = all pass; 1 = any fail.

"use strict";

const fs = require("fs");
const path = require("path");

const WORKSHOP = path.resolve(__dirname, "../..");
const MECH_DIR = path.join(WORKSHOP, "platform/mechanisms/backlink-panel");
const MANIFEST_PATH = path.join(MECH_DIR, "manifest.json");
const SOURCE_PATH = path.join(MECH_DIR, "backlink-panel.js");

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

console.log("\n--- Pass 1: backlink-panel/manifest.json sanity ---");

assertTrue("BP-1a: manifest.json exists", fs.existsSync(MANIFEST_PATH));

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
} catch (e) {
  assertTrue("BP-1b: manifest.json parses as JSON", false, e && e.message);
}
if (manifest) {
  assertTrue("BP-1b: manifest.json parses as JSON", true);
  assertEq("BP-1c: manifest.name === 'backlink-panel'", manifest.name, "backlink-panel");
  assertEq("BP-1d: manifest.version === '0.1.0'", manifest.version, "0.1.0");
  assertEq("BP-1e: manifest.kind === 'mechanism'", manifest.kind, "mechanism");

  assertEq("BP-2: customjs_classes is ['BacklinkPanel']", manifest.customjs_classes, ["BacklinkPanel"]);

  const deps = manifest.depends_on || [];
  const depNames = deps.map((d) => d && d.name).filter(Boolean);
  assertTrue("BP-3a: depends_on includes customjs-guard", depNames.indexOf("customjs-guard") >= 0);
  assertTrue("BP-3b: depends_on includes cards", depNames.indexOf("cards") >= 0);

  // files[] must materialize the JS at scripts_path/backlink-panel/backlink-panel.js
  const files = manifest.files || [];
  const hasJsEntry = files.some((f) =>
    f && f.source === "backlink-panel.js" &&
    typeof f.dest === "string" &&
    f.dest.indexOf("backlink-panel/backlink-panel.js") >= 0
  );
  assertTrue("BP-3c: files[] declares backlink-panel.js → scripts_path/backlink-panel/", hasJsEntry);
}

// ── Pass 2: class source lint ─────────────────────────────────────────────

console.log("\n--- Pass 2: backlink-panel.js source lint ---");

assertTrue("BP-4a: backlink-panel.js exists", fs.existsSync(SOURCE_PATH));

let src = "";
try {
  src = fs.readFileSync(SOURCE_PATH, "utf8");
} catch (e) {
  assertTrue("BP-4b: readFileSync succeeds", false, e && e.message);
}

if (src.length > 0) {
  // BP-4: source parses via new Function (with stub free vars).
  let parseErr = null;
  try {
    new Function("app", "customJS", "Notice", "window", src + "\nreturn BacklinkPanel;");
  } catch (e) {
    parseErr = e;
  }
  assertTrue("BP-4b: source parses via new Function() without throwing",
    !parseErr, parseErr && parseErr.message);

  // BP-5: exactly one `class BacklinkPanel` declaration.
  const classMatches = src.match(/class\s+BacklinkPanel\b/g) || [];
  assertEq("BP-5: exactly one 'class BacklinkPanel' declaration", classMatches.length, 1);

  // BP-6: all 6 entityType keys present in _ENTITY_TYPE_TO_KEY.
  const entityTypes = ["person", "project", "team", "product", "trip", "meeting"];
  for (const t of entityTypes) {
    assertTrue(`BP-6.${t}: entityType '${t}' present in source`,
      new RegExp("\\b" + t + "\\b").test(src));
  }

  // BP-7: all 6 canonical keys present.
  const canonicalKeys = ["people", "projects", "teams", "products", "trips", "meetings"];
  for (const k of canonicalKeys) {
    assertTrue(`BP-7.${k}: canonical key '${k}' present in source`,
      new RegExp("\"" + k + "\"|'" + k + "'").test(src));
  }

  // BP-8: default limit = 25.
  assertTrue("BP-8: default limit literal 25 present",
    /\b25\b/.test(src) && /\blimit\b/.test(src));

  // BP-9: default sortBy created_at.
  assertTrue("BP-9: 'created_at' sortBy literal present",
    /created_at/.test(src));

  // BP-10: groupBy "type" and "month" literals present.
  assertTrue("BP-10a: groupBy 'type' literal present", /"type"|'type'/.test(src));
  assertTrue("BP-10b: groupBy 'month' literal present", /"month"|'month'/.test(src));

  // BP-11: empty-state literal "No mentions yet" present.
  assertTrue("BP-11: 'No mentions yet' empty-state literal present",
    /No mentions yet/.test(src));

  // BP-12: customJS.BeaconCards.render delegation present.
  assertTrue("BP-12: customJS.BeaconCards.render delegation present",
    /customJS\.BeaconCards\.render/.test(src));

  // BP-13: dv.pages() Dataview reverse query present.
  assertTrue("BP-13: dv.pages() Dataview query call present",
    /dv\.pages\(\)/.test(src));

  // BP-14: .some( + .path reverse-link match shape present.
  assertTrue("BP-14a: .some( reverse-link match present", /\.some\(/.test(src));
  assertTrue("BP-14b: .path reverse-link match present", /\.path/.test(src));

  // BP-15: Notice on invalid entityType branch.
  assertTrue("BP-15: Notice on unknown entityType branch present",
    /unknown entityType/i.test(src));

  // BP-16: Notice on BeaconCards unavailable branch.
  assertTrue("BP-16: Notice on BeaconCards unavailable branch present",
    /BeaconCards.*unavailable|unavailable.*BeaconCards/i.test(src));
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\nrun-backlink-panel.js: ${pass} pass · ${fail} fail`);
if (fail > 0) {
  console.log("\n--- Failures ---");
  for (const f of failures) console.log(f);
  process.exit(1);
}
process.exit(0);
