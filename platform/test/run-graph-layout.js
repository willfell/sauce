#!/usr/bin/env node
'use strict';

// run-graph-layout.js — behavioral harness for the GraphLayout pure layout core
// (platform/blueprints/project/helpers/graph-layout.js).
//
// GV-1b lineage: the three carried findings from the refuted GV-1 attempts are
// pinned as named fixtures (GV1-BIDI-SUPPRESS, GV1-WITHDIR-SUPPRESS,
// GV1-WAITREASON-PRECEDENCE) — each must independently kill its named mutant.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HELPER = path.join(ROOT, 'platform/blueprints/project/helpers/graph-layout.js');

const source = fs.readFileSync(HELPER, 'utf8');
// Replicate the customJS loader exactly: whole file wrapped in ( ... ) as one expression.
const GraphLayout = eval(`(${source})`); // eslint-disable-line no-eval
const layout = new GraphLayout();

const slice = (card, extra = {}) => ({
  card, status: 'planning', depends_on: [], file: { path: `board/${card}.md` }, ...extra,
});
const node = (card, rank, row, extra = {}) => ({
  card, path: `board/${card}.md`, status: 'planning', rank, row, waitReason: null, ...extra,
});
const dep = (from, to) => ({ from, to, kind: 'depends' });
const order = (from, to) => ({ from, to, kind: 'order' });
const orderEdges = (result) => result.edges.filter((edge) => edge.kind === 'order');
const placements = (result) => result.nodes.map((entry) => [entry.card, entry.rank, entry.row]);
const reasons = (result) => new Map(result.nodes.map((entry) => [entry.card, entry.waitReason]));

// Shared GV-1 lineage board: 2-cycle C-A <-> C-B plus downstream C-C depends_on C-B.
const cycleBoard = () => [
  slice('C-A', { depends_on: ['[[C-B]]'] }),
  slice('C-B', { depends_on: ['[[C-A]]'] }),
  slice('C-C', { depends_on: ['[[C-B]]'] }),
];

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('case 1: linear chain of 4 — exact ranks 0-3 and exactly 3 depends edges', () => {
  const result = layout.layoutGraph([
    slice('CV-1'),
    slice('CV-2', { depends_on: ['[[CV-1]]'] }),
    slice('CV-3', { depends_on: ['CV-2'] }),
    slice('CV-4', { depends_on: ['[[CV-3|step three]]'] }),
  ], { laneOrder: ['CV-1', 'CV-2', 'CV-3', 'CV-4'] });
  assert.deepStrictEqual(result, {
    nodes: [node('CV-1', 0, 0), node('CV-2', 1, 0), node('CV-3', 2, 0), node('CV-4', 3, 0)],
    edges: [dep('CV-1', 'CV-2'), dep('CV-2', 'CV-3'), dep('CV-3', 'CV-4')],
    warnings: [],
  });
});

test('case 2: fan-in OC-1,OC-2 -> OC-3 — shared child ranks below both prerequisites', () => {
  const result = layout.layoutGraph([
    slice('OC-1'), slice('OC-2'),
    slice('OC-3', { depends_on: ['[[OC-1]]', '[[OC-2]]'] }),
  ], { laneOrder: ['OC-1', 'OC-2', 'OC-3'] });
  assert.deepStrictEqual(result, {
    nodes: [node('OC-1', 0, 0), node('OC-2', 0, 1), node('OC-3', 1, 0)],
    edges: [dep('OC-1', 'OC-3'), dep('OC-2', 'OC-3'), order('OC-1', 'OC-2')],
    warnings: [],
  });
});

test('case 3: fork PA-3 -> PA-4,PA-5 — both children share the rank below the parent', () => {
  const result = layout.layoutGraph([
    slice('PA-3'),
    slice('PA-4', { depends_on: ['PA-3'] }),
    slice('PA-5', { depends_on: ['PA-3'] }),
  ], { laneOrder: ['PA-3', 'PA-4', 'PA-5'] });
  assert.deepStrictEqual(result, {
    nodes: [node('PA-3', 0, 0), node('PA-4', 1, 0), node('PA-5', 1, 1)],
    edges: [dep('PA-3', 'PA-4'), dep('PA-3', 'PA-5'), order('PA-4', 'PA-5')],
    warnings: [],
  });
});

