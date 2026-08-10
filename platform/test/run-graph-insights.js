#!/usr/bin/env node
'use strict';

// run-graph-insights.js — behavioral harness for the pure GraphInsights core.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const HELPER = path.join(ROOT, 'platform/blueprints/project/helpers/graph-insights.js');
const MANIFEST = path.join(ROOT, 'platform/blueprints/project/manifest.json');
const PACKAGE = path.join(ROOT, 'package.json');
const source = fs.readFileSync(HELPER, 'utf8');
const PURITY_FORBIDDEN = [
  /\bapp\b/, /\bdv\b/, /dataview/i, /customjs/i, /\brequire\b/,
  /\bglobalThis\b/, /\bwindow\b/, /\bmodule\b/, /\bprocess\b/,
  /\bvault\b/i, /\bplugin\b/i, /\bfetch\b/, /XMLHttpRequest/,
  /\bconstructor\b/, /\beval\b/, /\bFunction\b/, /\bDate\b/,
  /\bMath\b/, /\bperformance\b/, /\bcrypto\b/,
  /\bIntl\b/, /\bTemporal\b/, /\bAtomics\b/, /\bconsole\b/,
  /\bsetTimeout\b/, /\bsetInterval\b/, /\bqueueMicrotask\b/,
  /\bRegExp\b/,
];
const LOCKED_GLOBALS = Object.freeze({
  Date: undefined,
  Math: undefined,
  Intl: undefined,
  Temporal: undefined,
  Atomics: undefined,
  performance: undefined,
  crypto: undefined,
  console: undefined,
  process: undefined,
  require: undefined,
  fetch: undefined,
  setTimeout: undefined,
  setInterval: undefined,
  queueMicrotask: undefined,
  RegExp: undefined,
});
function lockedRealm() { return Object.assign(Object.create(null), LOCKED_GLOBALS); }
function strictRealm() {
  const reads = [];
  const allowed = { Object, Array, Map, Set };
  const realm = new Proxy(Object.create(null), {
    get(_target, property) {
      const name = String(property);
      reads.push(name);
      if (Object.prototype.hasOwnProperty.call(allowed, name)) return allowed[name];
      throw new Error(`disallowed production global: ${name}`);
    },
  });
  vm.createContext(realm, { codeGeneration: { strings: false, wasm: false } });
  return { realm, reads };
}
function executableSource(candidate) {
  return candidate
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '');
}
function assertPropertyAuthorities(candidate) {
  const authorityStart = candidate.indexOf('const status =');
  const authorityEnd = candidate.indexOf('      }\n\n      const downstream', authorityStart);
  assert.ok(authorityStart >= 0 && authorityEnd > authorityStart,
    'the canonical node-record authority block must be present');
  assert.strictEqual(candidate.slice(authorityStart, authorityEnd).trim(), [
    'const status = node.status === null ? null : node.status.trim().toLowerCase();',
    '        if (status === "") return empty;',
    '        const record = { card, status, isStub: node.isStub === true || status === null };',
    '        order.set(card, order.size);',
    '        records.set(card, record);',
  ].join('\n'), 'status normalization and record order have one canonical input-only authority');

  const intrinsicUsages = [...executableSource(candidate)
    .matchAll(/\b(?:Object|Array|Map|Set)(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/g)]
    .map((match) => match[0]);
  assert.deepStrictEqual(intrinsicUsages, [
    'Set', 'Map',
    'Array.isArray', 'Array.isArray', 'Map', 'Map', 'Array.isArray',
    'Object.prototype.hasOwnProperty.call',
    'Map', 'Map', 'Set', 'Array.isArray', 'Map', 'Object.defineProperty', 'Set',
  ], 'production intrinsic reads are limited to the exact required operations in source order');
}
const GraphInsights = eval(`(${source})`); // eslint-disable-line no-eval
const insights = new GraphInsights();
const empty = {
  perNode: {},
  summary: {
    stuckCount: 0,
    rootBlockers: [],
    gatedTotal: 0,
    readyCount: 0,
    needsYouCount: 0,
    blockedCount: 0,
  },
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
    {
      upstream: [], downstream: ['B', 'C'], gates: 2, isRootBlocker: true,
      isReady: false, rootCauses: [],
    });
  assert.deepStrictEqual(result.perNode.B,
    {
      upstream: ['A'], downstream: ['C'], gates: 1, isRootBlocker: false,
      isReady: false, rootCauses: [{ card: 'A', hops: 1 }],
    });
  assert.deepStrictEqual(result.perNode.C,
    {
      upstream: ['A', 'B'], downstream: [], gates: 0, isRootBlocker: false,
      isReady: false, rootCauses: [{ card: 'A', hops: 2 }],
    });
  assert.deepStrictEqual(result.perNode.D,
    {
      upstream: [], downstream: [], gates: 0, isRootBlocker: true,
      isReady: false, rootCauses: [],
    });
  assert.deepStrictEqual(result.summary,
    {
      stuckCount: 2, rootBlockers: ['A', 'D'], gatedTotal: 2,
      readyCount: 0, needsYouCount: 1, blockedCount: 1,
    });
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
    {
      stuckCount: 1, rootBlockers: ['A'], gatedTotal: 1,
      readyCount: 0, needsYouCount: 0, blockedCount: 1,
    });
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
    {
      stuckCount: 1, rootBlockers: ['A'], gatedTotal: 0,
      readyCount: 1, needsYouCount: 0, blockedCount: 1,
    });
});

