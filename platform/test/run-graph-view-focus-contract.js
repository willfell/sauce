#!/usr/bin/env node
'use strict';

// Independent BL-6a executable contract. The behavioral harness records a
// receipt only after each exact BL-6 predicate executes successfully. This
// sentinel binds those predicates from a separate file, runs the harness in a
// child process, and requires the exact ordered receipt stream. Source text
// hidden in dead code cannot produce a receipt; a weakened predicate cannot
// satisfy the independent source contract.

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BEHAVIOR = path.join(ROOT, 'platform/test/run-graph-view.js');
const PACKAGE = path.join(ROOT, 'package.json');
const source = fs.readFileSync(BEHAVIOR, 'utf8');
const compact = source.replace(/\s+/g, ' ');
const pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));

const expectedReceipts = [
  'epic-noop',
  'first-tap',
  'partner-bright:E1-1', 'partner-bright:E1-2', 'partner-bright:E2-1', 'partner-bright:EB-1',
  'unrelated-dim:E2-2', 'unrelated-dim:EX-1',
  'focused-header', 'strips-unaffected', 'active-instance', 'second-tap', 'refocus-no-open',
  'refocus-bright:E2-1', 'refocus-bright:E2-2', 'refocus-bright:E1-2',
  'refocus-dim:E1-1', 'refocus-dim:EB-1', 'refocus-dim:EX-1',
  'canvas-clear', 'fresh-render', 'filter-composition', 'selection-precedence',
  'clear-precedence', 'ephemeral-composition', 'zero-project-writes', 'zero-persistence-writes',
];

const exactPredicates = [
  ["epic no-op", "bl6Check('epic-noop', byClass(root, 'graph-view-cluster-header').length === 0, 'BL6-EPIC-SCOPE-NOOP: epic scope renders no cluster header or focus affordance');"],
  ["first tap", "bl6Check('first-tap', firstClusterTap.stopped && projectOpened.length === clusterOpenCount, 'BL6-FIRST-TAP: first cluster-header tap stops bubbling and performs no navigation');"],
  ["partner footprint", "bl6Check(`partner-bright:${id}`, !pChipFor(id).className.includes('graph-view-dimmed'), `BL6-BIDIRECTIONAL-PARTNER: focused Epic One keeps ${id} full-strength`);"],
  ["unrelated footprint", "bl6Check(`unrelated-dim:${id}`, pChipFor(id).className.includes('graph-view-dimmed'), `BL6-EXACT-FOOTPRINT: unrelated ${id} dims`);"],
  ["focused header", "bl6Check('focused-header', headers[1].className.includes('graph-view-cluster-focused') && headers[1].attrs['aria-pressed'] === 'true', 'BL6-FOCUSED-HEADER: focused cluster exposes class and pressed state');"],
  ["strips", "bl6Check('strips-unaffected', !byClass(pRoot, 'graph-view-done-chip')[0].className.includes('graph-view-dimmed') && byClass(pRoot, 'warning-missing-epic').every((row) => !row.className.includes('graph-view-dimmed')), 'BL6-STRIPS-UNAFFECTED: done and warning strips remain outside cluster focus');"],
  ["active instance", "bl6Check('active-instance', JSON.stringify(domShape(activeFocusFreshContainer.children[0])) === JSON.stringify(clusterAtRest), 'BL6-CROSS-INSTANCE-ACTIVE: a second render starts unfocused while the first remains focused');"],
  ["second tap", "bl6Check('second-tap', JSON.stringify(projectOpened.at(-1)) === JSON.stringify([`${epicOneDir}/Epic One`, stationPath, false]), 'BL6-SECOND-TAP: second tap on the focused header opens its atlas');"],
  ["refocus navigation", "bl6Check('refocus-no-open', projectOpened.length === opensAfterSecondTap, 'BL6-REFOCUS: tapping a different header refocuses instead of opening');"],
  ["refocus bright", "bl6Check(`refocus-bright:${id}`, !pChipFor(id).className.includes('graph-view-dimmed'), `BL6-REFOCUS: Epic Two keeps ${id} full-strength`);"],
  ["refocus dim", "bl6Check(`refocus-dim:${id}`, pChipFor(id).className.includes('graph-view-dimmed'), `BL6-REFOCUS: Epic Two dims unrelated ${id}`);"],
  ["canvas clear", "bl6Check('canvas-clear', JSON.stringify(domShape(pRoot)) === JSON.stringify(clusterAtRest), 'BL6-EMPTY-CANVAS: empty canvas clears focus and restores exact at-rest DOM');"],
  ["fresh render", "bl6Check('fresh-render', JSON.stringify(domShape(freshProjectContainer.children[0])) === JSON.stringify(clusterAtRest), 'BL6-FRESH-RENDER: a new widget instance has no persisted cluster focus');"],
  ["filter composition", "bl6Check('filter-composition', pChipFor('E1-1').className.includes('graph-view-dimmed') && ['E2-2', 'EX-1'].every((id) => pChipFor(id).className.includes('graph-view-dimmed')) && ['E2-1', 'E1-2', 'EB-1'].every((id) => !pChipFor(id).className.includes('graph-view-dimmed')), 'BL6-FILTER-COMPOSITION: cluster focus and Dim done compose as a dimming union');"],
  ["selection precedence", "bl6Check('selection-precedence', !pChipFor('E2-2').className.includes('graph-view-dimmed') && ['E2-1', 'E1-1', 'E1-2', 'EB-1', 'EX-1'] .every((id) => pChipFor(id).className.includes('graph-view-dimmed')), 'BL6-SELECTION-PRECEDENCE: chip selection wins wholesale over focus and filters');"],
  ["clear precedence", "bl6Check('clear-precedence', pChipFor('E1-1').className.includes('graph-view-dimmed') && ['E2-1', 'E2-2', 'E1-2', 'EB-1', 'EX-1'].every((id) => !pChipFor(id).className.includes('graph-view-dimmed')), 'BL6-CLEAR-PRECEDENCE: empty canvas clears selection and focus but reapplies the active filter');"],
  ["ephemeral composition", "bl6Check('ephemeral-composition', JSON.stringify(domShape(pRoot)) === JSON.stringify(projectFilterAtRest), 'BL6-EPHEMERAL-COMPOSITION: clearing focus and toggling the filter off restores exact at-rest DOM');"],
  ["zero project writes", "bl6Check('zero-project-writes', projectMutations.length === 0, 'BL6-ZERO-PROJECT-WRITES: focus invokes no vault, adapter, frontmatter, or metadata mutator');"],
  ["zero persistence writes", "bl6Check('zero-persistence-writes', persistenceMutations.length === 0, 'BL6-ZERO-PERSISTENCE-WRITES: focus invokes no localStorage or coordinator mutation surface');"],
];

