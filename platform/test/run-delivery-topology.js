'use strict';
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const topo = require('../mechanisms/delivery/scripts/delivery-topology');

let count = 0;
const ok = (c, m) => { assert.ok(c, m); count += 1; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); count += 1; };
const throws = (fn, re, m) => { assert.throws(fn, re, m); count += 1; };

// physicalProjectPrefix: a canonical cards root resolves to one project prefix.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'topo-'));
const projRoot = path.join(tmp, 'spice', 'projects', 'demo');
const cardsRoot = path.join(projRoot, 'tasks');
fs.mkdirSync(cardsRoot, { recursive: true });
const pp = topo.physicalProjectPrefix(cardsRoot);
eq(pp.prefix, 'spice/projects/demo', 'prefix is project-relative posix');
eq(pp.root, fs.realpathSync(projRoot), 'root is the physical project dir');

// A cards root outside spice/projects throws.
const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'topo-bad-'));
fs.mkdirSync(path.join(bad, 'tasks'), { recursive: true });
throws(() => topo.physicalProjectPrefix(path.join(bad, 'tasks')),
  /outside spice\/projects/, 'non-canonical root throws');

// canonicalWorkspacePath: exact match, no traversal, project-relative only.
ok(topo.canonicalWorkspacePath('spice/projects/demo/tasks/E/E.md',
  'spice/projects/demo/tasks/E/E.md'), 'exact match passes');
ok(!topo.canonicalWorkspacePath('/abs/path', '/abs/path'), 'absolute rejected');
ok(!topo.canonicalWorkspacePath('a/../b', 'a/../b'), 'traversal rejected');
ok(!topo.canonicalWorkspacePath('x', 'y'), 'mismatch rejected');

// epicBindingPaths + parentBoardRef.
const b = topo.epicBindingPaths('spice/projects/demo', 'Epic One');
eq(b.atlasRef, 'spice/projects/demo/tasks/Epic One/Epic One.md', 'atlasRef');
eq(b.boardRef, 'spice/projects/demo/tasks/Epic One/board/Epic One-board.md', 'boardRef');
eq(topo.parentBoardRef('spice/projects/demo', 'demo-board.md'),
  'spice/projects/demo/demo-board.md', 'parentBoardRef');

// resolveSliceAuthority — ledger wins when present.
let v = topo.resolveSliceAuthority({ hasRecord: true, ledgerStatus: 'in_progress', boardStatus: 'completed', doneProven: false, boardIsSlice: true });
eq(v.source, 'ledger', 'record present => ledger source');
eq(v.status, 'in_progress', 'ledger in_progress wins over board completed');
eq(v.doneProven, false, 'not proven');

// Ledger completed WITH receipts is done.
v = topo.resolveSliceAuthority({ hasRecord: true, ledgerStatus: 'completed', boardStatus: 'planning', doneProven: true, boardIsSlice: true });
eq(v.status, 'completed', 'proven completed stays completed');
eq(v.doneProven, true, 'proven');
ok(!v.demoted, 'not demoted');

// Ledger completed WITHOUT receipts demotes.
v = topo.resolveSliceAuthority({ hasRecord: true, ledgerStatus: 'completed', boardStatus: 'planning', doneProven: false, boardIsSlice: true });
eq(v.status, 'in_progress', 'unproven ledger completion demotes');
ok(v.demoted, 'demoted flagged');

// No record: board slice declaration cannot assert done.
v = topo.resolveSliceAuthority({ hasRecord: false, boardStatus: 'completed', boardIsSlice: true });
eq(v.source, 'board', 'no record => board source');
eq(v.status, 'in_progress', 'board slice completed demotes');
eq(v.doneProven, false, 'board never proves done');

// No record, non-slice: board status taken at face value (no demotion).
v = topo.resolveSliceAuthority({ hasRecord: false, boardStatus: 'completed', boardIsSlice: false });
eq(v.status, 'completed', 'non-slice board completed not demoted');

// No record, board in_progress: pass-through.
v = topo.resolveSliceAuthority({ hasRecord: false, boardStatus: 'blocked', boardIsSlice: true });
eq(v.status, 'blocked', 'board non-completed passes through');

// assertProjectableStatus: throws on the impossible-in-correct-code combination.
throws(() => topo.assertProjectableStatus({ status: 'completed', doneProven: false }),
  /projectable status invariant/, 'completed-without-proof assertion fires');
// ...and accepts valid verdicts.
topo.assertProjectableStatus({ status: 'completed', doneProven: true });
topo.assertProjectableStatus({ status: 'in_progress', doneProven: false });
count += 2;

// Adopted tier (WS3): an evidence-backed out-of-band completion is projectable
// WITHOUT ever claiming deployment proof. doneProven keeps its exact meaning.
v = topo.resolveSliceAuthority({ hasRecord: true, ledgerStatus: 'completed', boardStatus: 'completed', doneProven: false, boardIsSlice: true, adopted: true });
eq(v.status, 'completed', 'adopted completion does not demote');
eq(v.source, 'adopted', 'adopted completion reports the adopted source');
eq(v.doneProven, false, 'adopted is never proven done');
ok(!v.demoted, 'adopted completion is not flagged demoted');

// adopted only rescues `completed`; any other ledger status is untouched by it.
v = topo.resolveSliceAuthority({ hasRecord: true, ledgerStatus: 'in_progress', boardStatus: 'completed', doneProven: false, boardIsSlice: true, adopted: true });
eq(v.status, 'in_progress', 'adopted does not promote a non-completed ledger status');
eq(v.source, 'ledger', 'a non-completed adopted record still reports the ledger source');

// adopted requires a record: it can never rescue a bare board declaration.
v = topo.resolveSliceAuthority({ hasRecord: false, boardStatus: 'completed', boardIsSlice: true, adopted: true });
eq(v.status, 'in_progress', 'adopted without a record cannot rescue a board declaration');
eq(v.source, 'board', 'adopted without a record still reports the board source');

// The backstop accepts adopted and still refuses unproven, unadopted completion.
topo.assertProjectableStatus({ status: 'completed', doneProven: false, source: 'adopted' });
throws(() => topo.assertProjectableStatus({ status: 'completed', doneProven: false, source: 'ledger' }),
  /projectable status invariant/, 'unproven ledger completion still fails the backstop');
count += 1;  // the bare accept-call above asserts by not throwing; `throws` counts itself

console.log(`DELIVERY-TOPOLOGY PASS (${count} assertions)`);
