/**
 * compose-scheduled-job-wrappers-helper.js — v0.93.0
 *
 * Pure helper for cowork:sync-scheduled-jobs orchestrator. Emits paste-ready
 * Cowork wrapper bodies for an engagement, fully aligned with current sauce +
 * cowork versions + the engagement's prefs.mcps state.
 *
 * Pure: no I/O, no clock, no randomness. Deterministic: same input tuple →
 * byte-identical file_md output. Spec lives in
 * Docs/plans/2026-06-05-v0.92.x-scheduled-jobs-sync-design.md §5.
 *
 * Substitution conventions:
 *   {{$varname}}        → engagement-level / cadence-level token (per
 *                         contract.substitution_tokens declaration).
 *   {{shared.<key>}}    → boilerplate clause (per contract.shared_clauses).
 *
 * 4-mode substitution-token validator (landmine #20):
 *   Mode 1 — undeclared {{$varname}}     → substitution-token-undeclared
 *   Mode 2 — unknown {{shared.<key>}}    → unknown-shared-key
 *   Mode 3 — invalid {{...}} format      → invalid-substitution-format
 *   Mode 4 — post-render {{ leak survive → unrendered-token-after-substitution
 */
"use strict";

const REQUIRED_INPUT_FIELDS = [
    "engagement",
    "prefs",
    "engagement_type_data",
    "contract",
    "sauce_version",
    "cowork_version",
    "generated_at",
    "generated_by",
];

const REQUIRED_CADENCE_FIELDS = [
    "schedule_hint",
    "frontmatter_type",
    "output_path_template",
    "orchestrator_skill_name",
    "sub_skill_name",
    "cadence_tone_hint",
];
// v0.97.0 S2.4.1: wrapper field is shape-tolerant. Cadence is valid if it has
// EITHER `wrapper_template` (legacy v0.34.1 and earlier — inline ~50-line UI
// wrapper string) OR `wrapper_template_source` (v0.97.0+ — relative path to a
// data/orchestrator-instructions/<cadence>.md file). The error string keeps
// "wrapper_template" so legacy asserts that grep on the error token still match.
const WRAPPER_FIELD_ALTERNATIVES = ["wrapper_template", "wrapper_template_source"];

const TOKEN_RE = /\{\{[^}]*\}\}/g;
const VALID_TOKEN_RE = /^\{\{(\$[a-z_]+|shared\.[a-z_]+)\}\}$/;

const NO_CONNECTED_MCPS_FALLBACK =
    "(no connected MCPs detected; verify spice/cowork/context/user-preferences.md before relying on this wrapper)";

// ---------------------------------------------------------------------------
// validateContract — structural validation of scheduled-job-contract.json
// ---------------------------------------------------------------------------

function validateContract(contract) {
    if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
        return { status: "failed:contract:invalid-shape:not-object" };
    }
    for (const k of [
        "contract_version",
        "cadence_order",
        "substitution_tokens",
        "shared_clauses",
        "cadences",
    ]) {
        if (contract[k] === undefined) {
            return { status: `failed:contract:invalid-shape:missing-${k}` };
        }
    }
    if (!Array.isArray(contract.cadence_order)) {
        return { status: "failed:contract:invalid-shape:cadence-order-not-array" };
    }
    for (const cad of contract.cadence_order) {
        if (!contract.cadences[cad]) {
            return { status: "failed:contract:cadence-order-mismatch" };
        }
        for (const f of REQUIRED_CADENCE_FIELDS) {
            if (contract.cadences[cad][f] === undefined) {
                return { status: `failed:contract:invalid-shape:cadence-${cad}-missing-${f}` };
            }
        }
        // Shape-tolerant wrapper field check: accept either legacy
        // `wrapper_template` OR v0.97.0+ `wrapper_template_source`.
        const hasWrapper = WRAPPER_FIELD_ALTERNATIVES.some(
            (alt) => contract.cadences[cad][alt] !== undefined,
        );
        if (!hasWrapper) {
            return { status: `failed:contract:invalid-shape:cadence-${cad}-missing-wrapper_template` };
        }
    }
    return { status: "ok" };
}

