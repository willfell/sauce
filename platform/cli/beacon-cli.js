#!/usr/bin/env node
// platform/cli/beacon-cli.js — Beacon CLI dispatcher.
// Resolves vault context (cwd ancestor walk; $BEACON_VAULT fallback) and
// dispatches to cmd-<verb>.js.

const fs = require("fs");
const path = require("path");

const VERBS = {
    bootstrap: "./cmd-bootstrap.js",
    update:    "./cmd-update.js",
    status:    "./cmd-status.js",
    wizard:    "./cmd-wizard.js"
};

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

async function resolveContext(opts) {
    opts = opts || {};
    const cwd = opts.cwd || process.cwd();
    const env = opts.env || process.env;
    let vaultPath = null;
    let cur = path.resolve(cwd);
    while (cur !== path.dirname(cur)) {
        if (fs.existsSync(path.join(cur, "Docs/Meta/platform-config.json"))) {
            vaultPath = cur;
            break;
        }
        cur = path.dirname(cur);
    }
    if (!vaultPath && env.BEACON_VAULT) {
        if (fs.existsSync(path.join(env.BEACON_VAULT, "Docs/Meta/platform-config.json"))) {
            vaultPath = env.BEACON_VAULT;
        }
    }
    if (!vaultPath) {
        throw new Error("Not inside a beacon-managed vault. cd into one or set BEACON_VAULT.");
    }
    const config = readJson(path.join(vaultPath, "Docs/Meta/platform-config.json"));
    const subPath = path.join(vaultPath, "Docs/Meta/platform-subscription.json");
    const subscription = fs.existsSync(subPath) ? readJson(subPath) : { mechanisms: [], blueprints: [] };
    const workshopPath = path.resolve(vaultPath, config.workshop_relative_path || "Beacon");
    const wmPath = path.join(workshopPath, "platform/manifest.json");
    const workshopManifest = fs.existsSync(wmPath) ? readJson(wmPath) : null;
    return { vaultPath, config, subscription, workshopPath, workshopManifest };
}

async function dispatch(argv, opts) {
    opts = opts || {};
    const verb = argv[0];
    const rest = argv.slice(1);
    if (!verb || verb === "--help" || verb === "-h") {
        printUsage();
        return;
    }
    if (!VERBS[verb]) {
        throw new Error(`unknown verb: ${verb}\nUsage: beacon <bootstrap|update|status|wizard>`);
    }
    const ctx = await resolveContext(opts);
    const mod = require(VERBS[verb]);
    await mod.run(ctx, rest);
}

function printUsage() {
    console.log("Usage: beacon <verb> [args]\n\nVerbs:\n  bootstrap  First-run install (rare; called by install.sh)\n  update     Pull latest workshop + reinstall\n  status     Show vault + workshop state\n  wizard     Interactive subscription / config editor\n");
}

if (require.main === module) {
    dispatch(process.argv.slice(2)).catch(e => {
        console.error(e.stack || e.message);
        process.exit(1);
    });
}

module.exports = { dispatch, resolveContext };
