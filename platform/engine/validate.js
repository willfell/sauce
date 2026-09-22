// platform/engine/validate.js — structural validation of a parsed graph.
// Pure; returns { ok, errors } and never throws on bad input.
'use strict';

const NODE_TYPES = new Set(['agent', 'judge', 'shell', 'human', 'end']);
const WORKERS = new Set(['claude-code', 'codex', 'fake']);
const FIXED_ON = new Set(['pass', 'fail', 'always', 'exhausted']);
const NAMED_ON = /^[a-z][a-z0-9-]*$/;

function err(code, message, extra) { return Object.assign({ code, message }, extra || {}); }

function validateNode(n, errors) {
  if (!n || typeof n !== 'object') { errors.push(err('bad_node', 'node is not a map')); return; }
  const id = n.id;
  if (typeof id !== 'string' || !/^[A-Za-z][\w-]*$/.test(id)) { errors.push(err('bad_id', `node id "${id}" must match [A-Za-z][A-Za-z0-9_-]*`)); return; }
  if (!NODE_TYPES.has(n.type)) { errors.push(err('unknown_type', `node "${id}" has unknown type "${n.type}"`, { node: id })); return; }
  const need = (field) => { if (typeof n[field] !== 'string' || !n[field].trim()) errors.push(err('missing_field', `node "${id}" (${n.type}) needs "${field}"`, { node: id })); };
  if (n.type === 'agent') {
    need('prompt');
    if (typeof n.worker !== 'string' || !n.worker) errors.push(err('missing_field', `node "${id}" (agent) needs "worker"`, { node: id }));
    else if (!WORKERS.has(n.worker)) errors.push(err('unknown_worker', `node "${id}" names unknown worker "${n.worker}" (claude-code | codex | fake)`, { node: id }));
    if (n.isolate !== undefined && !['worktree', 'none'].includes(n.isolate)) errors.push(err('bad_field', `node "${id}" isolate must be worktree | none`, { node: id }));
  } else if (n.type === 'judge') {
    const hasRun = typeof n.run === 'string' && n.run.trim();
    const hasGate = typeof n.gate === 'string' && n.gate.trim();
    if (!!hasRun === !!hasGate) errors.push(err('missing_field', `node "${id}" (judge) needs exactly one of "run" or "gate"`, { node: id }));
    if (hasGate && n.gate !== 'adequacy') errors.push(err('bad_field', `node "${id}" gate must be "adequacy"`, { node: id }));
  } else if (n.type === 'shell') {
    need('run');
    if (n.capture !== undefined && n.capture !== 'json') errors.push(err('bad_field', `node "${id}" capture must be "json"`, { node: id }));
    if (n.vars_from !== undefined && (!n.vars_from || typeof n.vars_from !== 'object' || Array.isArray(n.vars_from) || Object.values(n.vars_from).some((v) => typeof v !== 'string'))) errors.push(err('bad_field', `node "${id}" vars_from must map var names to receipt paths`, { node: id }));
    if (n.outcome !== undefined && typeof n.outcome !== 'string') errors.push(err('bad_field', `node "${id}" outcome must be a string (may use \${...})`, { node: id }));
  } else if (n.type === 'human') {
    need('ask');
  }
  if (n.timeout !== undefined && !(Number.isInteger(n.timeout) && n.timeout > 0)) errors.push(err('bad_field', `node "${id}" timeout must be a positive integer (seconds)`, { node: id }));
}

function validateGraph(graph) {
  const errors = [];
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = graph && Array.isArray(graph.edges) ? graph.edges : [];
  if (nodes.length === 0) errors.push(err('no_nodes', 'graph has no nodes'));
  if (graph && graph.vars !== undefined && (!graph.vars || typeof graph.vars !== 'object' || Array.isArray(graph.vars) || Object.values(graph.vars).some((v) => v !== null && typeof v === 'object'))) errors.push(err('bad_vars', 'vars must be a map of scalar defaults'));
  const ids = new Set();
  for (const n of nodes) {
    validateNode(n, errors);
    if (n && typeof n.id === 'string') {
      if (ids.has(n.id)) errors.push(err('duplicate_id', `node id "${n.id}" is used twice`, { node: n.id }));
      ids.add(n.id);
    }
  }
  edges.forEach((e, i) => {
    if (!e || typeof e !== 'object') { errors.push(err('bad_edge', `edge #${i + 1} is not a map`, { edge: i })); return; }
    for (const end of ['from', 'to']) {
      if (typeof e[end] !== 'string' || !ids.has(e[end])) errors.push(err('dangling_edge', `edge #${i + 1} ${end} "${e[end]}" is not a node`, { edge: i }));
    }
    const on = e.on === undefined ? 'pass' : e.on;
    if (typeof on !== 'string' || !(FIXED_ON.has(on) || NAMED_ON.test(on)) || on === 'parked') errors.push(err('bad_on', `edge #${i + 1} on "${e.on}" must be pass | fail | always | exhausted | <named-outcome>`, { edge: i }));
    if (e.max !== undefined && !(Number.isInteger(e.max) && e.max >= 1)) errors.push(err('bad_max', `edge #${i + 1} max must be an integer >= 1`, { edge: i }));
  });
  if (errors.length) return { ok: false, errors };

  const entries = entryNodes({ nodes, edges });

  // A cycle every edge of which lacks `max` can never terminate.
  const unbounded = new Map();
  for (const n of nodes) unbounded.set(n.id, []);
  for (const e of edges) if (e.max === undefined) unbounded.get(e.from).push(e.to);
  const color = new Map();
  const stack = [];
  const visit = (id) => {
    color.set(id, 1); stack.push(id);
    for (const next of unbounded.get(id)) {
      if (color.get(next) === 1) {
        const cycle = stack.slice(stack.indexOf(next)).concat(next).join(' -> ');
        errors.push(err('unbounded_cycle', `cycle without a max: budget: ${cycle}`));
        return true;
      }
      if (!color.has(next) && visit(next)) return true;
    }
    stack.pop(); color.set(id, 2);
    return false;
  };
  for (const n of nodes) if (!color.has(n.id) && visit(n.id)) break;

  return { ok: errors.length === 0, errors, entries };
}

// Entry nodes start the run: the first declared node, plus every node no
// edge points at. Declaration order is the author's intent; a retry edge
// back to the first node never demotes it, and a node only reachable
// through a bounded edge (a repair step) never becomes an accidental entry.
function entryNodes(graph) {
  const nodes = (graph.nodes || []).filter((n) => n && typeof n.id === 'string');
  if (!nodes.length) return [];
  const incoming = new Set((graph.edges || []).map((e) => e.to));
  const out = [nodes[0].id];
  for (const n of nodes.slice(1)) if (!incoming.has(n.id)) out.push(n.id);
  return out;
}

module.exports = { validateGraph, entryNodes, NODE_TYPES, WORKERS };
