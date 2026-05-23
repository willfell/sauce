// context-builder-dry-run.js
//
// Implements compose + merge + write for cowork:context-builder. Same code
// path serves the live skill body (which passes computed answers) and the
// HC-V0760-F1..F2 harness (which passes canned dry_run_answers directly).

"use strict";

const fs = require("fs");
const path = require("path");

const TODAY_YMD = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function readExistingPrefs(prefsPath) {
    if (!fs.existsSync(prefsPath)) return null;
    const body = fs.readFileSync(prefsPath, "utf8");
    const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    return parseYamlIsh(fmMatch[1]);
}

// Minimal YAML-ish parser: supports flat keys, nested 2-level under `mcps:`,
// list values (`- item`), inline `[a, b]` lists, and string values. Not a full
// YAML parser; sufficient for the user-preferences.md shape.
function parseYamlIsh(yaml) {
    const out = {};
    const lines = yaml.split("\n");
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
        const flat = line.match(/^([a-z_]+):\s*(.*)$/);
        if (!flat) { i++; continue; }
        const [, key, valRaw] = flat;
        const val = valRaw.trim();
        if (val === "") {
            // Could be a nested object or a list — peek ahead
            const nextLines = [];
            i++;
            while (i < lines.length && (lines[i].startsWith("  ") || lines[i].startsWith("\t") || lines[i].trim() === "")) {
                nextLines.push(lines[i]);
                i++;
            }
            // List of strings?
            if (nextLines.every(l => !l.trim() || /^\s+- /.test(l))) {
                out[key] = nextLines.filter(l => l.trim()).map(l => l.replace(/^\s+-\s*/, "").trim());
            } else {
                // Nested map (one level deep for `mcps:` or `personality:`)
                out[key] = parseYamlIsh(nextLines.map(l => l.replace(/^  /, "")).join("\n"));
            }
            continue;
        }
        if (val.startsWith("[") && val.endsWith("]")) {
            out[key] = val.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
        } else if (val === "true") out[key] = true;
        else if (val === "false") out[key] = false;
        else if (val === "null") out[key] = null;
        else if (/^-?\d+$/.test(val)) out[key] = parseInt(val, 10);
        else out[key] = val.replace(/^["']|["']$/g, "");
        i++;
    }
    return out;
}

function composeYaml(prefs) {
    const lines = [];
    lines.push("---");
    lines.push("type: cowork-user-preferences");
    lines.push(`updated: ${prefs.updated}`);
    lines.push(`updated_by: ${prefs.updated_by}`);
    lines.push("");
    lines.push("priorities:");
    for (const p of (prefs.priorities || [])) lines.push(`  - ${p}`);
    lines.push("");
    lines.push("personality:");
    lines.push(`  vibe: ${prefs.personality.vibe}`);
    lines.push(`  formality: ${prefs.personality.formality}`);
    lines.push(`  pep_talk: ${prefs.personality.pep_talk}`);
    lines.push(`  length: ${prefs.personality.length}`);
    lines.push("");
    lines.push("mcps:");
    for (const [kind, block] of Object.entries(prefs.mcps || {})) {
        lines.push(`  ${kind}:`);
        for (const [k, v] of Object.entries(block)) {
            if (Array.isArray(v)) {
                lines.push(`    ${k}: [${v.map(x => JSON.stringify(x)).join(", ")}]`);
            } else if (typeof v === "boolean" || typeof v === "number") {
                lines.push(`    ${k}: ${v}`);
            } else {
                lines.push(`    ${k}: ${JSON.stringify(v)}`);
            }
        }
    }
    lines.push("---");
    lines.push("");
    return lines.join("\n");
}

// v0.77.0 Workstream B: tool-pattern detection. Capability-subset model —
// an MCP namespace satisfies a `kind` when its tool set contains ALL of the
// kind's `required_tools`, OR fully satisfies any branch of `tool_alternatives`.
// A single namespace can satisfy multiple kinds (Outlook UUID = calendar + email + chat).
//
// availableTools: array of "mcp__<ns>__<tool>" strings (the agent's tool list)
// mcpSkillMap:    parsed mcp-skill-map.json (v2.0.0 shape)
//
// returns: { detected: [{kind, served_by, matched_tools, gather_skill}], unmapped_namespaces: [...] }
function detectCapabilities(availableTools, mcpSkillMap) {
    // Group tools by namespace
    const toolsByNamespace = {};
    for (const fullName of (availableTools || [])) {
        if (!fullName.startsWith("mcp__")) continue;
        const inner = fullName.substring("mcp__".length);
        const idx = inner.lastIndexOf("__");
        if (idx < 0) continue;
        const ns = inner.substring(0, idx);
        const tool = inner.substring(idx + 2);
        if (!ns || !tool) continue;
        if (!toolsByNamespace[ns]) toolsByNamespace[ns] = new Set();
        toolsByNamespace[ns].add(tool);
    }

    const detected = [];
    const bound = new Set(); // ns values that satisfied at least one kind

    for (const entry of (mcpSkillMap.kinds || [])) {
        const required = entry.required_tools || [];
        const alts = entry.tool_alternatives || [];
        for (const ns of Object.keys(toolsByNamespace)) {
            const tools = toolsByNamespace[ns];
            const allReq = required.length > 0 && required.every(t => tools.has(t));
            const anyAlt = alts.length > 0 && alts.some(alt =>
                Array.isArray(alt) && alt.length > 0 && alt.every(t => tools.has(t))
            );
            // A kind with `tool_alternatives` requires both (a) required_tools fully present
            // AND (b) at least one alt branch fully present. A kind without tool_alternatives
            // is satisfied by required_tools alone.
            const matches = alts.length > 0
                ? (allReq && anyAlt)
                : allReq;
            if (matches) {
                // Compose matched_tools = union of required_tools + matched-alt + optional_tools present
                const matchedAlts = alts.find(a => a.every(t => tools.has(t))) || [];
                const optionals = (entry.optional_tools || []).filter(t => tools.has(t));
                const matched_tools = Array.from(new Set([...required, ...matchedAlts, ...optionals]));
                detected.push({
                    kind: entry.kind,
                    served_by: ns,
                    matched_tools,
                    gather_skill: entry.gather_skill,
                });
                bound.add(ns);
            }
        }
    }

    const unmapped_namespaces = Object.keys(toolsByNamespace).filter(ns => !bound.has(ns));

    return { detected, unmapped_namespaces };
}

function run(opts) {
    const { vaultRoot, dryRunAnswers } = opts || {};
    if (!vaultRoot) throw new Error("context-builder-dry-run.run: vaultRoot is required");
    if (!dryRunAnswers) throw new Error("context-builder-dry-run.run: dryRunAnswers is required");

    const prefsPath = path.join(vaultRoot, "spice/cowork/context/user-preferences.md");
    const existing = readExistingPrefs(prefsPath);

    // Build new mcps map: walk-or-update from per_mcp_answers; preserve disconnected;
    // skip when action == 'Skip' (use existing block); clear when action == 'Clear'.
    const newMcps = {};
    const detected = new Set(dryRunAnswers.detected_mcps || []);
    const actions = dryRunAnswers.per_mcp_actions || {};
    const answers = dryRunAnswers.per_mcp_answers || {};

    // First, carry forward existing blocks per action (or preserve-disconnected if
    // not detected this run).
    if (existing && existing.mcps) {
        for (const [kind, block] of Object.entries(existing.mcps)) {
            const detectedThisRun = detected.has(kind);
            const action = actions[kind];
            if (!detectedThisRun) {
                // Preserve disconnected
                newMcps[kind] = Object.assign({}, block, { connected: false, last_seen: block.captured_at || existing.updated });
            } else if (action === "Clear") {
                // drop the block
            } else if (action === "Skip") {
                // unchanged
                newMcps[kind] = block;
            } else if (action === "Update" && answers[kind]) {
                newMcps[kind] = Object.assign({ captured_at: TODAY_YMD() }, answers[kind]);
            } else {
                // No action specified (treat as Walk if no existing block; else Skip)
                newMcps[kind] = block;
            }
        }
    }

    // Then, add NEW blocks for detected MCPs that weren't in existing.
    for (const kind of detected) {
        if (newMcps[kind]) continue;  // already handled above
        const ans = answers[kind] || {};
        newMcps[kind] = Object.assign({ captured_at: TODAY_YMD() }, ans);
    }

    const newPrefs = {
        type: "cowork-user-preferences",
        updated: TODAY_YMD(),
        updated_by: "cowork:context-builder",
        priorities: dryRunAnswers.priorities || (existing && existing.priorities) || [],
        personality: dryRunAnswers.personality || (existing && existing.personality) || {
            vibe: null, formality: null, pep_talk: null, length: null,
        },
        mcps: newMcps,
    };

    // Ensure directory exists
    fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
    fs.writeFileSync(prefsPath, composeYaml(newPrefs), "utf8");

    return {
        path: prefsPath,
        mcps_count: Object.keys(newMcps).length,
        priorities: newPrefs.priorities,
    };
}

module.exports = {
    run,
    detectCapabilities,
    _parseYamlIsh: parseYamlIsh,
    _composeYaml: composeYaml,
};
