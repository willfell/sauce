#!/usr/bin/env node
/**
 * run-autoloop-select — preflight harness for the Sauce Autoloop deterministic
 * helpers (scripts/autoloop/select-card.js). Zero-dep.
 * (render-handoff cases are added in a later commit.)
 */
'use strict';
const path = require('path');
const { isBroadScope, parseBoard, recommendedFrom, selectCard, parsePlanningChecked, parseDependsOn, parseQueue, selectFromQueue, stripCardChrome } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'select-card.js'));
const { renderHandoff } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'render-handoff.js'));
const { reconcileInFlight, slugFromRef, nextLedger } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'reconcile-inflight.js'));
const { lockState, pidAlive } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'turn-lock.js'));
const { coverageGapItems, docDriftItems, landmineGuardGapItems } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'scout-signals.js'));
const { splitDiff, adequacyVerdict, gateVerdict, runAdequacyCheck } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'gate.js'));
const { renderBlockedSection, parseBlockedResponse } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'block-note.js'));
const { candidateId, filterCandidates, toQueueBlocks, nextArea, AREAS } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'bughunt.js'));
const { parseLane, syncLane, laneLine, dismissInQueue, LANE } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'board-mirror.js'));
const { cmpVersion, deployPlan, verifyDeploy } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'deploy.js'));

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
ok('SC-6 broad-looking board card is PICKED (attempt-anything) with a broadHint',
  skipPick.action === 'work' && skipPick.card === 'Wiki area redesign' && !!skipPick.broadHint);
const allBroad = '## In Planning\n- [ ] [[Wiki area redesign]]\n## In Progress\n';
ok('SC-7 broad-only board still returns work (no pre-filter)', selectCard({ boardMd: allBroad, loadBody }).action === 'work');

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

// ---- depends_on dependency gate (DEP-*) ----
ok('DEP-1 parseDependsOn reads every YAML shape (inline/flow/block/alias/bare)',
  JSON.stringify(parseDependsOn('---\ndepends_on: "[[Slice 2]]"\n---')) === '["Slice 2"]'
  && JSON.stringify(parseDependsOn('---\ndepends_on: [[A]]\n---')) === '["A"]'
  && JSON.stringify(parseDependsOn('---\ndepends_on: Slice 2\n---')) === '["Slice 2"]'
  && JSON.stringify(parseDependsOn('---\ndepends_on: ["[[A]]", "[[B]]"]\n---')) === '["A","B"]'
  && JSON.stringify(parseDependsOn('---\ndepends_on:\n  - "[[A]]"\n  - B\n---')) === '["A","B"]'
  && JSON.stringify(parseDependsOn('---\ndepends_on: "[[Slice 2|alias]]"\n---')) === '["Slice 2"]'
  && JSON.stringify(parseDependsOn('---\ntype: card\n---')) === '[]');
// A depends-chain board: A done, B depends A, C depends B.
const depBodies = {
  A: '---\ntype: card\n---\ndo A',
  B: '---\ndepends_on: "[[A]]"\n---\ndo B',
  C: '---\ndepends_on: "[[B]]"\n---\ndo C',
};
const depLoad = (c) => depBodies[c] || '';
const depBoard = '## In Planning\n- [ ] [[B]]\n- [ ] [[C]]\n## Completed\n- [x] [[A]]\n';
const depPick = selectCard({ boardMd: depBoard, loadBody: depLoad });
ok('DEP-2 card whose dep is Completed is eligible; the next (unmet) is skipped',
  depPick.action === 'work' && depPick.card === 'B'
  && (depPick.skipped || []).every((s) => s.card !== 'B'), JSON.stringify(depPick));
const cOnly = selectCard({ boardMd: '## In Planning\n- [ ] [[C]]\n## Completed\n- [x] [[A]]\n', loadBody: depLoad });
ok('DEP-3 card blocked by an unmet dependency → no-eligible-work (never runs early)',
  cOnly.action === 'no-eligible-work' && /depends_on not complete: B/.test((cOnly.skipped || []).map((s) => s.reason).join('|')),
  JSON.stringify(cOnly));
