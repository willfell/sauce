#!/usr/bin/env node
// scripts/regen-cycle-status.js — v0.112.0 cycle-status auto-update.
//
// Rewrites `Docs/agent-guides/cycle-status.md § Current` to reflect the most
// recent `Docs/plans/*-result.md` + workshop_version pin. Idempotent.
//
// The file accrues drift fast — at v0.112.0 ship it claims v0.108.0 as
// current. This script is the forcing function that keeps it fresh.
//
// Modes:
//   default               apply the regen in-place
//   --check               dry-run; exit 1 if drift detected, 0 if in-sync
//   --current-only        only rewrite top entry; don't demote/insert history
//   --verbose             print the parsed snapshot + proposed diff
//
// Strategy: minimum-mutation. We never reshape historical entries; we only
//   (a) update the top `Workshop version:` line if the manifest moved AND
//   (b) demote the existing top entry into a `Workshop version (previous):`
//       row if its version differs from the new top.
// Anything older than the previous top is left verbatim.

const fs = require("fs");
const path = require("path");

const WORKSHOP = path.resolve(__dirname, "..");
const CYCLE_STATUS = path.join(WORKSHOP, "Docs/agent-guides/cycle-status.md");
const PLANS_DIR = path.join(WORKSHOP, "Docs/plans");
const MANIFEST = path.join(WORKSHOP, "platform/manifest.json");

// GA-D2: cycle-status.md is a live-state pointer file, not an archive. Anything
// that would push it past this cap belongs in Docs/cycle-history.md instead.
const MAX_BYTES = 15360;

const ARGS = new Set(process.argv.slice(2));
const CHECK = ARGS.has("--check");
const CURRENT_ONLY = ARGS.has("--current-only");
const VERBOSE = ARGS.has("--verbose");

function fatal(msg, code = 2) { process.stderr.write(`regen-cycle-status: ${msg}\n`); process.exit(code); }

// --------------------------------------------------------------------------- inputs
function readManifest() {
  if (!fs.existsSync(MANIFEST)) fatal("platform/manifest.json not found");
  try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")); }
  catch (e) { fatal(`could not parse manifest: ${e.message}`); }
}

function listResultDocs() {
  if (!fs.existsSync(PLANS_DIR)) return [];
  return fs.readdirSync(PLANS_DIR)
    .filter(f => /-result\.md$/.test(f))
    .sort((a, b) => b.localeCompare(a)); // DESC by filename (date prefix)
}

