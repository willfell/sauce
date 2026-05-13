#!/usr/bin/env node
// run-migrate-layout.js — harness for platform/cli/cmd-migrate-layout.js.
// Tests the 8-step state machine for moving <vault>/pantry/ to brew-installed layout.

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
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-mlh-"));
    const origHome = process.env.HOME;
    process.env.HOME = tmp;
    try { await fn(tmp); }
    finally { process.env.HOME = origHome; fs.rmSync(tmp, { recursive: true, force: true }); }
}

// Builds a vault with a legacy pantry/ clone (incl. .git/ dir + manifest.json).
async function withLegacyVault(workshopVersion, fn) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-lvault-"));
    try {
        // Vault skeleton
        fs.mkdirSync(path.join(tmp, "ranch"), { recursive: true });
        fs.writeFileSync(path.join(tmp, "ranch/platform-config.json"),
            JSON.stringify({ workshop_relative_path: "pantry", variables: {} }, null, 2));
        fs.writeFileSync(path.join(tmp, "ranch/platform-subscription.json"),
            JSON.stringify({ mechanisms: [], blueprints: [] }, null, 2));
        // Legacy pantry/
        fs.mkdirSync(path.join(tmp, "pantry/.git"), { recursive: true });
        fs.writeFileSync(path.join(tmp, "pantry/.git/HEAD"), "ref: refs/heads/main\n");
        fs.mkdirSync(path.join(tmp, "pantry/platform"), { recursive: true });
        fs.writeFileSync(path.join(tmp, "pantry/platform/manifest.json"),
            JSON.stringify({ workshop_version: workshopVersion, date: "2026-05-01" }, null, 2));
        await fn(tmp);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function defaultMocks() {
    return {
        _brewPrefix: () => "/opt/test/Cellar/sauce/0.36.0",
        _brewWorkshopVersion: () => "0.36.0",
        _runInstaller: async () => {},
        _auditStrict: () => ({ ok: true })
    };
}

async function caseM1Detect() {
    const label = "M1 detects legacy <vault>/pantry/.git/";
    await withTempHome(async () => {
        await withLegacyVault("0.33.0", async (vaultPath) => {
            delete require.cache[require.resolve("../cli/sauce-cli.js")];
            delete require.cache[require.resolve("../cli/cmd-migrate-layout.js")];
            const cmd = require("../cli/cmd-migrate-layout.js");
            const ctx = Object.assign({ vaultPath }, defaultMocks());
            // Use --dry-run to inspect plan without execution side-effects
            let output = "";
            const origLog = console.log; console.log = (s) => { output += String(s) + "\n"; };
            try { await cmd.run(ctx, ["--vault", vaultPath, "--dry-run"]); }
            finally { console.log = origLog; }
            assertTrue(output.toLowerCase().includes("legacy") || output.toLowerCase().includes("pantry"),
                label + " — plan mentions legacy/pantry");
        });
    });
}

async function caseM2BrewMissing() {
    const label = "M2 refuses when brew --prefix sauce fails";
    await withTempHome(async () => {
        await withLegacyVault("0.33.0", async (vaultPath) => {
            delete require.cache[require.resolve("../cli/cmd-migrate-layout.js")];
            const cmd = require("../cli/cmd-migrate-layout.js");
            const ctx = Object.assign({ vaultPath }, defaultMocks(), { _brewPrefix: () => null });
            let threw = false; let msg = "";
            try { await cmd.run(ctx, ["--vault", vaultPath]); }
            catch (e) { threw = true; msg = e.message || ""; }
            assertTrue(threw, label + " — threw");
            assertTrue(msg.toLowerCase().includes("brew"), label + " — message mentions brew");
        });
    });
}

async function caseM3VersionDowngrade() {
    const label = "M3 refuses downgrade (legacy newer than brew)";
    await withTempHome(async () => {
        await withLegacyVault("0.99.0", async (vaultPath) => {
            delete require.cache[require.resolve("../cli/cmd-migrate-layout.js")];
            const cmd = require("../cli/cmd-migrate-layout.js");
            const ctx = Object.assign({ vaultPath }, defaultMocks(), {
                _brewWorkshopVersion: () => "0.36.0"
            });
            let threw = false; let msg = "";
            try { await cmd.run(ctx, ["--vault", vaultPath]); }
            catch (e) { threw = true; msg = e.message || ""; }
            assertTrue(threw, label + " — threw");
            assertTrue(msg.toLowerCase().includes("downgrade") || msg.toLowerCase().includes("version"),
                label + " — message mentions downgrade/version");
        });
    });
}

async function caseM4Archive() {
    const label = "M4 archives pantry/ to pantry.legacy.<ts>.bak/";
    await withTempHome(async () => {
        await withLegacyVault("0.33.0", async (vaultPath) => {
            delete require.cache[require.resolve("../cli/cmd-migrate-layout.js")];
            const cmd = require("../cli/cmd-migrate-layout.js");
            const ctx = Object.assign({ vaultPath }, defaultMocks());
            await cmd.run(ctx, ["--vault", vaultPath]);
            assertEqual(fs.existsSync(path.join(vaultPath, "pantry")), false, label + " — pantry/ moved");
            const baks = fs.readdirSync(vaultPath).filter(n => n.startsWith("pantry.legacy.") && n.endsWith(".bak"));
            assertEqual(baks.length, 1, label + " — one archive present");
        });
    });
}

async function caseM5RegistersVault() {
    const label = "M5 registers vault in ~/.sauce/vaults.json on success";
    await withTempHome(async () => {
        await withLegacyVault("0.33.0", async (vaultPath) => {
            delete require.cache[require.resolve("../cli/cmd-migrate-layout.js")];
            delete require.cache[require.resolve("../cli/registry.js")];
            const cmd = require("../cli/cmd-migrate-layout.js");
            const ctx = Object.assign({ vaultPath }, defaultMocks());
            await cmd.run(ctx, ["--vault", vaultPath]);
            const reg = require("../cli/registry.js").read();
            assertEqual(reg.vaults.length, 1, label + " — registered");
            assertEqual(reg.vaults[0].path, vaultPath, label + " — path");
        });
    });
}

async function caseM6RunsInstaller() {
    const label = "M6 invokes installer once against the migrated vault";
    await withTempHome(async () => {
        await withLegacyVault("0.33.0", async (vaultPath) => {
            delete require.cache[require.resolve("../cli/cmd-migrate-layout.js")];
            const cmd = require("../cli/cmd-migrate-layout.js");
            const calls = [];
            const ctx = Object.assign({ vaultPath }, defaultMocks(), {
                _runInstaller: async (opts) => { calls.push(opts.vaultPath); }
            });
            await cmd.run(ctx, ["--vault", vaultPath]);
            assertEqual(calls.length, 1, label + " — call count");
            assertEqual(calls[0], vaultPath, label + " — target");
        });
    });
}

async function caseM7DryRun() {
    const label = "M7 --dry-run writes nothing";
    await withTempHome(async () => {
        await withLegacyVault("0.33.0", async (vaultPath) => {
            delete require.cache[require.resolve("../cli/cmd-migrate-layout.js")];
            delete require.cache[require.resolve("../cli/registry.js")];
            const cmd = require("../cli/cmd-migrate-layout.js");
            const calls = [];
            const ctx = Object.assign({ vaultPath }, defaultMocks(), {
                _runInstaller: async (opts) => { calls.push(opts.vaultPath); }
            });
            // Silence stdout
            const origLog = console.log; console.log = () => {};
            try { await cmd.run(ctx, ["--vault", vaultPath, "--dry-run"]); }
            finally { console.log = origLog; }
            assertEqual(fs.existsSync(path.join(vaultPath, "pantry")), true, label + " — pantry/ untouched");
            const baks = fs.readdirSync(vaultPath).filter(n => n.startsWith("pantry.legacy."));
            assertEqual(baks.length, 0, label + " — no archive created");
            assertEqual(calls.length, 0, label + " — installer not invoked");
            assertEqual(require("../cli/registry.js").read().vaults.length, 0, label + " — registry untouched");
        });
    });
}

async function caseM8Purge() {
    const label = "M8 --purge removes archive after clean audit";
    await withTempHome(async () => {
        await withLegacyVault("0.33.0", async (vaultPath) => {
            delete require.cache[require.resolve("../cli/cmd-migrate-layout.js")];
            const cmd = require("../cli/cmd-migrate-layout.js");
            const ctx = Object.assign({ vaultPath }, defaultMocks());
            await cmd.run(ctx, ["--vault", vaultPath, "--purge"]);
            const baks = fs.readdirSync(vaultPath).filter(n => n.startsWith("pantry.legacy."));
            assertEqual(baks.length, 0, label + " — archive purged");
        });
    });
}

async function caseM9AllowDowngrade() {
    const label = "M9 --allow-downgrade bypasses M3 refusal";
    await withTempHome(async () => {
        await withLegacyVault("0.99.0", async (vaultPath) => {
            delete require.cache[require.resolve("../cli/cmd-migrate-layout.js")];
            const cmd = require("../cli/cmd-migrate-layout.js");
            const ctx = Object.assign({ vaultPath }, defaultMocks(), {
                _brewWorkshopVersion: () => "0.36.0"
            });
            let threw = false;
            try { await cmd.run(ctx, ["--vault", vaultPath, "--allow-downgrade"]); }
            catch (_e) { threw = true; }
            assertEqual(threw, false, label + " — did not throw");
            assertEqual(fs.existsSync(path.join(vaultPath, "pantry")), false, label + " — migrated through");
        });
    });
}

const cases = [
    caseM1Detect,
    caseM2BrewMissing,
    caseM3VersionDowngrade,
    caseM4Archive,
    caseM5RegistersVault,
    caseM6RunsInstaller,
    caseM7DryRun,
    caseM8Purge,
    caseM9AllowDowngrade
];

(async () => {
    for (const c of cases) {
        try { await c(); }
        catch (e) { fail++; console.log("  FAIL  " + c.name + ": " + (e.message || e)); }
    }
    console.log(`\n  ${pass} pass · ${fail} fail`);
    process.exit(fail > 0 ? 1 : 0);
})();
