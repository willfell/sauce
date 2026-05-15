// platform/audit/entity-create-walker.js — v0.46.0 S3
//
// Walks every blueprint entry in ranch/platform-installed.json + every .js
// file under ranch/scripts/<blueprint>/ to surface entity-create modularization
// drift. Emits a 3-severity report:
//
//   - manual_implementation_at_risk (HIGH) — blueprint has a CustomJS class
//     whose body matches /class\s+New\w+Button\b/ (the New.*Button regex per
//     strategy doc) but no new_entity_buttons[] entry in its manifest. Either
//     the blueprint hasn't migrated, or the migration is incomplete.
//
//   - escape_hatch_used (INFO) — blueprint has BOTH a new_entity_buttons[]
//     entry AND a CustomJS class matching New.*Button — the escape hatch is
//     engaged. Expected when intentional; demands a justification line in the
//     cycle design doc per Lego principle #2.
//
//   - dead_path (MEDIUM) — manifest entry has destination.folder_prefix that
//     doesn't resolve to an existing folder under spice/ at audit time, OR
//     body_template path doesn't resolve to a file under ranch/templates/.
//
// Plus a count of `aligned` entries (no severity raised). No per-row finding
// is emitted for aligned — count only.
//
// Pure node module. No Obsidian dependency. Uses node fs directly so it is
// callable from cmd-audit.js (which never reaches into tp.app).
//
// Modeled on platform/mechanisms/audit/claude-surface-walker.js (v0.32.0 S7.A).

"use strict";

const fs = require("fs");
const path = require("path");

const INSTALLED_REL = "ranch/platform-installed.json";
const SCRIPTS_REL   = "ranch/scripts";
const TEMPLATES_REL = "ranch/templates";

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch (e) {
    return null;
  }
}

function fileExists(absPath) {
  try {
    return fs.statSync(absPath).isFile();
  } catch (e) {
    return false;
  }
}

function dirExists(absPath) {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch (e) {
    return false;
  }
}

async function walkEntityCreate(vaultPath, opts) {
  opts = opts || {};
  const findings = [];
  const counts = {
    manual_implementation_at_risk: 0,
    escape_hatch_used: 0,
    dead_path: 0,
    aligned: 0,
  };

  const installedAbs = path.join(vaultPath, INSTALLED_REL);
  if (!fileExists(installedAbs)) {
    findings.push({
      severity: "dead_path",
      path: INSTALLED_REL,
      message: "platform-installed.json missing — has the installer ever run?",
    });
    counts.dead_path = 1;
    return { findings, counts };
  }

  const installed = readJsonSafe(installedAbs);
  if (!installed || typeof installed !== "object") {
    findings.push({
      severity: "dead_path",
      path: INSTALLED_REL,
      message: "platform-installed.json malformed (parse failed)",
    });
    counts.dead_path = 1;
    return { findings, counts };
  }

  const blueprints = Array.isArray(installed.blueprints) ? installed.blueprints : [];

  for (const bp of blueprints) {
    const bpName = bp.name || "<unknown>";

    // Locate the blueprint manifest. installed.json records a path to the
    // blueprint's source directory in the workshop; for installed consumers
    // we walk ranch/scripts/<blueprint>/ which is where helpers land.
    // The manifest lives at bp.path in the workshop, but for the per-vault
    // case, we read from installed.json's blueprints[].manifest if present,
    // or skip manifest-based checks.
    const bpManifest = bp.manifest
      ? bp.manifest
      : (bp.path ? readJsonSafe(path.join(vaultPath, bp.path, "manifest.json")) : null);

    const declaredEntries = (bpManifest && Array.isArray(bpManifest.new_entity_buttons))
      ? bpManifest.new_entity_buttons
      : [];
    const declaredIds = new Set(declaredEntries.map(e => e && e.id).filter(Boolean));

    // --- Rule 1 + Rule 2: scan helper .js files for New*Button classes ---
    const scriptDir = path.join(vaultPath, SCRIPTS_REL, bpName);
    const helperFiles = dirExists(scriptDir)
      ? fs.readdirSync(scriptDir).filter(f => f.endsWith(".js"))
      : [];

    for (const hf of helperFiles) {
      let body = "";
      try { body = fs.readFileSync(path.join(scriptDir, hf), "utf8"); }
      catch (e) { continue; }

      const m = body.match(/class\s+(New\w+Button)\b/);
      if (!m) continue;
      const className = m[1];

      if (declaredIds.size === 0) {
        // Rule 1: New*Button class with no new_entity_buttons[] declaration at all.
        findings.push({
          severity: "manual_implementation_at_risk",
          path: `${bpName}/${hf}`,
          blueprint: bpName,
          message: `class ${className} exists but blueprint has no new_entity_buttons[] entry — migration incomplete or not started`,
        });
        counts.manual_implementation_at_risk++;
      } else {
        // Rule 2: New*Button class coexists with new_entity_buttons[] (escape hatch).
        findings.push({
          severity: "escape_hatch_used",
          path: `${bpName}/${hf}`,
          blueprint: bpName,
          message: `class ${className} coexists with new_entity_buttons[] (escape hatch intentional? document justification per Lego principle #2)`,
        });
        counts.escape_hatch_used++;
      }
    }

    // --- Rule 3: dead_path checks on declared new_entity_buttons[] entries ---
    let entryAligned = 0;
    let entryFailed = 0;
    for (const entry of declaredEntries) {
      if (!entry || typeof entry !== "object") continue;
      let thisFailed = false;

      // destination.folder_prefix — check first two segments exist under vault
      const rawFolder = entry.destination && typeof entry.destination.folder_prefix === "string"
        ? entry.destination.folder_prefix
        : null;
      if (rawFolder) {
        // Strip template variables ({{module_directory}} etc.) to get a
        // checkable prefix — take everything before the first {{ token.
        const staticPart = rawFolder.split("{{")[0].replace(/\/$/, "");
        if (staticPart && !dirExists(path.join(vaultPath, staticPart))) {
          findings.push({
            severity: "dead_path",
            path: `${bpName}#${entry.id || "<no-id>"}`,
            blueprint: bpName,
            message: `destination.folder_prefix "${staticPart}" does not resolve to an existing directory`,
          });
          counts.dead_path++;
          thisFailed = true;
        }
      }

      // body_template — check it resolves to a file under ranch/templates/
      if (typeof entry.body_template === "string" && entry.body_template.length > 0) {
        const tplAbs = path.join(vaultPath, TEMPLATES_REL, entry.body_template);
        if (!fileExists(tplAbs)) {
          findings.push({
            severity: "dead_path",
            path: `${bpName}#${entry.id || "<no-id>"}`,
            blueprint: bpName,
            message: `body_template "${entry.body_template}" does not resolve under ${TEMPLATES_REL}/`,
          });
          counts.dead_path++;
          thisFailed = true;
        }
      }

      if (thisFailed) { entryFailed++; } else { entryAligned++; }
    }

    // Count aligned only if the blueprint has declarations and no per-entry
    // severity was raised AND no New*Button helper was found (no escape hatch).
    const helperFound = helperFiles.some(hf => {
      try { return /class\s+New\w+Button\b/.test(fs.readFileSync(path.join(scriptDir, hf), "utf8")); }
      catch (e) { return false; }
    });
    if (declaredEntries.length > 0 && entryFailed === 0 && !helperFound) {
      counts.aligned += entryAligned;
    }
  }

  return { findings, counts };
}

module.exports = { walkEntityCreate };
