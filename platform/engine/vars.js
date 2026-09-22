// platform/engine/vars.js — `${...}` substitution for node fields.
// Tokens: ${run.id} ${run.dir} ${vars.<key>} ${result.<node>.<path.to.field>}
// ${node.id}. An unknown reference throws VarsError rather than expanding
// to an empty string, so a typo cannot silently run `node undefined claim`.
'use strict';

class VarsError extends Error {
  constructor(message) { super(message); this.name = 'VarsError'; }
}

const TOKEN = /\$\{([a-zA-Z_][\w-]*(?:\.[\w-]+)*)\}/g;

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
function substitute(text, ctx) {
  if (typeof text !== 'string') return text;
  let cur = text;
  for (let i = 0; i < 5; i++) {
    const next = cur.replace(TOKEN, (_m, ref) => stringify(lookup(ref, ctx || {})));
    if (next === cur) return cur;
    cur = next;
  }
  if (new RegExp(TOKEN.source).test(cur)) throw new VarsError('substitution did not settle after 5 passes (self-referencing var?)');
  return cur;
}

module.exports = { substitute, lookup, VarsError };
