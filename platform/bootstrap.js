#!/usr/bin/env node
/**
 * Beacon consumer bootstrap — interactive Node CLI (v0.21.0).
 *
 * Run from a consumer vault directory:
 *   node ../beacon/platform/bootstrap.js
 *
 * First-time setup: cd <workshop> && npm install
 *
 * Flow:
 *   1. Detect node_modules; print hint + exit if missing (skipped in nonInteractive)
 *   2. Read <vault>/Docs/Meta/platform-config.json (or trigger first-run wizard)
 *   3. Resolve workshop path; read workshop manifest
 *   4. If config exists: optional re-run wizard menu (skipped in nonInteractive)
 *   5. Compute plugin set (foundational ∪ external_plugins from subscribed items)
 *   6. Fetch obsidian-releases index (id → repo)
 *   7. For each plugin: fetchPlugin (skip-if-present unless --reinstall)
 *   8. mergeCommunityPlugins
 *   9. runInstall(vaultPath) (skipped when skipInstaller=true)
 *  10. Return / print final report
 *
 * Exports: runBootstrap({ vaultPath, nonInteractive, skipInstaller,
 *                        forceReinstall, injectExtraPluginIds, wizardDefaults })
 *   for harness import.
 */

const fs = require("fs");
const path = require("path");

const indexMod = require("./bootstrap-lib/community-plugins-index.js");
const fetchPluginMod = require("./bootstrap-lib/fetch-plugin.js");
const mergeMod = require("./bootstrap-lib/community-plugins-merge.js");
const wizardMod = require("./bootstrap-lib/wizard.js");

