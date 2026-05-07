#!/usr/bin/env node
/**
 * Sauce consumer bootstrap — interactive Node CLI (v0.23.0).
 *
 * Run from a consumer vault directory:
 *   node ../sauce/platform/bootstrap.js
 *
 * First-time setup: cd <workshop> && npm install
 *
 * Flow:
 *   1. Detect node_modules; print hint + exit if missing (skipped in nonInteractive)
 *   2. Read <vault>/ranch/platform-config.json (or trigger first-run wizard)
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
 *   plus phase functions for CLI / harness use:
 *     - phaseFirstRunWizard
 *     - phaseFetchPlugins
 *     - phaseRunInstaller
 *     - phaseWriteActivation (NEW v0.22.0)
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

// ----------------------------------------------------------------------------
// Phase functions (v0.22.0 S2 — extracted for reuse by CLI verbs).
// ----------------------------------------------------------------------------

async function phaseFirstRunWizard(opts) {
    // opts: { vaultPath, cfgPath, subPath, nonInteractive, wizardDefaults }
    const { vaultPath, cfgPath, subPath, nonInteractive, wizardDefaults } = opts;
    let config, subscription, workshopPath, workshopManifest;
    const cfgExists = fs.existsSync(cfgPath);
    const subExists = fs.existsSync(subPath);
    if (cfgExists && subExists) {
        config = readJson(cfgPath);
        subscription = readJson(subPath);
        workshopPath = path.resolve(vaultPath, config.workshop_relative_path);
        const wmPath = path.join(workshopPath, "platform/manifest.json");
        if (!fs.existsSync(wmPath)) {
            throw new Error(`Workshop manifest not found at ${wmPath} (resolved from config.workshop_relative_path = ${config.workshop_relative_path}).`);
        }
        workshopManifest = readJson(wmPath);
    } else {
        // First-run path: defer workshop discovery to the wizard so it can
        // prompt for workshop_relative_path FIRST + validate manifest exists.
        const r = await wizardMod.runFirstRunWizard({
            vaultPath,
            workshopManifest: null,
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
    return { config, subscription, workshopPath, workshopManifest };
}

async function phaseFetchPlugins(opts) {
    // Returns { fetched, skipped, failed }.
    const { vaultPath, workshopPath, workshopManifest, subscription, forceReinstall, injectExtraPluginIds } = opts;
    const pluginIds = new Set();
    for (const fp of (workshopManifest.foundational_plugins || [])) {
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
    for (const id of (injectExtraPluginIds || [])) {
        if (typeof id === "string") pluginIds.add(id);
    }
    const index = await indexMod.fetchIndex();
    const fetched = [], skipped = [], failed = [];
    for (const id of pluginIds) {
        const entry = index[id];
        if (!entry) {
            failed.push({ id, reason: `plugin id '${id}' not found in obsidian-releases community-plugins index` });
            continue;
        }
        const force = (forceReinstall || []).includes(id);
        try {
            const r = await fetchPluginMod.fetchPlugin({ id, repo: entry.repo, vaultPath, force });
            if (r.status === "skipped") skipped.push({ id });
            else if (r.status === "fetched") fetched.push({ id });
        } catch (e) {
            failed.push({ id, reason: e.message });
        }
    }
    const installedIds = [...fetched.map(x => x.id), ...skipped.map(x => x.id)];
    if (installedIds.length > 0) {
        await mergeMod.mergeCommunityPlugins({ vaultPath, addIds: installedIds });
    }
    return { fetched, skipped, failed };
}

async function phaseRunInstaller(opts) {
    const installer = require("./install.js");
    if (typeof installer.runInstall === "function") {
        await installer.runInstall(opts.vaultPath);
    }
}

async function phaseWriteActivation(opts) {
    // NEW v0.22.0 (renamed v0.23.0) — generates <workshopAbsPath>/Scripts/{activate.sh, sauce}
    // with absolute paths baked in. Atomic write + backup-on-overwrite to
    // .sauce-backup (matches landmine #12 mechanic #2).
    const { vaultPath, workshopAbsPath } = opts;
    const scriptsDir = path.join(workshopAbsPath, "Scripts");
    ensureDir(scriptsDir);
    const cliPath = path.join(workshopAbsPath, "platform/cli/sauce-cli.js");
    const actPath = path.join(scriptsDir, "activate.sh");
    const binPath = path.join(scriptsDir, "sauce");
    const actBody = `# Sauce activation — sourced into your shell.
# Generated by phaseWriteActivation; absolute paths resolved at install time.
export SAUCE_VAULT="${vaultPath}"
case ":$PATH:" in
  *":${scriptsDir}:"*) ;;
  *) export PATH="${scriptsDir}:$PATH" ;;
esac
echo "sauce active. Try: sauce status"
`;
    const binBody = `#!/usr/bin/env bash
exec node "${cliPath}" "$@"
`;
    _writeWithBackup(actPath, actBody);
    _writeWithBackup(binPath, binBody);
    fs.chmodSync(binPath, 0o755);
    return { activatePath: actPath, saucePath: binPath };
}

function _writeWithBackup(p, body) {
    if (fs.existsSync(p)) {
        const backup = p + ".sauce-backup";
        fs.copyFileSync(p, backup);
    }
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, p);
}

// ----------------------------------------------------------------------------
// Back-compat wrapper: runBootstrap composes the phases + preserves v0.21.x
// re-run-wizard menu, CF-5 canonical-variables augment, CF-4 stub-copy block,
// and the final report block.
// ----------------------------------------------------------------------------

async function runBootstrap(opts) {
    opts = opts || {};
    const vaultPath = path.resolve(opts.vaultPath || process.cwd());
    const nonInteractive = !!opts.nonInteractive;
    const skipInstaller = !!opts.skipInstaller;
    const forceReinstall = opts.forceReinstall || [];
    const injectExtraPluginIds = opts.injectExtraPluginIds || [];
    const wizardDefaults = opts.wizardDefaults || null;
    const action = opts.action || null;

    if (!nonInteractive) {
        detectInquirerOrExit();
    }

    const cfgPath = path.join(vaultPath, "ranch/platform-config.json");
    const subPath = path.join(vaultPath, "ranch/platform-subscription.json");

    // Capture pre-existence BEFORE phaseFirstRunWizard writes either file —
    // determines whether the re-run wizard menu should fire (only when the
    // user already had a config; first-run path is just-prompted).
    const cfgPreExisted = fs.existsSync(cfgPath) && fs.existsSync(subPath);

    let { config, subscription, workshopPath, workshopManifest } =
        await phaseFirstRunWizard({ vaultPath, cfgPath, subPath, nonInteractive, wizardDefaults });

    // Re-run wizard menu (interactive only; preserves v0.21.0 behavior).
    if (!nonInteractive && cfgPreExisted) {
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
            // v0.26.0 P0-1: route through wizard's _normalizeSubscriptionFile
            // helper. The helper takes bare-string selections + manifest entries
            // and writes flat {name, version} entries atomically, healing any
            // legacy double-wrapped entries on disk in the same pass. Payload
            // entries from runReRunWizard arrive as already-objects (from
            // _buildSubscriptionEntries); convert to bare strings here so the
            // helper's contract stays pure.
            const toNames = (arr) => (Array.isArray(arr) ? arr : [])
                .map(e => (e && typeof e === "object" && typeof e.name === "string") ? e.name : (typeof e === "string" ? e : null))
                .filter(Boolean);
            wizardMod._normalizeSubscriptionFile(
                subPath,
                {
                    mechanisms: toNames(r.payload.mechanisms),
                    blueprints: toNames(r.payload.blueprints)
                },
                {
                    mechanisms: workshopManifest.mechanisms || [],
                    blueprints: workshopManifest.blueprints || []
                }
            );
            // Re-read the normalized subscription so downstream phases see flat shape.
            subscription = readJson(subPath);
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
    }

    // CF-5: ensure config.variables has the canonical platform path keys.
    // Older configs (pre-v0.21.0 or wizard-generated configs missing the
    // canonical defaults) may lack views_path / templates_path / etc. and
    // every install run emits "Unsubstituted variables: X" Notices, skipping
    // file writes. Augment ADDITIVELY — never overwrite a user-supplied value.
    const CANONICAL_VARIABLES = {
        views_path: "ranch/Views",
        templater_scripts_path: "ranch/Templater",
        scripts_path: "ranch/Scripts",
        rules_path: "ranch/rules",
        templates_path: "ranch/Templates",
        commands_path: "commands"
    };
    if (config && typeof config === "object") {
        config.variables = config.variables || {};
        let augmented = false;
        for (const [k, v] of Object.entries(CANONICAL_VARIABLES)) {
            if (config.variables[k] === undefined) {
                config.variables[k] = v;
                augmented = true;
            }
        }
        if (augmented) {
            writeJsonAtomic(cfgPath, config);
        }
    }

    // CF-4: ensure the v0.1.2 thin-stub installer dispatcher exists at
    // <vault>/ranch/Templater/platformInstall.js. run-install.js (and
    // Templater inside Obsidian) load this stub as the installer entry point;
    // the stub reads platform-config.json and dispatches to the workshop's
    // canonical install.js. Without it run-install fails "bootstrap installer
    // missing" (CF-4 surfaced in Phase C from scratch/1 — fresh vault never
    // had the stub).
    //
    // Stub is content-static across all consumers (landmine #13; md5
    // invariant a39257da1dd49ae4481e5cd0a42bdac4). Write only if missing;
    // never re-edit an existing one.
    const stubDest = path.join(vaultPath, "ranch/Templater/platformInstall.js");
    if (!fs.existsSync(stubDest)) {
        const stubSrc = path.join(workshopPath, "platform/installer-stub.js");
        if (fs.existsSync(stubSrc)) {
            ensureDir(path.dirname(stubDest));
            fs.copyFileSync(stubSrc, stubDest);
        }
    }

    const { fetched, skipped, failed } = await phaseFetchPlugins({
        vaultPath, workshopPath, workshopManifest, subscription, forceReinstall, injectExtraPluginIds
    });

    if (!skipInstaller) {
        await phaseRunInstaller({ vaultPath });
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

if (require.main === module) {
    runBootstrap({ vaultPath: process.cwd(), nonInteractive: false })
        .then(() => process.exit(0))
        .catch(e => { console.error(e.stack || e.message); process.exit(1); });
}

module.exports = {
    runBootstrap,
    phaseFirstRunWizard,
    phaseFetchPlugins,
    phaseRunInstaller,
    phaseWriteActivation
};
