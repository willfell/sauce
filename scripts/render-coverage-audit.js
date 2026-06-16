#!/usr/bin/env node
// scripts/render-coverage-audit.js
// Reads platform/test/coverage-matrix.json, writes Docs/plans/2026-06-16-test-coverage-audit.md.

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const IN = path.join(REPO_ROOT, "platform", "test", "coverage-matrix.json");
const OUT = path.join(REPO_ROOT, "Docs", "plans", "2026-06-16-test-coverage-audit.md");

function fmt(n) { return n === null || n === undefined ? "—" : n.toFixed(2); }

function renderAxisCell(axis) {
    if (axis.score === null) return "n/a";
    const covered = axis.covered ?? "";
    const total = axis.total ?? "";
    if (typeof covered === "number" && typeof total === "number") {
        return `${fmt(axis.score)} (${covered}/${total})`;
    }
    return fmt(axis.score);
}

function main() {
    const m = JSON.parse(fs.readFileSync(IN, "utf8"));
    const lines = [];
    lines.push("---");
    lines.push("arc: test-coverage-arc");
    lines.push("phase: audit");
    lines.push(`generated_against_workshop_version: ${m.generated_at}`);
    lines.push(`rubric_version: ${m.rubric_version}`);
    lines.push("---");
    lines.push("");
    lines.push("# Test coverage audit");
    lines.push("");
    lines.push("Coverage matrix for all blueprints + mechanisms scored against the 6-axis rubric in `Docs/plans/2026-06-16-test-coverage-arc-design.md`. Ranked queue at the bottom drives impl-1/2/3 selection.");
    lines.push("");
    lines.push("## Composite scorecard");
    lines.push("");
    lines.push("| Kind | Name | v | CustomJS | Migration | Manifest+Schema | Template | Widget | Smoke | Composite | Blast | Incidents 30d | Priority |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const e of m.entries) {
        lines.push([
            "", e.kind, e.name, e.current_version || "",
            renderAxisCell(e.axes.customjs_behavioral),
            renderAxisCell(e.axes.installer_migration),
            renderAxisCell(e.axes.manifest_schema),
            renderAxisCell(e.axes.template_lockstep),
            renderAxisCell(e.axes.widget_render),
            renderAxisCell(e.axes.integration_smoke),
            fmt(e.composite_score),
            e.blast_radius,
            e.recent_incidents_30d,
            fmt(e.priority_score),
            ""
        ].join(" | "));
    }
    lines.push("");
    lines.push("## Per-surface deep dive");
    lines.push("");
    for (const e of m.entries) {
        lines.push(`### ${e.kind}/${e.name} (v${e.current_version || "?"})`);
        lines.push(`- Blast radius: **${e.blast_radius}** — ${e.blast_radius_rationale}`);
        lines.push(`- Composite: **${fmt(e.composite_score)}** · Priority: **${fmt(e.priority_score)}** · Incidents 30d: ${e.recent_incidents_30d}`);
        if (e.qualitative) {
            lines.push(`- Primary flow (Axis 6 grounding): ${e.qualitative.primary_user_flow || "—"}`);
            lines.push(`- Qualitative recommendation: ${e.qualitative.qualitative_recommendation || e.qualitative.recommendation || "—"}`);
            if ((e.qualitative.false_positives || []).length > 0) {
                lines.push(`- False positives: ${e.qualitative.false_positives.map(f => `${f.axis}: ${f.note}`).join("; ")}`);
            }
            if ((e.qualitative.false_negatives || []).length > 0) {
                lines.push(`- False negatives: ${e.qualitative.false_negatives.map(f => `${f.axis}: ${f.note}`).join("; ")}`);
            }
        }
        if (e.top_gap) {
            lines.push(`- Top gap: axis=\`${e.top_gap.axis}\` archetype=\`${e.top_gap.archetype}\` target=\`${e.top_gap.target_file}\``);
        }
        lines.push("");
    }
    lines.push("## Ranked queue (top 10)");
    lines.push("");
    lines.push("| Rank | Surface | Axis | Archetype | Target file | Priority |");
    lines.push("|---|---|---|---|---|---|");
    for (let i = 0; i < Math.min(10, m.entries.length); i++) {
        const e = m.entries[i];
        if (!e.top_gap) continue;
        lines.push(`| ${i+1} | ${e.kind}/${e.name} | ${e.top_gap.axis} | ${e.top_gap.archetype} | ${e.top_gap.target_file} | ${fmt(e.priority_score)} |`);
    }
    lines.push("");
    lines.push("## Picks for this arc");
    lines.push("");
    lines.push("- **impl-1**: rank-1 above");
    lines.push("- **impl-2**: rank-2 above");
    lines.push("- **impl-3**: rank-3 above");
    lines.push("");
    lines.push("If two ranks above belong to the same blueprint, impl-2 = next distinct blueprint OR next gap on the same blueprint when the design's `out of scope` allows — pick whichever maximizes total composite lift.");
    lines.push("");
    fs.writeFileSync(OUT, lines.join("\n"));
    console.log(`Wrote ${OUT}`);
}

main();
