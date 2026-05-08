// platform/migrate/commit.js — v0.28.0 S1 SKELETON.
//
// 5-phase --commit orchestrator (precheck → backup → bootstrap → carry →
// rewrite-blueprints → wikilink-rewrite → finalize). Failure-loud with
// abort + restore-from-backup on phase 2-4 errors. Backup sibling at
// <vault>.pre-migration-<YYYYMMDD-HHMMSS>/.
//
// Public API:
//   commit(planEntries, ctx) → exitCode
//   restoreFromBackup(vaultDir, backupDir) → void  (also exposed for harness)
//
// Implementation lands in S2 T2.7 (master-driven sequential; depends on T2.6).

exports.commit = function(_planEntries, _ctx) {
    throw new Error("NotImplemented: commit.commit (S1 skeleton)");
};

exports.restoreFromBackup = function(_vaultDir, _backupDir) {
    throw new Error("NotImplemented: commit.restoreFromBackup (S1 skeleton)");
};
