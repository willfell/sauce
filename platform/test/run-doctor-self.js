#!/usr/bin/env node
// run-doctor-self.js — assert that `sauce doctor` against the workshop self
// exits 0 (or only WARNs, never FAILs in a way that should block release).
//
// Runs the actual CLI verb. This is an integration check, not a unit test.

const { spawnSync } = require("child_process");
const path = require("path");

const cli = path.resolve(__dirname, "..", "cli", "sauce-cli.js");
const r = spawnSync("node", [cli, "doctor"], { encoding: "utf8" });

console.log(r.stdout || "");
if (r.stderr) console.log(r.stderr);

// Doctor exits 1 only on FAIL rows. WARN rows do not fail the exit code.
// Brew-not-installed is a FAIL in environments without homebrew, so we
// inspect the output. If a FAIL row mentions only `brew sauce`, treat
// that as acceptable (the preflight is intended to run on the dev's box
// before tagging, where brew may not yet have the new tag). Other FAILs
// block.

const out = (r.stdout || "") + (r.stderr || "");
const failLines = out.split("\n").filter(l => l.includes("[FAIL]"));

if (failLines.length === 0) {
    console.log("  preflight: doctor clean.");
    process.exit(0);
}

const onlyBrewFails = failLines.every(l => l.toLowerCase().includes("brew sauce"));
if (onlyBrewFails) {
    console.log("  preflight: doctor has only brew-related FAILs (expected pre-release).");
    process.exit(0);
}

console.log("  preflight: doctor reports non-brew FAIL rows — block release.");
process.exit(1);
