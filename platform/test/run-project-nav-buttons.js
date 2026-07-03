#!/usr/bin/env node
/**
 * run-project-nav-buttons.js — ProjectNavButtons pure-logic regression guard.
 *
 * Task WS3 (nav-button consolidation): the project nav row now splits its built
 * buttons into a `core` row (Task / project name / Project Board / Docs) and an
 * `overflow` set (Map / To-Do / Helpful Links) that lives behind a "More" menu.
 *
 * `_partitionButtons(buttons)` is the pure classifier that drives that split.
 * These cases lock its contract so a revert of the source (label matching or
 * order preservation) turns this harness red without needing to stub the full
 * Obsidian render path.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}

const ProjectNavButtons = loadClass(
  'platform/blueprints/project/helpers/project-nav-buttons.js',
  'ProjectNavButtons'
);

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const labels = (arr) => arr.map((b) => b.label);
const eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const inst = new ProjectNavButtons();

// PNB-1 — canonical build order splits into the expected core + overflow.
{
  const built = [
    { label: 'Task: Foo' },
    { label: 'MyProj' },
    { label: 'Project Board' },
    { label: 'Docs' },
    { label: 'Map' },
    { label: 'To-Do' },
    { label: 'Helpful Links' },
  ];
  const { core, overflow } = inst._partitionButtons(built);
  ok('PNB-1a core = [Task, MyProj, Project Board, Docs] (input order)',
    eqArr(labels(core), ['Task: Foo', 'MyProj', 'Project Board', 'Docs']));
  ok('PNB-1b overflow = [Map, To-Do, Helpful Links] (input order)',
    eqArr(labels(overflow), ['Map', 'To-Do', 'Helpful Links']));
}

// PNB-2 — overflow-empty: only core buttons present → overflow.length === 0.
{
  const built = [
    { label: 'MyProj' },
    { label: 'Project Board' },
    { label: 'Docs' },
  ];
  const { core, overflow } = inst._partitionButtons(built);
  ok('PNB-2a overflow empty when no Map/To-Do/Links', overflow.length === 0);
  ok('PNB-2b core keeps all three in order',
    eqArr(labels(core), ['MyProj', 'Project Board', 'Docs']));
}

// PNB-3 — only-overflow: core empty when every button is an overflow label.
{
  const built = [
    { label: 'Map' },
    { label: 'To-Do' },
    { label: 'Helpful Links' },
  ];
  const { core, overflow } = inst._partitionButtons(built);
  ok('PNB-3a core empty when all buttons are overflow labels', core.length === 0);
  ok('PNB-3b overflow keeps all three in input order',
    eqArr(labels(overflow), ['Map', 'To-Do', 'Helpful Links']));
}

// PNB-4 — exact-label match only: a button whose label merely CONTAINS an
// overflow token (e.g. "To-Do List" or "Sitemap") stays in core.
{
  const built = [
    { label: 'Sitemap' },
    { label: 'To-Do List' },
    { label: 'Map' },
  ];
  const { core, overflow } = inst._partitionButtons(built);
  ok('PNB-4a near-miss labels stay in core',
    eqArr(labels(core), ['Sitemap', 'To-Do List']));
  ok('PNB-4b only the exact "Map" overflows',
    eqArr(labels(overflow), ['Map']));
}

// PNB-5 — empty input → both empty (defensive).
{
  const { core, overflow } = inst._partitionButtons([]);
  ok('PNB-5 empty input yields empty core + overflow',
    core.length === 0 && overflow.length === 0);
}

const failed = results.filter(([, c]) => !c);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.error(`FAILED: ${failed.map(([n]) => n).join(', ')}`); process.exit(1); }
