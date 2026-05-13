#!/usr/bin/env node
// run-registry.js — harness for platform/cli/registry.js.
// Mirrors run-cli.js: assertTrue / assertEqual + tempdir HOME.

const fs = require("fs");
const path = require("path");
const os = require("os");

let pass = 0, fail = 0;

function assertTrue(cond, label) {
    if (cond) { pass++; console.log("  PASS: " + label); }
    else { fail++; console.log("  FAIL: " + label); }
}
function assertEqual(actual, expected, label) {
    if (actual === expected) { pass++; console.log("  PASS: " + label); }
    else { fail++; console.log("  FAIL: " + label + " — expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)); }
}

async function withTempHome(fn) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-reg-"));
    const origHome = process.env.HOME;
    process.env.HOME = tmp;
    try { await fn(tmp); }
    finally { process.env.HOME = origHome; fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function caseR1ReadMissing() {
    const label = "R1 read() returns empty registry when ~/.sauce/vaults.json missing";
    await withTempHome(async () => {
        const reg = require("../cli/registry.js");
        const r = reg.read();
        assertEqual(r.version, 1, label + " — version");
        assertEqual(Array.isArray(r.vaults), true, label + " — vaults array");
        assertEqual(r.vaults.length, 0, label + " — empty");
    });
}

async function caseR2AddVault() {
    const label = "R2 add() appends a vault with registered_at + dedupes";
    await withTempHome(async (home) => {
        const reg = require("../cli/registry.js");
        reg.add("/tmp/v1");
        reg.add("/tmp/v1"); // dedupe
        reg.add("/tmp/v2");
        const r = reg.read();
        assertEqual(r.vaults.length, 2, label + " — count");
        assertEqual(r.vaults[0].path, "/tmp/v1", label + " — first path");
        assertTrue(!!r.vaults[0].registered_at, label + " — registered_at present");
    });
}

async function caseR3RemoveVault() {
    const label = "R3 remove() drops matching path";
    await withTempHome(async () => {
        const reg = require("../cli/registry.js");
        reg.add("/tmp/v1"); reg.add("/tmp/v2");
        reg.remove("/tmp/v1");
        const r = reg.read();
        assertEqual(r.vaults.length, 1, label + " — count");
        assertEqual(r.vaults[0].path, "/tmp/v2", label + " — remaining path");
    });
}

async function caseR4AtomicWrite() {
    const label = "R4 write() uses temp-then-rename (no partial file on crash)";
    await withTempHome(async (home) => {
        const reg = require("../cli/registry.js");
        reg.add("/tmp/v1");
        const tmpFile = path.join(home, ".sauce/vaults.json.tmp");
        assertEqual(fs.existsSync(tmpFile), false, label + " — no leftover .tmp");
        const finalFile = path.join(home, ".sauce/vaults.json");
        assertTrue(fs.existsSync(finalFile), label + " — final file present");
    });
}

async function caseR5PruneMissing() {
    const label = "R5 pruneMissing() drops entries whose path no longer exists";
    await withTempHome(async () => {
        const reg = require("../cli/registry.js");
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-vault-"));
        reg.add(tmp); reg.add("/nonexistent/path/12345");
        const removed = reg.pruneMissing();
        const r = reg.read();
        assertEqual(r.vaults.length, 1, label + " — count after prune");
        assertEqual(removed.length, 1, label + " — removed count");
        assertEqual(removed[0], "/nonexistent/path/12345", label + " — removed path");
        fs.rmSync(tmp, { recursive: true, force: true });
    });
}

async function caseR6CorruptJson() {
    const label = "R6 read() salvages corrupt JSON aside and returns empty";
    await withTempHome(async (home) => {
        const dir = path.join(home, ".sauce");
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, "vaults.json");
        fs.writeFileSync(file, "{not valid json at all");
        // Suppress the console.warn salvage notice during the test
        const origWarn = console.warn; console.warn = () => {};
        const reg = require("../cli/registry.js");
        try {
            const r = reg.read();
            assertEqual(r.version, 1, label + " — version");
            assertEqual(r.vaults.length, 0, label + " — empty");
            const sibs = fs.readdirSync(dir).filter(f => f.startsWith("vaults.json.corrupt-"));
            assertEqual(sibs.length, 1, label + " — one salvage file");
        } finally { console.warn = origWarn; }
    });
}

(async () => {
    await caseR1ReadMissing();
    await caseR2AddVault();
    await caseR3RemoveVault();
    await caseR4AtomicWrite();
    await caseR5PruneMissing();
    await caseR6CorruptJson();
    console.log(`\n  ${pass} pass · ${fail} fail`);
    process.exit(fail > 0 ? 1 : 0);
})();