// Extract a one-sentence summary from a result doc. Looks for the first
// non-blank line under `## What shipped`, falls back to the H1 + cycle_arc.
function extractSummary(file) {
  const abs = path.join(PLANS_DIR, file);
  if (!fs.existsSync(abs)) return null;
  const body = fs.readFileSync(abs, "utf8");

  const cycleArc = (body.match(/^cycle_arc:\s*(.+)$/m) || [])[1] || "";
  const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : "";

  // Version label from frontmatter `cycle_arc:` OR filename
  let version = "";
  const fnVer = file.match(/v(\d+\.\d+\.\d+(?:\.\d+)?(?:-CF\d+)?)/);
  if (fnVer) version = fnVer[1];

  // "What shipped" first paragraph
  let shipped = "";
  const sec = body.match(/##\s*What shipped\s*\n+([\s\S]*?)(?=^##\s|\Z)/m);
  if (sec) {
    const para = sec[1].trim().split(/\n\s*\n/)[0] || "";
    shipped = para.replace(/\s+/g, " ").trim().slice(0, 600);
  }

  return { file, date, version, cycleArc: cycleArc.trim(), shipped };
}

// --------------------------------------------------------------------------- parse cycle-status
function parseCycleStatus(body) {
  // Locate `## Current` block boundaries (from `## Current` to next `## ` at same indent).
  const startIdx = body.search(/^##\s+Current\s*$/m);
  if (startIdx === -1) return null;
  const afterStart = body.slice(startIdx).split("\n").slice(1).join("\n");
  const nextHeaderIdx = afterStart.search(/^##\s+\S/m);
  const currentBody = nextHeaderIdx === -1 ? afterStart : afterStart.slice(0, nextHeaderIdx);

  // Extract the workshop_version pin from the FIRST line of the form
  // `- **Workshop version:** \`X.Y.Z\``
  const verLine = currentBody.match(/-\s+\*\*Workshop version:\*\*\s+`([\d.]+)`\s*(?:\(closed\s+(\d{4}-\d{2}-\d{2})\))?/);
  const currentVersion = verLine ? verLine[1] : null;
  const currentClosed = verLine ? (verLine[2] || "") : "";

  // Extract the "Most recent cycle:" prose that pairs with the top entry. The
  // prior format puts it on the next bullet line. We preserve it so when we
  // demote the top entry to a (previous) row we don't lose the summary.
  const recentLine = currentBody.match(/-\s+\*\*Most recent cycle:\*\*\s+([^\n]+)/);
  const currentRecent = recentLine ? recentLine[1].trim() : "";

  return {
    startIdx,
    endIdx: nextHeaderIdx === -1 ? body.length : startIdx + body.slice(startIdx).indexOf("\n") + 1 + nextHeaderIdx,
    currentBody,
    currentVersion,
    currentClosed,
    currentRecent,
  };
}

// --------------------------------------------------------------------------- emit new ## Current block
function emitCurrentBlock(manifest, latestResult, demoteFrom) {
  const wsVer = manifest.workshop_version;
  const closedDate = latestResult.date || "????-??-??";

  // Prefer the cycle_arc frontmatter as the one-liner summary; fall back to
  // the first paragraph of `## What shipped` if missing. The blockquote that
  // precedes `## Current` lives above this section in the file and should
  // NOT be re-emitted here.
  const summary = (latestResult.cycleArc && latestResult.cycleArc.length > 0)
    ? latestResult.cycleArc
    : (latestResult.shipped || "(no summary extracted)");
  const link = latestResult.file ? `See \`Docs/plans/${latestResult.file}\`.` : "";

  const lines = [];
  lines.push("## Current");
  lines.push("");
  lines.push(`- **Workshop version:** \`${wsVer}\` (closed ${closedDate})`);
  lines.push(`- **Most recent cycle:** ${summary} ${link}`.trim());
  lines.push("");
  // Re-emit any previous-version rows we want to preserve (verbatim).
  if (demoteFrom && demoteFrom.length > 0) {
    for (const row of demoteFrom) lines.push(row);
    lines.push("");
  }
  return lines.join("\n");
}

// Parse previously-current entries we want to keep verbatim (limit 8).
function preservedPreviousRows(currentBody) {
  const rows = [];
  const lines = currentBody.split("\n");
  for (const line of lines) {
    if (/^-\s+\*\*Workshop version \(previous\):\*\*/.test(line)) {
      rows.push(line);
      if (rows.length >= 12) break;
    }
  }
  return rows;
}

// --------------------------------------------------------------------------- main
function main() {
  if (!fs.existsSync(CYCLE_STATUS)) fatal("Docs/agent-guides/cycle-status.md not found");
  const body = fs.readFileSync(CYCLE_STATUS, "utf8");
  const parsed = parseCycleStatus(body);
  if (!parsed) fatal("could not locate `## Current` section");

  const manifest = readManifest();
  const results = listResultDocs();
  if (results.length === 0) fatal("no Docs/plans/*-result.md found");

  const latest = extractSummary(results[0]);
  if (!latest) fatal(`could not extract summary from ${results[0]}`);

  if (VERBOSE) {
    process.stderr.write(`current pin: ${parsed.currentVersion}\n`);
    process.stderr.write(`manifest pin: ${manifest.workshop_version}\n`);
    process.stderr.write(`latest result: ${latest.file}\n`);
    process.stderr.write(`latest result version: ${latest.version}\n`);
  }

  // Determine what changes are needed.
  const needsTopUpdate = parsed.currentVersion !== manifest.workshop_version;
  const needsCycleUpdate = !parsed.currentBody.includes(latest.file);
  if (!needsTopUpdate && !needsCycleUpdate) {
    if (CHECK) process.stdout.write(`in-sync: ${manifest.workshop_version} matches cycle-status\n`);
    else process.stdout.write(`no change: cycle-status already references ${manifest.workshop_version} + ${latest.file}\n`);
    process.exit(0);
  }

  // Build the new ## Current block.
  const previousRows = CURRENT_ONLY ? [] : preservedPreviousRows(parsed.currentBody);
  // If the prior top version differs, demote it to a new `(previous)` row at
  // top — and preserve its "Most recent cycle:" prose by appending it with the
  // canonical ` — ` separator that prior-version rows use.
  let demoteRow = null;
  if (!CURRENT_ONLY && parsed.currentVersion && parsed.currentVersion !== manifest.workshop_version) {
    const closedStr = parsed.currentClosed ? ` (closed ${parsed.currentClosed})` : "";
    const recentSuffix = parsed.currentRecent ? ` — ${parsed.currentRecent}` : "";
    demoteRow = `- **Workshop version (previous):** \`${parsed.currentVersion}\`${closedStr}${recentSuffix}`;
  }
  const finalPreviousRows = demoteRow ? [demoteRow, ...previousRows] : previousRows;

  const newBlock = emitCurrentBlock(manifest, latest, finalPreviousRows);

  // Splice: replace [startIdx .. endIdx] with newBlock + a blank line separator.
  const before = body.slice(0, parsed.startIdx);
  const after = body.slice(parsed.endIdx);
  const newBody = before + newBlock + "\n" + after;

  if (CHECK) {
    process.stderr.write(`DRIFT: cycle-status.md needs regen\n`);
    process.stderr.write(`  current pin: ${parsed.currentVersion || "(unparseable)"}\n`);
    process.stderr.write(`  manifest pin: ${manifest.workshop_version}\n`);
    process.stderr.write(`  latest result: ${latest.file}\n`);
    process.exit(1);
  }

  const newBytes = Buffer.byteLength(newBody, "utf8");
  if (newBytes > MAX_BYTES) {
    fatal(
      `refusing to write ${path.relative(WORKSHOP, CYCLE_STATUS)}: rewrite would be ${newBytes} bytes, over the ${MAX_BYTES}-byte cap. ` +
      `Trim '## Current' prose or move detail into Docs/cycle-history.md, then re-run.`
    );
  }

  fs.writeFileSync(CYCLE_STATUS, newBody);
  process.stdout.write(`regen-cycle-status: rewrote ${path.relative(WORKSHOP, CYCLE_STATUS)} (${newBytes} bytes) → ${manifest.workshop_version} (latest cycle ${latest.version || latest.file})\n`);
  process.exit(0);
}

main();
