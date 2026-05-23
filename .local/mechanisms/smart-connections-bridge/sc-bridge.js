#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * sc-bridge — Smart Connections semantic-retrieval bridge for Sauce.
 *
 * Reads .smart-env/multi/<sanitized>.ajson files directly + computes
 * cosine similarity using @xenova/transformers + bge-micro-v2.
 *
 * Ops: index-status | semantic-search | find-related
 *
 * Common flags: --vault <root> (required), --quiet, --json,
 *               --top-k <n>, --min-similarity <f>, --exclude-glob <glob>
 *
 * --json is accepted for forward-compat but currently no-op: stdout
 * is JSON regardless. --quiet suppresses non-fatal stderr warnings
 * (e.g., "skipping unparseable .ajson") but never suppresses fatal
 * errors (missing vault, bad args, unhandled exceptions).
 *
 * Exit codes: 0 = ok, 1 = unhandled error, 2 = bad args,
 *             3 = vault not found, 4 = index corrupt/unavailable.
 */
"use strict";

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const op = argv[2];
  const rest = argv.slice(3);
  const flags = { vault: null, quiet: false, json: false, topK: 3, minSimilarity: 0.45, excludeGlobs: [] };
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "--vault")               flags.vault = rest[++i];
    else if (t === "--quiet")          flags.quiet = true;
    else if (t === "--json")           flags.json = true;
    else if (t === "--top-k")          flags.topK = parseInt(rest[++i], 10);
    else if (t === "--min-similarity") flags.minSimilarity = parseFloat(rest[++i]);
    else if (t === "--exclude-glob")   flags.excludeGlobs.push(rest[++i]);
    else                               positional.push(t);
  }
  return { op, flags, positional };
}

// ---------------------------------------------------------------------------
// Emit helpers
// ---------------------------------------------------------------------------

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(0);
}

function emitError(code, obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(code);
}

// ---------------------------------------------------------------------------
// .ajson parsing
// Parse one .ajson line — the format is `"<key>": <value-json>` (no leading `{`).
// ---------------------------------------------------------------------------

function parseAjsonLine(text) {
  const t = text.trim();
  const wrapped = "{" + t + "}";
  const parsed = JSON.parse(wrapped);
  const keys = Object.keys(parsed);
  if (keys.length === 0) return null;
  return parsed[keys[0]];
}

// ---------------------------------------------------------------------------
// index-status (sync, standalone)
// ---------------------------------------------------------------------------

function indexStatus(flags) {
  const smartEnvDir = path.join(flags.vault, ".smart-env");
  if (!fs.existsSync(smartEnvDir)) {
    return emit({ index_status: "absent", vault_root: flags.vault, smart_env_dir: smartEnvDir, source_count: 0, index_age_minutes: null });
  }
  const multiDir = path.join(smartEnvDir, "multi");
  if (!fs.existsSync(multiDir)) {
    return emit({ index_status: "absent", vault_root: flags.vault, smart_env_dir: smartEnvDir, source_count: 0, index_age_minutes: null });
  }
  const entries = fs.readdirSync(multiDir).filter((n) => n.endsWith(".ajson"));
  if (entries.length === 0) {
    return emit({ index_status: "absent", vault_root: flags.vault, smart_env_dir: smartEnvDir, source_count: 0, index_age_minutes: null });
  }
  let maxMtimeMs = 0;
  for (const e of entries) {
    const stat = fs.statSync(path.join(multiDir, e));
    if (stat.mtimeMs > maxMtimeMs) maxMtimeMs = stat.mtimeMs;
  }
  const ageMin = Math.round((Date.now() - maxMtimeMs) / 60000);
  let embeddingModel = null;
  let staleConfig = false;
  try {
    const smartEnvJsonPath = path.join(smartEnvDir, "smart_env.json");
    if (fs.existsSync(smartEnvJsonPath)) {
      const j = JSON.parse(fs.readFileSync(smartEnvJsonPath, "utf8"));
      embeddingModel = j?.smart_sources?.embed_model?.transformers?.model_key || null;
    }
    const sample = fs.readFileSync(path.join(multiDir, entries[0]), "utf8");
    const parsed = parseAjsonLine(sample);
    if (embeddingModel && parsed?.embeddings && !parsed.embeddings[embeddingModel]) {
      staleConfig = true;
    }
  } catch (_) { /* defensive — fall through */ }
  emit({
    index_status: staleConfig ? "stale-config" : "ready",
    vault_root: flags.vault,
    smart_env_dir: smartEnvDir,
    embedding_model: embeddingModel,
    source_count: entries.length,
    index_max_mtime_iso: new Date(maxMtimeMs).toISOString(),
    index_age_minutes: ageMin,
  });
}

// ---------------------------------------------------------------------------
// indexStatusObj — side-effect-free variant for use inside search ops
// ---------------------------------------------------------------------------

