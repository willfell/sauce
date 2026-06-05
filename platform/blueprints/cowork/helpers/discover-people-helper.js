/* eslint-disable no-console */
/**
 * discover-people-helper.js — v0.28.0 (sauce v0.90.0)
 *
 * Pure helpers backing cowork:discover-people. No MCP calls, no fs (the
 * pure paths), no stdout. Parses microscope ## What matters prose,
 * people-aliases.md sibling tables, and vault-config.md frontmatter to
 * produce a candidate-people list with provenance + classification.
 */
"use strict";

// --- parseInnerCircleFromMicroscope ------------------------------------------

function parseInnerCircleFromMicroscope(body) {
    if (!body || typeof body !== "string") return [];
    const lines = body.split("\n");
    let inSection = false;
    const sectionLines = [];
    for (const line of lines) {
        if (/^##\s+What\s+matters\b/i.test(line)) { inSection = true; continue; }
        if (inSection && /^##\s+/.test(line)) break;
        if (inSection) sectionLines.push(line);
    }
    if (sectionLines.length === 0) return [];
    const text = sectionLines.join("\n");
    const out = new Set();

    // "Inner circle (people)...: A, B, C, ..."
    const innerMatch = text.match(/Inner\s+circle\s*\(\s*people\s*\)[^:]*:\s*([^\n.]+)/i);
    if (innerMatch) {
        const namesPart = innerMatch[1];
        namesPart.split(/,\s*|\s+and\s+/).forEach(n => {
            const cleaned = n.trim().replace(/[.]+$/, "");
            if (cleaned && /^[A-Z]/.test(cleaned)) out.add(cleaned);
        });
    }

    // "Priority pair: A and B"
    const priorityMatch = text.match(/Priority\s+pair\s*:\s*([^.\n]+)/i);
    if (priorityMatch) {
        priorityMatch[1].split(/,\s*|\s+and\s+/).forEach(n => {
            const cleaned = n.trim().replace(/[.]+$/, "");
            if (cleaned && /^[A-Z]/.test(cleaned)) out.add(cleaned);
        });
    }

    // Bare bullet lines under elevation signals: "- Single Name." or "- First Last."
    const bullets = sectionLines.filter(l => /^\s*-\s+[A-Z]/.test(l));
    for (const b of bullets) {
        // Match: "- First Last." (one or more capitalized words, ending with optional period)
        const m = b.match(/^\s*-\s+([A-Z][a-z]+(?:\s+(?:de|van|von|der|du|la|le)\s+)?(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)?)\.?\s*$/);
        if (m && m[1]) out.add(m[1].trim());
    }

    return Array.from(out);
}

// --- parsePromotionRowsFromSibling -------------------------------------------

function parsePromotionRowsFromSibling(body) {
    const result = { rows: [], suppress_list: [] };
    if (!body || typeof body !== "string") return result;

    // Strip frontmatter
    const stripped = body.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");

    // Split into sections — the BODY before any ## heading is the "default" section
    // (which by convention is the inner-circle table). Subsequent ## sections are
    // identified by their heading text.
    const parts = stripped.split(/^##\s+/m);

    parts.forEach((section, idx) => {
        const firstLine = section.split("\n")[0] || "";
        const isInnerCircle = (idx === 0) || (/inner\s+circle/i.test(firstLine) && !/observed|frequent/i.test(firstLine));
        const isFrequent = /frequent\s+collaborators|observed/i.test(firstLine);
        const isSuppress = /personal|non-work|suppress/i.test(firstLine);
        const isElevation = /elevation/i.test(firstLine) && !/inner/i.test(firstLine);

        if (!isInnerCircle && !isFrequent && !isSuppress && !isElevation) return;

        const tableRows = section.split("\n").filter(l => /^\|/.test(l));
        let sawHeader = false;
        for (const row of tableRows) {
            if (/---/.test(row)) continue;
            // Trim leading/trailing pipes and split
            const cells = row.split("|").slice(1, -1).map(c => c.trim());
            if (cells.length < 2) continue;

            // Detect header row (first non-empty row that looks like a header)
            if (!sawHeader) {
                const looksHeader = /^(name|inner circle|canonical|status|promote)/i.test(cells[0]);
                if (looksHeader) { sawHeader = true; continue; }
            }

            if (isSuppress) {
                if (cells[0]) result.suppress_list.push(cells[0]);
                continue;
            }

            // canonical_name is column 1 (index 1); status is last column
            const canonical = (cells[1] && cells[1].length > 0) ? cells[1] : cells[0];
            const statusRaw = (cells[cells.length - 1] || "").toLowerCase();
            let normStatus = statusRaw;
            if (statusRaw === "confirmed" || statusRaw.includes("confirmed")) normStatus = "confirmed";
            else if (statusRaw === "promoted") normStatus = "promoted";
            else if (statusRaw === "skip" || statusRaw.includes("skip")) normStatus = "skip";
            else if (statusRaw === "confirm") normStatus = "confirm";

            const section_name = isInnerCircle ? "inner_circle"
                : isFrequent ? "frequent_collaborators"
                : isElevation ? "elevation"
                : "unknown";
            result.rows.push({ canonical_name: canonical, section: section_name, status: normStatus });
        }
    });
    return result;
}

// --- parseStakeholdersFromVaultConfig ---------------------------------------

function parseStakeholdersFromVaultConfig(body, engagement_id) {
    if (!body || !engagement_id) return [];
    const fmMatch = body.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (!fmMatch) return [];
    const fm = fmMatch[1];

    // Walk lines looking for the engagement block; engagement blocks start with
    // "  - id: <id>" (2-space indented). Capture from there until the next
    // engagement OR until a top-level key (no leading whitespace).
    const lines = fm.split("\n");
    let inBlock = false;
    const blockLines = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Top-level key starts the engagement
        const engStart = line.match(/^  -\s+id:\s+["']?([^"'\s]+)["']?\s*$/);
        if (engStart) {
            if (engStart[1] === engagement_id) {
                inBlock = true;
                blockLines.push(line);
                continue;
            }
            if (inBlock) break;  // entered next engagement, stop
        }
        // Top-level key (no leading indent) ends the engagement block
        if (inBlock && /^[a-z]/.test(line)) break;
        if (inBlock) blockLines.push(line);
    }

    const engBlock = blockLines.join("\n");
    const names = new Set();

    // stakeholders array
    const stakeMatch = engBlock.match(/stakeholders:\s*\n((?:\s{4,}-\s+.*\n?)+)/);
    if (stakeMatch) {
        stakeMatch[1].split("\n").forEach(l => {
            const nm = l.match(/^\s+-\s+["']?([^"'\n]+?)["']?\s*$/);
            if (nm && nm[1] && nm[1].trim()) names.add(nm[1].trim());
        });
    }

    // manager (single string)
    const mgrMatch = engBlock.match(/manager:\s+["']?([^"'\n]+?)["']?\s*$/m);
    if (mgrMatch && mgrMatch[1]) names.add(mgrMatch[1].trim());

    // direct_reports array
    const drMatch = engBlock.match(/direct_reports:\s*\n((?:\s{4,}-\s+.*\n?)+)/);
    if (drMatch) {
        drMatch[1].split("\n").forEach(l => {
            const nm = l.match(/^\s+-\s+["']?([^"'\n]+?)["']?\s*$/);
            if (nm && nm[1] && nm[1].trim()) names.add(nm[1].trim());
        });
    }

    return Array.from(names);
}

// --- parseCurrentInnerCircle ------------------------------------------------

function parseCurrentInnerCircle(body, engagement_id) {
    if (!body || !engagement_id) return [];
    const fmMatch = body.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (!fmMatch) return [];
    const fm = fmMatch[1];
    const lines = fm.split("\n");
    let inBlock = false;
    let inInner = false;
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const engStart = line.match(/^  -\s+id:\s+["']?([^"'\s]+)["']?\s*$/);
        if (engStart) {
            if (engStart[1] === engagement_id) { inBlock = true; continue; }
            if (inBlock) break;
        }
        if (inBlock && /^[a-z]/.test(line)) break;
        if (inBlock && /^    inner_circle_people:\s*$/.test(line)) { inInner = true; continue; }
        if (inInner) {
            const nm = line.match(/^\s{6,}-\s+["']?([^"'\n]+?)["']?\s*$/);
            if (nm && nm[1]) out.push(nm[1].trim());
            else if (/^\S/.test(line) || /^    [a-z]/.test(line)) inInner = false;
        }
    }
    return out;
}

// --- aggregateCandidates ----------------------------------------------------

function aggregateCandidates({ microscopeNames, siblingRows, vaultConfigNames }) {
    const map = new Map();
    const _norm = s => String(s).trim().toLowerCase();
    const _add = (name, source) => {
        if (!name || !String(name).trim()) return;
        const key = _norm(name);
        if (!map.has(key)) map.set(key, { canonical_name: String(name).trim(), sources: [] });
        map.get(key).sources.push(source);
    };
    Object.keys(microscopeNames || {}).forEach(kind => {
        (microscopeNames[kind] || []).forEach(name => {
            _add(name, {
                source_type: "microscope",
                source_kind: kind,
                source_path: `spice/cowork/prompts/per-mcp/${kind}/microscope.md`,
            });
        });
    });
    Object.keys(siblingRows || {}).forEach(kind => {
        (siblingRows[kind] || []).forEach(row => {
            _add(row.canonical_name, {
                source_type: "sibling",
                source_kind: kind,
                source_path: `spice/cowork/prompts/per-mcp/${kind}/people-aliases.md`,
                sibling_status: row.status,
                sibling_section: row.section,
            });
        });
    });
    (vaultConfigNames || []).forEach(name => {
        _add(name, {
            source_type: "vault_config",
            source_path: "spice/cowork/context/vault-config.md",
        });
    });
    return Array.from(map.values());
}

// --- classifyCandidate ------------------------------------------------------

function classifyCandidate({ candidate, resolveResult, current_inner_circle, suppress_list }) {
    const lname = String(candidate && candidate.canonical_name || "").toLowerCase();
    const inSuppress = (suppress_list || []).some(s => String(s).toLowerCase() === lname);
    if (inSuppress) return "SUPPRESS";
    const inInner = (current_inner_circle || []).some(s => String(s).toLowerCase() === lname);
    if (inInner) return "ALREADY_PROMOTED";
    const skippedInSibling = (candidate.sources || []).some(s => s.sibling_status === "skip");
    if (skippedInSibling) return "SUPPRESS";
    if (resolveResult && resolveResult.resolved) return "PROMOTE_EXISTING";
    return "CREATE_AND_PROMOTE";
}

// --- composePersonNoteStub --------------------------------------------------

function composePersonNoteStub({ canonical_name, aliases, sources }) {
    const aliasArr = Array.isArray(aliases) ? aliases : [];
    const aliasYaml = aliasArr.length
        ? "\n" + aliasArr.map(a => `  - {type: ${a.type}, value: ${JSON.stringify(a.value)}}`).join("\n")
        : " []";
    const provLine = (sources || [])
        .map(s => `${s.source_type}${s.source_kind ? "/" + s.source_kind : ""}`)
        .join(", ");
    return [
        "---",
        `name: ${canonical_name}`,
        `aliases:${aliasYaml}`,
        `created_by: cowork:discover-people`,
        "---",
        "",
        `# ${canonical_name}`,
        "",
        `> [!info]- Discovered by cowork:discover-people`,
        `> Sources: ${provLine || "(none recorded)"}`,
        "",
    ].join("\n");
}

// --- composeUpdatedSibling --------------------------------------------------

function composeUpdatedSibling(body, name_status_map) {
    if (!body || typeof body !== "string") return body || "";
    if (!name_status_map || typeof name_status_map !== "object") return body;
    const targetNames = Object.keys(name_status_map);
    if (targetNames.length === 0) return body;
    const lines = body.split("\n");
    const out = lines.map(line => {
        if (!/^\|/.test(line)) return line;
        // Split cells, preserving leading/trailing empty (border pipes)
        const cells = line.split("|");
        // Find the canonical_name cell — could be column 1 OR 2 depending on table shape
        for (const name of targetNames) {
            const matchIdx = cells.findIndex(c => c.trim() === name);
            if (matchIdx === -1) continue;
            // Find the last non-empty cell (status column)
            let lastIdx = cells.length - 1;
            while (lastIdx > 0 && cells[lastIdx].trim() === "") lastIdx--;
            if (lastIdx <= matchIdx) continue;
            if (cells[lastIdx].trim() === "confirm") {
                cells[lastIdx] = ` ${name_status_map[name]} `;
                return cells.join("|");
            }
        }
        return line;
    });
    return out.join("\n");
}

// --- composeUpdatedVaultConfig ----------------------------------------------

function composeUpdatedVaultConfig(body, engagement_id, names_to_append) {
    if (!body || !engagement_id || !Array.isArray(names_to_append)) return body || "";
    if (names_to_append.length === 0) return body;

    const fmMatch = body.match(/^(---\s*\n)([\s\S]*?)(\n---\s*\n?)/);
    if (!fmMatch) return body;
    const before = fmMatch[1];
    let fm = fmMatch[2];
    const after = body.slice(fmMatch[0].length);

    // Find the engagement block start line index
    const lines = fm.split("\n");
    let engStart = -1;
    let engEnd = lines.length;
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^  -\s+id:\s+["']?([^"'\s]+)["']?\s*$/);
        if (m && m[1] === engagement_id) {
            engStart = i;
            // Find end: next "  - id:" OR top-level key OR EOF
            for (let j = i + 1; j < lines.length; j++) {
                if (/^  -\s+id:/.test(lines[j]) || /^[a-z]/.test(lines[j])) { engEnd = j; break; }
            }
            break;
        }
    }
    if (engStart === -1) return body;  // engagement not found

    // Find inner_circle_people within the engagement block
    let icStart = -1;
    let icEnd = engEnd;
    for (let i = engStart; i < engEnd; i++) {
        if (/^    inner_circle_people:\s*$/.test(lines[i])) {
            icStart = i;
            for (let j = i + 1; j < engEnd; j++) {
                if (/^    [a-z]/.test(lines[j])) { icEnd = j; break; }
                if (j === engEnd - 1) icEnd = j + 1;
            }
            break;
        }
    }

    if (icStart === -1) {
        // No inner_circle_people block; insert one at the end of the engagement
        const insertion = [
            "    inner_circle_people:",
            ...names_to_append.map(n => `      - "${n}"`),
        ];
        lines.splice(engEnd, 0, ...insertion);
    } else {
        // Collect existing entries
        const existingNames = new Set();
        for (let i = icStart + 1; i < icEnd; i++) {
            const nm = lines[i].match(/^\s+-\s+["']?([^"'\n]+?)["']?\s*$/);
            if (nm && nm[1]) existingNames.add(nm[1].trim());
        }
        // Append unique new names
        const appendLines = names_to_append
            .filter(n => !existingNames.has(n))
            .map(n => `      - "${n}"`);
        if (appendLines.length) lines.splice(icEnd, 0, ...appendLines);
    }

    fm = lines.join("\n");
    return before + fm + after;
}

