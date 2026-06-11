/**
 * compose-body-helper.js — v0.92.0
 *
 * Pure body composer for atomic-note orchestrators (morning-briefing,
 * midday-tripwire, eod-review, weekly-review, monthly-review).
 *
 * Takes pre-rendered nav-buttons block, synopsis callout, memory callouts,
 * priority-ordered MCP-kind blocks, engagement-type aspect blocks, and a
 * pre-rendered closing callout. Returns the final body markdown + a v1.0.0
 * sidecar payload object (Rail W, v0.96.0 S1.6) + a status token.
 *
 * v0.96.0 S1.6 retires the v0.91.x–v0.92.0 `body_assertions[]` field; the
 * downstream write-atomic-note-helper validates `sidecar_json` against
 * `data/schemas/<cadence>@1.0.0.json` (draft-07) BEFORE write commits.
 *
 * Pure: no I/O, no MCP calls, no clock, no randomness. Deterministic:
 * same input → byte-identical output. Spec lives in
 * Docs/plans/2026-06-05-v0.92.0-body-composer-design.md §4.
 */
"use strict";

const { _itemId } = require("./compose-feedback-capture-helper.js");

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

// v0.98.1: kinds that should NOT receive ^item-<kind>-<7hex> block-ID anchors.
// Memory log, semantic echoes, and untyped blocks are excluded — their body_md
// is either prose (no discrete items) or a quote/echo cluster (not surfaced items).
const SKIP_ITEM_ID_KINDS = new Set(["memory_log", "semantic_echoes", "semantic", ""]);
function _shouldEmitItemId(block) {
    if (!block || !block.kind) return false;
    if (SKIP_ITEM_ID_KINDS.has(block.kind)) return false;
    if (block.callout_type === "[!quote]") return false;
    return true;
}

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
    // 4. closing_md — REMOVED in v0.98.0 (synopsis carries the action signal).
    // The orchestrator no longer composes a `[!tip] <closing>` callout; the
    // helper accepts inputs without a `closing_md` key and emits no closing
    // section. Inputs with a legacy `closing_md` key are tolerated but ignored.
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

function _wrapCallout({ callout_type, title, body_md, kind, items }) {
    // Strip trailing [ \t]+ on each line; preserve leading whitespace.
    const rawLines = String(body_md == null ? "" : body_md)
        .split("\n")
        .map((l) => l.replace(/[ \t]+$/, ""));

    // v0.98.1: when the block carries items[] and the kind is eligible for item-ID
    // emission, annotate each item line in body_md with a deterministic
    // `^item-<kind>-<7hex>` block-ID anchor (invisible in Obsidian reading mode;
    // wikilink-targetable as [[note#^item-<kind>-<7hex>]] by Rail L ticks).
    // Matching is done by substring: the first body_md line that contains
    // item.text (or item.label) verbatim receives the anchor appended.
    const annotatedLines = rawLines.slice();
    const blockForGuard = { kind, callout_type };
    if (Array.isArray(items) && items.length > 0 && _shouldEmitItemId(blockForGuard)) {
        const claimed = new Set(); // prevent double-annotation
        for (const item of items) {
            const matchText = item.text || item.label || "";
            if (!matchText) continue;
            const canonicalId = item.id || matchText;
            const anchor = `^${_itemId(kind, canonicalId)}`;
            for (let i = 0; i < annotatedLines.length; i++) {
                if (claimed.has(i)) continue;
                if (annotatedLines[i].includes(matchText)) {
                    annotatedLines[i] = `${annotatedLines[i]} ${anchor}`;
                    claimed.add(i);
                    break;
                }
            }
        }
    }

    // Blank line → bare ">"; non-blank → "> <content>".
    const prefixed = annotatedLines.map((l) => (l === "" ? ">" : `> ${l}`));
    // v0.98.0 synopsis-density contract: per-kind callouts default-collapsed
    // (`-` sigil) regardless of callout_type. Lead synopsis stays `+` (open)
    // but is composed upstream in synopsis_md; this wrapper only renders
    // per-kind ordered_blocks + engagement_type_blocks.
    const header = `> [!${callout_type}]- ${title}`;
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
    // 4. per ordered_blocks[i] callout header. v0.98.0: collapsed by default.
    for (const b of input.ordered_blocks) {
        assertions.push(`> [!${b.callout_type}]- ${b.title}`);
    }
    // 5. per engagement_type_blocks[i] callout header. v0.98.0: collapsed.
    for (const b of input.engagement_type_blocks) {
        assertions.push(`> [!${b.callout_type}]- ${b.title}`);
    }
    // 6. closing first line — REMOVED in v0.98.0 (no closing callout).
    // 7. backlink first line if present (last).
    if (typeof mc.backlink_md === "string" && mc.backlink_md.trim()) {
        assertions.push(mc.backlink_md.split("\n")[0].replace(/[ \t]+$/, ""));
    }
    return assertions;
}

