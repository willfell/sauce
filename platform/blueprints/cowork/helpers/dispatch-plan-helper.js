/* eslint-disable no-console */
/**
 * dispatch-plan-helper.js — v0.78.0
 *
 * Computes the dispatch plan for an orchestrator's gather phase from
 * user-preferences.md content and a runtime reachable-namespace set.
 *
 * Pure: no MCP calls, no side effects, no stdout.
 *
 * Output entries:
 *   { kind_name, action: "gather_from_served_by",
 *     served_by, what_matters, kind_title,
 *     question_set_answers, mcps_entry }
 *   { kind_name, action: "gather_canonical",
 *     gather_skill, kind_title, mcps_entry }
 *   { kind_name, action: "warn",
 *     reason: "not_classified" | "not_connected" | "served_by_unreachable",
 *     kind_title, mcps_entry }
 */
"use strict";

const CANONICAL_TITLES = {
    calendar: "Calendar",
    email:    "Email",
    chat:     "Chat",
    finance:  "Finance",
};

function titleCase(s) {
    if (!s) return "";
    return String(s).split(/[\s_]+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
}

function planDispatch({
    prefs,
    reachableNamespaces,
    mcpSkillMap,
    microscopes,
    // v0.95.1 additive inputs — opt-in calling convention. When ANY of these
    // is provided, planDispatch returns the v0.95.1 contract object
    // ({ dispatch_plan, excluded_themes }) instead of the legacy raw array.
    // This preserves backward-compat for every pre-v0.95.1 call site
    // (run-cowork-smoke HC-V0780-C*, etc.) while letting the new
    // plan-dispatch SKILL.md compose the 13th contract key here.
    engagement,
    bundle,
    overrides,
    yesterdayMemory,
}) {
    const isV0951Call = (bundle !== undefined && bundle !== null)
        || engagement !== undefined
        || overrides !== undefined
        || yesterdayMemory !== undefined;

    if (!prefs || !Array.isArray(prefs.priorities)) {
        if (isV0951Call) {
            // Defensive: still emit the 13th key so the orchestrator never
            // dereferences `plan.excluded_themes` against `undefined`.
            const excluded_themes_empty = _computeExcludedThemes({ bundle, overrides, engagement, yesterdayMemory });
            return { dispatch_plan: [], excluded_themes: excluded_themes_empty };
        }
        return [];
    }
    const reachable = reachableNamespaces instanceof Set
        ? reachableNamespaces
        : new Set(reachableNamespaces || []);
    const knownKinds = new Set((mcpSkillMap && mcpSkillMap.kinds || []).map(k => k.kind));
    const gatherSkillByKind = {};
    for (const k of (mcpSkillMap && mcpSkillMap.kinds || [])) {
        gatherSkillByKind[k.kind] = k.gather_skill;
    }

    const plan = [];
    for (const kind_name of prefs.priorities) {
        const mcps_entry = (prefs.mcps || {})[kind_name];
        const kind_title = CANONICAL_TITLES[kind_name] || titleCase(kind_name);

        if (!mcps_entry) {
            plan.push({ kind_name, action: "warn", reason: "not_classified", kind_title, mcps_entry: null });
            continue;
        }
        if (mcps_entry.connected === false) {
            plan.push({ kind_name, action: "warn", reason: "not_connected", kind_title, mcps_entry });
            continue;
        }
        if (mcps_entry.served_by && !reachable.has(mcps_entry.served_by)) {
            plan.push({ kind_name, action: "warn", reason: "served_by_unreachable", kind_title, mcps_entry });
            continue;
        }
        // v0.79.0: a per-kind microscope contract forces served-by routing with the
        // microscope body as the primary what_matters (notes preserved as baseline).
        const microscopeBody = microscopes && typeof microscopes === "object" ? microscopes[kind_name] : undefined;
        if (microscopeBody && String(microscopeBody).trim()) {
            plan.push({
                kind_name,
                action: "gather_from_served_by",
                served_by: mcps_entry.served_by,
                what_matters: String(microscopeBody),
                baseline_notes: mcps_entry.what_matters || "",
                question_set_answers: mcps_entry.custom_kind ? null : null,
                kind_title,
                microscope: true,
                mcps_entry,
            });
            continue;
        }
        if (mcps_entry.custom_kind === true || mcps_entry.override_classified === true) {
            // Build question_set_answers by stripping the bookkeeping fields from mcps_entry
            const bookkeeping = new Set(["served_by", "what_matters", "connected", "captured_at", "custom_kind", "override_classified"]);
            const qsa = {};
            for (const k of Object.keys(mcps_entry)) {
                if (!bookkeeping.has(k)) qsa[k] = mcps_entry[k];
            }
            plan.push({
                kind_name,
                action: "gather_from_served_by",
                served_by: mcps_entry.served_by,
                what_matters: mcps_entry.what_matters || "",
                question_set_answers: mcps_entry.custom_kind ? null : (Object.keys(qsa).length ? qsa : null),
                kind_title,
                mcps_entry,
            });
            continue;
        }
        // Default: known canonical-vendor kind
        if (knownKinds.has(kind_name)) {
            plan.push({
                kind_name,
                action: "gather_canonical",
                gather_skill: gatherSkillByKind[kind_name],
                kind_title,
                mcps_entry,
            });
        } else {
            // Unknown kind in priorities, no canonical vendor → fall through to gather-from-served-by
            // (this should be rare; means a user added a kind name we don't recognize but didn't flag as custom)
            plan.push({
                kind_name,
                action: "gather_from_served_by",
                served_by: mcps_entry.served_by,
                what_matters: mcps_entry.what_matters || "",
                question_set_answers: null,
                kind_title,
                mcps_entry,
            });
        }
    }
    if (isV0951Call) {
        // v0.95.1 contract object: dispatch_plan (the array the legacy form
        // returned) PLUS excluded_themes (the 13th key). The plan-dispatch
        // SKILL.md composes the remaining ~11 keys (voice_contract,
        // microscopes, siblings, allowlist, render_aspects, cadence_order,
        // tripwire_aspects, kind_titles, effective_hard_rules,
        // dispatch_mode, prefs_status) around this helper's two-key surface.
        const excluded_themes = _computeExcludedThemes({ bundle, overrides, engagement, yesterdayMemory });
        return { dispatch_plan: plan, excluded_themes };
    }
    return plan;
}

/**
 * _computeExcludedThemes({ bundle, overrides, engagement, yesterdayMemory })
 *
 * Internal helper: derives the v0.95.1 13th contract key (excluded_themes)
 * given the composed final preferences for an engagement plus the
 * yesterdayMemory shape returned by the read-memory sub-skill.
 *
 * Returns the carry-forward bullets verbatim WHEN render_aspects.anti_echo
 * resolves to "include" after layering bundle ⨁ overrides ⨁ engagement.overrides.
 * Returns [] in every other case (anti-echo not opted in, no bundle, no
 * memory, malformed inputs).
 *
 * Overrides resolution order (later wins):
 *   1. bundle.render_aspects.anti_echo               (default — "skip" once
 *                                                     engagement-types ship
 *                                                     the v0.95.1 default in
 *                                                     S1.4)
 *   2. engagement.overrides.render_aspects.anti_echo (per-engagement opt-in
 *                                                     declared in
 *                                                     vault-config.md)
 *   3. overrides.render_aspects.anti_echo            (explicit top-level
 *                                                     overrides arg — used by
 *                                                     the K1B harness cases)
 */
function _computeExcludedThemes({ bundle, overrides, engagement, yesterdayMemory } = {}) {
    const effectiveOverrides = (overrides && typeof overrides === "object" && !Array.isArray(overrides))
        ? overrides
        : (engagement && typeof engagement === "object" && engagement.overrides
            && typeof engagement.overrides === "object" && !Array.isArray(engagement.overrides))
            ? engagement.overrides
            : null;
    const final_prefs = composeFinalPreferences({
        bundle,
        overrides: effectiveOverrides,
        ad_hoc_prefs: null,
    });
    const anti_echo_enabled = final_prefs
        && final_prefs.render_aspects
        && final_prefs.render_aspects.anti_echo === "include";
    if (!anti_echo_enabled) return [];
    return deriveExcludedThemes(yesterdayMemory);
}

function decideDispatchMode({ prefsStatus }) {
    return prefsStatus === "ok" ? "prefs" : "legacy";
}

function composeVoiceContract(personality, effectiveHardRules) {
    const rules = Array.isArray(effectiveHardRules) ? effectiveHardRules.filter(r => typeof r === "string" && r.trim()) : [];
    const p = personality || {};
    const hasPersonality = ["vibe", "formality", "pep_talk", "length", "notes"].some(k => p[k] !== null && p[k] !== undefined);
    if (!hasPersonality && rules.length === 0) return "";
    const fmt = (v) => (v === null || v === undefined) ? "default" : String(v);
    const pep = p.pep_talk === true ? "yes" : "no";
    const notes = p.notes ? String(p.notes).replace(/\s+/g, " ").trim() : "";
    const lines = [
        "Voice contract (from spice/cowork/context/user-preferences.md):",
        `- Vibe: ${fmt(p.vibe)}`,
        `- Formality: ${fmt(p.formality)}`,
        `- Pep talk: ${pep}`,
        `- Length: ${fmt(p.length)}`,
        `- Notes: ${notes || "(none)"}`,
        "",
        "Apply this voice ONLY to narrative sections (frontmatter summary, [!info]- synopsis, [!tip] closing). Do NOT apply to tabular [!example]+ blocks (their content comes from gather sub-skills and is contractually shaped).",
    ];
    if (rules.length > 0) {
        lines.push("");
        lines.push("Hard rules (non-negotiable, apply verbatim to ALL output — narrative AND callout titles/bodies):");
        for (const r of rules) lines.push(`- ${r}`);
    }
    lines.push("", "---", "");
    return lines.join("\n");
}

function composeWarningCallout({ kind_name, kind_title, reason, mcps_entry }) {
    if (reason === "not_classified") {
        return [
            `> [!warning] ${kind_title} not classified`,
            `> Kind \`${kind_name}\` appears in priorities[] but has no entry in mcps in user-preferences.md.`,
            `> Run \`/cowork preferences\` to classify this kind.`,
        ].join("\n");
    }
    if (reason === "not_connected") {
        const cap = (mcps_entry && mcps_entry.captured_at) || "an earlier date";
        return [
            `> [!warning] ${kind_title} not connected at capture time`,
            `> Kind \`${kind_name}\` was captured with \`connected: false\` on ${cap}.`,
            `> Re-run \`/cowork preferences\` after the MCP is connected.`,
        ].join("\n");
    }
    if (reason === "served_by_unreachable" || reason === "skipped:no-tools" || reason === "failed:served-by-unreachable") {
        const sb = (mcps_entry && mcps_entry.served_by) || "unknown";
        return [
            `> [!warning] ${kind_title} served-by namespace unreachable`,
            `> Kind \`${kind_name}\` is served by \`${sb}\`, but that MCP namespace is not reachable in this session.`,
            `> Verify the MCP is connected (check \`claude mcp list\`), then re-run.`,
        ].join("\n");
    }
    if (reason === "failed:bad-output") {
        return [
            `> [!warning] ${kind_title} gather failed (output validation)`,
            `> Kind \`${kind_name}\` gathered from \`${(mcps_entry && mcps_entry.served_by) || "unknown"}\` but the returned markdown failed structural validation.`,
            `> File a sauce issue if this recurs.`,
        ].join("\n");
    }
    return [
        `> [!warning] ${kind_title} unavailable`,
        `> Kind \`${kind_name}\`: ${reason}.`,
    ].join("\n");
}

// ===========================================================================
// v0.95.0 additive exports
// ===========================================================================

/**
 * composeFinalPreferences({ bundle, overrides, ad_hoc_prefs })
 *
 * Composes the FINAL preferences tree from layered inputs.
 *   bundle       — engagement-type JSON parsed (e.g. personal.json) — required
 *   overrides    — engagement.overrides block from vault-config.md (optional;
 *                  may be absent, empty, or — defensively — malformed)
 *   ad_hoc_prefs — optional runtime overrides (reserved; currently unused)
 *
 * Composition rules:
 *   - Objects (render_aspects, cadence_order, voice): bundle ⨁ overrides
 *     (override wins per-key)
 *   - Arrays (tripwire_aspects): overrides REPLACES bundle when present
 *   - microscopes_registry: overrides.value || bundle.value || null
 *     (null triggers filesystem scan downstream)
 *
 * Defensive: when bundle is null/non-object, returns an empty 5-key shell.
 * When overrides is non-object (e.g. string/array), it is treated as absent
 * (Postel — caller can surface a warning Notice independently).
 */
function composeFinalPreferences({ bundle, overrides, ad_hoc_prefs } = {}) {
    const emptyShell = {
        render_aspects: {},
        cadence_order: {},
        voice: {},
        microscopes_registry: null,
        tripwire_aspects: [],
    };
    if (!bundle || typeof bundle !== "object") return emptyShell;
    const ov = (overrides && typeof overrides === "object" && !Array.isArray(overrides)) ? overrides : {};
    const adHoc = (ad_hoc_prefs && typeof ad_hoc_prefs === "object" && !Array.isArray(ad_hoc_prefs)) ? ad_hoc_prefs : {};

    return {
        render_aspects:       Object.assign({}, bundle.render_aspects || {}, ov.render_aspects || {}, adHoc.render_aspects || {}),
        cadence_order:        Object.assign({}, bundle.cadence_order   || {}, ov.cadence_order   || {}, adHoc.cadence_order   || {}),
        voice:                Object.assign({}, bundle.voice           || {}, ov.voice           || {}, adHoc.voice           || {}),
        microscopes_registry: adHoc.microscopes_registry || ov.microscopes_registry || bundle.microscopes_registry || null,
        tripwire_aspects:     Array.isArray(adHoc.tripwire_aspects) ? adHoc.tripwire_aspects.slice()
                            : Array.isArray(ov.tripwire_aspects)    ? ov.tripwire_aspects.slice()
                            : Array.isArray(bundle.tripwire_aspects) ? bundle.tripwire_aspects.slice()
                            : [],
    };
}

/**
 * loadKindTitles({ vault_root })
 *
 * Loads the canonical kind→title map from spice/cowork/data/kind-titles.json
 * (v1.0.0 contract). Falls back to module-private CANONICAL_TITLES when the
 * file is missing, unparseable, or carries an incompatible version.
 *
 * Returns: { kind_name: title, ... }
 */
function loadKindTitles({ vault_root } = {}) {
    const fallback = Object.assign({}, CANONICAL_TITLES);
    if (!vault_root) return fallback;
    const fs = require("fs");
    const path = require("path");
    const dataPath = path.join(vault_root, "spice/cowork/data/kind-titles.json");
    try {
        if (!fs.existsSync(dataPath)) return fallback;
        const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
        if (data.version !== "1.0.0" || !data.canonical_titles || typeof data.canonical_titles !== "object") return fallback;
        return Object.assign({}, data.canonical_titles);
    } catch (_e) {
        return fallback;
    }
}

/**
 * readEngagement({ engagement_id, vault_root })
 *
 * Reads the named engagement record from spice/cowork/context/vault-config.md
 * by id, plus the bundle (engagement-type JSON at
 * spice/cowork/context/engagement-types/<type>.json), plus the engagement.overrides
 * block when present.
 *
 * Returns 5-key contract:
 *   { engagement, bundle, overrides, status, reason }
 *   status ∈ { "ok", "engagement_not_found", "bundle_missing", "bundle_parse_failed" }
 */
function readEngagement({ engagement_id, vault_root } = {}) {
    const fs = require("fs");
    const path = require("path");
    const empty = { engagement: null, bundle: null, overrides: null };
    if (!engagement_id || !vault_root) {
        return Object.assign({}, empty, { status: "engagement_not_found", reason: "missing inputs" });
    }
    const vaultConfigPath = path.join(vault_root, "spice/cowork/context/vault-config.md");
    if (!fs.existsSync(vaultConfigPath)) {
        return Object.assign({}, empty, { status: "engagement_not_found", reason: "vault-config.md missing" });
    }
    let body;
    try { body = fs.readFileSync(vaultConfigPath, "utf8"); }
    catch (e) { return Object.assign({}, empty, { status: "engagement_not_found", reason: `read failed: ${e.message}` }); }
    const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return Object.assign({}, empty, { status: "engagement_not_found", reason: "no frontmatter" });
    const engagement = _parseEngagementByIdFromYaml(fmMatch[1], engagement_id);
    if (!engagement) return Object.assign({}, empty, { status: "engagement_not_found", reason: `id "${engagement_id}" absent` });
    const type = engagement.type;
    if (!type) return Object.assign({}, empty, { engagement, status: "bundle_missing", reason: "engagement.type absent" });
    const bundlePath = path.join(vault_root, "spice/cowork/context/engagement-types", `${type}.json`);
    if (!fs.existsSync(bundlePath)) {
        return { engagement, bundle: null, overrides: engagement.overrides || null, status: "bundle_missing", reason: `${type}.json absent` };
    }
    let bundle;
    try { bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8")); }
    catch (e) { return { engagement, bundle: null, overrides: engagement.overrides || null, status: "bundle_parse_failed", reason: e.message }; }
    return { engagement, bundle, overrides: engagement.overrides || null, status: "ok", reason: null };
}

/**
 * _parseEngagementByIdFromYaml — minimal YAML-ish extractor scoped to vault-config.md's
 * engagements[] array shape. Finds the `- id: <engagement_id>` entry, captures the
 * indented block (until the next `-` at the same indent or end), and parses it
 * recursively (flat key:value, nested maps, list-of-strings, nested
 * `overrides:` map). Not a full YAML parser; sufficient for the vault-config
 * engagement-record shape.
 */
function _parseEngagementByIdFromYaml(yaml, engagement_id) {
    const lines = yaml.split("\n");
    // Locate the `engagements:` key (top-level)
    let i = 0;
    while (i < lines.length && !/^engagements:\s*$/.test(lines[i])) i++;
    if (i >= lines.length) return null;
    i++;
    // Walk entries (each starts at indent==2 with "- ")
    while (i < lines.length) {
        const line = lines[i];
        const m = line.match(/^  -\s+id:\s*(.*)$/);
        if (m) {
            const thisId = m[1].trim().replace(/^["']|["']$/g, "");
            // Collect this entry's body until the next "  - " or non-indented line
            const bodyLines = [`id: ${thisId}`]; // promote the id field to flat
            let j = i + 1;
            while (j < lines.length) {
                const ln = lines[j];
                if (/^  -\s/.test(ln)) break;            // next engagement
                if (/^\S/.test(ln) && ln.trim() !== "") break;  // top-level key
                if (ln.startsWith("    ")) bodyLines.push(ln.slice(4)); // strip 4-space indent
                else if (ln.trim() === "") bodyLines.push("");
                j++;
            }
            if (thisId === engagement_id) {
                return _parseEngagementBlock(bodyLines.join("\n"));
            }
            i = j;
            continue;
        }
        i++;
    }
    return null;
}

function _parseEngagementBlock(block) {
    const out = {};
    const lines = block.split("\n");
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
        const flat = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
        if (!flat) { i++; continue; }
        const [, key, valRaw] = flat;
        const val = valRaw.trim();
        if (val === "") {
            const nested = [];
            i++;
            while (i < lines.length && (lines[i].startsWith("  ") || lines[i].trim() === "")) {
                nested.push(lines[i]);
                i++;
            }
            if (nested.length && nested.filter(l => l.trim()).every(l => /^\s+-\s/.test(l))) {
                out[key] = nested.filter(l => l.trim()).map(l => l.replace(/^\s+-\s*/, "").trim().replace(/^["']|["']$/g, ""));
            } else {
                out[key] = _parseEngagementBlock(nested.map(l => l.replace(/^  /, "")).join("\n"));
            }
            continue;
        }
        if (val.startsWith("[") && val.endsWith("]")) {
            out[key] = val.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
        } else if (val === "true") out[key] = true;
        else if (val === "false") out[key] = false;
        else if (val === "null") out[key] = null;
        else if (/^-?\d+(\.\d+)?$/.test(val)) out[key] = Number(val);
        else out[key] = val.replace(/^["']|["']$/g, "");
        i++;
    }
    return out;
}

// ===========================================================================
// v0.95.1 additive export — Knob 1 (anti_echo render aspect)
// ===========================================================================

/**
 * deriveExcludedThemes(yesterdayMemory)
 *
 * Pure helper. Returns the raw carry-forward bullet strings from yesterday's
 * memory.md (as captured by the read-memory sub-skill). compose-body's
 * LLM-fill step does the semantic compare — this helper does NO theme
 * extraction.
 *
 * Defensive:
 *   - null/undefined yesterdayMemory → []
 *   - missing/null/non-array carry_forward_bullets → []
 *   - non-string or whitespace-only bullets are filtered out
 *
 * @param {Object|null|undefined} yesterdayMemory - return value of read-memory sub-skill
 * @returns {string[]} - bullet strings verbatim; [] when no usable bullets
 */
function deriveExcludedThemes(yesterdayMemory) {
    if (!yesterdayMemory || typeof yesterdayMemory !== "object") return [];
    const bullets = yesterdayMemory.carry_forward_bullets;
    if (!Array.isArray(bullets) || bullets.length === 0) return [];
    return bullets.filter((b) => typeof b === "string" && b.trim().length > 0);
}

module.exports = {
    planDispatch,
    decideDispatchMode,
    composeVoiceContract,
    composeWarningCallout,
    composeFinalPreferences,
    readEngagement,
    loadKindTitles,
    deriveExcludedThemes,
    _computeExcludedThemes,
    _titleCase: titleCase,
    _CANONICAL_TITLES: CANONICAL_TITLES,
    _parseEngagementByIdFromYaml,
    _parseEngagementBlock,
};