test('case 4: ghost order edge only between edge-free lane-adjacent rank-sharing siblings', () => {
  const free = layout.layoutGraph([slice('G-1'), slice('G-2')], { laneOrder: ['G-1', 'G-2'] });
  assert.deepStrictEqual(free.edges, [order('G-1', 'G-2')],
    'edge-free lane-adjacent rank-0 siblings get exactly one order edge — kind must be "order", never "depends"');
  const connected = layout.layoutGraph([
    slice('H-1', { depends_on: ['H-2'] }),
    slice('H-2', { depends_on: ['H-1'] }),
  ], { laneOrder: ['H-1', 'H-2'] });
  assert.deepStrictEqual(orderEdges(connected), [],
    'a path-connected rank-sharing pair gets no ghost order edge');
});

test('case 5: dangling depends_on — dangling_dependency warning, node still placed', () => {
  const result = layout.layoutGraph([
    slice('D-1', { depends_on: ['[[Ghost]]'] }),
  ], { laneOrder: ['D-1'] });
  assert.deepStrictEqual(result, {
    nodes: [node('D-1', 0, 0)],
    edges: [],
    warnings: [{ code: 'dangling_dependency', card: 'D-1', detail: 'Ghost' }],
  });
});

test('case 6: 2-cycle — cycle warnings, deterministic fallback rank, no throw', () => {
  const result = layout.layoutGraph([
    slice('C-1', { depends_on: ['C-2'] }),
    slice('C-2', { depends_on: ['C-1'] }),
  ], { laneOrder: ['C-1', 'C-2'] });
  assert.deepStrictEqual(result, {
    nodes: [node('C-1', 0, 0), node('C-2', 0, 1)],
    edges: [dep('C-2', 'C-1'), dep('C-1', 'C-2')],
    warnings: [
      { code: 'cycle', card: 'C-1', detail: 'dependency cycle: C-1, C-2' },
      { code: 'cycle', card: 'C-2', detail: 'dependency cycle: C-1, C-2' },
    ],
  });
  const mixed = layout.layoutGraph([
    slice('R-0'),
    slice('K-1', { depends_on: ['K-2'] }),
    slice('K-2', { depends_on: ['K-1'] }),
  ], { laneOrder: ['R-0', 'K-1', 'K-2'] });
  assert.deepStrictEqual(placements(mixed), [['R-0', 0, 0], ['K-1', 1, 0], ['K-2', 1, 1]],
    'cycle members take fallback rank = max ranked rank + 1');
});

test('case 7: self-dependency — self_dependency warning, self edge dropped', () => {
  const result = layout.layoutGraph([
    slice('S-0'),
    slice('S-1', { depends_on: ['[[S-1]]', 'S-0'] }),
  ], { laneOrder: ['S-0', 'S-1'] });
  assert.deepStrictEqual(result, {
    nodes: [node('S-0', 0, 0), node('S-1', 1, 0)],
    edges: [dep('S-0', 'S-1')],
    warnings: [{ code: 'self_dependency', card: 'S-1', detail: 'S-1' }],
  });
});

