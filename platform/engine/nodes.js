// platform/engine/nodes.js — execute one node to completion and return its
// outcome. Every node type reduces to { outcome, result }; the scheduler
// owns the ledger and the edges, this file owns the side effects of a step.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const vars = require('./vars.js');
const workers = require('./workers/index.js');
const isolation = require('./isolation.js');

const GATE_JS = path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'gate.js');
const DEFAULT_TIMEOUT_S = 3600;

function expandHome(p) {
  if (typeof p !== 'string') return p;
  return p.startsWith('~/') ? path.join(require('os').homedir(), p.slice(2)) : p;
}

function subCtx(ctx, node) {
  return {
    run: { id: ctx.runId, dir: ctx.runDir },
    vars: ctx.state.vars || {},
    results: ctx.state.results || {},
    node: { id: node.id },
    declaredVars: ctx.declaredVars || new Set(),
    runtimeVars: (ctx.state && ctx.state.runtime_vars) || new Set(),
  };
}

function nodeDir(ctx, node) {
  const d = path.join(ctx.runDir, node.id);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function attemptOf(ctx, node) {
  const n = ctx.state.nodes && ctx.state.nodes[node.id];
  return n && n.attempts ? n.attempts : 1;
}

// Where a node runs: explicit cwd (after substitution) > a worktree when
// isolate: worktree and a repo is known > the repo root > the vault.
function resolveCwd(ctx, node, sctx) {
  if (typeof node.cwd === 'string' && node.cwd.trim()) return { cwd: path.resolve(expandHome(vars.substitute(node.cwd, sctx))), worktree: null };
  const repo = ctx.repo ? path.resolve(expandHome(ctx.repo)) : null;
  const wantsWorktree = node.type === 'agent' && (node.isolate === 'worktree' || (node.isolate === undefined && !!repo));
  if (wantsWorktree && repo) {
    const slug = `${ctx.runId}-${node.id}`;
    const dest = path.join(repo, '.worktrees', 'sauce', slug);
    const branch = `sauce/${slug}`;
    const upstreamHead = upstreamHeadFor(ctx, node);
    const wt = isolation.createWorktree({ repo, dest, branch, base: upstreamHead || isolation.defaultBase(repo) });
    return { cwd: wt.path, worktree: wt.path, branch: wt.branch };
  }
  return { cwd: repo || ctx.vault, worktree: null };
}

// On a handoff, start from the upstream node's committed head when it has one.
function upstreamHeadFor(ctx, node) {
  for (const e of ctx.graph.edges || []) {
    if (e.to !== node.id) continue;
    const r = ctx.state.results && ctx.state.results[e.from];
    if (r && typeof r.head === 'string' && /^[0-9a-f]{7,40}$/.test(r.head)) return r.head;
  }
  return null;
}

function upstreamContext(ctx, node) {
  const lines = [];
  for (const e of ctx.graph.edges || []) {
    if (e.to !== node.id) continue;
    const r = ctx.state.results && ctx.state.results[e.from];
    if (!r) continue;
    lines.push(`### From node \`${e.from}\` (outcome: ${ctx.state.nodes[e.from] ? ctx.state.nodes[e.from].outcome : 'unknown'})`);
    if (r.summary) lines.push('', r.summary.trim());
    if (r.head) lines.push('', `Head: ${r.head}`);
    if (Array.isArray(r.artifacts) && r.artifacts.length) lines.push('', 'Artifacts:', ...r.artifacts.map((a) => `- ${a}`));
    lines.push('');
  }
  return lines.length ? ['', '## Handoff context', '', ...lines].join('\n') : '';  // lint-display-markers:allow heading inside a worker prompt, not a rendered note anchor
}

function runAgent(ctx, node) {
  const sctx = subCtx(ctx, node);
  const dir = nodeDir(ctx, node);
  const attempt = attemptOf(ctx, node);
  const workerName = ctx.workerOverride || node.worker;
  const worker = workers.resolveWorker(workerName);
  const { cwd, worktree, branch } = resolveCwd(ctx, node, sctx);
  const resultPath = path.join(dir, 'result.json');
  const stdoutPath = path.join(dir, 'stdout.log');
  if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath);
  const prompt = vars.substitute(node.prompt, sctx) + upstreamContext(ctx, node) + workers.promptTail(resultPath);
  fs.writeFileSync(path.join(dir, 'prompt.md'), prompt);
  const timeoutMs = (Number.isInteger(node.timeout) ? node.timeout : DEFAULT_TIMEOUT_S) * 1000;
  const r = worker.run({ node, attempt, prompt, cwd, timeoutMs, resultPath, stdoutPath, env: ctx.env || {} });
  const result = workers.readResult(resultPath);
  const meta = { worker: workerName, attempt, cwd, worktree: worktree || null, branch: branch || null, exit_code: r.exitCode, timed_out: !!r.timedOut };
  if (!result) {
    const why = r.timedOut ? `worker timed out after ${timeoutMs / 1000}s` : r.error ? `worker failed to start: ${r.error}` : `worker exited ${r.exitCode} without publishing result.json`;
    return { outcome: 'fail', result: Object.assign({ summary: why, artifacts: [], head: null, vars: {} }, meta) };
  }
  return { outcome: result.outcome, result: Object.assign({}, result, meta) };
}

