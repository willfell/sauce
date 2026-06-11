/* eslint-disable no-console */
/**
 * write-atomic-note-helper.js — v0.98.1 (sauce v0.98.1 eod-review sidecar schema 1.0.0 → 1.1.0)
 *
 * Atomic dual-write for cowork atomic notes: writes the .md and its
 * .cowork.json sidecar together; on any failure (validation or filesystem),
 * BOTH files are deleted so the directory never carries a half-written
 * pair. Sidecar is validated against its cadence-specific JSON Schema
 * BEFORE write commits.
 *
 * Pure-ish: filesystem side effects only; no MCP, no stdout. Caller is
 * responsible for supplying absolute paths and the schema path.
 *
 * Exports:
 *   writeAtomicNote({
 *     mdPath, sidecarPath, body_md, sidecar_json, schemaPath,
 *     // v0.97.4 — prose-invariant write-guards (all optional; absent = guard skipped)
 *     surfaced_kinds_for_rating, learning_enabled, expected_kinds,
 *     // v0.98.1 — questionnaire-capture observability (optional; absent = schema_version stays "1.0.0")
 *     feedback_capture
 *   }) → { status, mdPath?, sidecarPath?, errors? }
 *
 * Status strings:
 *   ok
 *   failed:contract-violation:missing-input
 *   failed:contract-violation:missing-rating-callout       (v0.97.4)
 *   failed:contract-violation:missing-anti-echo-callout    (v0.97.4)
 *   failed:contract-violation:sidecar-schema
 *   failed:filesystem:md-write:<errno-or-message>
 *   failed:filesystem:sidecar-write:<errno-or-message>
 *
 * Guard ordering (deterministic):
 *   1. missing-input
 *   2. missing-rating-callout    (gate: surfaced_kinds_for_rating.length>0 AND learning_enabled !== false)
 *   3. missing-anti-echo-callout (gate: sidecar.render_aspects_applied includes "anti_echo:include")
 *   4. coverage-gap injection    (gate: expected_kinds.length > sidecar.surfaced_kinds.length — non-failing; body+sidecar mutated)
 *   5. sidecar-schema (validateSidecar)
 *   6. md write
 *   7. sidecar write
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateSidecar } = require("./validate-sidecar-helper");

const RATING_SENTINEL = "<!-- cowork:rating-block schema=";
const ANTI_ECHO_PHRASE = "Outside yesterday's frame";
const ANTI_ECHO_ASPECT = "anti_echo:include";

function _writeFileAtomic(filePath, contents) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, contents, "utf8");
  fs.renameSync(tmp, filePath);
}

function _safeUnlink(filePath) {
  try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
}

/**
 * _computeCoverageGap(expected_kinds, surfaced_kinds)
 *
 * Returns { expected, surfaced, skipped } where skipped = expected \ surfaced
 * (preserving expected order). Skipped is [] when surfaced covers expected.
 */
function _computeCoverageGap(expected_kinds, surfaced_kinds) {
  const expected = Array.isArray(expected_kinds) ? expected_kinds.slice() : [];
  const surfaced = Array.isArray(surfaced_kinds) ? surfaced_kinds.slice() : [];
  const surfacedSet = new Set(surfaced);
  const skipped = expected.filter((k) => !surfacedSet.has(k));
  return { expected, surfaced, skipped };
}

/**
 * _composeCoverageGapCallout(skipped)
 *
 * Returns a `> [!warning]+ Coverage gap` callout body listing skipped kinds.
 * No trailing newline — caller controls separator.
 */
function _composeCoverageGapCallout(skipped) {
  const lines = [
    "> [!warning]+ Coverage gap",
    `> ${skipped.length} of the engagement's priority kinds did NOT surface this fire — verify whether the data was empty or the MCP / dispatch path silently dropped them.`,
  ];
  for (const k of skipped) {
    lines.push(`> - \`${k}\` — no data returned, MCP unavailable, or skipped by gather pipeline`);
  }
  return lines.join("\n");
}

/**
 * _injectCoverageGapIntoBody(body_md, calloutMd)
 *
 * Injects the callout BEFORE the first per-kind block. Per-kind block is
 * identified as the first `> [!example]+` callout header line. When no
 * per-kind block is found, injects after the synopsis (after the first
 * `> [!info]` callout block) or, failing that, after the frontmatter + any
 * dataviewjs fence. Pure: returns a new string; no I/O.
 */
function _injectCoverageGapIntoBody(body_md, calloutMd) {
  if (typeof body_md !== "string" || body_md === "") return calloutMd + "\n";
  // Find the first `> [!example]+` line.
  const exampleIdx = body_md.indexOf("\n> [!example]+");
  if (exampleIdx !== -1) {
    // Inject the callout just before this line. Preserve blank line above the callout.
    const before = body_md.slice(0, exampleIdx);
    const after = body_md.slice(exampleIdx);  // starts with "\n> [!example]+"
    return before + "\n\n" + calloutMd + after;
  }
  // No per-kind block. Find the end of the dataviewjs fence (closing ``` after the dvjs open).
  const dvjsClose = body_md.indexOf("\n```\n", body_md.indexOf("```dataviewjs"));
  if (dvjsClose !== -1) {
    const insertAt = dvjsClose + 4;  // after "\n```\n"
    return body_md.slice(0, insertAt) + "\n" + calloutMd + "\n" + body_md.slice(insertAt);
  }
  // Fallback: prepend.
  return calloutMd + "\n\n" + body_md;
}

