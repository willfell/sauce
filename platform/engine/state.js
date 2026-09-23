// platform/engine/state.js — pure reducer from ledger events to run state,
// plus the edge-matching rule. No I/O.
'use strict';

const { entryNodes } = require('./validate.js');

const TERMINAL = new Set(['done', 'failed', 'halted']);

// An edge's budget counter. Edges naming the same budget share one counter,
// so "one repair per card" is expressible across several gates instead of
// one-per-edge (six gates each with max:1 is six repairs, not one).
function edgeKey(e) { return e && typeof e.budget === 'string' && e.budget ? `budget:${e.budget}` : `${e.from}->${e.to}`; }

// The key an edge.fired event counts under. The event carries its own
// budget (written since budgets shipped); older events are resolved against
// the graph so a ledger written before that still replays correctly.
function eventEdgeKey(graph, e) {
  if (typeof e.budget === 'string' && e.budget) return `budget:${e.budget}`;
  const on = e.on === undefined ? 'pass' : e.on;
  const edge = (graph.edges || []).find((x) => x.from === e.from && x.to === e.to && (x.on === undefined ? 'pass' : x.on) === on);
  return edgeKey(edge || e);
}

function initial(graph, created) {
  const nodes = {};
  for (const n of graph.nodes) nodes[n.id] = { status: 'idle', attempts: 0, outcome: null, result: null };
  return {
    run_id: created.run_id || null,
    graph_note: created.graph_note || null,
    repo: created.repo || null,
    status: 'running',
    nodes,
    edge_counts: {},
    ready: entryNodes(graph),
    parked: null,
    vars: Object.assign({}, created.vars || {}),
    // Names a RUN replaced with data from outside any author: a vars_from
    // capture off a receipt, or a worker's result vars. Substitution treats
    // these as leaves whatever the graph's vars: block declares. A --var the
    // operator typed is author-supplied and lives in cli_vars instead.
    runtime_vars: new Set(),
    cli_vars: new Set(Object.keys(created.cli_vars || {})),
    results: {},
    started_at: created.ts || null,
    ended_at: null,
    final_outcome: null,
    // Terminal is a fact the ledger records, never inferred from the status
    // string: an end node may be named 'parked' (or any other reserved word)
    // and that must still end the run.
    terminal: false,
  };
}

function reduce(graph, events) {
  const created = events.find((e) => e.type === 'run.created') || {};
  const s = initial(graph, created);
  const known = new Set(Object.keys(s.nodes));
  for (const e of events) {
    switch (e.type) {
      case 'run.created': break;
      case 'node.started': {
        if (!known.has(e.node)) break;
        const n = s.nodes[e.node];
        n.status = 'running'; n.attempts += 1; n.outcome = null;
        s.ready = s.ready.filter((id) => id !== e.node);
        break;
      }
      case 'node.finished': {
        if (!known.has(e.node)) break;
        const n = s.nodes[e.node];
        if (n.status !== 'running') break; // a finish we never saw start: ignored
        n.status = 'finished'; n.outcome = e.outcome; n.result = e.result || null;
        s.results[e.node] = e.result || null;
        if (e.result && e.result.vars && typeof e.result.vars === 'object') {
          Object.assign(s.vars, e.result.vars);
          for (const k of Object.keys(e.result.vars)) s.runtime_vars.add(k);
        }
        break;
      }
      case 'edge.fired': {
        // Count under the SAME key matchEdges reads, or a shared budget is
        // incremented under one name and checked under another, and the
        // budget never exhausts.
        const k = eventEdgeKey(graph, e);
        s.edge_counts[k] = (s.edge_counts[k] || 0) + 1;
        if (known.has(e.to)) {
          s.nodes[e.to].status = 'idle';
          if (!s.ready.includes(e.to)) s.ready.push(e.to);
        }
        break;
      }
      case 'run.parked': {
        s.status = 'parked'; s.parked = { node: e.node, ask: e.ask || '' };
        if (known.has(e.node)) s.nodes[e.node].status = 'parked';
        break;
      }
      case 'human.answered': {
        s.status = 'running'; s.parked = null;
        if (known.has(e.node)) { const n = s.nodes[e.node]; n.status = 'finished'; n.outcome = e.outcome || 'pass'; n.result = e.result || { summary: `answered ${e.outcome || 'pass'}` }; s.results[e.node] = n.result; }
        break;
      }
      case 'run.halted': { s.status = 'halted'; s.ended_at = e.ts || null; s.ready = []; s.parked = null; s.terminal = true; break; }
      case 'run.ended': { s.status = e.status || 'done'; s.final_outcome = e.outcome || null; s.ended_at = e.ts || null; s.ready = []; s.parked = null; s.terminal = true; break; }
      default: break;
    }
  }
  return s;
}

function isTerminal(state) { return state.terminal === true; }

function readyNodes(graph, state) {
  return state.ready.filter((id) => state.nodes[id] && state.nodes[id].status !== 'running');
}

// Which edges out of `nodeId` fire for `outcome`, and which are exhausted.
function matchEdges(graph, state, nodeId, outcome) {
  const fired = [], exhausted = [];
  for (const e of graph.edges) {
    if (e.from !== nodeId) continue;
    const on = e.on === undefined ? 'pass' : e.on;
    if (!(on === 'always' || on === outcome)) continue;
    if (e.max !== undefined && (state.edge_counts[edgeKey(e)] || 0) >= e.max) exhausted.push(e);
    else fired.push(e);
  }
  return { fired, exhausted };
}

function finalStatusFor(outcome) {
  if (outcome === 'pass') return 'done';
  if (outcome === 'fail' || outcome === 'exhausted') return 'failed';
  return outcome;
}

module.exports = { reduce, isTerminal, readyNodes, matchEdges, finalStatusFor, edgeKey, TERMINAL };