test('case 6: parked is stuck and shared gated descendants count once', () => {
  // Mutation guard: treating parked as healthy drops P and changes all summary values.
  const result = insights.analyzeGraph([
    node('A', 'blocked'), node('P', 'parked'), node('Z', 'planning'),
  ], [depends('A', 'Z'), depends('P', 'Z')]);
  assert.deepStrictEqual(result.summary,
    {
      stuckCount: 2, rootBlockers: ['A', 'P'], gatedTotal: 1,
      readyCount: 0, needsYouCount: 1, blockedCount: 1,
    });
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
    [[null], []],
    [[[]], []],
    [[{}], []],
    [[{ card: 'A' }], []],
    [[node('', 'planning')], []],
    [[node('A', 42)], []],
    [[node('A', '   ')], []],
    [[node('A', 'planning'), node('A', 'blocked')], []],
    [[node('A', 'planning', { isStub: 'yes' })], []],
    [[node('A', 'planning')], [null]],
    [[node('A', 'planning')], [[]]],
    [[node('A', 'planning')], [{}]],
    [[node('A', 'planning')], [{ from: '', to: 'A', kind: 'depends' }]],
    [[node('A', 'planning')], [{ from: 'A', to: '', kind: 'depends' }]],
    [[node('A', 'planning')], [{ from: 'A', to: 'A', kind: 'depends' }]],
    [[node('A', 'planning')], [{ from: 'A', to: 'B', kind: 'depends' }]],
    [[node('A', 'planning'), node('B', 'planning')], [{ from: 'A', to: 'B' }]],
    [[node('A', 'planning'), node('B', 'planning')], [{ from: 'A', to: 'B', kind: 42 }]],
    [[node('A', 'planning'), node('B', 'planning')], [{ from: 'A', to: 'B', kind: 'unknown' }]],
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
  for (const forbidden of PURITY_FORBIDDEN) {
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
  const mutateSource = (from, to) => {
    assert.ok(source.includes(from), `mutation anchor is present: ${from}`);
    return source.replace(from, to);
  };
  const mutated = (from, to) => {
    const Mutant = eval(`(${mutateSource(from, to)})`); // eslint-disable-line no-eval
    return new Mutant();
  };
  const lockedMutant = (from, to) => {
    const Mutant = vm.runInNewContext(`(${mutateSource(from, to)})`, lockedRealm(), {
      contextCodeGeneration: { strings: false, wasm: false },
    });
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

  const readinessFixture = [
    node('A', 'completed'), node('B', 'planning'), node('C', 'planning'),
    node('D', 'parked'), node('E', 'blocked'),
  ];
  const readinessEdges = [depends('A', 'B'), depends('B', 'C'), depends('D', 'E')];
  expectRed(
    'count a parked node as ready',
    mutated('&& !stuck(record)', '&& true'),
    readinessFixture,
    readinessEdges,
    (result) => assert.strictEqual(result.perNode.D.isReady, false),
  );
  expectRed(
    'measure root-cause hops as closure cardinality',
    mutated('depths.set(card, hops);', 'depths.set(card, depths.size + 1);'),
    [node('R', 'blocked'), node('M', 'planning'), node('Q', 'completed'), node('L', 'planning')],
    [depends('R', 'M'), depends('M', 'L'), depends('Q', 'L')],
    (result) => assert.deepStrictEqual(result.perNode.L.rootCauses, [{ card: 'R', hops: 2 }]),
  );
  expectRed(
    'see through an explicit stub ancestor',
    mutated('ancestor && !ancestor.isStub && ancestor.status === "completed"',
      'ancestor && ancestor.status === "completed"'),
    [node('S', 'completed', { isStub: true }), node('N', 'planning')],
    [depends('S', 'N')],
    (result) => assert.strictEqual(result.perNode.N.isReady, false),
  );
  expectRed(
    'rename a shipped summary field',
    mutated('stuckCount: [...records.values()].filter(stuck).length,',
      'legacyStuckCount: [...records.values()].filter(stuck).length,'),
    [node('A', 'blocked')],
    [],
    (result) => assert.strictEqual(result.summary.stuckCount, 1),
  );

  expectRed(
    'check only direct prerequisites for readiness',
    mutated('above.every((card) => {', '(upstream.get(record.card) || []).every((card) => {'),
    [
      node('S', 'completed', { isStub: true }), node('M', 'completed'), node('N', 'planning'),
      node('A', 'planning'), node('B', 'completed'), node('C', 'planning'),
    ],
    [depends('S', 'M'), depends('M', 'N'), depends('A', 'B'), depends('B', 'C')],
    (result) => {
      assert.strictEqual(result.perNode.N.isReady, false, 'transitive stub must remain visible');
      assert.strictEqual(result.perNode.C.isReady, false, 'transitive incomplete work must remain visible');
    },
  );
  expectRed(
    'use depth-first pop instead of shortest-path BFS',
    mutated('const { card, hops } = queue.shift();', 'const { card, hops } = queue.pop();'),
    [
      node('R', 'blocked'), node('S', 'planning'), node('A', 'planning'),
      node('B', 'planning'), node('L', 'planning'),
    ],
    [
      depends('R', 'S'), depends('S', 'L'),
      depends('R', 'A'), depends('A', 'B'), depends('B', 'L'),
    ],
    (result) => assert.deepStrictEqual(result.perNode.L.rootCauses, [{ card: 'R', hops: 2 }]),
  );
  expectRed(
    'attribute every upstream stuck node instead of roots only',
    mutated('perNode[card].isRootBlocker', 'stuck(records.get(card))'),
    [node('R', 'blocked'), node('P', 'parked'), node('N', 'planning')],
    [depends('R', 'P'), depends('P', 'N')],
    (result) => assert.deepStrictEqual(result.perNode.N.rootCauses, [{ card: 'R', hops: 2 }]),
  );
  expectRed(
    'reverse root-cause record order',
    mutated(
      '.filter(({ card }) => perNode[card].isRootBlocker)\n          .map',
      '.filter(({ card }) => perNode[card].isRootBlocker)\n          .reverse()\n          .map',
    ),
    [node('A', 'blocked'), node('P', 'parked'), node('N', 'planning')],
    [depends('A', 'N'), depends('P', 'N')],
    (result) => assert.deepStrictEqual(result.perNode.N.rootCauses, [
      { card: 'A', hops: 1 }, { card: 'P', hops: 1 },
    ]),
  );
  expectRed(
    'count parked stubs as needing the Director',
    mutated('!record.isStub && record.status === "parked"', 'record.status === "parked"'),
    [node('P', 'parked', { isStub: true })],
    [],
    (result) => assert.strictEqual(result.summary.needsYouCount, 0),
  );
  expectRed(
    'count blocked stubs as blocked work',
    mutated('!record.isStub && record.status === "blocked"', 'record.status === "blocked"'),
    [node('B', 'blocked', { isStub: true })],
    [],
    (result) => assert.strictEqual(result.summary.blockedCount, 0),
  );
  expectRed(
    'swap observable legacy per-node key order',
    mutated(
      'gates: below.filter((card) => eligible(records.get(card))).length,\n            isRootBlocker,',
      'isRootBlocker,\n            gates: below.filter((card) => eligible(records.get(card))).length,',
    ),
    [node('A', 'planning')],
    [],
    (result) => assert.deepStrictEqual(Object.keys(result.perNode.A).slice(0, 4),
      ['upstream', 'downstream', 'gates', 'isRootBlocker']),
  );
  expectRed(
    'sort root causes by hop distance',
    mutated(
      '.filter(({ card }) => perNode[card].isRootBlocker)\n          .map',
      '.filter(({ card }) => perNode[card].isRootBlocker)\n          .sort((left, right) => left.hops - right.hops)\n          .map',
    ),
    [node('F', 'blocked'), node('N', 'parked'), node('M', 'planning'), node('L', 'planning')],
    [depends('F', 'M'), depends('M', 'L'), depends('N', 'L')],
    (result) => assert.deepStrictEqual(result.perNode.L.rootCauses, [
      { card: 'F', hops: 2 }, { card: 'N', hops: 1 },
    ]),
  );
  expectRed(
    'return the legacy shape for a valid empty graph',
    mutated(
      'if (!Array.isArray(nodes) || !Array.isArray(edges)) return empty;',
      'if (nodes.length === 0 && edges.length === 0) return { perNode: {}, summary: { stuckCount: 0, rootBlockers: [], gatedTotal: 0 } };\n      if (!Array.isArray(nodes) || !Array.isArray(edges)) return empty;',
    ),
    [],
    [],
    (result) => assert.deepStrictEqual(result, empty),
  );
  const hostile = { card: 'X' };
  Object.defineProperty(hostile, 'status', { get() { throw new Error('hostile getter'); } });
  expectRed(
    'return the legacy shape from catch',
    mutated(
      '} catch (_e) {\n      return empty;',
      '} catch (_e) {\n      return { perNode: {}, summary: { stuckCount: 0, rootBlockers: [], gatedTotal: 0 } };',
    ),
    [hostile],
    [],
    (result) => assert.deepStrictEqual(result, empty),
  );
  expectRed(
    'exclude in-progress dependents from legacy gates',
    mutated(
      'below.filter((card) => eligible(records.get(card))).length',
      'below.filter((card) => eligible(records.get(card)) && records.get(card).status !== "in_progress").length',
    ),
    [node('R', 'blocked'), node('I', 'in_progress')],
    [depends('R', 'I')],
    (result) => assert.strictEqual(result.perNode.R.gates, 1),
  );
  expectRed(
    'make the legacy per-node descriptor non-writable',
    mutated('writable: true,', 'writable: false,'),
    [node('A', 'planning')],
    [],
    (result) => assert.strictEqual(Object.getOwnPropertyDescriptor(result.perNode, 'A').writable, true),
  );
  for (const [label, expression] of [
    ['direct constructor host access', '({}).constructor.constructor("return glo" + "balThis")();'],
    ['computed constructor host access', '[]["filter"]["con" + "structor"]("return glo" + "balThis")();'],
  ]) {
    expectRed(
      label,
      lockedMutant('try {', `try {\n      ${expression}`),
      [node('R', 'planning')],
      [],
      (result) => assert.strictEqual(result.summary.readyCount, 1),
    );
  }
  expectRed(
    'insert BFS neighbors behind an existing queued branch',
    mutated(
      'queue.push({ card: next, hops: hops + 1 })',
      'queue.splice(1, 0, { card: next, hops: hops + 1 })',
    ),
    [
      node('R', 'blocked'), node('A', 'planning'), node('B', 'planning'),
      node('X', 'completed'), node('S', 'planning'), node('L', 'planning'),
    ],
    [
      depends('R', 'A'), depends('A', 'B'), depends('B', 'L'),
      depends('X', 'L'), depends('R', 'S'), depends('S', 'L'),
    ],
    (result) => assert.deepStrictEqual(result.perNode.L.rootCauses, [{ card: 'R', hops: 2 }]),
  );
  expectRed(
    'return the legacy shape from invalid isStub validation',
    mutated(
      'if (node.isStub !== undefined && typeof node.isStub !== "boolean") return empty;',
      'if (node.isStub !== undefined && typeof node.isStub !== "boolean") return { perNode: {}, summary: { stuckCount: 0, rootBlockers: [], gatedTotal: 0 } };',
    ),
    [node('A', 'planning', { isStub: 'yes' })],
    [],
    (result) => assert.deepStrictEqual(result, empty),
  );
  for (const status of ['archived', 'discarded']) {
    expectRed(
      `exclude ${status} dependents from legacy gates`,
      mutated(
        'below.filter((card) => eligible(records.get(card))).length',
        `below.filter((card) => eligible(records.get(card)) && records.get(card).status !== "${status}").length`,
      ),
      [node('R', 'blocked'), node('D', status)],
      [depends('R', 'D')],
      (result) => assert.strictEqual(result.perNode.R.gates, 1),
    );
  }
  const dateMutant = mutateSource('try {', 'try {\n      Date["n" + "ow"]();');
  assert.strictEqual(PURITY_FORBIDDEN.some((pattern) => pattern.test(dateMutant)), true,
    'computed Date.now access must be rejected by the purity source contract');

  for (const [label, mutant] of [
    [
      'remap an arbitrary normalized status to completed',
      mutateSource(
        'const status = node.status === null ? null : node.status.trim().toLowerCase();',
        'let status = node.status === null ? null : node.status.trim().toLowerCase();\n'
          + '        if (status === "zebra") status = "completed";',
      ),
    ],
    [
      'derive record order from an arbitrary node attribute',
      mutateSource('order.set(card, order.size);', 'order.set(card, node.priority ?? order.size);'),
    ],
    [
      'read mutable state from a permitted intrinsic prototype',
      mutateSource('try {', 'try {\n      if (Object.prototype.__graphInsightsForceEmpty) return empty;'),
    ],
  ]) {
    assert.throws(() => assertPropertyAuthorities(mutant), assert.AssertionError,
      `${label} must violate the property-authority source contract`);
  }
});

test('case 13: readiness, triage counts, and direct root attribution are exact', () => {
  const result = insights.analyzeGraph([
    node('A', 'completed'), node('B', 'planning'), node('C', 'planning'),
    node('D', 'parked'), node('E', 'blocked'),
  ], [depends('A', 'B'), depends('B', 'C'), depends('D', 'E')]);
  assert.strictEqual(result.perNode.A.isReady, false, 'completed work is never ready');
  assert.strictEqual(result.perNode.B.isReady, true, 'B has only a completed prerequisite');
  assert.strictEqual(result.perNode.C.isReady, false, 'B is not completed yet');
  assert.strictEqual(result.perNode.D.isReady, false, 'parked work needs the Director');
  assert.strictEqual(result.perNode.E.isReady, false, 'blocked work is not ready');
  assert.deepStrictEqual(result.perNode.C.rootCauses, []);
  assert.deepStrictEqual(result.perNode.E.rootCauses, [{ card: 'D', hops: 1 }]);
  assert.deepStrictEqual(result.summary, {
    stuckCount: 2,
    rootBlockers: ['D'],
    gatedTotal: 1,
    readyCount: 1,
    needsYouCount: 1,
    blockedCount: 1,
  });
});

test('case 14: root-cause hops use shortest BFS depth through a three-deep chain', () => {
  const result = insights.analyzeGraph([
    node('R', 'blocked'), node('M', 'planning'), node('L', 'planning'), node('W', 'planning'),
  ], [depends('R', 'M'), depends('M', 'L'), depends('R', 'W'), depends('W', 'L')]);
  assert.deepStrictEqual(result.perNode.L.rootCauses, [{ card: 'R', hops: 2 }]);
});

test('case 15: a stub anywhere upstream makes readiness conservative', () => {
  const result = insights.analyzeGraph([
    node('S', 'completed', { isStub: true }), node('M', 'completed'), node('N', 'planning'),
  ], [depends('S', 'M'), depends('M', 'N')]);
  assert.strictEqual(result.perNode.S.isReady, false, 'stubs are never ready');
  assert.strictEqual(result.perNode.M.isReady, false, 'a direct upstream stub prevents readiness');
  assert.strictEqual(result.perNode.N.isReady, false, 'a transitive upstream stub prevents readiness');
  assert.deepStrictEqual(result.perNode.N.rootCauses, [], 'stubs never become root causes');
  assert.strictEqual(result.summary.readyCount, 0);
});

test('case 16: unequal alternate paths retain the shortest BFS hop distance', () => {
  const result = insights.analyzeGraph([
    node('R', 'blocked'), node('S', 'planning'), node('A', 'planning'),
    node('B', 'planning'), node('L', 'planning'),
  ], [
    depends('R', 'S'), depends('S', 'L'),
    depends('R', 'A'), depends('A', 'B'), depends('B', 'L'),
  ]);
  assert.deepStrictEqual(result.perNode.L.rootCauses, [{ card: 'R', hops: 2 }]);
});

test('case 17: only upstream root blockers are attributed', () => {
  const result = insights.analyzeGraph([
    node('R', 'blocked'), node('P', 'parked'), node('N', 'planning'),
  ], [depends('R', 'P'), depends('P', 'N')]);
  assert.deepStrictEqual(result.perNode.N.rootCauses, [{ card: 'R', hops: 2 }],
    'the nested parked blocker is stuck but is not a root cause');
});

test('case 18: root-cause order follows records rather than hop distance', () => {
  const result = insights.analyzeGraph([
    node('F', 'blocked'), node('N', 'parked'), node('M', 'planning'), node('L', 'planning'),
  ], [depends('F', 'M'), depends('M', 'L'), depends('N', 'L')]);
  assert.deepStrictEqual(result.perNode.L.rootCauses, [
    { card: 'F', hops: 2 }, { card: 'N', hops: 1 },
  ]);
});

test('case 19: parked and blocked stubs never enter Director triage counts', () => {
  const result = insights.analyzeGraph([
    node('PS', 'parked', { isStub: true }),
    node('BS', 'blocked', { isStub: true }),
    node('R', 'planning'),
  ], []);
  assert.strictEqual(result.summary.needsYouCount, 0);
  assert.strictEqual(result.summary.blockedCount, 0);
  assert.strictEqual(result.summary.stuckCount, 0);
  assert.strictEqual(result.summary.readyCount, 1);
});

test('case 20: additive fields preserve legacy keys and property descriptors', () => {
  const result = insights.analyzeGraph([node('A', 'planning')], []);
  assert.deepStrictEqual(Object.keys(result.perNode.A), [
    'upstream', 'downstream', 'gates', 'isRootBlocker', 'isReady', 'rootCauses',
  ]);
  assert.deepStrictEqual(Object.keys(result.summary), [
    'stuckCount', 'rootBlockers', 'gatedTotal', 'readyCount', 'needsYouCount', 'blockedCount',
  ]);
  assert.deepStrictEqual(Object.keys(empty.summary), Object.keys(result.summary));
  const descriptor = Object.getOwnPropertyDescriptor(result.perNode, 'A');
  assert.strictEqual(descriptor.configurable, true);
  assert.strictEqual(descriptor.enumerable, true);
  assert.strictEqual(descriptor.writable, true);
});

test('case 21: readiness uses the transitive closure, not completed direct prerequisites only', () => {
  const result = insights.analyzeGraph([
    node('A', 'planning'), node('B', 'completed'), node('C', 'planning'),
  ], [depends('A', 'B'), depends('B', 'C')]);
  assert.strictEqual(result.perNode.C.isReady, false,
    'the incomplete transitive ancestor A keeps C out of the ready set');
});

test('case 22: valid empty input and thrown getters share the complete empty shape', () => {
  assert.deepStrictEqual(insights.analyzeGraph([], []), empty);
  const hostile = { card: 'X' };
  Object.defineProperty(hostile, 'status', {
    enumerable: true,
    get() { throw new Error('hostile getter'); },
  });
  assert.doesNotThrow(() => insights.analyzeGraph([hostile], []));
  assert.deepStrictEqual(insights.analyzeGraph([hostile], []), empty);
});

test('case 23: in-progress dependents retain the shipped gates semantics', () => {
  const result = insights.analyzeGraph([
    node('R', 'blocked'), node('I', 'in_progress'),
  ], [depends('R', 'I')]);
  assert.strictEqual(result.perNode.R.gates, 1);
  assert.strictEqual(result.summary.gatedTotal, 1);
});

test('case 24: locked evaluation rejects computed dynamic host access', () => {
  const LockedGraphInsights = vm.runInNewContext(`(${source})`, lockedRealm(), {
    contextCodeGeneration: { strings: false, wasm: false },
  });
  const locked = new LockedGraphInsights();
  const result = locked.analyzeGraph([node('R', 'planning')], []);
  assert.strictEqual(result.perNode.R.isReady, true,
    'the pure helper remains functional when dynamic code generation is unavailable');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result.summary)), {
    stuckCount: 0,
    rootBlockers: [],
    gatedTotal: 0,
    readyCount: 1,
    needsYouCount: 0,
    blockedCount: 0,
  });
});

