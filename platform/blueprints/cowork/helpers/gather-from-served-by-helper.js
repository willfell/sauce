/* eslint-disable no-console */
/**
 * gather-from-served-by-helper.js — v0.89.1 (sauce)
 *
 * Dry-run-mode-only helper for gather-from-served-by. The production gather
 * path is agent-driven (orchestrator's executing agent invokes MCP tools
 * directly per the SKILL.md's Steps). This helper exposes a deterministic
 * dry-run path so harness cases can validate the gather contract without
 * an MCP session.
 *
 * In dry-run, the caller supplies:
 *   available_tools[]   the agent's tool list (would be enumerated at runtime)
 *   agent_markdown      the markdown the agent would have composed
 *   tools_used[]        the tools the agent would report having called
 *
 * The helper enforces the output contract:
 *   - if available_tools has zero mcp__<served_by>__* entries → skipped:no-tools
 *   - if agent_markdown is null/empty when tools are present → failed:bad-output
 *   - markdown MUST start with `> [!example]+ <kind_title>\n` → else bad-output
 *
 * v0.89.1 (sauce v0.89.1): accept + shape-validate inner_circle_resolved
 * (resolve-time inner-circle allowlist) and engagement_id; echo
 * inner_circle_resolved_count on success return. Production-mode injection
 * of the allowlist into the dispatch contract is described in SKILL.md
 * "Known people in scope" section.
 */
"use strict";

function gatherFromServedBy(input) {
    const {
        kind_name, kind_title, served_by, what_matters,
        question_set_answers, today, range, timezone, hard_rules, siblings,
        callout_type: callout_type_input,
        inner_circle_resolved, engagement_id,
        dry_run_answers,
    } = input || {};
    const VALID = new Set(["info","note","tip","success","warning","caution","example","quote","danger"]);
    const coerced = (callout_type_input && String(callout_type_input).toLowerCase().trim()) || "";
    const callout_type = (coerced && VALID.has(coerced)) ? coerced : "example";

    // v0.89.1: validate inner_circle_resolved shape; drop malformed entries silently.
    const validatedInnerCircle = [];
    if (Array.isArray(inner_circle_resolved)) {
        for (const entry of inner_circle_resolved) {
            if (entry && typeof entry === "object"
                && typeof entry.name === "string" && entry.name
                && typeof entry.person_link === "string" && entry.person_link) {
                validatedInnerCircle.push(entry);
            }
        }
    }
    // engagement_id: string when present; ignored otherwise (reserved field, no-op).
    void engagement_id;

    if (!kind_name || !kind_title || !served_by) {
        return { status: "failed:bad-input", reason: "kind_name, kind_title, served_by required" };
    }

    // In production, the orchestrator's agent enumerates its tool list and
    // calls MCP tools directly. In dry-run, the harness pre-supplies the
    // agent's observed/produced values.
    if (!dry_run_answers) {
        return { status: "failed:no-dry-run-and-no-agent", reason: "production mode requires agent dispatch — see SKILL.md Steps section" };
    }
    const available = (dry_run_answers.available_tools || []).filter(t => {
        if (typeof t !== "string") return false;
        return t.startsWith(`mcp__${served_by}__`);
    });
    if (available.length === 0) {
        return {
            status: "skipped:no-tools",
            reason: "served_by namespace exposes no tools in this session",
            served_by_used: served_by,
            tools_used: [],
        };
    }

    const md = dry_run_answers.agent_markdown;
    if (!md || typeof md !== "string" || md.length < 80) {
        return {
            status: "failed:bad-output",
            reason: "agent_markdown empty or below 80-char floor",
            served_by_used: served_by,
            tools_used: [],
        };
    }
    const expectedPrefix = `> [!${callout_type}]+ ${kind_title}\n`;
    if (!md.startsWith(expectedPrefix)) {
        return {
            status: "failed:bad-output",
            reason: `markdown does not start with "${expectedPrefix.trim()}"`,
            served_by_used: served_by,
            tools_used: [],
        };
    }
    if (/^```/m.test(md)) {
        return {
            status: "failed:bad-output",
            reason: "markdown contains top-level triple-backtick (breaks callout integrity)",
            served_by_used: served_by,
            tools_used: [],
        };
    }

    return {
        status: "ready",
        markdown: md,
        served_by_used: served_by,
        tools_used: dry_run_answers.tools_used || [],
        hard_rules_applied: Array.isArray(hard_rules) ? hard_rules : [],
        siblings_used: Array.isArray(siblings) ? siblings.map(s => s && s.name).filter(Boolean) : [],
        callout_type_used: callout_type,
        inner_circle_resolved_count: validatedInnerCircle.length,
    };
}

module.exports = {
    gatherFromServedBy,
};