// ---------------------------------------------------------------------------
// _validateSubstitutionTokens — modes 1-3 preflight (mode 4 is post-render)
// ---------------------------------------------------------------------------

function _validateSubstitutionTokens(contract) {
    for (const cad of contract.cadence_order) {
        const tmpl = contract.cadences[cad].wrapper_template;
        if (typeof tmpl !== "string") continue;
        const matches = tmpl.match(TOKEN_RE) || [];
        for (const tok of matches) {
            // Mode 3 — format check FIRST so malformed tokens get the
            // invalid-substitution-format error rather than substitution-token-undeclared.
            if (!VALID_TOKEN_RE.test(tok)) {
                return {
                    status: `failed:contract:invalid-substitution-format:${tok}:cadence-${cad}`,
                };
            }
            if (tok.startsWith("{{$")) {
                // Mode 1 — declared in substitution_tokens?
                const name = tok.slice(3, -2); // "{{$name}}" → "name"
                const key = `$${name}`;
                if (!contract.substitution_tokens[key]) {
                    return {
                        status: `failed:contract:substitution-token-undeclared:${key}:cadence-${cad}`,
                    };
                }
            } else if (tok.startsWith("{{shared.")) {
                // Mode 2 — declared in shared_clauses?
                const key = tok.slice(9, -2); // "{{shared.key}}" → "key"
                if (!contract.shared_clauses[key]) {
                    return {
                        status: `failed:contract:unknown-shared-key:${key}:cadence-${cad}`,
                    };
                }
            }
        }
    }
    return { status: "ok" };
}

// ---------------------------------------------------------------------------
// composeMcpDispatchLines — kind-by-kind dispatch line from prefs.mcps
// ---------------------------------------------------------------------------

