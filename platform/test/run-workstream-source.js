#!/usr/bin/env node
/**
 * run-workstream-source.js — Workstreams Hub Slice 1 regression guard for the
 * pure WorkstreamSource resolver (platform/blueprints/project/helpers/
 * workstream-source.js). Exhaustive parse + resolve cases: map-only, hub-only,
 * both-agree, both-diverge (the data-loss case), empty/malformed. Reverting the
 * helper source makes the class fail to load below -> red (Gate B Layer 1).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const SRC = path.resolve(__dirname, '..', 'blueprints', 'project', 'helpers', 'workstream-source.js');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const ids = (arr) => (arr || []).map((w) => w && w.id);
const eq = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

const source = fs.existsSync(SRC) ? fs.readFileSync(SRC, 'utf8') : '';
const Cls = source ? new Function(`${source}\nreturn WorkstreamSource;`)() : null;
ok('WS0 WorkstreamSource loads', !!Cls);
const W = Cls ? new Cls() : null;
const obj = (id, name) => ({ id, name: name || id, description: '' });

// ---- parse() ----
ok('WS1 array of objects -> ids, name-default', eq(ids(W.parse([obj('a'), { id: 'b' }])), ['a', 'b']) && W.parse([{ id: 'b' }])[0].name === 'b');
ok('WS2 dedup by id (first wins)', (() => { const r = W.parse([obj('a', 'First'), obj('a', 'Second')]); return r.length === 1 && r[0].name === 'First'; })());
ok('WS3 bare id strings', eq(ids(W.parse(['x', 'y'])), ['x', 'y']));
ok('WS4 JSON-encoded string', eq(ids(W.parse('[{"id":"a"},{"id":"b"}]')), ['a', 'b']));
ok('WS5 null/garbage/empty -> []', W.parse(null).length === 0 && W.parse(5).length === 0 && W.parse('').length === 0 && W.parse({}).length === 0);
ok('WS6 object without id falls back to name', eq(ids(W.parse([{ name: 'Ops' }])), ['Ops']));
ok('WS6b empty/whitespace id falls back to name (not dropped)', eq(ids(W.parse([{ id: '', name: 'Ops' }, { id: '  ', name: 'Dev' }])), ['Ops', 'Dev']));
ok('WS7 id-less + name-less object dropped', W.parse([{ description: 'x' }, null, obj('keep')]).length === 1);
ok('WS8 order preserved', eq(ids(W.parse([obj('1'), obj('2'), obj('3')])), ['1', '2', '3']));

// ---- resolve() ----  { mapFrontmatter, hubFrontmatter }
const R = (mapWs, hubWs) => W.resolve({ mapFrontmatter: mapWs == null ? null : { workstreams: mapWs }, hubFrontmatter: hubWs == null ? null : { workstreams: hubWs } });

// both empty / missing
ok('WS9 both empty -> []', R([], []).length === 0 && R(null, null).length === 0);
// map-only
ok('WS10 map-only -> map', eq(ids(R([obj('a'), obj('b')], [])), ['a', 'b']));
// hub-only (fallback)
ok('WS11 hub-only -> hub (fallback)', eq(ids(R([], [obj('c')])), ['c']));
// both agree
ok('WS12 both agree -> that set (map objects)', eq(ids(R([obj('a'), obj('b')], [obj('a'), obj('b')])), ['a', 'b']));
// THE data-loss case: map has 2, hub has a 3rd (finance-blueprint analogue).
// map-wins would drop it; the hub-preserving union keeps it, appended after map.
{
  const r = R([obj('projects'), obj('meetings')], [obj('projects'), obj('meetings'), obj('finance-blueprint')]);
  ok('WS13 diverge: hub-only workstream PRESERVED (appended), not dropped',
    eq(ids(r), ['projects', 'meetings', 'finance-blueprint']));
}
// map wins for a shared id (keeps map ordering + map object)
{
  const r = R([obj('b', 'B-map'), obj('a', 'A-map')], [obj('a', 'A-hub'), obj('c', 'C-hub')]);
  ok('WS14 map order canonical + shared id uses map object + hub-only appended',
    eq(ids(r), ['b', 'a', 'c']) && r[1].name === 'A-map' && r[2].id === 'c' && r[2].name === 'C-hub');
}
// malformed frontmatter values (string / missing key) don't throw
ok('WS15 malformed fm never throws', (() => {
  try { W.resolve({}); W.resolve(null); W.resolve({ mapFrontmatter: { workstreams: 'garbage' }, hubFrontmatter: {} }); return true; } catch (_e) { return false; }
})());
// JSON-string frontmatter on both sides resolves through parse
ok('WS16 raw-string workstreams on both sides', eq(ids(R('[{"id":"a"}]', '[{"id":"a"},{"id":"b"}]')), ['a', 'b']));

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
process.exit(allPass ? 0 : 1);
