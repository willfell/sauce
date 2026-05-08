// platform/migrate/plan.js — v0.28.0 S2 (T2.6b).
//
// emitPlan(plan, opts) → void. Pretty-print stdout table of all
// planEntries (migrator | action | src → tgt + warning count) + write
// migration-plan.json to opts.outDir (typically process.cwd()).

const fs = require("fs");
const path = require("path");

function emitPlan(plan, opts) {
    opts = opts || {};
    const outDir = opts.outDir;
    const planEntries = (plan && plan.planEntries) || [];
    const warnings = (plan && plan.warnings) || [];
    const collisions = (plan && plan.collisions) || [];

    const counts = {};
    for (const e of planEntries) {
        const key = e.migrator + "/" + e.action;
        counts[key] = (counts[key] || 0) + 1;
    }
    const totalWarnings = planEntries.reduce((acc, e) => acc + (e.warnings ? e.warnings.length : 0), 0) + warnings.length;

    if (!opts.quiet && !process.env.SAUCE_TEST_MODE) {
        console.log(`migration plan: ${planEntries.length} entries, ${totalWarnings} warnings, ${collisions.length} collisions`);
        console.log("");
        const sortedKeys = Object.keys(counts).sort();
        for (const k of sortedKeys) {
            console.log(`  ${k.padEnd(30)} ${counts[k]}`);
        }
        if (collisions.length > 0) {
            console.log("");
            console.log("COLLISIONS (failure-loud at --commit):");
            for (const c of collisions) {
                console.log(`  ${c.tgt} ← ${c.srcs.join(", ")}`);
            }
        }
        if (warnings.length > 0) {
            console.log("");
            console.log("Top-level warnings:");
            for (const w of warnings) console.log(`  ${w}`);
        }
        if (outDir) {
            console.log("");
            console.log(`migration-plan.json written to: ${path.join(outDir, "migration-plan.json")}`);
        }
    }

    // Atomic write (temp file + rename) per commit.js posture; quality-review I-4.
    // Skip when no outDir explicitly given (harness path).
    if (outDir) {
        const finalPath = path.join(outDir, "migration-plan.json");
        const tmpPath = finalPath + ".tmp-" + process.pid + "-" + Date.now();
        fs.writeFileSync(
            tmpPath,
            JSON.stringify({ planEntries, warnings, collisions, counts, generatedAt: new Date().toISOString() }, null, 2),
            "utf8"
        );
        fs.renameSync(tmpPath, finalPath);
    }
}

module.exports = { emitPlan };
