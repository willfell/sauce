// platform/helpers/vault-paths-registry-helper.js
//
// Manages ~/.sauce/vault-paths.json — the cross-vault registry consumed
// by `sauce reconcile-cowork --all-vaults`. Pure Node + filesystem.
// Accepts optional `{ sauce_dir }` override for hermetic testing.
//
// Reads BOTH canonical vault-paths.json (v0.97+) and legacy vaults.json
// (pre-v0.97) for backwards compatibility. Writes always go to canonical.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const DEFAULT_FILENAME = "vault-paths.json";
const LEGACY_FILENAME = "vaults.json";

function _resolveDir(opts) {
  return (opts && opts.sauce_dir) || path.join(os.homedir(), ".sauce");
}

function _resolveRegistryPath(opts) {
  return path.join(_resolveDir(opts), DEFAULT_FILENAME);
}

function _resolveLegacyPath(opts) {
  return path.join(_resolveDir(opts), LEGACY_FILENAME);
}

function _ensureDir(opts) {
  fs.mkdirSync(_resolveDir(opts), { recursive: true });
}

function _normalizeVaultEntries(parsed) {
  // Accept either { vaults: [{path,label}, ...] } or { vaults: { "<label>": "<path>", ... } }
  // (the legacy vaults.json shape used in older sauce versions).
  if (!parsed || typeof parsed !== "object") return [];
  const raw = parsed.vaults;
  if (Array.isArray(raw)) {
    return raw.filter((v) => v && typeof v.path === "string");
  }
  if (raw && typeof raw === "object") {
    const out = [];
    for (const [label, p] of Object.entries(raw)) {
      if (typeof p === "string") out.push({ path: p, label });
    }
    return out;
  }
  return [];
}

function loadVaultPaths(opts) {
  const registryPath = _resolveRegistryPath(opts);
  const legacyPath = _resolveLegacyPath(opts);
  // Prefer canonical vault-paths.json; fall back to legacy vaults.json
  for (const p of [registryPath, legacyPath]) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, "utf8");
      const parsed = JSON.parse(raw);
      return {
        schema_version: parsed.schema_version || "1.0.0",
        vaults: _normalizeVaultEntries(parsed),
      };
    } catch (_err) {
      // continue to next candidate
    }
  }
  return { schema_version: "1.0.0", vaults: [] };
}

function addVaultPath(entry, opts) {
  if (!entry || !entry.path) throw new Error("addVaultPath: { path } required");
  _ensureDir(opts);
  const registryPath = _resolveRegistryPath(opts);
  const registry = loadVaultPaths(opts);
  const existing = registry.vaults.find((v) => v.path === entry.path);
  if (existing) {
    let updated = false;
    if (entry.label && existing.label !== entry.label) {
      existing.label = entry.label;
      updated = true;
    }
    fs.writeFileSync(
      registryPath,
      JSON.stringify(registry, null, 2) + "\n",
      "utf8"
    );
    return { added: false, updated, registry };
  }
  registry.vaults.push({
    path: entry.path,
    label: entry.label || path.basename(entry.path),
  });
  fs.writeFileSync(
    registryPath,
    JSON.stringify(registry, null, 2) + "\n",
    "utf8"
  );
  return { added: true, updated: false, registry };
}

module.exports = {
  DEFAULT_FILENAME,
  LEGACY_FILENAME,
  loadVaultPaths,
  addVaultPath,
  _resolveDir,
  _resolveRegistryPath,
  _resolveLegacyPath,
  _normalizeVaultEntries,
};
