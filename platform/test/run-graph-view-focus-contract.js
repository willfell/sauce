#!/usr/bin/env node
'use strict';

// Independent BL-6c executable contract. The behavioral harness records a
// receipt only after each exact BL-6 predicate executes successfully. This
// sentinel binds the complete lexical fixture from a separate file, runs the
// harness in a child process, and requires the exact ordered receipt stream.
// The byte identity is intentionally independent of runtime stack formatting:
// a dead exact call or a byte-identical call over shadow fixtures changes the
// independently pinned harness digest before it can forge a receipt.

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BEHAVIOR = path.join(ROOT, 'platform/test/run-graph-view.js');
const PACKAGE = path.join(ROOT, 'package.json');
const source = fs.readFileSync(BEHAVIOR, 'utf8');
const compact = source.replace(/\s+/g, ' ');
const pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));
const EXPECTED_BEHAVIOR_SHA256 = '1d79d557ce51b14a08fc360c8b435beab3a524acb1d7ec218386d5caddd8bf8d';

const exactPredicates = [
  ["epic no-op", "bl6Check('epic-noop', () => byClass(root, 'graph-view-cluster-header').length === 0, 'BL6-EPIC-SCOPE-NOOP: epic scope renders no cluster header or focus affordance');"],
  ["first tap", "bl6Check('first-tap', () => firstClusterTap.stopped && projectOpened.length === clusterOpenCount, 'BL6-FIRST-TAP: first cluster-header tap stops bubbling and performs no navigation');"],
  ["partner footprint", "bl6Check(`partner-bright:${id}`, () => !pChipFor(id).className.includes('graph-view-dimmed'), `BL6-BIDIRECTIONAL-PARTNER: focused Epic One keeps ${id} full-strength`);"],
  ["unrelated footprint", "bl6Check(`unrelated-dim:${id}`, () => pChipFor(id).className.includes('graph-view-dimmed'), `BL6-EXACT-FOOTPRINT: unrelated ${id} dims`);"],
  ["focused header", "bl6Check('focused-header', () => headers[1].className.includes('graph-view-cluster-focused') && headers[1].attrs['aria-pressed'] === 'true', 'BL6-FOCUSED-HEADER: focused cluster exposes class and pressed state');"],
  ["strips", "bl6Check('strips-unaffected', () => !byClass(pRoot, 'graph-view-done-chip')[0].className.includes('graph-view-dimmed') && byClass(pRoot, 'warning-missing-epic').every((row) => !row.className.includes('graph-view-dimmed')), 'BL6-STRIPS-UNAFFECTED: done and warning strips remain outside cluster focus');"],
  ["active instance", "bl6Check('active-instance', () => JSON.stringify(domShape(activeFocusFreshContainer.children[0])) === JSON.stringify(clusterAtRest), 'BL6-CROSS-INSTANCE-ACTIVE: a second render starts unfocused while the first remains focused');"],
  ["second tap", "bl6Check('second-tap', () => JSON.stringify(projectOpened.at(-1)) === JSON.stringify([`${epicOneDir}/Epic One`, stationPath, false]), 'BL6-SECOND-TAP: second tap on the focused header opens its atlas');"],
  ["refocus navigation", "bl6Check('refocus-no-open', () => projectOpened.length === opensAfterSecondTap, 'BL6-REFOCUS: tapping a different header refocuses instead of opening');"],
  ["refocus bright", "bl6Check(`refocus-bright:${id}`, () => !pChipFor(id).className.includes('graph-view-dimmed'), `BL6-REFOCUS: Epic Two keeps ${id} full-strength`);"],
  ["refocus dim", "bl6Check(`refocus-dim:${id}`, () => pChipFor(id).className.includes('graph-view-dimmed'), `BL6-REFOCUS: Epic Two dims unrelated ${id}`);"],
  ["canvas clear", "bl6Check('canvas-clear', () => JSON.stringify(domShape(pRoot)) === JSON.stringify(clusterAtRest), 'BL6-EMPTY-CANVAS: empty canvas clears focus and restores exact at-rest DOM');"],
  ["fresh render", "bl6Check('fresh-render', () => JSON.stringify(domShape(freshProjectContainer.children[0])) === JSON.stringify(clusterAtRest), 'BL6-FRESH-RENDER: a new widget instance has no persisted cluster focus');"],
  ["filter composition", "bl6Check('filter-composition', () => pChipFor('E1-1').className.includes('graph-view-dimmed') && ['E2-2', 'EX-1'].every((id) => pChipFor(id).className.includes('graph-view-dimmed')) && ['E2-1', 'E1-2', 'EB-1'].every((id) => !pChipFor(id).className.includes('graph-view-dimmed')), 'BL6-FILTER-COMPOSITION: cluster focus and Dim done compose as a dimming union');"],
  ["selection precedence", "bl6Check('selection-precedence', () => !pChipFor('E2-2').className.includes('graph-view-dimmed') && ['E2-1', 'E1-1', 'E1-2', 'EB-1', 'EX-1'] .every((id) => pChipFor(id).className.includes('graph-view-dimmed')), 'BL6-SELECTION-PRECEDENCE: chip selection wins wholesale over focus and filters');"],
  ["clear precedence", "bl6Check('clear-precedence', () => pChipFor('E1-1').className.includes('graph-view-dimmed') && ['E2-1', 'E2-2', 'E1-2', 'EB-1', 'EX-1'].every((id) => !pChipFor(id).className.includes('graph-view-dimmed')), 'BL6-CLEAR-PRECEDENCE: empty canvas clears selection and focus but reapplies the active filter');"],
  ["ephemeral composition", "bl6Check('ephemeral-composition', () => JSON.stringify(domShape(pRoot)) === JSON.stringify(projectFilterAtRest), 'BL6-EPHEMERAL-COMPOSITION: clearing focus and toggling the filter off restores exact at-rest DOM');"],
  ["zero project writes", "bl6Check('zero-project-writes', () => projectMutations.length === 0, 'BL6-ZERO-PROJECT-WRITES: focus invokes no vault, adapter, frontmatter, or metadata mutator');"],
  ["zero persistence writes", "bl6Check('zero-persistence-writes', () => persistenceMutations.length === 0, 'BL6-ZERO-PERSISTENCE-WRITES: focus invokes no localStorage or coordinator mutation surface');"],
];

