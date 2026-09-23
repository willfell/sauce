// platform/engine/vars.js — `${...}` substitution for node fields.
// Tokens: ${run.id} ${run.dir} ${vars.<key>} ${result.<node>.<path.to.field>}
// ${node.id}. An unknown reference throws VarsError rather than expanding
// to an empty string, so a typo cannot silently run `node undefined claim`.
'use strict';

class VarsError extends Error {
  constructor(message) { super(message); this.name = 'VarsError'; }
}

const TOKEN = /\$\{(raw:)?([a-zA-Z_][\w-]*(?:\.[\w-]+)*)\}/g;

function lookup(pathStr, ctx) {
  const parts = pathStr.split('.');
  const head = parts.shift();
  let cur;
  if (head === 'run') cur = ctx.run || {};
  else if (head === 'vars') cur = ctx.vars || {};
  else if (head === 'result') cur = ctx.results || {};
  else if (head === 'node') cur = ctx.node || {};
  else throw new VarsError(`unknown reference root "${head}" in \${${pathStr}} (run | vars | result | node)`);
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || !(p in cur)) {
      throw new VarsError(`unresolved reference \${${pathStr}}: "${p}" is missing`);
    }
    cur = cur[p];
  }
  if (cur === undefined) throw new VarsError(`unresolved reference \${${pathStr}}`);
  return cur;
}

function stringify(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

// A var default may itself contain ${...} (the shipped delivery-slice graph
// builds commands from other vars), so substitution repeats until the text
// is stable, bounded to stop a self-referencing var from looping.
// Expansion is single-pass over GRAPH-AUTHORED text. A value that came from
// outside the graph (a captured receipt field, a worker's summary, a --var)
// is a LEAF: it is substituted once and never re-scanned, so a ${...} inside
// a card title is data, not a template. Only a var the graph's own `vars:`
// block declares is itself graph-authored, so only those are expanded
// recursively (bounded), which is what lets one default build on another.
function has(collection, name) {
  if (!collection) return false;
  if (collection instanceof Set) return collection.has(name);
  if (Array.isArray(collection)) return collection.includes(name);
  return Object.prototype.hasOwnProperty.call(collection, name);
}

// Two INDEPENDENT questions decide what happens to a substituted value, and
// conflating them is how this went wrong twice:
//
//   1. Is the value a TEMPLATE? Only author-supplied text may contain further
//      ${...} references and be expanded: the graph's own vars: block, and a
//      --var the operator typed. A value captured off a receipt (vars_from)
//      or written by a worker is data, never markup, and is never re-scanned.
//   2. Is the reference an OPERAND or a command FRAGMENT? Operands are quoted;
//      ${raw:...} says this one reference is a fragment and must not be.
//
// A path is author-supplied AND an operand, so it is expanded and then quoted:
// that is what keeps `--var coordinator=/Users/me/My Repo/c.js` from splitting
// on the space. A command fragment is author-supplied and raw, so its body is
// expanded (quoting the leaves inside it) and the fragment itself is not.
function isAuthored(ref, ctx) {
  if (!ref.startsWith('vars.')) return false;
  const name = ref.slice(5).split('.')[0];
  if (has(ctx && ctx.runtimeVars, name)) return false;   // captured off a receipt: data
  return has(ctx && ctx.declaredVars, name) || has(ctx && ctx.cliVars, name);
}

function expand(text, ctx, quote, depth) {
  if (typeof text !== 'string') return text;
  if (depth > 5) throw new VarsError('substitution did not settle after 5 passes (self-referencing var?)');
  return text.replace(TOKEN, (_m, raw, ref) => {
    const value = stringify(lookup(ref, ctx || {}));
    // Expansion (question 1) and quoting (question 2) are decided separately.
    const expanded = isAuthored(ref, ctx) ? expand(value, ctx, quote, depth + 1) : value;
    return raw ? expanded : quote(expanded);
  });
}

function substitute(text, ctx) {
  return expand(text, ctx, (v) => v, 0);
}

// Substitution into a shell command. Every substituted leaf is wrapped in
// single quotes with embedded quotes escaped, so a card title or an agent's
// free-prose summary cannot break out of its operand and execute anything.
// A graph writes --card ${vars.card}, never --card "${vars.card}".
//
// ${raw:vars.x} opts one reference out of quoting, for a var holding a whole
// command fragment rather than an operand. It is honoured only in the
// graph's own text: a raw marker arriving inside a captured value is never
// acted on, because leaves are not re-scanned.
function shellQuote(v) {
  return "'" + String(v).replace(/'/g, "'\\''") + "'";
}

function substituteShell(text, ctx) {
  return expand(text, ctx, shellQuote, 0);
}

module.exports = { substitute, substituteShell, shellQuote, lookup, VarsError };
