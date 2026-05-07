#!/usr/bin/env node
/**
 * Bootstrap harness — TDD-first (v0.21.0 S2 T2.5)
 *
 * 8 cases under selector `bootstrap`. Mocks https.get + filesystem
 * via temporary directories. References bootstrap-lib modules that
 * are NOT YET WRITTEN — so this harness FAILS on first run with
 * "Cannot find module" errors. Implementations in S3 (T3.1-T3.5)
 * make each case pass.
 *
 * Run: node platform/test/run-bootstrap.js [selector]
 *
 * Selectors: bootstrap (default; whole suite if omitted)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

let _passed = 0;
let _failed = 0;
const _failures = [];

function assertTrue(cond, label) {
    if (cond) { _passed++; return; }
    _failed++;
    _failures.push(label);
    console.log("    FAIL: " + label);
}

function assertEqual(actual, expected, label) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    assertTrue(ok, label + (ok ? "" : `\n      actual:   ${JSON.stringify(actual)}\n      expected: ${JSON.stringify(expected)}`));
}

// ============================================================
// HTTPS mock — intercepts https.get for the duration of fn()
// ============================================================
async function withMockedHttps(routes, fn) {
    const original = https.get;
    let callCount = 0;
    const callLog = [];
    https.get = (url, opts, cb) => {
        if (typeof opts === "function") { cb = opts; opts = {}; }
        const u = typeof url === "string" ? url : (url.href || url.toString());
        callCount++;
        callLog.push(u);
        const route = routes[u];
        const status = route ? (route.status || 200) : 404;
        const body = route ? (route.body || "") : "";
        const respHeaders = (route && route.headers) || {};
        const res = {
            statusCode: status,
            on: (ev, h) => {
                if (ev === "data") setTimeout(() => { if (body) h(Buffer.from(body)); }, 0);
                if (ev === "end") setTimeout(h, 1);
                if (ev === "error") {} // not invoked under mock
            },
            headers: respHeaders,
            resume: () => {}
        };
        setTimeout(() => cb(res), 0);
        return { on: () => {}, destroy: () => {} };
    };
    https.get._callCount = () => callCount;
    https.get._callLog = () => callLog.slice();
    try {
        // CRITICAL: await fn so the mock stays installed for the duration of all
        // async https.get calls inside fn. Without await, the mock is restored
        // before the callbacks fire — a silent test-isolation bug.
        return await fn({ getCallCount: () => callCount, getCallLog: () => callLog.slice() });
    } finally { https.get = original; }
}

// ============================================================
// Temp vault helper
// ============================================================
async function withTempVault(setup, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beacon-bs-"));
    fs.mkdirSync(path.join(dir, ".obsidian"), { recursive: true });
    fs.mkdirSync(path.join(dir, "ranch"), { recursive: true });
    if (typeof setup === "function") setup(dir);
    try {
        // CRITICAL: await fn so cleanup runs AFTER async work completes.
        // Without await, fs.rmSync fires before runBootstrap's async writes —
        // BS1 passed by luck (mkdir-recursive recreates) but BS2/BS3/BS7 fail
        // because their pre-populated state gets wiped mid-test.
        return await fn(dir);
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
}

// ============================================================
// Canonical mocked routes
// ============================================================
const MOCK_INDEX_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json";

const MOCK_INDEX_BODY = JSON.stringify([
    { id: "templater-obsidian", name: "Templater", repo: "SilentVoid13/Templater" },
    { id: "customjs", name: "CustomJS", repo: "saml-dev/obsidian-custom-js" },
    { id: "dataview", name: "Dataview", repo: "blacksmithgu/obsidian-dataview" },
    { id: "obsidian-style-settings", name: "Style Settings", repo: "mgmeyers/obsidian-style-settings" },
    { id: "slash-commander", name: "Slash Commander", repo: "esm7/obsidian-slash-commander" },
    { id: "obsidian-kanban", name: "Kanban", repo: "mgmeyers/obsidian-kanban" }
]);

function pluginRoutes(id, repo, opts) {
    const base = `https://github.com/${repo}/releases/latest/download`;
    const out = {};
    out[`${base}/manifest.json`] = (opts && opts.skipManifest)
        ? { status: 404, body: "" }
        : { body: JSON.stringify({ id, version: "1.0.0", name: id }) };
    out[`${base}/main.js`] = (opts && opts.skipMain)
        ? { status: 404, body: "" }
        : { body: `// ${id} mock main.js\n` };
    out[`${base}/styles.css`] = (opts && opts.skipStyles)
        ? { status: 404, body: "" }
        : { body: `/* ${id} mock styles.css */\n` };
    return out;
}

// Absolute path to the real workshop — used by seedConfig so bootstrap.js
// can read platform/manifest.json + walk subscribed mechanism manifests
// during harness runs from a temp vault.
const WORKSHOP_ROOT = path.resolve(__dirname, "../..");

function seedConfig(vaultPath, overrides) {
    const cfg = Object.assign({
        workshop_relative_path: WORKSHOP_ROOT,
        variables: {}
    }, (overrides && overrides.config) || {});
    const sub = Object.assign({
        workshop_version: "0.21.0",
        mechanisms: [
            { name: "customjs-guard", version: "1.0.0" },
            { name: "styling", version: "0.1.1" }
        ],
        blueprints: []
    }, (overrides && overrides.subscription) || {});
    fs.writeFileSync(path.join(vaultPath, "ranch/platform-config.json"), JSON.stringify(cfg, null, 2));
    fs.writeFileSync(path.join(vaultPath, "ranch/platform-subscription.json"), JSON.stringify(sub, null, 2));
}

function readJson(p) {
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

// ============================================================
// Cases
// ============================================================

async function caseBS1FreshVaultFirstRun() {
    console.log("  BS1 fresh-vault first run");
    const { runBootstrap } = require("../bootstrap.js"); // not yet written → fails import
    await withTempVault(d => seedConfig(d), async (d) => {
        const routes = Object.assign({},
            { [MOCK_INDEX_URL]: { body: MOCK_INDEX_BODY } },
            pluginRoutes("templater-obsidian", "SilentVoid13/Templater"),
            pluginRoutes("customjs", "saml-dev/obsidian-custom-js"),
            pluginRoutes("dataview", "blacksmithgu/obsidian-dataview"),
            pluginRoutes("obsidian-style-settings", "mgmeyers/obsidian-style-settings")
        );
        await withMockedHttps(routes, async () => {
            await runBootstrap({ vaultPath: d, nonInteractive: true, skipInstaller: true });
        });
        assertTrue(fs.existsSync(path.join(d, ".obsidian/plugins/templater-obsidian/manifest.json")), "BS1: templater manifest written");
        assertTrue(fs.existsSync(path.join(d, ".obsidian/plugins/templater-obsidian/main.js")), "BS1: templater main.js written");
        assertTrue(fs.existsSync(path.join(d, ".obsidian/plugins/customjs/main.js")), "BS1: customjs main.js written");
        assertTrue(fs.existsSync(path.join(d, ".obsidian/plugins/dataview/manifest.json")), "BS1: dataview manifest written");
        assertTrue(fs.existsSync(path.join(d, ".obsidian/plugins/obsidian-style-settings/styles.css")), "BS1: style-settings styles.css written");
        const cp = readJson(path.join(d, ".obsidian/community-plugins.json"));
        assertTrue(cp.includes("templater-obsidian"), "BS1: community-plugins.json contains templater");
        assertTrue(cp.includes("customjs"), "BS1: community-plugins.json contains customjs");
        assertTrue(cp.includes("dataview"), "BS1: community-plugins.json contains dataview");
        assertTrue(cp.includes("obsidian-style-settings"), "BS1: community-plugins.json contains style-settings");
    });
}

async function caseBS2IdempotentReRun() {
    console.log("  BS2 idempotent re-run");
    const { runBootstrap } = require("../bootstrap.js");
    await withTempVault(d => seedConfig(d), async (d) => {
        // Pre-populate plugin dirs to simulate prior install
        const ids = ["templater-obsidian", "customjs", "dataview", "obsidian-style-settings"];
        for (const id of ids) {
            const dir = path.join(d, ".obsidian/plugins", id);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id, version: "1.0.0", name: id }));
            fs.writeFileSync(path.join(dir, "main.js"), `// ${id} pre-existing\n`);
        }
        fs.writeFileSync(path.join(d, ".obsidian/community-plugins.json"), JSON.stringify(ids, null, 2));

        const routes = Object.assign({},
            { [MOCK_INDEX_URL]: { body: MOCK_INDEX_BODY } },
            pluginRoutes("templater-obsidian", "SilentVoid13/Templater"),
            pluginRoutes("customjs", "saml-dev/obsidian-custom-js"),
            pluginRoutes("dataview", "blacksmithgu/obsidian-dataview"),
            pluginRoutes("obsidian-style-settings", "mgmeyers/obsidian-style-settings")
        );
        let pluginAssetCalls = 0;
        await withMockedHttps(routes, async (ctx) => {
            await runBootstrap({ vaultPath: d, nonInteractive: true, skipInstaller: true });
            const calls = ctx.getCallLog();
            pluginAssetCalls = calls.filter(u => u.includes("/releases/latest/download/")).length;
        });
        // Pre-existing main.js content should be unchanged (idempotent skip-if-present)
        const preExistingMain = fs.readFileSync(path.join(d, ".obsidian/plugins/customjs/main.js"), "utf8");
        assertEqual(preExistingMain, "// customjs pre-existing\n", "BS2: existing main.js unchanged");
        assertEqual(pluginAssetCalls, 0, "BS2: zero plugin asset HTTPS calls (skip-if-present)");
    });
}

