#!/usr/bin/env node
// run-code-fence-button.js — asserts code-fence-button mechanism.
// Pass 1: manifest sanity. Pass 2: CodeFenceButton.computeFence (CFB-1..4).
// Pass 3: CodeFenceButton.wrapSelection (CFB-5..9). Pass 4: source lint (parses).
"use strict";
const fs = require("fs");
const path = require("path");
const WORKSHOP = path.resolve(__dirname, "../..");
const MECH_DIR = path.join(WORKSHOP, "platform/mechanisms/code-fence-button");
const MANIFEST_PATH = path.join(MECH_DIR, "manifest.json");
const SRC_PATH = path.join(MECH_DIR, "code-fence-button.js");
const INIT_PATH = path.join(MECH_DIR, "code-fence-button-init.js");

let pass = 0, fail = 0; const failures = [];
function assertEq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; failures.push(`FAIL: ${label}\n  expected ${e}\n  got      ${a}`); }
}
function assertTrue(label, cond, detail) {
  if (cond) { pass++; } else { fail++; failures.push(`FAIL: ${label}${detail ? "\n  " + detail : ""}`); }
}

// ── Load CodeFenceButton from source via new Function (customJS scope stubs).
const src = fs.readFileSync(SRC_PATH, "utf8");
let CFB;
try {
  CFB = new Function("app", "customJS", "Notice", "window", src + "\nreturn CodeFenceButton;")(
    undefined, undefined, function () {}, undefined);
} catch (e) { fail++; failures.push("CFB-P0: source loads via new Function\n  " + (e && e.message)); }

// Pass 1 — manifest sanity
console.log("\n--- Pass 1: manifest ---");
const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
assertEq("CFB-M1: name", m.name, "code-fence-button");
assertEq("CFB-M2: kind", m.kind, "mechanism");
assertEq("CFB-M3: startup scripts", m.customjs_startup_scripts, ["CodeFenceButtonInit"]);
assertEq("CFB-M4: classes", m.customjs_classes, ["CodeFenceButton", "CodeFenceButtonInit"]);
assertTrue("CFB-M5: init source parses", (() => {
  try { new Function("app","customJS","Notice","window", fs.readFileSync(INIT_PATH,"utf8") + "\nreturn CodeFenceButtonInit;"); return true; }
  catch (_e) { return false; }
})());

// Pass 2 — computeFence
console.log("\n--- Pass 2: computeFence ---");
assertEq("CFB-1: no backticks → 4", CFB.computeFence("hello world"), "````");
assertEq("CFB-2: contains 3 → 4", CFB.computeFence("a ``` b"), "````");
assertEq("CFB-3: contains 4 → 5", CFB.computeFence("x ```` y"), "`````");
assertEq("CFB-4: contains 5 → 6", CFB.computeFence("`````"), "``````");

// Pass 3 (wrapSelection) — added in Task 3.

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) console.log("\n" + failures.join("\n"));
process.exit(fail ? 1 : 0);
