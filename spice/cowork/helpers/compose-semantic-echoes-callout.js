// platform/blueprints/cowork/helpers/compose-semantic-echoes-callout.js
// Pure composer used by morning-briefing's body composition step.
// Renders an "Echoes from your record" callout listing semantic-retrieval
// matches surfaced by cowork:gather-semantic-memory.

"use strict";

function composeSemanticEchoesCallout(gatherOutput) {
    if (!gatherOutput || !gatherOutput.found) return "";
    const matches = Array.isArray(gatherOutput.matches) ? gatherOutput.matches : [];
    if (matches.length === 0) return "";
    const lines = matches
        .filter(m => m && (m.day_or_week || m.path))
        .map(m => {
            const label = m.day_or_week || "(match)";
            const sim = typeof m.similarity_score === "number"
                ? m.similarity_score.toFixed(2)
                : "?.??";
            const excerpt = (m.synthesis_excerpt || "").replace(/\n+/g, " ").trim();
            return `> - **${label}** (similarity ${sim}) — _"${excerpt}"_`;
        });
    if (lines.length === 0) return "";
    return [
        `> [!quote]+ Echoes from your record`,
        `> Patterns from your past that resemble today's signal:`,
        ...lines,
        ``
    ].join("\n");
}

module.exports = { composeSemanticEchoesCallout };