async function caseBS3ForceRedownloadSinglePlugin() {
    console.log("  BS3 force-redownload single plugin");
    const { runBootstrap } = require("../bootstrap.js");
    await withTempVault(d => seedConfig(d), async (d) => {
        const ids = ["templater-obsidian", "customjs", "dataview", "obsidian-style-settings"];
        for (const id of ids) {
            const dir = path.join(d, ".obsidian/plugins", id);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id, version: "1.0.0", name: id }));
            fs.writeFileSync(path.join(dir, "main.js"), `// ${id} pre-existing\n`);
        }
        fs.writeFileSync(path.join(d, ".obsidian/community-plugins.json"), JSON.stringify(ids, null, 2));

        const routes = Object.assign({},
            { [MOCK_INDEX_URL]: { body: MOCK_INDEX_BODY } },
            pluginRoutes("templater-obsidian", "SilentVoid13/Templater"),
            pluginRoutes("customjs", "saml-dev/obsidian-custom-js"),
            pluginRoutes("dataview", "blacksmithgu/obsidian-dataview"),
            pluginRoutes("obsidian-style-settings", "mgmeyers/obsidian-style-settings")
        );
        await withMockedHttps(routes, async () => {
            await runBootstrap({
                vaultPath: d,
                nonInteractive: true,
                skipInstaller: true,
                forceReinstall: ["obsidian-style-settings"]
            });
        });
        // style-settings overwritten with mock content
        const styMain = fs.readFileSync(path.join(d, ".obsidian/plugins/obsidian-style-settings/main.js"), "utf8");
        assertTrue(styMain.includes("mock"), "BS3: style-settings overwritten with mock content");
        // Backup of prior file written
        assertTrue(fs.existsSync(path.join(d, ".obsidian/plugins/obsidian-style-settings/main.js.sauce-backup")), "BS3: .sauce-backup written for overwritten file");
        // Other plugins NOT overwritten
        const cusMain = fs.readFileSync(path.join(d, ".obsidian/plugins/customjs/main.js"), "utf8");
        assertEqual(cusMain, "// customjs pre-existing\n", "BS3: other plugins unchanged");
    });
}

