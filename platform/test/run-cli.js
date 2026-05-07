#!/usr/bin/env node
// run-cli.js — harness for platform/cli/* verb dispatcher + cmd-*.js modules.
// Mirrors run-bootstrap.js conventions: assertTrue / assertEqual / withTempVault.

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

async function withTempVault(setup, fn) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "beacon-cli-"));
    try {
        fs.mkdirSync(path.join(tmp, "Docs/Meta"), { recursive: true });
        fs.writeFileSync(path.join(tmp, "Docs/Meta/platform-config.json"),
            JSON.stringify({ workshop_relative_path: "pantry", variables: {} }, null, 2));
        fs.writeFileSync(path.join(tmp, "Docs/Meta/platform-subscription.json"),
            JSON.stringify({ mechanisms: [], blueprints: [] }, null, 2));
        if (typeof setup === "function") await setup(tmp);
        await fn(tmp);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// C1: dispatcher walks cwd ancestors to find vault
async function caseC1AncestorWalk() {
    const label = "C1 dispatcher walks cwd ancestors to find vault";
    await withTempVault({}, async (vaultPath) => {
        const cli = require("../cli/sauce-cli.js");
        const ctx = await cli.resolveContext({ cwd: path.join(vaultPath, "Docs/Meta") });
        assertEqual(ctx.vaultPath, vaultPath, label);
    });
}

// C2: SAUCE_VAULT env-var fallback when cwd is not in a vault
async function caseC2SauceVaultEnv() {
    const label = "C2 dispatcher honors SAUCE_VAULT env-var fallback";
    await withTempVault({}, async (vaultPath) => {
        const cli = require("../cli/sauce-cli.js");
        const ctx = await cli.resolveContext({ cwd: os.tmpdir(), env: { SAUCE_VAULT: vaultPath } });
        assertEqual(ctx.vaultPath, vaultPath, label);
    });
}

// C3: not-in-vault error
async function caseC3NotInVault() {
    const label = "C3 dispatcher errors when not in vault and SAUCE_VAULT unset";
    const cli = require("../cli/sauce-cli.js");
    let threw = false;
    try { await cli.resolveContext({ cwd: "/", env: {} }); }
    catch (e) { threw = true; assertTrue(/Not inside a sauce-managed vault/.test(e.message), label + ": error message"); }
    if (!threw) { fail++; console.log("  FAIL  " + label + " — expected throw"); }
}

// C4: unknown verb
async function caseC4UnknownVerb() {
    const label = "C4 dispatcher errors on unknown verb";
    await withTempVault({}, async (vaultPath) => {
        const cli = require("../cli/sauce-cli.js");
        let threw = false;
        try { await cli.dispatch(["frobnicate"], { cwd: vaultPath, env: {} }); }
        catch (e) { threw = true; assertTrue(/unknown verb/i.test(e.message), label + ": error message"); }
        if (!threw) { fail++; console.log("  FAIL  " + label + " — expected throw"); }
    });
}

// C5: status reports clean state
async function caseC5StatusClean() {
    const label = "C5 status reports clean state on fresh vault";
    await withTempVault({}, async (vaultPath) => {
        // Stub workshop fixture so status can read manifest
        fs.mkdirSync(path.join(vaultPath, "pantry/platform"), { recursive: true });
        fs.writeFileSync(path.join(vaultPath, "pantry/platform/manifest.json"),
            JSON.stringify({ workshop_version: "0.22.0", mechanisms: [], blueprints: [] }, null, 2));
        const cmd = require("../cli/cmd-status.js");
        const ctx = { vaultPath, config: { workshop_relative_path: "pantry" },
            subscription: { mechanisms: [], blueprints: [] },
            workshopPath: path.join(vaultPath, "pantry"),
            workshopManifest: { workshop_version: "0.22.0", mechanisms: [], blueprints: [] } };
        const out = await cmd.run(ctx, []);  // returns { lines: [...] } in test mode
        assertTrue(out.lines.some(l => /Vault:\s/.test(l)), label + ": vault line present");
        assertTrue(out.lines.some(l => /Drift:\s+none/.test(l)), label + ": drift = none");
    });
}

// C6: status detects subscribed-vs-installed drift
async function caseC6StatusDrift() {
    const label = "C6 status detects subscription/install drift";
    await withTempVault({}, async (vaultPath) => {
        const cmd = require("../cli/cmd-status.js");
        // Subscribed: validator@0.1.1; Installed (history): validator@0.1.0
        fs.writeFileSync(path.join(vaultPath, "Docs/Meta/platform-installed.json"),
            JSON.stringify({ history: [{ kind: "mechanisms", name: "validator", version: "0.1.0" }] }, null, 2));
        const ctx = { vaultPath, config: { workshop_relative_path: "pantry" },
            subscription: { mechanisms: [{ name: "validator", version: "0.1.1" }], blueprints: [] },
            workshopPath: path.join(vaultPath, "pantry"),
            workshopManifest: { workshop_version: "0.22.0", mechanisms: [{ name: "validator", version: "0.1.1" }], blueprints: [] } };
        const out = await cmd.run(ctx, []);
        assertTrue(out.lines.some(l => /Drift:.*validator/i.test(l)), label + ": drift line names validator");
    });
}

// C7: update ff-only mock-git path succeeds
async function caseC7UpdateFFOnly() {
    const label = "C7 update happy-path with mocked git";
    await withTempVault({}, async (vaultPath) => {
        const cmd = require("../cli/cmd-update.js");
        // Inject mockGit hook on ctx
        const events = [];
        const ctx = {
            vaultPath, config: { workshop_relative_path: "pantry" },
            subscription: { mechanisms: [], blueprints: [] },
            workshopPath: path.join(vaultPath, "pantry"),
            workshopManifest: { workshop_version: "0.22.0" },
            _gitExec: (args) => { events.push(args.join(" ")); return { code: 0, stdout: "", stderr: "" }; },
            _npmInstall: () => { events.push("npm install"); return { code: 0 }; },
            _runInstaller: () => { events.push("install"); }
        };
        await cmd.run(ctx, []);
        assertTrue(events.includes("fetch origin main"), label + ": git fetch invoked");
        assertTrue(events.some(e => /reset --hard origin\/main/.test(e)), label + ": reset --hard invoked");
        assertTrue(events.includes("install"), label + ": installer phase invoked");
    });
}

// C8: update refuses on dirty tree without --force
async function caseC8UpdateDirtyRefusal() {
    const label = "C8 update fails loud on dirty tree without --force";
    await withTempVault({}, async (vaultPath) => {
        const cmd = require("../cli/cmd-update.js");
        const ctx = {
            vaultPath, config: { workshop_relative_path: "pantry" },
            subscription: { mechanisms: [], blueprints: [] },
            workshopPath: path.join(vaultPath, "pantry"),
            workshopManifest: { workshop_version: "0.22.0" },
            _gitExec: (args) => {
                if (args[0] === "status" && args.includes("--short")) return { code: 0, stdout: " M file.js\n", stderr: "" };
                return { code: 0, stdout: "", stderr: "" };
            }
        };
        let threw = false;
        try { await cmd.run(ctx, []); }
        catch (e) { threw = true; assertTrue(/dirty/i.test(e.message), label + ": error message names dirty tree"); }
        if (!threw) { fail++; console.log("  FAIL  " + label + " — expected throw"); }
    });
}

// C9: update --force overrides dirty tree
async function caseC9UpdateForceOverride() {
    const label = "C9 update --force overrides dirty tree";
    await withTempVault({}, async (vaultPath) => {
        const cmd = require("../cli/cmd-update.js");
        const events = [];
        const ctx = {
            vaultPath, config: { workshop_relative_path: "pantry" },
            subscription: { mechanisms: [], blueprints: [] },
            workshopPath: path.join(vaultPath, "pantry"),
            workshopManifest: { workshop_version: "0.22.0" },
            _gitExec: (args) => {
                if (args[0] === "status" && args.includes("--short")) return { code: 0, stdout: " M file.js\n", stderr: "" };
                events.push(args.join(" "));
                return { code: 0, stdout: "", stderr: "" };
            },
            _runInstaller: () => { events.push("install"); }
        };
        await cmd.run(ctx, ["--force"]);
        assertTrue(events.some(e => /reset --hard/.test(e)), label + ": reset --hard invoked despite dirty");
    });
}

// C10: wizard delegates to runReRunWizard
async function caseC10WizardDelegates() {
    const label = "C10 wizard delegates to runReRunWizard";
    await withTempVault({}, async (vaultPath) => {
        const cmd = require("../cli/cmd-wizard.js");
        let called = false;
        const ctx = {
            vaultPath, config: { workshop_relative_path: "pantry" },
            subscription: { mechanisms: [], blueprints: [] },
            workshopPath: path.join(vaultPath, "pantry"),
            workshopManifest: { workshop_version: "0.22.0" },
            _runReRunWizard: async () => { called = true; return { action: "quit" }; }
        };
        await cmd.run(ctx, []);
        assertTrue(called, label);
    });
}

// C11: cmd-bootstrap parses --non-interactive and threads to runBootstrap
async function caseC11BootstrapNonInteractive() {
    const label = "C11 cmd-bootstrap parses --non-interactive";
    await withTempVault({}, async (vaultPath) => {
        // Stub workshop manifest so cmd-bootstrap can read banner version.
        fs.mkdirSync(path.join(vaultPath, "pantry/platform"), { recursive: true });
        fs.writeFileSync(path.join(vaultPath, "pantry/platform/manifest.json"),
            JSON.stringify({ workshop_version: "0.22.1", mechanisms: [], blueprints: [] }, null, 2));

        // Pre-load bootstrap module + monkey-patch runBootstrap on the resolved module
        // so we can capture opts. Using `require("../bootstrap.js")` matches what
        // cmd-bootstrap.js does internally — same module instance.
        const bootstrap = require("../bootstrap.js");
        const originalRunBootstrap = bootstrap.runBootstrap;
        const originalPhaseWriteActivation = bootstrap.phaseWriteActivation;
        let captured = null;
        bootstrap.runBootstrap = async (opts) => { captured = opts; return { fetched: [], skipped: [], failed: [] }; };
        bootstrap.phaseWriteActivation = async () => ({});
        try {
            const cmd = require("../cli/cmd-bootstrap.js");
            const ctx = {
                vaultPath,
                workshopPath: path.join(vaultPath, "pantry"),
                workshopManifest: { workshop_version: "0.22.1" }
            };
            await cmd.run(ctx, ["--vault", vaultPath, "--non-interactive"]);
            assertTrue(captured !== null, label + ": runBootstrap invoked");
            assertEqual(captured.nonInteractive, true, label + ": nonInteractive=true");
        } finally {
            bootstrap.runBootstrap = originalRunBootstrap;
            bootstrap.phaseWriteActivation = originalPhaseWriteActivation;
        }
    });
}

// C12: cmd-bootstrap parses --mechanisms=all and threads to runBootstrap.wizardDefaults
async function caseC12BootstrapMechanismsAll() {
    const label = "C12 cmd-bootstrap parses --mechanisms=all";
    await withTempVault({}, async (vaultPath) => {
        fs.mkdirSync(path.join(vaultPath, "pantry/platform"), { recursive: true });
        fs.writeFileSync(path.join(vaultPath, "pantry/platform/manifest.json"),
            JSON.stringify({ workshop_version: "0.22.1", mechanisms: [], blueprints: [] }, null, 2));
        const bootstrap = require("../bootstrap.js");
        const originalRunBootstrap = bootstrap.runBootstrap;
        const originalPhaseWriteActivation = bootstrap.phaseWriteActivation;
        let captured = null;
        bootstrap.runBootstrap = async (opts) => { captured = opts; return { fetched: [], skipped: [], failed: [] }; };
        bootstrap.phaseWriteActivation = async () => ({});
        try {
            const cmd = require("../cli/cmd-bootstrap.js");
            const ctx = {
                vaultPath,
                workshopPath: path.join(vaultPath, "pantry"),
                workshopManifest: { workshop_version: "0.22.1" }
            };
            await cmd.run(ctx, ["--vault", vaultPath, "--non-interactive", "--mechanisms=all"]);
            assertTrue(captured !== null, label + ": runBootstrap invoked");
            assertTrue(captured.wizardDefaults && captured.wizardDefaults.mechanisms === "all",
                label + ": wizardDefaults.mechanisms = 'all'");
        } finally {
            bootstrap.runBootstrap = originalRunBootstrap;
            bootstrap.phaseWriteActivation = originalPhaseWriteActivation;
        }
    });
}

// C13: cmd-bootstrap parses --blueprints=daily,journal as CSV
async function caseC13BootstrapBlueprintsCsv() {
    const label = "C13 cmd-bootstrap parses --blueprints=daily,journal";
    await withTempVault({}, async (vaultPath) => {
        fs.mkdirSync(path.join(vaultPath, "pantry/platform"), { recursive: true });
        fs.writeFileSync(path.join(vaultPath, "pantry/platform/manifest.json"),
            JSON.stringify({ workshop_version: "0.22.1", mechanisms: [], blueprints: [] }, null, 2));
        const bootstrap = require("../bootstrap.js");
        const originalRunBootstrap = bootstrap.runBootstrap;
        const originalPhaseWriteActivation = bootstrap.phaseWriteActivation;
        let captured = null;
        bootstrap.runBootstrap = async (opts) => { captured = opts; return { fetched: [], skipped: [], failed: [] }; };
        bootstrap.phaseWriteActivation = async () => ({});
        try {
            const cmd = require("../cli/cmd-bootstrap.js");
            const ctx = {
                vaultPath,
                workshopPath: path.join(vaultPath, "pantry"),
                workshopManifest: { workshop_version: "0.22.1" }
            };
            await cmd.run(ctx, ["--vault", vaultPath, "--non-interactive", "--blueprints=daily,journal"]);
            assertTrue(captured !== null, label + ": runBootstrap invoked");
            const bp = captured.wizardDefaults && captured.wizardDefaults.blueprints;
            assertTrue(Array.isArray(bp) && bp.length === 2 && bp[0] === "daily" && bp[1] === "journal",
                label + ": wizardDefaults.blueprints = ['daily','journal']");
        } finally {
            bootstrap.runBootstrap = originalRunBootstrap;
            bootstrap.phaseWriteActivation = originalPhaseWriteActivation;
        }
    });
}

// C14: wizard nonInteractive branch defaults selectedMechs to DEFAULT_MECHANISMS_CHECKED
async function caseC14WizardNonInteractiveDefaults() {
    const label = "C14 wizard nonInteractive defaults match interactive defaults";
    await withTempVault({}, async (vaultPath) => {
        // Set up a workshop manifest at the resolved path so the wizard's
        // CF-3 manifest-load branch finds it (defaults populated for valid pins).
        fs.mkdirSync(path.join(vaultPath, "pantry/platform"), { recursive: true });
        fs.writeFileSync(path.join(vaultPath, "pantry/platform/manifest.json"),
            JSON.stringify({
                workshop_version: "0.22.1",
                mechanisms: [
                    { name: "customjs-guard", version: "1.0.0" },
                    { name: "nav-buttons", version: "2.5.2" },
                    { name: "cards", version: "0.2.3" },
                    { name: "beacon-button", version: "0.1.0" },
                    { name: "styling", version: "0.1.2" },
                    { name: "validator", version: "0.1.1" }   // NOT in default-checked
                ],
                blueprints: []
            }, null, 2));

        const wizardMod = require("../bootstrap-lib/wizard.js");
        const r = await wizardMod.runFirstRunWizard({
            vaultPath,
            workshopManifest: null,    // force CF-3 manifest-load
            nonInteractive: true,
            defaults: {}               // no overrides — exercise default fallback
        });
        const subscribedNames = (r.subscription.mechanisms || []).map(m => m.name).sort();
        const expected = ["beacon-button", "cards", "customjs-guard", "nav-buttons", "styling"];
        assertEqual(JSON.stringify(subscribedNames), JSON.stringify(expected),
            label + ": 5 default mechs (NOT including validator)");
    });
}

const cases = [
    caseC1AncestorWalk, caseC2SauceVaultEnv, caseC3NotInVault, caseC4UnknownVerb,
    caseC5StatusClean, caseC6StatusDrift, caseC7UpdateFFOnly, caseC8UpdateDirtyRefusal,
    caseC9UpdateForceOverride, caseC10WizardDelegates,
    caseC11BootstrapNonInteractive, caseC12BootstrapMechanismsAll,
    caseC13BootstrapBlueprintsCsv, caseC14WizardNonInteractiveDefaults
];

async function main() {
    for (const c of cases) {
        try { await c(); }
        catch (e) { fail++; console.log("  FAIL  " + c.name + ": " + (e.message || e)); }
    }
    console.log("\n========\nResult: " + pass + " passed, " + fail + " failed.");
    process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(e => { console.error(e.stack || e.message); process.exit(1); });
