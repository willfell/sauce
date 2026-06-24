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

// ---- Task 2: conventional classifier ----
const { parseCommit, bumpLevel } = require("../../scripts/release/lib/conventional.js");
console.log("\n--- HC-V0129-RELEASE-CONV ---");
const c1 = parseCommit("feat(meetings): add leaf actions");
eq("HC-V0129-RELEASE-CONV-A: type", c1.type, "feat");
eq("HC-V0129-RELEASE-CONV-B: scope", c1.scope, "meetings");
ok("HC-V0129-RELEASE-CONV-C: not breaking", c1.breaking === false);
const c2 = parseCommit("feat(installer,validator): big change");
eq("HC-V0129-RELEASE-CONV-D: multi-scope count", c2.scopes.length, 2);
const c3 = parseCommit("feat(api)!: drop legacy field");
ok("HC-V0129-RELEASE-CONV-E: bang breaking", c3.breaking === true);
const c4 = parseCommit("fix: thing\n\nBREAKING CHANGE: removed X");
ok("HC-V0129-RELEASE-CONV-F: footer breaking", c4.breaking === true);
const c5 = parseCommit("feat(meetings): x\n\nRelease-As: 1.0.0");
eq("HC-V0129-RELEASE-CONV-G: release-as", c5.releaseAs, "1.0.0");
ok("HC-V0129-RELEASE-CONV-H: junk header -> null", parseCommit("just some words") === null);
eq("HC-V0129-RELEASE-CONV-I: feat pre1 -> minor", bumpLevel(c1, true), "minor");
eq("HC-V0129-RELEASE-CONV-J: breaking pre1 -> minor", bumpLevel(c3, true), "minor");
eq("HC-V0129-RELEASE-CONV-K: breaking post1 -> major", bumpLevel(c3, false), "major");
eq("HC-V0129-RELEASE-CONV-L: fix -> patch", bumpLevel(parseCommit("fix: y"), true), "patch");
eq("HC-V0129-RELEASE-CONV-M: chore -> none", bumpLevel(parseCommit("chore: z"), true), "none");
eq("HC-V0129-RELEASE-CONV-N: null -> none", bumpLevel(null, true), "none");

console.log(`\nrun-release-bumper: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
