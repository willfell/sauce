// platform/migrate/migrators/daily.js — v0.28.0 S1 SKELETON.
//
// Migrates `Timestamps/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>-<Day>.md` →
// `spice/daily/<YYYY>/<MM-MMMM>/<Day>-<YYYY-MM-DD>.md` per Sauce
// daily@0.2.3. Filename rewrite prefix→suffix. Frontmatter preserved
// (created/tags/cssclasses). Regenerate top dataviewjs blocks
// (SpaceNavButtons + SpaceDailyDashboard); preserve Morning Briefing
// callout + free-form notes below dashboard markers.
//
// Honors LITERAL contract from S1.4 step 1 of the implementation plan.
// Implementation lands in S2 T2.2 (parallel implementer subagent B).

module.exports = {
    name: "daily",
    priority: 20,
    canHandle(_srcRelPath, _srcStat) {
        throw new Error("NotImplemented: daily.canHandle (S1 skeleton)");
    },
    plan(_srcRelPath, _srcAbsPath, _ctx) {
        throw new Error("NotImplemented: daily.plan (S1 skeleton)");
    },
    migrate(_planEntry, _srcAbsPath, _tgtRoot, _ctx) {
        throw new Error("NotImplemented: daily.migrate (S1 skeleton)");
    }
};
