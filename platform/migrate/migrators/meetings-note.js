// platform/migrate/migrators/meetings-note.js — v0.28.0 S1 SKELETON.
//
// Migrates `Timestamps/Meetings/<YYYY-MM-DD> <title>.md` →
// `spice/meetings/notes/<YYYY>/<MM-MMMM>/<title>-<YYYY-MM-DD>.md`
// (folder gains date-routing; spaces in title preserved). Per Sauce
// meetings@0.3.0 (v0.27.0 pilot integration). Prepend `## Attendees`
// chip dataviewjs block above existing bullet list. Drop legacy
// `tags: [[🗣 Meetings MOC]]` line + `Date: [[...]]` body line.
// Preserve frontmatter (incl `person/X` tags), agenda/notes/action items.
//
// Honors LITERAL contract from S1.4 step 1 of the implementation plan.
// Implementation lands in S2 T2.3 (parallel implementer subagent C).

module.exports = {
    name: "meetings-note",
    priority: 30,
    canHandle(_srcRelPath, _srcStat) {
        throw new Error("NotImplemented: meetings-note.canHandle (S1 skeleton)");
    },
    plan(_srcRelPath, _srcAbsPath, _ctx) {
        throw new Error("NotImplemented: meetings-note.plan (S1 skeleton)");
    },
    migrate(_planEntry, _srcAbsPath, _tgtRoot, _ctx) {
        throw new Error("NotImplemented: meetings-note.migrate (S1 skeleton)");
    }
};