function readJson(p) {
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJsonAtomic(p, obj) {
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n");
    fs.renameSync(tmp, p);
}

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

function detectInquirerOrExit() {
    try {
        require("@inquirer/prompts");
    } catch (e) {
        const workshopHint = path.resolve(__dirname, "..");
        console.error("");
        console.error("ERROR: @inquirer/prompts not installed.");
        console.error("");
        console.error("  Bootstrap requires the workshop's npm dependencies.");
        console.error("  Run this once:");
        console.error("");
        console.error(`    cd ${workshopHint}`);
        console.error("    npm install");
        console.error("");
        process.exit(1);
    }
}

async function runBootstrap(opts) {
    opts = opts || {};
    const vaultPath = path.resolve(opts.vaultPath || process.cwd());
    const nonInteractive = !!opts.nonInteractive;
    const skipInstaller = !!opts.skipInstaller;
    const forceReinstall = opts.forceReinstall || [];
    const injectExtraPluginIds = opts.injectExtraPluginIds || [];
    const wizardDefaults = opts.wizardDefaults || null;
    const action = opts.action || null;

    // Step 1: node_modules detection. Skipped under nonInteractive (harness path).
    if (!nonInteractive) {
        detectInquirerOrExit();
    }

    // Step 2: read or generate consumer config.
    const cfgPath = path.join(vaultPath, "Docs/Meta/platform-config.json");
    const subPath = path.join(vaultPath, "Docs/Meta/platform-subscription.json");
    const cfgExists = fs.existsSync(cfgPath);
    const subExists = fs.existsSync(subPath);

    let config, subscription, workshopPath, workshopManifest;

    if (cfgExists && subExists) {
        // Re-run path
        config = readJson(cfgPath);
        subscription = readJson(subPath);
        workshopPath = path.resolve(vaultPath, config.workshop_relative_path);
        const wmPath = path.join(workshopPath, "platform/manifest.json");
        if (!fs.existsSync(wmPath)) {
            throw new Error(`Workshop manifest not found at ${wmPath} (resolved from config.workshop_relative_path = ${config.workshop_relative_path}).`);
        }
        workshopManifest = readJson(wmPath);

        // Re-run wizard menu (interactive only)
        if (!nonInteractive) {
            const r = await wizardMod.runReRunWizard({
                vaultPath,
                existingConfig: config,
                existingSubscription: subscription,
                workshopManifest,
                nonInteractive: false
            });
            if (r.action === "quit") {
                console.log("Quit.");
                return { fetched: [], skipped: [], failed: [] };
            }
            if (r.action === "edit-sub" && r.payload) {
                subscription = mergeSubscription(subscription, r.payload, workshopManifest);
                writeJsonAtomic(subPath, subscription);
            }
            if (r.action === "edit-cfg" && r.payload && r.payload.config) {
                config = Object.assign({}, config, r.payload.config);
                writeJsonAtomic(cfgPath, config);
                workshopPath = path.resolve(vaultPath, config.workshop_relative_path);
                workshopManifest = readJson(path.join(workshopPath, "platform/manifest.json"));
            }
            if (r.action === "force-redl" && r.payload && Array.isArray(r.payload.ids)) {
                forceReinstall.push(...r.payload.ids);
            }
            // For "install" or any falling-through action, continue to step 5.
        } else if (action) {
            // Non-interactive with explicit action (test path; e.g., BS2 falls through to install)
            // No-op for "install"; other actions handled by direct opts.
        }
    } else {
        // First-run path: defer workshop discovery to the wizard so it can
        // prompt for workshop_relative_path FIRST + validate manifest exists.
        // Without this deferral, the bootstrap fails BEFORE the wizard runs
        // when the consumer vault is not at the canonical sibling-of-workshop
        // depth (CF-3 surfaced in Phase C from /workshop/scratch/1 needing
        // ../../beacon, not the hardcoded default ../beacon).
        const r = await wizardMod.runFirstRunWizard({
            vaultPath,
            workshopManifest: null,  // wizard loads after path validates
            nonInteractive,
            defaults: wizardDefaults || {}
        });
        config = r.config;
        subscription = r.subscription;
        ensureDir(path.dirname(cfgPath));
        writeJsonAtomic(cfgPath, config);
        writeJsonAtomic(subPath, subscription);
        workshopPath = path.resolve(vaultPath, config.workshop_relative_path);
        workshopManifest = readJson(path.join(workshopPath, "platform/manifest.json"));
    }

    // Step 5: build plugin id set (foundational + per-subscribed external_plugins + injections)
    const pluginIds = new Set();
    const foundational = workshopManifest.foundational_plugins || [];
    for (const fp of foundational) {
        if (fp && typeof fp.id === "string") pluginIds.add(fp.id);
    }
    const subscribedItems = [
        ...((subscription.mechanisms) || []).map(m => ({ kind: "mechanisms", name: m.name })),
        ...((subscription.blueprints) || []).map(b => ({ kind: "blueprints", name: b.name }))
    ];
    for (const item of subscribedItems) {
        if (!item.name) continue;
        const itemMfPath = path.join(workshopPath, "platform", item.kind, item.name, "manifest.json");
        if (!fs.existsSync(itemMfPath)) continue;
        let mf;
        try { mf = readJson(itemMfPath); } catch (_) { continue; }
        for (const p of (mf.external_plugins || [])) {
            if (p && typeof p.id === "string") pluginIds.add(p.id);
        }
    }
    for (const id of injectExtraPluginIds) {
        if (typeof id === "string") pluginIds.add(id);
    }

    // Step 6: fetch upstream index for id → repo lookup
    const index = await indexMod.fetchIndex();

    // Step 7: per-plugin fetch (skip-if-present unless force)
    const fetched = [];
    const skipped = [];
    const failed = [];

    for (const id of pluginIds) {
        const entry = index[id];
        if (!entry) {
            failed.push({ id, reason: `plugin id '${id}' not found in obsidian-releases community-plugins index` });
            continue;
        }
        const force = forceReinstall.includes(id);
        try {
            const r = await fetchPluginMod.fetchPlugin({
                id,
                repo: entry.repo,
                vaultPath,
                force
            });
            if (r.status === "skipped") skipped.push({ id });
            else if (r.status === "fetched") fetched.push({ id });
        } catch (e) {
            failed.push({ id, reason: e.message });
        }
    }

    // Step 8: register installed plugin ids in community-plugins.json (additive merge)
    const installedIds = [...fetched.map(x => x.id), ...skipped.map(x => x.id)];
    if (installedIds.length > 0) {
        await mergeMod.mergeCommunityPlugins({ vaultPath, addIds: installedIds });
    }

    // Step 9: drive the existing Node installer (themes, appearance, style-settings, files, nav buttons)
    if (!skipInstaller) {
        const installer = require("./install.js");
        if (typeof installer.runInstall === "function") {
            await installer.runInstall(vaultPath);
        }
    }

    // Step 10: report
    const report = { fetched, skipped, failed };
    if (!nonInteractive) {
        console.log("");
        console.log("Bootstrap complete.");
        console.log(`  fetched: ${fetched.length}`);
        console.log(`  skipped: ${skipped.length}`);
        console.log(`  failed:  ${failed.length}`);
        if (failed.length > 0) {
            console.log("");
            console.log("Failures:");
            for (const f of failed) console.log(`  - ${f.id}: ${f.reason}`);
        }
        if (skipInstaller) {
            console.log("");
            console.log("Installer skipped (skipInstaller=true).");
        } else {
            console.log("");
            console.log("Open the vault in Obsidian and press Cmd+R to load.");
        }
    }
    return report;
}

function mergeSubscription(existing, payload, workshopManifest) {
    const out = Object.assign({}, existing);
    if (Array.isArray(payload.mechanisms)) {
        out.mechanisms = payload.mechanisms.map(name => {
            const m = (workshopManifest.mechanisms || []).find(x => x.name === name);
            return { name, version: m ? m.version : (existing.mechanisms || []).find(x => x.name === name)?.version || "0.0.0" };
        });
    }
    if (Array.isArray(payload.blueprints)) {
        out.blueprints = payload.blueprints.map(name => {
            const b = (workshopManifest.blueprints || []).find(x => x.name === name);
            return { name, version: b ? b.version : (existing.blueprints || []).find(x => x.name === name)?.version || "0.0.0" };
        });
    }
    return out;
}

if (require.main === module) {
    runBootstrap({ vaultPath: process.cwd(), nonInteractive: false })
        .then(() => process.exit(0))
        .catch(e => { console.error(e.stack || e.message); process.exit(1); });
}

module.exports = { runBootstrap };
