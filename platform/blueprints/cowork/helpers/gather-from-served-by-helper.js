/* eslint-disable no-console */
/**
 * gather-from-served-by-helper.js — v0.78.0
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
 */
"use strict";

function gatherFromServedBy(input) {
    const {
        kind_name, kind_title, served_by, what_matters,
        question_set_answers, today, range, timezone,
        dry_run_answers,
    } = input || {};
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
    const expectedPrefix = `> [!example]+ ${kind_title}\n`;
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
    };
}

module.exports = {
    gatherFromServedBy,
};