async function caseBS4StylesCss404Tolerated() {
    console.log("  BS4 styles.css 404 tolerated");
    const { runBootstrap } = require("../bootstrap.js");
    await withTempVault(d => seedConfig(d), async (d) => {
        const routes = Object.assign({},
            { [MOCK_INDEX_URL]: { body: MOCK_INDEX_BODY } },
            pluginRoutes("templater-obsidian", "SilentVoid13/Templater"),
            pluginRoutes("customjs", "saml-dev/obsidian-custom-js"),
            pluginRoutes("dataview", "blacksmithgu/obsidian-dataview"),
            // style-settings: skip styles.css (404)
            pluginRoutes("obsidian-style-settings", "mgmeyers/obsidian-style-settings", { skipStyles: true })
        );
        await withMockedHttps(routes, async () => {
            await runBootstrap({ vaultPath: d, nonInteractive: true, skipInstaller: true });
        });
        // Plugin still installed
        assertTrue(fs.existsSync(path.join(d, ".obsidian/plugins/obsidian-style-settings/manifest.json")), "BS4: manifest present despite styles.css 404");
        assertTrue(fs.existsSync(path.join(d, ".obsidian/plugins/obsidian-style-settings/main.js")), "BS4: main.js present");
        // styles.css absent (tolerated)
        assertTrue(!fs.existsSync(path.join(d, ".obsidian/plugins/obsidian-style-settings/styles.css")), "BS4: styles.css absent (404 tolerated)");
    });
}

