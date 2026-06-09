// platform/mechanisms/cowork-reconciler/reconciler-log.js
//
// Append-only reconciler log at:
//   <vault>/spice/cowork/context/reconciler-log.md
//
// Capped at MAX_ENTRIES (30 default). Newest entry on top.

const fs = require("node:fs");
const path = require("node:path");

const MAX_ENTRIES = 30;
const _MAX_ENTRIES = MAX_ENTRIES; // alias for tests that look at the underscored name

const LOG_REL = "spice/cowork/context/reconciler-log.md";

function _formatEntry(timestamp, summary) {
  const ts = timestamp.toISOString().slice(0, 16).replace("T", " ");
  const lines = [`## ${ts} (run-id: rl-${timestamp.getTime()})`];
  for (const eng of (summary && summary.engagements_processed) || []) {
    lines.push("");
    lines.push(`### ${eng.engagement_id}`);
    lines.push(`- Sidecars backfilled: ${eng.sidecars_backfilled || 0}`);
    lines.push(`- Sidecars validated: ${eng.sidecars_validated || 0}`);
    const lwKinds = Object.entries(eng.learned_weights_delta || {});
    if (lwKinds.length > 0) {
      lines.push("- learned_weights deltas:");
      for (const [kind, d] of lwKinds) {
        lines.push(`  - ${kind}: ${d.before} -> ${d.after}`);
      }
    } else {
      lines.push("- learned_weights: no deltas");
    }
    if (eng.heartbeat && eng.heartbeat.missed_count > 0) {
      lines.push(`- heartbeat: ${eng.heartbeat.missed_count} missed cadences`);
    } else if (eng.heartbeat) {
      lines.push("- heartbeat: GREEN");
    }
  }
  return lines.join("\n");
}

function _splitEntries(content) {
  if (!content) return [];
  const entries = [];
  const sections = content.split(/^## /m).slice(1);
  for (const s of sections) entries.push({ body: `## ${s}`.trimEnd() });
  return entries;
}

function _composeLogFile(entries) {
  const header =
    "---\n" +
    "type: cowork-reconciler-log\n" +
    "---\n\n" +
    "# Reconciler log\n\n";
  return header + entries.map((e) => e.body).join("\n\n") + "\n";
}

function appendEntry(opts) {
  const { vault_path, summary } = opts || {};
  if (!vault_path) throw new Error("appendEntry: vault_path required");
  const logPath = path.join(vault_path, LOG_REL);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const existing = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  const now = new Date();
  const entry = _formatEntry(now, summary || {});
  const entries = _splitEntries(existing);
  entries.unshift({ body: entry });
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  fs.writeFileSync(logPath, _composeLogFile(entries), "utf8");
}

module.exports = {
  appendEntry,
  MAX_ENTRIES,
  _MAX_ENTRIES,
  _formatEntry,
  _splitEntries,
  _composeLogFile,
  LOG_REL,
};
