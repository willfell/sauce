#!/usr/bin/env node
/**
 * run-autoloop-select — preflight harness for the Sauce Autoloop deterministic
 * helpers (scripts/autoloop/select-card.js). Zero-dep.
 * (render-handoff cases are added in a later commit.)
 */
'use strict';
const path = require('path');
const { isBroadScope, parseBoard, recommendedFrom, selectCard, parsePlanningChecked, parseQueue, selectFromQueue, stripCardChrome } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'select-card.js'));
const { renderHandoff } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'render-handoff.js'));
const { reconcileInFlight, slugFromRef } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'reconcile-inflight.js'));
const { coverageGapItems, docDriftItems, landmineGuardGapItems } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'scout-signals.js'));
const { splitDiff, adequacyVerdict, gateVerdict, runAdequacyCheck } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'gate.js'));
const { renderBlockedSection, parseBlockedResponse } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'block-note.js'));

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
ok('AB-5 >2500 char body is broad', isBroadScope('x'.repeat(3000)).broad === true);

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
ok('SC-2 parked In Progress does NOT block a Planning pick',
  selectCard({ boardMd: BOARD.replace('## In Progress', '## In Progress\n- [ ] [[Parked workstream]]'), loadBody }).action === 'work');
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

// ---- parsePlanningChecked + checked-skip (PC-*, SC-8) ----
ok('PC-1 finds an [x]-checked Planning card',
  parsePlanningChecked('## In Planning\n- [x] [[Done card]]\n- [ ] [[Active]]\n## In Progress\n').has('Done card'));
ok('PC-2 unchecked card not in the set',
  parsePlanningChecked('## In Planning\n- [ ] [[Active]]\n').has('Active') === false);
ok('PC-3 checked card in In Progress is NOT Planning-checked',
  parsePlanningChecked('## In Planning\n\n## In Progress\n- [x] [[Elsewhere]]\n').has('Elsewhere') === false);
const checkedBoard = '## In Planning\n- [x] [[Done card]]\n- [ ] [[Fix breadcrumb paren]]\n## In Progress\n';
ok('SC-8 skips [x]-checked Planning card, picks next',
  selectCard({ boardMd: checkedBoard, loadBody }).card === 'Fix breadcrumb paren');
const allChecked = '## In Planning\n- [x] [[Done one]]\n- [x] [[Done two]]\n## In Progress\n';
ok('SC-9 all-checked Planning → no-eligible-work',
  selectCard({ boardMd: allChecked, loadBody }).action === 'no-eligible-work');

// ---- stripCardChrome (SCH-*) — scope heuristic must measure task body, not chrome ----
const CHROME = '---\nkey: value\nstatus: in-planning\n---\n\n```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });\n```\n\n---\n\nFix the separator between Open Tasks and Meetings.';
ok('SCH-1 strips frontmatter', !stripCardChrome(CHROME).includes('status: in-planning'));
ok('SCH-2 strips dataviewjs fenced block', !stripCardChrome(CHROME).includes('customjs-guard'));
ok('SCH-3 keeps the task prose', stripCardChrome(CHROME).includes('Fix the separator'));
const chromeBoard = '## In Planning\n- [ ] [[Chrome card]]\n## In Progress\n';
const chromeLoad = (c) => c === 'Chrome card' ? ('---\nx: ' + 'y'.repeat(1300) + '\n---\n```dataviewjs\ncode\n```\nFix a small styling bug.') : '';
ok('SCH-4 chrome-inflated card eligible after strip (would be skipped raw)',
  selectCard({ boardMd: chromeBoard, loadBody: chromeLoad }).action === 'work');

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

// ---- reconcileInFlight (RI-*) ----
ok('RI-1 slugFromRef strips local prefix', slugFromRef('autoloop/fix-x') === 'fix-x');
ok('RI-2 slugFromRef strips remote prefix', slugFromRef('origin/autoloop/fix-x') === 'fix-x');
ok('RI-3 idle when nothing in flight', reconcileInFlight({}).status === 'idle');
ok('RI-4 open PR → pr-open/wait',
  (r => r.status === 'pr-open' && r.nextAction === 'wait' && r.card === 'fix-x')
  (reconcileInFlight({ prs: [{ headRefName: 'autoloop/fix-x', state: 'OPEN', number: 5 }] })));
ok('RI-5 bare branch → implementing/resume-or-clean',
  (r => r.status === 'implementing' && r.nextAction === 'resume-or-clean' && r.card === 'fix-x')
  (reconcileInFlight({ branches: ['autoloop/fix-x'] })));
ok('RI-6 merged PR → merged/close-card',
  (r => r.status === 'merged' && r.nextAction === 'close-card')
  (reconcileInFlight({ prs: [{ headRefName: 'autoloop/fix-x', state: 'MERGED', number: 5 }] })));
