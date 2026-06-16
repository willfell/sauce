// platform/blueprints/cowork/helpers/compose-eod-memory-callout.js
// Pure composer used by eod-review body composition step.
// Renders full-day tick log + (optional) day-synthesis pattern callout.

"use strict";

function composeEodMemoryCallout(outputTicks, outputDay) {
    return {
        tickLogCalloutMd: composeTickLogCallout(outputTicks),
        dayPatternCalloutMd: composeDayPatternCallout(outputDay)
    };
}

function composeTickLogCallout(out) {
    if (!out || !out.found || !out.ticks || out.ticks.length === 0) return "";
    const tickLines = out.ticks
        .slice()
        .reverse()
        .map(t => `> - ${t.time} — ${t.summary_line}`)
        .join("\n");
    return [`> [!example]+ Today's tick log`, tickLines, ``].join("\n");
}

function composeDayPatternCallout(out) {
    if (!out || !out.found || !out.day_synthesis || !out.day_synthesis.synthesized) return "";
    const dayS = out.day_synthesis;
    const synthesis = dayS.synthesis_paragraph || "";
    if (!synthesis) return "";
    return [`> [!info]+ Today's pattern`, `> ${synthesis.replace(/\n/g, "\n> ")}`, ``].join("\n");
}

module.exports = { composeEodMemoryCallout, composeTickLogCallout, composeDayPatternCallout };
