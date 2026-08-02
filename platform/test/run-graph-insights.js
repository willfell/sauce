#!/usr/bin/env node
'use strict';

// run-graph-insights.js — behavioral harness for the pure GraphInsights core.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const HELPER = path.join(ROOT, 'platform/blueprints/project/helpers/graph-insights.js');
const MANIFEST = path.join(ROOT, 'platform/blueprints/project/manifest.json');
const PACKAGE = path.join(ROOT, 'package.json');
const source = fs.readFileSync(HELPER, 'utf8');
const GraphInsights = eval(`(${source})`); // eslint-disable-line no-eval
const insights = new GraphInsights();
const empty = {
  perNode: {},
  summary: { stuckCount: 0, rootBlockers: [], gatedTotal: 0 },
};

const cases = [];
function test(name, fn) { cases.push([name, fn]); }
function node(card, status, extra = {}) { return { card, status, ...extra }; }
function depends(from, to) { return { from, to, kind: 'depends' }; }

test('case 1: exact chain closures, gates, and stuck summary', () => {
  const result = insights.analyzeGraph([
    node('A', 'blocked'), node('B', 'planning'), node('C', 'planning'), node('D', 'parked'),
  ], [depends('A', 'B'), depends('B', 'C')]);
  assert.deepStrictEqual(result.perNode.A,
    { upstream: [], downstream: ['B', 'C'], gates: 2, isRootBlocker: true });
  assert.deepStrictEqual(result.perNode.B,
    { upstream: ['A'], downstream: ['C'], gates: 1, isRootBlocker: false });
  assert.deepStrictEqual(result.perNode.C,
    { upstream: ['A', 'B'], downstream: [], gates: 0, isRootBlocker: false });
  assert.deepStrictEqual(result.perNode.D,
    { upstream: [], downstream: [], gates: 0, isRootBlocker: true });
  assert.deepStrictEqual(result.summary,
    { stuckCount: 2, rootBlockers: ['A', 'D'], gatedTotal: 2 });
});

test('case 2: a stuck transitive descendant is not a root blocker', () => {
  // Mutation guard: flagging every stuck node as a root blocker makes Y fail.
  const result = insights.analyzeGraph([
    node('X', 'blocked'), node('Y', 'parked'),
  ], [depends('X', 'Y')]);
  assert.deepStrictEqual(result.summary.rootBlockers, ['X']);
  assert.strictEqual(result.perNode.X.isRootBlocker, true);
  assert.strictEqual(result.perNode.Y.isRootBlocker, false);
  assert.strictEqual(result.summary.stuckCount, 2);
  assert.strictEqual(result.summary.gatedTotal, 1);
});

test('case 3: stubs propagate while stub/completed nodes are excluded from gates', () => {
  // Mutation guard: counting completed dependents changes A.gates from 1 to 2.
  const result = insights.analyzeGraph([
    node('A', 'blocked'),
    node('S', 'planning', { isStub: true }),
    node('B', 'planning'),
    node('C', 'completed'),
  ], [depends('A', 'S'), depends('S', 'B'), depends('B', 'C')]);
  assert.deepStrictEqual(result.perNode.A.downstream, ['S', 'B', 'C']);
  assert.deepStrictEqual(result.perNode.B.upstream, ['A', 'S']);
  assert.strictEqual(result.perNode.A.gates, 1,
    'the live B counts; the null-status stub and completed C do not');
  assert.strictEqual(result.perNode.S.gates, 1,
    'a stub can carry closure information even though no count includes the stub itself');
  assert.deepStrictEqual(result.summary,
    { stuckCount: 1, rootBlockers: ['A'], gatedTotal: 1 });
});

test('case 4: null-status non-stub nodes also propagate but never count', () => {
  const result = insights.analyzeGraph([
    node('A', 'blocked'), node('U', null), node('B', 'planning'),
  ], [depends('A', 'U'), depends('U', 'B')]);
  assert.deepStrictEqual(result.perNode.A.downstream, ['U', 'B']);
  assert.strictEqual(result.perNode.A.gates, 1);
  assert.strictEqual(result.summary.stuckCount, 1);
});

test('case 5: order edges contribute nothing to either closure', () => {
  // Mutation guard: propagating order-kind edges makes A reach B and C.
  const result = insights.analyzeGraph([
    node('A', 'blocked'), node('B', 'planning'), node('C', 'planning'),
  ], [{ from: 'A', to: 'B', kind: 'order' }, depends('B', 'C')]);
  assert.deepStrictEqual(result.perNode.A.downstream, []);
  assert.deepStrictEqual(result.perNode.B.upstream, []);
  assert.deepStrictEqual(result.perNode.B.downstream, ['C']);
  assert.deepStrictEqual(result.summary,
    { stuckCount: 1, rootBlockers: ['A'], gatedTotal: 0 });
});

test('case 6: parked is stuck and shared gated descendants count once', () => {
  // Mutation guard: treating parked as healthy drops P and changes all summary values.
  const result = insights.analyzeGraph([
    node('A', 'blocked'), node('P', 'parked'), node('Z', 'planning'),
  ], [depends('A', 'Z'), depends('P', 'Z')]);
  assert.deepStrictEqual(result.summary,
    { stuckCount: 2, rootBlockers: ['A', 'P'], gatedTotal: 1 });
});

test('case 7: dependency cycles terminate and never include self in closures', () => {
  const result = insights.analyzeGraph([
    node('A', 'blocked'), node('B', 'parked'), node('C', 'planning'),
  ], [depends('A', 'B'), depends('B', 'A'), depends('B', 'C')]);
  assert.deepStrictEqual(result.perNode.A.upstream, ['B']);
  assert.deepStrictEqual(result.perNode.A.downstream, ['B', 'C']);
  assert.deepStrictEqual(result.summary.rootBlockers, [],
    'each stuck cycle member has a stuck transitive ancestor');
});

