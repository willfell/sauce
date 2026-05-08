// platform/migrate/migrators/to-do.js — v0.28.0 S1 SKELETON.
//
// Migrates `Timestamps/ToDo/<YYYY-MM-DD>-ToDo.md` →
// `spice/to-do/<YYYY>/<MM-MMMM>/ToDo-<YYYY-MM-DD>.md` (folder gains
// date-routing). Per Sauce to-do@0.1.4. Filename rewrite prefix→suffix.
// Regenerate "Back to Daily Note" dataviewjs button (legacy hardcoded
// paths replaced via Sauce to-do template). Preserve `## Today's Tasks`
// checkbox list verbatim.
//
// Honors LITERAL contract from S1.4 step 1 of the implementation plan.
// Implementation lands in S2 T2.5 (parallel implementer subagent E).

module.exports = {
    name: "to-do",
    priority: 50,
    canHandle(_srcRelPath, _srcStat) {
        throw new Error("NotImplemented: to-do.canHandle (S1 skeleton)");
    },
    plan(_srcRelPath, _srcAbsPath, _ctx) {
        throw new Error("NotImplemented: to-do.plan (S1 skeleton)");
    },
    migrate(_planEntry, _srcAbsPath, _tgtRoot, _ctx) {
        throw new Error("NotImplemented: to-do.migrate (S1 skeleton)");
    }
};
