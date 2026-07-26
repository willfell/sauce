'use strict';

const crypto = require('crypto');
const sourceRegistry = require('../data/delivery-schema.json');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const registry = deepFreeze(sourceRegistry);
const CONTRACT_VERSION = registry.contract.version;
const MINIMUM_COMPATIBLE_VERSION = registry.contract.minimum_compatible_version;
const REQUIRED_VAULTS = registry.policies.required_vaults;
const STRUCTURED_FRONTMATTER_FIELDS = Object.freeze({
  evidence: 'array',
  deploy_subscriptions: 'object',
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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

function decodeStructuredContractFields(card) {
  const decoded = clone(card && typeof card === 'object' && !Array.isArray(card) ? card : {});
  const errors = [];
  for (const [field, expected] of Object.entries(STRUCTURED_FRONTMATTER_FIELDS)) {
    if (typeof decoded[field] !== 'string') continue;
    const raw = decoded[field].trim();
    const duplicate = jsonDuplicateStatus(raw);
    if (!raw || duplicate === null) {
      errors.push({
        code: 'invalid-structured-json', field,
        message: `${field} JSON string is malformed`,
      });
      continue;
    }
    if (duplicate) {
      errors.push({
        code: 'duplicate-structured-json-key', field,
        message: `${field} JSON string contains a duplicate object key`,
      });
      continue;
    }
    const parsed = JSON.parse(raw);
    const expectedShape = expected === 'array'
      ? Array.isArray(parsed)
      : parsed && typeof parsed === 'object' && !Array.isArray(parsed);
    if (!expectedShape) {
      errors.push({
        code: 'invalid-structured-json-shape', field,
        message: `${field} JSON string must encode one ${expected}`,
      });
      continue;
    }
    decoded[field] = parsed;
  }
  return { card: decoded, errors };
}

function encodeStructuredFrontmatterValue(value) {
  return JSON.stringify(JSON.stringify(value));
}

function compareVersions(left, right) {
  const parse = (value) => {
    const match = String(value == null ? '' : value).trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
    return match ? match.slice(1).map(Number) : null;
  };
  const a = parse(left); const b = parse(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

function normalizeIdentity(value) {
  let raw = String(value == null ? '' : value).trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    const quote = raw[0];
    raw = raw.slice(1, -1).trim();
    raw = quote === '"' ? raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : raw.replace(/''/g, "'");
  }
  const wikilink = raw.match(/^\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]$/);
  return (wikilink ? wikilink[1] : raw).trim();
}

function normalizeStatus(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase().replace(/^['"]|['"]$/g, '');
  return raw ? (registry.status_aliases[raw] || null) : null;
}

function parseDependencyField(value) {
  if (Array.isArray(value)) return [...new Set(value.map(normalizeIdentity).filter(Boolean))];
  let raw = String(value == null ? '' : value).trim();
  if (!raw) return [];
  if (/^depends_on\s*:/i.test(raw)) raw = raw.replace(/^depends_on\s*:/i, '').trim();
  if (!raw) {
    const lines = String(value).split('\n').slice(1);
    return [...new Set(lines.map((line) => normalizeIdentity(line.replace(/^\s*-\s*/, ''))).filter(Boolean))];
  }
  if (raw.includes('\n')) {
    return [...new Set(raw.split('\n').map((line) => normalizeIdentity(line.replace(/^\s*-\s*/, ''))).filter(Boolean))];
  }
  if (raw.startsWith('[') && raw.endsWith(']') && (!raw.startsWith('[[') || raw.startsWith('[[['))) {
    const body = raw.slice(1, -1);
    const items = []; let current = ''; let quote = null; let wikilinkDepth = 0; let escaped = false;
    for (let index = 0; index < body.length; index += 1) {
      const char = body[index]; const pair = body.slice(index, index + 2);
      if (escaped) { current += char; escaped = false; continue; }
      if (quote) {
        current += char;
        if (char === '\\') escaped = true;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") { quote = char; current += char; continue; }
      if (pair === '[[') { wikilinkDepth += 1; current += pair; index += 1; continue; }
      if (pair === ']]' && wikilinkDepth > 0) { wikilinkDepth -= 1; current += pair; index += 1; continue; }
      if (char === ',' && wikilinkDepth === 0) { items.push(current); current = ''; continue; }
      current += char;
    }
    items.push(current);
    return [...new Set(items.map(normalizeIdentity).filter(Boolean))];
  }
  if (/^-\s+/.test(raw)) return [normalizeIdentity(raw.replace(/^-\s+/, ''))].filter(Boolean);
  return [normalizeIdentity(raw)].filter(Boolean);
}

function normalizeEvidenceClaim(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const field of ['source_identity', 'captured_at', 'revision', 'locator', 'claim']) {
    out[field] = typeof value[field] === 'string' ? value[field].trim() : '';
  }
  return out;
}

function evidenceTimestampValid(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const hour = Number(hourText); const minute = Number(minuteText); const second = Number(secondText);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    || hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== 'Z' && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) return false;
  return !Number.isNaN(Date.parse(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function pinnedReceiptValid(receipt) {
  return receipt && receipt.ok === true
    && typeof receipt.receipt_id === 'string' && receipt.receipt_id.trim()
    && evidenceTimestampValid(receipt.checked_at)
    && /^[0-9a-f]{40}$/i.test(String(receipt.verifier_revision || ''));
}

function normalizeZoneEntry(zone, defaultRoot = 'workshop') {
  const entry = typeof zone === 'string' ? { root: defaultRoot, path: zone } : zone;
  if (!entry || typeof entry !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(entry, 'root') && typeof entry.root !== 'string') return null;
  if (typeof entry.path !== 'string') return null;
  const root = (entry.root || defaultRoot).trim();
  const rawPath = entry.path.trim().replace(/^\.\//, '').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (!root || !rawPath || rawPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rawPath)) return null;
  const parts = rawPath.split('/');
  if (parts.some((part) => part === '..' || part === '')) return null;
  const normalizedPath = parts.filter((part) => part !== '.').join('/');
  if (!normalizedPath) return null;
  return { root, path: normalizedPath };
}

function normalizeCard(card) {
  const out = decodeStructuredContractFields(card).card;
  for (const key of ['card', 'parent_card', 'slice', 'epic', 'context_pack']) {
    if (Object.prototype.hasOwnProperty.call(out, key)) out[key] = key === 'parent_card'
      ? normalizeIdentity(out[key]) : String(out[key] == null ? '' : out[key]).trim();
  }
  if (Object.prototype.hasOwnProperty.call(out, 'status')) out.status = normalizeStatus(out.status);
  out.execution_mode = String(out.execution_mode || 'release').trim();
  out.depends_on = parseDependencyField(out.depends_on);
  out.touch_zones = Array.isArray(out.touch_zones)
    ? out.touch_zones.map((zone) => normalizeZoneEntry(zone)).filter(Boolean).map((zone) => zone.root === 'workshop' ? zone.path : zone)
    : [];
  out.evidence = Array.isArray(out.evidence) ? out.evidence.map((item) => {
    const normalized = normalizeEvidenceClaim(item);
    return normalized || (typeof item === 'string' ? item.trim() : item);
  }).filter(Boolean) : [];
  out.risk_dimensions = Array.isArray(out.risk_dimensions)
    ? [...new Set(out.risk_dimensions.map((item) => String(item).trim()).filter(Boolean))] : [];
  if (!Object.prototype.hasOwnProperty.call(out, 'release_required')) out.release_required = out.execution_mode === 'release';
  if (!Object.prototype.hasOwnProperty.call(out, 'deployment_required')) out.deployment_required = out.execution_mode === 'release';
  if (!out.batch_policy) out.batch_policy = derivePolicy({ ...out, batch_policy: 'continue' });
  return out;
}

function fieldTypeValid(value, field) {
  switch (field.type) {
    case 'string': return typeof value === 'string' && value.trim().length > 0;
    case 'boolean': return typeof value === 'boolean';
    case 'integer:positive': return Number.isInteger(value) && value > 0;
    case 'integer:nonnegative': return Number.isInteger(value) && value >= 0;
    case 'array:string': return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim());
    case 'array:identity': return (typeof value === 'string')
      || (Array.isArray(value) && value.every((item) => typeof item === 'string' && normalizeIdentity(item)));
    case 'array:evidence-claim': return Array.isArray(value) && value.length > 0;
    case 'array:zone': return Array.isArray(value) && value.length > 0;
    case 'array:risk-dimension': return Array.isArray(value) && value.every((item) => registry.enums.risk_dimension.includes(item));
    case 'object:deployment-map': return value && typeof value === 'object' && !Array.isArray(value);
    default: return false;
  }
}

function error(code, field, message) {
  return { code, field, message };
}

function zonePath(zone) {
  const normalized = normalizeZoneEntry(zone);
  return normalized ? normalized.path : '';
}

function matchesPrefix(pathValue, prefix) {
  return pathValue === prefix || pathValue.startsWith(`${prefix}/`);
}

function derivePolicy(card) {
  const strength = registry.policies.policy_strength;
  const authored = strength.includes(card && card.batch_policy) ? card.batch_policy : 'continue';
  const zones = Array.isArray(card && card.touch_zones) ? card.touch_zones.map(zonePath).filter(Boolean) : [];
  const forced = zones.some((zone) => registry.policies.control_plane_zone_prefixes.some((prefix) => matchesPrefix(zone, prefix)))
    ? 'supervised_only' : 'continue';
  return strength[Math.max(strength.indexOf(authored), strength.indexOf(forced))];
}

function validateCard(card, mode = 'current') {
  const historical = (typeof mode === 'string' ? mode : mode.mode) === 'historical';
  const opts = typeof mode === 'object' && mode ? mode : {};
  const decoded = decodeStructuredContractFields(card);
  const raw = decoded.card;
  const normalized = normalizeCard(raw);
  const errors = [...decoded.errors];
  const warnings = [];
  const fields = registry.types['execution-card'].fields;
  const historicalOptional = new Set(['schema_version', 'batch_policy', 'evidence']);

  for (const field of fields) {
    const present = Object.prototype.hasOwnProperty.call(raw, field.name);
    if (field.required && !present && !(historical && historicalOptional.has(field.name))) {
      errors.push(error('required-field', field.name, `${field.name} is required`));
      continue;
    }
    if (!present && historical && historicalOptional.has(field.name)) continue;
    if (!present) continue;
    const value = field.name === 'status' ? normalized[field.name] : raw[field.name];
    if (!fieldTypeValid(value, field)) errors.push(error('invalid-type', field.name, `${field.name} must be ${field.type}`));
    if (field.enum && value != null && !registry.enums[field.enum].includes(value)) {
      errors.push(error('invalid-enum', field.name, `${field.name} must be one of ${registry.enums[field.enum].join('|')}`));
    }
  }

  if (Object.prototype.hasOwnProperty.call(raw, 'status') && !normalizeStatus(raw.status)) {
    errors.push(error('invalid-status', 'status', 'status does not normalize to the shared lifecycle vocabulary'));
  }
  if (Array.isArray(raw.evidence)) {
    raw.evidence.forEach((item, index) => {
      if (typeof item === 'string' && item.trim() && historical) {
        warnings.push(error('unpinned-evidence', `evidence.${index}`, 'historical evidence string has no timestamp or revision pin'));
        return;
      }
      const claim = normalizeEvidenceClaim(item);
      if (!claim || ['source_identity', 'captured_at', 'revision', 'locator', 'claim'].some((key) => !claim[key])) {
        errors.push(error('invalid-evidence-claim', `evidence.${index}`, 'evidence requires source_identity, captured_at, revision, locator, and claim'));
      } else if (!evidenceTimestampValid(claim.captured_at)) {
        errors.push(error('invalid-evidence-timestamp', `evidence.${index}.captured_at`, 'captured_at must be ISO-8601 with timezone'));
      }
    });
  }
  const version = raw.schema_version;
  const versionCmp = version == null ? null : compareVersions(version, CONTRACT_VERSION);
  const minimumCmp = version == null ? null : compareVersions(version, MINIMUM_COMPATIBLE_VERSION);
  if (version != null && versionCmp == null) errors.push(error('invalid-schema-version', 'schema_version', 'schema_version must be semver'));
  else if (versionCmp === 1) errors.push(error('schema-newer-than-engine', 'schema_version', 'card contract is newer than this engine'));
  else if (minimumCmp === -1) warnings.push(error('contract-migration-required', 'schema_version', 'card contract predates the minimum compatible version'));

  const roots = new Set(opts.workspace_roots || registry.policies.workspace_roots);
  if (Array.isArray(raw.touch_zones)) {
    const seenZones = new Set();
    for (const zone of raw.touch_zones) {
      const normalizedZone = normalizeZoneEntry(zone);
      if (!normalizedZone || !roots.has(normalizedZone.root)) {
        errors.push(error('invalid-touch-zone', 'touch_zones', 'touch zone must remain inside a declared workspace root'));
      } else {
        const identity = `${normalizedZone.root}:${normalizedZone.path}`;
        if (seenZones.has(identity)) errors.push(error('duplicate-touch-zone', 'touch_zones', `duplicate touch zone ${normalizedZone.path}`));
        seenZones.add(identity);
      }
    }
  }

  const deployments = raw.deploy_subscriptions;
  if (deployments && typeof deployments === 'object' && !Array.isArray(deployments)) {
    for (const vault of Object.keys(deployments)) {
      if (!REQUIRED_VAULTS.includes(vault)) {
        errors.push(error('unexpected-deployment-vault', `deploy_subscriptions.${vault}`, `${vault} is not a declared deployment target`));
      }
    }
    for (const vault of REQUIRED_VAULTS) {
      if (!Array.isArray(deployments[vault])) {
        errors.push(error('missing-deployment-vault', `deploy_subscriptions.${vault}`, `${vault} array is required`));
      } else if (deployments[vault].some((item) => typeof item !== 'string'
        || !/^(?:mechanism|blueprint):[a-z0-9][a-z0-9._-]*$/.test(item.trim()))) {
        errors.push(error('invalid-deployment-entry', `deploy_subscriptions.${vault}`, 'subscription additions must use mechanism:name or blueprint:name'));
      } else if (new Set(deployments[vault].map((item) => item.trim())).size !== deployments[vault].length) {
        errors.push(error('duplicate-deployment-entry', `deploy_subscriptions.${vault}`, 'subscription additions must be unique'));
      }
    }
  }

  if (normalized.execution_mode === 'docs_only'
    && (normalized.release_required !== false || normalized.deployment_required !== false)) {
    errors.push(error('docs-only-release-conflict', 'execution_mode', 'docs_only cannot require release or deployment'));
  }
  if (normalized.execution_mode === 'release'
    && (normalized.release_required !== true || normalized.deployment_required !== true)) {
    errors.push(error('release-proof-required', 'execution_mode', 'release mode requires release and deployment proof'));
  }

  const paths = normalized.touch_zones.map(zonePath).filter(Boolean);
  const highRisk = normalized.risk_dimensions.length > 0
    || paths.some((pathValue) => registry.policies.high_risk_zone_prefixes.some((prefix) => matchesPrefix(pathValue, prefix)));
  if (highRisk && normalized.model_profile !== 'heavy') {
    errors.push(error('high-risk-requires-heavy', 'model_profile', 'high-risk work requires the heavy model profile'));
  }
  const authoredStrength = registry.policies.policy_strength.indexOf(raw.batch_policy || 'continue');
  const derivedStrength = registry.policies.policy_strength.indexOf(derivePolicy(normalized));
  if (!(historical && !Object.prototype.hasOwnProperty.call(raw, 'batch_policy'))
    && authoredStrength >= 0 && authoredStrength < derivedStrength) {
    errors.push(error('policy-weakened', 'batch_policy', 'derived policy may strengthen but never weaken supervised_only'));
  }
  const cardIdentity = normalizeIdentity(raw.card);
  if (cardIdentity && normalized.depends_on.some((dependency) => dependency === cardIdentity)) {
    errors.push(error('self-dependency', 'depends_on', 'a card cannot depend on itself'));
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    card: normalized,
    contract_version: CONTRACT_VERSION,
    requires_migration: version == null || minimumCmp === -1,
    historical_unversioned: version == null,
  };
}

function validateFields(raw, type) {
  const definition = registry.types[type];
  if (!definition) return [error('unknown-record-kind', 'type', `unknown Delivery record kind ${type}`)];
  const errors = [];
  for (const field of definition.fields) {
    const present = Object.prototype.hasOwnProperty.call(raw, field.name);
    if (field.required && !present) {
      errors.push(error('required-field', field.name, `${field.name} is required`));
      continue;
    }
    if (!present) continue;
    if (!fieldTypeValid(raw[field.name], field)) {
      errors.push(error('invalid-type', field.name, `${field.name} must be ${field.type}`));
    }
    if (field.enum && raw[field.name] != null && !registry.enums[field.enum].includes(raw[field.name])) {
      errors.push(error('invalid-enum', field.name, `${field.name} must be one of ${registry.enums[field.enum].join('|')}`));
    }
  }
  return errors;
}

function recordVersionErrors(raw) {
  const errors = [];
  const comparison = compareVersions(raw.schema_version, CONTRACT_VERSION);
  if (comparison == null) errors.push(error('invalid-schema-version', 'schema_version', 'schema_version must be semver'));
  else if (comparison === 1) errors.push(error('schema-newer-than-engine', 'schema_version', 'record contract is newer than this engine'));
  else if (compareVersions(raw.schema_version, MINIMUM_COMPATIBLE_VERSION) === -1) {
    errors.push(error('schema-too-old', 'schema_version', 'record contract predates the minimum compatible version'));
  }
  return errors;
}

function recordKindVersionErrors(raw, type) {
  const definition = registry.types[type];
  const introduced = definition && definition.fields.length
    ? definition.fields.map((field) => field.since_version).sort(compareVersions).slice(-1)[0]
    : CONTRACT_VERSION;
  return compareVersions(raw.schema_version, introduced) === -1
    ? [error('record-kind-version', 'schema_version', `${type} records require schema_version ${introduced} or newer`)] : [];
}

function relativeMarkdownPath(value) {
  const raw = String(value == null ? '' : value).trim().replace(/\\/g, '/');
  return Boolean(raw) && !raw.startsWith('/') && !/^[A-Za-z]:\//.test(raw)
    && raw.endsWith('.md') && !raw.split('/').some((part) => !part || part === '.' || part === '..');
}

function validateEpic(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
  const errors = validateFields(raw, 'epic');
  if (raw.type !== 'epic') errors.push(error('record-kind-mismatch', 'type', 'epic records require type epic'));
  errors.push(...recordVersionErrors(raw));
  errors.push(...recordKindVersionErrors(raw, 'epic'));
  for (const field of registry.policies.epic_forbidden_execution_fields) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      errors.push(error('epic-execution-field', field, `epic records are non-claimable and must not carry ${field}`));
    }
  }
  for (const field of ['source_board', 'kanban_board', 'epic_board']) {
    if (Object.prototype.hasOwnProperty.call(raw, field) && !relativeMarkdownPath(raw[field])) {
      errors.push(error('invalid-note-path', field, `${field} must be a workspace-relative Markdown path`));
    }
  }
  if (raw.source_board && raw.kanban_board && raw.source_board !== raw.kanban_board) {
    errors.push(error('epic-parent-board-mismatch', 'kanban_board', 'source_board and kanban_board must name the same parent board'));
  }
  return { ok: errors.length === 0, errors, warnings: [], record: raw, contract_version: CONTRACT_VERSION };
}

function validateSlice(value, options = {}) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
  const execution = validateCard(raw, options.mode || 'current');
  const errors = [...execution.errors, ...validateFields(raw, 'slice')];
  const warnings = [...execution.warnings];
  if (raw.type !== 'slice') errors.push(error('record-kind-mismatch', 'type', 'slice records require type slice'));
  errors.push(...recordKindVersionErrors(raw, 'slice'));
  for (const field of ['task_parent', 'source_board', 'kanban_board']) {
    if (Object.prototype.hasOwnProperty.call(raw, field) && !relativeMarkdownPath(raw[field])) {
      errors.push(error('invalid-note-path', field, `${field} must be a workspace-relative Markdown path`));
    }
  }
  if (raw.source_board && raw.kanban_board && raw.source_board !== raw.kanban_board) {
    errors.push(error('slice-board-mismatch', 'kanban_board', 'source_board and kanban_board must name the same epic board'));
  }
  if (raw.source_board) {
    const boardParts = String(raw.source_board).replace(/\\/g, '/').split('/');
    if (boardParts.length < 2 || boardParts[boardParts.length - 2] !== 'board') {
      errors.push(error('slice-location-invalid', 'source_board', 'slice source board must live directly in the epic board directory'));
    }
  }
  const epicIdentity = normalizeIdentity(raw.epic);
  const parentIdentity = pathIdentity(raw.task_parent);
  if (epicIdentity && parentIdentity && epicIdentity !== parentIdentity) {
    errors.push(error('slice-epic-backlink-mismatch', 'task_parent', 'epic and task_parent must resolve to the same atlas identity'));
  }
  if (Array.isArray(options.sibling_slices)) {
    const siblings = new Set(options.sibling_slices.map(normalizeIdentity).filter(Boolean));
    for (const dependency of execution.card.depends_on) {
      if (!siblings.has(dependency)) {
        warnings.push(error('cross-epic-dependency', 'depends_on', `dependency ${dependency} is outside the epic and degrades independent posture`));
      }
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    record: {
      ...execution.card,
      type: raw.type,
      epic: raw.epic,
      task_parent: raw.task_parent,
      source_board: raw.source_board,
      kanban_board: raw.kanban_board,
    },
    contract_version: CONTRACT_VERSION,
    requires_migration: execution.requires_migration,
  };
}

function pathIdentity(value) {
  const normalized = normalizeIdentity(value).replace(/\\/g, '/').replace(/\.md$/i, '');
  return normalized.split('/').filter(Boolean).pop() || '';
}

function sliceStatus(slice) {
  const raw = slice && (slice.status || slice.phase);
  if (raw === 'deployed') return 'completed';
  if (raw === 'implementing' || raw === 'claimed') return 'in_progress';
  return normalizeStatus(raw) || 'planning';
}

function deriveEpicLifecycle(slices, options = {}) {
  const list = Array.isArray(slices) ? slices : [];
  // BGR redesign 2026-07-25: discarded slices are tombstones — excluded from the rollup entirely.
  const normalized = list.map((slice, index) => ({ ...slice, _index: index, _status: sliceStatus(slice) }))
    .filter((slice) => slice._status !== 'discarded');
  const counts = { planned: 0, active: 0, waiting: 0, blocked: 0, done: 0, total: normalized.length };
  for (const slice of normalized) {
    if (slice._status === 'completed') counts.done += 1;
    else if (slice._status === 'in_progress') counts.active += 1;
    // BGR redesign 2026-07-25: a parked slice is a wait (concurrency/deploy), not progress — it never counts as active.
    else if (slice._status === 'parked') counts.waiting += 1;
    else if (slice._status === 'blocked') counts.blocked += 1;
    else counts.planned += 1;
  }
  const claimableNames = new Set((options.claimable_slices || []).map(normalizeIdentity));
  const explicitlyClaimable = normalized.some((slice) => claimableNames.has(normalizeIdentity(slice.card || slice.name || slice.title))
    || slice.claimable === true
    || (slice._status === 'planning' && slice.eligible !== false && slice.dependency_eligible !== false));
  let state = 'planned';
  if (normalized.length > 0 && counts.done === normalized.length) state = 'done';
  else if (counts.active > 0) state = 'active';
  // BGR redesign 2026-07-25: waiting rolls up like blocked — a parked slice is a
  // wait (concurrency/deploy), not progress, and a claimable sibling must not hide it.
  else if (counts.waiting > 0) state = 'blocked';
  else if (counts.blocked > 0 && !explicitlyClaimable) state = 'blocked';
  const pending = normalized.filter((slice) => slice._status !== 'completed');
  const crossEpic = pending.some((slice) => slice.cross_epic_dependency === true)
    || pending.some((slice) => Array.isArray(slice.validation_warnings)
      && slice.validation_warnings.some((warning) => warning && warning.code === 'cross-epic-dependency'));
  let postureValue = 'claimable';
  if (state === 'done') postureValue = 'done';
  else if (pending.some((slice) => slice.decision_required === true)) postureValue = 'awaiting_user_decision';
  else if (crossEpic || state === 'blocked') postureValue = 'blocked_by_dependencies';
  else if (pending.length > 0 && pending.every((slice) => slice.execution_mode === 'docs_only')) postureValue = 'docs_only';
  const frontier = pending.find((slice) => slice._status !== 'blocked') || pending[0] || null;
  return {
    state,
    posture: postureValue,
    counts,
    frontier: frontier ? normalizeIdentity(frontier.card || frontier.name || frontier.title || frontier.slice) : null,
  };
}

function deriveEpicState(slices, options = {}) {
  return deriveEpicLifecycle(slices, options).state;
}

function deriveEpicPosture(slices, options = {}) {
  return deriveEpicLifecycle(slices, options).posture;
}

function markdownSection(markdown, heading) {
  const wanted = String(heading || '').trim();
  if (!wanted) return { ok: false, error: error('ratification-heading-required', 'section_heading', 'an exact section heading is required') };
  const lines = String(markdown || '').split(/(?<=\n)/);
  const matches = [];
  let offset = 0;
  let fence = null;
  for (const chunk of lines) {
    const line = chunk.replace(/\r?\n$/, '');
    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
      offset += chunk.length;
      continue;
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (opening) {
      fence = { character: opening[1][0], length: opening[1].length };
      offset += chunk.length;
      continue;
    }
    const match = line.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (match && match[2].trim() === wanted) matches.push({ start: offset, level: match[1].length });
    offset += chunk.length;
  }
  if (matches.length !== 1) {
    return { ok: false, error: error('ratification-heading-ambiguous', 'section_heading', 'artifact must contain exactly one exact selected heading') };
  }
  const selected = matches[0];
  let end = String(markdown || '').length;
  offset = 0;
  fence = null;
  for (const chunk of lines) {
    const line = chunk.replace(/\r?\n$/, '');
    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
    } else {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (opening) fence = { character: opening[1][0], length: opening[1].length };
      else if (offset > selected.start) {
      const match = line.match(/^(#{1,6})[ \t]+/);
      if (match && match[1].length <= selected.level) { end = offset; break; }
      }
    }
    offset += chunk.length;
  }
  return { ok: true, section: String(markdown || '').slice(selected.start, end) };
}

function validateRatificationReceipt(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
  const errors = validateFields(raw, 'ratification-receipt');
  errors.push(...recordVersionErrors(raw));
  errors.push(...recordKindVersionErrors(raw, 'ratification-receipt'));
  if (raw.decision && !registry.enums.ratification_decision.includes(raw.decision)) {
    errors.push(error('invalid-ratification-decision', 'decision', 'decision must be accepted or provisionally_accepted'));
  }
  if (raw.accepted_at && !evidenceTimestampValid(raw.accepted_at)) {
    errors.push(error('invalid-ratification-timestamp', 'accepted_at', 'accepted_at must be ISO-8601 with timezone'));
  }
  if (raw.target_card && (raw.target_card !== raw.target_card.trim() || normalizeIdentity(raw.target_card) !== raw.target_card)) {
    errors.push(error('noncanonical-target-card', 'target_card', 'target_card must be the exact plain canonical card identity'));
  }
  if (raw.target_head && !/^[0-9a-f]{40}$/.test(raw.target_head)) {
    errors.push(error('invalid-target-head', 'target_head', 'target_head must be exactly one lowercase 40-hex SHA token'));
  }
  for (const field of ['artifact_sha256', 'section_sha256']) {
    if (raw[field] && !/^[0-9a-f]{64}$/.test(raw[field])) errors.push(error('invalid-sha256', field, `${field} must be 64 lowercase hex characters`));
  }
  if (raw.artifact_path && !relativeMarkdownPath(raw.artifact_path)) {
    errors.push(error('invalid-note-path', 'artifact_path', 'artifact_path must be a workspace-relative Markdown path'));
  }
  if (Array.isArray(raw.scope) && (raw.scope.length === 0 || raw.scope.some((item) => item !== item.trim()))) {
    errors.push(error('invalid-ratification-scope', 'scope', 'scope must contain one or more canonical non-empty strings'));
  }
  return { ok: errors.length === 0, errors, warnings: [], receipt: raw, contract_version: CONTRACT_VERSION };
}

function parseRatificationArtifact(markdown, sectionHeading, provenance = {}) {
  const selected = markdownSection(markdown, sectionHeading);
  if (!selected.ok) return { ok: false, errors: [selected.error], warnings: [], receipt: null, contract_version: CONTRACT_VERSION };
  const blocks = [...selected.section.matchAll(/^```delivery-ratification[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm)];
  if (blocks.length !== 1) {
    return { ok: false, errors: [error('ratification-block-ambiguous', 'artifact', 'selected section must contain exactly one delivery-ratification JSON block')], warnings: [], receipt: null, contract_version: CONTRACT_VERSION };
  }
  let payload;
  try { payload = JSON.parse(blocks[0][1]); }
  catch (_) {
    return { ok: false, errors: [error('ratification-json-invalid', 'artifact', 'delivery-ratification block must contain valid JSON')], warnings: [], receipt: null, contract_version: CONTRACT_VERSION };
  }
  const allowed = new Set(['schema_version', 'receipt_id', 'decision', 'accepted_at', 'authority', 'target_card', 'target_head', 'scope']);
  const unexpected = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? Object.keys(payload).filter((key) => !allowed.has(key)) : ['payload'];
  if (unexpected.length) {
    return { ok: false, errors: [error('ratification-field-unexpected', unexpected[0], 'ratification payload contains an unsupported field')], warnings: [], receipt: null, contract_version: CONTRACT_VERSION };
  }
  const artifactPath = String(provenance.artifact_path || '').trim();
  const receipt = {
    ...payload,
    artifact_path: artifactPath,
    artifact_sha256: sha256(Buffer.from(String(markdown || ''), 'utf8')),
    section_heading: String(sectionHeading || '').trim(),
    section_sha256: sha256(Buffer.from(selected.section, 'utf8')),
  };
  return validateRatificationReceipt(receipt);
}

function completionProof(record) {
  const item = record && typeof record === 'object' ? record : {};
  const missing = [];
  const addMissing = (field) => { if (!missing.includes(field)) missing.push(field); };
  if (item.execution_mode === 'docs_only') {
    if (!['completed', 'deployed'].includes(item.phase)) missing.push('phase');
    const receipt = item.validation_receipt;
    if (!pinnedReceiptValid(receipt)
      || !/^[0-9a-f]{40}$/i.test(String(item.head_sha || ''))
      || !/^[0-9a-f]{40}$/i.test(String(item.base_sha || ''))
      || receipt.head_sha !== item.head_sha || receipt.base_sha !== item.base_sha) missing.push('validation_receipt');
    return { complete: missing.length === 0, missing, mode: 'docs_only' };
  }
  if (item.phase !== 'deployed') addMissing('phase');
  if (!Number.isInteger(item.feature_pr) || item.feature_pr <= 0) addMissing('feature_pr');
  if (!/^[0-9a-f]{40}$/i.test(String(item.feature_merge_sha || ''))) addMissing('feature_merge_sha');
  if (!Number.isInteger(item.release_pr) || item.release_pr <= 0) addMissing('release_pr');
  if (!/^[0-9a-f]{40}$/i.test(String(item.release_merge_sha || ''))) addMissing('release_merge_sha');
  if (compareVersions(item.required_version, item.required_version) !== 0) addMissing('required_version');
  if (!/^v\d+\.\d+\.\d+$/.test(String(item.tag || ''))) addMissing('tag');
  if (!Number.isInteger(item.tap_pr) || item.tap_pr <= 0) addMissing('tap_pr');
  if (compareVersions(item.brew_version, item.brew_version) !== 0) addMissing('brew_version');
  const brewReceipt = item.brew_receipt;
  if (!pinnedReceiptValid(brewReceipt)
    || brewReceipt.tap_pr !== item.tap_pr
    || brewReceipt.installed_version !== item.brew_version) addMissing('brew_receipt');
  const ancestry = item.release_ancestry_receipt;
  if (!ancestry || ancestry.ok !== true
    || typeof ancestry.receipt_id !== 'string' || !ancestry.receipt_id.trim()
    || typeof ancestry.repository !== 'string' || !ancestry.repository.trim()
    || !evidenceTimestampValid(ancestry.checked_at)
    || !/^[0-9a-f]{40}$/i.test(String(ancestry.verifier_revision || ''))
    || ancestry.feature_pr !== item.feature_pr
    || ancestry.feature_merge_sha !== item.feature_merge_sha
    || ancestry.release_pr !== item.release_pr
    || ancestry.release_merge_sha !== item.release_merge_sha
    || ancestry.tag !== item.tag) {
    addMissing('release_ancestry_receipt');
  }
  const brewComparison = item.required_version && item.brew_version
    ? compareVersions(item.brew_version, item.required_version) : null;
  if (item.required_version && item.brew_version && (brewComparison == null || brewComparison < 0)) addMissing('brew_version');
  const tagVersion = String(item.tag || '').replace(/^v/, '');
  const tagComparison = item.required_version && tagVersion ? compareVersions(tagVersion, item.required_version) : null;
  if (item.required_version && item.tag && tagComparison !== 0) addMissing('tag');
  const deploymentMap = item.deploy_subscriptions;
  if (!deploymentMap || typeof deploymentMap !== 'object' || Array.isArray(deploymentMap)
    || Object.keys(deploymentMap).length !== REQUIRED_VAULTS.length
    || REQUIRED_VAULTS.some((vault) => !Array.isArray(deploymentMap[vault])
      || deploymentMap[vault].some((item) => typeof item !== 'string'
        || !/^(?:mechanism|blueprint):[a-z0-9][a-z0-9._-]*$/.test(item.trim()))
      || new Set(deploymentMap[vault].map((item) => item.trim())).size !== deploymentMap[vault].length)) addMissing('deploy_subscriptions');
  for (const vault of REQUIRED_VAULTS) {
    const receipt = item.vault_receipts && item.vault_receipts[vault];
    const requiredSubscriptions = deploymentMap && Array.isArray(deploymentMap[vault]) ? deploymentMap[vault] : [];
    const installedComparison = receipt && receipt.installed_version && item.required_version
      ? compareVersions(receipt.installed_version, item.required_version) : null;
    if (!receipt || receipt.ok !== true || receipt.vault !== vault
      || typeof receipt.path !== 'string' || !receipt.path.trim()
      || receipt.required_version !== item.required_version
      || !Array.isArray(receipt.added_subscriptions)
      || receipt.added_subscriptions.some((subscription) => typeof subscription !== 'string' || !subscription.trim())
      || !Array.isArray(receipt.verified_subscriptions)
      || receipt.verified_subscriptions.some((subscription) => typeof subscription !== 'string' || !subscription.trim())
      || requiredSubscriptions.some((subscription) => !receipt.verified_subscriptions.includes(subscription))
      || !evidenceTimestampValid(receipt.started_at) || !evidenceTimestampValid(receipt.finished_at)
      || Date.parse(receipt.finished_at) < Date.parse(receipt.started_at)
      || receipt.status_exit !== 0 || !Array.isArray(receipt.history_errors) || receipt.history_errors.length > 0
      || !receipt.installed_version
      || (item.required_version && (installedComparison == null || installedComparison < 0))) {
      addMissing(`vault_receipts.${vault}`);
    }
  }
  return { complete: missing.length === 0, missing, mode: 'release' };
}

function cycleNodes(cardsByName) {
  const cyclic = new Set();
  const reaches = (current, target, seen) => {
    if (seen.has(current)) return false;
    seen.add(current);
    const card = cardsByName.get(current);
    if (!card) return false;
    for (const dep of parseDependencyField(card.depends_on)) {
      if (dep === target) return true;
      if (cardsByName.has(dep) && reaches(dep, target, seen)) return true;
    }
    return false;
  };
  for (const name of cardsByName.keys()) if (reaches(name, name, new Set())) cyclic.add(name);
  return cyclic;
}

function resolveDependencies(cards, ledger = {}, options = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const byName = new Map();
  for (const card of list) {
    const name = normalizeIdentity(card && (card.card || card.name || card.title));
    if (name && !byName.has(name)) byName.set(name, card);
  }
  const cycles = cycleNodes(byName);
  const values = (input) => Array.from(input || []).map(normalizeIdentity);
  const completed = new Set(values(options.completed));
  const archive = new Set(values(options.archive));
  const known = new Set([...values(options.known_cards), ...byName.keys()]);
  const duplicates = new Set(values(options.duplicate_cards));
  const records = ledger && ledger.cards && typeof ledger.cards === 'object' ? ledger.cards : ledger;
  const recordsByName = new Map(Object.entries(records || {}).map(([name, record]) => [normalizeIdentity(name), record]));
  const result = {};
  for (const [name, card] of byName.entries()) {
    const dependencies = parseDependencyField(card.depends_on);
    let refusal = null;
    if (dependencies.includes(name)) refusal = { reason: 'self-dependency', dependency: name };
    else if (cycles.has(name)) refusal = { reason: 'dependency-cycle', dependency: name };
    for (const dep of dependencies) {
      if (refusal) break;
      if (duplicates.has(dep)) refusal = { reason: 'ambiguous-dependency', dependency: dep };
      else if (recordsByName.has(dep)) {
        const proof = completionProof(recordsByName.get(dep));
        if (!proof.complete) refusal = { reason: 'dependency-proof-missing', dependency: dep, missing_proof: proof.missing };
      } else if (archive.has(dep)) refusal = { reason: 'archive-never-satisfies', dependency: dep };
      else if (byName.has(dep) || known.has(dep)) refusal = { reason: 'dependency-not-complete', dependency: dep };
      else if (completed.has(dep)) {
        // Checked Completed is the fallback for untracked historical work only.
      }
      else refusal = { reason: 'dangling-dependency', dependency: dep };
    }
    result[name] = refusal ? { eligible: false, ...refusal } : { eligible: true, reason: null, missing_proof: [] };
  }
  return result;
}

function zoneConflicts(left, right, options = {}) {
  const zones = (claim) => Array.isArray(claim) ? claim : ((claim && claim.touch_zones) || []);
  const normalize = (zone) => normalizeZoneEntry(zone, options.default_root || 'workshop');
  for (const aRaw of zones(left)) {
    const a = normalize(aRaw); if (!a) continue;
    for (const bRaw of zones(right)) {
      const b = normalize(bRaw); if (!b || a.root !== b.root) continue;
      if (a.path === b.path || a.path.startsWith(`${b.path}/`) || b.path.startsWith(`${a.path}/`)) return true;
    }
  }
  return false;
}

function classifyFailure(log) {
  const text = String(log == null ? '' : log);
  const infra = /(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|rate.?limit|HTTP\s*5\d\d|network|timed?\s*out|connection\s+(?:reset|refused)|brew.*lock)/i.test(text);
  const code = /(AssertionError|SyntaxError|TypeError|ReferenceError|test(?:s)?\s+failed|preflight.*(?:fail|exit)|expected\s+.+(?:got|received)|\bassert\b)/i.test(text);
  if (infra && code) return 'mixed';
  if (infra) return 'infra';
  if (code) return 'code';
  return 'unknown';
}

function posture(plan) {
  const input = plan && typeof plan === 'object' ? plan : {};
  if (input.decision_required) return 'awaiting_user_decision';
  if (input.dependency_result && input.dependency_result.eligible === false) return 'blocked_by_dependencies';
  const card = input.card || input;
  if (parseDependencyField(card.depends_on).length > 0 && !input.dependency_result) return 'blocked_by_dependencies';
  if (card.execution_mode === 'docs_only') return 'docs_only';
  return 'claimable';
}

function batchEligibility(card, context = {}) {
  const validation = validateCard(card, context.mode || 'current');
  const policy = derivePolicy(validation.card);
  if (!validation.ok) return { eligible: false, policy, reason: 'contract-invalid', errors: validation.errors };
  if (validation.requires_migration) {
    return { eligible: false, policy, reason: 'contract-migration-required', errors: [] };
  }
  if (validation.card.depends_on.length > 0 && (!context.dependency_result || context.dependency_result.eligible !== true)) {
    return { eligible: false, policy, reason: 'dependencies-not-complete', missing_proof: (context.dependency_result && context.dependency_result.missing_proof) || [] };
  }
  if (context.dependency_result && context.dependency_result.eligible === false) {
    return { eligible: false, policy, reason: 'dependencies-not-complete', missing_proof: context.dependency_result.missing_proof || [] };
  }
  if (validation.card.execution_mode === 'docs_only' && !context.supervised) {
    return { eligible: false, policy, reason: 'docs-only-requires-supervision' };
  }
  if (policy === 'supervised_only' && !context.supervised) {
    return { eligible: false, policy, reason: 'supervised-only' };
  }
  return { eligible: true, policy, reason: null, continue_after: policy === 'continue' };
}

function migrate(note, fromVersion) {
  const original = clone(note && typeof note === 'object' ? note : {});
  const sourceVersion = fromVersion || original.schema_version || '0.0.0';
  const comparison = compareVersions(sourceVersion, CONTRACT_VERSION);
  const evidenceManual = (value) => {
    if (!Array.isArray(value) || value.length === 0) return ['evidence:requires-authoring'];
    return value.flatMap((item, index) => (typeof item === 'string' ? [`evidence.${index}:requires-pinning`] : []));
  };
  if (comparison == null) return { ok: false, reason: 'invalid-schema-version', note: original, applied: [], manual: [] };
  if (comparison === 1) return { ok: false, reason: 'newer-than-engine', note: original, applied: [], manual: [] };
  if (comparison === 0) return { ok: true, reason: null, note: original, applied: [], manual: evidenceManual(original.evidence) };
  const migrated = clone(original);
  const applied = [];
  const manual = evidenceManual(migrated.evidence);
  const setDefault = (key, value) => {
    if (!Object.prototype.hasOwnProperty.call(migrated, key)) {
      migrated[key] = clone(value); applied.push(`1.0.0:${key}:default_backfill`);
    }
  };
  setDefault('execution_mode', 'release');
  setDefault('depends_on', []);
  setDefault('deploy_subscriptions', { headspace: [], accuris: [], ero: [] });
  setDefault('release_required', migrated.execution_mode === 'release');
  setDefault('deployment_required', migrated.execution_mode === 'release');
  if (!Object.prototype.hasOwnProperty.call(migrated, 'batch_policy')) {
    migrated.batch_policy = derivePolicy(migrated); applied.push('1.0.0:batch_policy:derive_from');
  }
  migrated.depends_on = parseDependencyField(migrated.depends_on);
  if (migrated.status && normalizeStatus(migrated.status)) migrated.status = normalizeStatus(migrated.status);
  migrated.schema_version = CONTRACT_VERSION;
  applied.push('1.0.0:schema_version:default_backfill');
  return { ok: true, reason: null, note: migrated, applied, manual };
}

function describe(type, consumer) {
  const definition = registry.types[type];
  if (!definition) return null;
  const fields = definition.fields.map((field) => {
    const copy = clone(field);
    if (consumer && copy.consumer_descriptions && copy.consumer_descriptions[consumer]) {
      copy.description = copy.consumer_descriptions[consumer];
    }
    delete copy.consumer_descriptions;
    return copy;
  });
  return {
    contract_version: CONTRACT_VERSION,
    minimum_compatible_version: registry.contract.minimum_compatible_version,
    type,
    consumer: consumer || null,
    description: definition.description,
    fields,
    enums: clone(registry.enums),
  };
}

module.exports = {
  CONTRACT_VERSION,
  MINIMUM_COMPATIBLE_VERSION,
  registry,
  compareVersions,
  normalizeIdentity,
  normalizeStatus,
  parseDependencyField,
  normalizeEvidenceClaim,
  decodeStructuredContractFields,
  encodeStructuredFrontmatterValue,
  normalizeCard,
  validateCard,
  validateEpic,
  validateSlice,
  deriveEpicLifecycle,
  deriveEpicState,
  deriveEpicPosture,
  validateRatificationReceipt,
  parseRatificationArtifact,
  resolveDependencies,
  completionProof,
  zoneConflicts,
  derivePolicy,
  classifyFailure,
  posture,
  batchEligibility,
  migrate,
  describe,
};