test('case 25: readiness sees incomplete ancestors beyond two hops', () => {
  const result = insights.analyzeGraph([
    node('A', 'planning'), node('B', 'completed'), node('C', 'completed'), node('D', 'planning'),
  ], [depends('A', 'B'), depends('B', 'C'), depends('C', 'D')]);
  assert.strictEqual(result.perNode.D.isReady, false);
});

test('case 26: queued branching cannot replace shortest-path BFS', () => {
  const result = insights.analyzeGraph([
    node('R', 'blocked'), node('A', 'planning'), node('B', 'planning'),
    node('X', 'completed'), node('S', 'planning'), node('L', 'planning'),
  ], [
    depends('R', 'A'), depends('A', 'B'), depends('B', 'L'),
    depends('X', 'L'), depends('R', 'S'), depends('S', 'L'),
  ]);
  assert.deepStrictEqual(result.perNode.L.rootCauses, [{ card: 'R', hops: 2 }]);
});

test('case 27: archived and discarded dependents retain legacy gates', () => {
  const result = insights.analyzeGraph([
    node('R', 'blocked'), node('A', 'archived'), node('D', 'discarded'),
  ], [depends('R', 'A'), depends('R', 'D')]);
  assert.strictEqual(result.perNode.R.gates, 2);
  assert.strictEqual(result.summary.gatedTotal, 2);
});

