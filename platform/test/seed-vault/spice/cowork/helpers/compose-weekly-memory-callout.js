// platform/blueprints/cowork/helpers/compose-weekly-memory-callout.js
// Pure composer used by weekly-review body composition step.
// Renders Tier 2 weekly synthesis (pattern + carry-forward) when present.

"use strict";

function composeWeeklyMemoryCallout(out) {
    if (!out || !out.found || !out.week_synthesis) return "";
    const ws = out.week_synthesis;
    const pattern = ws.weekly_pattern || "";
    if (!pattern) return "";
    const carry = ws.carry_forward_bullets || [];
    const carryLines = carry.length > 0
        ? carry.map(b => `> - ${b}`).join("\n")
        : "> _(no carry-forward bullets)_";
    return [
        `> [!info]+ This week so far`,
        `> ${pattern.replace(/\n/g, "\n> ")}`,
        `> `,
        `> **Carry-forward to next week:**`,
        carryLines,
        ``
    ].join("\n");
}

module.exports = { composeWeeklyMemoryCallout };
