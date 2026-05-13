// platform/seeder/seeder.js — public API; orchestrates per-blueprint seed loading.

const fs = require("fs");
const path = require("path");
const declarative = require("./declarative.js");

function listSeedableBlueprints(workshopRoot) {
    const dir = path.join(workshopRoot, "platform", "blueprints");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .filter(name => fs.existsSync(path.join(dir, name, "seed")));
}

function readBlueprintModuleDir(workshopRoot, blueprint) {
    if (!/^[a-zA-Z0-9_-]+$/.test(blueprint)) {
        throw new Error(`invalid blueprint name '${blueprint}': must match /^[a-zA-Z0-9_-]+$/`);
    }
    const m = require(path.join(workshopRoot, "platform", "blueprints", blueprint, "manifest.json"));
    if (!m.module_directory) throw new Error(`blueprint ${blueprint} has no module_directory`);
    return m.module_directory;
}

function seedVault(opts) {
    // opts: { workshopRoot, vaultPath, blueprints, anchorDate, dryRun }
    const { workshopRoot, vaultPath } = opts;
    const blueprints = (opts.blueprints && opts.blueprints.length)
        ? opts.blueprints
        : listSeedableBlueprints(workshopRoot);
    const anchorDate = opts.anchorDate || new Date().toISOString().slice(0, 10);
    const results = [];
    for (const bp of blueprints) {
        const bpRoot = path.join(workshopRoot, "platform", "blueprints", bp);
        const moduleDir = readBlueprintModuleDir(workshopRoot, bp);
        const ctx = {
            vaultPath,
            moduleDir,
            anchorDate,
            stockVars: { now: new Date().toISOString(), today: anchorDate, anchor_date: anchorDate, module_directory: moduleDir },
        };
        const decl = declarative.loadDeclarativeSeed(bpRoot);
        if (decl) {
            if (opts.dryRun) {
                results.push({ blueprint: bp, kind: "declarative", planned: decl.notes.length, created: 0, skipped: 0 });
            } else {
                const r = declarative.materializeDeclarative(decl, ctx, bpRoot);
                results.push({ blueprint: bp, kind: "declarative", created: r.created, skipped: r.skipped });
            }
            continue;
        }
        // programmatic branch added in S3
        results.push({ blueprint: bp, kind: "unknown", created: 0, skipped: 0, warning: "no declarative seed" });
    }
    return { vaultPath, anchorDate, results };
}

module.exports = { seedVault, listSeedableBlueprints, readBlueprintModuleDir };
