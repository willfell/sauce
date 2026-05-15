// platform/audit/entity-create-walker.js — v0.46.0 S3 (S3 follow-up: C1/I1/I2/I4/I5)
//
// Walks every blueprint entry in ranch/platform-installed.json + every .js
// file under ranch/scripts/<blueprint>/ to surface entity-create modularization
// drift. Emits a 3-severity report:
//
//   - manual_implementation_at_risk (HIGH) — blueprint has a CustomJS class
//     whose body matches /class\s+New\w+Button\b/ (the New.*Button regex per
//     strategy doc) but no new_entity_buttons[] entry recorded in installed.json.
//     Either the blueprint hasn't migrated, or the migration is incomplete.
//
//   - escape_hatch_used (INFO) — blueprint has BOTH a new_entity_buttons[]
//     entry AND a CustomJS class matching New.*Button — the escape hatch is
//     engaged. Expected when intentional; demands a justification line in the
//     cycle design doc per Lego principle #2.
//
//   - dead_path (MEDIUM) — manifest entry has destination.folder_prefix that
//     doesn't resolve to an existing folder under spice/ at audit time, OR
//     body_template path doesn't resolve to a file under ranch/templates/, OR
//     extra_files[].body_template doesn't resolve under ranch/templates/.
//
// Plus two non-finding counters:
//   - aligned — blueprint has new_entity_buttons[] and all checks pass.
//   - unverifiable — entry whose folder_prefix is entirely a template variable
//     (e.g. "{{module_directory}}/items") so no static segment is checkable.
//     Distinguished from aligned to avoid silently inflating green counts.
//
// Read-surface posture (C1, v0.46.0 S3 follow-up): the walker reads each
// blueprint's new_entity_buttons[] declaration from ranch/platform-installed.json
// directly. The installer embeds the array into each blueprints[] entry at
// install time (single source of truth). The walker no longer attempts to
// re-read the source manifest from disk.
//
// "Not a sauce vault" posture (I1, v0.46.0 S3 follow-up): missing or malformed
// installed.json throws an Error with .exitCode = 2 instead of fabricating a
// dead_path finding. The CLI dispatcher catches and propagates the exit code,
// distinguishing "audit can't run" from "vault has dead path."
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

// v0.46.0 S3 follow-up (I2): hoist to module-level so we don't recompile the
// regex per file scan. Identical pattern to the strategy doc's New*Button rule.
const NEW_BUTTON_CLASS_RE = /class\s+(New\w+Button)\b/;

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
    unverifiable: 0,
  };

  // v0.46.0 S3 follow-up (I1): missing/malformed installed.json is a
  // "not a sauce vault" condition, not a finding. Throw exitCode=2 so the
  // CLI dispatcher (cmd-audit.js _runForTest) can distinguish this from
  // "vault exists but has dead paths."
  const installedAbs = path.join(vaultPath, INSTALLED_REL);
  if (!fileExists(installedAbs)) {
    throw Object.assign(
      new Error("Not a sauce vault: ranch/platform-installed.json missing — has the installer ever run?"),
      { exitCode: 2 }
    );
  }

  const installed = readJsonSafe(installedAbs);
  if (!installed || typeof installed !== "object") {
    throw Object.assign(
      new Error("Not a sauce vault: ranch/platform-installed.json malformed (parse failed)"),
      { exitCode: 2 }
    );
  }

  const blueprints = Array.isArray(installed.blueprints) ? installed.blueprints : [];

  for (const bp of blueprints) {
    const bpName = bp.name || "<unknown>";

    // v0.46.0 S3 follow-up (C1): single source of truth — the installer
    // embeds new_entity_buttons[] into each installed.json blueprints[]
    // entry at install time. No fallback to source manifest on disk.
    const declaredEntries = Array.isArray(bp.new_entity_buttons)
      ? bp.new_entity_buttons
      : [];
    const declaredIds = new Set(declaredEntries.map(e => e && e.id).filter(Boolean));

    // --- Rule 1 + Rule 2: scan helper .js files for New*Button classes ---
    // v0.46.0 S3 follow-up (I2): track helperFound in a single pass via let
    // flag; previously this required a second-pass file-read loop below.
    const scriptDir = path.join(vaultPath, SCRIPTS_REL, bpName);
    const helperFiles = dirExists(scriptDir)
      ? fs.readdirSync(scriptDir).filter(f => f.endsWith(".js"))
      : [];

    let helperFound = false;
    for (const hf of helperFiles) {
      let body = "";
      try { body = fs.readFileSync(path.join(scriptDir, hf), "utf8"); }
      catch (e) { continue; }

      const m = body.match(NEW_BUTTON_CLASS_RE);
      if (!m) continue;
      helperFound = true;
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
    let entryUnverifiable = 0;
    for (const entry of declaredEntries) {
      if (!entry || typeof entry !== "object") continue;
      let thisFailed = false;
      let thisUnverifiable = false;

      // destination.folder_prefix — check first static segment exists under vault.
      const rawFolder = entry.destination && typeof entry.destination.folder_prefix === "string"
        ? entry.destination.folder_prefix
        : null;
      if (rawFolder) {
        // Strip template variables ({{module_directory}} etc.) to get a
        // checkable prefix — take everything before the first {{ token.
        const staticPart = rawFolder.split("{{")[0].replace(/\/$/, "");
        if (staticPart === "") {
          // v0.46.0 S3 follow-up (I4): folder_prefix is entirely template;
          // no static segment is checkable. Mark unverifiable instead of
          // silently counting toward aligned.
          thisUnverifiable = true;
        } else if (!dirExists(path.join(vaultPath, staticPart))) {
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

      // v0.46.0 S3 follow-up (I5): also audit extra_files[].body_template
      // existence — same MEDIUM dead_path severity. Iterate even if the
      // primary body_template is missing/dead so all bad paths surface in
      // a single audit pass.
      for (const xf of (Array.isArray(entry.extra_files) ? entry.extra_files : [])) {
        if (!xf || typeof xf !== "object") continue;
        if (typeof xf.body_template !== "string" || xf.body_template.length === 0) continue;
        const xfAbs = path.join(vaultPath, TEMPLATES_REL, xf.body_template);
        if (!fileExists(xfAbs)) {
          findings.push({
            severity: "dead_path",
            path: `${bpName}#${entry.id || "<no-id>"}`,
            blueprint: bpName,
            message: `extra_files[].body_template "${xf.body_template}" does not resolve under ${TEMPLATES_REL}/`,
          });
          counts.dead_path++;
          thisFailed = true;
        }
      }

      if (thisFailed) {
        entryFailed++;
      } else if (thisUnverifiable) {
        entryUnverifiable++;
      } else {
        entryAligned++;
      }
    }

    // Count aligned only if the blueprint has declarations and no per-entry
    // severity was raised AND no New*Button helper was found (no escape hatch).
    // Unverifiable entries are tallied separately regardless of the helper
    // gate so they're surfaced even when an escape hatch is engaged.
    if (declaredEntries.length > 0 && entryFailed === 0 && !helperFound) {
      counts.aligned += entryAligned;
    }
    counts.unverifiable += entryUnverifiable;
  }

  return { findings, counts };
}

module.exports = { walkEntityCreate };
