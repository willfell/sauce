#!/usr/bin/env node
/**
 * select-card — deterministic work selector for the Sauce Autoloop.
 * Pure functions over board markdown; no model, no side effects.
 *
 * Exports: selectCard, isBroadScope, parseBoard, recommendedFrom
 * CLI: node scripts/autoloop/select-card.js --board <p> --handoff <p> [--halt <p>] [--cards-root <p>] [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const delivery = require('../../platform/mechanisms/delivery');

// Broad-scope heuristic: signals multi-cycle work the autonomous loop must NOT
// pick (it would run unbounded). Deterministic mirror of the human pipeline's
// Phase B scope sanity-check.
const BROAD_PATTERNS = [
  /\baudit\b/i, /\bredesign\b/i, /\broadmap\b/i, /\boverhaul\b/i,
  /\beverything\b/i, /\ball (blueprints|mechanisms|vaults)\b/i,
  /\bmigrat(e|ion) (all|every)\b/i, /\bfigure out\b/i,
];

function normalizeStatus(value) {
  return delivery.normalizeStatus(value);
}

function frontmatterScalar(raw, key) {
  const match = String(raw || '').match(/^\s*---\n([\s\S]*?)\n---/);
  if (!match) return undefined;
  const line = match[1].split('\n').find((value) => new RegExp(`^${key}\\s*:`).test(value));
  if (!line) return undefined;
  return line.slice(line.indexOf(':') + 1).trim().replace(/^['"]|['"]$/g, '');
}

function parseCardStatus(raw) {
  const value = frontmatterScalar(raw, 'status');
  return value === undefined ? undefined : normalizeStatus(value);
}

function parseBatchPolicy(raw) {
  const frontmatterValue = frontmatterScalar(raw, 'batch_policy');
  if (frontmatterValue !== undefined) return frontmatterValue.trim().toLowerCase();
  const match = String(raw || '').match(/^\s*batch_policy:\s*([a-z][a-z0-9_-]*)\b/im);
  return match ? match[1].toLowerCase() : null;
}

function isBroadScope(text) {
  if (!text) return { broad: false, reason: null };
  for (const re of BROAD_PATTERNS) {
    if (re.test(text)) return { broad: true, reason: `matched ${re}` };
  }
  if (text.length > 2500) return { broad: true, reason: 'body > 2500 chars' };
  return { broad: false, reason: null };
}

// Strip a card's frontmatter + fenced (dataviewjs) chrome so the scope heuristic
// measures the actual task description, not the ~700 chars of boilerplate that
// sits on every project card.
function stripCardChrome(raw) {
  let s = String(raw || '');
  s = s.replace(/^\s*---\n[\s\S]*?\n---\n/, '');   // leading YAML frontmatter
  s = s.replace(/```[\s\S]*?```/g, '');             // fenced code blocks (dataviewjs chrome)
  s = s.replace(/^\s*---\s*$/gm, '');               // standalone --- separators
  return s.trim();
}

// Parse a kanban-ish board markdown into columns -> arrays of card link names.
function parseBoard(md) {
  const cols = { 'In Planning': [], 'In Progress': [], 'Blocked': [], 'Completed': [] };
  let cur = null;
  for (const raw of String(md || '').split('\n')) {
    const h = raw.match(/^#{1,6}\s+(.*\S)\s*$/);
    if (h) { const name = h[1].trim(); cur = Object.prototype.hasOwnProperty.call(cols, name) ? name : null; continue; }
    if (!cur) continue;
    const m = raw.match(/^\s*-\s*(?:\[[ xX]?\]\s*)?\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/);
    if (m) cols[cur].push(m[1].trim());
  }
  return cols;
}

// Names of cards in the "In Planning" column that are [x]/[X]-checked (treated
// as done, not pickable). Scoped to In Planning only.
function parsePlanningChecked(md) {
  const set = new Set();
  let inPlanning = false;
  for (const raw of String(md || '').split('\n')) {
    const h = raw.match(/^#{1,6}\s+(.*\S)\s*$/);
    if (h) { inPlanning = h[1].trim() === 'In Planning'; continue; }
    if (!inPlanning) continue;
    const m = raw.match(/^\s*-\s*\[[xX]\]\s*\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/);
    if (m) set.add(m[1].trim());
  }
  return set;
}

// Checked entries in one named lane. Completion fallback is intentionally
// scoped to `Completed`; Archive is a separate lane and contains mixed
// checked/unchecked historical work on the live Sauce board.
function parseCheckedColumn(md, column) {
  const set = new Set();
  let current = null;
  for (const raw of String(md || '').split('\n')) {
    const h = raw.match(/^#{1,6}\s+(.*\S)\s*$/);
    if (h) { current = h[1].trim(); continue; }
    if (current !== column) continue;
    const m = raw.match(/^\s*-\s*\[[xX]\]\s*\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/);
    if (m) set.add(m[1].trim());
  }
  return set;
}

// Parse a card note's `depends_on` frontmatter into an array of predecessor card
// names. Supports every YAML shape the loop is likely to author:
//   depends_on: "[[Slice 2]]"          (inline scalar, wikilink)
//   depends_on: [[Slice 2]]            (inline, unquoted wikilink)
//   depends_on: Slice 2                (inline, bare name)
//   depends_on: ["[[A]]", "[[B]]"]     (inline flow list)
//   depends_on:\n  - "[[A]]"\n  - B    (block list, mixed wikilink/bare)
// Alias piped links (`[[name|alias]]`) resolve to `name`. Returns [] when the
// field is absent/empty. PURE — reads the string, no I/O.
function parseDependsOn(raw) {
  const fm = String(raw || '').match(/^\s*---\n([\s\S]*?)\n---/);
  if (!fm) return [];
  const lines = fm[1].split('\n');
  const start = lines.findIndex((l) => /^depends_on\s*:/.test(l));
  if (start === -1) return [];
  // The field's value = the text after `depends_on:` on its line. If that is
  // empty, it's a block list → gather the following indented lines (which are
  // its `- item` entries) until the next top-level key.
  let block = lines[start].replace(/^depends_on\s*:/, '');
  if (block.trim() === '') {
    for (let i = start + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) block += '\n' + lines[i];
  }
  return delivery.parseDependencyField(`depends_on:${block}`);
}

// A2 public Delivery adapter. It keeps markdown/YAML parsing at the consumer
// boundary while every semantic decision comes from the shared contract API.
function frontmatterBody(raw) {
  const match = String(raw || '').match(/^\s*---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
}

function rawScalarField(raw, key) {
  const line = frontmatterBody(raw).split('\n').find((value) => new RegExp(`^${key}\\s*:`).test(value));
  return line ? line.slice(line.indexOf(':') + 1).trim() : undefined;
}

function stripYamlComment(value) {
  const source = String(value == null ? '' : value);
  const first = source.search(/\S/);
  const collection = first >= 0 && (source[first] === '[' || source[first] === '{');
  let quote = first >= 0 && (source[first] === '"' || source[first] === "'") ? source[first] : null;
  let escaped = false;
  let previousSignificant = first >= 0 ? source[first] : '';
  for (let index = quote ? first + 1 : Math.max(first, 0); index < source.length; index += 1) {
    const char = source[index];
    if (escaped) { escaped = false; continue; }
    if (quote === '"') {
      if (char === '\\') escaped = true;
      else if (char === '"') { quote = null; previousSignificant = char; }
      continue;
    }
    if (quote === "'") {
      if (char === "'" && source[index + 1] === "'") index += 1;
      else if (char === "'") { quote = null; previousSignificant = char; }
      continue;
    }
    if (collection && (char === '"' || char === "'") && /[\[\{,:]/.test(previousSignificant)) {
      quote = char; continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(source[index - 1]))) return source.slice(0, index).trimEnd();
    if (!/\s/.test(char)) previousSignificant = char;
  }
  return source;
}

function parseYamlScalar(value) {
  if (value === undefined) return undefined;
  const raw = stripYamlComment(value).trim();
  if (!raw || /^(?:null|~)$/i.test(raw)) return null;
  if (raw.startsWith('"')) {
    if (!raw.endsWith('"')) return invalidYamlValue(raw);
    try { return JSON.parse(raw); } catch (_) { return invalidYamlValue(raw); }
  }
  if (raw.startsWith("'")) {
    if (!raw.endsWith("'")) return invalidYamlValue(raw);
    const body = raw.slice(1, -1);
    if (body.replace(/''/g, '').includes("'")) return invalidYamlValue(raw);
    return body.replace(/''/g, "'");
  }
  if (/^(?:true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function invalidYamlValue(raw) {
  return { __invalid_yaml__: String(raw || '') };
}

function jsonDuplicateStatus(raw) {
  let index = 0; let duplicate = false;
  const skip = () => { while (/\s/.test(raw[index] || '')) index += 1; };
  const string = () => {
    const start = index;
    if (raw[index] !== '"') throw new Error('string');
    index += 1;
    while (index < raw.length) {
      if (raw[index] === '\\') { index += 2; continue; }
      if (raw[index] === '"') {
        index += 1;
        return JSON.parse(raw.slice(start, index));
      }
      index += 1;
    }
    throw new Error('unterminated');
  };
  const value = () => {
    skip();
    if (raw[index] === '{') {
      index += 1; skip();
      const keys = new Set();
      if (raw[index] === '}') { index += 1; return; }
      while (index < raw.length) {
        const key = string();
        if (keys.has(key)) duplicate = true;
        keys.add(key); skip();
        if (raw[index] !== ':') throw new Error('colon');
        index += 1; value(); skip();
        if (raw[index] === '}') { index += 1; return; }
        if (raw[index] !== ',') throw new Error('comma');
        index += 1; skip();
      }
      throw new Error('object');
    }
    if (raw[index] === '[') {
      index += 1; skip();
      if (raw[index] === ']') { index += 1; return; }
      while (index < raw.length) {
        value(); skip();
        if (raw[index] === ']') { index += 1; return; }
        if (raw[index] !== ',') throw new Error('comma');
        index += 1;
      }
      throw new Error('array');
    }
    if (raw[index] === '"') { string(); return; }
    const token = raw.slice(index).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!token) throw new Error('value');
    index += token[0].length;
  };
  try {
    value(); skip();
    return index === raw.length ? duplicate : null;
  } catch (_) { return null; }
}

function splitYamlFlow(raw) {
  const values = [];
  let current = ''; let quote = null; let escaped = false;
  let squareDepth = 0; let curlyDepth = 0; let wikilinkDepth = 0;
  let previousSignificant = '';
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]; const pair = raw.slice(index, index + 2);
    if (escaped) { current += char; escaped = false; continue; }
    if (quote) {
      current += char;
      if (char === '\\' && quote === '"') escaped = true;
      else if (char === "'" && quote === "'" && raw[index + 1] === "'") {
        current += raw[index + 1]; index += 1;
      }
      else if (char === quote) { quote = null; previousSignificant = char; }
      continue;
    }
    if (wikilinkDepth === 0 && (char === '"' || char === "'")
      && (!previousSignificant || /[\[\{,:]/.test(previousSignificant))) {
      quote = char; current += char; continue;
    }
    if (pair === '[[') { wikilinkDepth += 1; current += pair; previousSignificant = '['; index += 1; continue; }
    if (pair === ']]' && wikilinkDepth > 0) { wikilinkDepth -= 1; current += pair; previousSignificant = ']'; index += 1; continue; }
    if (wikilinkDepth === 0) {
      if (char === '[') squareDepth += 1;
      else if (char === ']') squareDepth -= 1;
      else if (char === '{') curlyDepth += 1;
      else if (char === '}') curlyDepth -= 1;
      if (char === ',' && squareDepth === 0 && curlyDepth === 0) {
        values.push(current.trim()); current = ''; previousSignificant = ''; continue;
      }
    }
    current += char;
    if (!/\s/.test(char)) previousSignificant = char;
  }
  if (quote || wikilinkDepth || squareDepth || curlyDepth) return null;
  values.push(current.trim());
  return values;
}

function parseYamlValue(value) {
  const raw = stripYamlComment(value).trim();
  if (/^\[\[[^\[\]\n|]+(?:\|[^\[\]\n]+)?\]\]$/.test(raw)) return raw;
  if (raw.startsWith('[')) {
    if (!raw.endsWith(']')) return invalidYamlValue(raw);
    const duplicateStatus = jsonDuplicateStatus(raw);
    if (duplicateStatus) return invalidYamlValue(raw);
    try { return JSON.parse(raw); } catch (_) {
      const parts = splitYamlFlow(raw.slice(1, -1));
      if (!parts) return invalidYamlValue(raw);
      if (parts.length === 1 && parts[0] === '') return [];
      return parts.map(parseYamlValue);
    }
  }
  if (raw.startsWith('{')) {
    if (!raw.endsWith('}')) return invalidYamlValue(raw);
    const duplicateStatus = jsonDuplicateStatus(raw);
    if (duplicateStatus) return invalidYamlValue(raw);
    try { return JSON.parse(raw); } catch (_) {
      const parts = splitYamlFlow(raw.slice(1, -1));
      if (!parts) return invalidYamlValue(raw);
      const out = {};
      for (const part of parts) {
        const match = part.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
        if (!match || Object.prototype.hasOwnProperty.call(out, match[1])) return invalidYamlValue(raw);
        out[match[1]] = parseYamlValue(match[2]);
      }
      return out;
    }
  }
  return parseYamlScalar(raw);
}

function typedScalarField(raw, key) {
  return parseYamlScalar(rawScalarField(raw, key));
}

function listField(raw, key) {
  const lines = frontmatterBody(raw).split('\n');
  const index = lines.findIndex((value) => new RegExp(`^${key}\\s*:`).test(value));
  if (index < 0) return undefined;
  const inline = lines[index].slice(lines[index].indexOf(':') + 1).trim();
  if (inline) return parseYamlValue(inline);
  const block = [];
  for (let i = index + 1; i < lines.length && /^\s+/.test(lines[i]); i += 1) block.push(lines[i]);
  const content = block.filter((line) => line.trim() && !line.trim().startsWith('#'));
  if (!content.length) return null;
  if (content.length === 1 && content[0].trim() === '[]') return [];
  const out = []; let currentObject = null;
  for (const line of content) {
    const item = line.match(/^\s+-\s*(.*?)\s*$/);
    if (item) {
      const mapping = item[1].match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (mapping) {
        currentObject = { [mapping[1]]: parseYamlValue(mapping[2]) };
        out.push(currentObject);
      } else {
        currentObject = null;
        out.push(parseYamlValue(item[1]));
      }
      continue;
    }
    const continuation = line.match(/^\s+([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
    if (!continuation || !currentObject
      || Object.prototype.hasOwnProperty.call(currentObject, continuation[1])) return invalidYamlValue(content.join('\n'));
    currentObject[continuation[1]] = parseYamlValue(continuation[2]);
  }
  return out;
}

function canonicalizeDeploymentTokens(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([vault, additions]) => [
    vault,
    Array.isArray(additions)
      ? additions.map((item) => (typeof item === 'string' ? item.trim() : item))
      : additions,
  ]));
}

function deploymentField(raw) {
  const lines = frontmatterBody(raw).split('\n');
  const index = lines.findIndex((value) => /^deploy_subscriptions\s*:/.test(value));
  if (index < 0) return undefined;
  const inlineMap = lines[index].slice(lines[index].indexOf(':') + 1).trim();
  if (inlineMap) return canonicalizeDeploymentTokens(parseYamlValue(inlineMap));
  const out = {}; let current = null;
  for (let i = index + 1; i < lines.length; i += 1) {
    if (lines[i] && !/^\s+/.test(lines[i])) break;
    if (!lines[i].trim() || lines[i].trim().startsWith('#')) continue;
    const vault = lines[i].match(/^\s{2}([a-zA-Z0-9_-]+)\s*:\s*(.*?)\s*$/);
    if (vault) {
      current = vault[1];
      const inline = vault[2];
      if (!inline) out[current] = null;
      else out[current] = parseYamlValue(inline);
      continue;
    }
    const item = lines[i].match(/^\s{4}-\s+(.*?)\s*$/);
    if (item && current) {
      if (out[current] === null) out[current] = [];
      if (!Array.isArray(out[current])) return invalidYamlValue(lines[i]);
      out[current].push(parseYamlValue(item[1]));
      continue;
    }
    return invalidYamlValue(lines[i]);
  }
  return canonicalizeDeploymentTokens(out);
}

function evidenceField(raw) {
  const inline = rawScalarField(raw, 'evidence');
  if (inline !== undefined) return listField(raw, 'evidence');
  const section = String(raw || '').match(/^### Evidence\s*\n([\s\S]*?)(?=^###\s|\s*$)/m);
  if (!section) return undefined;
  const claims = section[1].split('\n').map((line) => line.match(/^\s*-\s+(.+?)\s*$/))
    .filter(Boolean).map((match) => match[1].trim());
  return claims.length ? claims : undefined;
}

function parseDeliveryCard(raw, card) {
  const schemaVersion = typedScalarField(raw, 'schema_version');
  const authoredCard = typedScalarField(raw, 'card');
  const executionMode = typedScalarField(raw, 'execution_mode');
  const touchZones = listField(raw, 'touch_zones');
  const authoredDependencies = rawScalarField(raw, 'depends_on');
  const dependencies = listField(raw, 'depends_on');
  const evidence = evidenceField(raw);
  const parsed = {
    // Historical notes may infer a missing identity from their exact board/file
    // name. Current contracts must author it, and an authored value is never
    // overwritten by the caller because that would mask identity drift.
    card: authoredCard !== undefined ? authoredCard : (schemaVersion === undefined ? card : ''),
    parent_card: typedScalarField(raw, 'parent_card'),
    slice: typedScalarField(raw, 'slice'),
    model_profile: typedScalarField(raw, 'model_profile'),
    status: typedScalarField(raw, 'status'),
    deploy_subscriptions: deploymentField(raw),
    epic: typedScalarField(raw, 'epic'),
    context_pack: typedScalarField(raw, 'context_pack'),
  };
  const authoredBatchPolicy = typedScalarField(raw, 'batch_policy');
  const batchPolicy = parseBatchPolicy(raw);
  const riskDimensions = listField(raw, 'risk_dimensions');
  const authoredReleaseRequired = typedScalarField(raw, 'release_required');
  const authoredDeploymentRequired = typedScalarField(raw, 'deployment_required');
  if (schemaVersion !== undefined) parsed.schema_version = schemaVersion;
  if (executionMode !== undefined) parsed.execution_mode = executionMode;
  if (touchZones !== undefined) parsed.touch_zones = touchZones;
  if (authoredDependencies !== undefined) parsed.depends_on = dependencies;
  if (evidence !== undefined) parsed.evidence = evidence;
  if (authoredBatchPolicy !== undefined) parsed.batch_policy = authoredBatchPolicy;
  else if (schemaVersion === undefined && batchPolicy) parsed.batch_policy = batchPolicy;
  if (riskDimensions !== undefined) parsed.risk_dimensions = riskDimensions;
  if (authoredReleaseRequired !== undefined) parsed.release_required = authoredReleaseRequired;
  if (authoredDeploymentRequired !== undefined) parsed.deployment_required = authoredDeploymentRequired;
  return parsed;
}

function prepareDeliveryObject(value) {
  const original = value && typeof value === 'object' && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value)) : {};
  const version = original.schema_version;
  const hasVersion = Object.prototype.hasOwnProperty.call(original, 'schema_version');
  const comparison = hasVersion ? delivery.compareVersions(version, delivery.CONTRACT_VERSION) : -1;
  if (hasVersion && (typeof version !== 'string' || comparison == null)) {
    const validation = delivery.validateCard(original, 'current');
    return { ok: false, source: 'invalid', card: validation.card, validation, migration: null };
  }
  if (comparison === 1) {
    const validation = delivery.validateCard(original, 'current');
    return { ok: false, source: 'future', card: validation.card, validation, migration: null };
  }
  if (comparison === -1) {
    const historical = delivery.validateCard(original, 'historical');
    const migrationBackfills = new Set(['execution_mode', 'depends_on', 'deploy_subscriptions']);
    const blockingErrors = historical.errors.filter((item) => !(
      item.code === 'required-field' && migrationBackfills.has(item.field)
    ));
    if (blockingErrors.length) {
      return {
        ok: false, source: 'historical', card: historical.card, migration: null,
        validation: { ...historical, ok: false, errors: blockingErrors },
      };
    }
    const migration = delivery.migrate(original, version);
    if (!migration.ok) {
      return {
        ok: false, source: 'historical', card: original, migration,
        validation: { ok: false, errors: [{ code: migration.reason, field: 'schema_version', message: migration.reason }], warnings: [] },
      };
    }
    const validation = delivery.validateCard(migration.note, 'historical');
    const migratedCard = { ...validation.card };
    // normalizeCard represents an omitted optional historical evidence field as
    // []; preserve the omission so a second shared validation does not turn a
    // readable historical card into an explicitly invalid empty evidence list.
    if (!Object.prototype.hasOwnProperty.call(migration.note, 'evidence')) delete migratedCard.evidence;
    return { ok: validation.ok, source: 'historical', card: migratedCard, validation, migration };
  }
  const validation = delivery.validateCard(original, 'current');
  return { ok: validation.ok && !validation.requires_migration, source: 'current', card: validation.card, validation, migration: null };
}

function prepareDeliveryCard(raw, card) {
  const rawCard = parseDeliveryCard(raw, card);
  const prepared = prepareDeliveryObject(rawCard);
  const authoredIdentity = typedScalarField(raw, 'card');
  const expectedIdentity = delivery.normalizeIdentity(card);
  const boundaryErrors = [];
  if (typeof rawCard.depends_on === 'string' && !delivery.normalizeIdentity(rawCard.depends_on)) {
    boundaryErrors.push({
      code: 'invalid-dependency', field: 'depends_on',
      message: 'authored scalar dependency must contain a non-empty identity',
    });
  }
  if (authoredIdentity !== undefined && expectedIdentity
    && delivery.normalizeIdentity(authoredIdentity) !== expectedIdentity) {
    boundaryErrors.push({
      code: 'identity-mismatch', field: 'card',
      message: `authored card identity ${delivery.normalizeIdentity(authoredIdentity)} differs from ${expectedIdentity}`,
    });
  }
  const contractFields = new Set(delivery.registry.types['execution-card'].fields.map((field) => field.name));
  const counts = new Map();
  const deploymentVaultCounts = new Map();
  let inDeploymentMap = false;
  for (const line of frontmatterBody(raw).split('\n')) {
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/);
    if (match) {
      inDeploymentMap = match[1] === 'deploy_subscriptions';
      if (contractFields.has(match[1])) counts.set(match[1], (counts.get(match[1]) || 0) + 1);
      continue;
    }
    if (inDeploymentMap) {
      const vault = line.match(/^\s{2}([a-zA-Z0-9_-]+)\s*:/);
      if (vault) deploymentVaultCounts.set(vault[1], (deploymentVaultCounts.get(vault[1]) || 0) + 1);
      else if (line && !/^\s+/.test(line)) inDeploymentMap = false;
    }
  }
  for (const [field, count] of counts) {
    if (count > 1) boundaryErrors.push({
      code: 'duplicate-field', field,
      message: `${field} is authored ${count} times and is ambiguous`,
    });
  }
  for (const [vault, count] of deploymentVaultCounts) {
    if (count > 1) boundaryErrors.push({
      code: 'duplicate-field', field: `deploy_subscriptions.${vault}`,
      message: `deploy_subscriptions.${vault} is authored ${count} times and is ambiguous`,
    });
  }
  if (boundaryErrors.length) {
    return {
      ...prepared, ok: false, raw_card: rawCard,
      validation: {
        ...(prepared.validation || {}), ok: false,
        errors: [...((prepared.validation && prepared.validation.errors) || []), ...boundaryErrors],
      },
    };
  }
  return { ...prepared, raw_card: rawCard };
}

function validationReason(prepared) {
  const errors = prepared && prepared.validation && Array.isArray(prepared.validation.errors)
    ? prepared.validation.errors : [];
  return errors.length ? errors.map((item) => `${item.code}:${item.field}`).join(', ') : 'contract-invalid';
}

// Parse autoloop-queue.md into items. Each item starts at a `- id:` line; its
// indented `key: value` lines become fields. Items without an id are dropped.
function parseQueue(md) {
  const items = [];
  let cur = null;
  for (const raw of String(md || '').split('\n')) {
    const idm = raw.match(/^\s*-\s+id:\s*(\S.*?)\s*$/);
    if (idm) { if (cur && cur.id) items.push(cur); cur = { id: idm[1].trim() }; continue; }
    if (!cur) continue;
    const kv = raw.match(/^\s+([a-zA-Z_]+):\s*(.*?)\s*$/);
    if (kv) { cur[kv[1]] = kv[2].trim(); continue; }
    if (raw.trim() === '') { if (cur && cur.id) items.push(cur); cur = null; }
  }
  if (cur && cur.id) items.push(cur);
  return items;
}

// Pick the top open, in-scope, not-yet-shipped queue item.
function selectFromQueue(o) {
  const { queueMd, shippedIds = [] } = o || {};
  const shipped = new Set(shippedIds);
  const open = parseQueue(queueMd).filter((it) => (it.status || 'proposed') === 'proposed' && !shipped.has(it.id));
  const skipped = [];
  for (const it of open) {
    const scope = isBroadScope(`${it.title || ''}\n${it.rationale || ''}`);
    if (scope.broad) { skipped.push({ id: it.id, reason: scope.reason }); continue; }
    return { action: 'work', card: it.id, title: it.title, category: it.category, fromQueue: true, skipped, reason: 'top eligible queue item' };
  }
  return open.length
    ? { action: 'no-eligible-work', reason: 'all open queue items are broad-scope', skipped }
    : { action: 'no-work', reason: 'queue has no eligible items' };
}

// Extract the "Recommended next" card name from a handoff markdown, if present.
function recommendedFrom(handoffMd) {
  if (!handoffMd) return null;
  const m = String(handoffMd).match(/##\s*Recommended next[\s\S]*?\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/i);
  return m ? m[1].trim() : null;
}

/**
 * selectCard — decide what (if anything) this turn should work on.
 * @returns {{action:string, card?:string, reason:string, skipped?:Array, cards?:string[]}}
 */