const receiptNames = {
  "epic no-op": ['epic-noop'],
  "first tap": ['first-tap'],
  "partner footprint": ['partner-bright:E1-1', 'partner-bright:E1-2', 'partner-bright:E2-1', 'partner-bright:EB-1'],
  "unrelated footprint": ['unrelated-dim:E2-2', 'unrelated-dim:EX-1'],
  "focused header": ['focused-header'], "strips": ['strips-unaffected'], "active instance": ['active-instance'],
  "second tap": ['second-tap'], "refocus navigation": ['refocus-no-open'],
  "refocus bright": ['refocus-bright:E2-1', 'refocus-bright:E2-2', 'refocus-bright:E1-2'],
  "refocus dim": ['refocus-dim:E1-1', 'refocus-dim:EB-1', 'refocus-dim:EX-1'],
  "canvas clear": ['canvas-clear'], "fresh render": ['fresh-render'], "filter composition": ['filter-composition'],
  "selection precedence": ['selection-precedence'], "clear precedence": ['clear-precedence'],
  "ephemeral composition": ['ephemeral-composition'], "zero project writes": ['zero-project-writes'],
  "zero persistence writes": ['zero-persistence-writes'],
};

function predicateSource(call) {
  const start = call.indexOf('() => ');
  const single = call.indexOf(", 'BL6", start);
  const template = call.indexOf(', `BL6', start);
  const end = [single, template].filter((value) => value >= 0).sort((left, right) => left - right)[0];
  return call.slice(start, end).replace(/\s+/g, ' ');
}
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
const expectedReceipts = exactPredicates.flatMap(([label, call]) => {
  const predicateDigest = digest(predicateSource(call));
  return receiptNames[label].map((name) => ({ name, digest: predicateDigest }));
});

function staticFailures(candidate) {
  const body = candidate.replace(/\s+/g, ' ');
  const failures = exactPredicates.filter(([, predicate]) => !body.includes(predicate)).map(([label]) => label);
  const recorder = "const { check: bl6Check, snapshot: bl6ReceiptSnapshot } = (() => { let tail = null; let count = 0; const check = (name, predicate, message) => { assert.strictEqual(typeof predicate, 'function', `BL6 receipt ${name} requires a predicate function`); const predicateSource = Function.prototype.toString.call(predicate).replace(/\\s+/g, ' '); const digest = crypto.createHash('sha256').update(predicateSource).digest('hex'); assert(predicate(), message); tail = { previous: tail, receipt: { name, digest } }; count += 1; }; const snapshot = () => { const output = []; output.length = count; let cursor = tail; let index = count - 1; while (cursor) { output[index] = { ...cursor.receipt }; cursor = cursor.previous; index -= 1; } return output; }; return Object.freeze({ check, snapshot }); })();";
  if (!body.includes(recorder) || /\breceipts?\.push\(/.test(candidate)) failures.push('receipt recorder');
  if (digest(candidate) !== EXPECTED_BEHAVIOR_SHA256) failures.push('behavior source identity');
  if (!candidate.includes('console.log(`BL6-RECEIPTS ${JSON.stringify(bl6ReceiptSnapshot())}`);')) failures.push('receipt output');
  return failures;
}

function receiptFailures(stdout) {
  const rows = String(stdout).split(/\r?\n/).filter((line) => line.startsWith('BL6-RECEIPTS '));
  if (rows.length !== 1) return ['receipt row'];
  let actual;
  try { actual = JSON.parse(rows[0].slice('BL6-RECEIPTS '.length)); } catch (_error) { return ['receipt JSON']; }
  return JSON.stringify(actual) === JSON.stringify(expectedReceipts) ? [] : ['receipt sequence'];
}

assert.deepStrictEqual(staticFailures(source), [], 'BL6A-STATIC: every exact executable predicate remains bound');
const run = childProcess.spawnSync(process.execPath, [BEHAVIOR], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
});
assert.strictEqual(run.status, 0, `BL6A-EXECUTE: GraphView behavior harness failed\n${run.stderr || run.stdout}`);
assert.deepStrictEqual(receiptFailures(run.stdout), [],
  'BL6A-EXECUTE: every BL-6 predicate executed and emitted its exact ordered receipt');