async function caseBS5MainJs404FailsLoud() {
    console.log("  BS5 main.js 404 fails loud per-plugin");
    const { runBootstrap } = require("../bootstrap.js");
    await withTempVault(d => seedConfig(d), async (d) => {
        const routes = Object.assign({},
            { [MOCK_INDEX_URL]: { body: MOCK_INDEX_BODY } },
            pluginRoutes("templater-obsidian", "SilentVoid13/Templater"),
            pluginRoutes("customjs", "saml-dev/obsidian-custom-js"),
            pluginRoutes("dataview", "blacksmithgu/obsidian-dataview"),
            // style-settings: missing main.js (fail-loud)
            pluginRoutes("obsidian-style-settings", "mgmeyers/obsidian-style-settings", { skipMain: true })
        );
        let report;
        await withMockedHttps(routes, async () => {
            report = await runBootstrap({ vaultPath: d, nonInteractive: true, skipInstaller: true });
        });
        // The failed plugin reported
        assertTrue(report && Array.isArray(report.failed), "BS5: report.failed exists");
        const failedIds = (report.failed || []).map(x => x.id);
        assertTrue(failedIds.includes("obsidian-style-settings"), "BS5: style-settings reported as failed");
        // Other plugins still succeeded
        assertTrue(fs.existsSync(path.join(d, ".obsidian/plugins/customjs/manifest.json")), "BS5: customjs still installed");
        assertTrue(fs.existsSync(path.join(d, ".obsidian/plugins/dataview/manifest.json")), "BS5: dataview still installed");
    });
}

async function caseBS6UnknownPluginId() {
    console.log("  BS6 unknown plugin id (not in upstream index)");
    const { runBootstrap } = require("../bootstrap.js");
    await withTempVault((d) => {
        seedConfig(d, {
            subscription: {
                workshop_version: "0.21.0",
                mechanisms: [
                    { name: "customjs-guard", version: "1.0.0" },
                    { name: "styling", version: "0.1.1" },
                    { name: "fictional-mechanism", version: "0.0.1" } // unknown
                ],
                blueprints: []
            }
        });
        // Pre-write a fake workshop manifest with declared external_plugin for the fictional id
        // Bootstrap should detect the id is not in the upstream index and report fail.
    }, async (d) => {
        const routes = Object.assign({},
            { [MOCK_INDEX_URL]: { body: MOCK_INDEX_BODY } },
            pluginRoutes("templater-obsidian", "SilentVoid13/Templater"),
            pluginRoutes("customjs", "saml-dev/obsidian-custom-js"),
            pluginRoutes("dataview", "blacksmithgu/obsidian-dataview"),
            pluginRoutes("obsidian-style-settings", "mgmeyers/obsidian-style-settings")
        );
        let report;
        await withMockedHttps(routes, async () => {
            report = await runBootstrap({
                vaultPath: d,
                nonInteractive: true,
                skipInstaller: true,
                injectExtraPluginIds: ["totally-fictional-plugin"]  // direct injection for test
            });
        });
        const failedIds = ((report && report.failed) || []).map(x => x.id);
        assertTrue(failedIds.includes("totally-fictional-plugin"), "BS6: unknown id reported as failed");
        assertTrue(fs.existsSync(path.join(d, ".obsidian/plugins/customjs/manifest.json")), "BS6: known plugins still installed");
    });
}

async function caseBS7CommunityPluginsAdditiveMerge() {
    console.log("  BS7 community-plugins.json additive merge");
    const { runBootstrap } = require("../bootstrap.js");
    await withTempVault(d => {
        seedConfig(d);
        // Pre-existing community-plugins.json with unrelated entries
        fs.writeFileSync(path.join(d, ".obsidian/community-plugins.json"), JSON.stringify(["foo-plugin", "bar-plugin"], null, 2));
    }, async (d) => {
        const routes = Object.assign({},
            { [MOCK_INDEX_URL]: { body: MOCK_INDEX_BODY } },
            pluginRoutes("templater-obsidian", "SilentVoid13/Templater"),
            pluginRoutes("customjs", "saml-dev/obsidian-custom-js"),
            pluginRoutes("dataview", "blacksmithgu/obsidian-dataview"),
            pluginRoutes("obsidian-style-settings", "mgmeyers/obsidian-style-settings")
        );
        await withMockedHttps(routes, async () => {
            await runBootstrap({ vaultPath: d, nonInteractive: true, skipInstaller: true });
        });
        const cp = readJson(path.join(d, ".obsidian/community-plugins.json"));
        // Pre-existing entries preserved
        assertTrue(cp.includes("foo-plugin"), "BS7: pre-existing foo-plugin preserved");
        assertTrue(cp.includes("bar-plugin"), "BS7: pre-existing bar-plugin preserved");
        // New entries added
        assertTrue(cp.includes("templater-obsidian"), "BS7: templater added");
        assertTrue(cp.includes("obsidian-style-settings"), "BS7: style-settings added");
        // Sorted alphabetically + deduped
        const sorted = [...cp].sort();
        assertEqual(cp, sorted, "BS7: community-plugins.json sorted alphabetically");
        const deduped = [...new Set(cp)];
        assertEqual(cp.length, deduped.length, "BS7: no duplicates");
        // Backup of prior file written
        assertTrue(fs.existsSync(path.join(d, ".obsidian/community-plugins.json.sauce-backup")), "BS7: .sauce-backup written");
    });
}