function writeAtomicNote(opts) {
  const {
    mdPath, sidecarPath, body_md, sidecar_json, schemaPath,
    surfaced_kinds_for_rating, learning_enabled, expected_kinds,
  } = (opts || {});

  // Guard 1 — missing-input (existing contract).
  if (!mdPath || !sidecarPath || !body_md || !sidecar_json || !schemaPath) {
    return { status: "failed:contract-violation:missing-input" };
  }

  // Guard 2 — rating-callout sentinel must be present when learning is enabled
  // AND at least one kind surfaced for rating. Gate matches compose-body-helper.js's
  // ratingCallout emission gate (learning_enabled !== false AND non-empty array).
  const ratingGateOpen =
    Array.isArray(surfaced_kinds_for_rating)
    && surfaced_kinds_for_rating.length > 0
    && learning_enabled !== false;
  if (ratingGateOpen && !String(body_md).includes(RATING_SENTINEL)) {
    return { status: "failed:contract-violation:missing-rating-callout" };
  }

  // Guard 3 — anti-echo callout must be present when render_aspects_applied
  // declares anti_echo:include. The sidecar mirrors which aspects fired this
  // run; if anti_echo fired, the body MUST carry the [!question] callout.
  const rab = sidecar_json && Array.isArray(sidecar_json.render_aspects_applied)
    ? sidecar_json.render_aspects_applied : [];
  const antiEchoApplied = rab.includes(ANTI_ECHO_ASPECT);
  if (antiEchoApplied && !String(body_md).includes(ANTI_ECHO_PHRASE)) {
    return { status: "failed:contract-violation:missing-anti-echo-callout" };
  }

  // Guard 4 — coverage-gap injection. Non-failing: some priority kinds may
  // legitimately return no data on a given day. We make the gap VISIBLE in
  // the rendered brief (warning callout at top) AND machine-readable in the
  // sidecar (coverage_gap field) so the reconciler can monitor cross-day.
  let mutated_body_md = body_md;
  let mutated_sidecar = sidecar_json;
  if (Array.isArray(expected_kinds) && expected_kinds.length > 0) {
    const surfaced_kinds = Array.isArray(sidecar_json.surfaced_kinds) ? sidecar_json.surfaced_kinds : [];
    const gap = _computeCoverageGap(expected_kinds, surfaced_kinds);
    if (gap.skipped.length > 0) {
      const callout = _composeCoverageGapCallout(gap.skipped);
      mutated_body_md = _injectCoverageGapIntoBody(body_md, callout);
      // Mutate a shallow clone of the sidecar so callers' object is not mutated.
      mutated_sidecar = Object.assign({}, sidecar_json, { coverage_gap: gap });
    } else {
      // All priority kinds covered — mirror an empty-skipped gap into sidecar for
      // reconciler cross-day consistency (so it can distinguish "no gap" from
      // "field absent because helper didn't run").
      mutated_sidecar = Object.assign({}, sidecar_json, { coverage_gap: gap });
    }
  }

  // v0.98.1: pass-through feedback_capture observability when caller supplied it.
  // When present, bump schema_version from default "1.0.0" to "1.1.0" (additive).
  const { feedback_capture } = (opts || {});
  if (feedback_capture && typeof feedback_capture === "object") {
    mutated_sidecar = Object.assign({}, mutated_sidecar, {
      schema_version: "1.1.0",
      feedback_capture,
    });
  }

  // Guard 5 — sidecar schema validation (existing contract). Runs against the
  // POSSIBLY-MUTATED sidecar so coverage_gap, if present, must pass schema.
  const validation = validateSidecar(mutated_sidecar, schemaPath);
  if (!validation.ok) {
    return {
      status: "failed:contract-violation:sidecar-schema",
      errors: validation.errors,
    };
  }

  // Write the .md.
  try {
    _writeFileAtomic(mdPath, mutated_body_md);
  } catch (err) {
    return { status: `failed:filesystem:md-write:${err.code || err.message}` };
  }
  // Write the sidecar.
  try {
    _writeFileAtomic(sidecarPath, JSON.stringify(mutated_sidecar, null, 2) + "\n");
  } catch (err) {
    _safeUnlink(mdPath);
    return { status: `failed:filesystem:sidecar-write:${err.code || err.message}` };
  }
  return { status: "ok", mdPath, sidecarPath };
}

module.exports = {
  writeAtomicNote,
  _computeCoverageGap,
  _composeCoverageGapCallout,
  _injectCoverageGapIntoBody,
  RATING_SENTINEL,
  ANTI_ECHO_PHRASE,
  ANTI_ECHO_ASPECT,
};