ok('RI-7 closed PR → failed/block-card',
  (r => r.status === 'failed' && r.nextAction === 'block-card')
  (reconcileInFlight({ prs: [{ headRefName: 'autoloop/fix-x', state: 'CLOSED', number: 5 }] })));
ok('RI-8 open beats older merged (most recent by number)',
  reconcileInFlight({ prs: [
    { headRefName: 'autoloop/a', state: 'MERGED', number: 4 },
    { headRefName: 'autoloop/b', state: 'OPEN', number: 5 }] }).card === 'b');
ok('RI-9 branch whose PR merged is NOT bare (→ merged, not implementing)',
  reconcileInFlight({ branches: ['autoloop/fix-x'],
    prs: [{ headRefName: 'autoloop/fix-x', state: 'MERGED', number: 5 }] }).status === 'merged');

// ---- parseQueue + selectFromQueue (Q-*, SQ-*) ----
const QUEUE = [
  '# Autoloop queue', '',
  '- id: cov-blueprint-cowork-customjs_behavioral',
  '  title: Add coverage for cowork customjs_behavioral (0/9)',
  '  category: test', '  source: coverage-matrix', '  rationale: 9 uncovered', '  status: proposed', '',
  '- id: doc-drift-readme-foo',
  '  title: Fix broken link "foo.md" in README.md',
  '  category: doc', '  source: doc-drift', '  rationale: link does not resolve', '  status: done', '',
].join('\n');
const q = parseQueue(QUEUE);
ok('Q-1 parses two items', q.length === 2, JSON.stringify(q.map(i => i.id)));
ok('Q-2 captures fields', q[0].id === 'cov-blueprint-cowork-customjs_behavioral' && q[0].category === 'test' && q[0].status === 'proposed');
ok('Q-3 captures status done', q[1].status === 'done');
ok('Q-4 empty/garbage → []', parseQueue('# Autoloop queue\n\nnothing here').length === 0);
ok('SQ-1 picks the open proposed item',
  (r => r.action === 'work' && r.card === 'cov-blueprint-cowork-customjs_behavioral' && r.fromQueue === true)
  (selectFromQueue({ queueMd: QUEUE })));
ok('SQ-2 skips done items',
  selectFromQueue({ queueMd: QUEUE, shippedIds: [] }).card !== 'doc-drift-readme-foo');
ok('SQ-3 dedup via shippedIds → no-work',
  selectFromQueue({ queueMd: QUEUE, shippedIds: ['cov-blueprint-cowork-customjs_behavioral'] }).action === 'no-work');
ok('SQ-4 empty queue → no-work',
  selectFromQueue({ queueMd: '# Autoloop queue\n' }).action === 'no-work');
ok('SQ-5 broad-scope queue item skipped → no-eligible-work',
  selectFromQueue({ queueMd: '- id: x\n  title: Audit everything redesign\n  status: proposed\n' }).action === 'no-eligible-work');

// ---- scout-signals detectors (SS-*) ----
const COV = { entries: [
  { kind: 'blueprint', name: 'cowork', axes: { customjs_behavioral: { covered: 0, total: 9 }, install: { covered: 3, total: 3 } } },
  { kind: 'mechanism', name: 'nav-buttons', axes: { customjs_behavioral: { covered: 2, total: 4 } } },
] };
const covItems = coverageGapItems(COV);
ok('SS-1 coverage gap detected for uncovered axis', covItems.some(i => i.id === 'cov-blueprint-cowork-customjs-behavioral' && i.category === 'test'));
ok('SS-2 fully-covered axis is NOT proposed', !covItems.some(i => i.id.includes('install')));
const DOCS = [{ path: 'Docs/a.md', content: 'see [good](b.md) and [bad](missing.md)' }];
const exists = (target) => target === 'b.md';
const ddItems = docDriftItems(DOCS, exists);
ok('SS-3 broken md link proposed', ddItems.some(i => i.category === 'doc' && i.title.includes('missing.md')));
ok('SS-4 resolving link NOT proposed', !ddItems.some(i => i.title.includes('b.md')));
const LM = '### 1. First trap\nbody\n### 7. Guarded trap\nbody\n';
const hasGuard = (n) => n === '7';
const lmItems = landmineGuardGapItems(LM, hasGuard);
ok('SS-5 unguarded landmine proposed', lmItems.some(i => i.id === 'landmine-1-guard'));
ok('SS-6 guarded landmine NOT proposed', !lmItems.some(i => i.id === 'landmine-7-guard'));

