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

function planDispatch({ prefs, reachableNamespaces, mcpSkillMap, microscopes }) {
    if (!prefs || !Array.isArray(prefs.priorities)) return [];
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
    return plan;
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

module.exports = {
    planDispatch,
    decideDispatchMode,
    composeVoiceContract,
    composeWarningCallout,
    _titleCase: titleCase,
    _CANONICAL_TITLES: CANONICAL_TITLES,
};