function runCommand(ctx, node, command) {
  const sctx = subCtx(ctx, node);
  const dir = nodeDir(ctx, node);
  const { cwd } = resolveCwd(ctx, Object.assign({}, node, { isolate: 'none' }), sctx);
  const cmd = vars.substituteShell(command, sctx);
  fs.writeFileSync(path.join(dir, 'command.txt'), cmd + '\n');
  const timeoutMs = (Number.isInteger(node.timeout) ? node.timeout : DEFAULT_TIMEOUT_S) * 1000;
  const r = spawnSync(cmd, { shell: true, cwd, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, ctx.env || {}, { SAUCE_VAULT: ctx.vault, SAUCE_RUN_ID: ctx.runId, SAUCE_NODE_ID: node.id }) });
  fs.appendFileSync(path.join(dir, 'stdout.log'), `$ ${cmd}\n${r.stdout || ''}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}\n`);
  return { cmd, cwd, exit_code: r.status === null ? -1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '', timed_out: !!r.error && r.error.code === 'ETIMEDOUT' };
}

function runJudge(ctx, node) {
  const command = node.gate === 'adequacy'
    ? `node ${vars.shellQuote(GATE_JS)} verify-adequacy --base ${vars.shellQuote(ctx.baseRef || 'origin/main')} --cwd ${vars.shellQuote(resolveCwd(ctx, Object.assign({}, node, { isolate: 'none' }), subCtx(ctx, node)).cwd)} --json`
    : node.run;
  const r = runCommand(ctx, node, command);
  const outcome = r.exit_code === 0 ? 'pass' : 'fail';
  return { outcome, result: { summary: `${outcome}: exit ${r.exit_code}${r.timed_out ? ' (timed out)' : ''}`, exit_code: r.exit_code, stdout: r.stdout.slice(-4000), stderr: r.stderr.slice(-4000), artifacts: [], head: null, vars: {} } };
}

function pick(obj, dotted) {
  let cur = obj;
  for (const p of String(dotted).split('.')) { if (cur === null || typeof cur !== 'object' || !(p in cur)) return undefined; cur = cur[p]; }
  return cur;
}

function runShell(ctx, node) {
  const r = runCommand(ctx, node, node.run);
  let receipt = null, outcome = r.exit_code === 0 ? 'pass' : 'fail';
  let summary = `exit ${r.exit_code}`;
  if (node.capture === 'json') {
    const text = r.stdout.trim();
    const start = text.indexOf('{');
    try { receipt = JSON.parse(start >= 0 ? text.slice(start) : text); }
    catch (_e) { receipt = null; if (r.exit_code === 0) { outcome = 'fail'; summary = 'exit 0 but stdout was not JSON'; } }
  }
  if (node.outcome_from && receipt) {
    const v = pick(receipt, node.outcome_from);
    if (typeof v === 'string' && /^[a-z][a-z0-9-]*$/.test(v)) { outcome = v; summary = `${node.outcome_from}=${v}`; }
    else if (r.exit_code === 0) { outcome = 'fail'; summary = `receipt has no usable "${node.outcome_from}"`; }
  }
  if (typeof node.outcome === 'string' && node.outcome && r.exit_code === 0) {
    const v = vars.substitute(node.outcome, subCtx(ctx, node)).trim();
    if (/^[a-z][a-z0-9-]*$/.test(v)) { outcome = v; summary = `outcome=${v}`; }
    else { outcome = 'fail'; summary = `outcome expression produced "${v}", not a valid outcome`; }
  }
  const capturedVars = receipt && node.vars_from && typeof node.vars_from === 'object'
    ? Object.fromEntries(Object.entries(node.vars_from).map(([k, p]) => [k, pick(receipt, p)]).filter(([, v]) => v !== undefined))
    : {};
  return { outcome, result: { summary, exit_code: r.exit_code, stdout: r.stdout.slice(-4000), stderr: r.stderr.slice(-4000), receipt, artifacts: [], head: null, vars: capturedVars } };
}

function runNode(ctx, node) {
  switch (node.type) {
    case 'agent': return runAgent(ctx, node);
    case 'judge': return runJudge(ctx, node);
    case 'shell': return runShell(ctx, node);
    case 'human': return { outcome: 'parked', result: { summary: vars.substitute(node.ask, subCtx(ctx, node)), artifacts: [], head: null, vars: {} } };
    case 'end': return { outcome: typeof node.outcome === 'string' && node.outcome ? node.outcome : node.id, result: { summary: `end ${node.id}`, artifacts: [], head: null, vars: {} } };
    default: throw new Error(`unknown node type "${node.type}"`);
  }
}

module.exports = { runNode, resolveCwd, GATE_JS };
