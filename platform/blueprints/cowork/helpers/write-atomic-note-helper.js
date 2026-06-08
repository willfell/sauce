/* eslint-disable no-console */
/**
 * write-atomic-note-helper.js — v0.96.0 (sauce v0.96.0 cowork-rethought-1)
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
 *   writeAtomicNote({ mdPath, sidecarPath, body_md, sidecar_json, schemaPath })
 *     → { status, mdPath?, sidecarPath?, errors? }
 *
 * Status strings (v0.91.x–v0.92.0 contract-violation convention):
 *   ok
 *   failed:contract-violation:missing-input
 *   failed:contract-violation:sidecar-schema
 *   failed:filesystem:md-write:<errno-or-message>
 *   failed:filesystem:sidecar-write:<errno-or-message>
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateSidecar } = require("./validate-sidecar-helper");

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

function writeAtomicNote({ mdPath, sidecarPath, body_md, sidecar_json, schemaPath } = {}) {
  if (!mdPath || !sidecarPath || !body_md || !sidecar_json || !schemaPath) {
    return { status: "failed:contract-violation:missing-input" };
  }
  const validation = validateSidecar(sidecar_json, schemaPath);
  if (!validation.ok) {
    return {
      status: "failed:contract-violation:sidecar-schema",
      errors: validation.errors,
    };
  }
  try {
    _writeFileAtomic(mdPath, body_md);
  } catch (err) {
    return { status: `failed:filesystem:md-write:${err.code || err.message}` };
  }
  try {
    _writeFileAtomic(sidecarPath, JSON.stringify(sidecar_json, null, 2) + "\n");
  } catch (err) {
    _safeUnlink(mdPath);
    return { status: `failed:filesystem:sidecar-write:${err.code || err.message}` };
  }
  return { status: "ok", mdPath, sidecarPath };
}

module.exports = { writeAtomicNote };
