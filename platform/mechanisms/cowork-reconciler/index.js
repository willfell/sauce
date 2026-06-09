// platform/mechanisms/cowork-reconciler/index.js
//
// Per-vault reconciliation entry point (v0.97.0).
//
// Orchestrates the nightly reconciliation flow for a single vault:
//   1. Read engagements[] from spice/cowork/vault-config.md
//   2. For each engagement (optionally filtered):
//      a. Backfill missing .cowork.json sidecars from .md prose
//      b. Update learned_weights frontmatter via learn-from-checks-helper
//      c. Run check-heartbeat against 30-day sidecar window
//   3. Append per-vault reconciler-log entry (skipped under dry_run)
//
// Pure Node + filesystem. No network. Idempotent under repeated runs.

const fs = require("node:fs");
const path = require("node:path");

// vault-config.md lives at spice/cowork/vault-config.md (R-8 fixture).
// Older layouts may have placed it under spice/cowork/context/ — try both,
// but always prefer the canonical location first.
const VAULT_CONFIG_REL_CANONICAL = "spice/cowork/vault-config.md";
const VAULT_CONFIG_REL_LEGACY = "spice/cowork/context/vault-config.md";

function _resolveVaultConfigPath(vault_path) {
  const a = path.join(vault_path, VAULT_CONFIG_REL_CANONICAL);
  if (fs.existsSync(a)) return a;
  const b = path.join(vault_path, VAULT_CONFIG_REL_LEGACY);
  if (fs.existsSync(b)) return b;
  return null;
}

function _readVaultConfigEngagements(vault_path) {
  const configPath = _resolveVaultConfigPath(vault_path);
  if (!configPath) return [];
  const raw = fs.readFileSync(configPath, "utf8");
  const fmMatch = raw.match(/^---\s*\n([\s\S]+?)\n---/);
  if (!fmMatch) return [];
  return _parseEngagementsFromYaml(fmMatch[1]);
}

// Parse `engagements:` list from frontmatter YAML.
// Tolerant of two indentation styles:
//   engagements:
//     - id: foo
//       type: work
//       cadences:
//         morning: true
//
// Returns [{ id, type, cadences: { morning, midday, ... }, ... }, ...].
function _parseEngagementsFromYaml(fm) {
  const engagements = [];
  const lines = fm.split("\n");
  let inEngagements = false;
  let currentEng = null;
  let currentCadences = null;
  for (const line of lines) {
    // Skip blank lines but preserve list-walking state
    if (/^\s*$/.test(line)) continue;

    // End of engagements list when we hit a new top-level (zero-indent) key.
    if (inEngagements && /^[a-z_][a-zA-Z_]*:/.test(line)) {
      if (currentEng) engagements.push(currentEng);
      return engagements;
    }

    if (/^engagements:\s*$/.test(line)) {
      inEngagements = true;
      continue;
    }
    if (!inEngagements) continue;

    // New engagement entry: `  - id: <value>`
    const newEngMatch = line.match(/^\s{2}-\s*id:\s*(.+)$/);
    if (newEngMatch) {
      if (currentEng) engagements.push(currentEng);
      currentEng = { id: _stripYamlString(newEngMatch[1]), cadences: {} };
      currentCadences = null;
      continue;
    }

    // Cadences subblock header
    if (/^\s{4}cadences:\s*$/.test(line)) {
      currentCadences = currentEng && currentEng.cadences;
      continue;
    }

    // Cadence field (6+ space indent)
    const cadenceFieldMatch = line.match(/^\s{6,}([a-z_]+):\s*(.+)$/);
    if (cadenceFieldMatch && currentCadences) {
      const v = cadenceFieldMatch[2].trim();
      currentCadences[cadenceFieldMatch[1]] = v === "true" || v === "yes";
      continue;
    }

    // Engagement field (4 space indent, NOT a cadence subblock)
    const fieldMatch = line.match(/^\s{4}([a-z_]+):\s*(.+)$/);
    if (fieldMatch && currentEng) {
      const key = fieldMatch[1];
      if (key === "cadences") {
        currentCadences = currentEng.cadences;
        continue;
      }
      currentEng[key] = _stripYamlString(fieldMatch[2]);
      currentCadences = null;
    }
  }
  if (currentEng) engagements.push(currentEng);
  return engagements;
}

function _stripYamlString(s) {
  if (typeof s !== "string") return s;
  let v = s.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v;
}

// Synchronous on purpose: the HC harness (R-8) sync-checks `res.engagements`
// without awaiting. All sub-mechanisms operate on the local filesystem and
// expose sync APIs to preserve this contract.
function reconcileVault(opts) {
  const { vault_path, dry_run = false, engagement_filter = null } = opts || {};
  if (!vault_path) throw new Error("reconcileVault: vault_path required");

  const errors = [];
  const summary = {
    vault_path,
    engagements_processed: [],
    dry_run,
  };

  let engagements = [];
  try {
    engagements = _readVaultConfigEngagements(vault_path);
  } catch (err) {
    errors.push(`vault-config read failed: ${err.message}`);
    return { errors, engagements, summary };
  }

  const filtered = engagement_filter
    ? engagements.filter((e) => e.id === engagement_filter)
    : engagements;

  for (const engagement of filtered) {
    const engSummary = {
      engagement_id: engagement.id,
      sidecars_backfilled: 0,
      sidecars_validated: 0,
      learned_weights_delta: {},
      heartbeat: null,
    };
    try {
      const sidecarBackfill = require("./sidecar-backfill");
      const backfillResult = sidecarBackfill.backfillMissing({
        vault_path,
        engagement_id: engagement.id,
        dry_run,
      });
      engSummary.sidecars_backfilled = backfillResult.backfilled_count || 0;
      engSummary.sidecars_validated = backfillResult.validated_count || 0;
    } catch (err) {
      errors.push(`engagement ${engagement.id} backfill: ${err.message}`);
    }

    try {
      const lwUpdate = require("./learned-weights-update");
      const lwResult = lwUpdate.updateForEngagement({
        vault_path,
        engagement_id: engagement.id,
        dry_run,
      });
      engSummary.learned_weights_delta = (lwResult && lwResult.delta) || {};
    } catch (err) {
      errors.push(`engagement ${engagement.id} learned_weights: ${err.message}`);
    }

    try {
      const heartbeatCheck = require("./heartbeat-check");
      const hbResult = heartbeatCheck.runForEngagement({
        vault_path,
        engagement_id: engagement.id,
        engagement,
        dry_run,
      });
      engSummary.heartbeat = hbResult || null;
    } catch (err) {
      errors.push(`engagement ${engagement.id} heartbeat: ${err.message}`);
    }

    summary.engagements_processed.push(engSummary);
  }

  if (!dry_run) {
    try {
      const reconcilerLog = require("./reconciler-log");
      reconcilerLog.appendEntry({ vault_path, summary });
    } catch (err) {
      errors.push(`reconciler-log write: ${err.message}`);
    }
  }

  return { errors, engagements, summary };
}

module.exports = {
  reconcileVault,
  _parseEngagementsFromYaml,
  _readVaultConfigEngagements,
  _resolveVaultConfigPath,
  VAULT_CONFIG_REL_CANONICAL,
  VAULT_CONFIG_REL_LEGACY,
};