// Only a DIRECT dep in Completed satisfies — B being eligible does NOT satisfy C.
const bAndC = '## In Planning\n- [ ] [[B]]\n- [ ] [[C]]\n## Completed\n- [x] [[A]]\n';
const bc = selectCard({ boardMd: bAndC, loadBody: depLoad });
ok('DEP-4 satisfaction is Completed-gated, not recursive (picks B, not C)', bc.card === 'B');
// The whole chain sits in Planning; only the head (A, no deps) is picked.
const chainBoard = '## In Planning\n- [ ] [[A]]\n- [ ] [[B]]\n- [ ] [[C]]\n## Completed\n';
ok('DEP-5 full chain in Planning → picks the dependency-free head first',
  selectCard({ boardMd: chainBoard, loadBody: depLoad }).card === 'A');
// The dependency gate applies to the handoff-recommended card too.
const recBlocked = selectCard({
  boardMd: '## In Planning\n- [ ] [[B]]\n## Completed\n',
  handoffMd: '## Recommended next\n[[B]]',
  loadBody: depLoad,
});
ok('DEP-6 an unmet dep blocks even the recommended card',
  recBlocked.action === 'no-eligible-work' && /depends_on not complete: A/.test((recBlocked.skipped || []).map((s) => s.reason).join('|')),
  JSON.stringify(recBlocked));

// ---- stripCardChrome (SCH-*) — scope heuristic must measure task body, not chrome ----
const CHROME = '---\nkey: value\nstatus: in-planning\n---\n\n```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });\n```\n\n---\n\nFix the separator between Open Tasks and Meetings.';
ok('SCH-1 strips frontmatter', !stripCardChrome(CHROME).includes('status: in-planning'));
ok('SCH-2 strips dataviewjs fenced block', !stripCardChrome(CHROME).includes('customjs-guard'));
ok('SCH-3 keeps the task prose', stripCardChrome(CHROME).includes('Fix the separator'));
const chromeBoard = '## In Planning\n- [ ] [[Chrome card]]\n## In Progress\n';
const chromeLoad = (c) => c === 'Chrome card' ? ('---\nx: ' + 'y'.repeat(1300) + '\n---\n```dataviewjs\ncode\n```\nFix a small styling bug.') : '';
ok('SCH-4 chrome-inflated card → broadHint null after strip (still picked)',
  (r => r.action === 'work' && r.broadHint === null)(selectCard({ boardMd: chromeBoard, loadBody: chromeLoad })));

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
// reconciled-PR ledger — a terminal PR fires exactly once, then the loop reaches idle (merged-deadlock fix):
ok('RI-10 merged PR already in ledger → idle (no re-fire)',
  reconcileInFlight({ prs: [{ headRefName: 'autoloop/fix-x', state: 'MERGED', number: 5 }], reconciled: [5] }).status === 'idle');
ok('RI-11 failed PR already in ledger → idle',
  reconcileInFlight({ prs: [{ headRefName: 'autoloop/fix-x', state: 'CLOSED', number: 5 }], reconciled: [5] }).status === 'idle');
ok('RI-12 ledger only skips the ledgered PR; a newer un-ledgered merged still fires',
  (r => r.status === 'merged' && r.number === 6)(reconcileInFlight({ prs: [
    { headRefName: 'autoloop/a', state: 'MERGED', number: 5 },
    { headRefName: 'autoloop/b', state: 'MERGED', number: 6 }], reconciled: [5] })));
ok('RI-13 ledger NEVER suppresses an OPEN PR (still pr-open even if number is ledgered)',
  reconcileInFlight({ prs: [{ headRefName: 'autoloop/fix-x', state: 'OPEN', number: 5 }], reconciled: [5] }).status === 'pr-open');