/**
 * v0.96.0 S1.6 — sidecar composition (Rail W).
 *
 * Walks `ordered_blocks[]` + `engagement_type_blocks[]` to aggregate items[]
 * and surfaced_kinds[] into the v1.0.0 sidecar payload schema documented in
 * `data/schemas/<cadence>@1.0.0.json` (draft-07). Pure; deterministic.
 *
 * Sidecar surface keys:
 *   - schema_version       — pinned "1.0.0".
 *   - generated_by         — `cowork:<cadence>@2.0.0` if not provided.
 *   - generated_at         — ISO timestamp; from input or new Date().
 *   - cadence              — passthrough.
 *   - engagement_id        — passthrough (default "").
 *   - frontmatter          — mirror of the .md frontmatter (default {}).
 *   - surfaced_kinds       — unique kinds from both block arrays, excluding
 *                            "warning" sentinels. Order = first-seen.
 *   - surfaced_items       — flat concat of block.items[] across both arrays.
 *   - render_aspects_applied — passthrough (default []).
 *   - memory_used          — passthrough (default conservative zero-state).
 *   - plan_dispatch        — passthrough (default derived from
 *                            surfaced_kinds.size + warnings = 0).
 *
 * The retired v0.91.x–v0.92.0 `body_assertions[]` field is subsumed by JSON-
 * schema validation at write-atomic-note time.
 *
 * @param {object} input  — composeBody input (post-validation)
 * @returns {object}      — v1.0.0 sidecar payload
 */