// --- composeReviewTable -----------------------------------------------------

function composeReviewTable(candidates_with_status) {
    const groups = { CREATE_AND_PROMOTE: [], PROMOTE_EXISTING: [], ALREADY_PROMOTED: [], SUPPRESS: [] };
    (candidates_with_status || []).forEach(c => {
        if (groups[c.status]) groups[c.status].push(c);
    });
    const lines = [];
    let rowNum = 1;
    const _fmtSources = sources =>
        (sources || []).map(s => `${s.source_type}${s.source_kind ? ":" + s.source_kind : ""}`).join(", ");
    ["CREATE_AND_PROMOTE", "PROMOTE_EXISTING", "ALREADY_PROMOTED", "SUPPRESS"].forEach(status => {
        if (groups[status].length === 0) return;
        lines.push(`### ${status} (${groups[status].length})`);
        lines.push("");
        lines.push("| # | Canonical Name | Sources |");
        lines.push("|---|---|---|");
        groups[status].forEach(c => {
            lines.push(`| ${rowNum++} | ${c.canonical_name} | ${_fmtSources(c.sources)} |`);
        });
        lines.push("");
    });
    return lines.join("\n");
}

// --- composeReport ----------------------------------------------------------

function composeReport({ applied, skipped, sources_scanned, engagement_id }) {
    const lines = [];
    lines.push(`# cowork:discover-people report — engagement \`${engagement_id || "(unknown)"}\``);
    lines.push("");
    lines.push("## Applied");
    lines.push("");
    if (applied && applied.length) applied.forEach(a => lines.push(`- **${a.canonical_name}** — ${a.action}`));
    else lines.push("(none)");
    lines.push("");
    lines.push("## Skipped");
    lines.push("");
    if (skipped && skipped.length) skipped.forEach(s => lines.push(`- **${s.canonical_name}** — ${s.reason}`));
    else lines.push("(none)");
    lines.push("");
    lines.push("## Sources scanned");
    lines.push("");
    if (sources_scanned && sources_scanned.length) sources_scanned.forEach(s => lines.push(`- ${s}`));
    else lines.push("(none)");
    return lines.join("\n");
}

module.exports = {
    parseInnerCircleFromMicroscope,
    parsePromotionRowsFromSibling,
    parseStakeholdersFromVaultConfig,
    parseCurrentInnerCircle,
    aggregateCandidates,
    classifyCandidate,
    composePersonNoteStub,
    composeUpdatedSibling,
    composeUpdatedVaultConfig,
    composeReviewTable,
    composeReport,
};
