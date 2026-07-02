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

// ── _splitDaily: pull the daily quick-nav entry out of the menu list ──
const inst2 = new SpaceNavButtons();
// (a) identify by action.command_id === 'daily-notes'
const byCmd = inst2._splitDaily([
  { id: 'p', label: 'Projects', _source: 'project', action: { type: 'openLink', target: 'P.md' } },
  { id: 'd', label: 'Daily', _source: 'daily', action: { type: 'invoke_command', command_id: 'daily-notes' } },
  { id: 't', label: 'To Do', _source: 'to-do', action: { type: 'openLink', target: 'T.md' } },
]);
ok('NL-6 pulls the daily entry out (command_id daily-notes)', byCmd.dailyEntry && byCmd.dailyEntry.id === 'd');
ok('NL-7 menuEntries excludes the daily entry, keeps order', byCmd.menuEntries.length === 2 && byCmd.menuEntries[0].id === 'p' && byCmd.menuEntries[1].id === 't');
// (b) no daily entry → dailyEntry null, menuEntries === all
const none = inst2._splitDaily([{ id: 'p', label: 'Projects', _source: 'project', action: { type: 'openLink' } }]);
ok('NL-8 no daily → dailyEntry null, all entries in menu', none.dailyEntry === null && none.menuEntries.length === 1);
// (c) fallback identify by _source === 'daily' when command_id absent
const bySource = inst2._splitDaily([{ id: 'd2', label: 'Daily', _source: 'daily', action: {} }]);
ok('NL-9 identifies daily by _source when command_id absent', bySource.dailyEntry && bySource.dailyEntry.id === 'd2' && bySource.menuEntries.length === 0);

console.log(`\n  ${pass} pass · ${fail} fail`);
process.exit(fail ? 1 : 0);
