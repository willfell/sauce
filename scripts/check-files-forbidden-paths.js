#!/usr/bin/env node
// v0.98.1 Safeguard 3: ensure no blueprint files[] dest path lands under
// user-owned territories. Fails CI if any dest matches:
//   context/<engagement-id>/    (per-engagement user content)
//   memory/                     (learned_weights, coverage-queue, feedback-deltas)
//   daily/, weekly/, monthly/   (atomic-note output)
//   snapshots/, summaries/      (runtime output state)
//
// engagement-templates/ and engagement-shared-templates/ + engagement-types/
// are EXEMPT — those ship default scaffolds. Per-engagement ID matches the
// forbidden pattern.

const fs = require("fs");
const path = require("path");

// Patterns are applied only to dest paths that do NOT contain {{scripts_path}},
// which is a Templater scripts infra path (e.g. {{scripts_path}}/daily/…) —
// not a user-content directory.
const FORBIDDEN_PATTERNS = [
  /\/context\/(?!engagement-templates\/|engagement-shared-templates\/|engagement-types\/|README\.md|user-preferences\.md|obsidian-vault-guide\.md|mcp-skill-map\.json)/,
  /\/memory(\/|$)/,
  /\/daily(\/|$)/,
  /\/weekly(\/|$)/,
  /\/monthly(\/|$)/,
  /\/snapshots(\/|$)/,
  /\/summaries(\/|$)/,
];

// Dest paths containing these placeholder prefixes are infrastructure paths,
// not user-content paths, and are exempt from the daily/weekly/monthly guards.
const INFRA_PREFIXES = ["{{scripts_path}}", "{{templater_scripts_path}}"];

const PLATFORM_DIR = path.join(__dirname, "..", "platform");
const failures = [];

function scanManifest(manifestPath) {
  let m;
  try {
    m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return; // not a JSON manifest
  }
  if (!Array.isArray(m.files)) return;
  for (const file of m.files) {
    if (typeof file.dest !== "string") continue;
    const isInfra = INFRA_PREFIXES.some((p) => file.dest.startsWith(p));
    for (const pat of FORBIDDEN_PATTERNS) {
      // Skip daily/weekly/monthly checks for infra (Templater scripts) paths
      const patStr = pat.toString();
      if (isInfra && (patStr.includes("/daily") || patStr.includes("/weekly") || patStr.includes("/monthly"))) continue;
      if (pat.test(file.dest)) {
        failures.push(`${manifestPath}: dest "${file.dest}" matches forbidden pattern ${pat}`);
      }
    }
  }
}

function walkBlueprints() {
  const blueprintsDir = path.join(PLATFORM_DIR, "blueprints");
  if (!fs.existsSync(blueprintsDir)) return;
  for (const bp of fs.readdirSync(blueprintsDir)) {
    const manifestPath = path.join(blueprintsDir, bp, "manifest.json");
    if (fs.existsSync(manifestPath)) scanManifest(manifestPath);
  }
}

walkBlueprints();

if (failures.length > 0) {
  console.error("Safeguard 3 FAILED — files[] forbidden-paths guard:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("Safeguard 3 OK — no blueprint files[] dest paths under user-owned territories.");
