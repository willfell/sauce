/* eslint-disable no-console */
/**
 * find-missing-people-helper.js — v0.29.0 (sauce v0.91.0)
 *
 * Pure helpers backing cowork:find-missing-people. No MCP calls, no fs,
 * no stdout. Scans atomic-note bodies for [[Name]] wikilinks; filters to
 * person-shape candidates; diffs against existing spice/people/ basenames;
 * composes person-note stubs with surface provenance.
 *
 * Reuses _isLikelyPersonName + KNOWN_NON_PERSON_NAMES from
 * discover-people-helper.js for filter consistency.
 */
"use strict";

const path = require("path");
let DPH;
try {
    DPH = require(path.join(__dirname, "discover-people-helper.js"));
} catch (_) {
    DPH = null;
}

// --- scanAtomicNoteForWikilinks ----------------------------------------------

function scanAtomicNoteForWikilinks(body) {
    if (!body || typeof body !== "string") return [];
    const out = new Set();
    // Match [[Target]] but not ![[Embed]] or [[Target|Alias]] target alias
    // (we still capture the target — the alias is just display).
    const re = /(?<!!)\[\[([^\]|#]+?)(?:\|[^\]]+)?\]\]/g;
    let m;
    while ((m = re.exec(body)) !== null) {
        const target = m[1].trim();
        if (target) out.add(target);
    }
    return Array.from(out);
}

// --- filterToPersonShapedWikilinks -------------------------------------------

function filterToPersonShapedWikilinks(wikilinks) {
    if (!Array.isArray(wikilinks)) return [];
    return wikilinks.filter(link => {
        if (!link || typeof link !== "string") return false;
        // Reject path-shaped links
        if (link.includes("/")) return false;
        // Reject markdown extensions
        if (/\.(md|markdown|canvas|base)$/i.test(link)) return false;
        // Reject leading punctuation or special chars
        if (/^[^A-Z]/.test(link)) return false;
        // Apply same _isLikelyPersonName filter as discover-people (KNOWN_NON_PERSON_NAMES + length + char filter)
        if (DPH && typeof DPH._isLikelyPersonName === "function") {
            return DPH._isLikelyPersonName(link);
        }
        // Fallback when discover-people-helper not available (HC isolation test)
        // Replicate the core filter: starts with capital; not all-caps; no digits/special; ≤4 tokens.
        const trimmed = link.trim();
        if (!trimmed) return false;
        if (!/^[A-Z]/.test(trimmed)) return false;
        if (/^[A-Z]{2,}$/.test(trimmed)) return false;
        if (/[0-9@#$%^&*()_+={}\[\]:;"<>?\\|`~]/.test(trimmed)) return false;
        if (trimmed.split(/\s+/).length > 4) return false;
        return true;
    });
}

// --- aggregateWikilinksAcrossNotes -------------------------------------------

function aggregateWikilinksAcrossNotes(noteSurfaces) {
    if (!Array.isArray(noteSurfaces)) return [];
    const map = new Map();  // name → {name, surfaced_in: [], first_seen, last_seen, count}
    for (const surface of noteSurfaces) {
        if (!surface || typeof surface.body !== "string") continue;
        const names = scanAtomicNoteForWikilinks(surface.body);
        for (const name of names) {
            if (!map.has(name)) {
                map.set(name, {
                    name,
                    surfaced_in: [],
                    first_seen: surface.date,
                    last_seen: surface.date,
                    count: 0,
                });
            }
            const entry = map.get(name);
            entry.surfaced_in.push({ path: surface.path, date: surface.date });
            entry.count += 1;
            // Update first_seen / last_seen by lexicographic date compare (YYYY-MM-DD)
            if (surface.date && (!entry.first_seen || surface.date < entry.first_seen)) {
                entry.first_seen = surface.date;
            }
            if (surface.date && (!entry.last_seen || surface.date > entry.last_seen)) {
                entry.last_seen = surface.date;
            }
        }
    }
    return Array.from(map.values());
}

// --- filterToMissingPeople ---------------------------------------------------

function filterToMissingPeople(candidates, existing_person_basenames) {
    if (!Array.isArray(candidates)) return [];
    const existing = new Set(
        (Array.isArray(existing_person_basenames) ? existing_person_basenames : [])
            .map(s => String(s).toLowerCase())
    );
    return candidates.filter(c => {
        const name = c && c.name ? String(c.name).toLowerCase() : "";
        return name && !existing.has(name);
    });
}

// --- composePersonNoteStubFromSurfaces ---------------------------------------

function composePersonNoteStubFromSurfaces({ canonical_name, surfaced_in, first_seen, last_seen, count }) {
    const sources = Array.isArray(surfaced_in) ? surfaced_in : [];
    const sourceLines = sources.slice(0, 10).map(s => `> - [[${s.path}|${s.date}]]`);
    const lines = [
        "---",
        `name: ${canonical_name}`,
        `aliases: []`,
        `created_by: cowork:find-missing-people`,
        `discovered_from:`,
        ...sources.slice(0, 10).map(s => `  - path: ${s.path}\n    date: ${s.date}`),
        `first_seen: ${first_seen || "unknown"}`,
        `last_seen: ${last_seen || "unknown"}`,
        `surface_count: ${count || sources.length}`,
        "---",
        "",
        `# ${canonical_name}`,
        "",
        `> [!info]- Discovered by cowork:find-missing-people`,
        `> This stub was created because \`[[${canonical_name}]]\` appeared in ${count || sources.length} atomic note(s) without a target person note. Sources:`,
        ...sourceLines,
        ">",
        "> Add aliases / context as you learn them.",
        "",
    ];
    return lines.join("\n");
}

// --- composeReviewTable ------------------------------------------------------

function composeReviewTable(missingCandidates) {
    if (!Array.isArray(missingCandidates) || missingCandidates.length === 0) {
        return "_No missing person notes found._";
    }
    // Group by surface-count tier
    const high = missingCandidates.filter(c => c.count > 5);
    const medium = missingCandidates.filter(c => c.count > 1 && c.count <= 5);
    const low = missingCandidates.filter(c => c.count <= 1);
    const lines = [];
    let rowNum = 1;
    [["HIGH", high], ["MEDIUM", medium], ["LOW", low]].forEach(([label, group]) => {
        if (group.length === 0) return;
        lines.push(`### ${label} (${group.length})`);
        lines.push("");
        lines.push("| # | Name | Mentions | First seen | Last seen | Sources |");
        lines.push("|---|---|---|---|---|---|");
        group.forEach(c => {
            const sourcesPreview = (c.surfaced_in || []).slice(0, 3).map(s => s.path.split("/").pop()).join(", ");
            const moreCount = (c.surfaced_in || []).length - 3;
            const sourcesText = moreCount > 0 ? `${sourcesPreview}, +${moreCount} more` : sourcesPreview;
            lines.push(`| ${rowNum++} | ${c.name} | ${c.count || 0} | ${c.first_seen || "?"} | ${c.last_seen || "?"} | ${sourcesText} |`);
        });
        lines.push("");
    });
    return lines.join("\n");
}

// --- composeReport -----------------------------------------------------------

function composeReport({ applied, skipped, scanned_count, days_back, engagement_id }) {
    const lines = [];
    lines.push(`# cowork:find-missing-people report — engagement \`${engagement_id || "(unknown)"}\``);
    lines.push("");
    lines.push(`Scanned ${scanned_count || 0} atomic note(s) over the last ${days_back || 30} day(s).`);
    lines.push("");
    lines.push("## Applied (new person-note stubs created)");
    lines.push("");
    if (applied && applied.length) applied.forEach(a => lines.push(`- **${a.canonical_name}** (${a.count || 0} mentions, last seen ${a.last_seen || "?"})`));
    else lines.push("(none)");
    lines.push("");
    lines.push("## Skipped");
    lines.push("");
    if (skipped && skipped.length) skipped.forEach(s => lines.push(`- **${s.canonical_name}** — ${s.reason || "(user skipped)"}`));
    else lines.push("(none)");
    return lines.join("\n");
}

module.exports = {
    scanAtomicNoteForWikilinks,
    filterToPersonShapedWikilinks,
    aggregateWikilinksAcrossNotes,
    filterToMissingPeople,
    composePersonNoteStubFromSurfaces,
    composeReviewTable,
    composeReport,
};
