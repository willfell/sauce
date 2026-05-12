// platform/mechanisms/audit/claude-surface-walker.js — v0.32.0 S7.A
//
// Walks ranch/claude-surface-registry.json + filesystem + claude_surface
// manifests to surface deployment drift. Emits a 4-level severity report:
//
//   - dead_path             registry entry's dest does NOT exist on FS
//   - orphan                FS has a .claude/commands or .claude/skills file
//                           the registry does NOT mention
//   - stale_but_valid       file body has @claude-surface:version comment
//                           that disagrees with the registry entry version
//   - consumer_edit_at_risk deployed body differs from blueprint source AND
//                           no matching .local/ shadow protects the edit
//                           (only attempted when workshopPath provided)
//
// Plus a count of `aligned` entries (no severity raised). No per-row finding
// is emitted for aligned — count only.
//
// Pure node module. No Obsidian dependency. Uses node fs directly so it
// is callable from cmd-audit.js (which never reaches into tp.app).

"use strict";

const fs = require("fs");
const path = require("path");

const REGISTRY_REL = "ranch/claude-surface-registry.json";
const CLAUDE_CMD_REL = ".claude/commands";
const CLAUDE_SKILL_REL = ".claude/skills";
const CLAUDE_CMD_LOCAL_REL = ".claude/commands.local";
const CLAUDE_SKILL_LOCAL_REL = ".claude/skills.local";

// Match  <!-- @claude-surface:version X.Y.Z -->  with flexible whitespace.
const VERSION_COMMENT_RE = /<!--\s*@claude-surface:version\s+([^\s>]+)\s*-->/;