ok('RI-14 ledger does NOT suppress a bare branch (still implementing)',
  reconcileInFlight({ branches: ['autoloop/fix-x'], reconciled: [5] }).status === 'implementing');
ok('RI-15 nextLedger appends + dedups (idempotent record)',
  (a => a.length === 2 && a.includes(5) && a.includes(6))(nextLedger(nextLedger([5], 6), 5)));
ok('RI-16 nextLedger caps to the most-recent N (runaway guard, keeps newest)',
  (a => a.length === 2 && a[0] === 9 && a[1] === 10)(nextLedger([7, 8, 9], 10, 2)));
ok('RI-17 a corrupt non-array ledger is coerced to empty, never throws (fail-safe read)',
  reconcileInFlight({ prs: [{ headRefName: 'autoloop/fix-x', state: 'MERGED', number: 5 }], reconciled: 'oops' }).status === 'merged'
  && (a => a.length === 1 && a[0] === 5)(nextLedger('oops', 5)));

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
// A test-only harness addition wires itself into package.json (release:preflight)
// to run in CI; that manifest edit is NOT behavioral source, so the mutation check
// must treat the change as test-only (empty sourceFiles) rather than spuriously
// blocking. package.json + package-lock.json are excluded like docs + the queue.
const sdPkg = splitDiff(['platform/test/run-products-render-guards.js', 'package.json', 'package-lock.json', 'autoloop-queue.md']);
ok('SD-4 package.json + lockfile excluded from source (test-runner wiring is not behavioral)', sdPkg.sourceFiles.length === 0);
ok('SD-5 pure harness addition classified test-only', sdPkg.testFiles.length === 1 && sdPkg.testFiles[0] === 'platform/test/run-products-render-guards.js');
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
ok('BN-7 header string inside the reply does NOT break parsing',
  (r => r.hasResponse === true && r.response.includes('approve'))(parseBlockedResponse(blockSec + '\nYes, approve. (re the ## Autoloop — blocked, needs your input note)\n')));
ok('BN-8 re-blocked card → reads the LAST section reply',
  (r => r.hasResponse === true && r.response.includes('second reply'))(parseBlockedResponse(blockSec + '\nold reply\n' + renderBlockedSection({ date: '2026-07-01', reason: 'again', needs: ['q'] }) + '\nsecond reply\n')));
ok('BN-9 missing date/reason → no literal "undefined"', !renderBlockedSection({ needs: ['q'] }).includes('undefined'));

// ---- turn-lock (TL-*) ----
const TL_NOW = 1000000000000;
const TL_MIN = 60 * 1000;
ok('TL-1 empty lock → not present, not held',
  (s => s.present === false && s.held === false)(lockState('', TL_NOW, 30 * TL_MIN)));
ok('TL-2 fresh lock → held',
  lockState(JSON.stringify({ pid: 1, startedAt: new Date(TL_NOW - 5 * TL_MIN).toISOString() }), TL_NOW, 30 * TL_MIN).held === true);
ok('TL-3 stale lock → not held + stale',
  (s => s.held === false && s.stale === true)(lockState(JSON.stringify({ pid: 1, startedAt: new Date(TL_NOW - 31 * TL_MIN).toISOString() }), TL_NOW, 30 * TL_MIN)));
ok('TL-4 garbage lock → stale (overridable)', lockState('not json', TL_NOW, 30 * TL_MIN).stale === true);
ok('TL-5 future-skewed lock (negative age) → not held + stale',
  (s => s.held === false && s.stale === true)(lockState(JSON.stringify({ pid: 1, startedAt: new Date(TL_NOW + 10 * TL_MIN).toISOString() }), TL_NOW, 30 * TL_MIN)));
