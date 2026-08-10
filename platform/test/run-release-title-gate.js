'use strict';
const assert = require('assert');
const { checkTitleBump } = require('../../scripts/release/check-title-bump');

let count = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, m); count += 1; };

// Minimal manifest stub: pre-1.0 umbrella, one component owning scripts/release.
const manifest = {
  workshop_version: '0.282.0',
  blueprints: [],
  mechanisms: [{ name: 'release', path: 'scripts/release', version: '0.1.0' }],
};
const commit = (message, files) => ({ hash: 'x', message, files });

// v0.281.1 scenario: a feat commit behind a fix-titled PR => mismatch => fail.
let r = checkTitleBump({
  title: 'fix(loop): tidy things',
  commits: [commit('feat(release): add a verb', ['scripts/release/x.js'])],
  manifest,
});
eq(r.ok, false, 'feat branch + fix title mismatches');
eq(r.branchLevel, 'minor', 'branch bump is minor');
eq(r.titleLevel, 'patch', 'title bump is patch');

// Agreement: refactor branch + refactor title => patch/patch => pass.
r = checkTitleBump({
  title: 'refactor(release): extract helper',
  commits: [commit('refactor(release): extract helper', ['scripts/release/x.js'])],
  manifest,
});
eq(r.ok, true, 'agreeing patch/patch passes');

// Non-conventional title => fail loudly (bumper would read none).
r = checkTitleBump({
  title: 'tidy up the release code',
  commits: [commit('fix(release): x', ['scripts/release/x.js'])],
  manifest,
});
eq(r.ok, false, 'non-conventional title fails');
eq(r.titleLevel, 'none', 'unparseable title => none');

// feat! on a pre-1.0 umbrella => minor; matching feat! title passes.
r = checkTitleBump({
  title: 'feat(release)!: breaking change',
  commits: [commit('feat(release)!: breaking change', ['scripts/release/x.js'])],
  manifest,
});
eq(r.ok, true, 'breaking pre-1.0 minor agrees');
eq(r.branchLevel, 'minor', 'pre-1.0 breaking => minor');

console.log(`RELEASE-TITLE-GATE PASS (${count} assertions)`);