function indexStatusObj(vaultRoot) {
  const smartEnvDir = path.join(vaultRoot, ".smart-env");
  const multiDir = path.join(smartEnvDir, "multi");
  if (!fs.existsSync(smartEnvDir) || !fs.existsSync(multiDir)) {
    return { index_status: "absent", index_age_minutes: null };
  }
  const entries = fs.readdirSync(multiDir).filter((n) => n.endsWith(".ajson"));
  if (entries.length === 0) return { index_status: "absent", index_age_minutes: null };
  let maxMtimeMs = 0;
  for (const e of entries) {
    const stat = fs.statSync(path.join(multiDir, e));
    if (stat.mtimeMs > maxMtimeMs) maxMtimeMs = stat.mtimeMs;
  }
  return { index_status: "ready", index_age_minutes: Math.round((Date.now() - maxMtimeMs) / 60000) };
}

// ---------------------------------------------------------------------------
// Module-directory substitution helpers
// ---------------------------------------------------------------------------

function loadModuleDirectoryMap(vaultRoot) {
  const map = {};
  // First: try ranch/platform-installed.json's blueprints[] (test-fixture path).
  const installedPath = path.join(vaultRoot, "ranch", "platform-installed.json");
  let workshopPath = null;
  if (fs.existsSync(installedPath)) {
    try {
      const installed = JSON.parse(fs.readFileSync(installedPath, "utf8"));
      workshopPath = installed.workshop_path || null;
      for (const bp of (installed.blueprints || [])) {
        if (bp.id && bp.module_directory) {
          map[bp.id] = bp.module_directory;
        }
      }
    } catch (_) { /* fall through */ }
  }
  // Fallback: read module_directory from each workshop blueprint manifest.
  if (Object.keys(map).length === 0 && workshopPath && fs.existsSync(workshopPath)) {
    const bpDir = path.join(workshopPath, "platform", "blueprints");
    if (fs.existsSync(bpDir)) {
      try {
        for (const bp of fs.readdirSync(bpDir)) {
          const manifestPath = path.join(bpDir, bp, "manifest.json");
          if (fs.existsSync(manifestPath)) {
            try {
              const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
              if (m.module_directory) map[bp] = m.module_directory;
            } catch (_) { /* skip malformed */ }
          }
        }
      } catch (_) { /* fall through */ }
    }
  }
  return Object.keys(map).length > 0 ? map : null;
}

function resolveModuleDirectory(rawPath, moduleDirMap, vaultRoot) {
  if (!rawPath.includes("{{module_directory}}")) return rawPath;
  if (!moduleDirMap) return rawPath;
  // The SC index doesn't tag which blueprint the source came from.
  // Heuristic: try each known module_directory and use the first one
  // whose resolved path exists as a real file. If none exist, fall
  // back to the first map entry (best-effort).
  const candidates = Object.values(moduleDirMap);
  for (const md of candidates) {
    const candidate = rawPath.replace("{{module_directory}}", md);
    if (fs.existsSync(path.join(vaultRoot, candidate))) {
      return candidate;
    }
  }
  return rawPath.replace("{{module_directory}}", candidates[0]);
}

// ---------------------------------------------------------------------------
// Index loader
// ---------------------------------------------------------------------------

function loadIndex(vaultRoot, flags) {
  const multiDir = path.join(vaultRoot, ".smart-env", "multi");
  const entries = fs.readdirSync(multiDir).filter((n) => n.endsWith(".ajson"));
  const moduleDirMap = loadModuleDirectoryMap(vaultRoot);
  const sources = [];
  let parseFailures = 0;
  for (const fname of entries) {
    try {
      const txt = fs.readFileSync(path.join(multiDir, fname), "utf8");
      const parsed = parseAjsonLine(txt);
      if (!parsed) { parseFailures++; continue; }
      const rawPath = parsed.path;
      if (!rawPath) { parseFailures++; continue; }
      const resolvedPath = resolveModuleDirectory(rawPath, moduleDirMap, vaultRoot);
      const embeddingsBag = parsed.embeddings || {};
      const modelKey = Object.keys(embeddingsBag)[0];
      const vec = embeddingsBag[modelKey]?.vec;
      if (!vec || !Array.isArray(vec)) { parseFailures++; continue; }
      sources.push({ path: resolvedPath, vec });
    } catch (err) {
      parseFailures++;
      if (!(flags && flags.quiet)) {
        process.stderr.write(`sc-bridge: skipping unparseable .ajson ${fname}: ${err.message}\n`);
      }
    }
  }
  if (sources.length === 0 && entries.length > 0) {
    return { sources: [], allCorrupt: true, parseFailures };
  }
  return { sources, allCorrupt: false, parseFailures };
}

// ---------------------------------------------------------------------------
// Embedding helpers
// ---------------------------------------------------------------------------