test('case 8: mixed bracketed/alias/bare/.md depends_on forms resolve identically and dedupe', () => {
  const result = layout.layoutGraph([
    slice('P-Base'),
    slice('P-A', { depends_on: '[[P-Base]]' }),
    slice('P-B', { depends_on: ['P-Base.md'] }),
    slice('P-C', { depends_on: ['[[P-Base|the base]]'] }),
    slice('P-D', { depends_on: ['[[P-Base]]', 'P-Base', 'P-Base.md'] }),
  ], { laneOrder: ['P-Base', 'P-A', 'P-B', 'P-C', 'P-D'] });
  assert.deepStrictEqual(result.warnings, [], 'every form resolves — alias/.md kept literal would go dangling');
  assert.deepStrictEqual(placements(result),
    [['P-Base', 0, 0], ['P-A', 1, 0], ['P-B', 1, 1], ['P-C', 1, 2], ['P-D', 1, 3]]);
  assert.deepStrictEqual(result.edges.filter((edge) => edge.kind === 'depends'),
    [dep('P-Base', 'P-A'), dep('P-Base', 'P-B'), dep('P-Base', 'P-C'), dep('P-Base', 'P-D')],
    'duplicate refs dedupe to exactly one depends edge');
  assert.deepStrictEqual(orderEdges(result),
    [order('P-A', 'P-B'), order('P-B', 'P-C'), order('P-C', 'P-D')]);
});

test('case 9: empty and nullish input — always the empty drawable result', () => {
  for (const input of [[], null, undefined, 'nonsense', 42, {}]) {
    assert.deepStrictEqual(layout.layoutGraph(input, { laneOrder: [] }),
      { nodes: [], edges: [], warnings: [] }, `input ${JSON.stringify(input)} yields the empty result`);
  }
  assert.deepStrictEqual(layout.layoutGraph([]), { nodes: [], edges: [], warnings: [] },
    'omitted options are tolerated');
  assert.deepStrictEqual(layout.layoutGraph([slice('L-1')], null).nodes, [node('L-1', 0, 0)],
    'null options are tolerated');
});

test('case 10: malformed input — object depends_on, missing status, null entries stay drawable', () => {
  const result = layout.layoutGraph([
    null,
    5,
    { card: 'M-1', depends_on: { unexpected: 'shape' } },
    { card: 'M-2' },
    { file: { path: 'board/M-3.md' } },
    { card: 'M-4', depends_on: ['[[Nope]]'], status: 'planning' },
  ], { laneOrder: 'not-an-array' });
  assert.deepStrictEqual(result, {
    nodes: [
      { card: 'M-1', path: null, status: null, rank: 0, row: 0, waitReason: null },
      { card: 'M-2', path: null, status: null, rank: 0, row: 1, waitReason: null },
      { card: 'M-3', path: 'board/M-3.md', status: null, rank: 0, row: 2, waitReason: null },
      { card: 'M-4', path: null, status: 'planning', rank: 0, row: 3, waitReason: null },
    ],
    edges: [],
    warnings: [{ code: 'dangling_dependency', card: 'M-4', detail: 'Nope' }],
  });
});

test('case 11: waitReason — parked resume_condition verbatim; blocked unmet deps by name', () => {
  const result = layout.layoutGraph([
    slice('W-0'),
    slice('W-4', { status: 'completed' }),
    slice('W-1', { status: 'parked', resume_condition: 'Waiting for the vendor API key' }),
    slice('W-2', { status: 'blocked', depends_on: ['W-0'] }),
    slice('W-3', { status: 'blocked', depends_on: ['W-4'] }),
    slice('W-5', { status: 'in_progress', resume_condition: 'never shown' }),
    slice('W-6', { status: 'blocked', depends_on: ['W-0', '[[W-7]]'] }),
    slice('W-7'),
    slice('W-8', { status: 'parked' }),
  ], { laneOrder: ['W-0', 'W-4', 'W-1', 'W-2', 'W-3', 'W-5', 'W-6', 'W-7', 'W-8'] });
  const why = reasons(result);
  assert.strictEqual(why.get('W-1'), 'Waiting for the vendor API key', 'parked resume_condition is verbatim');
  assert.strictEqual(why.get('W-2'), 'waiting on: W-0', 'blocked with unmet dep names the dep');
  assert.strictEqual(why.get('W-3'), null, 'a completed dependency is met — no waitReason');
  assert.strictEqual(why.get('W-5'), null, 'waitReason is parked/blocked-only');
  assert.strictEqual(why.get('W-6'), 'waiting on: W-0, W-7', 'multiple unmet deps list every name in order');
  assert.strictEqual(why.get('W-8'), null, 'parked with no reason and no deps carries null');
});