function selectCard(o) {
  const { haltExists, boardMd, handoffMd, loadBody, supervised = false } = o || {};
  if (haltExists) return { action: 'halt', reason: 'kill-switch sentinel present' };
  const cols = parseBoard(boardMd);
  const planning = cols['In Planning'];
  if (!planning.length) return { action: 'no-work', reason: 'Planning column empty' };
  const rec = recommendedFrom(handoffMd);
  const ordered = rec && planning.includes(rec)
    ? [rec, ...planning.filter((c) => c !== rec)]
    : planning.slice();
  const skipped = [];
  const checked = parsePlanningChecked(boardMd);
  const completed = parseCheckedColumn(boardMd, 'Completed');
  for (const card of ordered) {
    if (checked.has(card)) { skipped.push({ card, reason: 'checked (done) in Planning' }); continue; }
    const raw = loadBody ? (loadBody(card) || '') : '';
    const prepared = prepareDeliveryCard(raw, card);
    if (!prepared.ok) {
      skipped.push({ card, reason: `delivery contract invalid: ${validationReason(prepared)}` }); continue;
    }
    const status = prepared.card.status;
    if (status !== undefined && status !== 'planning') {
      skipped.push({ card, reason: `card status is not planning: ${status || 'unknown'}` }); continue;
    }
    // Dependency gate: a card with `depends_on: [[X]]` frontmatter is skipped
    // until EVERY predecessor is in the Completed column (the loop's done-signal).
    // Fail-safe by construction — an unmet, misspelled, or cyclic dependency
    // leaves the card un-eligible (it never runs prematurely) and surfaces the
    // reason in `skipped`, rather than guessing. This is what lets a multi-slice
    // epic self-sequence in order when the whole chain sits in Planning.
    const deps = prepared.card.depends_on;
    const unmet = deps.filter((d) => !completed.has(d));
    if (unmet.length) { skipped.push({ card, reason: `depends_on not complete: ${unmet.join(', ')}` }); continue; }
    const eligibility = delivery.batchEligibility(prepared.card, {
      mode: prepared.source === 'historical' ? 'historical' : 'current',
      supervised,
      dependency_result: { eligible: true, missing_proof: [] },
    });
    if (!eligibility.eligible) {
      skipped.push({ card, reason: `delivery batch ineligible: ${eligibility.reason}` }); continue;
    }
    // Attempt-anything: do NOT skip on broad scope — pick it and pass a hint so
    // Phase C can scope / block-with-questions if it really is too big.
    const scope = isBroadScope(`${card}\n${stripCardChrome(raw)}`);
    return {
      action: 'work', card, skipped, broadHint: scope.broad ? scope.reason : null,
      reason: rec === card ? 'recommended' : 'first Planning card (attempt-anything)',
    };
  }
  const blockedByDeps = skipped.some((s) => /depends_on/.test(s.reason));
  return {
    action: 'no-eligible-work',
    reason: blockedByDeps
      ? 'all Planning cards are [x]-checked or waiting on unmet dependencies'
      : 'all Planning cards are [x]-checked',
    skipped,
  };
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) { const key = k.slice(2); const v = argv[i + 1]; if (v && !v.startsWith('--')) { a[key] = v; i++; } else a[key] = true; }
  }
  return a;
}

