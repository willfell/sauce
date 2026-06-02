// platform/blueprints/cowork/helpers/compose-monthly-memory-callout.js
// Pure composer used by monthly-review body composition step.
// Aggregates up to 4 weekly syntheses across the month.

"use strict";

function composeMonthlyMemoryCallout(out) {
    // outputMonth is read-memory with tier:week + window:{start,end}; returns aggregated weekly records.
    // Expected shape: { found, week_syntheses: [{ iso_week, summary, weekly_pattern, ... }, ...] }
    // OR (fallback) a single week_synthesis if read-memory only returns one.
    if (!out || !out.found) return "";
    const weeks = Array.isArray(out.week_syntheses)
        ? out.week_syntheses
        : (out.week_synthesis ? [out.week_synthesis] : []);
    if (weeks.length === 0) return "";
    const weekLines = weeks
        .filter(w => w && (w.summary || w.weekly_pattern))
        .map(w => {
            const label = w.iso_week || w.summary || "(week)";
            const summary = w.summary || (w.weekly_pattern || "").split(/\n/)[0] || "";
            return `> - **${label}** — ${summary}`;
        })
        .join("\n");
    if (!weekLines) return "";
    return [
        `> [!info]+ This month's pattern`,
        weekLines,
        ``
    ].join("\n");
}

module.exports = { composeMonthlyMemoryCallout };