function staticFailures(candidate) {
  const body = candidate.replace(/\s+/g, ' ');
  const failures = exactPredicates.filter(([, predicate]) => !body.includes(predicate)).map(([label]) => label);
  if ((candidate.match(/function bl6Check\(/g) || []).length !== 1
    || (candidate.match(/bl6Receipts\.push\(name\)/g) || []).length !== 1) failures.push('receipt helper');
  if (!candidate.includes('console.log(`BL6-RECEIPTS ${JSON.stringify(bl6Receipts)}`);')) failures.push('receipt output');
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

// Contract self-tests: dead-code wrapping preserves the exact source string
// but cannot satisfy the runtime receipt stream; weakening changes the exact
// predicate and fails the independent static half.
const deadCode = source.replace("bl6Check('first-tap',", "if (false) bl6Check('first-tap',");
assert.deepStrictEqual(staticFailures(deadCode), [], 'BL6A-SELF-DEAD-CODE: textual presence alone still passes static binding');
const missingFirstTap = expectedReceipts.filter((receipt) => receipt !== 'first-tap');
assert.deepStrictEqual(receiptFailures(`BL6-RECEIPTS ${JSON.stringify(missingFirstTap)}`), ['receipt sequence'],
  'BL6A-SELF-DEAD-CODE: a non-executed exact predicate fails the receipt contract');
const weakened = source.replace(
  "firstClusterTap.stopped && projectOpened.length === clusterOpenCount",
  "Boolean(headers[1])",
);
assert(staticFailures(weakened).includes('first tap'),
  'BL6A-SELF-WEAKENED: a weaker nonliteral predicate fails the independent source contract');

assert.strictEqual(pkg.scripts?.['test:graph-view-focus-contract'],
  'node platform/test/run-graph-view-focus-contract.js',
  'BL6A-REGISTRY: the independent focus contract is registered');
assert.strictEqual(((pkg.scripts?.['release:preflight'] || '').match(/run-graph-view-focus-contract\.js/g) || []).length, 1,
  'BL6A-PREFLIGHT: release preflight invokes the focus contract exactly once');

console.log('PASS — GraphView BL-6a executable focus contract');
