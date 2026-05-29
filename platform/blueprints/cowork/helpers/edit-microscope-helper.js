/* eslint-disable no-console */
/**
 * edit-microscope-helper.js — v0.79.0
 *
 * Pure helpers backing cowork:edit-microscope. No MCP calls, no fs, no stdout.
 *   resolveKind        — validate a requested kind against the prefs kind list
 *   classifyGap        — label a discovered data gap with a resolution path
 *   composeMicroscope  — render/refine spice/cowork/prompts/per-mcp/<kind>/microscope.md
 *
 * The interactive discovery loop (tool enumeration, consent-gated sampling,
 * one-question-at-a-time brainstorming) lives in SKILL.md; this helper renders
 * the artifact deterministically so harness cases can validate it.
 */
"use strict";

// Tool-name signals that a number→name (or similar identity) gap is resolvable
// inside the gather by calling an additional tool the MCP already exposes.
const RESOLVING_TOOL_SIGNALS = [/search_contacts/i, /get_contact/i, /resolve/i, /lookup/i];
// Tool-name signals that the MCP can read message/record CONTENT.
const CONTENT_TOOL_SIGNALS = [/read_/i, /get_message/i, /list_messages/i, /get_thread/i, /get_chat/i];

function resolveKind({ requested, kinds }) {
    const list = Array.isArray(kinds) ? kinds : [];
    if (requested && list.includes(requested)) return { kind: requested, status: "ok" };
    if (requested && !list.includes(requested)) return { kind: null, status: "unclassified", reason: `kind "${requested}" not in user-preferences.md; run /cowork preferences first` };
    return { kind: null, status: "ask", reason: "no kind supplied; ask the user which kind", choices: list };
}

function classifyGap({ gap, tools }) {
    const t = Array.isArray(tools) ? tools : [];
    const hasResolver = t.some(name => RESOLVING_TOOL_SIGNALS.some(rx => rx.test(name)));
    const hasContent = t.some(name => CONTENT_TOOL_SIGNALS.some(rx => rx.test(name)));
    if (hasResolver) return { gap, resolution: "resolvable-in-gather", note: "instruct the gather to call the resolving tool before summarizing" };
    if (!hasContent) return { gap, resolution: "mcp-ceiling", note: "the MCP cannot expose this; recommend evaluating a richer MCP" };
    return { gap, resolution: "user-supplied", note: "maintain a sibling file (e.g. contacts-map.md) the gather reads" };
}

function composeMicroscope({ kind_name, existing, notes, answers, tools, gaps }) {
    const a = answers || {};
    const toolList = Array.isArray(tools) ? tools : [];
    const gapList = Array.isArray(gaps) ? gaps : [];
    const whatMatters = (a.what_matters || "").trim();
    const seedNote = (notes || "").trim();

    const sections = [];
    sections.push(`<!-- USER-OWNED microscope contract for kind "${kind_name}". Authored by cowork:edit-microscope. Never overwritten by sauce update/reinstall. -->`);
    sections.push("");
    sections.push("## What matters");
    if (whatMatters) sections.push(whatMatters);
    if (seedNote) {
        sections.push("");
        sections.push(`_Baseline (seeded from prior preferences): ${seedNote}_`);
    }
    sections.push("");
    sections.push("## Tools & how to use them");
    if (toolList.length) for (const t of toolList) sections.push(`- ${t}`);
    else sections.push("- (enumerate at gather time from the served_by namespace)");
    sections.push("");
    sections.push("## Gaps & handling");
    if (gapList.length) {
        for (const g of gapList) {
            const c = classifyGap({ gap: g, tools: toolList });
            sections.push(`- **${g}** → ${c.resolution}: ${c.note}`);
        }
    } else {
        sections.push("- (none recorded yet)");
    }
    sections.push("");
    sections.push("## Output shape");
    sections.push(a.output_shape ? String(a.output_shape).trim() : "Bulleted, grounded, scannable. Lead with what changed since last run.");

    const rendered = sections.join("\n") + "\n";

    if (existing && String(existing).trim()) {
        // Deepen: preserve prior content, append a dated refinement block with the new material.
        return String(existing).replace(/\s*$/, "") +
            "\n\n<!-- v0.79.0 deepen pass -->\n" +
            (whatMatters ? `## What matters (added)\n${whatMatters}\n` : "") +
            (a.output_shape ? `\n## Output shape (updated)\n${String(a.output_shape).trim()}\n` : "");
    }
    return rendered;
}

module.exports = { resolveKind, classifyGap, composeMicroscope };
