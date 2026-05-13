// platform/cli/cmd-reinstall.js — re-run installer against --vault or --all.
// Operates against the per-machine registry; like cmd-vault, does NOT
// require a sauce-managed vault context.

const path = require("path");
const os = require("os");
const registry = require("./registry.js");

function expandTilde(p) {
    if (!p) return p;
    if (p === "~" || p === "~/") return process.env.HOME || os.homedir();
    if (p.startsWith("~/")) return path.join(process.env.HOME || os.homedir(), p.slice(2));
    return p;
}

async function run(ctx, args) {
    const flags = args || [];
    const all = flags.includes("--all");
    const vaultIdx = flags.indexOf("--vault");
    const keepMissing = flags.includes("--keep-missing");

    let targets = [];
    if (all) {
        if (!keepMissing) {
            const removed = registry.pruneMissing();
            if (removed.length) console.log(`  Pruned ${removed.length} missing vault(s): ${removed.join(", ")}`);
        }
        targets = registry.list().map(v => v.path);
    } else if (vaultIdx >= 0 && flags[vaultIdx + 1]) {
        targets = [path.resolve(expandTilde(flags[vaultIdx + 1]))];
    } else {
        throw new Error("usage: sauce reinstall (--all | --vault <path>)");
    }

    if (targets.length === 0) {
        console.log("  No vaults to reinstall.");
        return;
    }

    for (const t of targets) {
        console.log(`  Reinstalling: ${t}`);
        await _runInstaller(ctx, { vaultPath: t });
    }
}

async function _runInstaller(ctx, opts) {
    if (ctx && typeof ctx._runInstaller === "function") return ctx._runInstaller(opts);
    const bootstrap = require("../bootstrap.js");
    await bootstrap.phaseRunInstaller(opts);
}

module.exports = { run };