async function caseBS8WizardGeneratesValidFiles() {
    console.log("  BS8 wizard generates valid config + subscription");
    const { runBootstrap } = require("../bootstrap.js");
    await withTempVault((d) => {
        // No seedConfig — first-run wizard should generate them.
    }, async (d) => {
        const routes = Object.assign({},
            { [MOCK_INDEX_URL]: { body: MOCK_INDEX_BODY } },
            pluginRoutes("templater-obsidian", "SilentVoid13/Templater"),
            pluginRoutes("customjs", "saml-dev/obsidian-custom-js"),
            pluginRoutes("dataview", "blacksmithgu/obsidian-dataview")
        );
        await withMockedHttps(routes, async () => {
            await runBootstrap({
                vaultPath: d,
                nonInteractive: true,
                skipInstaller: true,
                wizardDefaults: {
                    workshopRelativePath: path.resolve(__dirname, "../.."),  // points back to workshop
                    mechanisms: ["customjs-guard"],
                    blueprints: []
                }
            });
        });
        const cfg = readJson(path.join(d, "ranch/platform-config.json"));
        const sub = readJson(path.join(d, "ranch/platform-subscription.json"));
        assertTrue(typeof cfg.workshop_relative_path === "string", "BS8: config workshop_relative_path is string");
        assertTrue(Array.isArray(sub.mechanisms), "BS8: subscription mechanisms is array");
        assertTrue(sub.mechanisms.length >= 1, "BS8: subscription has at least one mechanism");
        assertTrue(typeof sub.workshop_version === "string", "BS8: subscription has workshop_version");
    });
}

async function caseBS9FollowsRedirects() {
    console.log("  BS9 follows GitHub release-asset 302 redirects");
    const { runBootstrap } = require("../bootstrap.js");
    await withTempVault(d => seedConfig(d), async (d) => {
        // Three-asset routes for templater-obsidian return 302 → real CDN URL.
        // The CDN URL returns 200 with the actual body. Bootstrap must follow.
        const routes = {
            [MOCK_INDEX_URL]: { body: MOCK_INDEX_BODY }
        };
        // Set up redirect chains for the styling-related plugin (one is enough).
        const redirectBase = "https://github.com/mgmeyers/obsidian-style-settings/releases/latest/download";
        const cdnBase = "https://cdn.example.com/obsidian-style-settings";
        routes[`${redirectBase}/manifest.json`] = { status: 302, body: "", headers: { location: `${cdnBase}/manifest.json` } };
        routes[`${redirectBase}/main.js`]       = { status: 302, body: "", headers: { location: `${cdnBase}/main.js` } };
        routes[`${redirectBase}/styles.css`]    = { status: 302, body: "", headers: { location: `${cdnBase}/styles.css` } };
        routes[`${cdnBase}/manifest.json`]      = { body: JSON.stringify({ id: "obsidian-style-settings", version: "1.0.0" }) };
        routes[`${cdnBase}/main.js`]            = { body: "// real content" };
        routes[`${cdnBase}/styles.css`]         = { body: "/* real styles */" };
        // Other plugins: just direct 200 (foundational templater/customjs/dataview)
        Object.assign(routes,
            pluginRoutes("templater-obsidian", "SilentVoid13/Templater"),
            pluginRoutes("customjs", "saml-dev/obsidian-custom-js"),
            pluginRoutes("dataview", "blacksmithgu/obsidian-dataview")
        );

        // Need to extend the mock to support `headers.location`. Pass status + headers in route.
        await withMockedHttps(routes, async () => {
            await runBootstrap({ vaultPath: d, nonInteractive: true, skipInstaller: true });
        });
        const styPath = path.join(d, ".obsidian/plugins/obsidian-style-settings");
        assertTrue(fs.existsSync(path.join(styPath, "manifest.json")), "BS9: redirected manifest.json written");
        const main = fs.readFileSync(path.join(styPath, "main.js"), "utf8");
        assertEqual(main, "// real content", "BS9: redirected main.js content matches CDN target");
    });
}

