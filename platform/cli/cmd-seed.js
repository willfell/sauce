// platform/cli/cmd-seed.js — `sauce seed` verb. Materializes per-blueprint seed
// contributions into a target vault. Workshop-only; never runs from a consumer.

const path = require("path");
const fs = require("fs");
const os = require("os");
const registry = require("./registry.js");
const seeder = require("../seeder/seeder.js");

function expandTilde(p) {
    if (!p) return p;
    if (p === "~" || p === "~/") return process.env.HOME || os.homedir();
    if (p.startsWith("~/")) return path.join(process.env.HOME || os.homedir(), p.slice(2));
    return p;
}

function parseArgs(args) {
    const out = { blueprints: [], vault: null, anchorDate: null, reset: false, dryRun: false };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--vault") out.vault = expandTilde(args[++i]);
        else if (a === "--blueprint") out.blueprints.push(args[++i]);
        else if (a === "--anchor-date") out.anchorDate = args[++i];
        else if (a === "--reset") out.reset = true;
        else if (a === "--dry-run") out.dryRun = true;
        else if (a === "--help" || a === "-h") return { help: true };
        else throw new Error(`unknown arg: ${a}`);
    }
    return out;
}

function resolveTargetVault(opts) {
    if (opts.vault) return path.resolve(opts.vault);
    const vaults = registry.list();
    if (vaults.length === 1) return vaults[0].path;
    if (vaults.length === 0) throw new Error("no vaults registered; pass --vault <path>");
    throw new Error(`multiple vaults registered (${vaults.length}); specify --vault`);
}

function readVaultKind(vaultPath) {
    const cfg = path.join(vaultPath, "ranch", "platform-config.json");
    if (!fs.existsSync(cfg)) return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(cfg, "utf8"));
        return parsed.vault_kind || null;
    } catch {
        return null;
    }
}

async function run(ctx, args) {
    const opts = parseArgs(args || []);
    if (opts.help) {
        console.log("usage: sauce seed [--vault <path>] [--blueprint <name>...] [--reset] [--anchor-date YYYY-MM-DD] [--dry-run]");
        return;
    }
    const vaultPath = resolveTargetVault(opts);
    const workshopRoot = ctx._sauceDir
        ? path.resolve(ctx._sauceDir, "..")
        : path.resolve(__dirname, "..", "..");

    if (opts.reset) {
        // S4 wires this branch — placeholder until then
        const kind = readVaultKind(vaultPath);
        if (kind !== "test") {
            console.error(`refusing to --reset against a non-test vault (${vaultPath}); add "vault_kind":"test" to ranch/platform-config.json or omit --reset`);
            process.exit(2);
        }
        // delete-then-seed wired in S4
        throw new Error("--reset path not implemented until S4");
    }

    const result = seeder.seedVault({
        workshopRoot,
        vaultPath,
        blueprints: opts.blueprints,
        anchorDate: opts.anchorDate,
        dryRun: opts.dryRun,
    });

    console.log(`sauce seed: vault=${result.vaultPath} anchor=${result.anchorDate}`);
    let total = 0, warnings = 0;
    for (const r of result.results) {
        const tag = `[${r.blueprint.padEnd(10)}]`;
        if (r.warning) {
            console.log(`${tag} ${r.warning}`);
            warnings++;
            continue;
        }
        if (opts.dryRun) {
            console.log(`${tag} would create ${r.planned} notes (dry-run)`);
        } else {
            console.log(`${tag} ${String(r.created).padStart(2)} notes created, ${r.skipped} skipped`);
            total += r.created;
        }
    }
    if (!opts.dryRun) {
        console.log(`total: ${total} notes across ${result.results.length} blueprints (${warnings} warnings)`);
    }
}

module.exports = { run };
