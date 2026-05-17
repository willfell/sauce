// platform/audit/rule-runner.js — applies rule_fragments to one file.
// Public API:
//   exports.applyRules(rules: Fragment[], fileRecord: {file, relPath, frontmatter, body, blueprint})
//     → Violation[] : [{file, blueprint, rule, severity, message}]
//
// Fragment shape (post-v0.29.0 schema):
//   {
//     scope?: {
//       path_glob?: string                  (glob pattern; ** matches any depth, * matches one segment)
//       exclude_basenames?: string[]        (basenames to exclude from this rule's scope)
//     },
//     required_frontmatter?: {
//       <key>: { required?: bool, type?: "string"|"list"|"datetime", equals?, matches?, contains?: string[] }
//     },
//     required_tags?: [{ tag: string, position?: int, pattern?: string }],
//     required_blocks?: [...],            (delegated to legacy validator shape; treat as no-op for v0.29.0)
//     forbid_dataviewjs_patterns?: [...], (legacy validator shape; treat as no-op for v0.29.0)
//     naming_pattern?: string,            (regex applied to basename including .md)
//     frontmatter_branch?: [{ when, ...nested-fragment-fields }]
//       where when ∈ { frontmatter: {<key>: <expected>}, tags_contains: <tag> }
//   }
//
// Behavior:
//   For each fragment in rules[]:
//     1. If scope.path_glob set and fileRecord.relPath does not match → skip fragment.
//     2. If scope.exclude_basenames set and basename matches → skip fragment.
//     3. If frontmatter_branch set: pick FIRST branch whose `when` predicate evaluates true.
//        Apply that branch's required_frontmatter / required_tags / naming_pattern (recursively).
//        Skip the top-level required_* fields of the parent fragment (branches override).
//     4. Otherwise, apply top-level required_* fields directly.
//
// Predicate evaluation:
//   when.frontmatter: { <key>: <expected> }  →  fileRecord.frontmatter[key] === expected
//   when.tags_contains: <tag>                →  fileRecord.frontmatter.tags?.includes(tag)
//
// required_frontmatter[key] checks (in order):
//   - if required && (value === undefined || value === null || value === "") → violation rule="required_frontmatter.<key>"
//   - if type set, actual ≠ type → violation rule="required_frontmatter.<key>.type"
//   - if equals set, value !== equals → violation rule="required_frontmatter.<key>.equals"
//   - if matches set, !new RegExp(matches).test(value) → violation rule="required_frontmatter.<key>.matches"
//   - if contains set, !contains.every(x => value.includes(x)) → violation rule="required_frontmatter.<key>.contains"
//   - if min_length set, value.length < N → violation rule="required_frontmatter.<key>.min_length"  (v0.31.0)
//   - if items_schema set, applies discriminated-union per-item validator (v0.31.0); rule paths
//     are indexed as "required_frontmatter.<key>[<idx>].<inner_rule>".
//
// required_tags[i] checks:
//   - if !tags.includes(spec.tag) → violation rule="required_tags.missing", message includes tag name
//
// naming_pattern:
//   - if !new RegExp(naming_pattern).test(basename) → violation rule="naming_pattern"
//
// Path glob semantics:
//   - "*" matches one path segment (no slashes)
//   - "**" matches any number of segments (zero or more, including across slashes)
//   - All other chars literal except glob escapes
//   - Implement via translation to regex; cache compiled patterns per fragment.
//
// Conservative error handling:
//   - If a fragment's scope.path_glob or naming_pattern fails to compile to a valid regex,
//     log a warning to stderr and SKIP the fragment (no violations emitted for it).
//   - Per-key required_frontmatter.matches compilation errors are caught the same way.

const fs = require("fs");
const path = require("path");

// Cache: per-fragment compiled glob regex (keyed by the Fragment object identity via WeakMap).
const _globCache = new WeakMap();
// Cache: per-type-manifest JSON parse results, keyed by absolute path.
const _typeManifestCache = new Map();

