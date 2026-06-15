#!/usr/bin/env node
// scripts/lint-schemas.js — v0.113.0 schema registry validator.
//
// Reads platform/schemas-index.json and validates every entry against the
// rules captured in Docs/plans/2026-06-15-v0.113.0-schema-registry-design.md §2.
//
// Default mode: --check. Exits 0 on success, 1 on any hard failure.
//
// Flags:
//   --check     (default) exit 1 on hard failure
//   --list      one-line summary per schema (informational; exit 0 regardless)
//   --json      emit full validated index as JSON
//   --verbose   per-entry validation lines
//   --help      usage
//
// Hard failures (exit 1):
//   - Index file missing / unparseable / wrong schema_version.
//   - Duplicate id across entries.
//   - Missing required key (id / kind / owner / source).
//   - source / validator file does not exist on disk.
//   - kind not in enum.
//   - owner.type not in {blueprint, mechanism, workshop}.
//   - owner.name not in the workshop's blueprint/mechanism catalog (for type=blueprint/mechanism).
//
// Soft warnings (printed to stderr; exit 0):
//   - consumers[] entry path does not exist.
//   - accepted_versions drift vs source JSON Schema's schema_version.enum.

const fs = require("fs");
const path = require("path");

const WORKSHOP = path.resolve(__dirname, "..");
const INDEX = path.join(WORKSHOP, "platform/schemas-index.json");
const MANIFEST = path.join(WORKSHOP, "platform/manifest.json");

const ARGS = new Set(process.argv.slice(2));
const HELP = ARGS.has("--help") || ARGS.has("-h");
const JSON_OUT = ARGS.has("--json");
const LIST = ARGS.has("--list");
const VERBOSE = ARGS.has("--verbose");
const USE_COLOR = !ARGS.has("--no-color") && process.stdout.isTTY && !JSON_OUT;

function c(code, s) { return USE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s; }
const dim   = (s) => c("2", s);
const red   = (s) => c("31", s);
const green = (s) => c("32", s);
const cyan  = (s) => c("36", s);
const yellow = (s) => c("33", s);

const KIND_ENUM = new Set([
  "sidecar-schema",
  "rule-fragment-bundle",
  "contract",
  "data-file",
  "workshop-manifest",
  "learned-state-schema",
  "entity-create-prompts",
  "helper-read-contract",
]);
const OWNER_TYPES = new Set(["blueprint", "mechanism", "workshop"]);

function usage() {
  process.stdout.write(`lint-schemas — validate platform/schemas-index.json.

Usage:
  node scripts/lint-schemas.js [flags]

Flags:
  --check        (default) exit 1 on hard failure; print summary.
  --list         one-line summary per schema; exit 0 regardless.
  --json         emit full validated index as JSON.
  --verbose      per-entry validation lines.
  --no-color     disable ANSI codes.
  --help, -h     show this message.
`);
}

if (HELP) { usage(); process.exit(0); }

// --------------------------------------------------------------------------- read

function readIndex() {
  if (!fs.existsSync(INDEX)) {
    process.stderr.write(red(`lint-schemas: index file missing — ${path.relative(WORKSHOP, INDEX)}\n`));
    process.exit(1);
  }
  let text;
  try { text = fs.readFileSync(INDEX, "utf8"); }
  catch (e) { process.stderr.write(red(`lint-schemas: failed to read index — ${e.message}\n`)); process.exit(1); }
  try { return JSON.parse(text); }
  catch (e) { process.stderr.write(red(`lint-schemas: index is not valid JSON — ${e.message}\n`)); process.exit(1); }
}

function readWorkshopManifest() {
  if (!fs.existsSync(MANIFEST)) return null;
  try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")); }
  catch (_e) { return null; }
}

// --------------------------------------------------------------------------- validate

