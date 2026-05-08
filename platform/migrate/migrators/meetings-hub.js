// platform/migrate/migrators/meetings-hub.js — v0.28.0 S1 SKELETON.
//
// Migrates `Timestamps/MeetingHubs/<YYYY-MM-DD>-Meetings.md` →
// `spice/meetings/hubs/<YYYY>/<MM-MMMM>/Meetings-<YYYY-MM-DD>.md`
// (folder gains date-routing). Per Sauce meetings@0.3.0 hub template.
// Body 100% regenerate (hubs are pure platform; legacy "Daily Navigation
// Footer" + hardcoded paths replaced by current Sauce hub body).
// Preserve frontmatter (created/daily_note/tags/cssclasses).
//
// Honors LITERAL contract from S1.4 step 1 of the implementation plan.
// Implementation lands in S2 T2.4 (parallel implementer subagent D).

module.exports = {
    name: "meetings-hub",
    priority: 40,
    canHandle(_srcRelPath, _srcStat) {
        throw new Error("NotImplemented: meetings-hub.canHandle (S1 skeleton)");
    },
    plan(_srcRelPath, _srcAbsPath, _ctx) {
        throw new Error("NotImplemented: meetings-hub.plan (S1 skeleton)");
    },
    migrate(_planEntry, _srcAbsPath, _tgtRoot, _ctx) {
        throw new Error("NotImplemented: meetings-hub.migrate (S1 skeleton)");
    }
};
