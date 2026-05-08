// platform/migrate/migrators/people.js — v0.28.0 S1 SKELETON.
//
// Migrates Accuris/Ero/Headspace `Extras/People/<Name>.md` (Headspace:
// `Resources/People/<Name>.md`) → `spice/people/<Name>.md` per Sauce
// people@0.1.0 schema. Identity copy of frontmatter (drop empty aliases
// + missing phone); regenerate `# [[Name]]` heading + `## Meetings`
// dataviewjs block; preserve `## Notes` content verbatim.
//
// Honors LITERAL contract from S1.4 step 1 of the implementation plan.
// Implementation lands in S2 T2.1 (parallel implementer subagent A).

module.exports = {
    name: "people",
    priority: 10,
    canHandle(_srcRelPath, _srcStat) {
        throw new Error("NotImplemented: people.canHandle (S1 skeleton)");
    },
    plan(_srcRelPath, _srcAbsPath, _ctx) {
        throw new Error("NotImplemented: people.plan (S1 skeleton)");
    },
    migrate(_planEntry, _srcAbsPath, _tgtRoot, _ctx) {
        throw new Error("NotImplemented: people.migrate (S1 skeleton)");
    }
};
