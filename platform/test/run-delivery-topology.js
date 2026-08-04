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

console.log(`DELIVERY-TOPOLOGY PASS (${count} assertions)`);
