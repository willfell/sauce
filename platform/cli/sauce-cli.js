#!/usr/bin/env node
// platform/cli/sauce-cli.js — Sauce CLI dispatcher.
// Resolves vault context (cwd ancestor walk; $SAUCE_VAULT fallback) and
// dispatches to cmd-<verb>.js.

const fs = require("fs");
const path = require("path");

const VERBS = {
    bootstrap: "./cmd-bootstrap.js",
    update:    "./cmd-update.js",
    status:    "./cmd-status.js",
    wizard:    "./cmd-wizard.js",
    migrate:   "./cmd-migrate.js",
    audit:     "./cmd-audit.js",
    vault:     "./cmd-vault.js",
    reinstall: "./cmd-reinstall.js",
    "migrate-layout": "./cmd-migrate-layout.js",
    help:      "./cmd-help.js"
};

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

async function resolveContext(opts) {
    opts = opts || {};
    const cwd = opts.cwd || process.cwd();
    const env = opts.env || process.env;
    let vaultPath = null;
    let cur = path.resolve(cwd);
    while (cur !== path.dirname(cur)) {
        if (fs.existsSync(path.join(cur, "ranch/platform-config.json"))) {
            vaultPath = cur;
            break;
        }
        cur = path.dirname(cur);
    }
    if (!vaultPath && env.SAUCE_VAULT) {
        if (fs.existsSync(path.join(env.SAUCE_VAULT, "ranch/platform-config.json"))) {
            vaultPath = env.SAUCE_VAULT;
        }
    }
    if (!vaultPath) {
        throw new Error("Not inside a sauce-managed vault. cd into one or set SAUCE_VAULT.");
    }
    const config = readJson(path.join(vaultPath, "ranch/platform-config.json"));
    const subPath = path.join(vaultPath, "ranch/platform-subscription.json");
    const subscription = fs.existsSync(subPath) ? readJson(subPath) : { mechanisms: [], blueprints: [] };
    const workshopPath = path.resolve(vaultPath, config.workshop_relative_path || "pantry");
    const wmPath = path.join(workshopPath, "platform/manifest.json");
    const workshopManifest = fs.existsSync(wmPath) ? readJson(wmPath) : null;
    return { vaultPath, config, subscription, workshopPath, workshopManifest };
}

// Synthesize a minimal ctx for `bootstrap --vault PATH` when no
// platform-config.json exists yet (install.sh hand-off entry point).
// The bootstrap verb is the only one that CREATES the config, so it must
// tolerate its absence. Other verbs require resolveContext.
function bootstrapCtxFromArgs(rest) {
    let vaultPath = null;
    for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--vault" && i + 1 < rest.length) {
            vaultPath = path.resolve(rest[i + 1]);
            break;
        }
    }
    if (!vaultPath) return null;
    if (!fs.existsSync(vaultPath)) return null;
    // Workshop is the cloned pantry/ inside the vault per install.sh contract.
    const workshopPath = path.join(vaultPath, "pantry");
    const wmPath = path.join(workshopPath, "platform/manifest.json");
    const workshopManifest = fs.existsSync(wmPath) ? readJson(wmPath) : null;
    return {
        vaultPath,
        config: { workshop_relative_path: "pantry", variables: {} },
        subscription: { mechanisms: [], blueprints: [] },
        workshopPath,
        workshopManifest
    };
}

async function dispatch(argv, opts) {
    opts = opts || {};
    let verb = argv[0];
    const rest = argv.slice(1);
    // v0.26.1 P1-3a: route bare `sauce`, `sauce --help`, `sauce -h` to the
    // help verb. Help works OUTSIDE any vault — does NOT call resolveContext.
    if (verb === undefined || verb === "--help" || verb === "-h") verb = "help";
    if (verb === "help") {
        const cmd = require(VERBS.help);
        await cmd.run(null, rest);
        process.exitCode = 0;
        return;
    }
    if (verb === "vault") {
        const cmd = require(VERBS.vault);
        await cmd.run(null, rest);
        process.exitCode = 0;
        return;
    }
    if (verb === "reinstall") {
        const cmd = require(VERBS.reinstall);
        // Forward test hooks (e.g. _runInstaller) via the opts arg to dispatch().
        // reinstall is context-free (operates on the registry, not a vault).
        const testCtx = opts || {};
        await cmd.run(testCtx, rest);
        process.exitCode = 0;
        return;
    }
    if (verb === "migrate-layout") {
        const cmd = require(VERBS["migrate-layout"]);
        // Context-free: operates against an explicit --vault path. Forward
        // test hooks (_brewPrefix, _brewWorkshopVersion, _runInstaller,
        // _auditStrict) via the opts arg to dispatch().
        const testCtx = opts || {};
        await cmd.run(testCtx, rest);
        process.exitCode = process.exitCode || 0;
        return;
    }
    if (!VERBS[verb]) {
        throw new Error(`unknown verb: ${verb}\nUsage: sauce <bootstrap|update|status|wizard|migrate|migrate-layout|audit|vault|reinstall|help>`);
    }
    let ctx;
    if (verb === "bootstrap") {
        // Bootstrap CREATES the config — tolerate its absence when --vault is
        // supplied (install.sh hand-off path). Fall through to resolveContext
        // only if --vault was not passed (rare; manual re-bootstrap inside
        // an already-managed vault).
        ctx = bootstrapCtxFromArgs(rest) || await resolveContext(opts);
    } else {
        ctx = await resolveContext(opts);
    }
    // Forward test hooks (underscore-prefixed callables) from opts onto the
    // resolved ctx so harness fixtures can stub git/npm/installer without
    // shelling out. Only underscore-prefixed function-valued entries are
    // copied — never overrides resolved fields like vaultPath/workshopPath.
    if (opts && typeof opts === "object") {
        for (const k of Object.keys(opts)) {
            if (k.startsWith("_") && typeof opts[k] === "function" && !(k in ctx)) {
                ctx[k] = opts[k];
            }
        }
    }
    const mod = require(VERBS[verb]);
    await mod.run(ctx, rest);
}

function printUsage() {
    console.log("Usage: sauce <verb> [args]\n\nVerbs:\n  bootstrap        First-run install (rare; called by install.sh)\n  update           Pull latest workshop + reinstall\n  status           Show vault + workshop state\n  wizard           Interactive subscription / config editor\n  migrate          Migrate a source vault into this sauce vault (v0.28.0+)\n  migrate-layout   Move legacy <vault>/pantry/ → brew-installed layout (v0.36.0+)\n  audit            Audit a vault for blueprint conformance + untracked dirs (v0.29.0+)\n  vault            Manage the per-machine vault registry (add|list|remove)\n  reinstall        Re-run installer against --all registered vaults or --vault <p>\n");
}

if (require.main === module) {
    dispatch(process.argv.slice(2)).catch(e => {
        console.error(e.stack || e.message);
        process.exit(1);
    });
}

module.exports = { dispatch, resolveContext };
