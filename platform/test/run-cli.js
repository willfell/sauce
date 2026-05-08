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
        fs.mkdirSync(path.join(tmp, "ranch"), { recursive: true });
        fs.writeFileSync(path.join(tmp, "ranch/platform-config.json"),
            JSON.stringify({ workshop_relative_path: "pantry", variables: {} }, null, 2));
        fs.writeFileSync(path.join(tmp, "ranch/platform-subscription.json"),
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
        const ctx = await cli.resolveContext({ cwd: path.join(vaultPath, "ranch") });
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
        fs.writeFileSync(path.join(vaultPath, "ranch/platform-installed.json"),
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

// C14: wizard nonInteractive branch defaults selectedMechs to DEFAULT_MECHANISMS_CHECKED.
// v0.26.0 P0-3: convenience is now in DEFAULT_MECHANISMS_CHECKED so fresh non-interactive
// installs get DataviewJS + copy-path hotkeys by default.
async function caseC14WizardNonInteractiveDefaults() {
    const label = "C14 wizard nonInteractive defaults match interactive defaults";
    await withTempVault({}, async (vaultPath) => {
        // Set up a workshop manifest at the resolved path so the wizard's
        // CF-3 manifest-load branch finds it (defaults populated for valid pins).
        fs.mkdirSync(path.join(vaultPath, "pantry/platform"), { recursive: true });
        fs.writeFileSync(path.join(vaultPath, "pantry/platform/manifest.json"),
            JSON.stringify({
                workshop_version: "0.26.0",
                mechanisms: [
                    { name: "customjs-guard", version: "1.0.0" },
                    { name: "nav-buttons", version: "2.5.2" },
                    { name: "cards", version: "0.2.3" },
                    { name: "accent-button", version: "0.1.0" },
                    { name: "styling", version: "0.1.2" },
                    { name: "convenience", version: "0.1.0" },  // NEW v0.26.0 — must be defaulted
                    { name: "validator", version: "0.1.1" }     // NOT in default-checked
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
        const expected = ["accent-button", "cards", "convenience", "customjs-guard", "nav-buttons", "styling"];
        assertEqual(JSON.stringify(subscribedNames), JSON.stringify(expected),
            label + ": 6 default mechs (including convenience; NOT including validator)");
        // v0.26.0 P0-3 explicit regression-guard: convenience MUST be in the default
        // subscription set so DataviewJS + copy-path hotkeys come on by default.
        assertTrue(subscribedNames.includes("convenience"),
            label + ": convenience present in default subscription");
    });
}

// C15: v0.26.0 P0-1 — wizard Edit-subscription writes flat {name, version} entries.
// Symptom on v0.25.x: legacy double-wrap of existing subscription entries shaped
// {name: {name: "X", version: "Y"}, version: "0.0.0"}. After P0-1 fix, the
// _normalizeSubscriptionFile helper heals legacy entries on next edit.
async function caseC15WizardEditSubscriptionFlatWrite() {
    const label = "C15 wizard edit-subscription writes flat {name, version} entries";
    await withTempVault({}, async (vaultPath) => {
        // Pre-populate subscription with legacy double-wrapped entries on disk
        // (mimicking the v0.25.x bug shape).
        const subPath = path.join(vaultPath, "ranch/platform-subscription.json");
        fs.writeFileSync(subPath, JSON.stringify({
            mechanisms: [
                { name: { name: "customjs-guard", version: "1.0.0" }, version: "0.0.0" },
                { name: { name: "nav-buttons",    version: "2.5.2" }, version: "0.0.0" }
            ],
            blueprints: []
        }, null, 2));

        const manifestMechs = [
            { name: "customjs-guard", version: "1.0.0" },
            { name: "nav-buttons", version: "2.5.2" },
            { name: "cards", version: "0.2.3" }  // NOT in selection
        ];

        const wizardMod = require("../bootstrap-lib/wizard.js");
        if (typeof wizardMod._normalizeSubscriptionFile !== "function") {
            fail++;
            console.log("  FAIL: " + label + " — wizardMod._normalizeSubscriptionFile not exported (P0-1 helper not yet implemented)");
            return;
        }

        // Simulate the writeback path: caller passes bare-string selection;
        // helper reads existing file (with legacy double-wrap), normalizes
        // to flat shape, writes back.
        wizardMod._normalizeSubscriptionFile(subPath, {
            mechanisms: ["customjs-guard", "nav-buttons"],
            blueprints: []
        }, { mechanisms: manifestMechs, blueprints: [] });

        const after = JSON.parse(fs.readFileSync(subPath, "utf8"));
        assertTrue(Array.isArray(after.mechanisms) && after.mechanisms.length === 2,
            label + ": 2 mechanisms written");
        assertTrue(after.mechanisms.every(m => typeof m.name === "string"),
            label + ": every mechanisms[].name is a string (no nested object)");
        assertTrue(after.mechanisms.every(m => typeof m.version === "string" && m.version !== "0.0.0"),
            label + ": every mechanisms[].version is a non-sentinel string");
        assertTrue(after.mechanisms.every(m => !(m.name && typeof m.name === "object")),
            label + ": no nested {name: {...}} double-wrap remains");
        // Verify version was correctly resolved from manifestMechs:
        const cjs = after.mechanisms.find(m => m.name === "customjs-guard");
        assertEqual(cjs && cjs.version, "1.0.0", label + ": customjs-guard version resolved from manifest");
        const nb = after.mechanisms.find(m => m.name === "nav-buttons");
        assertEqual(nb && nb.version, "2.5.2", label + ": nav-buttons version resolved from manifest");
    });
}

// C16-C19: v0.26.1 P1-3a — `sauce help` verb.
// cmd-help.js does NOT exist yet at S1. Pre-S2, cases FAIL with
// "Cannot find module './cmd-help.js'". Post-S2, cases assert on
// the help-output `{ lines }` shape returned by cmd-help.run.
//
// SAUCE_TEST_MODE is set on each case so cmd-help suppresses console.log
// (the canonical pattern from cmd-status.js).

async function caseC16HelpVerbOutput() {
    const label = "C16 sauce help verb output contains all 5 verbs";
    process.env.SAUCE_TEST_MODE = "1";
    try {
        const cmd = require("../cli/cmd-help.js");
        const out = await cmd.run(null, []);
        const joined = (out && Array.isArray(out.lines)) ? out.lines.join("\n") : "";
        assertTrue(/bootstrap/.test(joined), label + ": mentions bootstrap");
        assertTrue(/update/.test(joined), label + ": mentions update");
        assertTrue(/status/.test(joined), label + ": mentions status");
        assertTrue(/wizard/.test(joined), label + ": mentions wizard");
        assertTrue(/help/.test(joined), label + ": mentions help");
    } finally {
        delete process.env.SAUCE_TEST_MODE;
    }
}

async function caseC17BareSauceRoutesToHelp() {
    const label = "C17 bare sauce (no verb) routes to help";
    process.env.SAUCE_TEST_MODE = "1";
    // Spy: monkey-patch require.cache for cmd-help.js so dispatch() picks
    // up our spy instead of the real module. This decouples the route-to-help
    // assertion from cmd-help.run's actual output (which C16 already covers).
    const helpPath = path.resolve(__dirname, "../cli/cmd-help.js");
    let invocations = 0;
    require.cache[helpPath] = { exports: { run: async (_ctx, _args) => { invocations++; return { lines: [] }; } } };
    try {
        const cli = require("../cli/sauce-cli.js");
        // No verb -> dispatch(['']) maps to undefined -> should route to help.
        await cli.dispatch([], { cwd: os.tmpdir(), env: {} });
        assertTrue(invocations >= 1, label + ": cmd-help.run invoked at least once");
    } catch (e) {
        fail++;
        console.log("  FAIL  " + label + ": threw " + (e.message || e));
    } finally {
        delete require.cache[helpPath];
        // Also evict sauce-cli so it picks up fresh VERBS map next test.
        const cliPath = path.resolve(__dirname, "../cli/sauce-cli.js");
        delete require.cache[cliPath];
        delete process.env.SAUCE_TEST_MODE;
    }
}

async function caseC18LongAndShortHelpFlags() {
    const label = "C18 sauce --help and sauce -h route to help";
    process.env.SAUCE_TEST_MODE = "1";
    const helpPath = path.resolve(__dirname, "../cli/cmd-help.js");
    const cliPath = path.resolve(__dirname, "../cli/sauce-cli.js");
    let invocations = 0;
    require.cache[helpPath] = { exports: { run: async (_ctx, _args) => { invocations++; return { lines: [] }; } } };
    try {
        delete require.cache[cliPath];
        const cli = require("../cli/sauce-cli.js");
        await cli.dispatch(["--help"], { cwd: os.tmpdir(), env: {} });
        const afterLong = invocations;
        await cli.dispatch(["-h"], { cwd: os.tmpdir(), env: {} });
        const afterShort = invocations;
        assertTrue(afterLong >= 1, label + ": --help invoked cmd-help.run");
        assertTrue(afterShort > afterLong, label + ": -h also invoked cmd-help.run");
    } catch (e) {
        fail++;
        console.log("  FAIL  " + label + ": threw " + (e.message || e));
    } finally {
        delete require.cache[helpPath];
        delete require.cache[cliPath];
        delete process.env.SAUCE_TEST_MODE;
    }
}

async function caseC19HelpWorksOutsideVault() {
    const label = "C19 sauce help works outside any vault (no resolveContext)";
    process.env.SAUCE_TEST_MODE = "1";
    const helpPath = path.resolve(__dirname, "../cli/cmd-help.js");
    const cliPath = path.resolve(__dirname, "../cli/sauce-cli.js");
    let invocations = 0;
    let resolveContextThrew = false;
    // Spy cmd-help so the call is observable without depending on the real
    // module's output.
    require.cache[helpPath] = { exports: { run: async (_ctx, _args) => { invocations++; return { lines: [] }; } } };
    try {
        delete require.cache[cliPath];
        const cli = require("../cli/sauce-cli.js");
        // cwd=/, env without SAUCE_VAULT — resolveContext would throw if reached.
        try {
            await cli.dispatch(["help"], { cwd: "/", env: {} });
        } catch (e) {
            if (/Not inside a sauce-managed vault/.test(e.message || "")) {
                resolveContextThrew = true;
            } else {
                throw e;
            }
        }
        assertTrue(invocations >= 1, label + ": cmd-help.run invoked despite no vault");
        assertTrue(!resolveContextThrew, label + ": resolveContext NOT thrown for help verb");
    } catch (e) {
        fail++;
        console.log("  FAIL  " + label + ": threw " + (e.message || e));
    } finally {
        delete require.cache[helpPath];
        delete require.cache[cliPath];
        delete process.env.SAUCE_TEST_MODE;
    }
}

// C20-C22: v0.26.1 P1-3c — sauce status convenience-warn block.
// cmd-status.js does NOT have the warn block yet at S1. Pre-S2, cases FAIL
// because the expected "[warn]" line is missing from out.lines. Post-S2, the
// warn block reads each subscribed blueprint's manifest, checks depends_on
// for "convenience", and emits a warn line when convenience is not subscribed.

async function _seedBlueprintManifest(workshopPath, name, manifest) {
    const dir = path.join(workshopPath, "platform/blueprints", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

async function caseC20StatusWarnsConvenienceMissing() {
    const label = "C20 status warns when DV blueprint subscribed but convenience absent";
    await withTempVault({}, async (vaultPath) => {
        // Stub workshop fixture so status can read blueprint manifests.
        fs.mkdirSync(path.join(vaultPath, "pantry/platform"), { recursive: true });
        fs.writeFileSync(path.join(vaultPath, "pantry/platform/manifest.json"),
            JSON.stringify({ workshop_version: "0.26.1", mechanisms: [], blueprints: [{ name: "project", version: "1.3.6" }] }, null, 2));
        await _seedBlueprintManifest(path.join(vaultPath, "pantry"), "project", {
            name: "project", version: "1.3.6",
            depends_on: [{ name: "convenience", range: ">=0.1.0" }]
        });
        const cmd = require("../cli/cmd-status.js");
        const ctx = {
            vaultPath, config: { workshop_relative_path: "pantry" },
            subscription: { mechanisms: [], blueprints: [{ name: "project", version: "1.3.6" }] },
            workshopPath: path.join(vaultPath, "pantry"),
            workshopManifest: { workshop_version: "0.26.1" },
            // Mock _gitExec so status doesn't shell out.
            _gitExec: () => ({ code: 0, stdout: "", stderr: "" }),
        };
        const out = await cmd.run(ctx, []);
        const joined = (out && Array.isArray(out.lines)) ? out.lines.join("\n") : "";
        assertTrue(/\[warn\]/.test(joined), label + ": output contains [warn]");
        assertTrue(/convenience/.test(joined), label + ": warn mentions convenience");
        assertTrue(/project/.test(joined), label + ": warn names the project blueprint");
    });
}

async function caseC21StatusSilentWhenConvenienceSubscribed() {
    const label = "C21 status silent on convenience when convenience subscribed";
    await withTempVault({}, async (vaultPath) => {
        fs.mkdirSync(path.join(vaultPath, "pantry/platform"), { recursive: true });
        fs.writeFileSync(path.join(vaultPath, "pantry/platform/manifest.json"),
            JSON.stringify({ workshop_version: "0.26.1", mechanisms: [], blueprints: [{ name: "project", version: "1.3.6" }] }, null, 2));
        await _seedBlueprintManifest(path.join(vaultPath, "pantry"), "project", {
            name: "project", version: "1.3.6",
            depends_on: [{ name: "convenience", range: ">=0.1.0" }]
        });
        const cmd = require("../cli/cmd-status.js");
        const ctx = {
            vaultPath, config: { workshop_relative_path: "pantry" },
            subscription: {
                mechanisms: [{ name: "convenience", version: "0.1.0" }],
                blueprints: [{ name: "project", version: "1.3.6" }]
            },
            workshopPath: path.join(vaultPath, "pantry"),
            workshopManifest: { workshop_version: "0.26.1" },
            _gitExec: () => ({ code: 0, stdout: "", stderr: "" }),
        };
        const out = await cmd.run(ctx, []);
        const joined = (out && Array.isArray(out.lines)) ? out.lines.join("\n") : "";
        assertTrue(!/\[warn\].*convenience/i.test(joined), label + ": no convenience warn line");
    });
}

async function caseC22StatusSilentWhenNoDvBlueprint() {
    const label = "C22 status silent on convenience when no DV blueprint subscribed";
    await withTempVault({}, async (vaultPath) => {
        fs.mkdirSync(path.join(vaultPath, "pantry/platform"), { recursive: true });
        fs.writeFileSync(path.join(vaultPath, "pantry/platform/manifest.json"),
            JSON.stringify({ workshop_version: "0.26.1", mechanisms: [], blueprints: [{ name: "boards", version: "0.1.0" }] }, null, 2));
        // Boards has NO convenience dep.
        await _seedBlueprintManifest(path.join(vaultPath, "pantry"), "boards", {
            name: "boards", version: "0.1.0",
            depends_on: []
        });
        const cmd = require("../cli/cmd-status.js");
        const ctx = {
            vaultPath, config: { workshop_relative_path: "pantry" },
            subscription: {
                mechanisms: [],
                blueprints: [{ name: "boards", version: "0.1.0" }]
            },
            workshopPath: path.join(vaultPath, "pantry"),
            workshopManifest: { workshop_version: "0.26.1" },
            _gitExec: () => ({ code: 0, stdout: "", stderr: "" }),
        };
        const out = await cmd.run(ctx, []);
        const joined = (out && Array.isArray(out.lines)) ? out.lines.join("\n") : "";
        assertTrue(!/\[warn\].*convenience/i.test(joined), label + ": no convenience warn line for boards-only");
    });
}

// =====================================================================
// v0.28.0 — `sauce migrate` verb cases (C23-C28)
// =====================================================================

async function caseC23MigrateParseFlagsFromSpace() {
    const label = "C23 cmd-migrate._parseFlags parses --from <path>";
    const cmd = require("../cli/cmd-migrate.js");
    const flags = cmd._parseFlags(["--from", "/tmp/source"]);
    assertEqual(flags.from, "/tmp/source", label + " from value");
    assertEqual(flags.commit, false, label + " commit default false");
}

async function caseC24MigrateParseFlagsFromEquals() {
    const label = "C24 cmd-migrate._parseFlags parses --from=<path> equals form";
    const cmd = require("../cli/cmd-migrate.js");
    const flags = cmd._parseFlags(["--from=/tmp/equals"]);
    assertEqual(flags.from, "/tmp/equals", label + " from value");
    const flagsCommit = cmd._parseFlags(["--from=/x", "--commit"]);
    assertEqual(flagsCommit.commit, true, label + " --commit recognized");
}

async function caseC25MigrateExitsOnMissingFrom() {
    const label = "C25 cmd-migrate.run exits 2 when --from missing";
    const cmd = require("../cli/cmd-migrate.js");
    const origExit = process.exit;
    let exitCode = null;
    process.exit = (c) => { exitCode = c; throw new Error("__exit__"); };
    try { await cmd.run({}, []); }
    catch (e) { /* swallow exit-throw */ }
    finally { process.exit = origExit; }
    assertEqual(exitCode, 2, label);
}

async function caseC26MigrateExitsOnNonexistentFrom() {
    const label = "C26 cmd-migrate.run exits 2 when --from path does not exist";
    const cmd = require("../cli/cmd-migrate.js");
    const origExit = process.exit;
    let exitCode = null;
    process.exit = (c) => { exitCode = c; throw new Error("__exit__"); };
    try { await cmd.run({}, ["--from", "/definitely/nonexistent/path/" + Date.now()]); }
    catch (_e) {}
    finally { process.exit = origExit; }
    assertEqual(exitCode, 2, label);
}

async function caseC27MigrateInVerbsRegistry() {
    const label = "C27 sauce-cli.js VERBS includes migrate";
    const cliSource = fs.readFileSync(path.join(__dirname, "..", "cli", "sauce-cli.js"), "utf8");
    assertTrue(/migrate:\s*"\.\/cmd-migrate\.js"/.test(cliSource), label);
}

async function caseC28HelpMentionsMigrate() {
    const label = "C28 cmd-help output lists migrate verb";
    const cmd = require("../cli/cmd-help.js");
    const out = await cmd.run(null, []);
    const joined = (out && Array.isArray(out.lines)) ? out.lines.join("\n") : "";
    assertTrue(/\bmigrate\b/.test(joined), label);
}

// =====================================================================
// v0.29.0 — `sauce audit` verb cases (CA1-CA5)
// =====================================================================

// CA1 — cmd-audit._parseFlags parses --vault <path>
async function caseCA1AuditParseVaultFlag() {
    const label = "CA1 cmd-audit._parseFlags parses --vault <path>";
    const cmdAudit = require("../cli/cmd-audit");
    const flags = cmdAudit._parseFlags(["--vault", "/tmp/v"]);
    assertEqual(flags.vault, "/tmp/v", label);
}

// CA2 — multi-flag together
async function caseCA2AuditParseMultiFlag() {
    const label = "CA2 cmd-audit._parseFlags parses multi-flag combo";
    const cmdAudit = require("../cli/cmd-audit");
    const flags = cmdAudit._parseFlags(["--blueprint", "trips", "--output-file", "foo.md", "--no-untracked-check", "--quiet"]);
    assertEqual(flags.blueprint, "trips", label + " --blueprint");
    assertEqual(flags.outputFile, "foo.md", label + " --output-file");
    assertEqual(flags.untrackedCheck, false, label + " --no-untracked-check");
    assertEqual(flags.quiet, true, label + " --quiet");
}

// CA3 — _runForTest throws exitCode 2 when vault is not sauce
async function caseCA3AuditExitsWhenNotSauceVault() {
    const label = "CA3 cmd-audit._runForTest throws exitCode 2 when not a sauce vault";
    const cmdAudit = require("../cli/cmd-audit");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-cli-ca3-"));
    try {
        let exitCode = null;
        try { await cmdAudit._runForTest({ vaultPath: dir, untrackedCheck: false }); }
        catch (e) { exitCode = e.exitCode; }
        assertEqual(exitCode, 2, label);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// CA4 — VERBS registry has audit
async function caseCA4AuditInVerbsRegistry() {
    const label = "CA4 sauce-cli.js VERBS includes audit";
    const cliText = fs.readFileSync(path.join(__dirname, "..", "cli", "sauce-cli.js"), "utf8");
    assertTrue(/audit\s*:\s*['"]\.\/cmd-audit\.js['"]/.test(cliText), label);
}

// CA5 — cmd-help.js mentions audit
async function caseCA5HelpMentionsAudit() {
    const label = "CA5 cmd-help output lists audit verb";
    const cmd = require("../cli/cmd-help.js");
    const out = await cmd.run(null, []);
    const joined = (out && Array.isArray(out.lines)) ? out.lines.join("\n") : "";
    assertTrue(/\baudit\b/.test(joined), label);
}

const cases = [
    caseC1AncestorWalk, caseC2SauceVaultEnv, caseC3NotInVault, caseC4UnknownVerb,
    caseC5StatusClean, caseC6StatusDrift, caseC7UpdateFFOnly, caseC8UpdateDirtyRefusal,
    caseC9UpdateForceOverride, caseC10WizardDelegates,
    caseC11BootstrapNonInteractive, caseC12BootstrapMechanismsAll,
    caseC13BootstrapBlueprintsCsv, caseC14WizardNonInteractiveDefaults,
    caseC15WizardEditSubscriptionFlatWrite,  // v0.26.0
    caseC16HelpVerbOutput, caseC17BareSauceRoutesToHelp,
    caseC18LongAndShortHelpFlags, caseC19HelpWorksOutsideVault,  // v0.26.1 P1-3a
    caseC20StatusWarnsConvenienceMissing, caseC21StatusSilentWhenConvenienceSubscribed,
    caseC22StatusSilentWhenNoDvBlueprint,  // v0.26.1 P1-3c
    caseC23MigrateParseFlagsFromSpace, caseC24MigrateParseFlagsFromEquals,
    caseC25MigrateExitsOnMissingFrom, caseC26MigrateExitsOnNonexistentFrom,
    caseC27MigrateInVerbsRegistry, caseC28HelpMentionsMigrate,  // v0.28.0
    caseCA1AuditParseVaultFlag, caseCA2AuditParseMultiFlag,
    caseCA3AuditExitsWhenNotSauceVault, caseCA4AuditInVerbsRegistry,
    caseCA5HelpMentionsAudit  // v0.29.0
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