// BS10: phaseWriteActivation generates Scripts/activate.sh + Scripts/beacon
//       with absolute paths baked in + chmod 0755.
async function caseBS10ActivationArtifacts() {
    const label = "BS10 phaseWriteActivation generates pantry/Scripts artifacts";
    await withTempVault({}, async (vaultPath) => {
        const bootstrap = require("../bootstrap.js");
        const fs = require("fs");
        const path = require("path");
        // Pre-create <vault>/pantry/ to mimic post-clone state
        const workshopAbs = path.join(vaultPath, "pantry");
        fs.mkdirSync(path.join(workshopAbs, "platform/cli"), { recursive: true });
        fs.writeFileSync(path.join(workshopAbs, "platform/cli/sauce-cli.js"), "// stub");
        await bootstrap.phaseWriteActivation({ vaultPath, workshopAbsPath: workshopAbs });
        const actPath = path.join(workshopAbs, "Scripts/activate.sh");
        const binPath = path.join(workshopAbs, "Scripts/sauce");
        assertTrue(fs.existsSync(actPath), label + ": activate.sh exists");
        assertTrue(fs.existsSync(binPath), label + ": Scripts/sauce exists");
        const actBody = fs.readFileSync(actPath, "utf8");
        assertTrue(actBody.includes(workshopAbs + "/Scripts"), label + ": activate.sh has absolute Scripts path");
        assertTrue(actBody.includes('SAUCE_VAULT="' + vaultPath + '"'), label + ": activate.sh exports SAUCE_VAULT");
        const binStat = fs.statSync(binPath);
        assertEqual(binStat.mode & 0o777, 0o755, label + ": Scripts/sauce is chmod 0755");
    });
}

// BS11: first-run wizard defaults workshop_relative_path to "pantry" (was "Beacon")
async function caseBS11WizardDefaultsPantry() {
    const label = "BS11 first-run wizard defaults workshop_relative_path to pantry";
    // Use nonInteractive + wizardDefaults injection per existing BS8 pattern.
    await withTempVault({}, async (vaultPath) => {
        const wizard = require("../bootstrap-lib/wizard.js");
        const r = await wizard.runFirstRunWizard({
            vaultPath,
            workshopManifest: null,
            nonInteractive: true,
            defaults: { /* no override; expect pantry */ }
        });
        assertEqual(r.config.workshop_relative_path, "pantry", label);
    });
}

// BS12: legacy sibling-of-workshop layout still works when explicitly configured
async function caseBS12SiblingFallback() {
    const label = "BS12 sibling-of-workshop layout still works for legacy POC vaults";
    // Seed config explicitly with workshop_relative_path: "../beacon-fixture"
    // and assert runBootstrap does not error on the layout.
    // Mirrors caseBS2IdempotentReRun shape.
    await withTempVault({}, async (vaultPath) => {
        // Setup: create sibling workshop fixture with minimal manifest
        const path = require("path");
        const fs = require("fs");
        const sibling = fs.mkdtempSync(path.join(os.tmpdir(), "beacon-fixture-"));
        fs.mkdirSync(path.join(sibling, "platform"), { recursive: true });
        fs.writeFileSync(path.join(sibling, "platform/manifest.json"),
            JSON.stringify({ workshop_version: "0.22.0", foundational_plugins: [], mechanisms: [], blueprints: [] }, null, 2));
        try {
            seedConfig(vaultPath, { workshop_relative_path: path.relative(vaultPath, sibling) });
            const bootstrap = require("../bootstrap.js");
            await withMockedHttps({}, async () => {
                const r = await bootstrap.runBootstrap({ vaultPath, nonInteractive: true, skipInstaller: true });
                assertTrue(Array.isArray(r.fetched), label + ": returns shape");
            });
        } finally {
            fs.rmSync(sibling, { recursive: true, force: true });
        }
    });
}