// ---- splitDiff (SD-*) ----
const sd = splitDiff(['scripts/autoloop/select-card.js', 'platform/test/run-foo.js', 'Docs/x.md', 'autoloop-queue.md']);
ok('SD-1 test file classified', sd.testFiles.length === 1 && sd.testFiles[0] === 'platform/test/run-foo.js');
ok('SD-2 source file classified', sd.sourceFiles.length === 1 && sd.sourceFiles[0] === 'scripts/autoloop/select-card.js');
ok('SD-3 docs + queue excluded from source', !sd.sourceFiles.some(f => /\.md$/.test(f) || f === 'autoloop-queue.md'));
// ---- adequacyVerdict (AV-*) ----
ok('AV-1 no test → inadequate', adequacyVerdict({ hasTest: false }).adequate === false);
ok('AV-2 passes without source → inadequate', adequacyVerdict({ hasTest: true, redWithoutSource: false, greenWithSource: true }).adequate === false);
ok('AV-3 fails with source → inadequate', adequacyVerdict({ hasTest: true, redWithoutSource: true, greenWithSource: false }).adequate === false);
ok('AV-4 red-without + green-with → adequate', adequacyVerdict({ hasTest: true, redWithoutSource: true, greenWithSource: true }).adequate === true);
// ---- gateVerdict (GV-*) ----
const adq = { adequate: true, reason: 'ok' };
ok('GV-1 inadequate → block regardless of votes', gateVerdict({ adequacy: { adequate: false, reason: 'x' }, votes: [{ refuted: false }, { refuted: false }, { refuted: false }] }).gate === 'block');
ok('GV-2 adequate + 0 refutes → pass', gateVerdict({ adequacy: adq, votes: [{ refuted: false }, { refuted: false }, { refuted: false }] }).gate === 'pass');
ok('GV-3 adequate + 1 refute → pass', gateVerdict({ adequacy: adq, votes: [{ refuted: true }, { refuted: false }, { refuted: false }] }).gate === 'pass');
ok('GV-4 adequate + 2 refutes → block', gateVerdict({ adequacy: adq, votes: [{ refuted: true }, { refuted: true }, { refuted: false }] }).gate === 'block');
ok('GV-5 null verdict counts as refuted', gateVerdict({ adequacy: adq, votes: [null, { refuted: true }, { refuted: false }] }).gate === 'block');
ok('GV-6 empty panel → block (fail-closed)', gateVerdict({ adequacy: adq, votes: [] }).gate === 'block');
ok('GV-7 short panel (<3 verdicts) → block', gateVerdict({ adequacy: adq, votes: [{ refuted: false }, { refuted: false }] }).gate === 'block');
// ---- runAdequacyCheck (RA-*) ----
const order = [];
ok('RA-1 doc/test-only → behavioral:false adequate',
  runAdequacyCheck({ paths: ['Docs/x.md', 'platform/test/run-foo.js'], runTest: () => true, mutate: () => {} }).behavioral === false);
ok('RA-2 source but no test → inadequate',
  runAdequacyCheck({ paths: ['scripts/a.js'], runTest: () => true, mutate: () => {} }).adequate === false);
ok('RA-3 red-without + green-with → adequate',
  runAdequacyCheck({ paths: ['scripts/a.js', 'platform/test/run-foo.js'],
    mutate: (action) => order.push(action),
    runTest: () => order[order.length - 1] === 'restore' }).adequate === true);
ok('RA-4 restores on runTest throw (fail-closed)',
  (() => { const seen = []; const r = runAdequacyCheck({ paths: ['scripts/a.js', 'platform/test/run-foo.js'],
    mutate: (a) => seen.push(a), runTest: () => { throw new Error('boom'); } });
    return r.adequate === false && seen.filter(x => x === 'restore').length >= 1; })());

// ---- block-note (BN-*) ----
const blockSec = renderBlockedSection({ date: '2026-06-30', reason: 'convention conflict', needs: ['change the convention or drop the ask?', 'specify the target behavior'] });
ok('BN-1 section has the reason', blockSec.includes('convention conflict'));
ok('BN-2 section lists the needs', blockSec.includes('specify the target behavior'));
ok('BN-3 section has the response marker', blockSec.includes('**Your response:**'));
ok('BN-4 no section → hasSection false', parseBlockedResponse('just a normal card body').hasSection === false);
ok('BN-5 section + empty response → hasResponse false', parseBlockedResponse(blockSec).hasResponse === false);
const blockReplied = blockSec + '\nLet us change the convention — allow the separator here.\n';
ok('BN-6 section + reply → hasResponse true + text',
  (r => r.hasResponse === true && r.response.includes('change the convention'))(parseBlockedResponse(blockReplied)));

console.log('');
console.log(`Tests: ${pass}/${pass + fail}`);
if (fail > 0) { console.log('Failures:'); for (const f of failures) console.log(`  ${f}`); process.exit(1); }
process.exit(0);
