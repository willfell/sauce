/* eslint-disable no-console */
/**
 * read-user-preferences-helper.js — v0.78.0
 *
 * Reads spice/cowork/context/user-preferences.md from a vault root, parses
 * its YAML frontmatter, applies v1→v2 migration, returns { prefs, status }.
 *
 * Status values:
 *   "ok"        — file exists, parses, has populated priorities + mcps
 *   "empty"     — file missing OR seed-shape (priorities: [] AND mcps: {})
 *   "malformed" — file exists but YAML failed to parse OR type tag missing
 *
 * The helper is pure: no side effects, no MCP calls, no stdout writes.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ctxHelper = require("./context-builder-dry-run.js");
const parseYamlIsh = ctxHelper._parseYamlIsh;
const migrateV1ToV2 = ctxHelper.migrateV1ToV2;

const PREFS_RELPATH = "spice/cowork/context/user-preferences.md";

const CANONICAL_NO_EMOJI_RULE =
    "Do not use any emoji or pictographic characters anywhere in the output — not in section/callout titles, not in inline prose, not in table cells.";

// v0.89.0 (people-cohesion-2): platform-default `wikilink_people` rule auto-appended
// to every engagement's effective_hard_rules[] unless the user opts out via
// personality.hard_rules: [{id: "wikilink_people", disabled: true}] (forward-looking
// breadcrumb; disable-path no-op this cycle).
const WIKILINK_PEOPLE_RULE = {
    id: "wikilink_people",
    body: "When body composition mentions a person, always emit [[Person Name]] if the person resolves (via cowork:resolve-person or via prior wikilink in the same atomic note); never use bare **Name** for a resolved person. Unresolved people may emit **Name** or plain text. Preserve existing [[Person Name]] wikilinks verbatim when summarizing or distilling. This rule binds atomic-note bodies, synthesis bodies (synthesize-day / synthesize-week output), callout titles, and dispatch-contract output. Exempt: literal display strings inside calendar event titles, email subjects, message previews.",
    source: "platform-default",
    introduced_in: "v0.89.0",
};
const CANONICAL_WIKILINK_PEOPLE_RULE = WIKILINK_PEOPLE_RULE.body;

function composeEffectiveHardRules({ no_emojis, hard_rules } = {}) {
    // Detect disable-path BEFORE the string-filter (override entries may be objects).
    const rawList = Array.isArray(hard_rules) ? hard_rules : [];
    const hasWikilinkDisable = rawList.some(r =>
        r && typeof r === "object" && r.id === "wikilink_people" && r.disabled === true);
    const base = rawList.filter(r => typeof r === "string" && r.trim());
    const out = base.slice();
    if (no_emojis === true) out.push(CANONICAL_NO_EMOJI_RULE);
    if (!hasWikilinkDisable && !out.includes(CANONICAL_WIKILINK_PEOPLE_RULE)) {
        out.push(CANONICAL_WIKILINK_PEOPLE_RULE);
    }
    return out;
}

// v0.82.0: default callout type per kind for visual differentiation across atomic notes.
// Users can override per-kind via mcps.<kind>.callout_type in user-preferences.md.
const DEFAULT_CALLOUT_TYPE_BY_KIND = {
    chat: "info",          // blue — conversational signals
    finance: "warning",    // amber — money matters
    calendar: "tip",       // green — anchors / conflicts
    email: "quote",        // gray — quiet / filtered
    ado: "example",        // purple — board state
    github: "note",        // sky blue — code state
};

const VALID_CALLOUT_TYPES = new Set([
    "info", "note", "tip", "success", "warning", "caution", "example", "quote", "danger",
]);

function resolveCalloutType(kind_name, kind_block) {
    const raw = (kind_block && kind_block.callout_type) || "";
    const explicit = String(raw).toLowerCase().trim();
    if (explicit && VALID_CALLOUT_TYPES.has(explicit)) return explicit;
    return DEFAULT_CALLOUT_TYPE_BY_KIND[kind_name] || "example";
}

function readUserPreferences({ vaultRoot }) {
    if (!vaultRoot) {
        return { prefs: null, status: "malformed", reason: "vaultRoot required" };
    }
    const prefsPath = path.join(vaultRoot, PREFS_RELPATH);
    if (!fs.existsSync(prefsPath)) {
        return { prefs: null, status: "empty", reason: "file_not_found" };
    }
    const raw = fs.readFileSync(prefsPath, "utf8");
    // Extract leading frontmatter block delimited by --- ... ---
    const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (!m) {
        return { prefs: null, status: "malformed", reason: "no_frontmatter_block" };
    }
    let parsed;
    try {
        parsed = parseYamlIsh(m[1]);
    } catch (e) {
        return { prefs: null, status: "malformed", reason: `yaml_parse_error: ${e.message}` };
    }
    if (!parsed || parsed.type !== "cowork-user-preferences") {
        return { prefs: null, status: "malformed", reason: "type_tag_missing_or_wrong" };
    }

    // Load mcp-skill-map for migration (best-effort; if absent, skip migration)
    let mcpSkillMap = null;
    const mapCandidates = [
        path.join(vaultRoot, "spice/cowork/context/mcp-skill-map.json"),
        path.join(__dirname, "..", "content", "context", "mcp-skill-map.json"),
    ];
    for (const cand of mapCandidates) {
        if (fs.existsSync(cand)) {
            try { mcpSkillMap = JSON.parse(fs.readFileSync(cand, "utf8")); break; } catch (_) {}
        }
    }
    let migrated = parsed;
    if (mcpSkillMap) {
        try { migrated = migrateV1ToV2(parsed, mcpSkillMap); } catch (_) { migrated = parsed; }
    }

    const priorities = Array.isArray(migrated.priorities) ? migrated.priorities : [];
    const mcps = (migrated.mcps && typeof migrated.mcps === "object") ? migrated.mcps : {};

    if (priorities.length === 0 && Object.keys(mcps).length === 0) {
        return { prefs: null, status: "empty", reason: "unpopulated_seed" };
    }

    // Coerce optional defaults (v0.79.0 adds no_emojis + hard_rules)
    const personality = Object.assign(
        { vibe: null, formality: null, pep_talk: null, length: null, notes: null, no_emojis: false, hard_rules: [] },
        migrated.personality || {},
    );
    if (personality.no_emojis !== true) personality.no_emojis = false;
    if (!Array.isArray(personality.hard_rules)) personality.hard_rules = [];
    const effective_hard_rules = composeEffectiveHardRules(personality);
    for (const kind of Object.keys(mcps)) {
        const entry = mcps[kind];
        if (entry && typeof entry === "object") {
            if (entry.connected === undefined) entry.connected = false;
            if (entry.custom_kind === undefined) entry.custom_kind = false;
            if (entry.override_classified === undefined) entry.override_classified = false;
            entry.callout_type = resolveCalloutType(kind, entry);
        }
    }

    return {
        prefs: { priorities, personality, mcps, effective_hard_rules },
        status: "ok",
    };
}

module.exports = {
    readUserPreferences,
    composeEffectiveHardRules,
    resolveCalloutType,
    DEFAULT_CALLOUT_TYPE_BY_KIND,
    VALID_CALLOUT_TYPES,
    CANONICAL_NO_EMOJI_RULE,
    WIKILINK_PEOPLE_RULE,
    CANONICAL_WIKILINK_PEOPLE_RULE,
};
