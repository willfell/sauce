// platform/migrate/dispatcher.js — v0.28.0 S2 (T2.6b).
//
// Walks source recursively; routes per file to the highest-priority
// migrator whose canHandle returns true; emits planEntries[]; either
// writes migration-plan.json (dry-run default) OR delegates to commit.js
// (--commit flow).
//
// Public API:
//   run({ ctx, fromAbs, flags }) → { planEntries, warnings, collisions }
//
// Source vault is READ-ONLY at all times.

const fs = require("fs");
const path = require("path");

// Skip-list. Directories named here (anywhere in the source tree) are
// excluded from migration entirely. Includes:
//   - Obsidian/git internals: .obsidian, .git, .DS_Store
//   - Plugin caches that rebuild on demand: .smart-env, .smart-connections
//   - Build/runtime cruft: node_modules, venv, .venv, __pycache__
//   - Source-corruption sentinel: Invalid date (Templater bad-output marker)
// Source vaults that are 1.5GB+ (e.g., real Accuris) shrink ~30x post-skip.
const SKIP_DIR_NAMES = new Set([
    ".obsidian", ".git", ".DS_Store",
    "node_modules", "venv", ".venv", "__pycache__",
    ".smart-env", ".smart-connections", ".trash",
    "Invalid date"
]);
const SKIP_EXT = new Set([".tmp", ".pyc"]);

function _loadMigrators() {
    const migratorsDir = path.join(__dirname, "migrators");
    const files = fs.readdirSync(migratorsDir).filter(f => f.endsWith(".js"));
    const list = [];
    for (const f of files) {
        const mod = require(path.join(migratorsDir, f));
        if (mod && typeof mod.canHandle === "function" && typeof mod.plan === "function" && typeof mod.migrate === "function") {
            list.push(mod);
        }
    }
    const verbatim = require("./verbatim");
    list.push(verbatim);
    list.sort((a, b) => (a.priority || 0) - (b.priority || 0));
    return list;
}

function _shouldSkip(relPath, basename, isDir) {
    if (isDir) {
        // Directory skip — match by basename in skip-set
        if (SKIP_DIR_NAMES.has(basename)) return true;
        // Match nested matches: `Timestamps/Invalid date` etc.
        const segs = relPath.split(/[\\/]/);
        return segs.some(s => SKIP_DIR_NAMES.has(s));
    }
    // File skip
    const segs = relPath.split(/[\\/]/);
    if (segs.some(s => SKIP_DIR_NAMES.has(s))) return true;
    const ext = path.extname(basename);
    if (SKIP_EXT.has(ext)) return true;
    if (basename === ".DS_Store") return true;
    return false;
}

// Walk source vault recursively; per-entry I/O errors degrade to warnings
// rather than aborting the whole plan. Quality-review I-3.
function _walkSource(srcRoot, warnings) {
    warnings = warnings || [];
    const out = [];
    function _w(curAbs, relParent) {
        let entries;
        try { entries = fs.readdirSync(curAbs, { withFileTypes: true }); }
        catch (e) {
            warnings.push(`walker: readdir failed for ${curAbs}: ${e.message}`);
            return;
        }
        for (const e of entries) {
            const childAbs = path.join(curAbs, e.name);
            const childRel = relParent ? path.join(relParent, e.name) : e.name;
            const childRelNorm = childRel.replace(/\\/g, "/");
            if (e.isDirectory()) {
                if (_shouldSkip(childRelNorm, e.name, true)) continue;
                _w(childAbs, childRel);
            } else if (e.isFile()) {
                if (_shouldSkip(childRelNorm, e.name, false)) continue;
                let stat;
                try { stat = fs.statSync(childAbs); }
                catch (err) {
                    warnings.push(`walker: stat failed for ${childAbs}: ${err.message}`);
                    continue;
                }
                out.push({ relPath: childRelNorm, absPath: childAbs, stat });
            }
        }
    }
    _w(srcRoot, "");
    return out;
}

function _detectCollisions(planEntries) {
    const byTgt = new Map();
    for (const e of planEntries) {
        if (!e.tgt) continue;
        if (!byTgt.has(e.tgt)) byTgt.set(e.tgt, []);
        byTgt.get(e.tgt).push(e.src);
    }
    const collisions = [];
    for (const [tgt, srcs] of byTgt.entries()) {
        if (srcs.length > 1) collisions.push({ tgt, srcs });
    }
    return collisions;
}

async function run(opts) {
    const ctx = (opts && opts.ctx) || {};
    const fromAbs = opts && opts.fromAbs;
    const flags = (opts && opts.flags) || {};
    if (!fromAbs || !fs.existsSync(fromAbs) || !fs.statSync(fromAbs).isDirectory()) {
        throw new Error(`dispatcher.run: --from must be a valid directory: ${fromAbs}`);
    }

    const migrators = _loadMigrators();
    const warnings = [];
    const files = _walkSource(fromAbs, warnings);
    const planEntries = [];

    for (const f of files) {
        let owner = null;
        for (const m of migrators) {
            try {
                if (m.canHandle(f.relPath, f.stat)) { owner = m; break; }
            } catch (e) {
                warnings.push(`canHandle threw for ${f.relPath} in migrator ${m.name}: ${e.message}`);
            }
        }
        if (!owner) {
            warnings.push(`no migrator claimed ${f.relPath} (verbatim fallback should always claim — check ordering)`);
            continue;
        }
        let entry;
        try {
            entry = owner.plan(f.relPath, f.absPath, ctx);
        } catch (e) {
            warnings.push(`plan() threw for ${f.relPath} in ${owner.name}: ${e.message}`);
            continue;
        }
        if (!entry) continue;
        if (!entry.migrator) entry.migrator = owner.name;
        planEntries.push(entry);
    }

    const collisions = _detectCollisions(planEntries);
    const result = { planEntries, warnings, collisions };

    if (flags.commit) {
        const commit = require("./commit");
        return await commit.commit(result, { ctx, fromAbs, flags });
    }

    // Dry-run: emit plan to stdout. Writes migration-plan.json only when
    // a vault context is resolved (production path); harness invocations
    // without ctx.vaultPath skip the file-write to keep cwd clean.
    const plan = require("./plan");
    const outDir = (ctx && ctx.vaultPath) || null;
    plan.emitPlan(result, { outDir, quiet: flags.quiet });
    return result;
}

module.exports = { run, _walkSource, _shouldSkip, _detectCollisions, _loadMigrators };