// pid-liveness override (crashed turn that never released must not wedge later turns for staleMs):
ok('TL-6 recent lock but holder pid KNOWN-dead → overridable',
  (s => s.held === false && s.stale === true && s.reason === 'holder-pid-dead')(
    lockState(JSON.stringify({ pid: 50003, startedAt: new Date(TL_NOW - 5 * TL_MIN).toISOString() }), TL_NOW, 30 * TL_MIN, false)));
ok('TL-7 recent lock + holder alive → still held (never stomp a live turn)',
  lockState(JSON.stringify({ pid: 1, startedAt: new Date(TL_NOW - 5 * TL_MIN).toISOString() }), TL_NOW, 30 * TL_MIN, true).held === true);
ok('TL-8 recent lock + liveness unknown (null) → falls back to time (held)',
  lockState(JSON.stringify({ pid: 1, startedAt: new Date(TL_NOW - 5 * TL_MIN).toISOString() }), TL_NOW, 30 * TL_MIN, null).held === true);
ok('TL-9 time-stale lock overridable even if holder pid alive (time wins)',
  lockState(JSON.stringify({ pid: 1, startedAt: new Date(TL_NOW - 31 * TL_MIN).toISOString() }), TL_NOW, 30 * TL_MIN, true).held === false);
ok('TL-10 backward-compat: 3-arg call unchanged (fresh lock held)',
  lockState(JSON.stringify({ pid: 1, startedAt: new Date(TL_NOW - 5 * TL_MIN).toISOString() }), TL_NOW, 30 * TL_MIN).held === true);
ok('TL-11 pidAlive: own pid alive; bad pids → unknown (null)',
  pidAlive(process.pid) === true && pidAlive(0) === null && pidAlive(-5) === null && pidAlive('x') === null);
// Pin the helper's core branches so ESRCH→false can't silently mutate to →null (which would re-wedge crashes):
const TL_DEAD_PID = require('child_process').spawnSync(process.execPath, ['-e', '0']).pid; // spawned, exited, reaped → gone
ok('TL-12 pidAlive: a reaped (exited) pid reads as KNOWN-dead (false)', pidAlive(TL_DEAD_PID) === false);
ok('TL-13 pidAlive: pid 1 exists (EPERM/other-owner or signalable) → alive (true)', pidAlive(1) === true);

// ---- bug-hunt (BH-*) ----
const BH_GOOD = { title: 'Off-by-one in payoff loop', file: 'platform/x.js', symptom: 'last month skipped', repro_hint: 'plan with 1 debt', fix_sketch: 'use <=', test_sketch: 'assert final month included', severity: 'high', confidence: 0.9 };
const fe = () => true; // pretend every named file exists
ok('BH-1 well-formed candidate survives',
  (r => r.survivors.length === 1 && r.rejected.length === 0)(filterCandidates({ candidates: [BH_GOOD], fileExists: fe })));
ok('BH-2 stable id from file basename + title',
  candidateId(BH_GOOD) === candidateId({ ...BH_GOOD, symptom: 'different wording' }));
ok('BH-3 missing test_sketch → rejected (cannot write a regression test)',
  (r => r.survivors.length === 0 && /test_sketch/.test(r.rejected[0].reason))(filterCandidates({ candidates: [{ ...BH_GOOD, test_sketch: '' }], fileExists: fe })));
ok('BH-4 file that does not exist → rejected',
  (r => r.survivors.length === 0 && /file missing/.test(r.rejected[0].reason))(filterCandidates({ candidates: [BH_GOOD], fileExists: () => false })));
ok('BH-5 low confidence → rejected at the floor',
  (r => r.survivors.length === 0 && /confidence/.test(r.rejected[0].reason))(filterCandidates({ candidates: [{ ...BH_GOOD, confidence: 0.3 }], fileExists: fe, minConfidence: 0.6 })));
ok('BH-6 dedup against the existing queue (any status)',
  (r => r.survivors.length === 0 && /already in queue/.test(r.rejected[0].reason))(filterCandidates({ candidates: [BH_GOOD], haveIds: [candidateId(BH_GOOD)], fileExists: fe })));