function validate(index, manifest) {
  const errors = [];
  const warnings = [];

  if (index.schema_version !== 1) {
    errors.push(`index schema_version must be 1 (got ${JSON.stringify(index.schema_version)}); update this script to handle a newer index format`);
    return { errors, warnings, entries: [] };
  }

  const schemas = Array.isArray(index.schemas) ? index.schemas : [];
  if (schemas.length === 0) errors.push(`index.schemas[] is empty`);

  const blueprintNames = new Set((manifest && manifest.blueprints || []).map(b => b.name));
  const mechanismNames = new Set((manifest && manifest.mechanisms || []).map(m => m.name));

  const seenIds = new Set();
  const entries = [];

  for (let i = 0; i < schemas.length; i += 1) {
    const e = schemas[i] || {};
    const label = e.id ? `[${e.id}]` : `[entry #${i}]`;
    const entryErrors = [];

    if (!e.id || typeof e.id !== "string") entryErrors.push(`${label} missing id`);
    if (!e.kind || typeof e.kind !== "string") entryErrors.push(`${label} missing kind`);
    if (!e.owner || typeof e.owner !== "object") entryErrors.push(`${label} missing owner`);
    if (!e.source || typeof e.source !== "string") entryErrors.push(`${label} missing source`);

    if (e.id && seenIds.has(e.id)) entryErrors.push(`${label} duplicate id`);
    if (e.id) seenIds.add(e.id);

    if (e.kind && !KIND_ENUM.has(e.kind)) entryErrors.push(`${label} kind="${e.kind}" not in enum: ${Array.from(KIND_ENUM).join(", ")}`);

    if (e.owner && typeof e.owner === "object") {
      if (!OWNER_TYPES.has(e.owner.type)) entryErrors.push(`${label} owner.type="${e.owner.type}" not in: ${Array.from(OWNER_TYPES).join(", ")}`);
      if (!e.owner.name || typeof e.owner.name !== "string") entryErrors.push(`${label} owner.name missing`);
      if (e.owner.type === "blueprint" && e.owner.name && manifest && !blueprintNames.has(e.owner.name)) {
        entryErrors.push(`${label} owner.name="${e.owner.name}" not in blueprint catalog: ${Array.from(blueprintNames).join(", ")}`);
      }
      if (e.owner.type === "mechanism" && e.owner.name && manifest && !mechanismNames.has(e.owner.name)) {
        entryErrors.push(`${label} owner.name="${e.owner.name}" not in mechanism catalog: ${Array.from(mechanismNames).join(", ")}`);
      }
    }

    if (e.source) {
      const sourceAbs = path.join(WORKSHOP, e.source);
      if (!fs.existsSync(sourceAbs)) entryErrors.push(`${label} source file missing — ${e.source}`);
    }

    if (e.validator) {
      const validatorAbs = path.join(WORKSHOP, e.validator);
      if (!fs.existsSync(validatorAbs)) entryErrors.push(`${label} validator file missing — ${e.validator}`);
    }

    if (Array.isArray(e.consumers)) {
      for (const cnsumer of e.consumers) {
        if (typeof cnsumer !== "string") continue;
        const cnsumerAbs = path.join(WORKSHOP, cnsumer);
        if (!fs.existsSync(cnsumerAbs)) {
          warnings.push(`${label} consumer path missing — ${cnsumer}`);
        }
      }
    }

    // Soft check: if source is a JSON Schema (sidecar-schema), see whether
    // accepted_versions[] matches its `properties.schema_version.enum`.
    if (e.kind === "sidecar-schema" && Array.isArray(e.accepted_versions) && e.source) {
      const sourceAbs = path.join(WORKSHOP, e.source);
      if (fs.existsSync(sourceAbs)) {
        try {
          const doc = JSON.parse(fs.readFileSync(sourceAbs, "utf8"));
          const sv = doc.properties && doc.properties.schema_version;
          if (sv) {
            const docVersions = Array.isArray(sv.enum) ? sv.enum : (sv.const ? [sv.const] : null);
            if (docVersions) {
              const expected = new Set(docVersions);
              const indexed  = new Set(e.accepted_versions);
              for (const v of indexed) if (!expected.has(v)) warnings.push(`${label} accepted_versions[] includes "${v}" but source's schema_version.enum does not`);
              for (const v of docVersions) if (!indexed.has(v)) warnings.push(`${label} source schema_version.enum has "${v}" but accepted_versions[] does not`);
            }
          }
        } catch (_e) { /* skip — source isn't JSON-parseable */ }
      }
    }

    errors.push(...entryErrors);
    entries.push({
      id: e.id || `entry-${i}`,
      kind: e.kind || "?",
      owner: e.owner || { type: "?", name: "?" },
      source: e.source || "?",
      ok: entryErrors.length === 0,
      errorCount: entryErrors.length,
    });

    if (VERBOSE) {
      const status = entryErrors.length === 0 ? green("ok") : red(`${entryErrors.length} err`);
      process.stderr.write(`  ${status} ${dim(e.id || `entry-${i}`)}\n`);
      for (const err of entryErrors) process.stderr.write(`     ${red("-")} ${err}\n`);
    }
  }

  return { errors, warnings, entries };
}

// --------------------------------------------------------------------------- emit

function emitJson(index, result) {
  const payload = {
    summary: {
      schema_version: index.schema_version,
      schemas_indexed: result.entries.length,
      hard_failures: result.errors.length,
      soft_warnings: result.warnings.length,
    },
    schemas: result.entries,
    errors: result.errors,
    warnings: result.warnings,
  };
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

function emitList(result) {
  for (const e of result.entries) {
    const ok = e.ok ? green("✓") : red("✗");
    const owner = `${e.owner.type}:${e.owner.name}`;
    process.stdout.write(`${ok} ${cyan(e.id.padEnd(40))} ${dim(e.kind.padEnd(22))} ${dim(owner.padEnd(28))} ${dim(e.source)}\n`);
  }
}

function emitCheck(result) {
  if (result.errors.length === 0) {
    process.stdout.write(`${green("ok")} lint-schemas: ${result.entries.length} schemas indexed, 0 issues`);
    if (result.warnings.length > 0) process.stdout.write(`, ${yellow(`${result.warnings.length} soft warning${result.warnings.length === 1 ? "" : "s"}`)}`);
    process.stdout.write("\n");
    if (result.warnings.length > 0) {
      for (const w of result.warnings) process.stderr.write(`  ${yellow("warn")} ${w}\n`);
    }
    return 0;
  }
  process.stderr.write(`${red("FAIL")} lint-schemas: ${result.errors.length} hard failure${result.errors.length === 1 ? "" : "s"}\n`);
  for (const e of result.errors) process.stderr.write(`  ${red("-")} ${e}\n`);
  if (result.warnings.length > 0) {
    process.stderr.write(`${yellow(`+ ${result.warnings.length} soft warning${result.warnings.length === 1 ? "" : "s"}`)}\n`);
    for (const w of result.warnings) process.stderr.write(`  ${yellow("warn")} ${w}\n`);
  }
  return 1;
}

// --------------------------------------------------------------------------- main

function main() {
  const index = readIndex();
  const manifest = readWorkshopManifest();
  const result = validate(index, manifest);

  if (JSON_OUT) { emitJson(index, result); process.exit(result.errors.length === 0 ? 0 : 1); }
  if (LIST) { emitList(result); process.exit(0); }
  process.exit(emitCheck(result));
}

main();
