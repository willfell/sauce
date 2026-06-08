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
    // v0.96.0 additive inputs — Rail D (kind classifier) integration.
    //   tools_by_namespace + vault_root: when both are provided AND
    //     classifier_result is NOT, Step 0 below invokes
    //     classifyConnectedKinds() to populate classifier_result.
    //   classifier_result: pre-computed Rail-D result (passed by tests/callers
    //     that have already invoked the classifier). When present, Step 0 is
    //     a no-op and pending_confirmations[] is derived directly from
    //     classifier_result.new_since_last_fire.
    //   When neither is provided, classifier_result defaults to the empty
    //     4-key shell and pending_confirmations[] is [].
    tools_by_namespace,
    vault_root,
    classifier_result,
    engagement_id,
    // v0.96.0 additive inputs — Rail L (weight-aware ordering).
    //   learned_weights: per-kind learned weight state. When explicitly
    //     passed, takes precedence over prefs.learned_weights. Falls back
    //     to prefs.learned_weights (read from user-preferences.md frontmatter
    //     by read-user-preferences) when absent.
    //   today: ISO date string for day-14 backstop evaluation; helps tests
    //     pin a deterministic "today".
    learned_weights,
    today,
}) {
    const isV0951Call = (bundle !== undefined && bundle !== null)
        || engagement !== undefined
        || overrides !== undefined
        || yesterdayMemory !== undefined
        || classifier_result !== undefined
        || tools_by_namespace !== undefined
        || learned_weights !== undefined;

    // v0.96.0 Rail L: extract learned_weights from user-preferences frontmatter
    // when caller didn't pass it explicitly. Allows orchestrators to skip the
    // explicit thread and rely on prefs.learned_weights surfacing naturally
    // from read-user-preferences.
    const effective_learned_weights = (learned_weights !== undefined && learned_weights !== null)
        ? learned_weights
        : (prefs && prefs.learned_weights) || null;

    // Step 0 (v0.96.0): Classify connected kinds via Rail D.
    //   Resolves classifier_result from one of three sources, in order:
    //     1. classifier_result kwarg (pre-computed; tests/callers supply this).
    //     2. classifyConnectedKinds(reachable_namespaces, tools_by_namespace,
    //        vault_root) when both inputs are present.
    //     3. Empty shell { classified, unclassified, new_since_last_fire,
    //        cache_hits } when neither is available.
    //   Failures during (2) are caught and fall through to the empty shell
    //   so planDispatch NEVER throws — graceful degradation.
    let _classifierResult;
    if (classifier_result && typeof classifier_result === "object") {
        _classifierResult = classifier_result;
    } else if (Array.isArray(reachableNamespaces) && tools_by_namespace && typeof tools_by_namespace === "object") {
        try {
            const { classifyConnectedKinds } = require("./kind-classifier-helper");
            _classifierResult = classifyConnectedKinds({
                reachable_namespaces: reachableNamespaces,
                tools_by_namespace,
                vault_root,
            });
        } catch (_err) {
            _classifierResult = { classified: {}, unclassified: [], new_since_last_fire: [], cache_hits: [] };
        }
    } else {
        _classifierResult = { classified: {}, unclassified: [], new_since_last_fire: [], cache_hits: [] };
    }

    // pending_confirmations[]: the 14th contract key (v0.96.0).
    //   Surfaces the raw namespace names that the classifier flagged as
    //   "new since last fire" (cache miss this cycle). compose-body decides
    //   downstream whether to render the detection callout based on
    //   render_aspects.new_mcp_notice.
    const pending_confirmations = Array.isArray(_classifierResult.new_since_last_fire)
        ? _classifierResult.new_since_last_fire.slice()
        : [];

    // Best-effort state-file write: append-and-dedupe pending namespaces into
    //   spice/cowork/context/<engagement>/pending-mcps.md so the user can later
    //   confirm them via /cowork context-builder. Write failure is non-fatal.
    if (pending_confirmations.length > 0 && vault_root) {
        const effective_engagement_id = engagement_id
            || (engagement && typeof engagement === "object" ? engagement.id : null);
        if (effective_engagement_id) {
            try {
                _upsertPendingMcps(vault_root, effective_engagement_id, pending_confirmations, _classifierResult);
            } catch (_err) { /* non-fatal */ }
        }
    }

    const classifier_cache_hit = Array.isArray(_classifierResult.cache_hits)
        && _classifierResult.cache_hits.length > 0;

    if (!prefs || !Array.isArray(prefs.priorities)) {
        if (isV0951Call) {
            // Defensive: still emit the 14-key contract so the orchestrator never
            // dereferences `plan.excluded_themes`/`plan.pending_confirmations`
            // against `undefined`.
            const excluded_themes_empty = _computeExcludedThemes({ bundle, overrides, engagement, yesterdayMemory });
            return {
                dispatch_plan: [],
                excluded_themes: excluded_themes_empty,
                pending_confirmations,
                classifier_cache_hit,
                classifier_result: _classifierResult,
                learned_weights_applied: false,
            };
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
        // v0.96.0 contract object: dispatch_plan (legacy array form) PLUS
        // excluded_themes (13th key, v0.95.1) PLUS pending_confirmations
        // (14th key, v0.96.0). The plan-dispatch SKILL.md composes the
        // remaining keys (voice_contract, microscopes, siblings, allowlist,
        // render_aspects, cadence_order, tripwire_aspects, kind_titles,
        // effective_hard_rules, dispatch_mode, prefs_status) around this
        // helper's surface. classifier_cache_hit + classifier_result are
        // exposed as additional pass-through fields for the orchestrator's
        // Step 14f telemetry block.
        const excluded_themes = _computeExcludedThemes({ bundle, overrides, engagement, yesterdayMemory });

        // v0.96.0 Rail L: compute learned_weights_applied telemetry by invoking
        // composeFinalPreferences with the effective learned_weights and
        // surfacing the contract flag. This lets HC-V0960-L-15/-16 verify the
        // helper actually consulted learned_weights vs. ignored it.
        let learned_weights_applied = false;
        if (bundle && typeof bundle === "object") {
            const effectiveOverrides = (overrides && typeof overrides === "object" && !Array.isArray(overrides))
                ? overrides
                : (engagement && typeof engagement === "object" && engagement.overrides
                    && typeof engagement.overrides === "object" && !Array.isArray(engagement.overrides))
                    ? engagement.overrides
                    : null;
            const probe = composeFinalPreferences({
                bundle,
                overrides: effectiveOverrides,
                ad_hoc_prefs: null,
                learned_weights: effective_learned_weights,
                engagement_id,
                today,
            });
            learned_weights_applied = probe && probe.learned_weights_applied === true;
        }
        return {
            dispatch_plan: plan,
            excluded_themes,
            pending_confirmations,
            classifier_cache_hit,
            classifier_result: _classifierResult,
            learned_weights_applied,
        };
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
 * composeFinalPreferences({ bundle, overrides, ad_hoc_prefs, learned_weights, engagement_id, today })
 *
 * Composes the FINAL preferences tree from layered inputs.
 *   bundle          — engagement-type JSON parsed (e.g. personal.json) — required
 *   overrides       — engagement.overrides block from vault-config.md (optional;
 *                     may be absent, empty, or — defensively — malformed)
 *   ad_hoc_prefs    — optional runtime overrides (reserved; currently unused)
 *   learned_weights — v0.96.1 Rail M: nested per-engagement learned weight state
 *                     from user-preferences.md frontmatter (optional). Accepts
 *                     both v1.1.0 nested shape (`engagements.<id>.per_kind`) and
 *                     legacy v0.96.0 single-engagement shape (top-level
 *                     `engagement_id`+`per_kind`+`totals`) — _normalizeLearnedWeights
 *                     migrates legacy → nested transparently on read. When the
 *                     engagement_id slot exists AND any kind is out-of-warmup AND
 *                     |weight - 1.00| > 0.20, re-orders cadence_order arrays via
 *                     effective_priority.
 *   engagement_id   — v0.96.1: required for learned_weights lookup. When absent
 *                     OR the engagement slot is missing in the nested shape,
 *                     no weight-aware reorder fires (learned_weights_applied=false).
 *   today           — optional ISO date (YYYY-MM-DD) for day-14 backstop
 *                     evaluation. Defaults to current date.
 *
 * Composition rules:
 *   - Objects (render_aspects, cadence_order, voice): bundle ⨁ overrides
 *     (override wins per-key)
 *   - Arrays (tripwire_aspects): overrides REPLACES bundle when present
 *   - microscopes_registry: overrides.value || bundle.value || null
 *     (null triggers filesystem scan downstream)
 *
 * v0.96.0 weight-aware ordering (Rail L):
 *   For each kind in each cadence_order[cadence] array, compute:
 *     base_priority      = i (declared index)
 *     effective_priority = base - (weight * 5)  IF warmup === false AND
 *                                                  abs(weight - 1.00) > 0.20
 *                        = base                  otherwise
 *   Day-14 must-surface backstop:
 *     For the lowest-weight non-warmup kind, when days_since_last_surfaced
 *     (or last_updated) is a positive multiple of 14:
 *       effective_priority = base - (5 * 5) = base - 25
 *     This guarantees a low-weight kind cannot permanently fall off cadence.
 *   Each cadence is re-sorted by effective_priority ascending. When no
 *   weight-aware adjustment fires, cadence_order is unchanged.
 *   The result exposes `learned_weights_applied: boolean` so callers can
 *   verify the helper actually consulted learned_weights vs. ignored it.
 *
 * Defensive: when bundle is null/non-object, returns an empty 5-key shell
 * (plus learned_weights_applied=false). When overrides is non-object, treated
 * as absent (Postel — caller can surface a warning Notice independently).
 */
function composeFinalPreferences({ bundle, overrides, ad_hoc_prefs, learned_weights, engagement_id, today } = {}) {
    const emptyShell = {
        render_aspects: {},
        cadence_order: {},
        voice: {},
        microscopes_registry: null,
        tripwire_aspects: [],
        learned_weights_applied: false,
    };
    if (!bundle || typeof bundle !== "object") return emptyShell;
    const ov = (overrides && typeof overrides === "object" && !Array.isArray(overrides)) ? overrides : {};
    const adHoc = (ad_hoc_prefs && typeof ad_hoc_prefs === "object" && !Array.isArray(ad_hoc_prefs)) ? ad_hoc_prefs : {};

    const composed_cadence_order = Object.assign({}, bundle.cadence_order || {}, ov.cadence_order || {}, adHoc.cadence_order || {});

    // v0.96.0 Rail L: weight-aware cadence_order reorder
    const DEVIATION = 0.20;
    const PRIORITY_BUMP = 5;
    const BACKSTOP_DAYS = 14;
    const BACKSTOP_MULTIPLIER = 5;
    // v0.96.1 Rail M: support nested learned_weights shape; backwards-compatible
    // with v0.96.0 single-engagement shape via _normalizeLearnedWeights. Per-kind
    // state lives at normalized.engagements[engagement_id].per_kind.
    //
    // Backwards-compat fallback: if engagement_id is NOT provided AND learned_weights
    // carries top-level per_kind (the pre-Rail-M v0.96.0 raw shape consumed by
    // HC-V0960-L-14/L-15/L-16/L-17), read per_kind directly. This preserves the
    // v0.96.0 single-engagement contract for callers that have not yet migrated to
    // pass engagement_id.
    const { _normalizeLearnedWeights } = require("./learn-from-checks-helper");
    let lwPerKind = null;
    if (engagement_id) {
        const normalizedLW = _normalizeLearnedWeights(learned_weights);
        const engagementLW = (normalizedLW.engagements && normalizedLW.engagements[engagement_id]) || null;
        lwPerKind = (engagementLW && engagementLW.per_kind && typeof engagementLW.per_kind === "object")
            ? engagementLW.per_kind : null;
    } else if (learned_weights && typeof learned_weights === "object"
            && learned_weights.per_kind && typeof learned_weights.per_kind === "object") {
        // Legacy v0.96.0 fallback: top-level per_kind without engagement_id arg.
        lwPerKind = learned_weights.per_kind;
    }
    const todayStr = (typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today))
        ? today : new Date().toISOString().slice(0, 10);

    function _daysSince(dateStr) {
        if (!dateStr || typeof dateStr !== "string") return Infinity;
        const a = new Date(todayStr);
        const b = new Date(dateStr);
        if (isNaN(a.getTime()) || isNaN(b.getTime())) return Infinity;
        return Math.floor((a - b) / (1000 * 60 * 60 * 24));
    }

    let learned_weights_applied = false;
    let final_cadence_order = composed_cadence_order;

    if (lwPerKind) {
        final_cadence_order = {};
        // Find lowest-weight kind globally (excluding warmup) for backstop computation.
        // We do this once across all kinds in learned_weights, not per-cadence, so
        // the same low-weight kind is consistently flagged regardless of which
        // cadence array we are sorting.
        let lowestWeight = null;
        for (const kind of Object.keys(lwPerKind)) {
            const s = lwPerKind[kind] || {};
            if (s.warmup === false && typeof s.weight === "number") {
                if (lowestWeight === null || s.weight < lowestWeight) lowestWeight = s.weight;
            }
        }
        for (const cadenceName of Object.keys(composed_cadence_order)) {
            const arr = composed_cadence_order[cadenceName];
            if (!Array.isArray(arr)) {
                final_cadence_order[cadenceName] = arr;
                continue;
            }
            const decorated = arr.map((kind, i) => {
                const base_priority = i;
                const lwState = lwPerKind[kind] || { weight: 1.00, warmup: true };
                const weight = (typeof lwState.weight === "number") ? lwState.weight : 1.00;
                const warmup = lwState.warmup !== false;
                const deviation = Math.abs(weight - 1.00);

                let effective_priority;
                if (warmup || deviation <= DEVIATION) {
                    effective_priority = base_priority;
                } else {
                    effective_priority = base_priority - (weight * PRIORITY_BUMP);
                    learned_weights_applied = true;
                }

                // Day-14 must-surface backstop: lowest-weight kind gets a bigger bump
                // every 14 days since last_surfaced (or last_updated).
                const lastSurfaced = lwState.last_surfaced || lwState.last_updated || null;
                const days_since = _daysSince(lastSurfaced);
                const isLowest = !warmup && lowestWeight !== null && weight === lowestWeight;
                if (isLowest && Number.isFinite(days_since) && days_since > 0 && days_since % BACKSTOP_DAYS === 0) {
                    effective_priority = base_priority - (PRIORITY_BUMP * BACKSTOP_MULTIPLIER);
                    learned_weights_applied = true;
                }
                return { kind, i, effective_priority };
            });
            // Stable sort by effective_priority ascending; preserve declared order for ties.
            decorated.sort((a, b) => (a.effective_priority - b.effective_priority) || (a.i - b.i));
            final_cadence_order[cadenceName] = decorated.map((d) => d.kind);
        }
    }

    return {
        render_aspects:       Object.assign({}, bundle.render_aspects || {}, ov.render_aspects || {}, adHoc.render_aspects || {}),
        cadence_order:        final_cadence_order,
        voice:                Object.assign({}, bundle.voice           || {}, ov.voice           || {}, adHoc.voice           || {}),
        microscopes_registry: adHoc.microscopes_registry || ov.microscopes_registry || bundle.microscopes_registry || null,
        tripwire_aspects:     Array.isArray(adHoc.tripwire_aspects) ? adHoc.tripwire_aspects.slice()
                            : Array.isArray(ov.tripwire_aspects)    ? ov.tripwire_aspects.slice()
                            : Array.isArray(bundle.tripwire_aspects) ? bundle.tripwire_aspects.slice()
                            : [],
        learned_weights_applied,
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

// ===========================================================================
// v0.96.0 additive — Rail D pending-MCP state-file management
// ===========================================================================

/**
 * _upsertPendingMcps(vault_root, engagement_id, pending_namespaces, classifierResult)
 *
 * Append-and-dedupe write to spice/cowork/context/<engagement_id>/pending-mcps.md.
 * Accumulates MCPs auto-detected by Rail D but not yet confirmed in
 * `user-preferences.mcps`. The user later confirms them via
 * `/cowork context-builder`.
 *
 * Idempotent: existing entries (matched by namespace via backtick capture) are
 * not duplicated. Each new entry is appended with the classified kind +
 * first-seen ISO timestamp.
 *
 * Best-effort: callers wrap in try/catch — state-file write failures must
 * never abort an orchestrator's atomic-note emission.
 */
function _upsertPendingMcps(vault_root, engagement_id, pending_namespaces, classifierResult) {
    const fs = require("node:fs");
    const path = require("node:path");
    const dir = path.join(vault_root, "spice/cowork/context", engagement_id);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "pending-mcps.md");

    let existing = "";
    try { existing = fs.readFileSync(filePath, "utf8"); } catch (_) { /* new file */ }

    const existingNamespaces = new Set(
        existing.split("\n")
            .filter((l) => l.startsWith("- "))
            .map((l) => {
                const m = l.match(/`([^`]+)`/);
                return m ? m[1] : null;
            })
            .filter(Boolean)
    );

    const classified = (classifierResult && classifierResult.classified) || {};
    const now = new Date().toISOString();
    const newEntries = pending_namespaces
        .filter((ns) => !existingNamespaces.has(ns))
        .map((ns) => {
            const kind = (classified[ns] && classified[ns].kind) || "unclassified";
            return `- \`${ns}\` → ${kind} (first seen ${now})`;
        });

    if (newEntries.length === 0) return;

    const isNew = !existing || existing.length === 0;
    const header = isNew
        ? `---\ntype: cowork-pending-mcps\nengagement_id: ${engagement_id}\n---\n\n# Pending MCP confirmations\n\nThis file accumulates MCPs auto-detected by Rail D but not yet confirmed in \`user-preferences.mcps\`. Run \`/cowork context-builder\` to confirm.\n\n`
        : "";
    const body = isNew ? "" : (existing.endsWith("\n") ? existing : existing + "\n");
    fs.writeFileSync(filePath, header + body + newEntries.join("\n") + "\n", "utf8");
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
    _upsertPendingMcps,
    _titleCase: titleCase,
    _CANONICAL_TITLES: CANONICAL_TITLES,
    _parseEngagementByIdFromYaml,
    _parseEngagementBlock,
};
