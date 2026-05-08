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

const path = require("path");

// Cache: per-fragment compiled glob regex (keyed by the Fragment object identity via WeakMap).
const _globCache = new WeakMap();

exports.applyRules = function (rules, fileRecord) {
  const violations = [];
  if (!Array.isArray(rules)) return violations;
  for (const fragment of rules) {
    if (!fragment || typeof fragment !== "object") continue;
    const scopeOk = _matchesScope(fragment, fileRecord);
    if (scopeOk === "error") continue; // malformed glob → skip fragment entirely
    if (!scopeOk) continue;
    if (fragment.frontmatter_branch) {
      const branch = _pickFirstMatchingBranch(fragment.frontmatter_branch, fileRecord);
      if (branch) _applyRequirements(branch, fileRecord, violations);
    } else {
      _applyRequirements(fragment, fileRecord, violations);
    }
  }
  return violations;
};

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

function _applyRequirements(spec, fileRecord, violations) {
  // required_frontmatter / required_tags / naming_pattern
  if (spec.required_frontmatter && typeof spec.required_frontmatter === "object") {
    for (const [key, k] of Object.entries(spec.required_frontmatter)) {
      _checkFmKey(key, k, fileRecord, violations);
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

function _checkFmKey(key, k, fileRecord, violations) {
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
}

// Exposed for unit-testing the glob translator in isolation, if needed.
exports._globMatch = _globMatch;
exports._compileGlob = _compileGlob;