test('case 8: malformed input always returns the exact empty result', () => {
  const malformed = [
    [null, []],
    [[], null],
    [[{}], []],
    [[{ card: 'A' }], []],
    [[node('', 'planning')], []],
    [[node('A', 42)], []],
    [[node('A', 'planning'), node('A', 'blocked')], []],
    [[node('A', 'planning')], [{}]],
    [[node('A', 'planning')], [{ from: 'A', to: 'A', kind: 'depends' }]],
    [[node('A', 'planning')], [{ from: 'A', to: 'B', kind: 'depends' }]],
    [[node('A', 'planning')], [{ from: 'A', to: 'A', kind: 'unknown' }]],
  ];
  for (const [nodes, edges] of malformed) {
    assert.doesNotThrow(() => insights.analyzeGraph(nodes, edges));
    assert.deepStrictEqual(insights.analyzeGraph(nodes, edges), empty);
  }
});

test('case 9: hostile property names remain safe plain-object keys', () => {
  const result = insights.analyzeGraph([
    node('__proto__', 'blocked'), node('constructor', 'planning'),
  ], [depends('__proto__', 'constructor')]);
  assert.strictEqual(Object.getPrototypeOf(result.perNode), Object.prototype);
  assert.strictEqual(result.perNode.__proto__.gates, 1);
  assert.deepStrictEqual(result.perNode.constructor.upstream, ['__proto__']);
});

test('case 10: purity — helper source references no host or I/O surface', () => {
  for (const forbidden of [
    /\bapp\b/, /\bdv\b/, /dataview/i, /customjs/i, /\brequire\b/,
    /\bglobalThis\b/, /\bwindow\b/, /\bmodule\b/, /\bprocess\b/,
    /\bvault\b/i, /\bplugin\b/i, /\bfetch\b/, /XMLHttpRequest/,
  ]) {
    assert.strictEqual(forbidden.test(source), false,
      `graph-insights.js must not reference ${forbidden} — the analysis core is pure`);
  }
  assert.ok(/^class GraphInsights\b/m.test(source), 'file is a bare customJS-loadable class');
});

test('case 11: manifest and preflight register GraphInsights exactly once', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));
  assert.strictEqual(manifest.customjs_classes.filter((name) => name === 'GraphInsights').length, 1);
  assert.strictEqual(manifest.files.filter((entry) => entry.source === 'helpers/graph-insights.js'
    && entry.dest === '{{scripts_path}}/project/graph-insights.js').length, 1);
  assert.strictEqual(packageJson.scripts['test:graph-insights'],
    'node platform/test/run-graph-insights.js');
  assert.ok(packageJson.scripts['release:preflight'].includes(
    'node platform/test/run-graph-layout.js && node platform/test/run-graph-view.js && node platform/test/run-graph-insights.js'));
  assert.strictEqual((packageJson.scripts['release:preflight'].match(/run-graph-insights\.js/g) || []).length, 1);
});

test('case 12: required behavioral mutants are executable and turn red', () => {
  const mutated = (from, to) => {
    assert.ok(source.includes(from), `mutation anchor is present: ${from}`);
    const Mutant = eval(`(${source.replace(from, to)})`); // eslint-disable-line no-eval
    return new Mutant();
  };
  const expectRed = (label, instance, nodes, edges, check) => {
    assert.throws(() => check(instance.analyzeGraph(nodes, edges)),
      assert.AssertionError, `${label} must violate its binding assertion`);
  };

  expectRed(
    'count completed dependents',
    mutated('record && !record.isStub && record.status !== "completed"', 'record && !record.isStub'),
    [node('A', 'blocked'), node('C', 'completed')],
    [depends('A', 'C')],
    (result) => assert.strictEqual(result.perNode.A.gates, 0),
  );
  expectRed(
    'treat parked as healthy',
    mutated(
      '(record.status === "blocked" || record.status === "parked")',
      '(record.status === "blocked")',
    ),
    [node('P', 'parked')],
    [],
    (result) => assert.deepStrictEqual(result.summary.rootBlockers, ['P']),
  );
  expectRed(
    'propagate order edges',
    mutated('if (edge.kind === "order") continue;', 'if (false) continue;'),
    [node('A', 'blocked'), node('B', 'planning')],
    [{ from: 'A', to: 'B', kind: 'order' }],
    (result) => assert.deepStrictEqual(result.perNode.A.downstream, []),
  );
  expectRed(
    'flag every stuck node as a root blocker',
    mutated(
      'const isRootBlocker = stuck(record) && !above.some((card) => stuck(records.get(card)));',
      'const isRootBlocker = stuck(record);',
    ),
    [node('X', 'blocked'), node('Y', 'parked')],
    [depends('X', 'Y')],
    (result) => assert.deepStrictEqual(result.summary.rootBlockers, ['X']),
  );
  expectRed(
    'conflate explicit stubs with null-status nodes',
    mutated(
      'node.isStub === true || status === null',
      'status === null',
    ),
    [node('A', 'blocked'), node('S', 'planning', { isStub: true }), node('B', 'planning')],
    [depends('A', 'S'), depends('S', 'B')],
    (result) => assert.strictEqual(result.perNode.A.gates, 1),
  );
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
console.log(`\ngraph-insights: ${cases.length - failures}/${cases.length} passed`);
process.exit(failures ? 1 : 0);
