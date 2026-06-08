/**
 * compose-body-helper.js — v0.92.0
 *
 * Pure body composer for atomic-note orchestrators (morning-briefing,
 * midday-tripwire, eod-review, weekly-review, monthly-review).
 *
 * Takes pre-rendered nav-buttons block, synopsis callout, memory callouts,
 * priority-ordered MCP-kind blocks, engagement-type aspect blocks, and a
 * pre-rendered closing callout. Returns the final body markdown + an array
 * of canonical assertion substrings + a status token.
 *
 * Pure: no I/O, no MCP calls, no clock, no randomness. Deterministic:
 * same input → byte-identical output. Spec lives in
 * Docs/plans/2026-06-05-v0.92.0-body-composer-design.md §4.
 */
"use strict";

const KNOWN_CADENCES = [
    "morning-briefing",
    "midday-tripwire",
    "eod-review",
    "weekly-review",
    "monthly-review",
];

// v0.95.1 — Knob 1 (anti_echo render aspect): the cadences eligible to receive
// the [!question] Outside yesterday's frame callout. weekly-review and
// monthly-review skip — different granularity, "yesterday's frame" doesn't
// translate to weekly/monthly horizons.
const ANTI_ECHO_ELIGIBLE_CADENCES = [
    "morning-briefing",
    "midday-tripwire",
    "eod-review",
];

const KNOWN_CALLOUT_TYPES = [
    "info",
    "tip",
    "quote",
    "note",
    "example",
    "warning",
];

const BLOCK_REQUIRED_FIELDS = ["kind", "callout_type", "title", "body_md"];

function _isNonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
}

function _trimEnd(value) {
    return typeof value === "string" ? value.replace(/[ \t]+$/gm, "").replace(/\s+$/, "") : "";
}

function _validateBlock(block, index, kindLabel) {
    if (block === null || typeof block !== "object" || Array.isArray(block)) {
        return `failed:input:malformed-${kindLabel}:${index}:kind`;
    }
    // Per-field shape checks: kind, callout_type, title must be non-empty strings;
    // body_md must be a string (may be empty).
    if (!_isNonEmptyString(block.kind)) {
        return `failed:input:malformed-${kindLabel}:${index}:kind`;
    }
    if (!_isNonEmptyString(block.callout_type)) {
        return `failed:input:malformed-${kindLabel}:${index}:callout_type`;
    }
    if (!_isNonEmptyString(block.title)) {
        return `failed:input:malformed-${kindLabel}:${index}:title`;
    }
    if (typeof block.body_md !== "string") {
        return `failed:input:malformed-${kindLabel}:${index}:body_md`;
    }
    // Field shape OK — now whitelist callout_type.
    if (!KNOWN_CALLOUT_TYPES.includes(block.callout_type)) {
        return `failed:input:unknown-callout-type:${block.callout_type}:${index}`;
    }
    return null;
}

function _validateInput(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
        return "failed:input:missing-cadence";
    }
    // 1. cadence
    if (!_isNonEmptyString(input.cadence)) {
        return "failed:input:missing-cadence";
    }
    if (!KNOWN_CADENCES.includes(input.cadence)) {
        return `failed:input:unknown-cadence:${input.cadence}`;
    }
    // 2. nav_buttons_block
    if (!_isNonEmptyString(input.nav_buttons_block)) {
        return "failed:input:missing-nav-buttons-block";
    }
    // 3. synopsis_md
    if (!_isNonEmptyString(input.synopsis_md)) {
        return "failed:input:missing-synopsis";
    }
    // 4. closing_md
    if (!_isNonEmptyString(input.closing_md)) {
        return "failed:input:missing-closing";
    }
    // 5. ordered_blocks must be an array, each entry validated in order.
    if (!Array.isArray(input.ordered_blocks)) {
        return "failed:input:malformed-ordered-block:0:kind";
    }
    for (let i = 0; i < input.ordered_blocks.length; i++) {
        const err = _validateBlock(input.ordered_blocks[i], i, "ordered-block");
        if (err) return err;
    }
    // 6. engagement_type_blocks must be an array, each entry validated in order.
    if (!Array.isArray(input.engagement_type_blocks)) {
        return "failed:input:malformed-engagement-type-block:0:kind";
    }
    for (let i = 0; i < input.engagement_type_blocks.length; i++) {
        const err = _validateBlock(input.engagement_type_blocks[i], i, "engagement-type-block");
        if (err) return err;
    }
    return null;
}

function _wrapCallout({ callout_type, title, body_md }) {
    // Strip trailing [ \t]+ on each line; preserve leading whitespace.
    const bodyLines = String(body_md == null ? "" : body_md)
        .split("\n")
        .map((l) => l.replace(/[ \t]+$/, ""));
    // Blank line → bare ">"; non-blank → "> <content>".
    const prefixed = bodyLines.map((l) => (l === "" ? ">" : `> ${l}`));
    const header = `> [!${callout_type}]+ ${title}`;
    return [header, ...prefixed].join("\n");
}

function _composeMemoryCluster(memory_callouts) {
    const mc = memory_callouts || {};
    const parts = [];
    for (const field of ["yesterday_md", "overnight_md", "echoes_md"]) {
        const v = mc[field];
        if (_isNonEmptyString(v)) {
            parts.push(_trimEnd(v));
        }
    }
    return parts.length === 0 ? "" : parts.join("\n\n");
}

function _composeBacklink(memory_callouts) {
    const mc = memory_callouts || {};
    if (_isNonEmptyString(mc.backlink_md)) {
        return _trimEnd(mc.backlink_md);
    }
    return "";
}

