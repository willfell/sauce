// semver-helper.js — shared MAJOR.MINOR.PATCH comparison helper for HC harnesses.
// FLN-v81-1 (v0.82.1): extracted from the brittle /^0\.(8|9|[12]\d)\.\d+$/ regex
// that was duplicated across 3 test files. Every cowork-version-floor expansion
// previously required lockstep regex bumps in run-claude-surface.js,
// run-cowork-smoke.js, and run-helper-cases.js. Now a single helper.
"use strict";

function parseSemver(str) {
  if (typeof str !== "string") return null;
  const m = str.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10), patch: parseInt(m[3], 10) };
}

function versionAtLeast(actualStr, minStr) {
  const a = parseSemver(actualStr);
  const b = parseSemver(minStr);
  if (!a || !b) return false;
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch >= b.patch;
}

module.exports = { parseSemver, versionAtLeast };
