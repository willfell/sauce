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

function listField(raw, key) {
  const lines = frontmatterBody(raw).split('\n');
  const index = lines.findIndex((value) => new RegExp(`^${key}\\s*:`).test(value));
  if (index < 0) return undefined;
  const inline = lines[index].slice(lines[index].indexOf(':') + 1).trim();
  if (inline) {
    if (inline === '[]') return [];
    if (inline.startsWith('[')) {
      try { return JSON.parse(inline); } catch (_) { return inline; }
    }
    return inline;
  }
  const out = [];
  for (let i = index + 1; i < lines.length && /^\s+/.test(lines[i]); i += 1) {
    const match = lines[i].match(/^\s+-\s+(.*?)\s*$/);
    if (match) out.push(match[1].replace(/^['"]|['"]$/g, ''));
  }
  return out;
}

function deploymentField(raw) {
  const lines = frontmatterBody(raw).split('\n');
  const index = lines.findIndex((value) => /^deploy_subscriptions\s*:/.test(value));
  if (index < 0) return undefined;
  const out = {}; let current = null;
  for (let i = index + 1; i < lines.length; i += 1) {
    if (lines[i] && !/^\s+/.test(lines[i])) break;
    const vault = lines[i].match(/^\s{2}([a-zA-Z0-9_-]+)\s*:\s*(.*?)\s*$/);
    if (vault) {
      current = vault[1];
      const inline = vault[2];
      if (!inline || inline === '[]') out[current] = [];
      else {
        try { out[current] = JSON.parse(inline); }
        catch (_) { out[current] = inline; }
      }
      continue;
    }
    const item = lines[i].match(/^\s{4}-\s+(.*?)\s*$/);
    if (item && current && Array.isArray(out[current])) out[current].push(item[1].replace(/^['"]|['"]$/g, ''));
  }
  return out;
}

function parseBoolean(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function evidenceField(raw) {
  const inline = rawScalarField(raw, 'evidence');
  if (inline !== undefined) {
    try {
      const parsed = JSON.parse(inline);
      return parsed;
    } catch (_) { return inline; }
  }
  const section = String(raw || '').match(/^### Evidence\s*\n([\s\S]*?)(?=^###\s|\s*$)/m);
  if (!section) return undefined;
  const claims = section[1].split('\n').map((line) => line.match(/^\s*-\s+(.+?)\s*$/))
    .filter(Boolean).map((match) => match[1].trim());
  return claims.length ? claims : undefined;
}

function parseDeliveryCard(raw, card) {
  const schemaVersion = frontmatterScalar(raw, 'schema_version');
  const authoredCard = frontmatterScalar(raw, 'card');
  const executionMode = frontmatterScalar(raw, 'execution_mode');
  const touchZones = listField(raw, 'touch_zones');
  const dependencyFieldPresent = rawScalarField(raw, 'depends_on') !== undefined;
  const evidence = evidenceField(raw);
  const parsed = {
    // Historical notes may infer a missing identity from their exact board/file
    // name. Current contracts must author it, and an authored value is never
    // overwritten by the caller because that would mask identity drift.
    card: String(authoredCard !== undefined ? authoredCard : (schemaVersion === undefined ? card : '') || '').trim(),
    parent_card: frontmatterScalar(raw, 'parent_card'),
    slice: frontmatterScalar(raw, 'slice'),
    model_profile: frontmatterScalar(raw, 'model_profile'),
    status: frontmatterScalar(raw, 'status'),
    deploy_subscriptions: deploymentField(raw),
    epic: frontmatterScalar(raw, 'epic'),
    context_pack: frontmatterScalar(raw, 'context_pack'),
  };
  const authoredBatchPolicy = rawScalarField(raw, 'batch_policy');
  const batchPolicy = parseBatchPolicy(raw);
  const riskDimensions = listField(raw, 'risk_dimensions');
  const releaseRequired = parseBoolean(frontmatterScalar(raw, 'release_required'));
  const deploymentRequired = parseBoolean(frontmatterScalar(raw, 'deployment_required'));
  if (schemaVersion !== undefined) parsed.schema_version = schemaVersion;
  if (executionMode !== undefined) parsed.execution_mode = executionMode;
  if (touchZones !== undefined) parsed.touch_zones = touchZones;
  if (dependencyFieldPresent) parsed.depends_on = parseDependsOn(raw);
  if (evidence !== undefined) parsed.evidence = evidence;
  if (authoredBatchPolicy !== undefined) parsed.batch_policy = batchPolicy || authoredBatchPolicy;
  else if (schemaVersion === undefined && batchPolicy) parsed.batch_policy = batchPolicy;
  if (riskDimensions !== undefined) parsed.risk_dimensions = riskDimensions;
  if (releaseRequired !== undefined) parsed.release_required = releaseRequired;
  if (deploymentRequired !== undefined) parsed.deployment_required = deploymentRequired;
  return parsed;
}

function prepareDeliveryObject(value) {
  const original = value && typeof value === 'object' && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value)) : {};
  const version = original.schema_version;
  const comparison = version == null ? -1 : delivery.compareVersions(version, delivery.CONTRACT_VERSION);
  if (version != null && comparison == null) {
    const validation = delivery.validateCard(original, 'current');
    return { ok: false, source: 'invalid', card: validation.card, validation, migration: null };
  }
  if (comparison === 1) {
    const validation = delivery.validateCard(original, 'current');
    return { ok: false, source: 'future', card: validation.card, validation, migration: null };
  }
  if (comparison === -1) {
    const historical = delivery.validateCard(original, 'historical');
    if (!historical.ok) return { ok: false, source: 'historical', card: historical.card, validation: historical, migration: null };
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
  const authoredIdentity = frontmatterScalar(raw, 'card');
  const expectedIdentity = delivery.normalizeIdentity(card);
  const boundaryErrors = [];
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
