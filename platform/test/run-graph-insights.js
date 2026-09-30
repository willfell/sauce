#!/usr/bin/env node
'use strict';

// run-graph-insights.js — behavioral harness for the pure GraphInsights core.
//
// A case whose label begins with PH0-READINESS-COMPLETED-ONLY,
// PH0-ROOT-CAUSES-SHORTEST-HOPS, PH0-SUMMARY-COUNTS, PH0-LEGACY-SHAPE-EXACT,
// PH0-ADDITIVE-EMPTY, PH0-STUB-CONSERVATIVE, PH0-PURITY-CARRIED,
// PH0B-REPLAY-EVERY-CALL, PH0B-FAULT-EVERY-OPERATION, PH0B-LABEL-TESTS-ITS-RULE,
// PH0C-FULL-REFERENCE, PH0C-ANY-ORDER, or PH0C-SIZES-BEYOND-TESTED is a fixture
// for the acceptance test or binding fixture of that name.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');
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

// The shipped helper as it stood before readiness and root causes existed.
// PH0-LEGACY-SHAPE-EXACT asserts that these bytes hash to LEGACY_BLOB_ID, the
// git blob of platform/blueprints/project/helpers/graph-insights.js at
// e5a1193f, and loadHelper evaluates this copy as the oracle in each realm.
const LEGACY_BLOB_ID = 'be1039e829df7bd878af927f466e906cf7da8f36';
const LEGACY_SOURCE = `/**
 * GraphInsights — pure blocking analysis for GraphLayout output.
 *
 * analyzeGraph(nodes, edges) -> { perNode, summary }
 *
 * Dependency edges point from prerequisite to dependent. The result exposes
 * each node's transitive upstream prerequisites and downstream dependents,
 * plus the number of live, non-stub dependents it gates. A root blocker is a
 * blocked or parked node with no blocked or parked transitive ancestor.
 *
 * Stub and null-status nodes remain in closures so cross-epic reachability is
 * preserved, but they never contribute to counts or root-blocker candidacy.
 * Ghost order edges are presentation hints and never contribute reachability.
 *
 * Pure by contract: a function of its arguments only — no external runtime
 * surface and no I/O. Malformed input returns the empty shape.
 */
class GraphInsights {
  _empty() {
    return {
      perNode: {},
      summary: { stuckCount: 0, rootBlockers: [], gatedTotal: 0 },
    };
  }

  _card(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  _closure(start, adjacency, order) {
    const visited = new Set([start]);
    const queue = [...(adjacency.get(start) || [])];
    while (queue.length) {
      const card = queue.shift();
      if (visited.has(card)) continue;
      visited.add(card);
      for (const next of adjacency.get(card) || []) queue.push(next);
    }
    visited.delete(start);
    return [...visited].sort((left, right) => order.get(left) - order.get(right));
  }

  analyzeGraph(nodes, edges) {
    const empty = this._empty();
    try {
      if (!Array.isArray(nodes) || !Array.isArray(edges)) return empty;

      const records = new Map();
      const order = new Map();
      for (const node of nodes) {
        if (!node || typeof node !== "object" || Array.isArray(node)) return empty;
        if (!Object.prototype.hasOwnProperty.call(node, "status")) return empty;
        const card = this._card(node.card);
        if (!card || records.has(card)) return empty;
        if (node.status !== null && typeof node.status !== "string") return empty;
        if (node.isStub !== undefined && typeof node.isStub !== "boolean") return empty;
        const status = node.status === null ? null : node.status.trim().toLowerCase();
        if (status === "") return empty;
        const record = { card, status, isStub: node.isStub === true || status === null };
        order.set(card, order.size);
        records.set(card, record);
      }

      const downstream = new Map();
      const upstream = new Map();
      for (const card of records.keys()) {
        downstream.set(card, []);
        upstream.set(card, []);
      }
      const seenEdges = new Set();
      for (const edge of edges) {
        if (!edge || typeof edge !== "object" || Array.isArray(edge)) return empty;
        const from = this._card(edge.from);
        const to = this._card(edge.to);
        if (!from || !to || from === to || !records.has(from) || !records.has(to)) return empty;
        if (edge.kind !== "depends" && edge.kind !== "order") return empty;
        if (edge.kind === "order") continue;
        const key = \`\${from}\\u0000\${to}\`;
        if (seenEdges.has(key)) continue;
        seenEdges.add(key);
        downstream.get(from).push(to);
        upstream.get(to).push(from);
      }

      const eligible = (record) => record && !record.isStub && record.status !== "completed";
      const stuck = (record) => eligible(record)
        && (record.status === "blocked" || record.status === "parked");
      const perNode = {};
      const rootBlockers = [];
      for (const record of records.values()) {
        const above = this._closure(record.card, upstream, order);
        const below = this._closure(record.card, downstream, order);
        const isRootBlocker = stuck(record) && !above.some((card) => stuck(records.get(card)));
        if (isRootBlocker) rootBlockers.push(record.card);
        Object.defineProperty(perNode, record.card, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: {
            upstream: above,
            downstream: below,
            gates: below.filter((card) => eligible(records.get(card))).length,
            isRootBlocker,
          },
        });
      }

      const gated = new Set();
      for (const card of rootBlockers) {
        for (const dependent of perNode[card].downstream) {
          if (eligible(records.get(dependent))) gated.add(dependent);
        }
      }
      return {
        perNode,
        summary: {
          stuckCount: [...records.values()].filter(stuck).length,
          rootBlockers,
          gatedTotal: gated.size,
        },
      };
    } catch (_e) {
      return empty;
    }
  }
}
`;
function gitBlobId(text) {
  const body = Buffer.from(text, 'utf8');
  return crypto.createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
}

// Ledger of calls into the real helper. This file runs the unmodified helper
// source in four realms (main, locked, strict, fault), and each of those copies
// comes from loadHelper. loadHelper evaluates the shipped oracle in the same
// realm and replaces the copy's prototype.analyzeGraph with a wrapper that
// appends one entry per call, whichever case, instance, or call site made it.
// The case that made a call settles it, before any further call, as one of:
//   REPLAYED       the case expects an analysis. PH0-LEGACY-SHAPE-EXACT later
//                  compares the result the case received with the oracle's
//                  output for the same inputs in the same realm.
//   EMPTY_CHECKED  the case expects the empty shape (invalid input, a valid
//                  empty graph, an input whose getter, proxy trap, or iterator
//                  throws, or an injected Map or Set fault). settle compares
//                  the result with the exact additive empty shape before the
//                  case continues.
// PH0B-REPLAY-EVERY-CALL, the last case, fails if any entry is unsettled and
// asserts that the calls PH0-LEGACY-SHAPE-EXACT replayed plus the
// empty-shape-checked calls add up to the ledger length. Mutants built from
// edited source are not the real helper and are not loaded here.
const REPLAYED = 'REPLAYED';
const EMPTY_CHECKED = 'EMPTY_CHECKED';
let currentCase = null;
const helperCalls = [];
const oracles = new Map();
let emptyShapeChecks = 0;
let replayedCalls = 0;

function loadHelper(realm, evaluate) {
  assert.strictEqual(oracles.has(realm), false, `the ${realm} realm loads the helper once`);
  const Helper = evaluate(`(${source})`);
  const Oracle = evaluate(`(${LEGACY_SOURCE})`);
  const analyzeGraph = Helper.prototype.analyzeGraph;
  Helper.prototype.analyzeGraph = function ledgeredAnalyzeGraph(nodes, edges) {
    const call = { caseName: currentCase, realm, nodes, edges, result: undefined, disposition: null };
    helperCalls.push(call);
    call.result = analyzeGraph.call(this, nodes, edges);
    return call.result;
  };
  oracles.set(realm, new Oracle());
  return Helper;
}

function settle(result, disposition, label) {
  const call = helperCalls[helperCalls.length - 1];
  assert.ok(call && call.result === result && call.disposition === null,
    `${label}: the latest ledger entry is the unsettled call that returned this result`);
  if (disposition === EMPTY_CHECKED) {
    assertExactEmpty(result, label);
    emptyShapeChecks += 1;
  } else {
    assert.strictEqual(disposition, REPLAYED, `${label}: a call settles as REPLAYED or EMPTY_CHECKED`);
  }
  call.disposition = disposition;
  return result;
}

const GraphInsights = loadHelper('main', (code) => eval(code)); // eslint-disable-line no-eval
const HELPER_PROTOTYPE_KEYS = Reflect.ownKeys(GraphInsights.prototype);
const HELPER_CLASS_KEYS = Reflect.ownKeys(GraphInsights);
const candidate = new GraphInsights();
const legacy = oracles.get('main');
const insights = {
  analyzeGraph(nodes, edges) {
    return settle(candidate.analyzeGraph(nodes, edges), REPLAYED, 'main-realm analysis');
  },
  analyzeEmpty(nodes, edges, label) {
    return settle(candidate.analyzeGraph(nodes, edges), EMPTY_CHECKED, label);
  },
};

const LEGACY_NODE_KEYS = ['upstream', 'downstream', 'gates', 'isRootBlocker'];
const ADDITIVE_NODE_KEYS = ['isReady', 'rootCauses'];
const LEGACY_SUMMARY_KEYS = ['stuckCount', 'rootBlockers', 'gatedTotal'];
const ADDITIVE_SUMMARY_KEYS = ['readyCount', 'needsYouCount', 'blockedCount'];
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

function plain(value) { return JSON.parse(JSON.stringify(value)); }

// A result from another realm has that realm's prototypes, which deepStrictEqual
// would reject against the main-realm empty shape, so its values are compared
// through JSON. The Reflect.ownKeys checks apply to results from every realm.
function assertExactEmpty(result, label) {
  const sameRealm = Object.getPrototypeOf(result) === Object.prototype;
  assert.deepStrictEqual(sameRealm ? result : plain(result), empty,
    `${label}: must be the complete additive empty shape`);
  assert.deepStrictEqual(Reflect.ownKeys(result), ['perNode', 'summary'], `${label}: top-level keys and order`);
  assert.deepStrictEqual(Reflect.ownKeys(result.perNode), [], `${label}: perNode has no keys`);
  assert.deepStrictEqual(Reflect.ownKeys(result.summary), [...LEGACY_SUMMARY_KEYS, ...ADDITIVE_SUMMARY_KEYS],
    `${label}: summary keys and order`);
  assert.deepStrictEqual(Reflect.ownKeys(result.summary.rootBlockers), ['length'],
    `${label}: rootBlockers has no elements`);
  for (const [name, value] of [
    ['the result', result], ['perNode', result.perNode], ['summary', result.summary],
    ['rootBlockers', result.summary.rootBlockers],
  ]) {
    assert.strictEqual(Object.isExtensible(value), true, `${label}: ${name} is extensible`);
  }
  for (const [name, object] of [['the result', result], ['summary', result.summary]]) {
    for (const key of Reflect.ownKeys(object)) {
      assert.deepStrictEqual(descriptorOf(object, key),
        { configurable: true, enumerable: true, writable: true, accessor: false },
        `${label}: ${name}.${String(key)} is a writable, enumerable, configurable data property`);
    }
  }
}

function descriptorOf(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    writable: descriptor.writable,
    accessor: 'get' in descriptor || 'set' in descriptor,
  };
}

function legacyProjection(result) {
  return JSON.stringify({
    perNode: Object.fromEntries(Object.keys(result.perNode).map((card) => [
      card, Object.fromEntries(LEGACY_NODE_KEYS.map((key) => [key, result.perNode[card][key]])),
    ])),
    summary: Object.fromEntries(LEGACY_SUMMARY_KEYS.map((key) => [key, result.summary[key]])),
  });
}

function assertLegacyShapeExact(actual, shipped, label) {
  assert.deepStrictEqual(Reflect.ownKeys(shipped), ['perNode', 'summary'], `${label}: shipped top-level own keys`);
  assert.deepStrictEqual(Reflect.ownKeys(actual), ['perNode', 'summary'],
    `${label}: the result's own keys, enumerable or not, are exactly perNode and summary`);
  for (const key of Object.keys(shipped)) {
    assert.deepStrictEqual(descriptorOf(actual, key), descriptorOf(shipped, key), `${label}: ${key} descriptor`);
  }
  assert.strictEqual(Object.getPrototypeOf(actual.perNode), Object.getPrototypeOf(shipped.perNode),
    `${label}: perNode prototype`);
  assert.deepStrictEqual(Reflect.ownKeys(actual.perNode), Reflect.ownKeys(shipped.perNode),
    `${label}: perNode's own keys, enumerable or not, are the shipped cards in the shipped order`);
  for (const card of Object.keys(shipped.perNode)) {
    assert.deepStrictEqual(descriptorOf(actual.perNode, card), descriptorOf(shipped.perNode, card),
      `${label}: perNode[${card}] descriptor`);
    const entry = actual.perNode[card];
    const shippedEntry = shipped.perNode[card];
    assert.deepStrictEqual(Reflect.ownKeys(shippedEntry), LEGACY_NODE_KEYS, `${label}: shipped per-node own keys`);
    assert.deepStrictEqual(Reflect.ownKeys(entry), [...LEGACY_NODE_KEYS, ...ADDITIVE_NODE_KEYS],
      `${label}: perNode[${card}]'s own keys, enumerable or not, are the shipped keys, then isReady and rootCauses`);
    for (const key of LEGACY_NODE_KEYS) {
      assert.deepStrictEqual(descriptorOf(entry, key), descriptorOf(shippedEntry, key),
        `${label}: perNode[${card}].${key} descriptor`);
      assert.deepStrictEqual(entry[key], shippedEntry[key], `${label}: perNode[${card}].${key} value`);
    }
  }
  assert.deepStrictEqual(Reflect.ownKeys(shipped.summary), LEGACY_SUMMARY_KEYS, `${label}: shipped summary own keys`);
  assert.deepStrictEqual(Reflect.ownKeys(actual.summary), [...LEGACY_SUMMARY_KEYS, ...ADDITIVE_SUMMARY_KEYS],
    `${label}: summary's own keys, enumerable or not, are the shipped keys, then readyCount, needsYouCount, blockedCount`);
  for (const key of LEGACY_SUMMARY_KEYS) {
    assert.deepStrictEqual(descriptorOf(actual.summary, key), descriptorOf(shipped.summary, key),
      `${label}: summary.${key} descriptor`);
    assert.deepStrictEqual(actual.summary[key], shipped.summary[key], `${label}: summary.${key} value`);
  }
  assert.strictEqual(legacyProjection(actual), JSON.stringify(shipped),
    `${label}: shipped fields serialize byte-for-byte`);
}

// Deterministic generator for property fixtures; the same seed always yields
// the same corpus, so a failure is reproducible by rerunning the harness.
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

function shuffled(items, next) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = next() % (index + 1);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

// Seeded status strings of 1 to 16 characters drawn from ASCII letters,
// digits, '-', '_', and '.'. The same count always yields the same list.
function generatedStatuses(count) {
  const next = prng(0x5eed0001);
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.';
  return Array.from({ length: count }, () => {
    const length = 1 + (next() % 16);
    let status = '';
    for (let index = 0; index < length; index += 1) status += alphabet[next() % alphabet.length];
    return status;
  });
}

function normalizedStatus(status) { return status.trim().toLowerCase(); }

// The generated statuses whose normalized form is none of completed, blocked,
// and parked.
const GENERATED_UNKNOWN_STATUSES = generatedStatuses(300)
  .filter((status) => !['completed', 'blocked', 'parked'].includes(normalizedStatus(status)));
const GENERATED_UNKNOWN_NORMALIZED = new Set(GENERATED_UNKNOWN_STATUSES.map(normalizedStatus));

// Statuses whose normalized form is none of completed, blocked, and parked:
// discarded, reviewing, and unknown in several cases and paddings; statuses
// that begin with or contain block or park; completed, blocked, and parked
// with a hyphen inside; and the first two generated unknown statuses. The
// fixture guard in PH0-READINESS-COMPLETED-ONLY asserts that none normalizes
// to completed, blocked, parked, or the empty string.
const WIDENED_STATUSES = [
  'discarded', ' Discarded ', 'reviewing', '\tREVIEWING\n', 'unknown', 'Unknown',
  'Blocking', ' BLOCKING ', 'Parking', 'un-blocked', 'Blocked!', 'PARKED.', 'blocked_', 'parkedd',
  'Com-pleted', 'block-ed', 'PARK-ED',
  GENERATED_UNKNOWN_STATUSES[0], GENERATED_UNKNOWN_STATUSES[1],
];

// Statuses that trimming and lower-casing turn into completed, blocked, or
// parked, each with leading or trailing whitespace other than a plain space.
// The fixture guard in PH0-READINESS-COMPLETED-ONLY asserts both.
const PADDED_STATUSES = [
  '\u00a0Blocked\u00a0', '\ufeffPARKED', '\u3000Completed\u2003', '\v BLOCKED\f', '\u2028parked\u2029',
  ' \t\r\nCOMPLETED\r\n',
];

// Card names that name Object.prototype members (__proto__, constructor,
// toString, hasOwnProperty, valueOf), the own prototype property of
// functions, or integer-like keys, which plain objects list before other keys.
const HOSTILE_CARDS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype', '0', '10'];

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const cases = [];
function test(name, fn) { cases.push([name, fn]); }
function node(card, status, extra = {}) { return { card, status, ...extra }; }
function depends(from, to) { return { from, to, kind: 'depends' }; }

