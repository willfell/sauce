'use strict';
// Zero-dep harness for SpaceNavButtons pure logic (entry order + daily split).
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'mechanisms', 'nav-buttons', 'space-nav-buttons.js'),
  'utf8'
);
// Load the bare class expression the same way customJS does, then hand back the ctor.
const SpaceNavButtons = new Function(`return (${SRC});`)();

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  PASS: ${name}`); } else { fail++; console.log(`  FAIL: ${name}`); } };

// ── _orderedEntries: flatten contributions + sort by (order, source, id) ──
const inst = new SpaceNavButtons();
const registry = {
  contributions: {
    zeta: [{ id: 'z1', label: 'Zeta', icon: 'board', order: 100, action: { type: 'openLink', target: 'Z.md' } }],
    alpha: [
      { id: 'a2', label: 'Alpha2', icon: 'daily', order: 50, action: { type: 'openLink', target: 'A2.md' } },
      { id: 'a1', label: 'Alpha1', icon: 'todo', order: 50, action: { type: 'openLink', target: 'A1.md' } },
    ],
  },
};
const ordered = inst._orderedEntries(registry);
ok('NL-1 flattens all contributions', ordered.length === 3);
ok('NL-2 sorts by order first (a2/a1 before z1)', ordered[2].id === 'z1');
ok('NL-3 tie on order → source then id (a1 before a2)', ordered[0].id === 'a1' && ordered[1].id === 'a2');
ok('NL-4 carries _source tag', ordered[0]._source === 'alpha');
ok('NL-5 empty/absent contributions → []', inst._orderedEntries({}).length === 0 && inst._orderedEntries({ contributions: {} }).length === 0);

// ── _partitionEntries: fixed pinned quick-nav set (by _source order) + rest ──
const inst2 = new SpaceNavButtons();
// Registry-ish ordered entries across many sources (order sort already applied).
const all = [
  { id: 'd',  label: 'Daily',    _source: 'daily',    action: { type: 'invoke_command', command_id: 'daily-notes' } },
  { id: 'co', label: 'Cowork',   _source: 'cowork',   action: { type: 'openLink', target: 'C.md' } },
  { id: 'pe', label: 'People',   _source: 'people',   action: { type: 'openLink', target: 'Pe.md' } },
  { id: 't',  label: 'To Do',    _source: 'to-do',    action: { type: 'openLink', target: 'T.md' } },
  { id: 'me', label: 'Meetings', _source: 'meetings', action: { type: 'openLink', target: 'M.md' } },
  { id: 'sc', label: 'Scratch',  _source: 'scratch',  action: { type: 'openLink', target: 'S.md' } },
  { id: 'w',  label: 'Wiki',     _source: 'wiki',     action: { type: 'openLink', target: 'W.md' } },
  { id: 'pr', label: 'Projects', _source: 'project',  action: { type: 'openLink', target: 'P.md' } },
];
const part = inst2._partitionEntries(all);
// pinned in the FIXED source order: daily, to-do, scratch, project, meetings.
ok('NL-6 pins exactly the 5 fixed sources', part.pinned.length === 5);
ok('NL-7 pinned are in fixed source order (daily,to-do,scratch,project,meetings)',
  part.pinned.map(e => e._source).join(',') === 'daily,to-do,scratch,project,meetings');
ok('NL-8 rest = everything else, original order preserved',
  part.rest.map(e => e.id).join(',') === 'co,pe,w');
// Absent pinned source simply drops its cell; extra entries per source → rest.
const partial = inst2._partitionEntries([
  { id: 'd',  label: 'Daily',   _source: 'daily',   action: {} },
  { id: 'x',  label: 'X',       _source: 'other',   action: {} },
  { id: 'd2', label: 'Daily 2', _source: 'daily',   action: {} }, // second daily → rest
]);
ok('NL-9 missing pins drop out; only first-per-source pins; extras → rest',
  partial.pinned.length === 1 && partial.pinned[0].id === 'd'
  && partial.rest.map(e => e.id).join(',') === 'x,d2');

console.log(`\n  ${pass} pass · ${fail} fail`);
process.exit(fail ? 1 : 0);
