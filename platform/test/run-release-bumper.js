#!/usr/bin/env node
/*
 * run-release-bumper.js — behavioral harness for the release bumper engine
 * (scripts/release/). Exercises vendored libs + compute-release against
 * synthetic commit fixtures and a temp fixture vault. Zero-dep; cleans up.
 * Family: HC-V0129-RELEASE-*.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../..");
let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; } else { fail++; console.error(`  FAIL ${label}`); } };
const eq = (label, a, b) => ok(`${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, a === b);

// ---- Task 1: semver-inc ----
const { parse, inc, maxLevel, RANK } = require("../../scripts/release/lib/semver-inc.js");
console.log("\n--- HC-V0129-RELEASE-SEMVER ---");
eq("HC-V0129-RELEASE-SEMVER-A: patch", inc("0.128.0", "patch"), "0.128.1");
eq("HC-V0129-RELEASE-SEMVER-B: minor zeroes patch", inc("0.128.5", "minor"), "0.129.0");
eq("HC-V0129-RELEASE-SEMVER-C: major zeroes minor+patch", inc("1.4.7", "major"), "2.0.0");
eq("HC-V0129-RELEASE-SEMVER-D: none is identity", inc("0.128.0", "none"), "0.128.0");
eq("HC-V0129-RELEASE-SEMVER-E: maxLevel picks higher", maxLevel("patch", "minor"), "minor");
eq("HC-V0129-RELEASE-SEMVER-F: maxLevel none<patch", maxLevel("none", "patch"), "patch");
ok("HC-V0129-RELEASE-SEMVER-G: parse rejects junk", (() => { try { parse("1.2"); return false; } catch (e) { return true; } })());

console.log(`\nrun-release-bumper: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
