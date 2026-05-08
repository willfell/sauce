// platform/migrate/verbatim.js — v0.28.0 S1 SKELETON.
//
// Priority-9999 fallback migrator: claims any path no per-blueprint
// migrator owns; emits action: "copy_verbatim" with tgt = src; migrate
// performs cp + mtime preservation + parent dir creation.
//
// Honors LITERAL contract from S1.4 step 1 of the implementation plan.
// Implementation lands in S2 T2.6 (sequential, master-driven).

module.exports = {
    name: "verbatim",
    priority: 9999,
    canHandle(_srcRelPath, _srcStat) {
        // verbatim claims everything not owned by a higher-priority migrator
        return true;
    },
    plan(_srcRelPath, _srcAbsPath, _ctx) {
        throw new Error("NotImplemented: verbatim.plan (S1 skeleton)");
    },
    migrate(_planEntry, _srcAbsPath, _tgtRoot, _ctx) {
        throw new Error("NotImplemented: verbatim.migrate (S1 skeleton)");
    }
};
