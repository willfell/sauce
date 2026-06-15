// platform/blueprints/cowork/helpers/compose-midam-memory-callout.js
// Pure composer used by midday-tripwire body composition step.
// Renders the last 4 ticks (since morning-briefing) as an Earlier today callout.

"use strict";

function composeMidamMemoryCallout(out) {
    if (!out || !out.found || !out.ticks || out.ticks.length === 0) {
        return "";
    }
    const tickLines = out.ticks
        .slice()
        .reverse()
        .map(t => `> - ${t.time} — ${t.summary_line}`)
        .join("\n");
    return [
        `> [!example]+ Earlier today`,
        tickLines,
        ``
    ].join("\n");
}

module.exports = { composeMidamMemoryCallout };
