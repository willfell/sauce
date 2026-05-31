/* eslint-disable no-console */
/**
 * audit-siblings-helper.js — v0.81.0
 *
 * Pure helpers backing cowork:audit-siblings. No MCP calls, no fs, no stdout.
 *   parseReferences  — extract sibling filenames from microscope.md's ## References blocks
 *   auditSiblings    — two-axis check: dangling refs (referenced but absent) + orphan files (present but unreferenced)
 *
 * The orchestrator SKILL.md does the fs + MCP I/O (list dir, read microscope);
 * this helper is deterministic + harness-testable.
 */
"use strict";

// Header regex matches `## References` and `## References (added)` exactly.
// Entry regex matches `- **<name>.md** — <role>` (em-dash, not hyphen).
const HEADER_RX = /^##\s+References(\s+\(added\))?\s*$/;
const ENTRY_RX = /^-\s+\*\*([^*]+\.md)\*\*\s+—/;

function parseReferences(microscope_body) {
    const body = String(microscope_body || "");
    if (!body) return [];

    const lines = body.split("\n");
    const seen = new Set();
    const out = [];
    let inRefs = false;

    for (const line of lines) {
        if (/^##\s+/.test(line)) {
            inRefs = HEADER_RX.test(line);
            continue;
        }
        if (!inRefs) continue;
        const m = ENTRY_RX.exec(line);
        if (m && m[1]) {
            const name = m[1].trim();
            if (name && !seen.has(name)) {
                seen.add(name);
                out.push(name);
            }
        }
    }

    return out;
}

function auditSiblings({ kinds_dir_listing, microscope_bodies } = {}) {
    const listing = kinds_dir_listing || {};
    const bodies = microscope_bodies || {};

    // Union of kinds across both inputs (kinds with siblings but no microscope
    // contribute orphans; kinds with microscope but no siblings contribute 0/0
    // unless the microscope references something).
    const allKinds = new Set([...Object.keys(listing), ...Object.keys(bodies)]);

    const dangling = [];
    const orphans = [];

    for (const kind of allKinds) {
        const referenced = new Set(parseReferences(bodies[kind] || ""));
        const existing = new Set(listing[kind] || []);

        // Dangling: referenced but not present on disk
        for (const name of referenced) {
            if (!existing.has(name)) dangling.push({ kind, name });
        }
        // Orphan: present on disk but not referenced
        for (const name of existing) {
            if (!referenced.has(name)) orphans.push({ kind, name });
        }
    }

    // Deterministic ordering: (kind asc, name asc).
    const sortFn = (a, b) => {
        if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    };
    dangling.sort(sortFn);
    orphans.sort(sortFn);

    return { dangling, orphans };
}

module.exports = { parseReferences, auditSiblings };