test('case 12: purity — helper source references no host runtime surface', () => {
  for (const forbidden of [
    /\bapp\b/, /\bdv\b/, /dataview/i, /customjs/i, /\brequire\b/,
    /\bglobalThis\b/, /\bwindow\b/, /\bmodule\b/, /\bprocess\b/,
  ]) {
    assert.strictEqual(forbidden.test(source), false,
      `graph-layout.js must not reference ${forbidden} — the layout core is pure`);
  }
  assert.ok(/^class GraphLayout\b/m.test(source), 'file is a bare customJS-loadable class');
});

test('case 13: GV1-BIDI-SUPPRESS — laneOrder against dependency direction emits zero order edges', () => {
  // Cycle C-A <-> C-B plus C-C depends_on C-B; lane runs AGAINST the dependency
  // direction. Kills the mutant that drops the right-to-left leg of the
  // suppression path check (_hasPath(right, left)).
  const result = layout.layoutGraph(cycleBoard(), { laneOrder: ['C-C', 'C-A', 'C-B'] });
  assert.deepStrictEqual(placements(result), [['C-C', 0, 0], ['C-A', 0, 1], ['C-B', 0, 2]],
    'cycle members and their unrankable downstream dependent share the fallback rank in lane order');
  assert.deepStrictEqual(orderEdges(result), [],
    'GV1-BIDI-SUPPRESS: the order-edge list is exactly empty');
});

test('case 14: GV1-WITHDIR-SUPPRESS — laneOrder with dependency direction emits zero order edges', () => {
  // Same board, lane runs WITH the dependency direction. Kills the mirror
  // mutant that drops the left-to-right leg (_hasPath(left, right)).
  const result = layout.layoutGraph(cycleBoard(), { laneOrder: ['C-A', 'C-B', 'C-C'] });
  assert.deepStrictEqual(orderEdges(result), [],
    'GV1-WITHDIR-SUPPRESS: the order-edge list is exactly empty');
  assert.strictEqual(
    result.edges.some((edge) => edge.kind === 'order' && edge.from === 'C-B' && edge.to === 'C-C'),
    false, 'GV1-WITHDIR-SUPPRESS: specifically no C-B -> C-C ghost edge');
  assert.ok(result.edges.some((edge) => edge.kind === 'depends' && edge.from === 'C-B' && edge.to === 'C-C'),
    'the real C-B -> C-C depends edge is intact — suppression removed only the ghost');
});

test('case 15: GV1-WAITREASON-PRECEDENCE — resume_condition wins verbatim over unmet deps', () => {
  // A parked slice carrying BOTH a resume_condition and an unmet dependency
  // surfaces the resume_condition verbatim. Kills the precedence-swap mutant
  // that reports unmet dependencies first.
  const result = layout.layoutGraph([
    slice('PR-0'),
    slice('PR-1', {
      status: 'parked',
      resume_condition: 'Resume after the design review sign-off',
      depends_on: ['PR-0'],
    }),
    slice('PR-2', { status: 'blocked', depends_on: ['PR-0'] }),
  ], { laneOrder: ['PR-0', 'PR-1', 'PR-2'] });
  const why = reasons(result);
  assert.strictEqual(why.get('PR-1'), 'Resume after the design review sign-off',
    'GV1-WAITREASON-PRECEDENCE: resume_condition first, verbatim, despite the unmet dependency');
  assert.strictEqual(why.get('PR-2'), 'waiting on: PR-0',
    'without a resume_condition the unmet dependency names surface');
});

let failures = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`  PASS — ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL — ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}
console.log(`\ngraph-layout: ${cases.length - failures}/${cases.length} passed`);
process.exit(failures ? 1 : 0);
