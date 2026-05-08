// platform/migrate/dispatcher.js — v0.28.0 S1 SKELETON.
//
// Walks source recursively; routes per file to the highest-priority
// migrator whose canHandle returns true; emits planEntries[]; either
// writes migration-plan.json (dry-run default) OR delegates to commit.js
// (--commit flow).
//
// Implementation lands in S2 T2.6 (master-driven sequential).

exports.run = async function(_opts) {
    throw new Error("NotImplemented: dispatcher.run (S1 skeleton)");
};