test('PH0-LEGACY-SHAPE-EXACT: case 1: exact chain closures, gates, and stuck summary', () => {
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

test('PH0-LEGACY-SHAPE-EXACT: case 2: a stuck transitive descendant is not a root blocker', () => {
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

test('PH0-LEGACY-SHAPE-EXACT: case 3: stubs propagate while stub/completed nodes are excluded from gates', () => {
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
    'the live B counts; the explicit stub S and completed C do not');
  assert.strictEqual(result.perNode.S.gates, 1,
    'the stub S keeps its own downstream closure and gates the live B in it');
  assert.deepStrictEqual(result.summary,
    {
      stuckCount: 1, rootBlockers: ['A'], gatedTotal: 1,
      readyCount: 0, needsYouCount: 0, blockedCount: 1,
    });
});

test('PH0-LEGACY-SHAPE-EXACT: case 4: null-status nodes without an isStub flag also propagate but never count', () => {
  const result = insights.analyzeGraph([
    node('A', 'blocked'), node('U', null), node('B', 'planning'),
  ], [depends('A', 'U'), depends('U', 'B')]);
  assert.deepStrictEqual(result.perNode.A.downstream, ['U', 'B']);
  assert.strictEqual(result.perNode.A.gates, 1);
  assert.strictEqual(result.summary.stuckCount, 1);
});

test('PH0-STUB-CONSERVATIVE: case 5: order edges contribute nothing to either closure', () => {
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

test('PH0-LEGACY-SHAPE-EXACT: case 6: parked is stuck and shared gated descendants count once', () => {
  // Mutation guard: treating parked as healthy drops P from rootBlockers and stuckCount.
  const result = insights.analyzeGraph([
    node('A', 'blocked'), node('P', 'parked'), node('Z', 'planning'),
  ], [depends('A', 'Z'), depends('P', 'Z')]);
  assert.deepStrictEqual(result.summary,
    {
      stuckCount: 2, rootBlockers: ['A', 'P'], gatedTotal: 1,
      readyCount: 0, needsYouCount: 1, blockedCount: 1,
    });
});

test('PH0-LEGACY-SHAPE-EXACT: case 7: dependency cycles terminate and never include self in closures', () => {
  const result = insights.analyzeGraph([
    node('A', 'blocked'), node('B', 'parked'), node('C', 'planning'),
  ], [depends('A', 'B'), depends('B', 'A'), depends('B', 'C')]);
  assert.deepStrictEqual(result.perNode.A.upstream, ['B']);
  assert.deepStrictEqual(result.perNode.A.downstream, ['B', 'C']);
  assert.deepStrictEqual(result.summary.rootBlockers, [],
    'each stuck cycle member has a stuck transitive ancestor');
});

test('PH0-ADDITIVE-EMPTY: case 8: each listed malformed input returns the exact empty result', () => {
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
  malformed.forEach(([nodes, edges], index) => {
    assert.doesNotThrow(() => insights.analyzeEmpty(nodes, edges, `malformed input ${index}`));
    assert.deepStrictEqual(insights.analyzeEmpty(nodes, edges, `malformed input ${index}, again`), empty);
  });
});

test('PH0-LEGACY-SHAPE-EXACT: case 9: hostile property names remain safe plain-object keys', () => {
  const { result } = analyzeAgainstReference([
    node('__proto__', 'blocked'), node('constructor', 'planning'),
  ], [depends('__proto__', 'constructor')], 'the blocked record __proto__ above the planning record constructor');
  assert.strictEqual(Object.getPrototypeOf(result.perNode), Object.prototype);
  assert.strictEqual(result.perNode.__proto__.gates, 1);
  assert.deepStrictEqual(result.perNode.constructor.upstream, ['__proto__']);
  assert.strictEqual(result.perNode.constructor.isReady, false,
    'constructor is not ready below the blocked record __proto__');
  assert.deepStrictEqual(result.perNode.constructor.rootCauses, [{ card: '__proto__', hops: 1 }],
    'constructor lists the root blocker __proto__ at 1 hop');
});

test('PH0-PURITY-CARRIED: case 10: purity — helper source matches none of the forbidden host and I/O patterns', () => {
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
  // Execution order is no longer sequential: the release:preflight registration
  // surface moved from a package.json chain string to
  // platform/test/preflight-manifest.json (2026-08-10 parallel preflight
  // cutover), which is ordered heaviest-first and whose parallel lane has no
  // execution order at all -- see
  // Docs/superpowers/specs/2026-08-10-parallel-preflight-design.md. The
  // surviving intent (the graph trio plus the independent contract sentinel all
  // stay wired into preflight) is now a membership check per harness, not an
  // order check.
  const preflightManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform/test/preflight-manifest.json'), 'utf8'));
  const preflightCmds = preflightManifest.steps.map((s) => s.cmd.join(' '));
  for (const harness of ['run-graph-layout.js', 'run-graph-view.js', 'run-graph-insights.js', 'run-graph-view-contract.js']) {
    assert.strictEqual(preflightCmds.filter((cmd) => cmd.includes(harness)).length, 1,
      `preflight preserves the graph trio plus the independent contract sentinel: ${harness} registered exactly once`);
  }
  assert.strictEqual(preflightCmds.filter((cmd) => cmd.includes('run-graph-insights.js')).length, 1);
});

test('PH0-PURITY-CARRIED: case 12: required behavioral mutants are executable and turn red', () => {
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
    'check only direct prerequisites for readiness, past a completed stub',
    mutated('above.every((card) => {', '(upstream.get(record.card) || []).every((card) => {'),
    [node('S', 'completed', { isStub: true }), node('M', 'completed'), node('N', 'planning')],
    [depends('S', 'M'), depends('M', 'N')],
    (result) => assert.strictEqual(result.perNode.N.isReady, false, 'transitive stub must remain visible'),
  );
  expectRed(
    'check only direct prerequisites for readiness, past incomplete work',
    mutated('above.every((card) => {', '(upstream.get(record.card) || []).every((card) => {'),
    [node('A', 'planning'), node('B', 'completed'), node('C', 'planning')],
    [depends('A', 'B'), depends('B', 'C')],
    (result) => assert.strictEqual(result.perNode.C.isReady, false, 'transitive incomplete work must remain visible'),
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

test('PH0-READINESS-COMPLETED-ONLY: case 13: readiness, triage counts, and direct root attribution are exact', () => {
  const { result } = analyzeAgainstReference([
    node('A', 'completed'), node('B', 'planning'), node('C', 'planning'),
    node('D', 'parked'), node('E', 'blocked'), node('F', 'blocked'),
  ], [depends('A', 'B'), depends('B', 'C'), depends('D', 'E'), depends('A', 'F')],
  'the completed record A above the planning chain B->C and the blocked record F, and the parked record D above the blocked record E');
  assert.strictEqual(result.perNode.A.isReady, false, 'completed work is never ready');
  assert.strictEqual(result.perNode.B.isReady, true, 'B is ready: its only prerequisite A is completed');
  assert.strictEqual(result.perNode.C.isReady, false, 'C is not ready: its ancestor B is not completed');
  assert.strictEqual(result.perNode.D.isReady, false, 'parked work is not ready');
  assert.strictEqual(result.perNode.F.isReady, false, 'blocked work is not ready, even when its only ancestor is completed');
  assert.deepStrictEqual(result.perNode.C.rootCauses, []);
  assert.deepStrictEqual(result.perNode.E.rootCauses, [{ card: 'D', hops: 1 }]);
  assert.deepStrictEqual(result.perNode.F.rootCauses, []);
  assert.deepStrictEqual(result.summary, {
    stuckCount: 3,
    rootBlockers: ['D', 'F'],
    gatedTotal: 1,
    readyCount: 1,
    needsYouCount: 1,
    blockedCount: 2,
  });
});

test('PH0-ROOT-CAUSES-SHORTEST-HOPS: case 14: a root blocker two edges upstream is reported at 2 hops', () => {
  const result = insights.analyzeGraph([
    node('R', 'blocked'), node('M', 'planning'), node('L', 'planning'), node('W', 'planning'),
  ], [depends('R', 'M'), depends('M', 'L'), depends('R', 'W'), depends('W', 'L')]);
  assert.deepStrictEqual(result.perNode.L.rootCauses, [{ card: 'R', hops: 2 }]);
});

test('PH0-STUB-CONSERVATIVE: case 15: a stub anywhere upstream makes readiness conservative', () => {
  const result = insights.analyzeGraph([
    node('S', 'completed', { isStub: true }), node('M', 'completed'), node('N', 'planning'),
    node('D', 'planning'), node('Q', 'planning', { isStub: true }), node('K', 'completed'),
  ], [depends('S', 'M'), depends('M', 'N'), depends('S', 'D')]);
  assert.strictEqual(result.perNode.Q.isReady, false, 'stubs are never ready');
  assert.strictEqual(result.perNode.K.isReady, false, 'completed records are never ready');
  assert.strictEqual(result.perNode.D.isReady, false, 'a direct upstream stub prevents readiness');
  assert.strictEqual(result.perNode.N.isReady, false, 'a transitive upstream stub prevents readiness');
  assert.deepStrictEqual(result.perNode.N.rootCauses, [], 'no stuck record is upstream of N, so N has no root causes');
  assert.strictEqual(result.summary.readyCount, 0);
});

test('PH0-ROOT-CAUSES-SHORTEST-HOPS: case 16: unequal alternate paths retain the shortest BFS hop distance', () => {
  const result = insights.analyzeGraph([
    node('R', 'blocked'), node('S', 'planning'), node('A', 'planning'),
    node('B', 'planning'), node('L', 'planning'),
  ], [
    depends('R', 'S'), depends('S', 'L'),
    depends('R', 'A'), depends('A', 'B'), depends('B', 'L'),
  ]);
  assert.deepStrictEqual(result.perNode.L.rootCauses, [{ card: 'R', hops: 2 }]);
});

test('PH0-ROOT-CAUSES-SHORTEST-HOPS: case 17: only upstream root blockers are attributed', () => {
  const result = insights.analyzeGraph([
    node('R', 'blocked'), node('P', 'parked'), node('N', 'planning'),
  ], [depends('R', 'P'), depends('P', 'N')]);
  assert.deepStrictEqual(result.perNode.N.rootCauses, [{ card: 'R', hops: 2 }],
    'the nested parked blocker is stuck but is not a root cause');
});

test('PH0-ROOT-CAUSES-SHORTEST-HOPS: case 18: root-cause order follows records rather than hop distance', () => {
  const result = insights.analyzeGraph([
    node('F', 'blocked'), node('N', 'parked'), node('M', 'planning'), node('L', 'planning'),
  ], [depends('F', 'M'), depends('M', 'L'), depends('N', 'L')]);
  assert.deepStrictEqual(result.perNode.L.rootCauses, [
    { card: 'F', hops: 2 }, { card: 'N', hops: 1 },
  ]);
});

test('PH0-STUB-CONSERVATIVE: case 19: parked and blocked stubs never enter Director triage counts', () => {
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

test('PH0-LEGACY-SHAPE-EXACT: case 20: additive fields preserve legacy keys and property descriptors', () => {
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

test('PH0-READINESS-COMPLETED-ONLY: case 21: readiness uses the transitive closure, not completed direct prerequisites only', () => {
  const { result } = analyzeAgainstReference([
    node('A', 'planning'), node('B', 'completed'), node('C', 'planning'),
  ], [depends('A', 'B'), depends('B', 'C')], 'the planning record A above the completed record B above the planning record C');
  assert.strictEqual(result.perNode.C.isReady, false,
    'the incomplete transitive ancestor A keeps C out of the ready set');
});

test('PH0-ADDITIVE-EMPTY: case 22: a valid empty graph and a throwing status getter return the complete empty shape', () => {
  assert.deepStrictEqual(insights.analyzeEmpty([], [], 'valid empty graph'), empty);
  const hostile = { card: 'X' };
  Object.defineProperty(hostile, 'status', {
    enumerable: true,
    get() { throw new Error('hostile getter'); },
  });
  assert.doesNotThrow(() => insights.analyzeEmpty([hostile], [], 'throwing status getter'));
  assert.deepStrictEqual(insights.analyzeEmpty([hostile], [], 'throwing status getter, again'), empty);
});

test('PH0-LEGACY-SHAPE-EXACT: case 23: in-progress dependents retain the shipped gates semantics', () => {
  const result = insights.analyzeGraph([
    node('R', 'blocked'), node('I', 'in_progress'),
  ], [depends('R', 'I')]);
  assert.strictEqual(result.perNode.R.gates, 1);
  assert.strictEqual(result.summary.gatedTotal, 1);
});

test('PH0-PURITY-CARRIED: case 24: the unmodified helper source runs in the locked realm with code generation disabled', () => {
  const lockedContext = vm.createContext(lockedRealm(), { codeGeneration: { strings: false, wasm: false } });
  const LockedGraphInsights = loadHelper('locked', (code) => vm.runInContext(code, lockedContext));
  const locked = new LockedGraphInsights();
  const result = settle(locked.analyzeGraph([node('R', 'planning')], []), REPLAYED, 'locked-realm analysis');
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

test('PH0-READINESS-COMPLETED-ONLY: case 25: readiness sees incomplete ancestors beyond two hops', () => {
  const { result } = analyzeAgainstReference([
    node('A', 'planning'), node('B', 'completed'), node('C', 'completed'), node('D', 'planning'),
  ], [depends('A', 'B'), depends('B', 'C'), depends('C', 'D')],
  'the planning record A three hops above the planning record D through completed records');
  assert.strictEqual(result.perNode.D.isReady, false);
});

test('PH0-ROOT-CAUSES-SHORTEST-HOPS: case 26: queued branching cannot replace shortest-path BFS', () => {
  const result = insights.analyzeGraph([
    node('R', 'blocked'), node('A', 'planning'), node('B', 'planning'),
    node('X', 'completed'), node('S', 'planning'), node('L', 'planning'),
  ], [
    depends('R', 'A'), depends('A', 'B'), depends('B', 'L'),
    depends('X', 'L'), depends('R', 'S'), depends('S', 'L'),
  ]);
  assert.deepStrictEqual(result.perNode.L.rootCauses, [{ card: 'R', hops: 2 }]);
});

test('PH0-LEGACY-SHAPE-EXACT: case 27: archived and discarded dependents retain legacy gates', () => {
  const result = insights.analyzeGraph([
    node('R', 'blocked'), node('A', 'archived'), node('D', 'discarded'),
  ], [depends('R', 'A'), depends('R', 'D')]);
  assert.strictEqual(result.perNode.R.gates, 2);
  assert.strictEqual(result.summary.gatedTotal, 2);
});

test('PH0-LEGACY-SHAPE-EXACT: case 28: the inner legacy gates field keeps an ordinary writable data descriptor', () => {
  const result = insights.analyzeGraph([node('A', 'planning')], []);
  const descriptor = Object.getOwnPropertyDescriptor(result.perNode.A, 'gates');
  assert.strictEqual(descriptor.configurable, true);
  assert.strictEqual(descriptor.enumerable, true);
  assert.strictEqual(descriptor.writable, true);
});

test('PH0-READINESS-COMPLETED-ONLY: case 29: readiness quantifies over the full closure across generated depths', () => {
  for (let depth = 1; depth <= 12; depth += 1) {
    const ancestorCards = Array.from({ length: depth }, (_value, index) => `A${depth}-${index}`);
    const target = `T${depth}`;
    const edges = [];
    for (let index = 0; index < ancestorCards.length - 1; index += 1) {
      edges.push(depends(ancestorCards[index], ancestorCards[index + 1]));
    }
    edges.push(depends(ancestorCards[ancestorCards.length - 1], target));

    const incomplete = ancestorCards.map((card, index) => node(card, index === 0 ? 'planning' : 'completed'));
    const { result: incompleteResult } = analyzeAgainstReference([...incomplete, node(target, 'planning')], edges,
      `a ${depth}-hop closure whose head is planning`);
    assert.strictEqual(incompleteResult.perNode[target].isReady, false,
      `an incomplete ancestor ${depth} hop(s) away must prevent readiness`);

    const complete = ancestorCards.map((card) => node(card, 'completed'));
    const { result: completeResult } = analyzeAgainstReference([...complete, node(target, 'planning')], edges,
      `a fully completed ${depth}-hop closure`);
    assert.strictEqual(completeResult.perNode[target].isReady, true,
      `a fully completed ${depth}-hop closure must be ready`);

    const stubIndex = 0;
    const withStub = complete.map((record, index) => (index === stubIndex
      ? node(record.card, 'completed', { isStub: true }) : record));
    const { result: stubResult } = analyzeAgainstReference([...withStub, node(target, 'planning')], edges,
      `a ${depth}-hop completed closure whose head is a stub`);
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

test('PH0-ROOT-CAUSES-SHORTEST-HOPS: case 30: FIFO shortest paths survive generated depth and width matrices', () => {
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

test('PH0-LEGACY-SHAPE-EXACT: case 31: each listed non-completed dependent status keeps legacy gating and completed does not', () => {
  const gatedStatuses = [
    'planning', 'in_progress', 'waiting', 'blocked', 'parked', 'archived', 'discarded', 'unknown',
    ...WIDENED_STATUSES,
  ];
  for (const status of gatedStatuses) {
    const { result } = analyzeAgainstReference([
      node('R', 'blocked'), node('D', status),
    ], [depends('R', 'D')], `${JSON.stringify(status)} dependent of the root blocker R`);
    assert.strictEqual(result.perNode.R.gates, 1, `${status} must remain gated`);
    assert.strictEqual(result.summary.gatedTotal, 1, `${status} must remain in gatedTotal`);
  }
  const { result: completed } = analyzeAgainstReference([
    node('R', 'blocked'), node('D', 'completed'),
  ], [depends('R', 'D')], 'the completed dependent of the root blocker R');
  assert.strictEqual(completed.perNode.R.gates, 0);
  assert.strictEqual(completed.summary.gatedTotal, 0);
});

test('PH0-LEGACY-SHAPE-EXACT: case 32: all legacy per-node properties retain exact descriptors', () => {
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

test('PH0-PURITY-CARRIED: case 33: the listed nondeterministic runtime sources are rejected structurally', () => {
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

test('PH0-READINESS-COMPLETED-ONLY: case 34: each listed non-completed ancestor status leaves the dependent not ready', () => {
  const nonCompleted = [
    'planning', 'in_progress', 'waiting', 'blocked', 'parked', 'archived', 'discarded', 'unknown',
    ...WIDENED_STATUSES,
  ];
  const next = prng(0x5eed0008);
  for (const status of nonCompleted) {
    const { nodes, edges } = statusRoles(status, next);
    const { result } = analyzeAgainstReference(nodes, edges, `status roles of ${JSON.stringify(status)}`);
    assert.strictEqual(result.perNode.T.isReady, false,
      `${status} ancestry must not satisfy readiness`);
  }
});

test('PH0-ROOT-CAUSES-SHORTEST-HOPS: case 35: root-cause record order is independent of blocker status', () => {
  const result = insights.analyzeGraph([
    node('P', 'parked'), node('B', 'blocked'), node('T', 'planning'),
  ], [depends('P', 'T'), depends('B', 'T')]);
  assert.deepStrictEqual(result.perNode.T.rootCauses, [
    { card: 'P', hops: 1 }, { card: 'B', hops: 1 },
  ]);
});

test('PH0-LEGACY-SHAPE-EXACT: case 36: legacy summary fields retain ordinary data descriptors', () => {
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

test('PH0-PURITY-CARRIED: case 37: locked realm removes locale, clock, randomness, and scheduling globals', () => {
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

test('PH0-READINESS-COMPLETED-ONLY: case 38: completed is the sole readiness status for arbitrary ancestor values', () => {
  const unknownStatuses = [
    'reviewing', 'review', 'complete', 'completed-ish', 'ready', 'queued', 'released',
    'x'.repeat(4097),
    ...Array.from({ length: 200 }, (_value, index) => `status-${index.toString(36)}-${(index * 7919).toString(36)}`),
  ];
  const next = prng(0x5eed0009);
  for (const status of unknownStatuses) {
    const { nodes, edges } = statusRoles(status, next);
    const { result } = analyzeAgainstReference(nodes, edges, `status roles of ${JSON.stringify(status)}`);
    assert.strictEqual(result.perNode.T.isReady, false,
      `arbitrary non-completed status ${status} must not satisfy readiness`);
  }
  for (const completed of ['completed', 'COMPLETED', '  Completed  ']) {
    const { result } = analyzeAgainstReference([
      node('A', completed), node('T', 'planning'),
    ], [depends('A', 'T')], `completed variant ${JSON.stringify(completed)} above T`);
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

test('PH0-ROOT-CAUSES-SHORTEST-HOPS: case 39: root record order ignores card name, name length, and blocker status', () => {
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

test('PH0-PURITY-CARRIED: case 40: the only capitalized identifiers in production source are the class name and four intrinsics', () => {
  const executable = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '');
  const capitalized = [...new Set(executable.match(/\b[A-Z][A-Za-z0-9_$]*\b/g) || [])].sort();
  assert.deepStrictEqual(capitalized, ['Array', 'GraphInsights', 'Map', 'Object', 'Set'],
    'the capitalized identifiers in production source are the class name and four language intrinsics');
});

test('PH0-PURITY-CARRIED: case 41: mutable RegExp ambient state cannot influence output', () => {
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

test('PH0-READINESS-COMPLETED-ONLY: case 42a: readiness uses one exact canonical completed-only predicate block', () => {
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
});

test('PH0-ROOT-CAUSES-SHORTEST-HOPS: case 42b: root attribution uses one exact canonical record-order projection block', () => {
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

test('PH0-PURITY-CARRIED: case 43: production executes with an exact global intrinsic allowlist', () => {
  const { realm, reads } = strictRealm();
  const StrictGraphInsights = loadHelper('strict', (code) => vm.runInContext(code, realm));
  assert.deepStrictEqual(reads, [], 'evaluating the helper and oracle classes reads no global');
  const result = settle(new StrictGraphInsights().analyzeGraph([
    node('A', 'completed'), node('T', 'planning'),
  ], [depends('A', 'T')]), REPLAYED, 'strict-realm analysis');
  assert.strictEqual(result.perNode.T.isReady, true);
  assert.deepStrictEqual([...new Set(reads)].sort(), ['Array', 'Map', 'Object', 'Set'],
    'this analysis reads no global other than Array, Map, Object, and Set');
});

test('PH0-PURITY-CARRIED: case 44: status, record order, and intrinsic operations have exact authorities', () => {
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

test('PH0-READINESS-COMPLETED-ONLY: only an exact normalized completed ancestry satisfies readiness', () => {
  for (const status of WIDENED_STATUSES) {
    assert.ok(!['completed', 'blocked', 'parked', ''].includes(normalizedStatus(status)),
      `fixture guard: ${JSON.stringify(status)} normalizes to none of completed, blocked, parked, and the empty string`);
  }
  for (const status of PADDED_STATUSES) {
    assert.ok(['completed', 'blocked', 'parked'].includes(normalizedStatus(status)) && /^[^\S ]|[^\S ]$/.test(status),
      `fixture guard: ${JSON.stringify(status)} normalizes to completed, blocked, or parked and has leading or trailing whitespace other than a plain space`);
  }
  const unmappedVariants = [
    'reviewing', 'Reviewing', 'REVIEWING', 'complete', 'Complete', 'COMPLETE', 'cOmPlEtE',
    'Completed!', 'COMPLETED.', 'Com pleted', 'COMPLETED_', 'Completedd', 'done', 'Ready',
    'completed​', '​COMPLETED',
    'ＣＯＭＰＬＥＴＥＤ',
    'complеted', 'COMPLΕTED',
    ...WIDENED_STATUSES,
  ];
  const unknown = [...unmappedVariants, ...generatedStatuses(300)].filter((status) => {
    const normalized = normalizedStatus(status);
    assert.notStrictEqual(normalized, 'completed',
      `fixture guard: ${JSON.stringify(status)} must be a status the normalizer does not map to completed`);
    assert.notStrictEqual(normalized, '', `fixture guard: ${JSON.stringify(status)} must be non-empty`);
    return normalized !== 'blocked' && normalized !== 'parked';
  });
  assert.ok(unknown.length >= unmappedVariants.length + 250, 'the generated corpus is not vacuous');

  const next = prng(0x5eed0007);
  const featureList = [];
  for (const status of unknown) {
    const { nodes, edges } = statusRoles(status, next);
    const { result, features } = analyzeAgainstReference(nodes, edges, `status roles of ${JSON.stringify(status)}`);
    featureList.push(features);
    assert.strictEqual(result.perNode.T.isReady, false,
      `${JSON.stringify(status)} ancestry must not satisfy readiness`);
    assert.strictEqual(result.perNode.T2.isReady, false,
      `${JSON.stringify(status)} two hops upstream must not satisfy readiness`);
    assert.strictEqual(result.perNode.X.isReady, true,
      `a ${JSON.stringify(status)} record whose only ancestor is completed is ready`);
    assert.deepStrictEqual(result.perNode.Y.rootCauses, [{ card: 'R', hops: 1 }],
      `a ${JSON.stringify(status)} record directly below the root blocker R lists R at 1 hop`);
  }
  assertWidenedDependents(featureList, 'the generated-status corpus');

  for (const status of ['', ' ', '   ', '\t', '\n \t']) {
    insights.analyzeEmpty([node('A', status), node('T', 'planning')], [depends('A', 'T')],
      `empty ancestor status ${JSON.stringify(status)}`);
  }
  for (const status of ['', ' ', '\t', '\n \t', '\u00a0', '\u3000\u2003']) {
    for (const [position, nodes] of amongSiblings(node('A', status))) {
      insights.analyzeEmpty(nodes, SIBLING_EDGES(),
        `a record with the empty or whitespace-only status ${JSON.stringify(status)} ${position} among valid siblings`);
    }
  }

  for (const status of [
    'completed', 'Completed', 'COMPLETED', 'cOmPlEtEd', '  completed  ', '\tCOMPLETED\n',
    ...PADDED_STATUSES.filter((padded) => normalizedStatus(padded) === 'completed'),
  ]) {
    const { result } = analyzeAgainstReference([node('A', status), node('T', 'planning')], [depends('A', 'T')],
      `completed variant ${JSON.stringify(status)} above T`);
    assert.strictEqual(result.perNode.T.isReady, true,
      `${JSON.stringify(status)} normalizes to completed and satisfies readiness`);
    assert.strictEqual(result.perNode.A.isReady, false, 'a completed record is never itself ready');
  }

  for (const [label, record] of [
    ['blocked', node('X', 'blocked')],
    ['parked', node('X', 'parked')],
    ['mixed-case blocked', node('X', ' BLOCKED ')],
    ['mixed-case parked', node('X', 'Parked')],
    ...PADDED_STATUSES.filter((padded) => normalizedStatus(padded) !== 'completed')
      .map((padded) => [`padded ${JSON.stringify(padded)}`, node('X', padded)]),
    ['completed', node('X', 'completed')],
    ['explicit stub', node('X', 'planning', { isStub: true })],
    ['explicit discarded stub', node('X', 'discarded', { isStub: true })],
    ['null-status stub', node('X', null)],
  ]) {
    const { result: alone } = analyzeAgainstReference([record], [], `${label} alone`);
    assert.strictEqual(alone.perNode.X.isReady, false, `${label} is never ready, even with no upstream`);
    const { result: behindCompleted } = analyzeAgainstReference([node('C', 'completed'), record], [depends('C', 'X')],
      `${label} behind completed work`);
    assert.strictEqual(behindCompleted.perNode.X.isReady, false,
      `${label} is never ready, even behind completed work`);
  }

  for (const status of ['planning', 'in_progress', 'waiting', 'archived', ...unknown.slice(0, 60)]) {
    const { result } = analyzeAgainstReference([node('X', status)], [], `${JSON.stringify(status)} alone`);
    assert.strictEqual(result.perNode.X.isReady, true,
      `eligible, non-stuck ${JSON.stringify(status)} with no upstream is ready`);
  }
});

test('PH0-ROOT-CAUSES-SHORTEST-HOPS: each upstream root blocker once, at its shortest hop count, in input record order', () => {
  const assertAttributionInvariants = (result, label) => {
    for (const card of Object.keys(result.perNode)) {
      const entry = result.perNode[card];
      if (!entry.upstream.length) continue;
      const causes = entry.rootCauses.map((cause) => cause.card);
      const upstreamRoots = entry.upstream.filter((upstreamCard) => result.perNode[upstreamCard].isRootBlocker);
      if (upstreamRoots.length) {
        assert.strictEqual(new Set(causes).size, causes.length, `${label}: ${card} lists each root blocker once`);
      }
      assert.deepStrictEqual(causes, upstreamRoots,
        `${label}: ${card} lists exactly its upstream root blockers, in record order`);
    }
  };

  const diamondNodes = [node('R', 'blocked'), node('A', 'planning'), node('B', 'planning'), node('L', 'planning')];
  for (const edges of [
    [depends('R', 'A'), depends('A', 'B'), depends('B', 'L'), depends('R', 'L')],
    [depends('R', 'L'), depends('R', 'A'), depends('A', 'B'), depends('B', 'L')],
  ]) {
    const diamond = insights.analyzeGraph(diamondNodes, edges);
    assert.deepStrictEqual(diamond.perNode.L.rootCauses, [{ card: 'R', hops: 1 }],
      'a diamond with paths of length 1 and 3 reports 1');
    assert.deepStrictEqual(diamond.perNode.B.rootCauses, [{ card: 'R', hops: 2 }]);
    assert.deepStrictEqual(diamond.perNode.A.rootCauses, [{ card: 'R', hops: 1 }]);
    assertAttributionInvariants(diamond, 'diamond');
  }

  const twin = insights.analyzeGraph([
    node('R', 'parked'), node('X', 'planning'), node('Y', 'planning'), node('L', 'planning'),
  ], [depends('R', 'X'), depends('R', 'Y'), depends('X', 'L'), depends('Y', 'L')]);
  assert.deepStrictEqual(twin.perNode.L.rootCauses, [{ card: 'R', hops: 2 }],
    'a root blocker reached by two equal paths is listed once');

  const calm = insights.analyzeGraph([
    node('C', 'completed'), node('P', 'planning'), node('T', 'planning'), node('D', 'blocked'),
  ], [depends('C', 'P'), depends('P', 'T'), depends('T', 'D')]);
  for (const card of ['P', 'T']) {
    assert.deepStrictEqual(calm.perNode[card].rootCauses, [], `${card} has no stuck upstream, so no root causes`);
  }
  assert.deepStrictEqual(calm.perNode.D.rootCauses, [],
    "a root blocker's own rootCauses is empty, even with upstream records");
  assertAttributionInvariants(calm, 'calm');

  const nested = insights.analyzeGraph([
    node('X', 'blocked'), node('Y', 'parked'), node('Z', 'planning'),
  ], [depends('X', 'Y'), depends('Y', 'Z')]);
  assertAttributionInvariants(nested, 'nested');

  const next = prng(0x5eed0002);
  const rootPool = [
    { card: 'zz-last-alphabetically', status: 'blocked' },
    { card: 'A', status: 'parked' },
    { card: 'a-much-longer-root-card-name-than-any-other-root', status: ' BLOCKED ' },
    { card: 'm', status: 'Parked' },
    { card: '0', status: 'blocked' },
    { card: 'Ω', status: 'parked' },
  ];
  for (let trial = 0; trial < 40; trial += 1) {
    const roots = shuffled(rootPool, next).slice(0, 2 + (next() % (rootPool.length - 1)));
    const nodes = [];
    const edges = [];
    const expected = [];
    roots.forEach((root, index) => {
      const hops = 1 + (next() % 4);
      nodes.push(node(root.card, root.status));
      let previous = root.card;
      for (let step = 1; step < hops; step += 1) {
        const middle = `mid-${trial}-${index}-${step}`;
        nodes.push(node(middle, 'planning'));
        edges.push(depends(previous, middle));
        previous = middle;
      }
      edges.push(depends(previous, 'TARGET'));
      expected.push({ card: root.card, hops });
    });
    nodes.push(node('TARGET', 'planning'));
    const result = insights.analyzeGraph(nodes, shuffled(edges, next));
    assert.deepStrictEqual(result.perNode.TARGET.rootCauses, expected,
      `trial ${trial}: root causes follow input record order, not card name, length, status, or hop distance`);
    assertAttributionInvariants(result, `trial ${trial}`);
  }

  const closureStart = source.indexOf('  _closure(');
  const analysisStart = source.indexOf('  analyzeGraph(nodes, edges) {', closureStart);
  assert.ok(closureStart >= 0 && analysisStart > closureStart, 'the closure precedes analyzeGraph in the helper');
  const closureSource = executableSource(source.slice(closureStart, analysisStart));
  const analysisSource = executableSource(source.slice(analysisStart));
  const reorders = /\.(?:sort|toSorted|reverse|toReversed|splice|toSpliced|unshift|pop|shift|copyWithin|fill)\(/g;
  assert.deepStrictEqual(analysisSource.match(reorders), null,
    'analyzeGraph source calls none of the listed sort, reverse, or reorder methods');
  assert.deepStrictEqual(closureSource.match(reorders), ['.shift(', '.sort('],
    'of the listed methods, the closure calls only its FIFO shift and one sort');
  assert.ok(/\.sort\(\(\[left\], \[right\]\) => order\.get\(left\) - order\.get\(right\)\)/.test(closureSource),
    "the closure's only sort is keyed on input record order");
});

// The seeded generated graphs that PH0-SUMMARY-COUNTS checks counts on and
// PH0C-FULL-REFERENCE compares with the reference. The same seed always yields
// the same graphs.
function generatedCountCorpus() {
  const next = prng(0x5eed0003);
  const statusPool = [
    'planning', 'in_progress', 'completed', 'COMPLETED', 'parked', ' Parked ', 'blocked', 'BLOCKED',
    'waiting', 'archived', null,
    'discarded', ' Reviewing ', 'Blocking', 'unknown', '\u00a0Blocked', GENERATED_UNKNOWN_STATUSES[2],
  ];
  const corpus = [];
  for (let trial = 0; trial < 150; trial += 1) {
    const size = 1 + (next() % 9);
    const nodes = Array.from({ length: size }, (_value, index) => {
      const status = statusPool[next() % statusPool.length];
      const card = `G${trial}-${index}`;
      return status !== null && next() % 5 === 0 ? node(card, status, { isStub: true }) : node(card, status);
    });
    const edges = [];
    for (let attempt = 0; attempt < size * 2; attempt += 1) {
      const from = next() % size;
      const to = next() % size;
      if (from === to) continue;
      edges.push({ from: nodes[from].card, to: nodes[to].card, kind: next() % 4 === 0 ? 'order' : 'depends' });
    }
    corpus.push({ label: `generated trial ${trial}`, nodes, edges });
  }
  return corpus;
}

test('PH0-SUMMARY-COUNTS: ready, needs-you, and blocked counts are exact while shipped summary fields keep their values, and each fixture\'s analysis equals the reference', () => {
  const normalized = (record) => (typeof record.status === 'string' ? record.status.trim().toLowerCase() : null);
  const expectedCounts = (nodes, result) => ({
    readyCount: Object.keys(result.perNode).filter((card) => result.perNode[card].isReady === true).length,
    needsYouCount: nodes.filter((record) => record.isStub !== true && normalized(record) === 'parked').length,
    blockedCount: nodes.filter((record) => record.isStub !== true && normalized(record) === 'blocked').length,
  });
  const assertCounts = (nodes, edges, label) => {
    const { result } = analyzeAgainstReference(nodes, edges, label);
    const shipped = legacy.analyzeGraph(nodes, edges);
    assert.notDeepStrictEqual(result.perNode, {}, `${label}: fixture is a valid, non-empty graph`);
    const counts = expectedCounts(nodes, result);
    assert.strictEqual(result.summary.readyCount, counts.readyCount, `${label}: readyCount counts perNode isReady`);
    assert.strictEqual(result.summary.needsYouCount, counts.needsYouCount, `${label}: needsYouCount counts non-stub parked`);
    assert.strictEqual(result.summary.blockedCount, counts.blockedCount, `${label}: blockedCount counts non-stub blocked`);
    for (const key of LEGACY_SUMMARY_KEYS) {
      assert.deepStrictEqual(result.summary[key], shipped.summary[key], `${label}: shipped summary.${key} is unchanged`);
    }
    return result;
  };

  const zero = assertCounts([
    node('C', 'completed'), node('PS', 'parked', { isStub: true }), node('BS', 'blocked', { isStub: true }),
    node('N', null), node('W', 'planning'),
    node('D', 'discarded'), node('V', 'Reviewing'), node('K', 'Blocking'), node('U', 'unknown'),
    node('DS', ' Discarded ', { isStub: true }),
  ], [depends('PS', 'W'), depends('W', 'D'), depends('W', 'V'), depends('W', 'K'), depends('W', 'U')],
  'zero of each, with discarded, reviewing, Blocking, and unknown records below the planning record W');
  assert.deepStrictEqual(zero.summary, {
    stuckCount: 0, rootBlockers: [], gatedTotal: 0, readyCount: 0, needsYouCount: 0, blockedCount: 0,
  });

  const one = assertCounts([
    node('R', 'planning'), node('P', 'parked'), node('B', 'blocked'), node('C', 'completed'),
    node('PS', 'parked', { isStub: true }), node('K', 'Blocking'), node('D', ' Discarded '),
  ], [depends('C', 'R'), depends('P', 'K'), depends('B', 'D')],
  'one of each, with a Blocking record below P and a discarded record below B');
  assert.deepStrictEqual(one.summary, {
    stuckCount: 2, rootBlockers: ['P', 'B'], gatedTotal: 2, readyCount: 1, needsYouCount: 1, blockedCount: 1,
  });

  const many = assertCounts([
    node('R1', 'planning'), node('R2', 'in_progress'), node('R3', 'waiting'),
    node('P1', 'parked'), node('P2', 'Parked'), node('P3', ' PARKED '),
    node('B1', 'blocked'), node('B2', 'BLOCKED'), node('X', 'planning'),
    node('PS', 'parked', { isStub: true }), node('BS', 'blocked', { isStub: true }), node('C', 'completed'),
    node('R4', ' Discarded '), node('R5', 'Reviewing'), node('R6', 'Blocking'), node('R7', 'unknown'),
    node('R8', GENERATED_UNKNOWN_STATUSES[0]), node('Q', 'reviewing'), node('V', 'Discarded'),
  ], [
    depends('C', 'R3'), depends('B1', 'X'), depends('P1', 'B2'),
    depends('C', 'R4'), depends('C', 'R6'), depends('P2', 'Q'), depends('B1', 'V'),
  ], 'many of each, with discarded, reviewing, Blocking, unknown, and generated-status records');
  assert.deepStrictEqual(many.summary, {
    stuckCount: 5, rootBlockers: ['P1', 'P2', 'P3', 'B1'], gatedTotal: 4,
    readyCount: 8, needsYouCount: 3, blockedCount: 2,
  });

  const seen = { readyCount: new Set(), needsYouCount: new Set(), blockedCount: new Set() };
  for (const { label, nodes, edges } of generatedCountCorpus()) {
    const result = assertCounts(nodes, edges, label);
    for (const key of Object.keys(seen)) seen[key].add(Math.min(result.summary[key], 2));
  }
  for (const key of Object.keys(seen)) {
    assert.deepStrictEqual([...seen[key]].sort(), [0, 1, 2], `the generated corpus covers zero, one, and many ${key}`);
  }
});

// Harness-local reference for every analysis output. It never calls the
// helper. A record's status is trimmed and lower-cased; a record is a stub
// when isStub is true or its status is null, eligible when it is not a stub
// and its status is not completed, and stuck when it is eligible and blocked
// or parked. For each record the reference walks reversed depends edges one
// level at a time, so the level at which an ancestor is first reached is that
// ancestor's shortest hop count, and the record itself is never its own
// ancestor. From those ancestor sets, per record:
//   upstream       its ancestors, in input record order
//   downstream     the records it is an ancestor of, in input record order
//   gates          the number of eligible records in downstream
//   isRootBlocker  stuck, with no stuck ancestor
//   isReady        eligible, not stuck, and every ancestor a non-stub whose
//                  status is completed
//   rootCauses     the root blockers among its ancestors, in input record
//                  order, each with its shortest hop count
// and in the summary: the number of stuck records, the root blockers in input
// record order, the number of eligible records downstream of at least one
// root blocker, the number of ready records, and the numbers of non-stub
// parked and non-stub blocked records.
function referenceModel(nodes, edges) {
  const records = nodes.map((record, index) => {
    const status = record.status === null ? null : record.status.trim().toLowerCase();
    const stub = record.isStub === true || status === null;
    let kind = status;
    if (status === null) kind = 'null-status';
    else if (stub) kind = 'stub';
    const eligible = !stub && status !== 'completed';
    const stuck = eligible && (status === 'blocked' || status === 'parked');
    return { card: record.card.trim(), index, rawStatus: record.status, status, kind, stub, eligible, stuck };
  });
  const parents = new Map(records.map(({ card }) => [card, []]));
  for (const edge of edges) {
    if (edge.kind === 'depends') parents.get(edge.to.trim()).push(edge.from.trim());
  }
  const ancestorHops = new Map();
  for (const { card } of records) {
    const hops = new Map();
    let level = [card];
    for (let distance = 1; level.length > 0; distance += 1) {
      const nextLevel = [];
      for (const member of level) {
        for (const parent of parents.get(member)) {
          if (parent === card || hops.has(parent)) continue;
          hops.set(parent, distance);
          nextLevel.push(parent);
        }
      }
      level = nextLevel;
    }
    ancestorHops.set(card, hops);
  }
  const upstreamOf = (record) => records.filter((other) => ancestorHops.get(record.card).has(other.card));
  const downstreamOf = (record) => records.filter((other) => ancestorHops.get(other.card).has(record.card));
  const rootBlockers = records.filter((record) => record.stuck && !upstreamOf(record).some((above) => above.stuck));
  const isRoot = new Set(rootBlockers.map(({ card }) => card));
  const entries = records.map((record) => {
    const upstream = upstreamOf(record);
    const downstream = downstreamOf(record);
    return [record.card, {
      upstream: upstream.map(({ card }) => card),
      downstream: downstream.map(({ card }) => card),
      gates: downstream.filter((below) => below.eligible).length,
      isRootBlocker: isRoot.has(record.card),
      isReady: record.eligible && !record.stuck
        && upstream.every((above) => !above.stub && above.status === 'completed'),
      rootCauses: upstream.filter((above) => isRoot.has(above.card))
        .map((above) => ({ card: above.card, hops: ancestorHops.get(record.card).get(above.card) })),
    }];
  });
  const gated = new Set(rootBlockers.flatMap((root) => downstreamOf(root)
    .filter((below) => below.eligible).map(({ card }) => card)));
  const analysis = {
    perNode: Object.fromEntries(entries),
    summary: {
      stuckCount: records.filter((record) => record.stuck).length,
      rootBlockers: rootBlockers.map(({ card }) => card),
      gatedTotal: gated.size,
      readyCount: entries.filter(([, entry]) => entry.isReady).length,
      needsYouCount: records.filter((record) => !record.stub && record.status === 'parked').length,
      blockedCount: records.filter((record) => !record.stub && record.status === 'blocked').length,
    },
  };
  return { records, parents, ancestorHops, analysis };
}

// Deliberately wrong references. Each is the reference source with the listed
// text replaced, and names the case whose compared graphs it is run against.
const WRONG_REFERENCES = [
  ['keeps only the first 3 root causes of a record', 'PH0C-SIZES-BEYOND-TESTED', [[
    'hops: ancestorHops.get(record.card).get(above.card) })),',
    'hops: ancestorHops.get(record.card).get(above.card) })).slice(0, 3),',
  ]]],
  ['keeps only the first 6 root causes of a record', 'PH0C-SIZES-BEYOND-TESTED', [[
    'hops: ancestorHops.get(record.card).get(above.card) })),',
    'hops: ancestorHops.get(record.card).get(above.card) })).slice(0, 6),',
  ]]],
  ['skips ancestors listed after the record when judging readiness', 'PH0C-ANY-ORDER', [[
    'upstream.every((above) =>',
    'upstream.filter((above) => above.index < record.index).every((above) =>',
  ]]],
  ['skips root blockers listed after the record when listing root causes', 'PH0C-ANY-ORDER', [[
    'upstream.filter((above) => isRoot.has(above.card))',
    'upstream.filter((above) => above.index < record.index && isRoot.has(above.card))',
  ]]],
  ['lists every stuck ancestor as a root cause', 'PH0C-ANY-ORDER', [[
    'upstream.filter((above) => isRoot.has(above.card))',
    'upstream.filter((above) => above.stuck)',
  ]]],
  ['orders root causes by hop count', 'PH0C-SIZES-BEYOND-TESTED', [[
    'hops: ancestorHops.get(record.card).get(above.card) })),',
    'hops: ancestorHops.get(record.card).get(above.card) })).sort((left, right) => left.hops - right.hops),',
  ]]],
  ['keeps the hop count of the last level that reaches an ancestor', 'PH0C-ANY-ORDER', [[
    'if (parent === card || hops.has(parent)) continue;',
    'if (parent === card) continue;\n          if (hops.has(parent)) { hops.set(parent, distance); continue; }',
  ]]],
  ['counts blocked and parked stubs as stuck', 'PH0C-ANY-ORDER', [[
    "const stuck = eligible && (status === 'blocked' || status === 'parked');",
    "const stuck = status === 'blocked' || status === 'parked';",
  ]]],
  ['follows order edges', 'PH0C-FULL-REFERENCE', [[
    "if (edge.kind === 'depends') parents",
    "if (edge.kind === 'depends' || edge.kind === 'order') parents",
  ]]],
  ['accepts a completed stub ancestor for readiness', 'PH0C-ANY-ORDER', [[
    "!above.stub && above.status === 'completed'",
    "above.status === 'completed'",
  ]]],
  ['stops closures beyond 12 hops', 'PH0C-SIZES-BEYOND-TESTED', [[
    'for (let distance = 1; level.length > 0; distance += 1) {',
    'for (let distance = 1; level.length > 0 && distance <= 12; distance += 1) {',
  ]]],
  ['caps stuckCount at 4', 'PH0C-SIZES-BEYOND-TESTED', [[
    'stuckCount: records.filter((record) => record.stuck).length,',
    'stuckCount: Math.min(4, records.filter((record) => record.stuck).length),',
  ]]],
  ['keeps only the first 4 root blockers', 'PH0C-SIZES-BEYOND-TESTED', [[
    'rootBlockers: rootBlockers.map(({ card }) => card),',
    'rootBlockers: rootBlockers.map(({ card }) => card).slice(0, 4),',
  ]]],
  ['caps gatedTotal at 4', 'PH0C-SIZES-BEYOND-TESTED', [[
    'gatedTotal: gated.size,',
    'gatedTotal: Math.min(4, gated.size),',
  ]]],
  ['caps readyCount at 4', 'PH0C-SIZES-BEYOND-TESTED', [[
    'readyCount: entries.filter(([, entry]) => entry.isReady).length,',
    'readyCount: Math.min(4, entries.filter(([, entry]) => entry.isReady).length),',
  ]]],
  ['caps needsYouCount at 4', 'PH0C-SIZES-BEYOND-TESTED', [[
    "needsYouCount: records.filter((record) => !record.stub && record.status === 'parked').length,",
    "needsYouCount: Math.min(4, records.filter((record) => !record.stub && record.status === 'parked').length),",
  ]]],
  ['caps blockedCount at 4', 'PH0C-SIZES-BEYOND-TESTED', [[
    "blockedCount: records.filter((record) => !record.stub && record.status === 'blocked').length,",
    "blockedCount: Math.min(4, records.filter((record) => !record.stub && record.status === 'blocked').length),",
  ]]],
  ['stops closures beyond 64 hops', 'PH0C-SIZES-BEYOND-TESTED', [[
    'for (let distance = 1; level.length > 0; distance += 1) {',
    'for (let distance = 1; level.length > 0 && distance <= 64; distance += 1) {',
  ]]],
  ['keeps only the first 16 root causes of a record', 'PH0C-SIZES-BEYOND-TESTED', [[
    'hops: ancestorHops.get(record.card).get(above.card) })),',
    'hops: ancestorHops.get(record.card).get(above.card) })).slice(0, 16),',
  ]]],
  ['caps readyCount at 9', 'PH0C-SIZES-BEYOND-TESTED', [[
    'readyCount: entries.filter(([, entry]) => entry.isReady).length,',
    'readyCount: Math.min(9, entries.filter(([, entry]) => entry.isReady).length),',
  ]]],
  ['withholds readiness from discarded records', 'PH0-READINESS-COMPLETED-ONLY', [[
    'isReady: record.eligible && !record.stuck',
    "isReady: record.eligible && !record.stuck && record.status !== 'discarded'",
  ]]],
  ['counts unknown records as needs-you', 'PH0-READINESS-COMPLETED-ONLY', [[
    "needsYouCount: records.filter((record) => !record.stub && record.status === 'parked').length,",
    "needsYouCount: records.filter((record) => !record.stub && (record.status === 'parked' || record.status === 'unknown')).length,",
  ]]],
  ['lists no root causes for reviewing records', 'PH0C-ANY-ORDER', [[
    'rootCauses: upstream.filter((above) => isRoot.has(above.card))',
    "rootCauses: upstream.filter((above) => record.status !== 'reviewing' && isRoot.has(above.card))",
  ]]],
  ['counts statuses that start with block as blocked', 'PH0C-FULL-REFERENCE', [[
    "blockedCount: records.filter((record) => !record.stub && record.status === 'blocked').length,",
    "blockedCount: records.filter((record) => !record.stub && record.status.startsWith('block')).length,",
  ]]],
  ['lower-cases statuses without trimming them', 'PH0C-FULL-REFERENCE', [[
    'record.status.trim().toLowerCase()',
    'record.status.toLowerCase()',
  ]]],
  ['trims statuses without lower-casing them', 'PH0C-FULL-REFERENCE', [[
    'record.status.trim().toLowerCase()',
    'record.status.trim()',
  ]]],
  ...['PH0C-ANY-ORDER', 'PH0C-FULL-REFERENCE'].map((caseName) => [
    'looks root blockers up in a plain object keyed by card', caseName, [[
      'const isRoot = new Set(rootBlockers.map(({ card }) => card));',
      'const rootTable = {};\n  for (const { card } of rootBlockers) rootTable[card] = true;\n'
        + '  const isRoot = { has: (card) => Boolean(rootTable[card]) };',
    ]]]),
  ...['PH0C-ANY-ORDER', 'PH0C-FULL-REFERENCE'].map((caseName) => [
    'looks completed ancestors up in a plain object keyed by card', caseName, [
      [
        'const parents = new Map(records.map(({ card }) => [card, []]));',
        'const parents = new Map(records.map(({ card }) => [card, []]));\n  const completedTable = {};\n'
          + "  for (const record of records) if (!record.stub && record.status === 'completed') completedTable[record.card] = true;",
      ],
      [
        "upstream.every((above) => !above.stub && above.status === 'completed')",
        'upstream.every((above) => Boolean(completedTable[above.card]))',
      ],
    ]]),
];

// Asserts that a helper result deep-equals and serializes identically to the
// reference's analysis of the same input, and returns the reference model.
// The card-list, per-card, and summary assertions run only when the whole
// analysis differs from the reference, so that a failure names the first of
// those that differs.
function assertMatchesReference(result, nodes, edges, label, reference = referenceModel) {
  const model = reference(nodes, edges);
  const expected = model.analysis;
  if (JSON.stringify(result) === JSON.stringify(expected) && util.isDeepStrictEqual(result, expected)) return model;
  assert.deepStrictEqual(Object.keys(result.perNode), Object.keys(expected.perNode),
    `${label}: perNode lists the reference's cards in the reference's order`);
  for (const card of Object.keys(expected.perNode)) {
    assert.deepStrictEqual(result.perNode[card], expected.perNode[card],
      `${label}: perNode[${JSON.stringify(card)}] deep-equals the reference`);
  }
  assert.deepStrictEqual(result.summary, expected.summary, `${label}: summary deep-equals the reference`);
  assert.deepStrictEqual(result, expected, `${label}: the analysis deep-equals the reference`);
  assert.strictEqual(JSON.stringify(result), JSON.stringify(expected),
    `${label}: the analysis serializes identically to the reference`);
  return model;
}

// Each helper result compared with the reference, with its input, so that the
// wrong references can be compared on the same graphs.
const referenceComparisons = [];

function analyzeAgainstReference(nodes, edges, label) {
  const result = insights.analyzeGraph(nodes, edges);
  const model = assertMatchesReference(result, nodes, edges, label);
  referenceComparisons.push({ caseName: currentCase, label, nodes, edges, result });
  return { result, model, features: referenceFeatures(model) };
}

// Graph features read from the reference model alone, used to assert what a
// corpus contains. withheldByLater holds the kinds of ancestor that, listed
// after an eligible, non-stuck, not-ready record whose earlier-listed
// ancestors are all completed non-stubs, withhold that record's readiness.
// behindCompleted holds the input statuses of non-stub records that have
// ancestors, all of them completed non-stubs; belowRootBlocker holds the input
// statuses of non-stub records that have a root cause.
function referenceFeatures(model) {
  const { records, parents, ancestorHops, analysis } = model;
  const byCard = new Map(records.map((record) => [record.card, record]));
  const ancestorsOf = (record) => [...ancestorHops.get(record.card).keys()].map((card) => byCard.get(card));
  const causesOf = (record) => analysis.perNode[record.card].rootCauses.map((cause) => byCard.get(cause.card));
  const selfAndAncestors = (card) => new Set([card, ...ancestorHops.get(card).keys()]);
  const listsCause = (kind) => records.some((record) => record.kind === kind && causesOf(record).length > 0);
  const completedNonStub = (record) => !record.stub && record.status === 'completed';
  const withheldByLater = new Set();
  for (const record of records) {
    if (!record.eligible || record.stuck || analysis.perNode[record.card].isReady) continue;
    const ancestors = ancestorsOf(record);
    if (!ancestors.filter((above) => above.index < record.index).every(completedNonStub)) continue;
    for (const above of ancestors) {
      if (above.index > record.index && !completedNonStub(above)) {
        withheldByLater.add(above.stub && above.status === 'completed' ? 'completed stub' : above.kind);
      }
    }
  }
  return {
    cycle: records.some((record) => ancestorsOf(record).some((above) => ancestorHops.get(above.card).has(record.card))),
    diamond: records.some((record) => {
      const distinct = [...new Set(parents.get(record.card))];
      return distinct.some((left, index) => distinct.slice(index + 1)
        .some((right) => [...selfAndAncestors(left)].some((shared) => selfAndAncestors(right).has(shared))));
    }),
    stuckOverStuck: records.some((record) => record.stuck && !analysis.perNode[record.card].isRootBlocker),
    ancestorBeforeDependent: records.some((record) => ancestorsOf(record).some((above) => above.index < record.index)),
    ancestorAfterDependent: records.some((record) => ancestorsOf(record).some((above) => above.index > record.index)),
    rootBeforeDependent: records.some((record) => causesOf(record).some((root) => root.index < record.index)),
    rootAfterDependent: records.some((record) => causesOf(record).some((root) => root.index > record.index)),
    readyWithLaterAncestor: records.some((record) => analysis.perNode[record.card].isReady
      && ancestorsOf(record).some((above) => above.index > record.index)),
    withheldByLater,
    behindCompleted: new Set(records.filter((record) => !record.stub && ancestorsOf(record).length > 0
      && ancestorsOf(record).every(completedNonStub)).map((record) => record.rawStatus)),
    belowRootBlocker: new Set(records.filter((record) => !record.stub && causesOf(record).length > 0)
      .map((record) => record.rawStatus)),
    rootWithOnlyIneligibleDescendants: analysis.summary.rootBlockers.some((root) => {
      const descendants = records.filter((record) => causesOf(record).some((cause) => cause.card === root));
      return descendants.length > 0
        && descendants.every(({ kind }) => kind === 'completed' || kind === 'stub' || kind === 'null-status');
    }),
    completedListsCause: listsCause('completed'),
    stubListsCause: listsCause('stub'),
    nullStatusListsCause: listsCause('null-status'),
    maxAncestorHops: Math.max(0, ...records.flatMap((record) => [...ancestorHops.get(record.card).values()])),
    maxCauseHops: Math.max(0, ...records.flatMap((record) => analysis.perNode[record.card].rootCauses
      .map((cause) => cause.hops))),
    maxCauses: Math.max(0, ...records.map((record) => causesOf(record).length)),
  };
}

// One graph in which a record with the given status sits in each of these
// places: A directly above the planning record T; U between the completed
// records C1 and C2, two hops above the planning record T2; X below only the
// completed record C3; Y below the parked root blocker R and above the
// planning record Z; and W above the blocked record B. The records are listed
// in a seeded shuffled order.
function statusRoles(status, next) {
  return {
    nodes: shuffled([
      node('A', status), node('T', 'planning'),
      node('C1', 'completed'), node('U', status), node('C2', 'completed'), node('T2', 'planning'),
      node('C3', 'completed'), node('X', status),
      node('R', ' Parked '), node('Y', status), node('Z', 'planning'),
      node('W', status), node('B', 'blocked'),
    ], next),
    edges: shuffled([
      depends('A', 'T'), depends('C1', 'U'), depends('U', 'C2'), depends('C2', 'T2'),
      depends('C3', 'X'), depends('R', 'Y'), depends('Y', 'Z'), depends('W', 'B'),
    ], next),
  };
}

// In the reference, across the given features: for each of discarded,
// reviewing, a generated unknown status, and a mixed-case status whose
// normalized form starts with block or park but is neither blocked nor parked,
// some non-stub record with that input status has at least one ancestor and
// only completed non-stub ancestors, and some non-stub record with that input
// status has a root cause.
function assertWidenedDependents(featureList, label) {
  const stuckLike = (raw) => raw !== raw.toLowerCase() && raw !== raw.toUpperCase()
    && /^(?:block|park)/.test(normalizedStatus(raw)) && !['blocked', 'parked'].includes(normalizedStatus(raw));
  for (const [name, matches] of [
    ['discarded', (raw) => normalizedStatus(raw) === 'discarded'],
    ['reviewing', (raw) => normalizedStatus(raw) === 'reviewing'],
    ['generated unknown', (raw) => GENERATED_UNKNOWN_NORMALIZED.has(normalizedStatus(raw))],
    ['mixed-case stuck-like', stuckLike],
  ]) {
    const statuses = (feature) => featureList.flatMap((features) => [...features[feature]])
      .filter((raw) => typeof raw === 'string' && matches(raw));
    assert.ok(statuses('behindCompleted').length > 0,
      `${label}: some compared non-stub ${name} record has ancestors, all of them completed non-stubs`);
    assert.ok(statuses('belowRootBlocker').length > 0,
      `${label}: some compared non-stub ${name} record has a root cause`);
  }
}

function permutations(items) {
  if (items.length < 2) return [[...items]];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)])
    .map((rest) => [item, ...rest]));
}

// Minimal root-cause fixtures. PH0-ROOT-CAUSES-SHORTEST-HOPS runs each check
// against the helper, and PH0B-LABEL-TESTS-ITS-RULE also asserts that each
// listed mutant of the helper fails at that fixture's message.
const ROOT_CAUSE_MINIMAL_FIXTURES = [
  {
    message: 'L lists R at 1 hop when the root blocker R is listed after L',
    nodes: [node('L', 'planning'), node('R', 'blocked')],
    edges: [depends('R', 'L')],
    check: (result, message) => assert.deepStrictEqual(result.perNode.L.rootCauses, [{ card: 'R', hops: 1 }], message),
    mutant: [
      'rootCauses: [],\n          },\n        });\n      }\n\n      for (const record of records.values()) {\n'
        + '        perNode[record.card].rootCauses = upstreamWithDepth.get(record.card)\n'
        + '          .filter(({ card }) => perNode[card].isRootBlocker)\n'
        + '          .map(({ card, hops }) => ({ card, hops }));\n      }',
      'rootCauses: aboveWithDepth\n'
        + '              .filter(({ card }) => perNode[card] && perNode[card].isRootBlocker)\n'
        + '              .map(({ card, hops }) => ({ card, hops })),\n          },\n        });\n      }',
    ],
  },
  {
    message: 'the completed record C lists its root blocker R at 1 hop',
    nodes: [node('L', 'planning'), node('C', 'completed'), node('R', 'blocked')],
    edges: [depends('R', 'L'), depends('R', 'C')],
    check: (result, message) => assert.deepStrictEqual(result.perNode.C.rootCauses, [{ card: 'R', hops: 1 }], message),
    mutant: [
      'perNode[record.card].rootCauses = upstreamWithDepth.get(record.card)',
      'perNode[record.card].rootCauses = record.status === "completed" ? [] : upstreamWithDepth.get(record.card)',
    ],
  },
  {
    message: 'C lists R at 1 hop when the completed record C is the only descendant of the root blocker R',
    nodes: [node('R', 'blocked'), node('C', 'completed')],
    edges: [depends('R', 'C')],
    check: (result, message) => assert.deepStrictEqual(result.perNode.C.rootCauses, [{ card: 'R', hops: 1 }], message),
    mutant: [
      '.filter(({ card }) => perNode[card].isRootBlocker)',
      '.filter(({ card }) => perNode[card].isRootBlocker && perNode[card].gates > 0)',
    ],
  },
  {
    message: 'S lists R at 1 hop when the stub S is the only descendant of the root blocker R',
    nodes: [node('R', 'parked'), node('S', 'planning', { isStub: true })],
    edges: [depends('R', 'S')],
    check: (result, message) => assert.deepStrictEqual(result.perNode.S.rootCauses, [{ card: 'R', hops: 1 }], message),
    mutant: [
      '.filter(({ card }) => perNode[card].isRootBlocker)',
      '.filter(({ card }) => perNode[card].isRootBlocker && perNode[card].gates > 0)',
    ],
  },
  {
    message: 'N lists R at 1 hop when the null-status record N is the only descendant of the root blocker R',
    nodes: [node('R', 'blocked'), node('N', null)],
    edges: [depends('R', 'N')],
    check: (result, message) => assert.deepStrictEqual(result.perNode.N.rootCauses, [{ card: 'R', hops: 1 }], message),
    mutant: [
      '.filter(({ card }) => perNode[card].isRootBlocker)',
      '.filter(({ card }) => perNode[card].isRootBlocker && perNode[card].gates > 0)',
    ],
  },
];

test('PH0-ROOT-CAUSES-SHORTEST-HOPS: a dependent listed before its root blocker, a completed dependent, and a completed, stub, or null-status only descendant each list the root blocker at 1 hop', () => {
  for (const { message, nodes, edges, check } of ROOT_CAUSE_MINIMAL_FIXTURES) {
    check(insights.analyzeGraph(nodes, edges), message);
  }
});

test('PH0C-ANY-ORDER: every analysis output equals the reference in every input order of each template', () => {
  const next = prng(0x5eed0004);
  const factorial = (count) => (count < 2 ? 1 : count * factorial(count - 1));
  const everyOrder = (template) => {
    const orders = permutations(template.nodes);
    assert.strictEqual(new Set(orders.map((order) => order.map(({ card }) => card).join('\u0000'))).size,
      factorial(template.nodes.length),
      `${template.name}: the orders are all ${factorial(template.nodes.length)} distinct input orders of the template`);
    return orders.map((order, index) => {
      const label = `${template.name}, order ${index}`;
      return { label, ...analyzeAgainstReference(order, shuffled(template.edges, next), label) };
    });
  };
  const DEPENDENT_KINDS = ['completed', 'stub', 'null-status'];

  const rootTemplates = [
    {
      name: 'roots whose only descendant is completed, a stub, or null-status',
      nodes: [
        node('R1', 'blocked'), node('C', 'completed'), node('R2', 'parked'),
        node('S', 'planning', { isStub: true }), node('R3', ' BLOCKED '), node('N', null),
      ],
      edges: [depends('R1', 'C'), depends('R2', 'S'), depends('R3', 'N')],
      features: ['rootWithOnlyIneligibleDescendants', 'completedListsCause', 'stubListsCause', 'nullStatusListsCause'],
      dependentKinds: ['completed', 'stub', 'null-status'],
    },
    {
      name: 'diamond through completed, stub, and null-status records',
      nodes: [
        node('R', 'parked'), node('A', 'completed'), node('S', 'planning', { isStub: true }),
        node('N', null), node('L', 'planning'),
      ],
      edges: [depends('R', 'A'), depends('A', 'L'), depends('R', 'S'), depends('S', 'N'), depends('N', 'L')],
      features: ['diamond', 'completedListsCause', 'stubListsCause', 'nullStatusListsCause'],
      dependentKinds: ['completed', 'stub', 'null-status'],
    },
    {
      name: 'cycle below a root blocker',
      nodes: [
        node('R', 'blocked'), node('A', 'planning'), node('B', 'completed'), node('C', null),
        node('D', 'parked'), node('E', 'planning', { isStub: true }),
      ],
      edges: [
        depends('R', 'A'), depends('A', 'B'), depends('B', 'C'), depends('C', 'A'),
        depends('C', 'D'), depends('D', 'E'),
      ],
      features: ['cycle', 'stuckOverStuck', 'completedListsCause', 'stubListsCause', 'nullStatusListsCause'],
      dependentKinds: ['completed', 'stub', 'null-status'],
    },
    {
      name: 'stuck cycle beside a root blocker',
      nodes: [
        node('X', 'blocked'), node('Y', 'parked'), node('Z', 'completed'), node('W', 'parked'),
        node('V', 'planning'),
      ],
      edges: [depends('X', 'Y'), depends('Y', 'X'), depends('Y', 'Z'), depends('W', 'Z'), depends('Z', 'V')],
      features: ['cycle', 'stuckOverStuck', 'completedListsCause'],
      dependentKinds: ['completed'],
    },
    {
      name: 'stuck-over-stuck chain through completed and stub records',
      nodes: [
        node('R', 'blocked'), node('M', 'completed'), node('P', 'parked'),
        node('S', 'blocked', { isStub: true }), node('Q', 'BLOCKED'), node('L', 'planning'),
      ],
      edges: [depends('R', 'M'), depends('M', 'P'), depends('P', 'S'), depends('S', 'Q'), depends('Q', 'L')],
      features: ['stuckOverStuck', 'completedListsCause', 'stubListsCause'],
      dependentKinds: ['completed', 'stub'],
    },
    {
      name: 'two roots at different distances',
      nodes: [
        node('F', 'blocked'), node('N', 'parked'), node('M', 'planning'), node('C', 'completed'),
        node('L', null),
      ],
      edges: [depends('F', 'M'), depends('M', 'L'), depends('N', 'L'), depends('N', 'C'), depends('F', 'C')],
      features: ['completedListsCause', 'nullStatusListsCause'],
      dependentKinds: ['completed', 'null-status'],
    },
  ];
  for (const template of rootTemplates) {
    const positions = Object.fromEntries(DEPENDENT_KINDS.map((kind) => [kind, new Set()]));
    let rootAfterDependent = 0;
    let rootBeforeDependent = 0;
    for (const { label, model, features } of everyOrder(template)) {
      for (const feature of template.features) {
        assert.strictEqual(features[feature], true, `${label}: the reference finds ${feature}`);
      }
      if (features.rootAfterDependent) rootAfterDependent += 1;
      if (features.rootBeforeDependent) rootBeforeDependent += 1;
      model.records.forEach(({ card, kind }, position) => {
        if (positions[kind] && model.analysis.perNode[card].rootCauses.length > 0) positions[kind].add(position);
      });
    }
    assert.ok(rootAfterDependent > 0,
      `${template.name}: in some order a root blocker is listed after a record that lists it`);
    assert.ok(rootBeforeDependent > 0,
      `${template.name}: in some order a root blocker is listed before a record that lists it`);
    assert.deepStrictEqual(DEPENDENT_KINDS.filter((kind) => positions[kind].size > 0), template.dependentKinds,
      `${template.name}: which of the completed, stub, and null-status kinds list root causes`);
    for (const kind of template.dependentKinds) {
      assert.deepStrictEqual([...positions[kind]].sort((left, right) => left - right),
        template.nodes.map((_record, index) => index),
        `${template.name}: a ${kind} record that lists root causes is compared at every input position`);
    }
  }

  const ancestorKinds = [
    ['planning', (card) => node(card, 'planning')],
    ['in_progress', (card) => node(card, 'In_Progress')],
    ['blocked', (card) => node(card, 'blocked')],
    ['parked', (card) => node(card, ' Parked ')],
    ['completed stub', (card) => node(card, 'completed', { isStub: true })],
    ['planning stub', (card) => node(card, 'planning', { isStub: true })],
    ['null-status', (card) => node(card, null)],
    ['completed', (card) => node(card, ' COMPLETED ')],
    ['discarded', (card) => node(card, ' Discarded ')],
    ['reviewing', (card) => node(card, 'REVIEWING')],
    ['unknown', (card) => node(card, 'unknown')],
    ['Blocking', (card) => node(card, 'Blocking')],
    ['generated unknown', (card) => node(card, GENERATED_UNKNOWN_STATUSES[0])],
  ];
  const readinessTemplates = ancestorKinds.flatMap(([kind, make]) => [
    {
      name: `the ${kind} record W and the planning record T with W->T`,
      nodes: [node('T', 'planning'), make('W')],
      edges: [depends('W', 'T')],
    },
    {
      name: `the ${kind} record W above the completed record M above the planning record T`,
      nodes: [make('W'), node('M', 'completed'), node('T', 'planning')],
      edges: [depends('W', 'M'), depends('M', 'T')],
    },
  ]);
  readinessTemplates.push({
    name: 'completed, completed-stub, and parked ancestors above the planning records T1, T2, and T3',
    nodes: [
      node('C', 'completed'), node('K', 'completed', { isStub: true }), node('P', 'parked'),
      node('T1', 'planning'), node('T2', 'planning'), node('T3', 'planning'),
    ],
    edges: [depends('C', 'T1'), depends('C', 'T2'), depends('K', 'T2'), depends('P', 'T3'), depends('T1', 'T3')],
  });
  const withheldByLater = new Set();
  let readyWithLaterAncestor = 0;
  for (const template of readinessTemplates) {
    let ancestorAfterDependent = 0;
    let ancestorBeforeDependent = 0;
    for (const { features } of everyOrder(template)) {
      if (features.ancestorAfterDependent) ancestorAfterDependent += 1;
      if (features.ancestorBeforeDependent) ancestorBeforeDependent += 1;
      if (features.readyWithLaterAncestor) readyWithLaterAncestor += 1;
      for (const kind of features.withheldByLater) withheldByLater.add(kind);
    }
    assert.ok(ancestorAfterDependent > 0,
      `${template.name}: in some order an ancestor is listed after a record it is upstream of`);
    assert.ok(ancestorBeforeDependent > 0,
      `${template.name}: in some order an ancestor is listed before a record it is upstream of`);
  }
  assert.deepStrictEqual([...withheldByLater].sort(), [
    'blocked', 'blocking', 'completed stub', 'discarded', 'in_progress', 'null-status', 'parked', 'planning',
    'reviewing', 'stub', 'unknown', normalizedStatus(GENERATED_UNKNOWN_STATUSES[0]),
  ].sort(), 'in the reference, the kinds of ancestor listed after a compared record that withhold its readiness when no earlier-listed ancestor does');
  assert.ok(readyWithLaterAncestor > 0,
    'in some compared order the reference has a ready record with an ancestor listed after it');

  const dependentFeatures = [];
  for (const [kind, status] of [
    ['discarded', ' Discarded '], ['reviewing', 'Reviewing'], ['unknown', 'unknown'],
    ['generated unknown', GENERATED_UNKNOWN_STATUSES[1]], ['Blocking', 'Blocking'], ['BLOCKED', 'BLOCKED'],
    ['padded parked', '\ufeffPARKED'],
  ]) {
    const template = {
      name: `the ${kind} record X below the completed record C and the ${kind} record Y below the parked root blocker R`,
      nodes: [node('X', status), node('C', 'completed'), node('Y', status), node('R', 'parked')],
      edges: [depends('C', 'X'), depends('R', 'Y')],
    };
    let ancestorAfterDependent = 0;
    let ancestorBeforeDependent = 0;
    for (const { features } of everyOrder(template)) {
      if (features.ancestorAfterDependent) ancestorAfterDependent += 1;
      if (features.ancestorBeforeDependent) ancestorBeforeDependent += 1;
      dependentFeatures.push(features);
    }
    assert.ok(ancestorAfterDependent > 0 && ancestorBeforeDependent > 0,
      `${template.name}: in some order an ancestor is listed after a record it is upstream of, and in some order before`);
  }
  assertWidenedDependents(dependentFeatures, 'the widened-dependent templates');

  const causeCardsOf = (model, card) => model.analysis.perNode[card].rootCauses.map((cause) => cause.card);
  const hostileTemplates = [
    {
      name: 'the blocked record __proto__ and the parked record 10 above the planning record constructor, and the completed record toString above the planning record valueOf',
      nodes: [
        node('__proto__', 'blocked'), node('constructor', 'planning'), node('toString', 'completed'),
        node('valueOf', 'planning'), node('10', 'parked'),
      ],
      edges: [depends('__proto__', 'constructor'), depends('10', 'constructor'), depends('toString', 'valueOf')],
      check: (model, label) => {
        assert.deepStrictEqual([model.analysis.perNode.constructor.isReady, model.analysis.perNode.valueOf.isReady],
          [false, true], `${label}: in the reference constructor is not ready and valueOf is ready`);
        assert.deepStrictEqual(causeCardsOf(model, 'constructor').sort(), ['10', '__proto__'],
          `${label}: in the reference constructor lists the root blockers __proto__ and 10`);
      },
    },
    {
      name: 'the completed record __proto__ above the planning record prototype, and the planning record hasOwnProperty and the parked record 10 above the planning record 0',
      nodes: [
        node('__proto__', 'completed'), node('prototype', 'planning'), node('hasOwnProperty', 'planning'),
        node('0', 'planning'), node('10', 'parked'),
      ],
      edges: [depends('__proto__', 'prototype'), depends('hasOwnProperty', '0'), depends('10', '0')],
      check: (model, label) => {
        assert.strictEqual(model.analysis.perNode.prototype.isReady, true,
          `${label}: in the reference prototype is ready below the completed record __proto__`);
        assert.deepStrictEqual(causeCardsOf(model, '0'), ['10'],
          `${label}: in the reference 0 lists only the root blocker 10`);
      },
    },
    {
      name: 'the blocked record constructor above the planning record __proto__ above the completed record prototype above the planning record 0',
      nodes: [node('constructor', 'blocked'), node('__proto__', 'planning'), node('prototype', 'completed'), node('0', 'planning')],
      edges: [depends('constructor', '__proto__'), depends('__proto__', 'prototype'), depends('prototype', '0')],
      check: (model, label) => assert.deepStrictEqual(
        [model.analysis.perNode.constructor.gates, model.analysis.summary.gatedTotal], [2, 2],
        `${label}: in the reference constructor gates __proto__ and 0, and gatedTotal is 2`),
    },
    {
      name: 'the parked record valueOf above the completed record __proto__ above the planning record toString above the planning record 10',
      nodes: [node('valueOf', 'parked'), node('__proto__', 'completed'), node('toString', 'planning'), node('10', 'planning')],
      edges: [depends('valueOf', '__proto__'), depends('__proto__', 'toString'), depends('toString', '10')],
      check: (model, label) => assert.deepStrictEqual(
        [model.analysis.perNode.valueOf.gates, model.analysis.summary.gatedTotal, causeCardsOf(model, '__proto__')],
        [2, 2, ['valueOf']],
        `${label}: in the reference valueOf gates toString and 10, gatedTotal is 2, and __proto__ lists valueOf`),
    },
  ];
  for (const template of hostileTemplates) {
    for (const { label, model } of everyOrder(template)) template.check(model, label);
  }
});

test('PH0C-SIZES-BEYOND-TESTED: every analysis output equals the reference on long chains, on records with many root causes, and on fixtures with many of each count', () => {
  const next = prng(0x5eed0005);
  const orders = (records) => [
    ['listed as built', records],
    ['listed in reverse', [...records].reverse()],
    ['shuffled', shuffled(records, next)],
  ];
  const chain = (cards) => cards.slice(1).map((card, index) => depends(cards[index], card));

  const chainRecord = [
    (card) => node(card, 'completed'),
    (card) => node(card, 'planning', { isStub: true }),
    (card) => node(card, null),
    (card) => node(card, 'parked'),
    (card) => node(card, 'in_progress'),
    (card) => node(card, ' BLOCKED ', { isStub: true }),
  ];
  const heads = [
    ['planning', (card) => node(card, 'planning')],
    ['completed', (card) => node(card, 'completed')],
    ['completed stub', (card) => node(card, 'completed', { isStub: true })],
  ];
  const depths = [...Array.from({ length: 20 }, (_value, index) => index + 1), 25, 32, 64, 65, 100];
  let maxCauseHops = 0;
  let maxAncestorHops = 0;
  let maxRecords = 0;
  let maxClosure = 0;
  for (const depth of depths) {
    const rootCards = Array.from({ length: depth + 1 }, (_value, index) => `K${depth}-${index}`);
    const rootChain = [node(rootCards[0], 'blocked'),
      ...rootCards.slice(1).map((card, index) => chainRecord[index % chainRecord.length](card))];
    for (const [variant, order] of orders(rootChain)) {
      const label = `root-cause chain of ${depth} hops, ${variant}`;
      const { model, features } = analyzeAgainstReference(order, shuffled(chain(rootCards), next), label);
      assert.strictEqual(features.maxCauseHops, depth, `${label}: the reference's longest root-cause hop count is ${depth}`);
      maxCauseHops = Math.max(maxCauseHops, features.maxCauseHops);
      maxRecords = Math.max(maxRecords, model.records.length);
      maxClosure = Math.max(maxClosure, ...[...model.ancestorHops.values()].map((hops) => hops.size));
    }
    for (const [head, make] of heads) {
      const cards = Array.from({ length: depth + 1 }, (_value, index) => `H${depth}-${head}-${index}`);
      const target = cards[depth];
      const readinessChain = [make(cards[0]),
        ...cards.slice(1, depth).map((card) => node(card, 'completed')), node(target, 'planning')];
      for (const [variant, order] of orders(readinessChain)) {
        const label = `readiness chain of ${depth} hops below a ${head} head, ${variant}`;
        const { model, features } = analyzeAgainstReference(order, shuffled(chain(cards), next), label);
        assert.strictEqual(features.maxAncestorHops, depth, `${label}: the reference's longest ancestor hop count is ${depth}`);
        assert.strictEqual(model.analysis.perNode[target].isReady, head === 'completed',
          `${label}: in the reference the last record is ready exactly when the head is a completed non-stub`);
        maxAncestorHops = Math.max(maxAncestorHops, features.maxAncestorHops);
      }
    }
  }
  assert.ok(maxCauseHops > 64, 'some compared record has a root cause more than 64 hops upstream in the reference');
  assert.ok(maxAncestorHops > 64, 'some compared record has an ancestor more than 64 hops upstream in the reference');
  assert.ok(maxRecords > 72, 'some compared graph has more than 72 records');
  assert.ok(maxClosure > 70, 'some compared record has more than 70 ancestors in the reference');

  const rootStatuses = ['blocked', ' Parked ', 'BLOCKED', 'parked'];
  let maxCauses = 0;
  for (const width of [7, 9, 16, 17, 24]) {
    const target = node(`F${width}-T`, 'planning');
    const records = [];
    const edges = [];
    for (let index = 0; index < width; index += 1) {
      const root = `F${width}-R${index}`;
      records.push(node(root, rootStatuses[index % rootStatuses.length]));
      let previous = root;
      for (let step = 1; step < 1 + (index % 3); step += 1) {
        const middle = `F${width}-R${index}-M${step}`;
        records.push(node(middle, step % 2 ? 'planning' : 'completed'));
        edges.push(depends(previous, middle));
        previous = middle;
      }
      edges.push(depends(previous, target.card));
    }
    for (const [variant, order] of [...orders([...records, target]), ['target first', [target, ...records]]]) {
      const label = `${width} root blockers above one record, ${variant}`;
      const { features } = analyzeAgainstReference(order, shuffled(edges, next), label);
      assert.strictEqual(features.maxCauses, width, `${label}: the reference lists ${width} root causes for ${target.card}`);
      maxCauses = Math.max(maxCauses, features.maxCauses);
    }
  }
  assert.ok(maxCauses > 16, 'some compared record has more than 16 root causes in the reference');

  const reached = {
    stuckCount: 0, rootBlockers: 0, gatedTotal: 0, readyCount: 0, needsYouCount: 0, blockedCount: 0,
  };
  const liveStatuses = ['planning', 'in_progress', ...WIDENED_STATUSES];
  const parkedStatuses = ['parked', ' PARKED ', '\ufeffParked'];
  const blockedStatuses = ['blocked', 'BLOCKED', '\u00a0Blocked'];
  for (const each of [5, 9, 12]) {
    const records = [];
    const edges = [];
    for (let index = 0; index < each; index += 1) {
      const card = (prefix) => `N${each}-${prefix}${index}`;
      const live = (offset) => liveStatuses[(index * 3 + offset) % liveStatuses.length];
      records.push(
        node(card('C'), 'completed'), node(card('R'), live(0)),
        node(card('P'), parkedStatuses[index % parkedStatuses.length]), node(card('G'), live(1)),
        node(card('B'), blockedStatuses[index % blockedStatuses.length]), node(card('H'), live(2)),
        node(card('PS'), 'parked', { isStub: true }), node(card('BS'), 'blocked', { isStub: true }),
      );
      edges.push(depends(card('C'), card('R')), depends(card('P'), card('G')), depends(card('B'), card('H')));
    }
    for (const [variant, order] of orders(records)) {
      const label = `${each} ready, ${each} needs-you, and ${each} blocked records, ${variant}`;
      const { model } = analyzeAgainstReference(order, shuffled(edges, next), label);
      const { summary } = model.analysis;
      assert.deepStrictEqual([summary.readyCount, summary.needsYouCount, summary.blockedCount], [each, each, each],
        `${label}: the reference counts ${each} ready, ${each} needs-you, and ${each} blocked records`);
      for (const key of Object.keys(reached)) {
        const value = model.analysis.summary[key];
        reached[key] = Math.max(reached[key], Array.isArray(value) ? value.length : value);
      }
    }
  }
  for (const [key, value] of Object.entries(reached)) {
    assert.ok(value >= 5, `on some compared fixture the reference's ${key} is at least 5`);
  }
  for (const key of ['readyCount', 'needsYouCount', 'blockedCount']) {
    assert.ok(reached[key] > 9, `on some compared fixture the reference's ${key} is more than 9`);
  }
});

test('PH0C-FULL-REFERENCE: every analysis output equals the reference on seeded random graphs and on the summary-count graphs', () => {
  const next = prng(0x5eed0006);
  const statusPool = [
    'planning', 'in_progress', 'completed', ' Completed ', 'blocked', 'BLOCKED', 'parked', ' Parked ',
    'waiting', null, 'COMPLETED', '\tcompleted\n', 'Completed',
    'discarded', ' Discarded ', 'reviewing', 'REVIEWING', 'unknown', 'Blocking', 'Parking', 'un-blocked',
    '\u00a0Blocked\u00a0', '\ufeffPARKED', '\u3000Completed\u2003',
    GENERATED_UNKNOWN_STATUSES[0], GENERATED_UNKNOWN_STATUSES[3], GENERATED_UNKNOWN_STATUSES[4],
  ];
  const random = [];
  for (let trial = 0; trial < 300; trial += 1) {
    const size = 2 + (next() % 9);
    const nodes = Array.from({ length: size }, (_value, index) => {
      const status = statusPool[next() % statusPool.length];
      const card = trial % 3 === 0 && index < HOSTILE_CARDS.length
        ? HOSTILE_CARDS[(index + trial) % HOSTILE_CARDS.length] : `Q${trial}-${index}`;
      return status !== null && next() % 5 === 0 ? node(card, status, { isStub: true }) : node(card, status);
    });
    const edges = [];
    const attempts = next() % (size * 2 + 1);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const from = next() % size;
      const to = next() % size;
      if (from === to) continue;
      edges.push({ from: nodes[from].card, to: nodes[to].card, kind: next() % 5 === 0 ? 'order' : 'depends' });
    }
    random.push({ label: `random graph ${trial}`, nodes, edges });
  }
  const summaryCorpus = generatedCountCorpus().map((graph) => ({ ...graph, label: `summary-count ${graph.label}` }));
  assert.deepStrictEqual([random.length, summaryCorpus.length], [300, 150],
    'there are 300 random graphs and 150 summary-count graphs');
  const tally = {
    cycle: 0,
    diamond: 0,
    stuckOverStuck: 0,
    ancestorAfterDependent: 0,
    rootAfterDependent: 0,
    readyWithLaterAncestor: 0,
    rootWithOnlyIneligibleDescendants: 0,
    completedListsCause: 0,
    stubListsCause: 0,
    nullStatusListsCause: 0,
  };
  const featureList = [];
  const hostileRoles = new Map(HOSTILE_CARDS.map((card) => [card, new Set()]));
  for (const { label, nodes, edges } of [...random, ...summaryCorpus]) {
    const { features, model } = analyzeAgainstReference(nodes, edges, label);
    featureList.push(features);
    for (const feature of Object.keys(tally)) if (features[feature]) tally[feature] += 1;
    const entries = new Map(Object.entries(model.analysis.perNode));
    for (const record of model.records) {
      const roles = hostileRoles.get(record.card);
      if (!roles) continue;
      const entry = entries.get(record.card);
      const completed = !record.stub && record.status === 'completed';
      if (entry.isRootBlocker) roles.add('root blocker');
      if (entry.upstream.length > 0) roles.add('dependent');
      if (entry.downstream.length > 0 && completed) roles.add('completed ancestor');
      if (entry.downstream.length > 0 && !completed && !entry.isRootBlocker) roles.add('ancestor that is neither completed nor a root blocker');
    }
  }
  for (const [card, roles] of hostileRoles) {
    assert.deepStrictEqual([...roles].sort(), [
      'ancestor that is neither completed nor a root blocker', 'completed ancestor', 'dependent', 'root blocker',
    ], `in the reference, some random graph has a record named ${JSON.stringify(card)} as a root blocker, a completed ancestor, an ancestor that is neither, and a dependent`);
  }
  for (const [feature, count] of Object.entries(tally)) {
    assert.ok(count > 0, `at least one generated graph has ${feature}`);
  }
  assertWidenedDependents(featureList, 'the random and summary-count graphs');

  const cards = ['Caf\u00e9', 'Cafe\u0301', 'caf\u00e9', '\u00c5', 'A\u030a', '\u212b', 'K', '\u212a'];
  assert.strictEqual(new Set(cards.map((card) => card.normalize('NFC').toLowerCase())).size < cards.length, true,
    'fixture guard: some of these cards coincide after Unicode normalization or lower-casing');
  const { result } = analyzeAgainstReference(
    cards.map((card, index) => node(card, ['blocked', 'planning', 'completed', 'parked'][index % 4])),
    cards.slice(1).map((card, index) => depends(cards[index], card)),
    'cards that differ only by Unicode normalization or letter case',
  );
  assert.deepStrictEqual(Object.keys(result.perNode), cards,
    'cards that differ only by Unicode normalization or letter case are distinct perNode keys');

  const { result: padded } = analyzeAgainstReference(
    [node('\tA\n', 'blocked'), node('\u3000B\u00a0', 'planning'), node('C', 'completed'), node('D', 'planning')],
    [depends('A', 'B'), { from: '\ufeffB', to: ' C\t', kind: 'depends' }, { from: 'C', to: '\vD\f', kind: 'depends' }],
    'cards and edge endpoints padded with whitespace other than a plain space',
  );
  assert.deepStrictEqual(Object.keys(padded.perNode), ['A', 'B', 'C', 'D'],
    'cards and edge endpoints padded with whitespace other than a plain space are trimmed');
});

test('PH0C-FULL-REFERENCE: the unedited reference source passes every compared graph, and each listed wrong reference fails on a graph that its named case compared', () => {
  const referenceSource = referenceModel.toString();
  const evaluate = (text) => eval(`(${text})`); // eslint-disable-line no-eval
  const fails = (reference, comparisons) => comparisons.some(({ label, nodes, edges, result }) => {
    try {
      assertMatchesReference(result, nodes, edges, label, reference);
      return false;
    } catch (error) {
      if (error instanceof assert.AssertionError) return true;
      throw error;
    }
  });
  assert.ok(referenceComparisons.length > 0, 'graphs were compared with the reference');
  assert.strictEqual(fails(evaluate(referenceSource), referenceComparisons), false,
    'the unedited reference source, evaluated the same way as the wrong references, passes every compared graph');
  for (const [name, caseName, edits] of WRONG_REFERENCES) {
    const comparisons = referenceComparisons.filter((comparison) => comparison.caseName.startsWith(`${caseName}: `))
      .sort((left, right) => left.nodes.length - right.nodes.length);
    assert.ok(comparisons.length > 0, `${name}: ${caseName} compared graphs with the reference`);
    let wrongSource = referenceSource;
    for (const [from, to] of edits) {
      assert.strictEqual(wrongSource.split(from).length, 2, `${name}: the replaced reference text occurs once`);
      wrongSource = wrongSource.replace(from, () => to);
    }
    assert.strictEqual(fails(evaluate(wrongSource), comparisons), true,
      `a reference that ${name} fails the comparison on some graph that ${caseName} compared`);
  }
});

// Valid records S1 (completed), S2 (planning), and S3 (blocked) and valid edges
// among them. amongSiblings places one extra record first, in the middle, or
// last among S1, S2, and S3, and amongSiblingEdges places one extra edge
// first, in the middle, or last among the sibling edges; neither adds an edge
// to or from the extra record.
function SIBLINGS() { return [node('S1', 'completed'), node('S2', 'planning'), node('S3', 'blocked')]; }
function SIBLING_EDGES() { return [depends('S1', 'S2'), { from: 'S3', to: 'S2', kind: 'order' }]; }
function amongSiblings(record) {
  const [first, second, third] = SIBLINGS();
  return [
    ['first', [record, first, second, third]],
    ['in the middle', [first, record, second, third]],
    ['last', [first, second, third, record]],
  ];
}
function amongSiblingEdges(edge) {
  const [first, second] = SIBLING_EDGES();
  return [
    ['first', [edge, first, second]],
    ['in the middle', [first, edge, second]],
    ['last', [first, second, edge]],
  ];
}

test('PH0-ADDITIVE-EMPTY: each listed invalid input and exceptional exit returns exactly the additive empty shape', () => {
  const planning = (card = 'A') => node(card, 'planning');
  const pair = () => [planning('A'), planning('B')];
  const invalid = [
    ['nodes undefined', undefined, []],
    ['nodes null', null, []],
    ['nodes plain object', {}, []],
    ['nodes array-like', { length: 0 }, []],
    ['nodes string', 'A', []],
    ['edges undefined', [planning()], undefined],
    ['edges null', [planning()], null],
    ['edges plain object', [planning()], {}],
    ['edges string', [planning()], 'A->A'],
    ['record null', [null], []],
    ['record undefined', [undefined], []],
    ['record string', ['A'], []],
    ['record number', [42], []],
    ['record array', [['A', 'planning']], []],
    ['record without status', [{ card: 'A' }], []],
    ['record with only an inherited status', [Object.assign(Object.create({ status: 'planning' }), { card: 'A' })], []],
    ['record without card', [{ status: 'planning' }], []],
    ['record with blank card', [node('   ', 'planning')], []],
    ['record with numeric card', [node(42, 'planning')], []],
    ['record with numeric status', [node('A', 42)], []],
    ['record with object status', [node('A', {})], []],
    ['record with empty status', [node('A', '')], []],
    ['record with whitespace status', [node('A', ' \t ')], []],
    ['record with string isStub', [node('A', 'planning', { isStub: 'yes' })], []],
    ['record with null isStub', [node('A', 'planning', { isStub: null })], []],
    ['record with numeric isStub', [node('A', 'planning', { isStub: 1 })], []],
    ['duplicate cards', [planning('A'), node('A', 'blocked')], []],
    ['duplicate cards after trimming', [planning('A'), planning(' A ')], []],
    ['edge null', [planning()], [null]],
    ['edge array', [planning()], [['A', 'A']]],
    ['edge string', [planning()], ['A']],
    ['edge without kind', pair(), [{ from: 'A', to: 'B' }]],
    ['edge with unknown kind', pair(), [{ from: 'A', to: 'B', kind: 'blocks' }]],
    ['edge with capitalized kind', pair(), [{ from: 'A', to: 'B', kind: 'Depends' }]],
    ['edge with a padded depends kind', pair(), [{ from: 'A', to: 'B', kind: ' depends ' }]],
    ['edge with a padded order kind', pair(), [{ from: 'A', to: 'B', kind: 'order\n' }]],
    ['edge with blank from', [planning()], [{ from: ' ', to: 'A', kind: 'depends' }]],
    ['self edge', [planning()], [depends('A', 'A')]],
    ['depends edge to an unknown card', [planning()], [depends('A', 'B')]],
    ['depends edge from an unknown card', [planning()], [depends('B', 'A')]],
    ['order edge to an unknown card', [planning()], [{ from: 'A', to: 'B', kind: 'order' }]],
    ['nodes Set of valid records', new Set([planning()]), []],
    ['edges Set of valid edges', pair(), new Set([depends('A', 'B')])],
    ['record array with own card and status properties', [Object.assign([], { card: 'A', status: 'planning' })], []],
    ['edge array with own from, to, and kind properties', pair(), [Object.assign([], { from: 'A', to: 'B', kind: 'depends' })]],
    ['record with a String object status', [node('A', new String('planning'))], []],
  ];

  const hostileRecord = (field) => {
    const record = { card: 'A', status: 'planning' };
    Object.defineProperty(record, field, { enumerable: true, get() { throw new Error(`hostile ${field}`); } });
    return record;
  };
  const hostileEdge = (field) => {
    const edge = { from: 'A', to: 'B', kind: 'depends' };
    Object.defineProperty(edge, field, { enumerable: true, get() { throw new Error(`hostile ${field}`); } });
    return edge;
  };
  const throwingIterable = (items) => Object.assign([...items], {
    * [Symbol.iterator]() {
      yield* items;
      throw new Error('hostile iteration');
    },
  });
  const revoked = () => {
    const { proxy, revoke } = Proxy.revocable([], {});
    revoke();
    return proxy;
  };
  assert.throws(() => Array.isArray(revoked()), TypeError, 'fixture guard: Array.isArray throws on a revoked proxy');
  const exceptional = [
    ['throwing card getter', [hostileRecord('card')], []],
    ['throwing status getter', [hostileRecord('status')], []],
    ['throwing isStub getter', [hostileRecord('isStub')], []],
    ['throwing edge from getter', pair(), [hostileEdge('from')]],
    ['throwing edge to getter', pair(), [hostileEdge('to')]],
    ['throwing edge kind getter', pair(), [hostileEdge('kind')]],
    ['record proxy that throws on own-property lookup', [new Proxy({ card: 'A', status: 'planning' }, {
      getOwnPropertyDescriptor() { throw new Error('hostile descriptor'); },
    })], []],
    ['nodes whose iteration throws midway', throwingIterable([planning('A')]), []],
    ['edges whose iteration throws midway', pair(), throwingIterable([depends('A', 'B')])],
    ['nodes revoked proxy', revoked(), []],
    ['edges revoked proxy', [planning()], revoked()],
  ];

  for (const [label, nodes, edges] of [...invalid, ...exceptional]) {
    let result;
    assert.doesNotThrow(() => { result = insights.analyzeEmpty(nodes, edges, label); }, `${label}: fails soft`);
    result.summary.rootBlockers.push('LEAK');
    result.perNode.LEAK = {};
    insights.analyzeEmpty(nodes, edges, `${label}: writes to an earlier empty result do not reach the next one`);
  }
});

test('PH0-ADDITIVE-EMPTY: each listed malformed record, invalid status or isStub, throwing getter or proxy, and malformed edge, placed first, in the middle, or last among valid siblings with no edge to or from it, returns exactly the additive empty shape', () => {
  const control = insights.analyzeGraph(SIBLINGS(), SIBLING_EDGES());
  assert.deepStrictEqual(Object.keys(control.perNode), ['S1', 'S2', 'S3'],
    'control: the siblings and sibling edges alone are a valid, non-empty graph');
  assert.strictEqual(control.summary.readyCount, 1, 'control: S2 is ready behind the completed S1');
  const throwingOn = (base, field) => {
    const target = { ...base };
    Object.defineProperty(target, field, { enumerable: true, get() { throw new Error(`hostile ${field}`); } });
    return target;
  };
  const throwingProxy = (base, trap) => new Proxy({ ...base }, {
    [trap]() { throw new Error(`hostile ${trap}`); },
  });
  const invalidStatuses = [
    ['a numeric', 42], ['a zero', 0], ['a boolean', true], ['an object', {}], ['an array', ['planning']],
    ['a String object', new String('planning')], ['an undefined', undefined], ['an empty', ''], ['a space-only', ' '],
    ['a newline, space, and tab', '\n \t'], ['a no-break-space-only', '\u00a0'],
    ['an ideographic-space and em-space', '\u3000\u2003'],
  ];
  const invalidIsStubs = [['a string', 'yes'], ['a null', null], ['a numeric', 1], ['a zero', 0], ['a string true', 'true'], ['an object', {}]];
  const records = [
    ['a null record', null],
    ['an undefined record', undefined],
    ['a string record', 'A'],
    ['a number record', 42],
    ['a boolean record', true],
    ['an array record', ['A', 'planning']],
    ['an array record with own card and status properties', Object.assign([], { card: 'A', status: 'planning' })],
    ['a record without status', { card: 'A' }],
    ['a record with only an inherited status', Object.assign(Object.create({ status: 'planning' }), { card: 'A' })],
    ['a record without card', { status: 'planning' }],
    ['a record with an empty card', node('', 'planning')],
    ['a record with a blank card', node(' \t ', 'planning')],
    ['a record with a numeric card', node(42, 'planning')],
    ['a record with a String object card', node(new String('A'), 'planning')],
    ['a record whose card repeats a sibling card', node('S2', 'planning')],
    ['a record whose card repeats a sibling card after trimming', node(' S1\t', 'completed')],
    ...invalidStatuses.map(([label, status]) => [`a record with ${label} status`, node('A', status)]),
    ...invalidIsStubs.map(([label, isStub]) => [`a record with ${label} isStub`, node('A', 'planning', { isStub })]),
    ['an explicit stub with a space-only status', node('A', ' ', { isStub: true })],
    ['an explicit stub with a numeric status', node('A', 42, { isStub: true })],
    ['a record whose card getter throws', throwingOn(node('A', 'planning'), 'card')],
    ['a record whose status getter throws', throwingOn(node('A', 'planning'), 'status')],
    ['a record whose isStub getter throws', throwingOn(node('A', 'planning'), 'isStub')],
    ['a record proxy that throws on own-property lookup', throwingProxy(node('A', 'planning'), 'getOwnPropertyDescriptor')],
    ['a record proxy that throws on property read', throwingProxy(node('A', 'planning'), 'get')],
  ];
  const edges = [
    ['a null edge', null],
    ['an undefined edge', undefined],
    ['a string edge', 'S1->S3'],
    ['a number edge', 7],
    ['an array edge', ['S1', 'S3']],
    ['an array edge with own from, to, and kind properties', Object.assign([], { from: 'S1', to: 'S3', kind: 'depends' })],
    ['an edge without kind', { from: 'S1', to: 'S3' }],
    ['an edge with a numeric kind', { from: 'S1', to: 'S3', kind: 42 }],
    ['an edge with an unknown kind', { from: 'S1', to: 'S3', kind: 'blocks' }],
    ['an edge with a capitalized kind', { from: 'S1', to: 'S3', kind: 'Depends' }],
    ['an edge with a padded depends kind', { from: 'S1', to: 'S3', kind: ' depends ' }],
    ['an edge with a padded order kind', { from: 'S1', to: 'S3', kind: 'order\n' }],
    ['an edge with a String object kind', { from: 'S1', to: 'S3', kind: new String('depends') }],
    ['an edge without from', { to: 'S3', kind: 'depends' }],
    ['an edge with a blank from', { from: ' ', to: 'S3', kind: 'depends' }],
    ['an edge with a blank to', { from: 'S1', to: '\t', kind: 'depends' }],
    ['an edge with a numeric from', { from: 1, to: 'S3', kind: 'depends' }],
    ['a depends self edge', depends('S1', 'S1')],
    ['a depends self edge after trimming', { from: ' S3', to: 'S3 ', kind: 'depends' }],
    ['an order self edge', { from: 'S2', to: 'S2', kind: 'order' }],
    ['a depends edge to an unknown card', depends('S1', 'X')],
    ['a depends edge from an unknown card', depends('X', 'S1')],
    ['an order edge to an unknown card', { from: 'S1', to: 'X', kind: 'order' }],
    ['an edge whose from getter throws', throwingOn(depends('S1', 'S3'), 'from')],
    ['an edge whose to getter throws', throwingOn(depends('S1', 'S3'), 'to')],
    ['an edge whose kind getter throws', throwingOn(depends('S1', 'S3'), 'kind')],
    ['an edge proxy that throws on property read', throwingProxy(depends('S1', 'S3'), 'get')],
  ];
  for (const [label, record] of records) {
    for (const [position, nodes] of amongSiblings(record)) {
      insights.analyzeEmpty(nodes, SIBLING_EDGES(), `${label} ${position} among valid sibling records`);
    }
  }
  for (const [label, edge] of edges) {
    for (const [position, list] of amongSiblingEdges(edge)) {
      insights.analyzeEmpty(SIBLINGS(), list, `${label} ${position} among valid sibling edges`);
    }
  }
});

test('PH0B-FAULT-EVERY-OPERATION: a fault at each traced Map or Set operation returns exactly the additive empty shape', () => {
  // In the fault realm every Map and Set the helper constructs is a faulting
  // subclass. One operation is a constructor call, a call to any own method or
  // accessor of Map.prototype or Set.prototype, or a next() on an iterator one
  // of those methods returned. A clean run records the operation trace, then
  // one run per traced operation throws at exactly that operation.
  const fault = { armed: false, at: 0, calls: 0, fired: null, trace: [] };
  const tick = (kind) => {
    if (!fault.armed) return;
    fault.calls += 1;
    fault.trace.push(kind);
    if (fault.calls === fault.at) {
      fault.fired = kind;
      throw new Error(`injected fault at operation ${fault.at}: ${kind}`);
    }
  };
  const ITERATOR_TAGS = new Set(['[object Map Iterator]', '[object Set Iterator]']);
  const faulting = (Base) => {
    const name = Base.name;
    const Faulting = class extends Base {
      constructor(...args) {
        tick(`new ${name}`);
        super(...args);
      }
    };
    for (const key of Reflect.ownKeys(Base.prototype)) {
      if (key === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(Base.prototype, key);
      const kind = `${name}.prototype${typeof key === 'symbol' ? `[${key.description}]` : `.${key}`}`;
      if (typeof descriptor.get === 'function') {
        Object.defineProperty(Faulting.prototype, key, {
          configurable: true,
          get() { tick(kind); return descriptor.get.call(this); },
        });
      } else if (typeof descriptor.value === 'function') {
        Object.defineProperty(Faulting.prototype, key, {
          configurable: true,
          writable: true,
          value(...args) {
            tick(kind);
            const value = descriptor.value.apply(this, args);
            if (!ITERATOR_TAGS.has(Object.prototype.toString.call(value))) return value;
            return {
              next() { tick(`${kind}().next`); return value.next(); },
              [Symbol.iterator]() { return this; },
            };
          },
        });
      }
    }
    assert.deepStrictEqual(
      Reflect.ownKeys(Base.prototype).filter((key) => !Object.prototype.hasOwnProperty.call(Faulting.prototype, key)),
      [Symbol.toStringTag],
      `every own member of ${name}.prototype except its toStringTag string has a faulting override`,
    );
    return Faulting;
  };
  const faultContext = vm.createContext({ Object, Array, Map: faulting(Map), Set: faulting(Set) });
  const FaultedGraphInsights = loadHelper('fault', (code) => vm.runInContext(code, faultContext));
  const faulted = new FaultedGraphInsights();
  const nodes = [
    node('R', 'blocked'), node('P', 'parked'), node('A', 'planning'), node('C', 'completed'),
    node('S', 'planning', { isStub: true }), node('T', 'planning'),
  ];
  const edges = [
    depends('R', 'A'), depends('C', 'T'), depends('A', 'T'), depends('S', 'T'),
    { from: 'P', to: 'T', kind: 'order' }, depends('R', 'A'),
  ];
  fault.armed = true;
  try {
    const baseline = settle(faulted.analyzeGraph(nodes, edges), REPLAYED, 'fault realm, no fault injected');
    const trace = fault.trace;
    assert.deepStrictEqual(plain(baseline), plain(insights.analyzeGraph(nodes, edges)),
      'with no fault injected, the fault realm computes the same analysis as the main realm');
    assert.notDeepStrictEqual(plain(baseline).perNode, {}, 'the fault fixture is a valid, non-empty graph');
    assert.deepStrictEqual([...new Set(trace)].sort(), [
      'Map.prototype.delete', 'Map.prototype.get', 'Map.prototype.has',
      'Map.prototype.keys', 'Map.prototype.keys().next', 'Map.prototype.set', 'Map.prototype.size',
      'Map.prototype.values', 'Map.prototype.values().next',
      'Map.prototype[Symbol.iterator]', 'Map.prototype[Symbol.iterator]().next',
      'Set.prototype.add', 'Set.prototype.delete', 'Set.prototype.has', 'Set.prototype.size',
      'new Map', 'new Set',
    ], 'the clean run performs exactly these Map and Set operation kinds');
    const faultedKinds = {};
    for (let at = 1; at <= trace.length; at += 1) {
      Object.assign(fault, { at, calls: 0, fired: null, trace: [] });
      const label = `fault at operation ${at} of ${trace.length} (${trace[at - 1]})`;
      let result;
      assert.doesNotThrow(() => { result = faulted.analyzeGraph(nodes, edges); }, `${label}: fails soft`);
      assert.strictEqual(fault.fired, trace[at - 1], `${label}: the fault fired at the traced operation`);
      assert.strictEqual(fault.calls, at, `${label}: no Map or Set operation runs after the fault`);
      settle(result, EMPTY_CHECKED, label);
      faultedKinds[fault.fired] = (faultedKinds[fault.fired] || 0) + 1;
    }
    const tracedKinds = {};
    for (const kind of trace) tracedKinds[kind] = (tracedKinds[kind] || 0) + 1;
    assert.deepStrictEqual(faultedKinds, tracedKinds, 'each traced operation of each kind was faulted');
  } finally {
    fault.armed = false;
  }
});

test('PH0-LEGACY-SHAPE-EXACT: records and edges are read through each array\'s own iterator, so a length-0 array whose iterator yields records or an edge is analyzed with them', () => {
  const iterating = (items) => Object.assign([], { * [Symbol.iterator]() { yield* items; } });
  const nodes = iterating([node('A', 'blocked'), node('B', 'planning')]);
  assert.strictEqual(nodes.length, 0, 'fixture guard: the nodes array has length 0');
  const byRecords = insights.analyzeGraph(nodes, []);
  assert.deepStrictEqual(Object.keys(byRecords.perNode), ['A', 'B'],
    'a length-0 nodes array whose iterator yields A and B is analyzed as A and B');
  const byEdges = insights.analyzeGraph([node('A', 'blocked'), node('B', 'planning')], iterating([depends('A', 'B')]));
  assert.deepStrictEqual(byEdges.perNode.B.upstream, ['A'],
    'a length-0 edges array whose iterator yields A->B is analyzed with that edge');
});

test('PH0-LEGACY-SHAPE-EXACT: a record whose own status is non-enumerable or an accessor is analyzed with that status', () => {
  const hidden = Object.defineProperty({ card: 'H' }, 'status', { value: 'completed', enumerable: false });
  const computed = Object.defineProperty({ card: 'G' }, 'status', { get: () => 'blocked', enumerable: true });
  assert.deepStrictEqual(Object.keys(hidden), ['card'], 'fixture guard: H has no enumerable status');
  const result = insights.analyzeGraph([hidden, computed, node('T', 'planning'), node('U', 'planning')],
    [depends('H', 'T'), depends('G', 'U')]);
  assert.deepStrictEqual(Object.keys(result.perNode), ['H', 'G', 'T', 'U'], 'H and G are analyzed as records');
  assert.strictEqual(result.perNode.T.isReady, true, 'T is ready below H, whose non-enumerable own status is completed');
  assert.deepStrictEqual(result.perNode.U.rootCauses, [{ card: 'G', hops: 1 }],
    'U lists G, whose own status getter returns blocked, as a root cause at 1 hop');
});

test('PH0-STUB-CONSERVATIVE: stubs never count, never satisfy readiness, never become root causes, and order edges add no closure', () => {
  const around = (stub) => [
    stub, node('C', 'completed'), node('T', 'planning'), node('M', 'completed'), node('U', 'planning'),
  ];
  const aroundEdges = [depends('S', 'T'), depends('C', 'T'), depends('S', 'M'), depends('M', 'U')];
  const control = insights.analyzeGraph(around(node('S', 'completed')), aroundEdges);
  assert.strictEqual(control.perNode.T.isReady, true,
    'control: a completed non-stub direct ancestor satisfies readiness');
  assert.strictEqual(control.perNode.U.isReady, true,
    'control: a completed non-stub transitive ancestor satisfies readiness');

  const completedStubs = [
    ['explicit completed stub', node('S', 'completed', { isStub: true })],
    ['explicit mixed-case completed stub', node('S', ' Completed ', { isStub: true })],
  ];
  const liveStubs = [
    ['explicit planning stub', node('S', 'planning', { isStub: true })],
    ['explicit in-progress stub', node('S', 'in_progress', { isStub: true })],
    ['null-status stub', node('S', null)],
    ['null-status stub marked isStub false', node('S', null, { isStub: false })],
  ];
  const blockedStubs = [
    ['explicit blocked stub', node('S', 'blocked', { isStub: true })],
    ['explicit mixed-case blocked stub', node('S', ' BLOCKED ', { isStub: true })],
  ];
  const parkedStubs = [
    ['explicit parked stub', node('S', 'parked', { isStub: true })],
    ['explicit mixed-case parked stub', node('S', 'Parked', { isStub: true })],
  ];

  for (const [label, stub] of completedStubs) {
    const result = insights.analyzeGraph(around(stub), aroundEdges);
    assert.strictEqual(result.perNode.T.isReady, false, `${label} never satisfies a direct ancestor readiness check`);
    assert.strictEqual(result.perNode.U.isReady, false,
      `${label} never satisfies a transitive ancestor readiness check`);
  }
  for (const [label, stub] of liveStubs) {
    const result = insights.analyzeGraph(around(stub), aroundEdges);
    assert.strictEqual(result.perNode.S.isReady, false, `${label} is never ready`);
  }
  for (const [label, stub] of [...blockedStubs, ...parkedStubs]) {
    const result = insights.analyzeGraph(around(stub), aroundEdges);
    assert.strictEqual(result.perNode.S.isRootBlocker, false, `${label} is never a root blocker`);
    assert.deepStrictEqual(result.perNode.T.rootCauses, [], `${label} never appears as a root cause`);
    assert.deepStrictEqual(result.perNode.U.rootCauses, [], `${label} never appears as a transitive root cause`);
    assert.strictEqual(result.summary.stuckCount, 0, `${label} is never counted as stuck`);
  }
  for (const [label, stub] of blockedStubs) {
    const result = insights.analyzeGraph(around(stub), aroundEdges);
    assert.strictEqual(result.summary.blockedCount, 0, `${label} is never counted as blocked`);
  }
  for (const [label, stub] of parkedStubs) {
    const result = insights.analyzeGraph(around(stub), aroundEdges);
    assert.strictEqual(result.summary.needsYouCount, 0, `${label} is never counted as needs-you`);
  }
  for (const [label, stub] of [...completedStubs, ...liveStubs, ...blockedStubs, ...parkedStubs]) {
    const result = insights.analyzeGraph(around(stub), aroundEdges);
    assert.deepStrictEqual(result.summary, {
      stuckCount: 0, rootBlockers: [], gatedTotal: 0, readyCount: 0, needsYouCount: 0, blockedCount: 0,
    }, `${label}: exact summary`);
  }

  const through = insights.analyzeGraph([
    node('R', 'blocked'), node('S', 'blocked', { isStub: true }), node('T', 'planning'),
  ], [depends('R', 'S'), depends('S', 'T')]);
  assert.deepStrictEqual(through.perNode.T.rootCauses, [{ card: 'R', hops: 2 }],
    'a stub carries reachability: T reaches the root blocker R through the stub S at two hops');
  assert.deepStrictEqual(through.perNode.S.rootCauses, [{ card: 'R', hops: 1 }]);
  assert.strictEqual(through.summary.blockedCount, 1, 'the blocked stub is not counted as blocked');
  assert.strictEqual(through.summary.needsYouCount, 0);

  const ordered = insights.analyzeGraph([
    node('I', 'planning'), node('B', 'blocked'), node('P', 'parked'),
    node('S', 'completed', { isStub: true }), node('C', 'completed'), node('T', 'planning'),
  ], [
    { from: 'I', to: 'T', kind: 'order' }, { from: 'B', to: 'T', kind: 'order' },
    { from: 'P', to: 'T', kind: 'order' }, { from: 'S', to: 'T', kind: 'order' },
    depends('C', 'T'), { from: 'T', to: 'I', kind: 'order' },
  ]);
  assert.deepStrictEqual(ordered.perNode.T.upstream, ['C'], 'order edges never contribute upstream closure');
  assert.deepStrictEqual(ordered.perNode.T.downstream, [], 'order edges never contribute downstream closure');
  assert.deepStrictEqual(ordered.perNode.I.upstream, [], 'I gains no upstream from the order edge T to I');
  for (const card of ['I', 'B', 'P', 'S']) {
    assert.deepStrictEqual(ordered.perNode[card].downstream, [], `${card} gains no downstream from its order edge to T`);
  }
  assert.strictEqual(ordered.perNode.T.isReady, true,
    'order edges from incomplete, stuck, or stub cards never withhold readiness');
  assert.strictEqual(ordered.perNode.I.isReady, true, 'an order edge into I never withholds its readiness');
  assert.deepStrictEqual(ordered.perNode.T.rootCauses, [], 'order edges never attribute root causes');
  assert.deepStrictEqual(ordered.summary, {
    stuckCount: 2, rootBlockers: ['B', 'P'], gatedTotal: 0, readyCount: 2, needsYouCount: 1, blockedCount: 1,
  });
});

test('PH0-PURITY-CARRIED: inputs are never mutated and repeated analyses are deterministic and unshared', () => {
  const build = () => ({
    nodes: [
      node(' R ', ' BLOCKED '), node('P', 'Parked'), node('C', 'COMPLETED'), node('T', ' planning '),
      node('S', 'completed', { isStub: true }), node('N', null), node('U', 'in_progress'),
    ],
    edges: [
      { from: ' R ', to: 'T', kind: 'depends' }, depends('C', 'T'), depends('C', 'U'),
      { from: 'P', to: 'U', kind: 'order' }, depends('S', 'N'), depends('C', 'T'),
    ],
  });
  const input = build();
  const first = insights.analyzeGraph(input.nodes, input.edges);
  assert.deepStrictEqual(input, build(), 'analysis leaves every input array, record, and edge untouched');
  assert.deepStrictEqual(first.summary, {
    stuckCount: 2, rootBlockers: ['R', 'P'], gatedTotal: 1, readyCount: 1, needsYouCount: 1, blockedCount: 1,
  }, 'the fixture is a live, non-empty analysis');

  const frozen = deepFreeze(build());
  assert.deepStrictEqual(insights.analyzeGraph(frozen.nodes, frozen.edges), first,
    'deeply frozen inputs produce the identical analysis, so nothing writes to them');

  const again = insights.analyzeGraph(input.nodes, input.edges);
  assert.deepStrictEqual(again, first, 'repeated analysis is deterministic');
  assert.notStrictEqual(again.perNode, first.perNode, 'each analysis returns a fresh perNode');
  assert.notStrictEqual(again.summary.rootBlockers, first.summary.rootBlockers,
    'each analysis returns a fresh rootBlockers array');
  for (const card of Object.keys(first.perNode)) {
    assert.notStrictEqual(again.perNode[card], first.perNode[card], `${card}: fresh per-node entry`);
    assert.notStrictEqual(again.perNode[card].rootCauses, first.perNode[card].rootCauses, `${card}: fresh rootCauses`);
  }
});

test('PH0B-LABEL-TESTS-ITS-RULE: each listed rule assertion holds on the helper and fails at its own message under a mutant of that rule', () => {
  const order = (from, to) => ({ from, to, kind: 'order' });
  const causeCards = (result, card) => result.perNode[card].rootCauses.map((cause) => cause.card);
  const rules = [
    {
      message: 'a completed record with no upstream is not ready',
      nodes: [node('K', 'completed')],
      edges: [],
      check: (result, message) => assert.strictEqual(result.perNode.K.isReady, false, message),
      mutant: ['const isReady = eligible(record)', 'const isReady = (record && !record.isStub)'],
    },
    {
      message: 'a planning stub with no upstream is not ready',
      nodes: [node('Q', 'planning', { isStub: true })],
      edges: [],
      check: (result, message) => assert.strictEqual(result.perNode.Q.isReady, false, message),
      mutant: ['const isReady = eligible(record)', 'const isReady = (record && record.status !== "completed")'],
    },
    {
      message: 'a blocked record behind completed work is not ready',
      nodes: [node('C', 'completed'), node('B', 'blocked')],
      edges: [depends('C', 'B')],
      check: (result, message) => assert.strictEqual(result.perNode.B.isReady, false, message),
      mutant: ['&& !stuck(record)', '&& record.status !== "parked"'],
    },
    {
      message: 'a parked record behind completed work is not ready',
      nodes: [node('C', 'completed'), node('P', 'parked')],
      edges: [depends('C', 'P')],
      check: (result, message) => assert.strictEqual(result.perNode.P.isReady, false, message),
      mutant: ['&& !stuck(record)', '&& record.status !== "blocked"'],
    },
    {
      message: 'a planning ancestor withholds readiness',
      nodes: [node('W', 'planning'), node('T', 'planning')],
      edges: [depends('W', 'T')],
      check: (result, message) => assert.strictEqual(result.perNode.T.isReady, false, message),
      mutant: ['ancestor.status === "completed"', 'ancestor.status !== "blocked" && ancestor.status !== "parked"'],
    },
    {
      message: 'a completed stub ancestor withholds readiness',
      nodes: [node('S', 'completed', { isStub: true }), node('T', 'planning')],
      edges: [depends('S', 'T')],
      check: (result, message) => assert.strictEqual(result.perNode.T.isReady, false, message),
      mutant: ['!ancestor.isStub && ', ''],
    },
    {
      message: 'an incomplete ancestor two hops up withholds readiness',
      nodes: [node('W', 'planning'), node('M', 'completed'), node('T', 'planning')],
      edges: [depends('W', 'M'), depends('M', 'T')],
      check: (result, message) => assert.strictEqual(result.perNode.T.isReady, false, message),
      mutant: ['above.every((card) => {', '(upstream.get(record.card) || []).every((card) => {'],
    },
    {
      message: 'a planning ancestor listed after its dependent withholds readiness',
      nodes: [node('T', 'planning'), node('W', 'planning')],
      edges: [depends('W', 'T')],
      check: (result, message) => assert.strictEqual(result.perNode.T.isReady, false, message),
      mutant: [
        [
          'const upstreamWithDepth = new Map();',
          'const upstreamWithDepth = new Map();\n      const incompleteSeen = new Set();',
        ],
        [
          '&& above.every((card) => {\n            const ancestor = records.get(card);\n'
            + '            return ancestor && !ancestor.isStub && ancestor.status === "completed";\n          });',
          '&& !above.some((card) => incompleteSeen.has(card));\n'
            + '        if (record.isStub || record.status !== "completed") incompleteSeen.add(record.card);',
        ],
      ],
    },
    {
      message: 'a completed stub ancestor listed after its dependent withholds readiness',
      nodes: [node('T', 'planning'), node('S', 'completed', { isStub: true })],
      edges: [depends('S', 'T')],
      check: (result, message) => assert.strictEqual(result.perNode.T.isReady, false, message),
      mutant: [
        'return ancestor && !ancestor.isStub && ancestor.status === "completed";',
        'return ancestor && (order.get(card) > order.get(record.card) || !ancestor.isStub) && ancestor.status === "completed";',
      ],
    },
    {
      message: 'readyCount counts only ready records',
      nodes: [node('B', 'blocked'), node('W', 'planning')],
      edges: [depends('B', 'W')],
      check: (result, message) => assert.strictEqual(result.summary.readyCount, 0, message),
      mutant: [
        'readyCount: [...records.values()].filter((record) => perNode[record.card].isReady).length',
        'readyCount: [...records.values()].filter((record) => eligible(record)).length',
      ],
    },
    {
      message: 'a blocked stub is not stuck',
      nodes: [node('BS', 'blocked', { isStub: true })],
      edges: [],
      check: (result, message) => assert.strictEqual(result.summary.stuckCount, 0, message),
      mutant: ['const stuck = (record) => eligible(record)', 'const stuck = (record) => (record && record.status !== "completed")'],
    },
    {
      message: 'a blocked stub is not counted as blocked',
      nodes: [node('BS', 'blocked', { isStub: true })],
      edges: [],
      check: (result, message) => assert.strictEqual(result.summary.blockedCount, 0, message),
      mutant: ['!record.isStub && record.status === "blocked"', 'record.status === "blocked"'],
    },
    {
      message: 'a parked stub is not counted as needs-you',
      nodes: [node('PS', 'parked', { isStub: true })],
      edges: [],
      check: (result, message) => assert.strictEqual(result.summary.needsYouCount, 0, message),
      mutant: ['!record.isStub && record.status === "parked"', 'record.status === "parked"'],
    },
    {
      message: 'a stuck record below another stuck record is not a root blocker',
      nodes: [node('X', 'blocked'), node('Y', 'parked')],
      edges: [depends('X', 'Y')],
      check: (result, message) => assert.strictEqual(result.perNode.Y.isRootBlocker, false, message),
      mutant: [
        'const isRootBlocker = stuck(record) && !above.some((card) => stuck(records.get(card)));',
        'const isRootBlocker = stuck(record);',
      ],
    },
    {
      message: 'a non-stuck ancestor is not a root cause',
      nodes: [node('R', 'blocked'), node('W', 'planning'), node('L', 'planning')],
      edges: [depends('R', 'W'), depends('W', 'L')],
      check: (result, message) => assert.deepStrictEqual(causeCards(result, 'L'), ['R'], message),
      mutant: ['.filter(({ card }) => perNode[card].isRootBlocker)', '.filter(() => true)'],
    },
    {
      message: 'a stuck ancestor below a root blocker is not a root cause',
      nodes: [node('X', 'blocked'), node('Y', 'parked'), node('L', 'planning')],
      edges: [depends('X', 'Y'), depends('Y', 'L')],
      check: (result, message) => assert.deepStrictEqual(causeCards(result, 'L'), ['X'], message),
      mutant: ['.filter(({ card }) => perNode[card].isRootBlocker)', '.filter(({ card }) => stuck(records.get(card)))'],
    },
    {
      message: 'a root cause is reported at its shortest hop count',
      nodes: [node('R', 'blocked'), node('A', 'planning'), node('B', 'planning'), node('L', 'planning')],
      edges: [depends('R', 'L'), depends('R', 'A'), depends('A', 'B'), depends('B', 'L')],
      check: (result, message) => assert.deepStrictEqual(result.perNode.L.rootCauses, [{ card: 'R', hops: 1 }], message),
      mutant: ['queue.shift()', 'queue.pop()'],
    },
    {
      message: 'root causes follow input record order, not hop distance',
      nodes: [node('F', 'blocked'), node('N', 'parked'), node('M', 'planning'), node('L', 'planning')],
      edges: [depends('F', 'M'), depends('M', 'L'), depends('N', 'L')],
      check: (result, message) => assert.deepStrictEqual(causeCards(result, 'L'), ['F', 'N'], message),
      mutant: [
        '.filter(({ card }) => perNode[card].isRootBlocker)\n          .map',
        '.filter(({ card }) => perNode[card].isRootBlocker)\n          .sort((left, right) => left.hops - right.hops)\n          .map',
      ],
    },
    {
      message: 'an order edge adds no dependency closure',
      nodes: [node('A', 'blocked'), node('T', 'planning')],
      edges: [order('A', 'T')],
      check: (result, message) => assert.deepStrictEqual(result.perNode.T.upstream, [], message),
      mutant: ['if (edge.kind === "order") continue;', 'if (false) continue;'],
    },
    {
      message: 'a completed dependent is not gated',
      nodes: [node('R', 'blocked'), node('D', 'completed')],
      edges: [depends('R', 'D')],
      check: (result, message) => assert.strictEqual(result.perNode.R.gates, 0, message),
      mutant: [
        'gates: below.filter((card) => eligible(records.get(card))).length',
        'gates: below.filter((card) => !records.get(card).isStub).length',
      ],
    },
    {
      message: 'a stub dependent is not gated',
      nodes: [node('R', 'blocked'), node('S', 'planning', { isStub: true })],
      edges: [depends('R', 'S')],
      check: (result, message) => assert.strictEqual(result.perNode.R.gates, 0, message),
      mutant: [
        'gates: below.filter((card) => eligible(records.get(card))).length',
        'gates: below.filter((card) => records.get(card).status !== "completed").length',
      ],
    },
    {
      message: 'a stuck dependent is still gated',
      nodes: [node('R', 'blocked'), node('P', 'parked')],
      edges: [depends('R', 'P')],
      check: (result, message) => assert.strictEqual(result.perNode.R.gates, 1, message),
      mutant: [
        'gates: below.filter((card) => eligible(records.get(card))).length',
        'gates: below.filter((card) => eligible(records.get(card)) && !stuck(records.get(card))).length',
      ],
    },
    ...ROOT_CAUSE_MINIMAL_FIXTURES,
  ];
  assert.strictEqual(new Set(rules.map((rule) => rule.message)).size, rules.length, 'rule messages are distinct');
  for (const { message, nodes, edges, check, mutant } of rules) {
    check(insights.analyzeGraph(nodes, edges), message);
    const edits = typeof mutant[0] === 'string' ? [mutant] : mutant;
    let mutantSource = source;
    for (const [from, to] of edits) {
      assert.strictEqual(mutantSource.split(from).length, 2, `${message}: the mutation anchor occurs once`);
      mutantSource = mutantSource.replace(from, () => to);
    }
    const Mutant = eval(`(${mutantSource})`); // eslint-disable-line no-eval
    assert.throws(() => check(new Mutant().analyzeGraph(nodes, edges), message),
      (error) => error instanceof assert.AssertionError && error.message.split('\n')[0] === message,
      `${message}: fails at this message under the mutant replacing ${edits.map(([from]) => JSON.stringify(from)).join(' and ')}`);
  }
});

test('PH0C-FULL-REFERENCE: on every replayed call, isReady, rootCauses, root-cause card and hops, and the new summary counts have the shipped field descriptor, per-node entries, rootCauses arrays, and root causes have the shipped extensibility, sealing, and freezing, each root cause\'s own keys are exactly card and hops, each result array\'s own keys are exactly its indices and length, and the result, summary, per-node entries, and root causes have the prototype of the shipped helper\'s per-node entries and each result array that of its closure arrays, in the call\'s realm', () => {
  const shipped = legacy.analyzeGraph([node('R', 'blocked'), node('A', 'planning')], [depends('R', 'A')]);
  const field = JSON.stringify(descriptorOf(shipped.perNode.A, 'upstream'));
  for (const key of LEGACY_NODE_KEYS) {
    assert.strictEqual(JSON.stringify(descriptorOf(shipped.perNode.A, key)), field,
      `the shipped per-node ${key} descriptor equals the shipped upstream descriptor`);
  }
  for (const key of LEGACY_SUMMARY_KEYS) {
    assert.strictEqual(JSON.stringify(descriptorOf(shipped.summary, key)), field,
      `the shipped summary ${key} descriptor equals the shipped upstream descriptor`);
  }
  const integrity = (value) => JSON.stringify({
    extensible: Object.isExtensible(value), sealed: Object.isSealed(value), frozen: Object.isFrozen(value),
  });
  const shippedObject = integrity(shipped.perNode.A);
  const shippedArray = integrity(shipped.perNode.A.upstream);
  const arrayOwnKeys = (array) => [...Array(array.length).keys()].map(String).concat('length');
  assert.deepStrictEqual(Reflect.ownKeys(shipped.perNode.R.downstream), arrayOwnKeys(shipped.perNode.R.downstream),
    'a shipped closure array has exactly its indices and length as own keys');
  const prototypes = new Map([...oracles].map(([realm, oracle]) => {
    const sample = oracle.analyzeGraph([node('R', 'blocked'), node('A', 'planning')], [depends('R', 'A')]);
    return [realm, { object: Object.getPrototypeOf(sample.perNode.A), array: Object.getPrototypeOf(sample.perNode.A.upstream) }];
  }));
  let entries = 0;
  let causes = 0;
  helperCalls.forEach((call, index) => {
    if (call.disposition !== REPLAYED) return;
    const label = `call ${index} (${call.realm} realm) from "${call.caseName}"`;
    const { perNode, summary } = call.result;
    const prototype = prototypes.get(call.realm);
    for (const [name, value] of [['the result', call.result], ['summary', summary]]) {
      assert.strictEqual(Object.getPrototypeOf(value), prototype.object, `${label}: ${name} has the realm's plain-object prototype`);
    }
    assert.strictEqual(Object.getPrototypeOf(summary.rootBlockers), prototype.array,
      `${label}: summary.rootBlockers has the realm's array prototype`);
    for (const key of ADDITIVE_SUMMARY_KEYS) {
      assert.strictEqual(JSON.stringify(descriptorOf(summary, key)), field,
        `${label}: summary.${key} has the shipped field descriptor`);
    }
    assert.deepStrictEqual(Reflect.ownKeys(summary.rootBlockers), arrayOwnKeys(summary.rootBlockers),
      `${label}: summary.rootBlockers's own keys, enumerable or not, are exactly its indices and length`);
    for (const card of Object.keys(perNode)) {
      const entry = perNode[card];
      assert.strictEqual(integrity(entry), shippedObject, `${label}: perNode[${card}] has the shipped object integrity`);
      for (const key of ADDITIVE_NODE_KEYS) {
        assert.strictEqual(JSON.stringify(descriptorOf(entry, key)), field,
          `${label}: perNode[${card}].${key} has the shipped per-node field descriptor`);
      }
      assert.strictEqual(Object.getPrototypeOf(entry), prototype.object,
        `${label}: perNode[${card}] has the realm's plain-object prototype`);
      for (const key of ['upstream', 'downstream', 'rootCauses']) {
        assert.deepStrictEqual(Reflect.ownKeys(entry[key]), arrayOwnKeys(entry[key]),
          `${label}: perNode[${card}].${key}'s own keys, enumerable or not, are exactly its indices and length`);
        assert.strictEqual(Object.getPrototypeOf(entry[key]), prototype.array,
          `${label}: perNode[${card}].${key} has the realm's array prototype`);
      }
      assert.strictEqual(integrity(entry.rootCauses), shippedArray,
        `${label}: perNode[${card}].rootCauses has the shipped array integrity`);
      for (const cause of entry.rootCauses) {
        assert.deepStrictEqual(Reflect.ownKeys(cause), ['card', 'hops'],
          `${label}: a root cause of ${card} has exactly the own keys card and hops, enumerable or not`);
        assert.strictEqual(Object.getPrototypeOf(cause), prototype.object,
          `${label}: a root cause of ${card} has the realm's plain-object prototype`);
        assert.strictEqual(integrity(cause), shippedObject, `${label}: a root cause of ${card} has the shipped object integrity`);
        for (const key of ['card', 'hops']) {
          assert.strictEqual(JSON.stringify(descriptorOf(cause, key)), field,
            `${label}: a root cause of ${card} has the shipped field descriptor on ${key}`);
        }
        causes += 1;
      }
      entries += 1;
    }
  });
  assert.ok(entries > 0 && causes > 0, 'the replayed calls include per-node entries and root causes');
});

// Every case of PH0-READINESS-COMPLETED-ONLY, PH0-SUMMARY-COUNTS,
// PH0C-FULL-REFERENCE, PH0C-ANY-ORDER, and PH0C-SIZES-BEYOND-TESTED, and
// PH0-LEGACY-SHAPE-EXACT cases 9 and 31, compares each analysis it replays
// with the reference.
const COMPARED_CASE_PREFIXES = [
  'PH0-READINESS-COMPLETED-ONLY: ',
  'PH0-SUMMARY-COUNTS: ',
  'PH0-LEGACY-SHAPE-EXACT: case 9: ',
  'PH0-LEGACY-SHAPE-EXACT: case 31: ',
  'PH0C-FULL-REFERENCE: ',
  'PH0C-ANY-ORDER: ',
  'PH0C-SIZES-BEYOND-TESTED: ',
];

test('PH0C-FULL-REFERENCE: in each case whose analyses are said to be compared with the reference, the reference comparisons equal the replayed calls, one for one, and the only empty-shape checks are inputs with an empty or whitespace-only status', () => {
  const here = cases.findIndex(([name]) => name === currentCase);
  let checked = 0;
  for (const prefix of COMPARED_CASE_PREFIXES) {
    const named = cases.map(([name], index) => ({ name, index })).filter(({ name }) => name.startsWith(prefix));
    let replayedInPrefix = 0;
    for (const { name, index } of named) {
      if (name === currentCase) continue;
      assert.ok(index < here, `"${name}" runs before this case, so its calls are counted`);
      const calls = helperCalls.filter((call) => call.caseName === name);
      const replayed = calls.filter((call) => call.disposition === REPLAYED);
      const compared = referenceComparisons.filter((comparison) => comparison.caseName === name);
      assert.strictEqual(compared.length, replayed.length,
        `"${name}": the number of reference comparisons equals the number of replayed calls`);
      compared.forEach((comparison, position) => {
        assert.strictEqual(comparison.result, replayed[position].result,
          `"${name}": reference comparison ${position} is of replayed call ${position}`);
      });
      for (const call of calls.filter((entry) => entry.disposition === EMPTY_CHECKED)) {
        assert.ok(prefix === 'PH0-READINESS-COMPLETED-ONLY: '
          && call.nodes.some((record) => typeof record.status === 'string' && record.status.trim() === ''),
        `"${name}": an empty-shape check in a compared case is a PH0-READINESS-COMPLETED-ONLY input with an empty or whitespace-only status`);
      }
      replayedInPrefix += replayed.length;
    }
    assert.ok(replayedInPrefix > 0, `the ${prefix.slice(0, -2)} cases replay and compare some analysis`);
    checked += replayedInPrefix;
  }
  assert.strictEqual(checked, referenceComparisons.length,
    'every reference comparison is of a replayed call in one of these cases');
});

test('PH0-PURITY-CARRIED: analyses add no own property to the main-realm helper instance, its prototype, or its class', () => {
  assert.deepStrictEqual(Reflect.ownKeys(candidate), [],
    'the instance that made every main-realm analysis has no own properties');
  assert.deepStrictEqual(Reflect.ownKeys(GraphInsights.prototype), HELPER_PROTOTYPE_KEYS,
    'the helper prototype has the own keys it had before the first analysis');
  assert.deepStrictEqual(Reflect.ownKeys(GraphInsights), HELPER_CLASS_KEYS,
    'the helper class has the own keys it had before the first analysis');
});

test('PH0-PURITY-CARRIED: no replayed result reaches the same object or array at two places', () => {
  let objects = 0;
  helperCalls.forEach((call, index) => {
    if (call.disposition !== REPLAYED) return;
    const seen = new Set();
    const visit = (value, where) => {
      assert.strictEqual(seen.has(value), false,
        `call ${index} (${call.realm} realm) from "${call.caseName}": ${where} was already reached elsewhere in the result`);
      seen.add(value);
      objects += 1;
      for (const key of Object.keys(value)) {
        if (value[key] !== null && typeof value[key] === 'object') visit(value[key], `${where}.${key}`);
      }
    };
    visit(call.result, 'result');
  });
  assert.ok(objects > 0, 'the replayed results contain objects');
});

test('PH0-LEGACY-SHAPE-EXACT: each replayed call keeps the shipped fields, key order, and descriptors of the shipped helper output', () => {
  assert.strictEqual(gitBlobId(LEGACY_SOURCE), LEGACY_BLOB_ID,
    'the embedded oracle is byte-identical to the shipped graph-insights.js blob');
  helperCalls.forEach((call, index) => {
    if (call.disposition !== REPLAYED) return;
    assertLegacyShapeExact(call.result, oracles.get(call.realm).analyzeGraph(call.nodes, call.edges),
      `call ${index} (${call.realm} realm) from "${call.caseName}"`);
    replayedCalls += 1;
  });
});

test('PH0B-REPLAY-EVERY-CALL: every real-helper call, in every realm, was replayed or checked against the empty shape', () => {
  assert.strictEqual(cases[cases.length - 1][0], currentCase, 'this is the last case, so no real-helper call follows it');
  const unsettled = helperCalls.filter((call) => call.disposition === null)
    .map((call) => `${call.realm}-realm call from "${call.caseName}"`);
  assert.deepStrictEqual(unsettled, [], 'every real-helper call was settled by the case that made it');
  assert.strictEqual(replayedCalls + emptyShapeChecks, helperCalls.length,
    'replayed calls plus empty-shape-checked calls account for every real-helper call');
  assert.deepStrictEqual([...oracles.keys()], ['main', 'locked', 'strict', 'fault'],
    'the helper is loaded in the main, locked, strict, and fault realms');
  assert.deepStrictEqual(
    [...new Set(helperCalls.filter((call) => call.disposition === REPLAYED).map((call) => call.realm))],
    [...oracles.keys()],
    'each realm that loaded the helper has replayed analyses',
  );
});

let failures = 0;
for (const [name, fn] of cases) {
  currentCase = name;
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