// BS14: v0.26.1 P1-1 — phaseFetchPlugins fetches the 4 new community plugins
// (obsidian-admonition / calendar / obsidian-tasks-plugin / url-into-selection)
// when foundational_plugins[] declares them. Pre-S2 the canonical workshop
// manifest does NOT include these ids, so this case uses a synthetic
// workshop fixture to drive runBootstrap. Post-S2 the canonical manifest
// gains these ids; this synthetic-fixture posture keeps the case isolated
// from upstream churn.
async function caseBS14FetchesFourNewFoundationalPlugins() {
    const label = "BS14 phaseFetchPlugins fetches 4 new community plugins";
    // The community-plugins-index module caches across calls (module-level
    // _cache). BS1-BS9 ran first with MOCK_INDEX_BODY (no new ids) and
    // populated the cache. Clear it so BS14 sees the BS14-specific routes.
    const indexMod = require("../bootstrap-lib/community-plugins-index.js");
    if (typeof indexMod._clearCache === "function") indexMod._clearCache();
    await withTempVault({}, async (vaultPath) => {
        // Synthesize a fixture workshop containing the 4 new ids in foundational_plugins[].
        const sibling = fs.mkdtempSync(path.join(os.tmpdir(), "beacon-bs14-fixture-"));
        try {
            fs.mkdirSync(path.join(sibling, "platform"), { recursive: true });
            fs.writeFileSync(path.join(sibling, "platform/manifest.json"),
                JSON.stringify({
                    workshop_version: "0.26.1",
                    foundational_plugins: [
                        { id: "templater-obsidian" },
                        { id: "customjs" },
                        { id: "dataview" },
                        { id: "obsidian-admonition" },
                        { id: "calendar" },
                        { id: "obsidian-tasks-plugin" },
                        { id: "url-into-selection" }
                    ],
                    mechanisms: [],
                    blueprints: []
                }, null, 2));
            seedConfig(vaultPath, {
                config: { workshop_relative_path: path.relative(vaultPath, sibling) },
                subscription: { workshop_version: "0.26.1", mechanisms: [], blueprints: [] }
            });
            const indexBody = JSON.stringify([
                { id: "templater-obsidian", name: "Templater", repo: "SilentVoid13/Templater" },
                { id: "customjs", name: "CustomJS", repo: "saml-dev/obsidian-custom-js" },
                { id: "dataview", name: "Dataview", repo: "blacksmithgu/obsidian-dataview" },
                { id: "obsidian-admonition", name: "Admonition", repo: "javalent/admonition" },
                { id: "calendar", name: "Calendar", repo: "liamcain/obsidian-calendar-plugin" },
                { id: "obsidian-tasks-plugin", name: "Tasks", repo: "obsidian-tasks-group/obsidian-tasks" },
                { id: "url-into-selection", name: "Paste URL Into Selection", repo: "denolehov/obsidian-url-into-selection" }
            ]);
            const routes = Object.assign({},
                { [MOCK_INDEX_URL]: { body: indexBody } },
                pluginRoutes("templater-obsidian", "SilentVoid13/Templater"),
                pluginRoutes("customjs", "saml-dev/obsidian-custom-js"),
                pluginRoutes("dataview", "blacksmithgu/obsidian-dataview"),
                pluginRoutes("obsidian-admonition", "javalent/admonition", { skipStyles: true }),
                pluginRoutes("calendar", "liamcain/obsidian-calendar-plugin", { skipStyles: true }),
                pluginRoutes("obsidian-tasks-plugin", "obsidian-tasks-group/obsidian-tasks", { skipStyles: true }),
                pluginRoutes("url-into-selection", "denolehov/obsidian-url-into-selection", { skipStyles: true })
            );
            const bootstrap = require("../bootstrap.js");
            await withMockedHttps(routes, async () => {
                await bootstrap.runBootstrap({ vaultPath, nonInteractive: true, skipInstaller: true });
            });
            const newIds = ["obsidian-admonition", "calendar", "obsidian-tasks-plugin", "url-into-selection"];
            for (const id of newIds) {
                const dir = path.join(vaultPath, ".obsidian/plugins", id);
                assertTrue(fs.existsSync(path.join(dir, "manifest.json")), label + ": " + id + "/manifest.json present");
                assertTrue(fs.existsSync(path.join(dir, "main.js")), label + ": " + id + "/main.js present");
            }
        } finally {
            fs.rmSync(sibling, { recursive: true, force: true });
        }
    });
}

// BS15-BS17: v0.26.1 P1-3c — wizard _autoAddConvenienceIfDvBlueprintsSelected.
// The helper does NOT exist yet at S1. Pre-S2, cases FAIL with TypeError
// ("not a function") when accessing wizardMod._autoAddConvenienceIfDvBlueprintsSelected.
// Post-S2, the helper is exported and pure (no I/O); these cases test it
// directly with synthetic fixtures.

function _bs15FixtureFullBlueprints() {
    return [
        { name: "project", version: "1.3.6", depends_on: [{ name: "convenience", range: ">=0.1.0" }] },
        { name: "boards", version: "0.1.0", depends_on: [] }
    ];
}

async function caseBS15AutoAddsConvenienceForDvBlueprint() {
    const label = "BS15 _autoAddConvenienceIfDvBlueprintsSelected adds convenience for project";
    const wizardMod = require("../bootstrap-lib/wizard.js");
    // I-2 fix: suppress the auto-add helper's `[info] Auto-added convenience...`
    // console.log during harness runs (the helper gates console.log on
    // !SAUCE_TEST_MODE). Restore prior value in finally so other cases see
    // their normal env.
    const priorTestMode = process.env.SAUCE_TEST_MODE;
    process.env.SAUCE_TEST_MODE = "1";
    try {
        const result = wizardMod._autoAddConvenienceIfDvBlueprintsSelected(
            ["customjs-guard"],
            ["project"],
            _bs15FixtureFullBlueprints()
        );
        assertTrue(Array.isArray(result), label + ": returns array");
        assertTrue(result.includes("convenience"), label + ": convenience appended");
    } finally {
        if (priorTestMode === undefined) delete process.env.SAUCE_TEST_MODE;
        else process.env.SAUCE_TEST_MODE = priorTestMode;
    }
}