async function embedQuery(query) {
  const { pipeline } = require("@xenova/transformers");
  const extractor = await pipeline("feature-extraction", "TaylorAI/bge-micro-v2");
  const out = await extractor(query, { pooling: "mean", normalize: true });
  return Array.from(out.data); // 384-dim Float32Array → number[]
}

function cosineSim(a, b) {
  // Vectors come in normalized from BGE; dot product = cosine.
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function excludeGlobMatches(p, globs) {
  for (const g of (globs || [])) {
    const re = new RegExp(
      "^" +
      g.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
       .replace(/\*\*/g, ".*")
       .replace(/\*/g, "[^/]*") +
      "$"
    );
    if (re.test(p)) return true;
  }
  return false;
}

function enrichHit(hit, vaultRoot) {
  const abs = path.join(vaultRoot, hit.path);
  let title = path.basename(hit.path).replace(/\.md$/, "");
  let snippet = "";
  try {
    const body = fs.readFileSync(abs, "utf8");
    const stripped = body.replace(/^---\n[\s\S]*?\n---\n/, "");
    snippet = stripped.replace(/\s+/g, " ").trim().slice(0, 200);
    const headingMatch = stripped.match(/^#\s+(.+)$/m);
    if (headingMatch) title = headingMatch[1].trim();
  } catch (_) { /* fall through with defaults */ }
  return { path: hit.path, title, similarity: hit.similarity, snippet };
}

// ---------------------------------------------------------------------------
// semantic-search
// ---------------------------------------------------------------------------

async function semanticSearch(query, flags) {
  if (!query) {
    process.stderr.write("sc-bridge: semantic-search requires a query string\n");
    process.exit(2);
  }
  const stat = indexStatusObj(flags.vault);
  if (stat.index_status === "absent") return emit({ ...stat, query, hits: [] });
  const { sources, allCorrupt } = loadIndex(flags.vault, flags);
  if (allCorrupt) return emitError(4, { index_status: "error", error: "all-ajson-unparseable", query, hits: [] });
  let queryVec;
  try {
    queryVec = await embedQuery(query);
  } catch (err) {
    return emitError(4, { index_status: "error", error: `embed-failed: ${err.message}`, query, hits: [] });
  }
  const hits = [];
  for (const s of sources) {
    if (excludeGlobMatches(s.path, flags.excludeGlobs)) continue;
    const sim = cosineSim(queryVec, s.vec);
    if (sim < flags.minSimilarity) continue;
    hits.push({ path: s.path, similarity: sim });
  }
  hits.sort((a, b) => b.similarity - a.similarity);
  const top = hits.slice(0, flags.topK).map((h) => enrichHit(h, flags.vault));
  emit({ ...stat, query, hits: top });
}

// ---------------------------------------------------------------------------
// find-related
// ---------------------------------------------------------------------------

async function findRelated(anchor, flags) {
  if (!anchor) {
    process.stderr.write("sc-bridge: find-related requires an anchor path\n");
    process.exit(2);
  }
  const stat = indexStatusObj(flags.vault);
  if (stat.index_status === "absent") return emit({ ...stat, anchor, hits: [] });
  const { sources, allCorrupt } = loadIndex(flags.vault, flags);
  if (allCorrupt) return emitError(4, { index_status: "error", error: "all-ajson-unparseable", anchor, hits: [] });
  const anchorSource = sources.find((s) => s.path === anchor);
  if (!anchorSource) {
    return emit({ ...stat, anchor, hits: [], skipped: "anchor-not-indexed" });
  }
  const hits = [];
  for (const s of sources) {
    if (s.path === anchor) continue; // dedupe self
    if (excludeGlobMatches(s.path, flags.excludeGlobs)) continue;
    const sim = cosineSim(anchorSource.vec, s.vec);
    if (sim < flags.minSimilarity) continue;
    hits.push({ path: s.path, similarity: sim });
  }
  hits.sort((a, b) => b.similarity - a.similarity);
  const top = hits.slice(0, flags.topK).map((h) => enrichHit(h, flags.vault));
  emit({ ...stat, anchor, hits: top });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const { op, flags, positional } = parseArgs(process.argv);
  if (!flags.vault) { process.stderr.write("sc-bridge: missing required --vault <root>\n"); process.exit(2); }
  if (!fs.existsSync(flags.vault)) { process.stderr.write(`sc-bridge: vault path not found: ${flags.vault}\n`); process.exit(3); }
  switch (op) {
    case "index-status":    indexStatus(flags);                          break;
    case "semantic-search": await semanticSearch(positional[0], flags);  break;
    case "find-related":    await findRelated(positional[0], flags);     break;
    default:
      process.stderr.write(`sc-bridge: unknown op "${op}" (try: index-status | semantic-search | find-related)\n`);
      process.exit(2);
  }
}

main().catch((err) => { process.stderr.write(`sc-bridge: unhandled error: ${err.message}\n`); process.exit(1); });
