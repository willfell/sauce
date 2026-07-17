'use strict';

const sourceRegistry = require('../data/delivery-schema.json');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const registry = deepFreeze(sourceRegistry);
const CONTRACT_VERSION = registry.contract.version;
const REQUIRED_VAULTS = registry.policies.required_vaults;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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
    raw = raw.slice(1, -1).trim();
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
  if (raw.startsWith('[') && raw.endsWith(']') && !raw.startsWith('[[')) {
    const body = raw.slice(1, -1);
    return [...new Set(body.split(',').map(normalizeIdentity).filter(Boolean))];
  }
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
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
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
  const out = clone(card && typeof card === 'object' ? card : {});
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
  const raw = card && typeof card === 'object' && !Array.isArray(card) ? card : {};
  const normalized = normalizeCard(raw);
  const errors = [];
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
  if (version != null && versionCmp == null) errors.push(error('invalid-schema-version', 'schema_version', 'schema_version must be semver'));
  else if (versionCmp === 1) errors.push(error('schema-newer-than-engine', 'schema_version', 'card contract is newer than this engine'));

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
    requires_migration: version == null || versionCmp === -1,
    historical_unversioned: version == null,
  };
}

function completionProof(record) {
  const item = record && typeof record === 'object' ? record : {};
  const missing = [];
  const addMissing = (field) => { if (!missing.includes(field)) missing.push(field); };
  if (item.execution_mode === 'docs_only') {
    if (!['completed', 'deployed'].includes(item.phase)) missing.push('phase');
    if (!item.validation_receipt || item.validation_receipt.ok !== true) missing.push('validation_receipt');
    return { complete: missing.length === 0, missing, mode: 'docs_only' };
  }
  if (item.phase !== 'deployed') addMissing('phase');
  if (!/^[0-9a-f]{40}$/i.test(String(item.feature_merge_sha || ''))) addMissing('feature_merge_sha');
  if (!Number.isInteger(item.release_pr) || item.release_pr <= 0) addMissing('release_pr');
  if (!/^[0-9a-f]{40}$/i.test(String(item.release_merge_sha || ''))) addMissing('release_merge_sha');
  if (compareVersions(item.required_version, item.required_version) !== 0) addMissing('required_version');
  if (!/^v\d+\.\d+\.\d+$/.test(String(item.tag || ''))) addMissing('tag');
  if (!Number.isInteger(item.tap_pr) || item.tap_pr <= 0) addMissing('tap_pr');
  if (compareVersions(item.brew_version, item.brew_version) !== 0) addMissing('brew_version');
  const brewComparison = item.required_version && item.brew_version
    ? compareVersions(item.brew_version, item.required_version) : null;
  if (item.required_version && item.brew_version && (brewComparison == null || brewComparison < 0)) addMissing('brew_version');
  const tagVersion = String(item.tag || '').replace(/^v/, '');
  const tagComparison = item.required_version && tagVersion ? compareVersions(tagVersion, item.required_version) : null;
  if (item.required_version && item.tag && (tagComparison == null || tagComparison < 0)) addMissing('tag');
  for (const vault of REQUIRED_VAULTS) {
    const receipt = item.vault_receipts && item.vault_receipts[vault];
    const installedComparison = receipt && receipt.installed_version && item.required_version
      ? compareVersions(receipt.installed_version, item.required_version) : null;
    if (!receipt || receipt.ok !== true || !receipt.installed_version
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
  registry,
  compareVersions,
  normalizeIdentity,
  normalizeStatus,
  parseDependencyField,
  normalizeEvidenceClaim,
  normalizeCard,
  validateCard,
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
