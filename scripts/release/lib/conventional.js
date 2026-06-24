"use strict";
// Zero-dep conventional-commit classifier for the grammar Sauce uses.
// House rule: Node built-ins only.

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s+(?<subject>.+)$/;

// Returns { type, scope, scopes[], breaking, releaseAs|null, subject } or null
// when the header line is not a conventional-commit header.
function parseCommit(message) {
    const text = String(message).replace(/\r\n/g, "\n");
    const lines = text.split("\n");
    const m = HEADER.exec((lines[0] || "").trim());
    if (!m) return null;
    const body = lines.slice(1).join("\n");
    const breaking = !!m.groups.bang || /(^|\n)BREAKING[ -]CHANGE:/.test(body);
    const ra = /(^|\n)Release-As:\s*(\d+\.\d+\.\d+)\s*(\n|$)/.exec(body);
    const scope = m.groups.scope ? m.groups.scope.trim() : null;
    const scopes = scope ? scope.split(",").map((s) => s.trim()).filter(Boolean) : [];
    return {
        type: m.groups.type,
        scope,
        scopes,
        breaking,
        releaseAs: ra ? ra[2] : null,
        subject: m.groups.subject.trim(),
    };
}

// Bump level for a parsed commit. isPre1 = the affected component's major === 0.
function bumpLevel(parsed, isPre1) {
    if (!parsed) return "none";
    if (parsed.breaking) return isPre1 ? "minor" : "major";
    if (parsed.type === "feat") return "minor";
    if (["fix", "perf", "refactor"].includes(parsed.type)) return "patch";
    return "none"; // chore, docs, test, style, ci, build, revert(...)
}

module.exports = { parseCommit, bumpLevel };