ok('BH-7 duplicate within the same batch dropped once',
  (r => r.survivors.length === 1 && r.rejected.length === 1 && /duplicate within batch/.test(r.rejected[0].reason))(filterCandidates({ candidates: [BH_GOOD, { ...BH_GOOD }], fileExists: fe })));
ok('BH-8 maxNew caps the batch',
  filterCandidates({ candidates: [BH_GOOD, { ...BH_GOOD, title: 'B', file: 'platform/b.js' }, { ...BH_GOOD, title: 'C', file: 'platform/c.js' }], fileExists: fe, maxNew: 2 }).survivors.length === 2);
ok('BH-9 queue block carries category:bug + file + folded test plan',
  (b => /category: bug/.test(b) && /file: platform\/x\.js/.test(b) && /test: assert final month included/.test(b))(toQueueBlocks(filterCandidates({ candidates: [BH_GOOD], fileExists: fe }).survivors)));
ok('BH-10 rationale stays one line even with multiline sketches',
  toQueueBlocks([{ ...BH_GOOD, id: 'x', symptom: 'line1\nline2', test_sketch: 'a\nb' }]).split('\n').filter(l => l.startsWith('  rationale:')).length === 1);
ok('BH-11 nextArea rotates deterministically by turn',
  nextArea(0).name === AREAS[0].name && nextArea(AREAS.length).name === AREAS[0].name && nextArea(1).name === AREAS[1].name);
ok('BH-12 nextArea tolerates a non-numeric turn → first area',
  nextArea('not-a-number').name === AREAS[0].name);
ok('BH-13 same basename in different dirs → distinct ids (no collision)',
  candidateId({ file: 'a/x.js', title: 'guard for null user' }) !== candidateId({ file: 'b/x.js', title: 'guard for null user' }));

