// platform/migrate/migrators/trips.js — v0.28.0 S5 CF-9.
//
// Path-translation migrator: relocates Accuris/Ero/Headspace trip content
// from `[Bb]oards/trips/<slug>/<rest>` → `spice/trips/<slug>/<rest>` per
// Sauce trips@0.1.5 module-directory invariant (landmine #11). Body
// identity (legacy path strings rewritten in phase 4.5).
//
// Source examples (Headspace):
//   boards/trips/Trips.md                   → spice/trips/Trips.md
//   boards/trips/mammoth/Mammoth.md         → spice/trips/mammoth/Mammoth.md
//   boards/trips/<slug>/<sub-dir>/<file>.md → spice/trips/<slug>/<sub-dir>/<file>.md
//
// Priority 55 — runs BEFORE boards (60) so boards/trips/ doesn't get
// scooped into spice/boards/trips/ by the boards-migrator.

const fs = require("fs");
const path = require("path");

const SRC_RE = /^[Bb]oards\/trips\/(.+)$/;

function _validateRel(p) {
    const segs = p.replace(/\\/g, "/").split("/");
    if (segs.some(s => s === "..")) {
        throw new Error(`trips migrator refused path-traversal segment: ${p}`);
    }
}

function _atomicWrite(absPath, body) {
    const tmp = absPath + ".tmp-" + process.pid + "-" + Date.now();
    fs.writeFileSync(tmp, body, "utf8");
    fs.renameSync(tmp, absPath);
}

module.exports = {
    name: "trips",
    priority: 55,
    canHandle(srcRelPath, srcStat) {
        if (srcStat && typeof srcStat.isDirectory === "function" && srcStat.isDirectory()) return false;
        const norm = srcRelPath.replace(/\\/g, "/");
        if (!norm.endsWith(".md")) return false;
        return SRC_RE.test(norm);
    },
    plan(srcRelPath, _srcAbsPath, _ctx) {
        _validateRel(srcRelPath);
        const norm = srcRelPath.replace(/\\/g, "/");
        const m = norm.match(SRC_RE);
        if (!m) {
            return {
                action: "skip",
                src: srcRelPath,
                tgt: null,
                warnings: [`trips.plan: srcRelPath did not match [Bb]oards/trips/<rest>: ${srcRelPath}`],
                rewrite_summary: ""
            };
        }
        const [, rest] = m;
        const tgt = `spice/trips/${rest}`;
        return {
            action: "rewrite_blueprint",
            src: srcRelPath,
            tgt,
            warnings: [],
            rewrite_summary: { migrator: "trips", body_regenerated: false, path_only: true }
        };
    },
    migrate(planEntry, srcAbsPath, tgtRoot, _ctx) {
        _validateRel(planEntry.src);
        _validateRel(planEntry.tgt);
        const body = fs.readFileSync(srcAbsPath, "utf8");
        const dst = path.join(tgtRoot, planEntry.tgt);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        _atomicWrite(dst, body);
    }
};
