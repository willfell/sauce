#!/usr/bin/env node
/**
 * run-workstreams-analysis.js — Slice 0 regression guard for the read-only
 * project-workstreams divergence analyzer (scripts/autoloop/analyze-workstreams.js).
 * Proves the pure hub-vs-map divergence report + the frontmatter extractor on a
 * fixture tree. Reverting the analyzer source makes the require below fail -> red
 * (the guard Gate B Layer 1 checks).
 */
'use strict';

const path = require('path');
const A = require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'analyze-workstreams.js'));

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const eqSet = (a, b) => A.sameSet(a || [], b || []);

// ---- parseWorkstreams ----
ok('WA0 module loads', typeof A.analyzeProject === 'function');
ok('WA1 array normalized + trimmed + deduped', eqSet(A.parseWorkstreams([' A ', 'A', 'B']), ['A', 'B']));
ok('WA2 JSON string parsed', eqSet(A.parseWorkstreams('["A","B"]'), ['A', 'B']));
ok('WA3 bare string -> single', eqSet(A.parseWorkstreams('Solo'), ['Solo']));
ok('WA4 null/garbage -> []', A.parseWorkstreams(null).length === 0 && A.parseWorkstreams(5).length === 0 && A.parseWorkstreams('').length === 0);
ok('WA5 wikilinks kept opaque', eqSet(A.parseWorkstreams(['[[Ops]]', '[[Ops]]', '[[Dev]]']), ['[[Ops]]', '[[Dev]]']));

// ---- analyzeProject ----
// both empty
{
  const r = A.analyzeProject({ slug: 'x', hubWs: [], mapWs: [] });
  ok('WA6 both empty -> agree, no diverge, no unionDiffer', r.agree && !r.hubHas && !r.mapHas && !r.unionVsMapWinsDiffer);
}
// agree non-empty (order-independent)
{
  const r = A.analyzeProject({ slug: 'x', hubWs: ['A', 'B'], mapWs: ['B', 'A'] });
  ok('WA7 same set diff order -> agree, union==mapWins', r.agree && !r.unionVsMapWinsDiffer && eqSet(r.union, ['A', 'B']));
}
// hub-only: map empty -> mapWins falls back to hub, so union==mapWins (no drop),
// but onlyOnHub is non-empty (migration must copy hub->map).
{
  const r = A.analyzeProject({ slug: 'x', hubWs: ['A', 'B'], mapWs: [] });
  ok('WA8 hub-only -> !agree, mapWins=hub, no data drop, onlyOnHub set',
    !r.agree && r.hubHas && !r.mapHas && eqSet(r.mapWins, ['A', 'B']) && !r.unionVsMapWinsDiffer && eqSet(r.onlyOnHub, ['A', 'B']) && r.onlyOnMap.length === 0);
}
// map-only
{
  const r = A.analyzeProject({ slug: 'x', hubWs: [], mapWs: ['C'] });
  ok('WA9 map-only -> !agree, mapWins=map, onlyOnMap set', !r.agree && !r.hubHas && r.mapHas && eqSet(r.mapWins, ['C']) && eqSet(r.onlyOnMap, ['C']));
}
// true divergence: map-wins would DROP a hub-only item that union keeps
{
  const r = A.analyzeProject({ slug: 'x', hubWs: ['A', 'B'], mapWs: ['B', 'C'] });
  ok('WA10 divergence -> unionVsMapWinsDiffer true (map-wins drops A)',
    !r.agree && eqSet(r.union, ['A', 'B', 'C']) && eqSet(r.mapWins, ['B', 'C']) && r.unionVsMapWinsDiffer && eqSet(r.onlyOnHub, ['A']) && eqSet(r.onlyOnMap, ['C']));
}

// ---- analyzeVault summary ----
{
  const v = A.analyzeVault([
    { slug: 'empty', hubWs: [], mapWs: [] },
    { slug: 'agree', hubWs: ['A'], mapWs: ['A'] },
    { slug: 'hubonly', hubWs: ['A', 'B'], mapWs: [] },
    { slug: 'maponly', hubWs: [], mapWs: ['C'] },
    { slug: 'diverge', hubWs: ['A', 'B'], mapWs: ['B', 'C'] },
  ]);
  const s = v.summary;
  ok('WA11 summary counts',
    s.total === 5 && s.bothEmpty === 1 && s.agreeNonEmpty === 1 && s.diverge === 3 &&
    s.hubOnly === 1 && s.mapOnly === 1 && s.unionDiffersFromMapWins === 1);
}

// ---- extractWorkstreams (frontmatter parse: inline + block) ----
{
  const inlineArr = '---\ntype: "project"\nworkstreams: ["Ops", "Dev"]\nteams: []\n---\nbody';
  ok('WA12 inline array frontmatter', eqSet(A.extractWorkstreams(inlineArr), ['Ops', 'Dev']));
  const emptyArr = '---\ntype: map\nworkstreams: []\n---\n';
  ok('WA13 empty inline array', A.extractWorkstreams(emptyArr).length === 0);
  const block = '---\ntype: map\nworkstreams:\n  - Ops\n  - "[[Dev]]"\nteams: []\n---\n';
  ok('WA14 block-list frontmatter', eqSet(A.extractWorkstreams(block), ['Ops', '[[Dev]]']));
  const none = '---\ntype: project\nteams: []\n---\n';
  ok('WA15 absent -> []', A.extractWorkstreams(none).length === 0);
  ok('WA16 fmType reads type', A.fmType(inlineArr) === 'project' && A.fmType(block) === 'map');
  // WA17 — the REAL data model: a block list of OBJECTS with id/name/description.
  // Identity = each item's `id`; must read ALL items (not stop after the first).
  const objBlock = [
    '---', 'type: project', 'name: Home', 'workstreams:',
    '  - id: bedroom', '    name: Bedroom', '    description: ""',
    '  - id: garden', '    name: Garden', '    description: ""',
    '  - id: office', '    name: Office', '    description: ""',
    'teams: []', 'sections:', '  - "[[Knowledge]]"', '---', 'body',
  ].join('\n');
  ok('WA17 object-style block -> all ids (not just first)', eqSet(A.extractWorkstreams(objBlock), ['bedroom', 'garden', 'office']));
  // WA18 — object list stops at the next top-level key (does not bleed into `sections`).
  ok('WA18 object list does not bleed into next key', A.extractWorkstreams(objBlock).indexOf('[[Knowledge]]') === -1);
  // WA19 — mixed: id inline on the dash line vs id on a sub-line both resolve.
  const mixed = '---\nworkstreams:\n  - id: a\n  - name: B\n    id: b\n---\n';
  ok('WA19 id inline + id on sub-line', eqSet(A.extractWorkstreams(mixed), ['a', 'b']));
  // WA20 — object item with `name` but NO `id` still counts (name-fallback), so a
  // real workstream is never dropped -> divergence is not understated.
  const nameOnly = '---\nworkstreams:\n  - id: a\n  - name: Beta\n    description: ""\n---\n';
  ok('WA20 name-only object counts (not dropped)', eqSet(A.extractWorkstreams(nameOnly), ['a', 'Beta']));
  // WA21 — trailing inline YAML comment on an id line is stripped from the identity,
  // so the same workstream on hub + Map does not read as a false-positive divergence.
  const commented = '---\nworkstreams:\n  - id: ops   # east region\n  - id: dev\n---\n';
  ok('WA21 trailing comment stripped from id', eqSet(A.extractWorkstreams(commented), ['ops', 'dev']));
}

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
process.exit(allPass ? 0 : 1);