// ---- board-mirror (BM-*) ----
const BM_BOARD = '# Sauce Board\n\n## In Planning\n\n- [ ] [[Real human card]]\n\n## Completed\n\n- [x] [[Old card]]\n\n## Archive\n';
const BM_Q = [
  { id: 'bug-x-foo', title: 'Foo bug', category: 'bug', source: 'bug-hunt', status: 'proposed' },
  { id: 'cov-y-bar', title: 'Cover bar', category: 'test', source: 'coverage-matrix', status: 'proposed' },
  { id: 'bug-z-done', title: 'Done bug', category: 'bug', status: 'done' },
];
ok('BM-1 open queue items added to a new Discovered lane',
  (r => /## Discovered \(autoloop\)/.test(r.boardMd) && r.added.includes('bug-x-foo') && r.added.includes('cov-y-bar'))(syncLane({ boardMd: BM_BOARD, queueItems: BM_Q })));
ok('BM-2 done/non-open items are NOT mirrored',
  !syncLane({ boardMd: BM_BOARD, queueItems: BM_Q }).boardMd.includes('bug-z-done'));
ok('BM-3 lane inserted before Completed, human columns untouched',
  (md => md.indexOf('## Discovered') < md.indexOf('## Completed') && /## In Planning\n\n- \[ \] \[\[Real human card\]\]/.test(md) && md.includes('[[Old card]]'))(syncLane({ boardMd: BM_BOARD, queueItems: BM_Q }).boardMd));
ok('BM-4 cards rendered as [[id|title]]',
  syncLane({ boardMd: BM_BOARD, queueItems: BM_Q }).boardMd.includes('[[bug-x-foo|Foo bug]]'));
ok('BM-5 idempotent — second sync is a no-op',
  (r1 => { const r2 = syncLane({ boardMd: r1.boardMd, queueItems: BM_Q }); return r2.boardMd === r1.boardMd && r2.added.length === 0; })(syncLane({ boardMd: BM_BOARD, queueItems: BM_Q })));
ok('BM-6 user-checked card → reported as dismissed + dropped from lane',
  (() => { const seeded = syncLane({ boardMd: BM_BOARD, queueItems: BM_Q }).boardMd.replace('[ ] [[bug-x-foo', '[x] [[bug-x-foo'); const r = syncLane({ boardMd: seeded, queueItems: BM_Q }); return r.dismissed.includes('bug-x-foo') && !r.boardMd.includes('bug-x-foo'); })());
ok('BM-7 item that left the queue is removed from the lane',
  (() => { const seeded = syncLane({ boardMd: BM_BOARD, queueItems: BM_Q }).boardMd; const r = syncLane({ boardMd: seeded, queueItems: [BM_Q[0]] }); return r.removed.includes('cov-y-bar') && !r.boardMd.includes('cov-y-bar') && r.boardMd.includes('bug-x-foo'); })());
ok('BM-8 parseLane reads id, title, checked state',
  (cards => cards.length === 1 && cards[0].id === 'bug-x-foo' && cards[0].title === 'Foo bug' && cards[0].checked === true)(parseLane('## Discovered (autoloop)\n\n- [x] [[bug-x-foo|Foo bug]]\n', LANE)));
ok('BM-9 title with ]] / | chars is sanitized in the lane line',
  (line => !/\]\]\s*\S*\|/.test(line.replace('[[bug-q|', '')) && line.startsWith('- [ ] [[bug-q|'))(laneLine({ id: 'bug-q', title: 'a]] b | c' })));
ok('BM-10 empty queue → lane exists but has no cards',
  (md => /## Discovered \(autoloop\)/.test(md) && !/\[\[/.test(md.split('## Discovered')[1].split('## Completed')[0]))(syncLane({ boardMd: BM_BOARD, queueItems: [] }).boardMd));
// kanban:settings trailer must survive even when the lane is the LAST column.
const BM_SETTINGS = '# Board\n\n## In Planning\n\n- [ ] [[Human]]\n\n%% kanban:settings\n```\n{"kanban-plugin":"board"}\n```\n%%';
ok('BM-11 settings trailer survives when lane is appended last',
  (md => md.includes('kanban-plugin') && md.includes('[[bug-x-foo|Foo bug]]') && md.indexOf('## Discovered') < md.indexOf('%% kanban:settings'))(syncLane({ boardMd: BM_SETTINGS, queueItems: BM_Q }).boardMd));
ok('BM-12 re-sync of a settings-trailer board is idempotent + keeps settings',
  (r1 => { const r2 = syncLane({ boardMd: r1.boardMd, queueItems: BM_Q }); return r2.boardMd === r1.boardMd && r2.boardMd.includes('kanban-plugin'); })(syncLane({ boardMd: BM_SETTINGS, queueItems: BM_Q })));
// dismissInQueue: prefix-safe + cannot cross into the next item.
const BM_DQ = '- id: bug-x\n  title: X\n  status: proposed\n\n- id: bug-x-foo\n  title: XF\n  status: proposed\n';
ok('BM-13 dismiss bug-x flips ONLY bug-x, not the prefixed bug-x-foo',
  (q => /id: bug-x\n  title: X\n  status: dismissed/.test(q) && /id: bug-x-foo\n  title: XF\n  status: proposed/.test(q))(dismissInQueue(BM_DQ, ['bug-x'])));
ok('BM-14 dismiss a status-less item does NOT flip the next item',
  (q => /id: cov-y\n  title: Y\n  status: proposed/.test(q))(dismissInQueue('- id: bug-ns\n  title: NS\n\n- id: cov-y\n  title: Y\n  status: proposed\n', ['bug-ns'])));

// ---- deploy (DP-*) ----
ok('DP-1 cmpVersion orders patch/minor/major + tolerates v-prefix',
  cmpVersion('0.145.1', '0.145.0') === 1 && cmpVersion('0.145.0', '0.146.0') === -1 && cmpVersion('v0.145.1', '0.145.1') === 0);
ok('DP-2 all vaults behind shipped → deploy all three at once',
  (p => p.action === 'deploy' && p.target === '0.146.0' && p.vaults.length === 3
    && p.vaults.includes('ero-sauce') && p.vaults.includes('accuris-sauce') && p.vaults.includes('headspace-sauce'))(
    deployPlan({ shippedVersion: '0.146.0', vaults: [{ name: 'ero-sauce', version: '0.145.1' }, { name: 'accuris-sauce', version: '0.145.1' }, { name: 'headspace-sauce', version: '0.145.1' }] })));
ok('DP-3 only the behind vaults are deployed (mixed current/behind)',
  (p => p.action === 'deploy' && p.target === '0.146.0' && p.vaults.length === 2
    && p.vaults.includes('accuris-sauce') && p.vaults.includes('headspace-sauce') && !p.vaults.includes('ero-sauce'))(
    deployPlan({ shippedVersion: '0.146.0', vaults: [{ name: 'ero-sauce', version: '0.146.0' }, { name: 'accuris-sauce', version: '0.145.1' }, { name: 'headspace-sauce', version: '0.145.1' }] })));
ok('DP-4 all current → no action',
  deployPlan({ shippedVersion: '0.146.0', vaults: [{ name: 'ero-sauce', version: '0.146.0' }, { name: 'accuris-sauce', version: '0.146.0' }, { name: 'headspace-sauce', version: '0.146.0' }] }).action === 'none');
ok('DP-5 a single behind vault is deployed alone',
  (p => p.action === 'deploy' && p.vaults.length === 1 && p.vaults[0] === 'headspace-sauce')(
    deployPlan({ shippedVersion: '0.147.0', vaults: [{ name: 'ero-sauce', version: '0.147.0' }, { name: 'accuris-sauce', version: '0.147.0' }, { name: 'headspace-sauce', version: '0.146.0' }] })));
ok('DP-6 a vault with no installed version reads as behind and is included',
  (p => p.action === 'deploy' && p.vaults.length === 1 && p.vaults[0] === 'accuris-sauce')(
    deployPlan({ shippedVersion: '0.146.0', vaults: [{ name: 'ero-sauce', version: '0.146.0' }, { name: 'accuris-sauce', version: '' }, { name: 'headspace-sauce', version: '0.146.0' }] })));
ok('DP-7 fresh (all empty) → deploy all three to the shipped target',
  (p => p.action === 'deploy' && p.target === '0.146.0' && p.vaults.length === 3)(
    deployPlan({ shippedVersion: '0.146.0', vaults: [{ name: 'ero-sauce', version: '' }, { name: 'accuris-sauce', version: '' }, { name: 'headspace-sauce', version: '' }] })));
ok('DP-8 no shipped version → no action (fail-safe)',
  deployPlan({ shippedVersion: '', vaults: [{ name: 'ero-sauce', version: '0.145.1' }] }).action === 'none');
ok('DP-9 verifyDeploy ok only when installed matches target',
  verifyDeploy({ target: '0.146.0', installed: '0.146.0' }).ok === true && verifyDeploy({ target: '0.146.0', installed: '0.145.1' }).ok === false && verifyDeploy({ target: '0.146.0', installed: '' }).ok === false);
ok('DP-10 cmpVersion is numeric not lexical (0.9.0 < 0.10.0); unequal length compares + treats trailing zero as equal',
  cmpVersion('0.9.0', '0.10.0') === -1 && cmpVersion('0.145', '0.145.1') === -1 && cmpVersion('0.146.1', '0.146') === 1 && cmpVersion('0.146.0', '0.146') === 0);

console.log('');
console.log(`Tests: ${pass}/${pass + fail}`);
if (fail > 0) { console.log('Failures:'); for (const f of failures) console.log(`  ${f}`); process.exit(1); }
process.exit(0);
