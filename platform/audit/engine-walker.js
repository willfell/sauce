// platform/audit/engine-walker.js — `sauce audit --engine`: detection-only
// check that the engine mechanism's vault surface is installed and intact
// and that the run ledger under ranch/engine/runs/ is readable.
//
// Findings (severity):
//   engine_dir_missing        HIGH    ranch/engine/ absent
//   engine_surface_missing    HIGH    command / skill / template / README absent
//   engine_surface_stale      MEDIUM  deployed body differs from the workshop source
//   engine_version_drift      MEDIUM  installed engine version ≠ workshop catalogue
//   engine_ledger_unparsable  MEDIUM  a ledger line is not JSON
//   engine_worktree_orphan    LOW     a finished run references a worktree that no longer exists
//
// Read-only against the audited vault (landmine #21).
'use strict';

const fs = require('fs');
const path = require('path');

const SEVERITY = {
  engine_dir_missing: 'HIGH',
  engine_surface_missing: 'HIGH',
  engine_surface_stale: 'MEDIUM',
  engine_version_drift: 'MEDIUM',
  engine_ledger_unparsable: 'MEDIUM',
  engine_worktree_orphan: 'LOW',
};

const SURFACE = [
  { rel: '.claude/commands/sauce.md', source: 'platform/mechanisms/engine/commands/sauce.md' },
  { rel: '.claude/skills/engine/run/SKILL.md', source: 'platform/mechanisms/engine/skills/run/SKILL.md' },
  { rel: 'ranch/engine/README.md', source: 'platform/mechanisms/engine/ranch/README.md' },
];

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_e) { return null; }
}

function resolveWorkshop(vaultPath, explicit) {
  if (explicit) return explicit;
  const cfg = readJsonSafe(path.join(vaultPath, 'ranch', 'platform-config.json')) || {};
  const rel = cfg.workshop_path || cfg.workshop_relative_path || 'pantry';
  return path.isAbsolute(rel) ? rel : path.resolve(vaultPath, rel);
}

function templatesPath(vaultPath) {
  const cfg = readJsonSafe(path.join(vaultPath, 'ranch', 'platform-config.json')) || {};
  return (cfg.variables && cfg.variables.templates_path) || 'ranch/templates';
}

async function walkEngine(vaultPath, opts) {
  const findings = [];
  const add = (code, p, message) => findings.push({ code, severity: SEVERITY[code], path: p, message });
  const workshop = resolveWorkshop(vaultPath, opts && opts.workshopPath);

  const engineDir = path.join(vaultPath, 'ranch', 'engine');
  if (!fs.existsSync(engineDir)) add('engine_dir_missing', 'ranch/engine', 'run-state directory absent; run `sauce update` (the engine mechanism is always-on)');

  const surface = SURFACE.concat([{ rel: `${templatesPath(vaultPath)}/Sauce Graph.md`, source: 'platform/mechanisms/engine/templates/Sauce Graph.md' }]);
  for (const s of surface) {
    const deployed = path.join(vaultPath, s.rel);
    if (!fs.existsSync(deployed)) { add('engine_surface_missing', s.rel, 'expected engine surface file is absent; run `sauce update`'); continue; }
    const canonical = path.join(workshop, s.source);
    if (fs.existsSync(canonical) && fs.readFileSync(canonical, 'utf8') !== fs.readFileSync(deployed, 'utf8')) {
      add('engine_surface_stale', s.rel, 'deployed body differs from the workshop source; `sauce update` re-deploys it (use .claude/commands.local/ to shadow)');
    }
  }

  const installed = readJsonSafe(path.join(vaultPath, 'ranch', 'platform-installed.json'));
  const catalogue = readJsonSafe(path.join(workshop, 'platform', 'manifest.json'));
  const installedEngine = installed && Array.isArray(installed.mechanisms) ? installed.mechanisms.find((m) => m.name === 'engine') : null;
  const catalogueEngine = catalogue && Array.isArray(catalogue.mechanisms) ? catalogue.mechanisms.find((m) => m.name === 'engine') : null;
  if (installedEngine && catalogueEngine && installedEngine.version !== catalogueEngine.version) {
    add('engine_version_drift', 'ranch/platform-installed.json', `installed engine@${installedEngine.version}, workshop catalogue has ${catalogueEngine.version}; run \`sauce update --bump-pins\``);
  }

  const runsDir = path.join(engineDir, 'runs');
  let runsChecked = 0;
  if (fs.existsSync(runsDir)) {
    for (const f of fs.readdirSync(runsDir)) {
      if (!f.endsWith('.jsonl')) continue;
      runsChecked++;
      const rel = `ranch/engine/runs/${f}`;
      const lines = fs.readFileSync(path.join(runsDir, f), 'utf8').split('\n');
      const events = [];
      lines.forEach((line, i) => {
        if (!line.trim()) return;
        const last = i === lines.length - 1 || (i === lines.length - 2 && lines[lines.length - 1] === '');
        try { events.push(JSON.parse(line)); }
        catch (_e) { if (!last) add('engine_ledger_unparsable', rel, `line ${i + 1} is not JSON`); }
      });
      const ended = events.some((e) => e.type === 'run.ended' || e.type === 'run.halted');
      if (!ended) continue;
      const seen = new Set();
      for (const e of events) {
        const wt = e.type === 'node.finished' && e.result && e.result.worktree;
        if (!wt || seen.has(wt)) continue;
        seen.add(wt);
        if (!fs.existsSync(wt)) add('engine_worktree_orphan', rel, `finished run references a worktree that no longer exists: ${wt}`);
      }
    }
  }

  const counts = {};
  for (const code of Object.keys(SEVERITY)) counts[code] = 0;
  for (const f of findings) counts[f.code]++;
  return { findings, counts, runs_checked: runsChecked, workshop };
}

module.exports = { walkEngine, SEVERITY };
