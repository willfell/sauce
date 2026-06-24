"use strict";
// Zero-dep semver increment for plain X.Y.Z versions (no pre-release/build).
// House rule: Node built-ins only; failure-loud.

function parse(v) {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
    if (!m) throw new Error(`semver-inc: not an X.Y.Z version: "${v}"`);
    return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function inc(version, level) {
    if (level === "none") return version;
    const { major, minor, patch } = parse(version);
    if (level === "major") return `${major + 1}.0.0`;
    if (level === "minor") return `${major}.${minor + 1}.0`;
    if (level === "patch") return `${major}.${minor}.${patch + 1}`;
    throw new Error(`semver-inc: unknown level "${level}"`);
}

const RANK = { none: 0, patch: 1, minor: 2, major: 3 };
function maxLevel(a, b) { return RANK[a] >= RANK[b] ? a : b; }

module.exports = { parse, inc, maxLevel, RANK };