async function caseBS16NoAddForNonDvBlueprint() {
    const label = "BS16 _autoAddConvenienceIfDvBlueprintsSelected leaves selection unchanged for boards-only";
    const wizardMod = require("../bootstrap-lib/wizard.js");
    const result = wizardMod._autoAddConvenienceIfDvBlueprintsSelected(
        ["customjs-guard"],
        ["boards"],
        _bs15FixtureFullBlueprints()
    );
    assertTrue(Array.isArray(result), label + ": returns array");
    assertTrue(!result.includes("convenience"), label + ": convenience NOT added (boards has no convenience dep)");
}

async function caseBS17NoDuplicateWhenAlreadyPresent() {
    const label = "BS17 _autoAddConvenienceIfDvBlueprintsSelected no duplicate when already selected";
    const wizardMod = require("../bootstrap-lib/wizard.js");
    const result = wizardMod._autoAddConvenienceIfDvBlueprintsSelected(
        ["convenience"],
        ["project"],
        _bs15FixtureFullBlueprints()
    );
    const occurrences = result.filter(x => x === "convenience").length;
    assertTrue(occurrences === 1, label + ": convenience appears exactly once (" + occurrences + ")");
}

// BS13: phaseWriteActivation atomic write + backup-on-overwrite
async function caseBS13ActivationAtomicAndBackup() {
    const label = "BS13 phaseWriteActivation atomic write + backup-on-overwrite";
    await withTempVault({}, async (vaultPath) => {
        const bootstrap = require("../bootstrap.js");
        const fs = require("fs");
        const path = require("path");
        const workshopAbs = path.join(vaultPath, "pantry");
        fs.mkdirSync(path.join(workshopAbs, "Scripts"), { recursive: true });
        // Pre-existing activate.sh — should be backed up as .sauce-backup
        fs.writeFileSync(path.join(workshopAbs, "Scripts/activate.sh"), "PRIOR\n");
        await bootstrap.phaseWriteActivation({ vaultPath, workshopAbsPath: workshopAbs });
        const backup = path.join(workshopAbs, "Scripts/activate.sh.sauce-backup");
        assertTrue(fs.existsSync(backup), label + ": prior activate.sh backed up");
        const backupBody = fs.readFileSync(backup, "utf8");
        assertEqual(backupBody, "PRIOR\n", label + ": backup preserves prior content");
    });
}

// ============================================================
// Runner
// ============================================================

const cases = {
    "bootstrap": [
        caseBS1FreshVaultFirstRun,
        caseBS2IdempotentReRun,
        caseBS3ForceRedownloadSinglePlugin,
        caseBS4StylesCss404Tolerated,
        caseBS5MainJs404FailsLoud,
        caseBS6UnknownPluginId,
        caseBS7CommunityPluginsAdditiveMerge,
        caseBS8WizardGeneratesValidFiles,
        caseBS9FollowsRedirects,
        caseBS10ActivationArtifacts,
        caseBS11WizardDefaultsPantry,
        caseBS12SiblingFallback,
        caseBS13ActivationAtomicAndBackup,
        // v0.26.1 P1-1: 4 new foundational plugins
        caseBS14FetchesFourNewFoundationalPlugins,
        // v0.26.1 P1-3c: wizard auto-add convenience helper
        caseBS15AutoAddsConvenienceForDvBlueprint,
        caseBS16NoAddForNonDvBlueprint,
        caseBS17NoDuplicateWhenAlreadyPresent
    ]
};

async function main() {
    const selector = process.argv[2] || null;
    const buckets = selector ? { [selector]: cases[selector] } : cases;
    for (const [sel, list] of Object.entries(buckets)) {
        if (!list) {
            console.log(`Unknown selector: ${sel}`);
            continue;
        }
        console.log(`Selector: ${sel}`);
        for (const c of list) {
            try {
                await c();
            } catch (e) {
                _failed++;
                _failures.push(`${c.name}: ${e.message}`);
                console.log(`    FAIL: ${c.name}: ${e.message}`);
            }
        }
    }
    console.log("========");
    console.log(`Result: ${_passed} passed, ${_failed} failed.`);
    if (_failed > 0) process.exit(1);
}

main();
