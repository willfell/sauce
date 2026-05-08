// platform/migrate/verbatim.js — v0.28.0 S2 (T2.6b).
//
// Priority-9999 fallback migrator. Claims any path no per-blueprint
// migrator owns; emits action: "copy_verbatim" with tgt = src; migrate
// performs cp + mtime preservation + parent dir creation.

const fs = require("fs");
const path = require("path");

function _validateRel(p) {
    const segs = p.replace(/\\/g, "/").split("/");
    if (segs.some(s => s === "..")) {
        throw new Error(`verbatim migrator refused path-traversal segment: ${p}`);
    }
}

module.exports = {
    name: "verbatim",
    priority: 9999,
    canHandle(_srcRelPath, _srcStat) {
        return true;
    },
    plan(srcRelPath, _srcAbsPath, _ctx) {
        _validateRel(srcRelPath);
        return {
            action: "copy_verbatim",
            src: srcRelPath,
            tgt: srcRelPath,
            warnings: [],
            rewrite_summary: { migrator: "verbatim" }
        };
    },
    migrate(planEntry, srcAbsPath, tgtRoot, _ctx) {
        _validateRel(planEntry.src);
        _validateRel(planEntry.tgt);
        const dst = path.join(tgtRoot, planEntry.tgt);
        const dstResolved = path.resolve(dst);
        const rootResolved = path.resolve(tgtRoot);
        if (!dstResolved.startsWith(rootResolved + path.sep) && dstResolved !== rootResolved) {
            throw new Error(`verbatim.migrate: target ${dstResolved} escapes root ${rootResolved}`);
        }
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(srcAbsPath, dst);
        try {
            const st = fs.statSync(srcAbsPath);
            fs.utimesSync(dst, st.atime, st.mtime);
        } catch (_e) { /* mtime preservation is best-effort */ }
    }
};
