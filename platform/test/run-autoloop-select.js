#!/usr/bin/env node
/**
 * run-autoloop-select — preflight harness for the Sauce Autoloop deterministic
 * helpers (scripts/autoloop/select-card.js). Zero-dep.
 * (render-handoff cases are added in a later commit.)
 */
'use strict';
const path = require('path');
const { isBroadScope, parseBoard, recommendedFrom, selectCard } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'select-card.js'));
const { renderHandoff } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'render-handoff.js'));

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}

// ---- isBroadScope (AB-*) ----
ok('AB-1 "audit the project blueprint" is broad', isBroadScope('audit the project blueprint').broad === true);
ok('AB-2 "redesign navigation" is broad', isBroadScope('Redesign navigation').broad === true);
ok('AB-3 "fix breadcrumb paren bug" is NOT broad', isBroadScope('fix breadcrumb paren bug').broad === false);
ok('AB-4 empty text is NOT broad', isBroadScope('').broad === false);
ok('AB-5 >1200 char body is broad', isBroadScope('x'.repeat(1300)).broad === true);

// ---- parseBoard + recommendedFrom (PB-*) ----
const BOARD = [
  '# Sauce Board', '',
  '## In Planning', '- [ ] [[Fix breadcrumb paren]]', '- [ ] [[Add render harness|harness]]', '',
  '## In Progress', '',
  '## Blocked', '- [ ] [[Wiki area redesign]]', '',
  '## Completed', '- [[Old card]] — v0.135.0', '',
].join('\n');
const cols = parseBoard(BOARD);
ok('PB-1 In Planning has 2 cards', cols['In Planning'].length === 2, JSON.stringify(cols['In Planning']));
ok('PB-2 parses plain wikilink', cols['In Planning'][0] === 'Fix breadcrumb paren');
ok('PB-3 strips alias', cols['In Planning'][1] === 'Add render harness');
ok('PB-4 In Progress empty', cols['In Progress'].length === 0);
ok('PB-5 Blocked has 1', cols['Blocked'].length === 1);
ok('PB-6 recommendedFrom finds card', recommendedFrom('## Recommended next\n- **Card:** [[Add render harness]]') === 'Add render harness');
ok('PB-7 recommendedFrom null when absent', recommendedFrom('## Board snapshot\nnothing') === null);

// ---- selectCard (SC-*) ----
const bodies = {
  'Fix breadcrumb paren': 'Small render fix for a stray paren.',
  'Add render harness': 'Add a behavioral harness for X.',
  'Wiki area redesign': 'Redesign the entire wiki area across all blueprints.',
};
const loadBody = (c) => bodies[c] || '';
ok('SC-1 halt wins', selectCard({ haltExists: true, boardMd: BOARD, loadBody }).action === 'halt');
ok('SC-2 in-progress -> needs-attention',
  selectCard({ boardMd: BOARD.replace('## In Progress', '## In Progress\n- [ ] [[Busy card]]'), loadBody }).action === 'needs-attention');
ok('SC-3 empty planning -> no-work',
  selectCard({ boardMd: '## In Planning\n\n## In Progress\n', loadBody }).action === 'no-work');
const pick = selectCard({ boardMd: BOARD, loadBody });
ok('SC-4 picks first in-scope planning card', pick.action === 'work' && pick.card === 'Fix breadcrumb paren', JSON.stringify(pick));
const recPick = selectCard({ boardMd: BOARD, handoffMd: '## Recommended next [[Add render harness]]', loadBody });
ok('SC-5 recommendation-first', recPick.action === 'work' && recPick.card === 'Add render harness');
const broadBoard = '## In Planning\n- [ ] [[Wiki area redesign]]\n- [ ] [[Fix breadcrumb paren]]\n## In Progress\n';
const skipPick = selectCard({ boardMd: broadBoard, loadBody });
ok('SC-6 skips broad card, picks next', skipPick.action === 'work' && skipPick.card === 'Fix breadcrumb paren' && skipPick.skipped.length === 1);
const allBroad = '## In Planning\n- [ ] [[Wiki area redesign]]\n## In Progress\n';
ok('SC-7 all broad -> no-eligible-work', selectCard({ boardMd: allBroad, loadBody }).action === 'no-eligible-work');

// ---- renderHandoff (RH-*) ----
const ho = renderHandoff({
  roundN: 7, date: '2026-06-27', mode: 'dry-run',
  outcome: { action: 'work', card: 'Fix breadcrumb paren' },
  board: parseBoard(BOARD),
  recommendedNext: 'Add render harness',
});
ok('RH-1 has title with round', /Sauce Autoloop Turn 7/.test(ho));
ok('RH-2 names the card', ho.includes('Fix breadcrumb paren'));
ok('RH-3 marks dry-run', /dry-run/i.test(ho));
ok('RH-4 lists In Planning section', ho.includes('### In Planning'));
ok('RH-5 carries recommended next', ho.includes('Add render harness'));

console.log('');
console.log(`Tests: ${pass}/${pass + fail}`);
if (fail > 0) { console.log('Failures:'); for (const f of failures) console.log(`  ${f}`); process.exit(1); }
process.exit(0);