function _computeAssertions(input) {
    const assertions = [];
    // 1. nav-buttons opener (canonical dvjs through customjs-guard).
    assertions.push(
        '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });',
    );
    // 2. synopsis first line (after stripping trailing whitespace).
    assertions.push(input.synopsis_md.split("\n")[0].replace(/[ \t]+$/, ""));
    // 3. memory yesterday/overnight/echoes first lines, only when non-empty.
    const mc = input.memory_callouts || {};
    for (const f of ["yesterday_md", "overnight_md", "echoes_md"]) {
        if (typeof mc[f] === "string" && mc[f].trim()) {
            assertions.push(mc[f].split("\n")[0].replace(/[ \t]+$/, ""));
        }
    }
    // 4. per ordered_blocks[i] callout header.
    for (const b of input.ordered_blocks) {
        assertions.push(`> [!${b.callout_type}]+ ${b.title}`);
    }
    // 5. per engagement_type_blocks[i] callout header.
    for (const b of input.engagement_type_blocks) {
        assertions.push(`> [!${b.callout_type}]+ ${b.title}`);
    }
    // 6. closing first line.
    assertions.push(input.closing_md.split("\n")[0].replace(/[ \t]+$/, ""));
    // 7. backlink first line if present (last).
    if (typeof mc.backlink_md === "string" && mc.backlink_md.trim()) {
        assertions.push(mc.backlink_md.split("\n")[0].replace(/[ \t]+$/, ""));
    }
    return assertions;
}

/**
 * v0.95.1 — Knob 1 (anti_echo render aspect).
 *
 * injectAntiEchoCallout(body, excluded_themes, voice_contract)
 *
 * Appends a "> [!question] Outside yesterday's frame" callout to the body. The
 * callout body is an LLM-fill placeholder that names ONE item from today's
 * dispatch which does NOT relate to any of yesterday's carry-forward bullets,
 * or explicitly says "today's gather largely continued yesterday's threads"
 * when nothing qualifies. voice_contract is passed into the prompt so the
 * explicit-null phrasing inherits the engagement's personality at LLM-fill
 * time.
 *
 * Caller is responsible for the cadence-eligibility gate (or, more typically,
 * routes through composeBody which gates via ANTI_ECHO_ELIGIBLE_CADENCES).
 *
 * @param {string} body              - current body string
 * @param {string[]} excluded_themes - non-empty array of carry-forward bullet strings
 * @param {string} voice_contract    - engagement voice contract (may be empty string)
 * @returns {string} body with the callout appended
 */
function injectAntiEchoCallout(body, excluded_themes, voice_contract) {
    const safeBody = typeof body === "string" ? body : "";
    const themes = Array.isArray(excluded_themes) ? excluded_themes.filter((t) => typeof t === "string" && t.trim()) : [];
    if (themes.length === 0) return safeBody;
    const joined = themes.join(" | ");
    const vc = typeof voice_contract === "string" && voice_contract.trim() ? " Apply voice contract." : "";
    const callout = [
        "> [!question] Outside yesterday's frame",
        `> {{LLM-fill: ONE item from today's dispatch that doesn't relate to any of: ${joined}. If nothing qualifies, write 'today's gather largely continued yesterday's threads.'${vc}}}`,
    ].join("\n");
    // Append as its own block, separated by a blank line. Caller controls trailing newline.
    if (safeBody === "") return callout;
    const sep = safeBody.endsWith("\n\n") ? "" : (safeBody.endsWith("\n") ? "\n" : "\n\n");
    return safeBody + sep + callout;
}

function composeBody(input) {
    const validationError = _validateInput(input);
    if (validationError) {
        return { body_md: "", body_assertions: [], status: validationError };
    }

    const {
        cadence,
        nav_buttons_block,
        synopsis_md,
        memory_callouts,
        ordered_blocks,
        engagement_type_blocks,
        closing_md,
        excluded_themes,
        voice_contract,
    } = input;

    const sections = [];
    // 1. nav-buttons block.
    sections.push(_trimEnd(nav_buttons_block));
    // 2. synopsis.
    sections.push(_trimEnd(synopsis_md));
    // 3. memory cluster (yesterday/overnight/echoes), if any non-empty.
    const memoryCluster = _composeMemoryCluster(memory_callouts);
    if (memoryCluster !== "") {
        sections.push(memoryCluster);
    }
    // 4. ordered_blocks (each wrapped as a callout).
    for (const block of ordered_blocks) {
        sections.push(_wrapCallout(block));
    }
    // 5. engagement_type_blocks (each wrapped as a callout).
    for (const block of engagement_type_blocks) {
        sections.push(_wrapCallout(block));
    }
    // 5.5. v0.95.1 Knob 1 — anti-echo callout, gated by cadence eligibility AND
    // a non-empty excluded_themes array (always-present 13th plan-dispatch key).
    if (
        ANTI_ECHO_ELIGIBLE_CADENCES.includes(cadence)
        && Array.isArray(excluded_themes)
        && excluded_themes.filter((t) => typeof t === "string" && t.trim()).length > 0
    ) {
        sections.push(injectAntiEchoCallout("", excluded_themes, voice_contract));
    }
    // 6. closing.
    sections.push(_trimEnd(closing_md));
    // 7. backlink (last, if present).
    const backlink = _composeBacklink(memory_callouts);
    if (backlink !== "") {
        sections.push(backlink);
    }

    const body_md = sections.join("\n\n") + "\n";
    const body_assertions = _computeAssertions(input);

    return { body_md, body_assertions, status: "ok" };
}

module.exports = {
    composeBody,
    injectAntiEchoCallout,
    ANTI_ECHO_ELIGIBLE_CADENCES,
    _validateInput,
    _wrapCallout,
    _composeMemoryCluster,
    _composeBacklink,
    _computeAssertions,
};
