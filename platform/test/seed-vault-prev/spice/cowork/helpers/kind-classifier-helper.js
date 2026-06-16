// platform/blueprints/cowork/helpers/kind-classifier-helper.js
//
// MCP auto-discovery: enumerate reachable namespaces + their tool lists,
// classify each into a known kind via deterministic pattern matching with
// optional LLM fallback for unrecognized namespaces. Cached per-namespace
// per-classifier-version.
//
// Returns: { classified, unclassified, new_since_last_fire, cache_hits }
//   classified[ns]      = { kind: "<name>", best_score: <int>, classified_at: <iso> }
//   unclassified        = string[] of namespaces with no kind match
//   new_since_last_fire = string[] of namespaces missing from cache prior to this call
//   cache_hits          = string[] of namespaces served from cache this call (subset of reachable_namespaces)
//
// Cache location: <vault_root>/spice/cowork/data/kind-classifier-cache.json
// Patterns:       <vault_root>/spice/cowork/data/kind-patterns.json
//                 (falls back to workshop blueprint source for tests / dogfood)

const fs = require("node:fs");
const path = require("node:path");

const CLASSIFIER_VERSION = "0.96.0";

const _patternsCache = new Map();
function _loadPatterns(patternsPath) {
  if (_patternsCache.has(patternsPath)) return _patternsCache.get(patternsPath);
  const raw = fs.readFileSync(patternsPath, "utf8");
  const parsed = JSON.parse(raw);
  _patternsCache.set(patternsPath, parsed);
  return parsed;
}

function _globToRegex(glob) {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function _matchScore(kindConfig, namespace, toolNames) {
  let score = 0;
  for (const pat of kindConfig.namespace_patterns || []) {
    if (_globToRegex(pat).test(namespace)) score += 2;
  }
  for (const pat of kindConfig.tool_name_patterns || []) {
    const rx = _globToRegex(pat);
    for (const tool of toolNames) {
      if (rx.test(tool)) score += 1;
    }
  }
  return score;
}

function _resolvePatternsPath(vault_root, patterns_path) {
  if (patterns_path) return patterns_path;
  // Prefer consumer-vault materialized path under spice/cowork/data
  if (vault_root) {
    const consumer = path.join(vault_root, "spice/cowork/data/kind-patterns.json");
    if (fs.existsSync(consumer)) return consumer;
  }
  // Fallback: workshop blueprint source (for tests / dogfood)
  return path.join(__dirname, "..", "data", "kind-patterns.json");
}

function _resolveCachePath(vault_root, cache_path) {
  if (cache_path) return cache_path;
  // Always write/read cache under vault_root when provided — tests rely on this.
  if (vault_root) {
    return path.join(vault_root, "spice/cowork/data/kind-classifier-cache.json");
  }
  // Last resort: workshop blueprint source (read-only seed).
  return path.join(__dirname, "..", "data", "kind-classifier-cache.json");
}

function _ensureDir(filePath) {
  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    // Best-effort. Write failures handled by caller.
  }
}

function _loadCache(cachePath) {
  if (fs.existsSync(cachePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      if (parsed && typeof parsed === "object") {
        if (!parsed.entries || typeof parsed.entries !== "object") parsed.entries = {};
        if (typeof parsed.classifier_version !== "string") parsed.classifier_version = CLASSIFIER_VERSION;
        if (typeof parsed.schema_version !== "string") parsed.schema_version = "1.0.0";
        return parsed;
      }
    } catch (_) {
      // Fall through to fresh cache.
    }
  }
  return { schema_version: "1.0.0", entries: {}, classifier_version: CLASSIFIER_VERSION };
}

function classifyConnectedKinds(opts) {
  const {
    reachable_namespaces,
    tools_by_namespace,
    vault_root,
    patterns_path,
    cache_path,
    llm_fallback,
  } = opts || {};
  if (!Array.isArray(reachable_namespaces)) {
    throw new Error("classifyConnectedKinds requires reachable_namespaces: string[]");
  }
  if (!tools_by_namespace || typeof tools_by_namespace !== "object") {
    throw new Error("classifyConnectedKinds requires tools_by_namespace: object");
  }

  const resolvedPatternsPath = _resolvePatternsPath(vault_root, patterns_path);
  const resolvedCachePath = _resolveCachePath(vault_root, cache_path);
  const patterns = _loadPatterns(resolvedPatternsPath);
  const cache = _loadCache(resolvedCachePath);

  const result = {
    classified: {},
    unclassified: [],
    new_since_last_fire: [],
    cache_hits: [],
  };

  let cacheMutated = false;

  for (const ns of reachable_namespaces) {
    const toolNames = Array.isArray(tools_by_namespace[ns]) ? tools_by_namespace[ns] : [];
    const cached = cache.entries[ns];

    if (cached && cached.classifier_version === cache.classifier_version) {
      result.cache_hits.push(ns);
      if (cached.kind === "unclassified") {
        result.unclassified.push(ns);
      } else {
        result.classified[ns] = {
          kind: cached.kind,
          best_score: cached.best_score,
          classified_at: cached.classified_at,
        };
      }
      continue;
    }

    // Cache miss — count toward new_since_last_fire and (re)classify.
    result.new_since_last_fire.push(ns);

    let bestKind = null;
    let bestScore = 0;
    for (const [kind, kindConfig] of Object.entries(patterns.kinds)) {
      const score = _matchScore(kindConfig, ns, toolNames);
      if (score > bestScore) {
        bestScore = score;
        bestKind = kind;
      }
    }

    let assignedKind;
    if (bestScore >= 2) {
      assignedKind = bestKind;
    } else if (typeof llm_fallback === "function") {
      try {
        const proposed = llm_fallback({ namespace: ns, tool_names: toolNames });
        assignedKind = typeof proposed === "string" && proposed.length > 0 ? proposed : "unclassified";
      } catch (_) {
        assignedKind = "unclassified";
      }
    } else {
      assignedKind = "unclassified";
    }

    const classified_at = new Date().toISOString();
    cache.entries[ns] = {
      kind: assignedKind,
      classified_at,
      classifier_version: cache.classifier_version,
      best_score: bestScore,
    };
    cacheMutated = true;

    if (assignedKind === "unclassified") {
      result.unclassified.push(ns);
    } else {
      result.classified[ns] = { kind: assignedKind, best_score: bestScore, classified_at };
    }
  }

  if (cacheMutated) {
    try {
      _ensureDir(resolvedCachePath);
      fs.writeFileSync(resolvedCachePath, JSON.stringify(cache, null, 2) + "\n", "utf8");
    } catch (_) {
      // Cache write failures are non-fatal — classifier still returns correct result.
    }
  }

  return result;
}

module.exports = {
  classifyConnectedKinds,
  CLASSIFIER_VERSION,
  _globToRegex,
  _matchScore,
  _resolvePatternsPath,
  _resolveCachePath,
};