// Resolve the workshop root for CLI audit `by_type_source` lookups.
// Strategy: SAUCE_WORKSHOP_ROOT env var wins; otherwise climb from this file
// (platform/audit/rule-runner.js → platform/ → workshop root).
function _resolveWorkshopRoot() {
  if (process.env.SAUCE_WORKSHOP_ROOT) return process.env.SAUCE_WORKSHOP_ROOT;
  return path.resolve(__dirname, "../..");
}

exports.applyRules = function (rules, fileRecord, opts) {
  const violations = [];
  if (!Array.isArray(rules)) return violations;
  const workshopRoot = (opts && opts.workshopRoot) || _resolveWorkshopRoot();
  const vaultPath = opts && opts.vaultPath;
  for (let fragment of rules) {
    if (!fragment || typeof fragment !== "object") continue;
    // v0.53.0 (FA-1): resolve `extends:` per-fragment. The loader merges a
    // shared rule template (e.g. ranch/rules/_canonical-vocab.json) into the
    // fragment's required_frontmatter. Per-fragment overrides win on conflict.
    fragment = _resolveExtends(fragment, vaultPath, workshopRoot);
    const scopeOk = _matchesScope(fragment, fileRecord);
    if (scopeOk === "error") continue; // malformed glob → skip fragment entirely
    if (!scopeOk) continue;
    if (fragment.frontmatter_branch) {
      const branch = _pickFirstMatchingBranch(fragment.frontmatter_branch, fileRecord);
      if (branch) _applyRequirements(branch, fileRecord, violations, workshopRoot);
    } else {
      _applyRequirements(fragment, fileRecord, violations, workshopRoot);
    }
  }
  return violations;
};

// v0.53.0 (FA-1): cache parsed extends-base templates. Keyed by absolute path
// of the resolved template file; entries are the parsed JSON object.
const _extendsCache = new Map();

// v0.53.0 (FA-1): resolve `extends:` field on a rule fragment.
// Looks up <vaultPath>/ranch/rules/<name>.json first (consumer-vault), then
// falls back to <workshopRoot>/platform/rules/<name>.json (workshop). If found,
// merges the base's required_frontmatter into the fragment with fragment-wins
// precedence. Returns the fragment unchanged if extends is absent or base
// cannot be resolved (failure-soft: do not refuse to apply the fragment).
function _resolveExtends(fragment, vaultPath, workshopRoot) {
  if (!fragment || typeof fragment.extends !== "string" || fragment.extends.length === 0) {
    return fragment;
  }
  const baseName = fragment.extends;
  const candidates = [];
  if (vaultPath) candidates.push(path.join(vaultPath, "ranch", "rules", `${baseName}.json`));
  if (workshopRoot) candidates.push(path.join(workshopRoot, "platform", "rules", `${baseName}.json`));
  let base = null;
  for (const p of candidates) {
    if (_extendsCache.has(p)) { base = _extendsCache.get(p); break; }
    if (!fs.existsSync(p)) continue;
    try {
      base = JSON.parse(fs.readFileSync(p, "utf8"));
      _extendsCache.set(p, base);
      break;
    } catch (_e) {
      // malformed JSON — leave base null and continue to next candidate.
      base = null;
    }
  }
  if (!base || typeof base !== "object") return fragment;
  const merged = Object.assign({}, fragment);
  if (base.required_frontmatter || fragment.required_frontmatter) {
    merged.required_frontmatter = Object.assign(
      {},
      base.required_frontmatter || {},
      fragment.required_frontmatter || {}
    );
  }
  return merged;
}

// v0.53.0 (FA-1): exposed for harness use; clears the cached extends-base
// JSON objects so subsequent tests can verify load behavior in isolation.
exports._clearExtendsCache = function () { _extendsCache.clear(); };
exports._resolveExtends = _resolveExtends;

