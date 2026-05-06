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
function withMockedHttps(routes, fn) {
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
        const res = {
            statusCode: status,
            on: (ev, h) => {
                if (ev === "data") setTimeout(() => { if (body) h(Buffer.from(body)); }, 0);
                if (ev === "end") setTimeout(h, 1);
                if (ev === "error") {} // not invoked under mock
            },
            headers: {},
            resume: () => {}
        };
        setTimeout(() => cb(res), 0);
        return { on: () => {}, destroy: () => {} };
    };
    https.get._callCount = () => callCount;
    https.get._callLog = () => callLog.slice();
    try { return fn({ getCallCount: () => callCount, getCallLog: () => callLog.slice() }); }
    finally { https.get = original; }
}

// ============================================================
// Temp vault helper
// ============================================================
function withTempVault(setup, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beacon-bs-"));
    fs.mkdirSync(path.join(dir, ".obsidian"), { recursive: true });
    fs.mkdirSync(path.join(dir, "Docs", "Meta"), { recursive: true });
    if (setup) setup(dir);
    try { return fn(dir); }
    finally {
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

function seedConfig(vaultPath, overrides) {
    const cfg = Object.assign({
        workshop_relative_path: "../beacon",
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
    fs.writeFileSync(path.join(vaultPath, "Docs/Meta/platform-config.json"), JSON.stringify(cfg, null, 2));
    fs.writeFileSync(path.join(vaultPath, "Docs/Meta/platform-subscription.json"), JSON.stringify(sub, null, 2));
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
        assertTrue(fs.existsSync(path.join(d, ".obsidian/plugins/obsidian-style-settings/main.js.beacon-backup")), "BS3: .beacon-backup written for overwritten file");
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
        assertTrue(fs.existsSync(path.join(d, ".obsidian/community-plugins.json.beacon-backup")), "BS7: .beacon-backup written");
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
        const cfg = readJson(path.join(d, "Docs/Meta/platform-config.json"));
        const sub = readJson(path.join(d, "Docs/Meta/platform-subscription.json"));
        assertTrue(typeof cfg.workshop_relative_path === "string", "BS8: config workshop_relative_path is string");
        assertTrue(Array.isArray(sub.mechanisms), "BS8: subscription mechanisms is array");
        assertTrue(sub.mechanisms.length >= 1, "BS8: subscription has at least one mechanism");
        assertTrue(typeof sub.workshop_version === "string", "BS8: subscription has workshop_version");
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
        caseBS8WizardGeneratesValidFiles
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