test('case 28: inner legacy fields retain writable descriptors', () => {
  const result = insights.analyzeGraph([node('A', 'planning')], []);
  const descriptor = Object.getOwnPropertyDescriptor(result.perNode.A, 'gates');
  assert.strictEqual(descriptor.configurable, true);
  assert.strictEqual(descriptor.enumerable, true);
  assert.strictEqual(descriptor.writable, true);
});

test('case 29: readiness quantifies over the full closure across generated depths', () => {
  for (let depth = 1; depth <= 12; depth += 1) {
    const ancestorCards = Array.from({ length: depth }, (_value, index) => `A${depth}-${index}`);
    const target = `T${depth}`;
    const edges = [];
    for (let index = 0; index < ancestorCards.length - 1; index += 1) {
      edges.push(depends(ancestorCards[index], ancestorCards[index + 1]));
    }
    edges.push(depends(ancestorCards[ancestorCards.length - 1], target));

    const incomplete = ancestorCards.map((card, index) => node(card, index === 0 ? 'planning' : 'completed'));
    const incompleteResult = insights.analyzeGraph([...incomplete, node(target, 'planning')], edges);
    assert.strictEqual(incompleteResult.perNode[target].isReady, false,
      `an incomplete ancestor ${depth} hop(s) away must prevent readiness`);

    const complete = ancestorCards.map((card) => node(card, 'completed'));
    const completeResult = insights.analyzeGraph([...complete, node(target, 'planning')], edges);
    assert.strictEqual(completeResult.perNode[target].isReady, true,
      `a fully completed ${depth}-hop closure must be ready`);

    const stubIndex = depth - 1;
    const withStub = complete.map((record, index) => (index === stubIndex
      ? node(record.card, 'completed', { isStub: true }) : record));
    const stubResult = insights.analyzeGraph([...withStub, node(target, 'planning')], edges);
    assert.strictEqual(stubResult.perNode[target].isReady, false,
      `a stub ${depth} hop(s) away must prevent readiness`);
  }

  const readinessStart = source.indexOf('const isReady =');
  const readinessEnd = source.indexOf('Object.defineProperty', readinessStart);
  const readinessSource = source.slice(readinessStart, readinessEnd);
  assert.ok(readinessSource.includes('above.every((card) => {'),
    'readiness must quantify over the complete ordered closure');
  assert.strictEqual(/\bhops\b/.test(readinessSource), false,
    'readiness must not contain a finite hop cutoff');
  assert.strictEqual(readinessSource.includes('upstream.get(record.card)'), false,
    'readiness must not collapse to direct prerequisites');
  assert.strictEqual((readinessSource.match(/above\.every\(\(card\) => \{/g) || []).length, 1,
    'readiness must have exactly one full-closure completion authority');
});

test('case 30: FIFO shortest paths survive generated depth and width matrices', () => {
  for (let longDepth = 3; longDepth <= 10; longDepth += 1) {
    for (let width = 3; width <= 8; width += 1) {
      const prefix = `D${longDepth}W${width}`;
      const root = `${prefix}-R`;
      const short = `${prefix}-S`;
      const leaf = `${prefix}-L`;
      const longNodes = Array.from({ length: longDepth - 1 },
        (_value, index) => `${prefix}-A${index}`);
      const fillers = Array.from({ length: width }, (_value, index) => `${prefix}-F${index}`);
      const nodes = [
        node(root, 'blocked'),
        ...longNodes.map((card) => node(card, 'planning')),
        ...fillers.map((card) => node(card, 'completed')),
        node(short, 'planning'),
        node(leaf, 'planning'),
      ];
      const edges = [depends(root, longNodes[0])];
      for (let index = 0; index < longNodes.length - 1; index += 1) {
        edges.push(depends(longNodes[index], longNodes[index + 1]));
      }
      edges.push(depends(longNodes[longNodes.length - 1], leaf));
      for (const filler of fillers) edges.push(depends(filler, leaf));
      edges.push(depends(root, short), depends(short, leaf));

      const result = insights.analyzeGraph(nodes, edges);
      assert.deepStrictEqual(result.perNode[leaf].rootCauses, [{ card: root, hops: 2 }],
        `shortest root attribution must survive depth ${longDepth} and width ${width}`);
    }
  }

  const closureStart = source.indexOf('_closure(');
  const closureEnd = source.indexOf('analyzeGraph(', closureStart);
  const closureSource = source.slice(closureStart, closureEnd);
  assert.strictEqual((closureSource.match(/queue\.shift\(\)/g) || []).length, 1,
    'the closure has one FIFO dequeue authority');
  assert.strictEqual((closureSource.match(/queue\.push\(/g) || []).length, 1,
    'the closure has one FIFO enqueue authority');
  for (const reorder of [/queue\.pop\(/, /queue\.unshift\(/, /queue\.splice\(/, /queue\.sort\(/, /queue\.reverse\(/]) {
    assert.strictEqual(reorder.test(closureSource), false,
      `the BFS queue must not contain reorder operation ${reorder}`);
  }
});

test('case 31: every non-completed non-stub status retains legacy gating', () => {
  const gatedStatuses = [
    'planning', 'in_progress', 'waiting', 'blocked', 'parked', 'archived', 'discarded', 'unknown',
  ];
  for (const status of gatedStatuses) {
    const result = insights.analyzeGraph([
      node('R', 'blocked'), node('D', status),
    ], [depends('R', 'D')]);
    assert.strictEqual(result.perNode.R.gates, 1, `${status} must remain gated`);
    assert.strictEqual(result.summary.gatedTotal, 1, `${status} must remain in gatedTotal`);
  }
  const completed = insights.analyzeGraph([
    node('R', 'blocked'), node('D', 'completed'),
  ], [depends('R', 'D')]);
  assert.strictEqual(completed.perNode.R.gates, 0);
  assert.strictEqual(completed.summary.gatedTotal, 0);
});

test('case 32: all legacy per-node properties retain exact descriptors', () => {
  const result = insights.analyzeGraph([
    node('A', 'blocked'), node('B', 'planning'),
  ], [depends('A', 'B')]);
  for (const field of ['upstream', 'downstream', 'gates', 'isRootBlocker']) {
    const descriptor = Object.getOwnPropertyDescriptor(result.perNode.A, field);
    assert.deepStrictEqual({
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      writable: descriptor.writable,
    }, { configurable: true, enumerable: true, writable: true },
    `legacy ${field} descriptor must remain an ordinary writable data property`);
  }
});

test('case 33: nondeterministic runtime sources are rejected structurally', () => {
  for (const expression of [
    'Date["n" + "ow"]()',
    'Math["ran" + "dom"]()',
    'performance["n" + "ow"]()',
    'crypto["get" + "RandomValues"]([])',
    'Intl["Da" + "teTimeFormat"]().format()',
  ]) {
    const mutant = source.replace('try {', `try {\n      ${expression};`);
    assert.strictEqual(PURITY_FORBIDDEN.some((pattern) => pattern.test(mutant)), true,
      `${expression} must be rejected by the purity source contract`);
  }
});

test('case 34: no non-completed ancestor status can satisfy readiness', () => {
  const nonCompleted = [
    'planning', 'in_progress', 'waiting', 'blocked', 'parked', 'archived', 'discarded', 'unknown',
  ];
  for (const status of nonCompleted) {
    const result = insights.analyzeGraph([
      node('A', status), node('T', 'planning'),
    ], [depends('A', 'T')]);
    assert.strictEqual(result.perNode.T.isReady, false,
      `${status} ancestry must not satisfy readiness`);
  }
});

test('case 35: root-cause record order is independent of blocker status', () => {
  const result = insights.analyzeGraph([
    node('P', 'parked'), node('B', 'blocked'), node('T', 'planning'),
  ], [depends('P', 'T'), depends('B', 'T')]);
  assert.deepStrictEqual(result.perNode.T.rootCauses, [
    { card: 'P', hops: 1 }, { card: 'B', hops: 1 },
  ]);
});

test('case 36: legacy summary fields retain ordinary data descriptors', () => {
  const result = insights.analyzeGraph([node('A', 'blocked')], []);
  for (const field of ['stuckCount', 'rootBlockers', 'gatedTotal']) {
    const descriptor = Object.getOwnPropertyDescriptor(result.summary, field);
    assert.deepStrictEqual({
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      writable: descriptor.writable,
    }, { configurable: true, enumerable: true, writable: true },
    `legacy summary ${field} descriptor must remain an ordinary writable data property`);
  }
});

test('case 37: locked realm removes locale, clock, randomness, and scheduling globals', () => {
  for (const name of Object.keys(LOCKED_GLOBALS)) {
    assert.strictEqual(LOCKED_GLOBALS[name], undefined, `${name} must be unavailable in the locked realm`);
  }
  const IntlMutant = vm.runInNewContext(`(${source.replace(
    'try {', 'try {\n      Intl["Da" + "teTimeFormat"]().format();',
  )})`, lockedRealm(), { contextCodeGeneration: { strings: false, wasm: false } });
  const result = new IntlMutant().analyzeGraph([node('R', 'planning')], []);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), empty,
    'computed Intl access fails closed instead of observing locale or current time');
});

test('case 38: completed is the sole readiness status for arbitrary ancestor values', () => {
  const unknownStatuses = [
    'reviewing', 'review', 'complete', 'completed-ish', 'ready', 'queued', 'released',
    'x'.repeat(4097),
    ...Array.from({ length: 200 }, (_value, index) => `status-${index.toString(36)}-${(index * 7919).toString(36)}`),
  ];
  for (const status of unknownStatuses) {
    const result = insights.analyzeGraph([
      node('A', status), node('T', 'planning'),
    ], [depends('A', 'T')]);
    assert.strictEqual(result.perNode.T.isReady, false,
      `arbitrary non-completed status ${status} must not satisfy readiness`);
  }
  for (const completed of ['completed', 'COMPLETED', '  Completed  ']) {
    const result = insights.analyzeGraph([
      node('A', completed), node('T', 'planning'),
    ], [depends('A', 'T')]);
    assert.strictEqual(result.perNode.T.isReady, true,
      `${completed} normalizes to the sole accepted readiness status`);
  }

  const readinessStart = source.indexOf('const isReady =');
  const readinessEnd = source.indexOf('Object.defineProperty', readinessStart);
  const readinessSource = source.slice(readinessStart, readinessEnd);
  assert.strictEqual((readinessSource.match(/ancestor\.status/g) || []).length, 1,
    'readiness has exactly one ancestor status authority');
  assert.deepStrictEqual(readinessSource.match(/"[^"]*"/g), ['"completed"'],
    'completed is the only status literal in the readiness authority');
  assert.strictEqual(readinessSource.includes('||'), false,
    'readiness has no alternate acceptance predicate');
});

test('case 39: root record order ignores every unrelated card attribute', () => {
  const variants = [
    [node('LONG-CARD-NAME', 'parked'), node('X', 'blocked')],
    [node('Z', 'blocked'), node('alphabetical-first', 'parked')],
    [node('medium-card', 'parked'), node('yy', 'blocked')],
    [node('R1', 'parked'), node('R2', 'blocked'), node('R3', 'parked')],
  ];
  for (const roots of variants) {
    const target = node('TARGET', 'planning');
    const result = insights.analyzeGraph([...roots, target],
      roots.map((root) => depends(root.card, target.card)));
    assert.deepStrictEqual(result.perNode.TARGET.rootCauses,
      roots.map((root) => ({ card: root.card, hops: 1 })));
  }

  const assignment = source.indexOf('perNode[record.card].rootCauses =');
  const attributionStart = source.lastIndexOf('for (const record of records.values())', assignment);
  const attributionEnd = source.indexOf('const gated =', assignment);
  const attributionSource = source.slice(attributionStart, attributionEnd);
  for (const reorder of [/\.sort\(/, /\.reverse\(/, /\.splice\(/, /\.unshift\(/, /\.pop\(/]) {
    assert.strictEqual(reorder.test(attributionSource), false,
      `root attribution must not contain reorder operation ${reorder}`);
  }
  assert.strictEqual((attributionSource.match(/\.filter\(/g) || []).length, 1);
  assert.strictEqual((attributionSource.match(/\.map\(/g) || []).length, 1);
});

test('case 40: production global identifiers are an exact intrinsic allowlist', () => {
  const executable = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '');
  const capitalized = [...new Set(executable.match(/\b[A-Z][A-Za-z0-9_$]*\b/g) || [])].sort();
  assert.deepStrictEqual(capitalized, ['Array', 'GraphInsights', 'Map', 'Object', 'Set'],
    'production may use only the class name and its four required language intrinsics');
});

test('case 41: mutable RegExp ambient state cannot influence output', () => {
  const mutantSource = source.replace(
    'try {', 'try {\n      if (RegExp.input === "__force_empty__") return empty;',
  );
  assert.strictEqual(PURITY_FORBIDDEN.some((pattern) => pattern.test(mutantSource)), true,
    'RegExp ambient access must be rejected statically');
  const Mutant = vm.runInNewContext(`(${mutantSource})`, lockedRealm(), {
    contextCodeGeneration: { strings: false, wasm: false },
  });
  const result = new Mutant().analyzeGraph([node('R', 'planning')], []);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), empty,
    'RegExp is unavailable in the locked realm, so ambient access fails closed');
});

test('case 42: readiness and attribution use exact canonical property blocks', () => {
  const readinessStart = source.indexOf('const isReady =');
  const readinessEnd = source.indexOf('Object.defineProperty', readinessStart);
  const readinessSource = source.slice(readinessStart, readinessEnd).trim();
  assert.strictEqual(readinessSource, [
    'const isReady = eligible(record)',
    '          && !stuck(record)',
    '          && above.every((card) => {',
    '            const ancestor = records.get(card);',
    '            return ancestor && !ancestor.isStub && ancestor.status === "completed";',
    '          });',
  ].join('\n'), 'readiness has one canonical completed-only full-closure predicate');

  const assignment = source.indexOf('perNode[record.card].rootCauses =');
  const attributionStart = source.lastIndexOf('for (const record of records.values())', assignment);
  const attributionEnd = source.indexOf('const gated =', assignment);
  const attributionSource = source.slice(attributionStart, attributionEnd).trim();
  assert.strictEqual(attributionSource, [
    'for (const record of records.values()) {',
    '        perNode[record.card].rootCauses = upstreamWithDepth.get(record.card)',
    '          .filter(({ card }) => perNode[card].isRootBlocker)',
    '          .map(({ card, hops }) => ({ card, hops }));',
    '      }',
  ].join('\n'), 'root attribution has one canonical record-order-preserving projection');
});

test('case 43: production executes with an exact global intrinsic allowlist', () => {
  const { realm, reads } = strictRealm();
  const StrictGraphInsights = vm.runInContext(`(${source})`, realm);
  const result = new StrictGraphInsights().analyzeGraph([
    node('A', 'completed'), node('T', 'planning'),
  ], [depends('A', 'T')]);
  assert.strictEqual(result.perNode.T.isReady, true);
  assert.deepStrictEqual([...new Set(reads)].sort(), ['Array', 'Map', 'Object', 'Set'],
    'production reads only its four explicitly allowed global intrinsics');
});

test('case 44: status, record order, and intrinsic operations have exact authorities', () => {
  assertPropertyAuthorities(source);

  const roots = [
    node('FIRST', 'blocked', { priority: 999, order: 2, rank: -10, arbitrary: 'z' }),
    node('SECOND', 'parked', { priority: -999, order: 1, rank: 10, arbitrary: 'a' }),
  ];
  const result = insights.analyzeGraph([...roots, node('TARGET', 'planning')], [
    depends('FIRST', 'TARGET'), depends('SECOND', 'TARGET'),
  ]);
  assert.deepStrictEqual(result.perNode.TARGET.rootCauses, [
    { card: 'FIRST', hops: 1 }, { card: 'SECOND', hops: 1 },
  ], 'arbitrary node attributes cannot replace input record order');
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