function _matchesScope(fragment, fileRecord) {
  const scope = fragment.scope;
  if (!scope) return true;
  if (scope.path_glob) {
    let re = _globCache.get(fragment);
    if (re === undefined) {
      try {
        re = _compileGlob(scope.path_glob);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[audit] rule-runner: malformed path_glob '${scope.path_glob}': ${err.message}; skipping fragment`);
        re = null;
      }
      _globCache.set(fragment, re);
    }
    if (re === null) return "error";
    if (!re.test(fileRecord.relPath)) return false;
  }
  if (scope.exclude_basenames && Array.isArray(scope.exclude_basenames)) {
    if (scope.exclude_basenames.includes(path.basename(fileRecord.relPath))) return false;
  }
  return true;
}

function _compileGlob(pattern) {
  // Convert ** → .*, * → [^/]*, escape literals.
  return new RegExp("^" + pattern
    .replace(/\\/g, "\\\\")
    .replace(/[.+^${}()|[\]]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLESTAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLESTAR__/g, ".*") + "$");
}

// Backwards-compatible private helper (matches plan's _globMatch signature) for any
// future direct callers; the main path uses cached compilation via _matchesScope.
function _globMatch(pattern, relPath) {
  try {
    return _compileGlob(pattern).test(relPath);
  } catch (_e) {
    return false;
  }
}

function _pickFirstMatchingBranch(branches, fileRecord) {
  if (!Array.isArray(branches)) return null;
  for (const b of branches) {
    if (!b || typeof b !== "object") continue;
    if (b.when?.frontmatter) {
      const matches = Object.entries(b.when.frontmatter).every(([k, v]) => fileRecord.frontmatter?.[k] === v);
      if (matches) return b;
    } else if (b.when?.tags_contains) {
      const tags = Array.isArray(fileRecord.frontmatter?.tags) ? fileRecord.frontmatter.tags : [];
      if (tags.includes(b.when.tags_contains)) return b;
    }
  }
  return null;
}

function _applyRequirements(spec, fileRecord, violations, workshopRoot) {
  // required_frontmatter / required_tags / naming_pattern
  if (spec.required_frontmatter && typeof spec.required_frontmatter === "object") {
    for (const [key, k] of Object.entries(spec.required_frontmatter)) {
      _checkFmKey(key, k, fileRecord, violations, workshopRoot);
    }
  }
  if (spec.required_tags && Array.isArray(spec.required_tags)) {
    const tags = Array.isArray(fileRecord.frontmatter?.tags) ? fileRecord.frontmatter.tags : [];
    for (const tagSpec of spec.required_tags) {
      if (!tagSpec || typeof tagSpec !== "object") continue;
      if (!tags.includes(tagSpec.tag)) {
        violations.push({
          file: fileRecord.relPath,
          blueprint: fileRecord.blueprint,
          rule: "required_tags.missing",
          severity: "error",
          message: `Missing required tag: ${tagSpec.tag}`,
        });
      }
    }
  }
  if (spec.naming_pattern) {
    let re;
    try {
      re = new RegExp(spec.naming_pattern);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[audit] rule-runner: malformed naming_pattern '${spec.naming_pattern}': ${err.message}; skipping check`);
      return;
    }
    if (!re.test(path.basename(fileRecord.relPath))) {
      violations.push({
        file: fileRecord.relPath,
        blueprint: fileRecord.blueprint,
        rule: "naming_pattern",
        severity: "error",
        message: `Basename '${path.basename(fileRecord.relPath)}' does not match pattern: ${spec.naming_pattern}`,
      });
    }
  }
}