// FLN-v93-8 (v0.93.1): resolveServedBy accepts richer prefs shapes already canonical
// in real consumer vaults. Headspace's chat.served_by is a list ["iMCP"] that carries
// served_by_deferred + served_by_retired alongside; flattening to a string would lose
// curated migration history. Adapter picks first non-`<text> — `-marker string, strips
// surrounding quote chars, returns "" when nothing usable.
function _resolveServedBy(rawServedBy) {
    let s = rawServedBy;
    if (Array.isArray(s)) {
        s = s.find(x => typeof x === "string" && !/^.+\s+—\s+/.test(x)) || s[0] || "";
    }
    if (typeof s !== "string") s = String(s == null ? "" : s);
    return s.replace(/^["']/, "").replace(/["']$/, "").trim();
}

function composeMcpDispatchLines(mcps) {
    if (!mcps || typeof mcps !== "object" || Array.isArray(mcps)) {
        return { line: NO_CONNECTED_MCPS_FALLBACK, warning: "no_connected_mcps_in_prefs" };
    }
    const entries = [];
    // Sort keys for deterministic ordering.
    for (const kind of Object.keys(mcps).sort()) {
        const m = mcps[kind];
        if (!m || m.connected !== true) continue;
        const servedBy = _resolveServedBy(m.served_by);
        if (servedBy === "") continue;
        entries.push(`${kind} served-by ${servedBy}`);
    }
    if (entries.length === 0) {
        return { line: NO_CONNECTED_MCPS_FALLBACK, warning: "no_connected_mcps_in_prefs" };
    }
    return { line: entries.join("; "), warning: null };
}

// ---------------------------------------------------------------------------
// substituteTemplate — replace {{$name}} + {{shared.key}} tokens
// ---------------------------------------------------------------------------

function substituteTemplate(template, subs) {
    // subs keys are bare token names ("$name" / "shared.key"); we wrap with {{...}}
    // at substitution time. Iterating with split/join (no regex) keeps the helper
    // safe against regex-special chars in substitution values.
    let out = String(template);
    for (const [k, v] of Object.entries(subs)) {
        const token = `{{${k}}}`;
        if (out.indexOf(token) !== -1) {
            out = out.split(token).join(String(v));
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// composeScheduledJobWrappers — top-level entry
// ---------------------------------------------------------------------------

function composeScheduledJobWrappers(input) {
    // 1. Input validation.
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return { file_md: "", warnings: [], status: "failed:input:root:wrong-type:not-object" };
    }
    for (const f of REQUIRED_INPUT_FIELDS) {
        if (input[f] === undefined || input[f] === null) {
            return { file_md: "", warnings: [], status: `failed:input:${f}:missing` };
        }
    }
    if (typeof input.engagement !== "object" || Array.isArray(input.engagement)) {
        return { file_md: "", warnings: [], status: "failed:input:engagement:wrong-type:not-object" };
    }
    if (typeof input.engagement.id !== "string" || input.engagement.id === "") {
        return { file_md: "", warnings: [], status: "failed:input:engagement.id:missing" };
    }
    if (typeof input.prefs !== "object" || Array.isArray(input.prefs)) {
        return { file_md: "", warnings: [], status: "failed:input:prefs:wrong-type:not-object" };
    }
    if (
        typeof input.engagement_type_data !== "object" ||
        Array.isArray(input.engagement_type_data)
    ) {
        return {
            file_md: "",
            warnings: [],
            status: "failed:input:engagement_type_data:wrong-type:not-object",
        };
    }

    // 2. Contract structural validation.
    const cv = validateContract(input.contract);
    if (cv.status !== "ok") {
        return { file_md: "", warnings: [], status: cv.status };
    }

    // 3. Substitution-token preflight (modes 1-3).
    const sv = _validateSubstitutionTokens(input.contract);
    if (sv.status !== "ok") {
        return { file_md: "", warnings: [], status: sv.status };
    }

    const contract = input.contract;
    const engagement = input.engagement;
    const warnings = new Set();

    // 4a. Engagement-label resolution + warning.
    let engagement_label = engagement.label;
    if (typeof engagement_label !== "string" || engagement_label === "") {
        engagement_label = engagement.id;
        warnings.add("engagement_label_fallback_used");
    }

    // 4b. MCP dispatch line + warning.
    const mcpDispatch = composeMcpDispatchLines(input.prefs.mcps);
    if (mcpDispatch.warning) warnings.add(mcpDispatch.warning);

    // 4c. Voice-notes excerpt (≤200 chars; newlines stripped).
    // FLN-v93-8 (v0.93.1): fallback chain `notes → vibe_notes → voice_notes → pep_talk_style`
    // — headspace user-preferences uses `vibe_notes` per v0.82.0 voice convention, not the
    // helper's original `notes`-only assumption. Pick first non-empty string in priority order.
    let voice_notes_excerpt = "";
    const personality = (input.prefs && input.prefs.personality) || {};
    const NOTES_FIELDS = ["notes", "vibe_notes", "voice_notes", "pep_talk_style"];
    let rawNotes = "";
    for (const field of NOTES_FIELDS) {
        const v = personality[field];
        if (typeof v === "string" && v.trim() !== "") { rawNotes = v; break; }
    }
    if (rawNotes === "") {
        warnings.add("empty_voice_notes");
    } else {
        let trimmed = rawNotes.replace(/\r?\n/g, " ").trim();
        if (trimmed.length > 200) {
            trimmed = trimmed.slice(0, 200) + "…";
        }
        voice_notes_excerpt = trimmed;
        if (voice_notes_excerpt === "") {
            warnings.add("empty_voice_notes");
        }
    }

    // 5. Contract version mismatch check.
    if (contract.contract_version !== input.cowork_version) {
        warnings.add(
            `contract_version_mismatch:${contract.contract_version}:${input.cowork_version}`
        );
    }

    // 6. Resolve disabled cadences (engagement-type union with contract-level).
    const disabledFromEngType =
        (input.engagement_type_data.scheduled_jobs &&
            Array.isArray(input.engagement_type_data.scheduled_jobs.disabled_cadences) &&
            input.engagement_type_data.scheduled_jobs.disabled_cadences) ||
        [];
    const disabledCadences = new Map();
    for (const cad of disabledFromEngType) {
        if (!disabledCadences.has(cad)) {
            disabledCadences.set(cad, "engagement-type");
            warnings.add(`cadence_disabled:${cad}:engagement-type`);
        }
    }
    for (const cad of contract.cadence_order) {
        if (contract.cadences[cad].disabled === true && !disabledCadences.has(cad)) {
            disabledCadences.set(cad, "contract");
            warnings.add(`cadence_disabled:${cad}:contract`);
        }
    }

    // 7. Engagement-level substitution map.
    const engSubs = {
        "$engagement_id": engagement.id,
        "$engagement_label": engagement_label,
        "$mcp_dispatch_lines": mcpDispatch.line,
        "$voice_notes_excerpt": voice_notes_excerpt,
        "$sauce_version": String(input.sauce_version),
        "$cowork_version": String(input.cowork_version),
        "$contract_version": String(contract.contract_version),
    };

    // 8. Shared-clause substitutions.
    const sharedSubs = {};
    for (const [k, v] of Object.entries(contract.shared_clauses)) {
        sharedSubs[`shared.${k}`] = v;
    }

    // 9. Compose frontmatter (canonical 8-field order).
    const warningsArr = [...warnings].sort();
    const fmLines = [
        "---",
        "type: cowork-scheduled-job-wrappers",
        `engagement_id: ${engagement.id}`,
        `sauce_version: ${input.sauce_version}`,
        `cowork_version: ${input.cowork_version}`,
        `contract_version: ${contract.contract_version}`,
        `generated_at: ${input.generated_at}`,
        `generated_by: ${input.generated_by}`,
        `warnings: [${warningsArr.join(", ")}]`,
        "---",
    ];

    // 10. Compose preamble (engagement-level substitutions only).
    const preamble = substituteTemplate(contract.preamble_template, engSubs);

    // 11. Compose H1.
    const h1 = `# Cowork scheduled-job wrappers — ${engagement_label}`;

    // 12. Compose conditional warnings callout (OMITTED when empty).
    let warningsCallout = "";
    if (warningsArr.length > 0) {
        warningsCallout =
            "> [!warning]+ Warnings from generation\n" +
            warningsArr.map((w) => `> ${w}`).join("\n");
    }

    // 13. Compose collapsed "How to use" callout — wrap preamble with `> ` prefix.
    const preambleLines = preamble.split("\n").map((l) => (l === "" ? ">" : `> ${l}`));
    const howToUseCallout = "> [!info]- How to use\n" + preambleLines.join("\n");

    // 14. Compose per-cadence sections.
    //
    // v0.95.1 Knob-3 opt-in gate: `lens_shift` is the first cadence that ships
    // in contract.cadence_order but is OPT-IN at the engagement level (NOT in
    // any engagement-type's default_cadences). The helper SKIPS lens_shift
    // emission entirely (not even a DISABLED marker section) unless the
    // engagement explicitly opts in via `engagement.cadences.lens_shift` (an
    // object — typically `{ cron: "0 7 * * 6" }`). Rationale: keeping the
    // pre-v0.95.1 5-section default output for non-opted-in engagements
    // preserves the byte-identical compose-shape fixture contracts AND honors
    // the design intent (Knob 3 doubles MB cost weekly — explicit consent).
    // Future opt-in-only cadences can extend the OPT_IN_CADENCES set below.
    const OPT_IN_CADENCES = new Set(["lens_shift"]);
    const engagementCadences = (engagement && typeof engagement.cadences === "object" && engagement.cadences) || {};
    const optInCadenceEnabled = (cad) => {
        if (cad === "lens_shift") return !!engagementCadences.lens_shift;
        return true;
    };

    const sectionParts = [];
    let sectionIndex = 0;
    for (const cad of contract.cadence_order) {
        if (OPT_IN_CADENCES.has(cad) && !optInCadenceEnabled(cad)) {
            continue;
        }
        sectionIndex++;
        const cadDef = contract.cadences[cad];

        if (disabledCadences.has(cad)) {
            const reason = disabledCadences.get(cad);
            sectionParts.push(
                `## ${sectionIndex} — DISABLED — cowork-${cad}-${engagement.id}\n` +
                    `<!-- section_contract_version: ${contract.contract_version} -->\n` +
                    `<!-- disabled_by: ${reason} -->\n` +
                    `\n` +
                    `> [!example] This cadence is disabled for ${engagement_label}\n` +
                    `> Reason: disabled via ${reason}. If this is wrong, edit \`spice/cowork/context/engagement-types/${engagement.type}.json\` and re-run sync.\n` +
                    `\n` +
                    `---`
            );
            continue;
        }

        // Cadence-level substitution map (engagement + cadence fields).
        const cadSubs = Object.assign({}, engSubs, {
            "$schedule_hint": cadDef.schedule_hint,
            "$frontmatter_type": cadDef.frontmatter_type,
            "$output_path_template": cadDef.output_path_template,
            "$orchestrator_skill_name": cadDef.orchestrator_skill_name,
            "$sub_skill_name": cadDef.sub_skill_name,
            "$cadence_tone_hint": cadDef.cadence_tone_hint,
        });
        // Two-pass substitution: $-tokens first, then shared.<key> (shared clauses
        // may themselves contain ``` sequences; they don't include {{...}} tokens).
        const afterEng = substituteTemplate(cadDef.wrapper_template, cadSubs);
        const substituted = substituteTemplate(afterEng, sharedSubs);

        // 14b. Mode 4 post-render leak check.
        if (substituted.indexOf("{{") !== -1) {
            return {
                file_md: "",
                warnings: [],
                status: `failed:contract:unrendered-token-after-substitution:cadence-${cad}`,
            };
        }

        sectionParts.push(
            `## ${sectionIndex} — cowork-${cad}-${engagement.id} (${cadDef.schedule_hint})\n` +
                `<!-- section_contract_version: ${contract.contract_version} -->\n` +
                `\n` +
                "````\n" +
                substituted +
                "\n````\n" +
                `\n` +
                `---`
        );
    }

    // 15. Stitch file together.
    const topParts = [fmLines.join("\n"), h1];
    if (warningsCallout) topParts.push(warningsCallout);
    topParts.push(howToUseCallout);
    topParts.push("---");

    const file_md =
        topParts.join("\n\n") + "\n\n" + sectionParts.join("\n\n") + "\n";

    return { file_md, warnings: warningsArr, status: "ok" };
}

// ---------------------------------------------------------------------------
// composeFromOrchestratorInstructions — Rail T compose path (v0.97.0)
//
// Reads orchestrator-instructions/<cadence>.md + _shared-clauses.md, resolves
// {{#if cadence_mode == "lens_shift"}}…{{else}}…{{/if}} conditional branches,
// substitutes {{shared.<key>}} from the shared-clauses parse, substitutes
// static {{$tokens}} from engagement+prefs+contract, leaves {{$today_*}} +
// computed-at-emit tokens literal, wraps with PRELUDE + DONE blocks.
//
// Pure JS, no MCP, no LLM. Deterministic: same input tuple → byte-identical
// output. Replaces the inline contract.cadences[cadence].wrapper_template
// path with a single-source-of-truth data file pointed to by
// contract.cadences[cadence].wrapper_template_source.
// ---------------------------------------------------------------------------

const _fs = require("node:fs");
const _path = require("node:path");

function _loadOrchestratorInstructions(cadence, sourceRoot) {
    const candidates = [
        sourceRoot && _path.join(sourceRoot, "content", "data", "orchestrator-instructions", `${cadence}.md`),
        sourceRoot && _path.join(sourceRoot, `${cadence}.md`),
        _path.join(__dirname, "..", "content", "data", "orchestrator-instructions", `${cadence}.md`),
    ].filter(Boolean);
    for (const p of candidates) {
        if (_fs.existsSync(p)) return _fs.readFileSync(p, "utf8");
    }
    throw new Error(`orchestrator-instructions file not found for cadence "${cadence}" (looked in: ${candidates.join(" | ")})`);
}

function _loadSharedClauses(sourceRoot) {
    const candidates = [
        sourceRoot && _path.join(sourceRoot, "content", "data", "orchestrator-instructions", "_shared-clauses.md"),
        sourceRoot && _path.join(sourceRoot, "_shared-clauses.md"),
        _path.join(__dirname, "..", "content", "data", "orchestrator-instructions", "_shared-clauses.md"),
    ].filter(Boolean);
    for (const p of candidates) {
        if (_fs.existsSync(p)) {
            const raw = _fs.readFileSync(p, "utf8");
            const blocks = {};
            const sectionRx = /^## (\w+)\s*$/gm;
            const sections = [...raw.matchAll(sectionRx)];
            for (let i = 0; i < sections.length; i++) {
                const key = sections[i][1];
                const start = sections[i].index + sections[i][0].length;
                const end = i + 1 < sections.length ? sections[i + 1].index : raw.length;
                blocks[key] = raw.slice(start, end).trim();
            }
            return blocks;
        }
    }
    throw new Error(`_shared-clauses.md not found (looked in: ${candidates.join(" | ")})`);
}

function _resolveConditional(template, cadence_mode) {
    // {{#if cadence_mode == "lens_shift"}}...{{else}}...{{/if}}
    // Handle both with and without {{else}}.
    const rxWithElse = /\{\{#if cadence_mode == "([^"]+)"\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g;
    template = template.replace(rxWithElse, (_m, condValue, branchTrue, branchFalse) => {
        return cadence_mode === condValue ? branchTrue : branchFalse;
    });
    // {{#if cadence_mode == "lens_shift"}}...{{/if}} (no else)
    const rxNoElse = /\{\{#if cadence_mode == "([^"]+)"\}\}([\s\S]*?)\{\{\/if\}\}/g;
    template = template.replace(rxNoElse, (_m, condValue, branchTrue) => {
        return cadence_mode === condValue ? branchTrue : "";
    });
    return template;
}

function _substituteShared(template, sharedBlocks) {
    return template.replace(/\{\{shared\.(\w+)\}\}/g, (_m, key) => {
        if (sharedBlocks[key] == null) {
            throw new Error(`unknown shared key {{shared.${key}}}`);
        }
        return sharedBlocks[key];
    });
}

const _FIRE_TIME_TOKEN_PREFIXES = ["today_"];
const _COMPUTED_AT_EMIT_TOKENS = new Set(["rating_kind_lines", "pending_confirmation_lines"]);

function _isFireTimeOrComputedToken(key) {
    if (_COMPUTED_AT_EMIT_TOKENS.has(key)) return true;
    for (const prefix of _FIRE_TIME_TOKEN_PREFIXES) {
        if (key.startsWith(prefix)) return true;
    }
    return false;
}

function _substituteStaticTokens(template, tokens) {
    return template.replace(/\{\{\$(\w+)\}\}/g, (m, key) => {
        if (_isFireTimeOrComputedToken(key)) return m; // leave literal
        if (tokens[key] == null) return m; // unknown — leave literal (harness will detect)
        return tokens[key];
    });
}

function composeFromOrchestratorInstructions(opts) {
    const { cadence, engagement, prefs, contract, cadence_mode, sourceRoot } = opts || {};
    if (!cadence) throw new Error("composeFromOrchestratorInstructions: cadence required");
    if (!engagement) throw new Error("composeFromOrchestratorInstructions: engagement required");
    if (!prefs) throw new Error("composeFromOrchestratorInstructions: prefs required");
    if (!contract) throw new Error("composeFromOrchestratorInstructions: contract required");

    const mode = cadence_mode || "warm";

    let template = _loadOrchestratorInstructions(cadence, sourceRoot);
    const shared = _loadSharedClauses(sourceRoot);

    // 1. Conditional resolution
    template = _resolveConditional(template, mode);

    // 2. Shared substitution
    template = _substituteShared(template, shared);

    // 3. Compute static tokens
    const cadenceInContract = (contract.cadences && contract.cadences[cadence]) || {};
    const personality = prefs.personality || {};
    const mcpLinesResult = composeMcpDispatchLines(prefs.mcps || {});
    const mcpLines = (mcpLinesResult && typeof mcpLinesResult === "object")
        ? (mcpLinesResult.line || "")
        : (mcpLinesResult || "");
    const tokens = {
        engagement_id: engagement.id || "",
        engagement_label: engagement.label || engagement.id || "",
        timezone: engagement.timezone || "America/Denver",
        voice_notes: personality.notes || personality.vibe_notes || "",
        voice_summary: `vibe: ${personality.vibe || "casual"}, formality: ${personality.formality || "casual"}, length: ${personality.length || "balanced"}, pep_talk: ${personality.pep_talk === undefined ? false : personality.pep_talk}`,
        priorities: Array.isArray(prefs.priorities) ? prefs.priorities.join(", ") : "",
        mcp_dispatch_lines: mcpLines,
        inner_circle: Array.isArray(engagement.inner_circle_people) ? engagement.inner_circle_people.join(", ") : "",
        workshop_version: contract.workshop_version || "",
        cowork_version: contract.cowork_version || "",
        contract_version: contract.contract_version || "",
        cadence,
        cadence_mode: mode,
        frontmatter_type: (mode === "lens_shift" && cadence === "morning-briefing")
            ? "cowork-morning-briefing-cold"
            : (cadenceInContract.frontmatter_type || `cowork-${cadence}`),
        title_template: cadenceInContract.title_template || `${cadence} - {{$today_weekday}}, {{$today_month_name}} {{$today_day}}, {{$today_year}}`,
    };

    // 4. Static substitution
    template = _substituteStaticTokens(template, tokens);

    // 5. Wrap with PRELUDE + DONE
    const prelude = `PRELUDE — fire-time setup (CRITICAL: do these first)

1. Resolve today's date in ${tokens.timezone}. Capture:
     today_date     = YYYY-MM-DD (ISO)
     today_weekday  = e.g. "Tuesday"
     today_month_name = e.g. "June"
     today_day      = e.g. "9" (no leading zero)
     today_year     = e.g. "2026"
     today_dirpath  = <YYYY>/<MM-Month>/<YYYY-MM-DD>
     today_ymd_compact = YYYY-MM-DD
   Use these values everywhere {{$today_*}} appears below.

2. Read frontmatter from spice/cowork/context/vault-config.md via Obsidian MCP. Locate engagement record where id == "${tokens.engagement_id}". Capture engagement.

3. Read spice/cowork/context/user-preferences.md frontmatter. Capture personality + priorities + mcps + learned_weights.

4. Read spice/cowork/context/${tokens.engagement_id}/people-aliases.md (if exists) for inner-circle display-name resolution.`;

    const done = `DONE

N. Emit Obsidian Notice \`cowork:${cadence} complete -- ${tokens.engagement_label} {{$today_date}}\`.

---

Generated against sauce ${tokens.workshop_version} + cowork ${tokens.cowork_version} + contract ${tokens.contract_version}.`;

    const wrapper = `You are running cowork:${cadence} for engagement ${tokens.engagement_id} (${tokens.engagement_label}).

${prelude}

# Orchestrator step-list

${template}

${done}`;

    return wrapper;
}

module.exports = {
    composeScheduledJobWrappers,
    composeMcpDispatchLines,
    validateContract,
    substituteTemplate,
    composeFromOrchestratorInstructions,
    // Internal export for test inspection.
    _validateSubstitutionTokens,
    _loadOrchestratorInstructions,
    _loadSharedClauses,
    _resolveConditional,
    _substituteShared,
    _substituteStaticTokens,
};
