#!/usr/bin/env node
'use strict';

// Independent BL-5b sentinel. This file deliberately does not import or share
// assertions with run-graph-view.js: it binds the production authority seams,
// the adversarial fixtures, and its own preflight registration from source.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const widget = fs.readFileSync(path.join(ROOT, 'platform/blueprints/project/helpers/graph-view.js'), 'utf8');
const behavior = fs.readFileSync(path.join(ROOT, 'platform/test/run-graph-view.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const failures = [];

function check(condition, label) {
  if (!condition) failures.push(label);
}

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = from < 0 ? -1 : source.indexOf(end, from + start.length);
  return from >= 0 && to > from ? source.slice(from, to) : '';
}

const keepSet = section(widget, '  _stuckKeepSet(nodes, analysis) {', '\n  // Selection and filters');
const controller = section(widget, '  _selectionController({', '\n  // GV-R2 epic-scope geometry');

check(keepSet.includes('this._nodeInsight(analysis, root)?.downstream'),
  'BL5B-SENTINEL-CLOSURES-DOWNSTREAM: Stuck consumes GraphInsights downstream membership');
check(keepSet.includes('this._nodeInsight(analysis, blocked)?.upstream'),
  'BL5B-SENTINEL-CLOSURES-UPSTREAM: Stuck consumes GraphInsights upstream membership');
check(!/\bedges\b|_hasPath|adjacen|\bqueue\b|\bvisited\b/i.test(keepSet),
  'BL5B-SENTINEL-NO-TRAVERSAL: Stuck keep-set contains no local graph traversal surface');
check(controller.includes('const filters = { stuck: false, dimDone: false };')
  && (widget.match(/const filters = \{ stuck: false, dimDone: false \};/g) || []).length === 1,
  'BL5B-SENTINEL-RENDER-LOCAL: filter state is allocated exactly once inside the render controller');
check(controller.includes('BL5B-FAIL-SOFT-GUARD')
  && controller.includes('if (key === "stuck" && !analysis) return;'),
  'BL5B-SENTINEL-FAIL-SOFT-GUARD: Stuck is inert without authoritative analysis');

for (const marker of [
  'BL5B-CROSS-INSTANCE-ACTIVE',
  'BL5B-CLOSURE-DIVERGENCE',
  'BL5B-FAIL-SOFT-MISSING',
  'BL5B-FAIL-SOFT-THROWING',
]) check(behavior.includes(marker), `BL5B-SENTINEL-BEHAVIOR-MARKER: missing ${marker}`);

check(behavior.includes("bl5DivergentPerNode['BL5-A Root'].downstream = ['BL5-G Closure bridge', 'BL5-C Downstream stuck'];")
  && behavior.includes("bl5DivergentPerNode['BL5-C Downstream stuck'].upstream = ['BL5-A Root', 'BL5-G Closure bridge'];")
  && behavior.includes("for (const id of ['BL5-A', 'BL5-C', 'BL5-D', 'BL5-G'])")
  && behavior.includes("for (const id of ['BL5-B', 'BL5-E', 'BL5-F'])"),
  'BL5B-SENTINEL-DIVERGENT-FIXTURE: authoritative closure footprint remains edge-divergent');
check(behavior.includes('const bl5AtRest = JSON.parse(JSON.stringify(domShape(bl5Root)));'),
  'BL5B-SENTINEL-IMMUTABLE-BASELINE: at-rest DOM is snapshotted by value');

const activeMarker = behavior.indexOf('BL5B-CROSS-INSTANCE-ACTIVE');
const bothActive = behavior.lastIndexOf("bl5Done.listeners.click({ stopPropagation() {} });", activeMarker);
const firstClear = behavior.indexOf("bubblingClick(bl5ChipFor('BL5-A'))", activeMarker);
check(bothActive >= 0 && activeMarker > bothActive && firstClear > activeMarker,
  'BL5B-SENTINEL-ACTIVE-ORDER: second render occurs while the first widget remains filtered');

check(pkg.scripts?.['test:graph-view-contract'] === 'node platform/test/run-graph-view-contract.js',
  'BL5B-SENTINEL-REGISTRY: focused contract script is registered');
check(((pkg.scripts?.['release:preflight'] || '').match(/run-graph-view-contract\.js/g) || []).length === 1,
  'BL5B-SENTINEL-PREFLIGHT: release preflight invokes this sentinel exactly once');

if (failures.length) {
  for (const failure of failures) console.error(`FAIL — ${failure}`);
  process.exit(1);
}
console.log('PASS — GraphView BL-5b contract sentinel');
