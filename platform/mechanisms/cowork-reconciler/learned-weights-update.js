// platform/mechanisms/cowork-reconciler/learned-weights-update.js
//
// Updates learned_weights frontmatter on the per-engagement
// user-preferences.md from yesterday's atomic-note rating callouts.
// .bak is written before any frontmatter rewrite (R-13 contract).
//
// Reads atomic notes from:
//   spice/cowork/daily/YYYY/MM-MonthName/YYYY-MM-DD/*.md  (engagement-id filtered via sidecar)
//
// Writes to:
//   spice/cowork/engagements/<engagement_id>/user-preferences.md  (canonical v0.97)
//   spice/cowork/context/user-preferences.md                       (legacy fallback)
//
// Synchronous: HC harness (R-13) does not await.

const fs = require("node:fs");
const path = require("node:path");
const lfc = require("../../blueprints/cowork/helpers/learn-from-checks-helper");

const PREFS_REL_CANDIDATES = [
  // v0.97 canonical: per-engagement scope
  (engagement_id) => `spice/cowork/engagements/${engagement_id}/user-preferences.md`,
  // Legacy: vault-scope
  () => `spice/cowork/context/user-preferences.md`,
  () => `spice/cowork/user-preferences.md`,
];

function _resolvePrefsPath(vault_path, engagement_id) {
  for (const fn of PREFS_REL_CANDIDATES) {
    const candidate = path.join(vault_path, fn(engagement_id));
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function _writeBackup(filePath) {
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, `${filePath}.bak`);
  }
}

function _yesterdayDirRel() {
  const now = new Date();
  const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yyyy = y.getFullYear();
  const mm = String(y.getMonth() + 1).padStart(2, "0");
  const dd = String(y.getDate()).padStart(2, "0");
  const monthName = y.toLocaleString("en-US", { month: "long" });
  return path.join(String(yyyy), `${mm}-${monthName}`, `${yyyy}-${mm}-${dd}`);
}

function _splitFrontmatter(raw) {
  const m = raw.match(/^---\s*\n([\s\S]+?)\n---\s*\n?/);
  if (!m) return { fm: null, body: raw };
  return { fm: m[1], body: raw.slice(m[0].length) };
}

// Heuristic: strip the entire `learned_weights:` block from a YAML
// frontmatter string. Block ends at the next top-level key or end of FM.
function _stripLearnedWeightsBlock(fmText) {
  if (!fmText) return fmText;
  const lines = fmText.split("\n");
  const out = [];
  let inLW = false;
  for (const line of lines) {
    if (!inLW) {
      if (/^learned_weights:/.test(line)) {
        inLW = true;
        continue;
      }
      out.push(line);
    } else {
      // Top-level key (zero-indent) ends the block.
      if (/^[a-z_][a-zA-Z_]*:/.test(line)) {
        inLW = false;
        out.push(line);
      }
      // otherwise: still inside learned_weights block; drop.
    }
  }
  return out.join("\n").replace(/\n+$/, "");
}

function _serializeLearnedWeights(normalized) {
  const lines = ["learned_weights:"];
  lines.push(`  schema_version: "${normalized.schema_version || "1.0.0"}"`);
  lines.push("  engagements:");
  for (const [engId, engData] of Object.entries(normalized.engagements || {})) {
    lines.push(`    ${engId}:`);
    lines.push("      per_kind:");
    for (const [kind, kd] of Object.entries(engData.per_kind || {})) {
      const lu = kd.last_updated || "";
      lines.push(
        `        ${kind}: { weight: ${kd.weight}, ticks: ${kd.ticks || 0}, skips: ${kd.skips || 0}, warmup: ${kd.warmup}, last_updated: "${lu}" }`
      );
    }
    lines.push("      totals:");
    const t = engData.totals || {};
    lines.push(`        notes_scanned: ${t.notes_scanned || 0}`);
    lines.push(`        notes_with_any_tick: ${t.notes_with_any_tick || 0}`);
    if (t.warmup_until) lines.push(`        warmup_until: "${t.warmup_until}"`);
    lines.push(`        upgrade_notice_emitted: ${t.upgrade_notice_emitted || false}`);
    lines.push(`        scanned_days: ${JSON.stringify(t.scanned_days || [])}`);
  }
  return lines.join("\n");
}

function updateForEngagement(opts) {
  const { vault_path, engagement_id, dry_run = false } = opts || {};
  if (!vault_path || !engagement_id) {
    throw new Error("updateForEngagement: vault_path + engagement_id required");
  }

  // Scan yesterday's atomic notes (if dir exists).
  const dailyDir = path.join(vault_path, "spice/cowork/daily", _yesterdayDirRel());
  const observations = [];
  if (fs.existsSync(dailyDir)) {
    const scanResult = lfc.scanAtomicNotes({
      dir: dailyDir,
      engagement_id,
    });
    observations.push(...(scanResult.observations || []));
  }

  const prefsPath = _resolvePrefsPath(vault_path, engagement_id);
  if (!prefsPath) {
    return {
      delta: {},
      observations_count: observations.length,
      note: "user-preferences.md not found",
    };
  }

  // R-13 contract: .bak written BEFORE any frontmatter rewrite.
  if (!dry_run) {
    _writeBackup(prefsPath);
  }

  const raw = fs.readFileSync(prefsPath, "utf8");
  const { fm, body } = _splitFrontmatter(raw);
  if (!fm) {
    return {
      delta: {},
      observations_count: observations.length,
      note: "no frontmatter",
    };
  }

  // Start from a normalized learned_weights state (lazy creation).
  const normalized = lfc._normalizeLearnedWeights(null);
  if (!normalized.engagements[engagement_id]) {
    normalized.engagements[engagement_id] = {
      per_kind: {},
      totals: {
        notes_scanned: 0,
        notes_with_any_tick: 0,
        warmup_until: null,
        upgrade_notice_emitted: false,
        scanned_days: [],
      },
    };
  }

  const prevPerKind = normalized.engagements[engagement_id].per_kind;
  const nextPerKind = lfc.updateWeights(prevPerKind, observations);
  normalized.engagements[engagement_id].per_kind = nextPerKind;

  const delta = {};
  for (const kind of Object.keys(nextPerKind)) {
    const before = (prevPerKind[kind] && prevPerKind[kind].weight) || 1.0;
    const after = nextPerKind[kind].weight;
    if (before !== after) delta[kind] = { before, after };
  }

  if (!dry_run) {
    const fmWithoutLW = _stripLearnedWeightsBlock(fm);
    const newLW = _serializeLearnedWeights(normalized);
    const newFm =
      (fmWithoutLW.length > 0 ? fmWithoutLW + "\n" : "") + newLW + "\n";
    const newContent = `---\n${newFm}---\n${body}`;
    fs.writeFileSync(prefsPath, newContent, "utf8");
  }

  return {
    delta,
    observations_count: observations.length,
    dry_run,
    prefs_path: prefsPath,
  };
}

module.exports = {
  updateForEngagement,
  _resolvePrefsPath,
  _stripLearnedWeightsBlock,
  _serializeLearnedWeights,
  _yesterdayDirRel,
};
