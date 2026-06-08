/* eslint-disable no-console */
/**
 * validate-sidecar-helper.js — v0.96.0 (sauce v0.96.0 cowork-rethought-1)
 *
 * Validates a cowork .cowork.json sidecar against a cadence-specific JSON
 * Schema (draft-07). Used by write-atomic-note-helper before write commits,
 * and by the orchestrator Verify pass to replace v0.91.x–v0.92.0 regex
 * markers.
 *
 * Pure: no MCP calls, no side effects, no stdout. Reads schema files from
 * disk (lazy + cached). Returns { ok, errors? } per case.
 *
 * Exports:
 *   - validateSidecar(payload, schemaPath) → { ok, errors? }
 *   - validatePreCycleNote(mdPath)         → { ok: true, warn: "missing-sidecar", mdPath }
 *                                            graceful fallback for legacy
 *                                            .md files that pre-date the
 *                                            v0.96.0 sidecar contract.
 */
"use strict";

const fs = require("node:fs");

let _ajv = null;
function _getAjv() {
  if (_ajv) return _ajv;
  const Ajv = require("ajv");
  _ajv = new Ajv({ allErrors: true, strict: false });
  return _ajv;
}

const _schemaCache = new Map();
function _loadSchema(schemaPath) {
  if (_schemaCache.has(schemaPath)) return _schemaCache.get(schemaPath);
  const raw = fs.readFileSync(schemaPath, "utf8");
  const schema = JSON.parse(raw);
  _schemaCache.set(schemaPath, schema);
  return schema;
}

function validateSidecar(payload, schemaPath) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, errors: [{ message: "payload must be an object" }] };
  }
  if (!schemaPath || typeof schemaPath !== "string") {
    return { ok: false, errors: [{ message: "schemaPath must be a string" }] };
  }
  if (!fs.existsSync(schemaPath)) {
    return { ok: false, errors: [{ message: `schema not found at ${schemaPath}` }] };
  }
  let schema;
  try {
    schema = _loadSchema(schemaPath);
  } catch (err) {
    return { ok: false, errors: [{ message: `schema parse failure: ${err.message}` }] };
  }
  const ajv = _getAjv();
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (err) {
    return { ok: false, errors: [{ message: `schema compile failure: ${err.message}` }] };
  }
  const ok = validate(payload);
  if (ok) {
    if (Array.isArray(payload.surfaced_items)) {
      const ids = new Set();
      for (const item of payload.surfaced_items) {
        if (item && typeof item.item_id === "string") {
          if (ids.has(item.item_id)) {
            return {
              ok: false,
              errors: [{ message: `duplicate item_id within sidecar: ${item.item_id}` }],
            };
          }
          ids.add(item.item_id);
        }
      }
    }
    return { ok: true };
  }
  return { ok: false, errors: validate.errors || [] };
}

function validatePreCycleNote(mdPath) {
  return { ok: true, warn: "missing-sidecar", mdPath };
}

module.exports = { validateSidecar, validatePreCycleNote };