function _checkFmKey(key, k, fileRecord, violations, workshopRoot) {
  if (!k || typeof k !== "object") return;
  const fm = fileRecord.frontmatter || {};
  const val = fm[key];
  if (k.required && (val === undefined || val === null || val === "")) {
    violations.push({
      file: fileRecord.relPath,
      blueprint: fileRecord.blueprint,
      rule: `required_frontmatter.${key}`,
      severity: "error",
      message: `Missing required frontmatter field: ${key}`,
    });
    return;
  }
  if (val === undefined || val === null) return;
  if (k.type) {
    const actual = Array.isArray(val) ? "list" : typeof val;
    const tNorm = k.type === "datetime" ? "string" : k.type;
    if (actual !== tNorm) {
      violations.push({
        file: fileRecord.relPath,
        blueprint: fileRecord.blueprint,
        rule: `required_frontmatter.${key}.type`,
        severity: "warn",
        message: `Field ${key} should be ${k.type}, got ${actual}`,
      });
    }
  }
  if (k.equals !== undefined && val !== k.equals) {
    violations.push({
      file: fileRecord.relPath,
      blueprint: fileRecord.blueprint,
      rule: `required_frontmatter.${key}.equals`,
      severity: "error",
      message: `Field ${key} must equal ${JSON.stringify(k.equals)}, got ${JSON.stringify(val)}`,
    });
  }
  if (k.matches && typeof val === "string") {
    let re;
    try {
      re = new RegExp(k.matches);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[audit] rule-runner: malformed required_frontmatter.${key}.matches '${k.matches}': ${err.message}; skipping check`);
      re = null;
    }
    if (re && !re.test(val)) {
      violations.push({
        file: fileRecord.relPath,
        blueprint: fileRecord.blueprint,
        rule: `required_frontmatter.${key}.matches`,
        severity: "error",
        message: `Field ${key} does not match pattern ${k.matches}: got "${val}"`,
      });
    }
  }
  if (k.contains && Array.isArray(val) && !k.contains.every(x => val.includes(x))) {
    const missing = k.contains.filter(x => !val.includes(x));
    violations.push({
      file: fileRecord.relPath,
      blueprint: fileRecord.blueprint,
      rule: `required_frontmatter.${key}.contains`,
      severity: "error",
      message: `Field ${key} missing required values: ${missing.join(", ")}`,
    });
  }
  // NEW v0.31.0 — min_length predicate (list-type values)
  if (typeof k.min_length === "number" && Array.isArray(val) && val.length < k.min_length) {
    violations.push({
      file: fileRecord.relPath,
      blueprint: fileRecord.blueprint,
      rule: `required_frontmatter.${key}.min_length`,
      severity: "error",
      message: `Field ${key} must have at least ${k.min_length} entries, got ${val.length}`,
    });
  }
  // NEW v0.31.0 — items_schema predicate (discriminated-union per-item validator)
  if (k.items_schema && Array.isArray(val)) {
    _checkItemsSchema(fileRecord, key, k.items_schema, val, violations, workshopRoot);
  }
}

// v0.31.0 — discriminated-union per-item validator (CLI audit path).
// Resolves `by_type_source` against the workshop tree at
// <workshopRoot>/platform/blueprints/<fileRecord.blueprint>/<path>. The blueprint
// shipping the rule_fragment IS the blueprint being audited; for cowork's
// vault-config.md rule_fragment, this resolves engagement-types/<type>.json
// under platform/blueprints/cowork/.
function _checkItemsSchema(fileRecord, key, schemaSpec, items, violations, workshopRoot) {
  if (!schemaSpec || typeof schemaSpec !== "object") return;
  const discriminator = schemaSpec.discriminator;
  const commonRequired = schemaSpec.common_required || null;
  const bySource = schemaSpec.by_type_source || null;
  const blueprint = fileRecord.blueprint;

  const CAP = 100;
  const limit = Math.min(items.length, CAP);
  for (let idx = 0; idx < limit; idx++) {
    const item = items[idx];
    if (!item || typeof item !== "object") {
      violations.push({
        file: fileRecord.relPath,
        blueprint,
        rule: `required_frontmatter.${key}[${idx}].not_object`,
        severity: "error",
        message: `Item at index ${idx} is not an object`,
      });
      continue;
    }
    // 1. common_required checks
    if (commonRequired && typeof commonRequired === "object") {
      for (const [fieldKey, fieldSpec] of Object.entries(commonRequired)) {
        _checkInnerField(fileRecord, `${key}[${idx}].${fieldKey}`, fieldSpec, item[fieldKey], violations);
      }
    }
    // 2. by_type_source per-type required-fields lookup
    if (bySource && discriminator) {
      const typeValue = item[discriminator];
      if (typeof typeValue !== "string" || typeValue.length === 0) {
        // discriminator missing — common_required already surfaced (if required).
        continue;
      }
      const hashIdx = bySource.indexOf("#");
      const pathExpr = hashIdx === -1 ? bySource : bySource.slice(0, hashIdx);
      const concretePath = pathExpr.replace("<type>", typeValue);
      const absPath = path.join(workshopRoot, "platform/blueprints", blueprint, concretePath);
      let typeManifest = null;
      if (_typeManifestCache.has(absPath)) {
        typeManifest = _typeManifestCache.get(absPath);
      } else {
        try {
          if (fs.existsSync(absPath)) {
            typeManifest = JSON.parse(fs.readFileSync(absPath, "utf8"));
          }
        } catch (_e) {
          typeManifest = null;
        }
        _typeManifestCache.set(absPath, typeManifest);
      }
      if (!typeManifest) {
        violations.push({
          file: fileRecord.relPath,
          blueprint,
          rule: `required_frontmatter.${key}[${idx}].items_schema.by_type_source.unresolved`,
          severity: "warn",
          message: `Could not resolve engagement-type manifest for type "${typeValue}" at ${absPath}`,
        });
        continue;
      }
      const reqFields = Array.isArray(typeManifest.required_fields) ? typeManifest.required_fields : [];
      for (const f of reqFields) {
        if (!f || typeof f !== "object" || typeof f.id !== "string") continue;
        const fieldSpec = { required: true };
        if (typeof f.type === "string") fieldSpec.type = f.type;
        _checkInnerField(fileRecord, `${key}[${idx}].${f.id}`, fieldSpec, item[f.id], violations);
      }
    }
  }
}

// Inner-field assertion for items_schema (CLI audit path).
// Supports required + type predicates only — mirrors _checkFmKey's required/type
// branches but scoped to discriminated-union members. Engagement-type manifest
// fields use "string[]" for list-of-string; we normalize to "array".
function _checkInnerField(fileRecord, rulePath, fieldSpec, value, violations) {
  if (!fieldSpec || typeof fieldSpec !== "object") return;
  if (fieldSpec.required && (value === undefined || value === null || value === "")) {
    violations.push({
      file: fileRecord.relPath,
      blueprint: fileRecord.blueprint,
      rule: `required_frontmatter.${rulePath}`,
      severity: "error",
      message: `Missing required field: ${rulePath}`,
    });
    return;
  }
  if (value === undefined || value === null) return;
  if (fieldSpec.type) {
    const declared = fieldSpec.type === "string[]" ? "array"
                   : fieldSpec.type === "list"     ? "array"
                   : fieldSpec.type === "datetime" ? "string"
                   : fieldSpec.type;
    const actual = Array.isArray(value) ? "array" : typeof value;
    if (actual !== declared) {
      violations.push({
        file: fileRecord.relPath,
        blueprint: fileRecord.blueprint,
        rule: `required_frontmatter.${rulePath}.type`,
        severity: "warn",
        message: `Field ${rulePath} should be ${fieldSpec.type}, got ${actual}`,
      });
    }
  }
  if (fieldSpec.equals !== undefined && value !== fieldSpec.equals) {
    violations.push({
      file: fileRecord.relPath,
      blueprint: fileRecord.blueprint,
      rule: `required_frontmatter.${rulePath}.equals`,
      severity: "error",
      message: `Field ${rulePath} must equal ${JSON.stringify(fieldSpec.equals)}, got ${JSON.stringify(value)}`,
    });
  }
  if (fieldSpec.matches && typeof value === "string") {
    let re;
    try {
      re = new RegExp(fieldSpec.matches);
    } catch (_err) {
      re = null;
    }
    if (re && !re.test(value)) {
      violations.push({
        file: fileRecord.relPath,
        blueprint: fileRecord.blueprint,
        rule: `required_frontmatter.${rulePath}.matches`,
        severity: "error",
        message: `Field ${rulePath} does not match pattern ${fieldSpec.matches}: got ${JSON.stringify(value)}`,
      });
    }
  }
}

// Exposed for unit-testing the glob translator in isolation, if needed.
exports._globMatch = _globMatch;
exports._compileGlob = _compileGlob;
