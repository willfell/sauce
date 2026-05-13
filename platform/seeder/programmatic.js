// platform/seeder/programmatic.js — loads + invokes seed.js (kind: "programmatic").

const fs = require("fs");
const path = require("path");
const helpers = require("./helpers.js");

function loadProgrammaticSeed(blueprintRoot) {
    const seedPath = path.join(blueprintRoot, "seed", "seed.js");
    if (!fs.existsSync(seedPath)) return null;
    let mod;
    try {
        // bust require cache so test re-loads pick up edits
        delete require.cache[require.resolve(seedPath)];
        mod = require(seedPath);
    } catch (e) {
        throw new Error(`seed.js failed to load at ${seedPath}: ${e.message}`);
    }
    if (mod.schema_version !== 1) {
        throw new Error(`seed.js at ${seedPath}: unsupported schema_version ${mod.schema_version}`);
    }
    if (mod.kind !== "programmatic") {
        return null;
    }
    if (typeof mod.seed !== "function") {
        throw new Error(`seed.js at ${seedPath}: must export seed(ctx) function`);
    }
    return mod;
}

function makeProgrammaticCtx(baseCtx, blueprint, blueprintRoot) {
    const rng = helpers.fixedRng(blueprint, baseCtx.anchorDate);
    return {
        vaultPath: baseCtx.vaultPath,
        moduleDir: baseCtx.moduleDir,
        anchorDate: baseCtx.anchorDate,
        rng,
        helpers: {
            renderTemplate(relPath, vars) {
                const abs = path.join(blueprintRoot, relPath);
                if (!fs.existsSync(abs)) throw new Error(`renderTemplate: ${abs} not found`);
                return helpers.substituteLenient(fs.readFileSync(abs, "utf8"), vars);
            },
            jitterTime(hhmm, jitterMinutes, rngFn) {
                // hhmm "07:30" + jitter ±N minutes via rngFn -> "HH:MM" string
                const [h, m] = hhmm.split(":").map(Number);
                const baseMins = h * 60 + m;
                const delta = Math.floor((rngFn() * (2 * jitterMinutes + 1)) - jitterMinutes);
                const total = ((baseMins + delta) + 24 * 60) % (24 * 60);
                const oh = String(Math.floor(total / 60)).padStart(2, "0");
                const om = String(total % 60).padStart(2, "0");
                return `${oh}:${om}`;
            },
            pickFrom(arr, rngFn) {
                return arr[Math.floor(rngFn() * arr.length)];
            },
        },
        daysAgo(n) {
            // returns a tiny date-like object with a format(pattern) method matching moment basics
            const anchor = new Date(baseCtx.anchorDate + "T00:00:00Z");
            const d = new Date(anchor.getTime() - n * 86400000);
            return makeDateLike(d);
        },
        writeNote(opts) {
            return helpers.writeNote(baseCtx, opts);
        },
    };
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function makeDateLike(d) {
    return {
        format(pattern) {
            const yyyy = d.getUTCFullYear();
            const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
            const dd = String(d.getUTCDate()).padStart(2, "0");
            const month = MONTH_NAMES[d.getUTCMonth()];
            return pattern
                .replace(/YYYY/g, yyyy)
                .replace(/MMMM/g, month)
                .replace(/MM/g, mm)
                .replace(/DD/g, dd);
        },
        _date: d,
    };
}

function materializeProgrammatic(mod, baseCtx, blueprint, blueprintRoot, dryRun) {
    if (dryRun) {
        // We can't fully predict output; report that programmatic kind can't dry-run-count.
        return { created: 0, skipped: 0, programmatic_dry_run: true };
    }
    const ctx = makeProgrammaticCtx(baseCtx, blueprint, blueprintRoot);
    const result = mod.seed(ctx);
    return { created: (result && result.notesCreated) || 0, skipped: 0 };
}

module.exports = { loadProgrammaticSeed, materializeProgrammatic, makeProgrammaticCtx, makeDateLike };