function _composeSidecar(input) {
    const generated_at = input.generated_at || new Date().toISOString();
    const surfaced_items = [];
    const surfaced_kinds = new Set();
    const allBlocks = [
        ...(input.ordered_blocks || []),
        ...(input.engagement_type_blocks || []),
    ];
    for (const block of allBlocks) {
        if (block.kind && block.kind !== "warning") {
            surfaced_kinds.add(block.kind);
        }
        if (Array.isArray(block.items)) {
            for (const item of block.items) {
                surfaced_items.push(item);
            }
        }
    }
    return {
        schema_version: "1.0.0",
        generated_by: input.generated_by || `cowork:${input.cadence}@2.0.0`,
        generated_at,
        cadence: input.cadence,
        engagement_id: input.engagement_id || "",
        frontmatter: input.frontmatter || {},
        surfaced_kinds: Array.from(surfaced_kinds),
        surfaced_items,
        render_aspects_applied: input.render_aspects_applied || [],
        memory_used: input.memory_used || {
            yesterday_present: false,
            drift_warning_present: false,
            echoes_count: 0,
        },
        plan_dispatch: input.plan_dispatch || {
            mode: "prefs",
            kinds_dispatched: surfaced_kinds.size,
            warnings_emitted: 0,
        },
    };
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

/**
 * v0.96.0 Rail D — Detection callout (new_mcp_notice render aspect).
 *
 * injectDetectionCallout(body, pending_confirmations)
 *
 * Prepends a "> [!info]+ Cowork detected a new MCP" callout to the body, listing
 * each newly-detected MCP namespace that is not yet in user-preferences.mcps.
 * Accepts both the S2.3 string[] contract (raw namespace names) and the richer
 * design contract (objects with namespace/classified_as/suggested_priority).
 *
 * Caller is responsible for gating on render_aspects.new_mcp_notice == "include"
 * AND a non-empty pending_confirmations array (typically routed through
 * composeBody).
 *
 * @param {string} body                            - current body string
 * @param {(string|object)[]} pending_confirmations - non-empty array of raw namespace
 *                                                    names OR objects with
 *                                                    {namespace, classified_as,
 *                                                    suggested_priority}
 * @returns {string} body with the callout prepended
 */
function injectDetectionCallout(body, pending_confirmations) {
    if (!Array.isArray(pending_confirmations) || pending_confirmations.length === 0) {
        return body;
    }
    const lines = pending_confirmations.map((entry) => {
        // Accept both string (S2.3 contract) and object (design contract) shapes
        if (typeof entry === "string") {
            return `> - \`${entry}\``;
        }
        return `> - \`${entry.namespace}\` classified as \`${entry.classified_as}\` (suggested priority: ${entry.suggested_priority})`;
    });
    const callout = [
        `> [!info]+ Cowork detected a new MCP`,
        `> The following connected MCPs are not yet in your \`user-preferences.mcps\`. Edit \`spice/cowork/context/user-preferences.md\` to confirm and customize, or run \`/cowork context-builder\` to re-interview.`,
        ...lines,
    ].join("\n");
    return callout + "\n\n" + body;
}

/**
 * v0.96.0 Rail L — Rating callout (learn-from-checks render aspect).
 *
 * composeRatingCallout(opts)
 *
 * Composes a "> [!todo]+ Was today useful?" callout listing one checkbox per
 * kind in surfaced_kinds. The callout body includes an HTML sentinel
 * `<!-- cowork:rating-block schema=1.0.0 cadence=<c> day=<d> -->` for
 * idempotent learn-from-checks parsing.
 *
 * Idempotent re-fire: when prior_state is supplied (parsed from an existing
 * atomic-note via parseRatingCallout), kinds that were previously ticked
 * preserve their [x] state across re-fires.
 *
 * Caller is responsible for the learning-enabled gate (or, more typically,
 * routes through composeBody which gates via input.learning_enabled !== false
 * AND a non-empty input.surfaced_kinds_for_rating array).
 *
 * @param {object} opts
 * @param {string} opts.cadence        - cadence name (morning-briefing, midday-tripwire, ...)
 * @param {string} opts.day            - ISO day (YYYY-MM-DD)
 * @param {string[]} opts.surfaced_kinds - non-empty array of kinds surfaced today
 * @param {object|null} opts.prior_state - { kind → wasTicked } map from prior rating callout
 * @returns {string} rendered callout (or "" when surfaced_kinds empty)
 */
function composeRatingCallout(opts) {
    const { cadence, day, surfaced_kinds, prior_state } = opts || {};
    if (!Array.isArray(surfaced_kinds) || surfaced_kinds.length === 0) return "";
    const kindLabel = (k) => k.charAt(0).toUpperCase() + k.slice(1);
    const lines = surfaced_kinds.map((kind) => {
        const wasTicked = prior_state && prior_state[kind] === true;
        const checkbox = wasTicked ? "[x]" : "[ ]";
        return `> - ${checkbox} ${kindLabel(kind)}`;
    });
    return [
        `> [!todo]+ Was today useful?`,
        `> Tick the kinds that surfaced something you cared about. (One tick per kind per day; learned weights live in \`spice/cowork/context/user-preferences.md\`.)`,
        ...lines,
        `> <!-- cowork:rating-block schema=1.0.0 cadence=${cadence} day=${day} -->`,
    ].join("\n");
}

/**
 * v0.96.0 Rail L — Upgrade-notice callout (one-shot per engagement).
 *
 * injectUpgradeNoticeCallout(body)
 *
 * Prepends a "> [!info]+ Cowork v0.96.0 upgrade notice" callout explaining the
 * rating callout, sidecar file conventions, and the learning_enabled override
 * knob. Designed to fire ONCE per engagement — the first atomic note emitted
 * post-upgrade — gated by `learned_weights.totals.upgrade_notice_emitted` which
 * `cowork:learn-from-checks` flips to `true` after the first run.
 *
 * Caller is responsible for the one-shot gate (or, more typically, routes
 * through composeBody which checks input.learned_weights_state.totals).
 *
 * @param {string} body - current body string
 * @returns {string} body with the upgrade-notice callout prepended
 */
function injectUpgradeNoticeCallout(body) {
    const callout = [
        `> [!info]+ Cowork v0.96.0 upgrade notice`,
        `> This is the first atomic note since upgrading to v0.96.0 — cowork now learns which kinds of items you care about. Each atomic note ends with a "Was today useful?" rating callout — tick the kinds that surfaced something you cared about. Your daily preferences update nightly; effects begin after 7 days of ticks.`,
        `> To disable for an engagement, set \`engagement.learning_enabled: false\` in \`vault-config.md\`. To exclude \`.cowork.json\` sidecars from Obsidian search, add \`*.cowork.json\` to Settings → Files & Links → Excluded files.`,
    ].join("\n");
    return callout + "\n\n" + body;
}

function composeBody(input) {
    const validationError = _validateInput(input);
    if (validationError) {
        return { body_md: "", sidecar_json: null, status: validationError };
    }

    const {
        cadence,
        nav_buttons_block,
        synopsis_md,
        memory_callouts,
        ordered_blocks,
        engagement_type_blocks,
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
    // 6. closing — REMOVED in v0.98.0 (synopsis carries the action signal).
    // 7. backlink (last, if present).
    const backlink = _composeBacklink(memory_callouts);
    if (backlink !== "") {
        sections.push(backlink);
    }

    let body_md = sections.join("\n\n") + "\n";
    // v0.96.0 Rail D: emit detection callout when MCPs detected AND render_aspects allows
    if (
        input.pending_confirmations
        && input.pending_confirmations.length > 0
        && input.render_aspects
        && input.render_aspects.new_mcp_notice === "include"
    ) {
        body_md = injectDetectionCallout(body_md, input.pending_confirmations);
    }
    // v0.98.1: Rail L cadence-based dispatch.
    // EOD-only → composeFeedbackCapture (rich shape with per-item ticks + knob + free-text)
    // Other 4 cadences → composeRatingCallout (v0.96.0 kind-checkbox shape)
    if (input.learning_enabled !== false) {
        if (
            input.cadence === "eod-review"
            && input.surfaced_items_by_kind
            && typeof input.surfaced_items_by_kind === "object"
        ) {
            const { composeFeedbackCapture } = require("./compose-feedback-capture-helper.js");
            const feedbackResult = composeFeedbackCapture({
                cadence: input.cadence,
                day: input.day || (input.frontmatter && input.frontmatter.day) || new Date().toISOString().slice(0, 10),
                surfaced_items_by_kind: input.surfaced_items_by_kind,
                prior_md: input.prior_md || null,
                knob_positions: ["less", "same", "more"],
            });
            if (feedbackResult && feedbackResult.rail_md) {
                body_md = body_md.trimEnd() + "\n\n" + feedbackResult.rail_md + "\n";
            }
        } else if (Array.isArray(input.surfaced_kinds_for_rating)) {
            const ratingCallout = composeRatingCallout({
                cadence: input.cadence,
                day: input.day || (input.frontmatter && input.frontmatter.day) || new Date().toISOString().slice(0, 10),
                surfaced_kinds: input.surfaced_kinds_for_rating,
                prior_state: input.prior_rating_state || null,
            });
            if (ratingCallout) {
                body_md = body_md.trimEnd() + "\n\n" + ratingCallout + "\n";
            }
        }
    }
    // v0.96.0 upgrade notice — one-shot per engagement
    if (
        input.learned_weights_state &&
        input.learned_weights_state.totals &&
        !input.learned_weights_state.totals.upgrade_notice_emitted
    ) {
        body_md = injectUpgradeNoticeCallout(body_md);
        // Note: orchestrator/learn-from-checks marks totals.upgrade_notice_emitted = true
        // on next learn-from-checks fire (idempotent — won't re-emit on subsequent days).
    }
    const sidecar_json = _composeSidecar(input);

    return { body_md, sidecar_json, status: "ok" };
}

module.exports = {
    composeBody,
    injectAntiEchoCallout,
    injectDetectionCallout,
    composeRatingCallout,
    injectUpgradeNoticeCallout,
    ANTI_ECHO_ELIGIBLE_CADENCES,
    _validateInput,
    _wrapCallout,
    _composeMemoryCluster,
    _composeBacklink,
    _computeAssertions,
    _composeSidecar,
};
