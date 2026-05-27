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

    // Coerce optional defaults
    const personality = Object.assign(
        { vibe: null, formality: null, pep_talk: null, length: null, notes: null },
        migrated.personality || {},
    );
    for (const kind of Object.keys(mcps)) {
        const entry = mcps[kind];
        if (entry && typeof entry === "object") {
            if (entry.connected === undefined) entry.connected = false;
            if (entry.custom_kind === undefined) entry.custom_kind = false;
            if (entry.override_classified === undefined) entry.override_classified = false;
        }
    }

    return {
        prefs: { priorities, personality, mcps },
        status: "ok",
    };
}

module.exports = {
    readUserPreferences,
};