function cliLoadBody(cardsRoot) {
  return (card) => {
    if (!cardsRoot) return '';
    // tasks/<W>/board/<Card>/<Card>.md — recursive basename match.
    try {
      const fname = `${card}.md`;
      const stack = [cardsRoot];
      while (stack.length) {
        const dir = stack.pop();
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, ent.name);
          if (ent.isDirectory()) stack.push(p);
          else if (ent.name === fname) return fs.readFileSync(p, 'utf8');
        }
      }
    } catch (_) { /* fall through */ }
    return '';
  };
}

module.exports = {
  selectCard, isBroadScope, parseBoard, recommendedFrom, parsePlanningChecked,
  parseCheckedColumn, parseDependsOn, parseQueue, selectFromQueue, stripCardChrome,
  normalizeStatus, parseCardStatus, parseBatchPolicy,
  delivery, parseDeliveryCard, prepareDeliveryObject, prepareDeliveryCard, validationReason,
};

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } };
  const result = selectCard({
    haltExists: args.halt ? fs.existsSync(args.halt) : false,
    boardMd: args.board ? read(args.board) : '',
    handoffMd: args.handoff ? read(args.handoff) : '',
    loadBody: cliLoadBody(args['cards-root']),
    supervised: Boolean(args.supervised),
  });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`${result.action}${result.card ? ': ' + result.card : ''} — ${result.reason}`);
  process.exit(0);
}
