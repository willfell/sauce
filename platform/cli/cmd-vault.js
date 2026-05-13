// platform/cli/cmd-vault.js — sauce vault add | list | remove.
// Operates on the per-machine global registry at ~/.sauce/vaults.json.
// Does NOT require a sauce-managed vault context (dispatcher must bypass
// resolveContext for this verb).

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
    const sub = (args || [])[0];
    if (sub === "add") {
        const raw = (args || [])[1];
        const resolved = path.resolve(expandTilde(raw || (ctx && ctx.vaultPath)));
        if (!resolved) throw new Error("usage: sauce vault add <path>");
        registry.add(resolved);
        console.log(`  Registered: ${resolved}`);
        return;
    }
    if (sub === "list") {
        const vaults = registry.list();
        if (vaults.length === 0) { console.log("  No vaults registered."); return; }
        for (const v of vaults) console.log(`  ${v.path}  (registered ${v.registered_at})`);
        return;
    }
    if (sub === "remove") {
        const raw = (args || [])[1];
        if (!raw) throw new Error("usage: sauce vault remove <path>");
        const resolved = path.resolve(expandTilde(raw));
        registry.remove(resolved);
        console.log(`  Removed: ${resolved}`);
        return;
    }
    throw new Error("usage: sauce vault <add|list|remove> [path]");
}

module.exports = { run };