// Contract self-tests: every source-level attempt to relocate an exact
// predicate away from its real lexical fixtures fails the independent byte
// identity, while runtime receipts still prove that the pinned calls execute.
const deadCode = source.replace("bl6Check('first-tap', () =>", "if (false) bl6Check('first-tap', () =>");
assert(staticFailures(deadCode).includes('behavior source identity'),
  'BL6C-SELF-DEAD-CODE: dead wrapping changes the independently pinned lexical fixture');
const bypassedHelper = source.replace('    assert(predicate(), message);', '    if (false) assert(predicate(), message);');
assert(staticFailures(bypassedHelper).includes('receipt recorder'),
  'BL6A-SELF-HELPER-BYPASS: assert-before-record provenance is independently bound');
const missingFirstTap = expectedReceipts.filter((receipt) => receipt.name !== 'first-tap');
assert.deepStrictEqual(receiptFailures(`BL6-RECEIPTS ${JSON.stringify(missingFirstTap)}`), ['receipt sequence'],
  'BL6A-SELF-DEAD-CODE: a non-executed exact predicate fails the receipt contract');
const weakened = source.replace(
  "firstClusterTap.stopped && projectOpened.length === clusterOpenCount",
  "Boolean(headers[1])",
);
assert(staticFailures(weakened).includes('first tap'),
  'BL6A-SELF-WEAKENED: a weaker nonliteral predicate fails the independent source contract');
const forgedReceipts = expectedReceipts.map((receipt) => receipt.name === 'first-tap'
  ? { ...receipt, digest: digest('() => Boolean(headers[1])') } : receipt);
assert.deepStrictEqual(receiptFailures(`BL6-RECEIPTS ${JSON.stringify(forgedReceipts)}`), ['receipt sequence'],
  'BL6A-SELF-FORGED: a weaker active predicate cannot forge the exact predicate digest');
const stackForgery = `${source}\nError.prepareStackTrace = () => 'forged run-graph-view.js:1:1';\n`;
assert(staticFailures(stackForgery).includes('behavior source identity'),
  'BL6C-SELF-STACK-FORGERY: mutable stack formatting cannot alter or replace proof provenance');
const shadowedExact = source.replace(
  "  for (const id of ['E1-1'",
  "  { const firstClusterTap = { stopped: true }; const projectOpened = []; const clusterOpenCount = 0;\n"
    + "    bl6Check('first-tap', () => firstClusterTap.stopped && projectOpened.length === clusterOpenCount, 'BL6-FIRST-TAP: first cluster-header tap stops bubbling and performs no navigation'); }\n"
    + "  for (const id of ['E1-1'",
);
assert(staticFailures(shadowedExact).includes('behavior source identity'),
  'BL6C-SELF-SHADOWED: a byte-identical predicate over shadow fixtures changes the pinned harness identity');
const priorStackExploit = deadCode.replace(
  "  for (const id of ['E1-1'",
  "  { const firstClusterTap = { stopped: true }; const projectOpened = []; const clusterOpenCount = 0;\n"
    + "    Error.prepareStackTrace = () => 'forged run-graph-view.js:1:1';\n"
    + "    bl6Check('first-tap', () => firstClusterTap.stopped && projectOpened.length === clusterOpenCount, 'BL6-FIRST-TAP: first cluster-header tap stops bubbling and performs no navigation'); }\n"
    + "  for (const id of ['E1-1'",
);
assert(staticFailures(priorStackExploit).includes('behavior source identity'),
  'BL6C-SELF-PRIOR-EXPLOIT: dead real predicate plus shadow fixtures and forged stack stays RED');
const directWriter = source.replace(
  "if (false) bl6Check('first-tap', () =>",
  "if (false) bl6Check('first-tap', () =>",
).replace(
  "  bl6Check('first-tap', () =>",
  "  if (false) bl6Check('first-tap', () =>",
).replace(
  "  for (const id of ['E1-1'",
  "  receipts.push({ name: 'first-tap', digest: 'forged' });\n  for (const id of ['E1-1'",
);
assert(staticFailures(directWriter).includes('receipt recorder'),
  'BL6B-SELF-DIRECT-WRITER: a second receipt writer is rejected independently');

assert.strictEqual(pkg.scripts?.['test:graph-view-focus-contract'],
  'node platform/test/run-graph-view-focus-contract.js',
  'BL6A-REGISTRY: the independent focus contract is registered');
assert.strictEqual(((pkg.scripts?.['release:preflight'] || '').match(/run-graph-view-focus-contract\.js/g) || []).length, 1,
  'BL6A-PREFLIGHT: release preflight invokes the focus contract exactly once');

console.log('PASS — GraphView BL-6c scope-bound focus contract');
