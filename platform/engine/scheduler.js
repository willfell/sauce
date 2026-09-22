// platform/engine/scheduler.js — tick a run: replay the ledger, honour a
// halt, run every ready node to completion, fire edges, park on a human
// node, end the run when an outcome has nowhere to go. `follow` repeats
// ticks, re-reading the note for human answers between them.
'use strict';

const ledger = require('./ledger.js');
const state = require('./state.js');
const { runNode } = require('./nodes.js');
const projection = require('./projection.js');

function nodeById(graph, id) { return graph.nodes.find((n) => n.id === id); }

function applyHumanAnswers(ctx, current) {
  if (current.status !== 'parked' || !current.parked) return null;
  const answers = projection.readHumanAnswersFromNote(ctx.notePath);
  const a = answers.find((x) => x.runId === ctx.runId && x.node === current.parked.node && x.checked);
  if (!a) return null;
  const outcome = a.decision || 'pass';
  ledger.appendEvent(ctx.vault, ctx.runId, { type: 'human.answered', node: a.node, outcome, result: { summary: `answered ${outcome} in the note`, artifacts: [], head: null, vars: {} } });
  return { node: a.node, outcome };
}

function endRun(ctx, outcome, node) {
  const status = state.finalStatusFor(outcome);
  ledger.appendEvent(ctx.vault, ctx.runId, { type: 'run.ended', status, outcome, node });
  return status;
}

function tick(ctx) {
  const graph = ctx.graph;
  const events = ledger.readEvents(ctx.vault, ctx.runId);
  let current = state.reduce(graph, events);
  const executed = [];

  if (state.isTerminal(current)) return receipt(ctx, current, executed);
  if (projection.isHalted(ctx.notePath)) {
    ledger.appendEvent(ctx.vault, ctx.runId, { type: 'run.halted' });
    current = state.reduce(graph, ledger.readEvents(ctx.vault, ctx.runId));
    projection.writeProjection(ctx.notePath, current, graph);
    return receipt(ctx, current, executed);
  }
  if (current.status === 'parked') {
    const answer = applyHumanAnswers(ctx, current);
    if (!answer) return receipt(ctx, current, executed);
    current = state.reduce(graph, ledger.readEvents(ctx.vault, ctx.runId));
    routeOutcome(ctx, graph, current, answer.node, answer.outcome);
    current = state.reduce(graph, ledger.readEvents(ctx.vault, ctx.runId));
  }

  let guard = 0;
  while (!state.isTerminal(current) && current.status !== 'parked') {
    const ready = state.readyNodes(graph, current);
    if (!ready.length) { endRun(ctx, 'fail', null); break; }
    if (++guard > 10000) { endRun(ctx, 'fail', null); break; }
    const id = ready[0];
    const node = nodeById(graph, id);
    const attempt = (current.nodes[id].attempts || 0) + 1;
    ledger.appendEvent(ctx.vault, ctx.runId, { type: 'node.started', node: id, attempt });
    current = state.reduce(graph, ledger.readEvents(ctx.vault, ctx.runId));
    let res;
    try { res = runNode(Object.assign({}, ctx, { state: current }), node); }
    catch (e) { res = { outcome: 'fail', result: { summary: `engine error: ${e.message}`, artifacts: [], head: null, vars: {} } }; }
    executed.push({ node: id, attempt, outcome: res.outcome });
    if (node.type === 'human') {
      ledger.appendEvent(ctx.vault, ctx.runId, { type: 'run.parked', node: id, ask: res.result.summary });
      current = state.reduce(graph, ledger.readEvents(ctx.vault, ctx.runId));
      break;
    }
    ledger.appendEvent(ctx.vault, ctx.runId, { type: 'node.finished', node: id, attempt, outcome: res.outcome, result: res.result });
    current = state.reduce(graph, ledger.readEvents(ctx.vault, ctx.runId));
    routeOutcome(ctx, graph, current, id, res.outcome);
    current = state.reduce(graph, ledger.readEvents(ctx.vault, ctx.runId));
  }
  projection.writeProjection(ctx.notePath, current, graph);
  return receipt(ctx, current, executed);
}

// Fire the edges an outcome selects; an exhausted budget re-routes once as
// `exhausted`; an outcome with nowhere to go ends the run.
function routeOutcome(ctx, graph, current, nodeId, outcome) {
  let m = state.matchEdges(graph, current, nodeId, outcome);
  if (!m.fired.length && m.exhausted.length) {
    m = state.matchEdges(graph, current, nodeId, 'exhausted');
    if (!m.fired.length) { endRun(ctx, 'exhausted', nodeId); return; }
  }
  if (!m.fired.length) { endRun(ctx, outcome, nodeId); return; }
  for (const e of m.fired) ledger.appendEvent(ctx.vault, ctx.runId, { type: 'edge.fired', from: e.from, to: e.to, on: e.on === undefined ? 'pass' : e.on });
}

function receipt(ctx, current, executed) {
  const nodes = {};
  for (const [id, n] of Object.entries(current.nodes)) nodes[id] = n.status === 'finished' ? n.outcome : n.status;
  const worktrees = Object.values(current.results || {}).map((r) => r && r.worktree).filter(Boolean);
  return { ok: current.status !== 'failed', run_id: ctx.runId, status: current.status, final_outcome: current.final_outcome, nodes, parked: current.parked, executed, ledger: ledger.runPath(ctx.vault, ctx.runId), worktrees, vars: current.vars };
}

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function follow(ctx, options) {
  const opts = options || {};
  const intervalMs = Math.max(1000, (opts.intervalSeconds || 30) * 1000);
  const deadline = Date.now() + Math.max(1, opts.maxMinutes || 24 * 60) * 60 * 1000;
  let r = tick(ctx);
  while ((r.status === 'running' || r.status === 'parked') && Date.now() < deadline) {
    if (opts.onParked && r.status === 'parked') opts.onParked(r);
    if (typeof opts.beforeSleep === 'function' && opts.beforeSleep(r) === false) break;
    sleepSync(intervalMs);
    r = tick(ctx);
  }
  return r;
}

module.exports = { tick, follow, applyHumanAnswers };
