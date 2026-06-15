// platform/blueprints/cowork/helpers/compose-memory-callouts.js
// Pure composer used by morning-briefing's body composition step.
// Byte-identical to v0.84.0 hand-composed prose for the same memory.md input.
// Future cycles (v0.86+ wire-through) will add per-orchestrator compose helpers
// alongside this one (composeMidamMemoryCallout, composeEodMemoryCallout, etc.).

"use strict";

function composeMemoryCallouts(outputYesterday, outputOvernight) {
    return {
        yesterdayCalloutMd: composeYesterdayCallout(outputYesterday),
        overnightCalloutMd: composeOvernightCallout(outputOvernight)
    };
}

function composeYesterdayCallout(out) {
    if (!out || !out.found || !out.day_synthesis || !out.day_synthesis.synthesized) {
        return "";
    }
    const dayS = out.day_synthesis;
    const carryFwd = dayS.carry_forward_bullets || [];
    const synthesis = dayS.synthesis_paragraph || "";
    const compressed = compressSynthesisToLines(synthesis, 3);
    const carryLines = carryFwd.length > 0
        ? carryFwd.map(b => `> - ${b}`).join("\n")
        : "> _(no carry-forward bullets)_";
    return [
        `> [!example]+ Yesterday at a glance`,
        carryLines,
        `> `,
        `> ${compressed}`,
        ``
    ].join("\n");
}

function composeOvernightCallout(out) {
    if (!out || !out.found || !out.ticks || out.ticks.length === 0) {
        return "";
    }
    // ticks come most-recent-first from read-memory; v0.84.0 rendered oldest-first
    const tickLines = out.ticks
        .slice()
        .reverse()
        .map(t => `> - ${t.time} — ${t.summary_line}`)
        .join("\n");
    return [
        `> [!example]+ Overnight`,
        tickLines,
        ``
    ].join("\n");
}

function compressSynthesisToLines(text, maxSentences) {
    if (!text) return "";
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed) return "";
    const sentences = trimmed.split(/(?<=[.!?])\s+/);
    return sentences.slice(0, Math.max(1, maxSentences)).join(" ").trim();
}

module.exports = {
    composeMemoryCallouts,
    composeYesterdayCallout,
    composeOvernightCallout,
    compressSynthesisToLines
};
