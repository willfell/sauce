// platform/engine/run.js — run lifecycle: resolve the vault from the note,
// parse + validate, mint a run id, seed the ledger, and build the ctx the
// scheduler ticks. The note is the unit of work; the run id is
// <note-slug>-<yyyymmdd-hhmmss>.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { parseGraphNote } = require('./graph.js');
const { validateGraph } = require('./validate.js');
const ledger = require('./ledger.js');
const state = require('./state.js');

class RunError extends Error {
  constructor(code, message) { super(message); this.name = 'RunError'; this.code = code; }
}

function expandHome(p) {
  if (typeof p !== 'string') return p;
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

function resolveVaultForNote(notePath) {
  let cur = path.dirname(path.resolve(notePath));
  while (cur !== path.dirname(cur)) {
    if (fs.existsSync(path.join(cur, 'ranch', 'platform-config.json'))) return cur;
    cur = path.dirname(cur);
  }
  return null;
}

function slugOf(notePath) {
  return path.basename(notePath, path.extname(notePath)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'graph';
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Two runs minted in the same second must not share a ledger; suffix the
// second and later ones so every run id maps to exactly one file.
function uniqueRunId(vault, base) {
  if (!fs.existsSync(ledger.runPath(vault, base))) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!fs.existsSync(ledger.runPath(vault, candidate))) return candidate;
  }
  throw new RunError('run_id_exhausted', `could not mint a unique run id for ${base}`);
}

function loadGraphNote(notePath) {
  if (!fs.existsSync(notePath)) throw new RunError('note_missing', `graph note not found: ${notePath}`);
  const parsed = parseGraphNote(fs.readFileSync(notePath, 'utf8'));
  const v = validateGraph(parsed.graph);
  if (!v.ok) throw new RunError('graph_invalid', `graph invalid: ${v.errors.map((e) => `${e.code}: ${e.message}`).join('; ')}`);
  return Object.assign(parsed, { entries: v.entries });
}

function repoFor(frontmatter, override) {
  const r = override || frontmatter.repo;
  if (!r) return null;
  const abs = path.resolve(expandHome(String(r)));
  if (!fs.existsSync(path.join(abs, '.git'))) throw new RunError('repo_missing', `repo is not a git checkout: ${abs}`);
  return abs;
}

function buildCtx({ vault, notePath, runId, parsed, repo, workerOverride, env, vars }) {
  return {
    // The names the graph's own vars: block declares. Only these are treated
    // as graph-authored text during substitution; everything else is a leaf.
    declaredVars: new Set(Object.keys((parsed.graph && parsed.graph.vars) || {})),
    vault,
    notePath: path.resolve(notePath),
    runId,
    runDir: ledger.runDir(vault, runId),
    graph: parsed.graph,
    repo,
    workerOverride: workerOverride || null,
    env: env || {},
    vars: vars || {},
  };
}

function createRun({ vault, notePath, repo, workerOverride, env, vars, now }) {
  const abs = path.resolve(notePath);
  const parsed = loadGraphNote(abs);
  const repoAbs = repoFor(parsed.frontmatter, repo);
  const runId = uniqueRunId(vault, `${slugOf(abs)}-${stamp(now || new Date())}`);
  const mergedVars = Object.assign({}, parsed.graph.vars || {}, vars || {});
  const graphHash = crypto.createHash('sha256').update(parsed.block).digest('hex').slice(0, 16);
  fs.mkdirSync(ledger.runDir(vault, runId), { recursive: true });
  ledger.appendEvent(vault, runId, {
    type: 'run.created', run_id: runId,
    graph_note: path.relative(vault, abs), graph_hash: graphHash, repo: repoAbs,
    vars: mergedVars, worker_override: workerOverride || null, host: os.hostname(),
  });
  const ctx = buildCtx({ vault, notePath: abs, runId, parsed, repo: repoAbs, workerOverride, env, vars: mergedVars });
  return { runId, ctx, parsed };
}

// Rebuild a ctx for an existing run (status, follow, resume after a park).
function openRun({ vault, notePath, runId, workerOverride, env }) {
  const abs = path.resolve(notePath);
  const parsed = loadGraphNote(abs);
  const events = ledger.readEvents(vault, runId);
  if (!events.length) throw new RunError('run_missing', `no ledger for run ${runId}`);
  const created = events.find((e) => e.type === 'run.created') || {};
  const ctx = buildCtx({ vault, notePath: abs, runId, parsed, repo: created.repo || null, workerOverride: workerOverride || created.worker_override || null, env, vars: created.vars || {} });
  return { runId, ctx, parsed, state: state.reduce(parsed.graph, events) };
}

function latestRunFor(vault, notePath) {
  const rel = path.relative(vault, path.resolve(notePath));
  const runs = ledger.listRuns(vault, { graph_note: rel });
  return runs.length ? runs[0] : null;
}

function dryRunPlan(parsed, repo) {
  return {
    ok: true,
    nodes: parsed.graph.nodes.map((n) => ({ id: n.id, type: n.type, worker: n.worker || null, isolate: n.type === 'agent' ? (n.isolate || (repo ? 'worktree' : 'none')) : null })),
    edges: parsed.graph.edges.map((e) => ({ from: e.from, to: e.to, on: e.on === undefined ? 'pass' : e.on, max: e.max === undefined ? null : e.max })),
    entries: parsed.entries,
    repo,
  };
}

module.exports = { createRun, openRun, latestRunFor, resolveVaultForNote, loadGraphNote, dryRunPlan, slugOf, RunError, expandHome };