function readJsonSafe(absPath) {
  try {
    const raw = fs.readFileSync(absPath, "utf8");
    return JSON.parse(raw);
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

// Recursive walk: return vault-relative paths of all .md files under <vault>/<relRoot>.
function walkMd(vaultPath, relRoot) {
  const out = [];
  const absRoot = path.join(vaultPath, relRoot);
  if (!dirExists(absRoot)) return out;
  function recurse(absDir) {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
    catch (e) { return; }
    for (const e of entries) {
      const abs = path.join(absDir, e.name);
      if (e.isDirectory()) recurse(abs);
      else if (e.isFile() && e.name.endsWith(".md")) {
        const rel = path.relative(vaultPath, abs).split(path.sep).join("/");
        out.push(rel);
      }
    }
  }
  recurse(absRoot);
  return out;
}

// Walk a candidate blueprint/mechanism source for the entry. Owners can live
// under platform/mechanisms/<name> or platform/blueprints/<name>. Returns
// the absolute source path (workshop) or null.
function resolveOwnerSourcePath(workshopPath, owner, sourceRel) {
  if (!workshopPath || !owner || !sourceRel) return null;
  const candidates = [
    path.join(workshopPath, "platform/mechanisms", owner, sourceRel),
    path.join(workshopPath, "platform/blueprints", owner, sourceRel),
  ];
  for (const c of candidates) {
    if (fileExists(c)) return c;
  }
  return null;
}

// Map a deployed dest to its .local/ shadow path (vault-relative).
// `.claude/commands/foo.md`            → `.claude/commands.local/foo.md`
// `.claude/skills/<dir>/<x>/SKILL.md`  → `.claude/skills.local/<dir>/<x>/SKILL.md`
function localShadowFor(destRel) {
  if (destRel.startsWith(CLAUDE_CMD_REL + "/")) {
    return CLAUDE_CMD_LOCAL_REL + destRel.slice(CLAUDE_CMD_REL.length);
  }
  if (destRel.startsWith(CLAUDE_SKILL_REL + "/")) {
    return CLAUDE_SKILL_LOCAL_REL + destRel.slice(CLAUDE_SKILL_REL.length);
  }
  return null;
}

async function walkClaudeSurface(vault, options) {
  options = options || {};
  const workshopPath = options.workshopPath || null;
  const findings = [];
  const counts = {
    dead_path: 0,
    orphan: 0,
    stale_but_valid: 0,
    consumer_edit_at_risk: 0,
    aligned: 0,
  };

  // (1) Read registry. Missing → single dead_path finding.
  const registryAbs = path.join(vault, REGISTRY_REL);
  if (!fileExists(registryAbs)) {
    findings.push({
      severity: "dead_path",
      kind: "registry",
      path: REGISTRY_REL,
      message: "claude-surface registry missing — has the installer ever run?",
    });
    counts.dead_path = 1;
    return { findings, counts };
  }
  const registry = readJsonSafe(registryAbs);
  if (!registry || typeof registry !== "object" || !registry.contributions) {
    findings.push({
      severity: "dead_path",
      kind: "registry",
      path: REGISTRY_REL,
      message: "claude-surface registry malformed (parse failed or missing contributions[])",
    });
    counts.dead_path = 1;
    return { findings, counts };
  }

  // Build a Set of file-kind dests for orphan detection.
  const knownDests = new Set();

  // (2) + (4) + (5) — for each registry entry: dead_path, stale_but_valid,
  // consumer_edit_at_risk.
  for (const [owner, contributions] of Object.entries(registry.contributions)) {
    if (!Array.isArray(contributions)) continue;
    for (const entry of contributions) {
      if (!entry || typeof entry !== "object") continue;
      const kind = entry.kind;

      if (kind === "command" || kind === "skill" || kind === "context_doc") {
        if (typeof entry.dest !== "string") continue;
        const destRel = entry.dest;
        knownDests.add(destRel);
        const destAbs = path.join(vault, destRel);
        if (!fileExists(destAbs)) {
          findings.push({
            severity: "dead_path",
            kind,
            path: destRel,
            owner,
            message: `${owner} claude_surface entry dest "${destRel}" not found on disk`,
          });
          counts.dead_path++;
          continue;
        }

        // Read deployed body for the next two severity checks.
        let body = "";
        try { body = fs.readFileSync(destAbs, "utf8"); }
        catch (e) { body = ""; }

        // (4) stale_but_valid — embedded version comment disagrees with registry version
        let staleRaised = false;
        if (typeof entry.version === "string" && entry.version.length > 0) {
          const m = body.match(VERSION_COMMENT_RE);
          if (m && m[1] && m[1] !== entry.version) {
            findings.push({
              severity: "stale_but_valid",
              kind,
              path: destRel,
              owner,
              expected: entry.version,
              found: m[1],
              message: `${destRel} body version comment "${m[1]}" disagrees with registry "${entry.version}"`,
            });
            counts.stale_but_valid++;
            staleRaised = true;
          }
        }

        // (5) consumer_edit_at_risk — deployed body differs from source, no .local/ shadow.
        // Requires workshopPath AND entry.source.
        let cearRaised = false;
        if (!staleRaised && workshopPath && typeof entry.source === "string" && entry.source.length > 0) {
          const sourceAbs = resolveOwnerSourcePath(workshopPath, owner, entry.source);
          if (sourceAbs) {
            let sourceBody = "";
            try { sourceBody = fs.readFileSync(sourceAbs, "utf8"); }
            catch (e) { sourceBody = null; }
            // Compare raw bodies. Note: deployed body may have substituteLenient
            // applied — we only flag if they differ; the .local/ shadow check
            // is the safety valve for substitution-induced false positives
            // because the shim writes EXACT consumer content over the dest.
            if (sourceBody !== null && sourceBody !== body) {
              const shadowRel = localShadowFor(destRel);
              const shadowAbs = shadowRel ? path.join(vault, shadowRel) : null;
              if (!shadowAbs || !fileExists(shadowAbs)) {
                findings.push({
                  severity: "consumer_edit_at_risk",
                  kind,
                  path: destRel,
                  owner,
                  source: entry.source,
                  message: `${destRel} body differs from workshop source and no .local/ shadow protects it — next install will overwrite`,
                });
                counts.consumer_edit_at_risk++;
                cearRaised = true;
              }
            }
          }
        }

        if (!staleRaised && !cearRaised) {
          counts.aligned++;
        }
      } else if (kind === "claude_md_row") {
        // (2) row-kind dead_path: row.path resolution check.
        const row = entry.row && typeof entry.row === "object" ? entry.row : null;
        if (!row || typeof row.path !== "string") {
          counts.aligned++;
          continue;
        }
        // row.path may be a directory ref (e.g. "platform-claude") or a
        // file ref. Accept either: dir exists OR file exists OR matching
        // sibling .md file under spice/... — we keep this lenient (the
        // CLAUDE.md table just resolves topic→pointer for humans).
        const rowAbs = path.join(vault, row.path);
        const dirAt = dirExists(rowAbs);
        const fileAt = fileExists(rowAbs);
        const mdAt = fileExists(rowAbs + ".md");
        if (!dirAt && !fileAt && !mdAt) {
          findings.push({
            severity: "dead_path",
            kind: "claude_md_row",
            path: row.path,
            owner,
            table: entry.table,
            message: `${owner} claude_md_row.row.path "${row.path}" not found (neither dir nor .md)`,
          });
          counts.dead_path++;
        } else {
          counts.aligned++;
        }
      }
    }
  }

  // (3) Orphan scan — walk .claude/commands and .claude/skills, find
  // anything the registry does not list. .commands.local + .skills.local
  // are excluded — those are consumer overrides, not orphans.
  const cmdFiles = walkMd(vault, CLAUDE_CMD_REL);
  for (const rel of cmdFiles) {
    if (!knownDests.has(rel)) {
      findings.push({
        severity: "orphan",
        kind: "command",
        path: rel,
        message: `${rel} exists on disk but no registry entry claims it — orphaned file from a removed subscription?`,
      });
      counts.orphan++;
    }
  }
  const skillFiles = walkMd(vault, CLAUDE_SKILL_REL);
  for (const rel of skillFiles) {
    if (!knownDests.has(rel)) {
      findings.push({
        severity: "orphan",
        kind: "skill",
        path: rel,
        message: `${rel} exists on disk but no registry entry claims it — orphaned file from a removed subscription?`,
      });
      counts.orphan++;
    }
  }

  return { findings, counts };
}

module.exports = { walkClaudeSurface };
