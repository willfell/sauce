'use strict';

// run-release-workflow-shape.js — the shape of .github/workflows/release.yml that
// keeps a release moving while other work lands on main.
//
// v0.307.2 took 98 minutes from merge to brew. Three things in the workflow
// added to that, and each rule below keeps one of them out:
//
//   - One concurrency group covered the whole workflow, so shipping a merged
//     release queued behind recomputing the next one. A group also holds only
//     one waiting run: a third push would have cancelled a waiting ship run.
//   - prepare-release ran the full preflight before it opened the release PR,
//     and the PR's own required checks then ran it again on the same bumped
//     tree on both platforms. Every merge to main paid for the first run before
//     the release PR even restarted.
//   - A job pushed HEAD to main after each release. It never had a commit to
//     push (the seed rebaseline is manual), and the push was rejected whenever
//     main had moved, which marked three of six releases failed.
//
// The rules are checked against the real workflows, then against a mutant per
// rule to prove each one still fires. Zero-dep. Exit 0 iff all pass.

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

const stripComments = (src) => src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

function jobsOf(src) {
  const lines = stripComments(src).split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const jobs = {};
  let name = null;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
    if (m) { name = m[1]; jobs[name] = ''; continue; }
    if (/^\S/.test(lines[i])) break;
    if (name) jobs[name] += `${lines[i]}\n`;
  }
  return { head: lines.slice(0, Math.max(start, 0)).join('\n'), jobs };
}

function concurrencyOf(body) {
  const m = /^ {4}concurrency:\s*\n((?: {6}.*\n)+)/m.exec(body || '');
  if (!m) return null;
  const group = /group:\s*(\S+)/.exec(m[1]);
  const cancel = /cancel-in-progress:\s*(\S+)/.exec(m[1]);
  return { group: group && group[1], cancel: cancel && cancel[1] };
}

// Returns the ids of the rules a pair of workflow sources breaks.
function audit(releaseSrc, ciSrc) {
  const broken = [];
  const release = jobsOf(releaseSrc);
  const prepare = release.jobs['prepare-release'];
  const ship = release.jobs['tag-and-ship'];

  if (/^concurrency:/m.test(release.head)) broken.push('no-workflow-group');

  const pc = concurrencyOf(prepare);
  const sc = concurrencyOf(ship);
  if (!pc || !sc || !pc.group || !sc.group || pc.group === sc.group
    || /github\./.test(pc.group + sc.group)) broken.push('separate-groups');
  if (!pc || !sc || pc.cancel !== 'false' || sc.cancel !== 'false') broken.push('never-cancel-running');

  if (!prepare || /release:preflight/.test(prepare)) broken.push('prepare-no-preflight');
  if (!ship || !/release:preflight/.test(ship)) broken.push('ship-keeps-preflight');
  if (ship && ship.indexOf('release:preflight') > ship.indexOf('git push origin')) broken.push('ship-keeps-preflight');

  const releaseBody = Object.values(release.jobs).join('\n');
  if (/git push[^\n]*\b(HEAD:main|origin main)\b/.test(releaseBody)) broken.push('no-push-to-main');

  const ci = jobsOf(ciSrc);
  const preflight = ci.jobs.preflight || '';
  if (!/^\s*pull_request:/m.test(ci.head) || !/release:preflight/.test(preflight)
    || !/platform:\s*linux/.test(preflight) || !/platform:\s*macos/.test(preflight)) broken.push('pr-checks-cover-bumped-state');

  return [...new Set(broken)];
}

const RELEASE = fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
const CI = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');

console.log('--- release workflow shape ---');
const live = audit(RELEASE, CI);
ok('REL-SHAPE-1: release.yml has no workflow-wide concurrency group', !live.includes('no-workflow-group'));
ok('REL-SHAPE-2: prepare-release and tag-and-ship queue in separate, fixed groups', !live.includes('separate-groups'));
ok('REL-SHAPE-3: neither group cancels a run that is already in progress', !live.includes('never-cancel-running'));
ok('REL-SHAPE-4: prepare-release opens the release PR without running preflight first', !live.includes('prepare-no-preflight'));
ok('REL-SHAPE-5: tag-and-ship still runs preflight before it pushes the tag', !live.includes('ship-keeps-preflight'));
ok('REL-SHAPE-6: no release job pushes a branch to main', !live.includes('no-push-to-main'));
ok('REL-SHAPE-7: the release PR is checked by preflight on Linux and macOS', !live.includes('pr-checks-cover-bumped-state'));

console.log('--- mutants: each rule fires ---');
const swap = (src, from, to) => {
  if (!src.includes(from)) throw new Error(`mutant anchor missing: ${from}`);
  return src.replace(from, to);
};
const mutants = [
  ['no-workflow-group', swap(RELEASE, '\njobs:\n', '\nconcurrency:\n  group: release\n  cancel-in-progress: false\n\njobs:\n'), CI],
  ['separate-groups', swap(RELEASE, 'group: release-ship', 'group: release-prepare'), CI],
  ['never-cancel-running', swap(RELEASE, 'group: release-ship\n      cancel-in-progress: false', 'group: release-ship\n      cancel-in-progress: true'), CI],
  ['prepare-no-preflight', swap(RELEASE, '      - name: Read computed version', '      - name: Gate\n        run: npm run release:preflight\n      - name: Read computed version'), CI],
  ['ship-keeps-preflight', swap(RELEASE, '        run: npm run release:preflight\n      - name: Create + push annotated tag', '        run: true\n      - name: Create + push annotated tag'), CI],
  ['no-push-to-main', `${RELEASE}\n  seed:\n    runs-on: sauce\n    steps:\n      - run: git push origin HEAD:main\n`, CI],
  ['pr-checks-cover-bumped-state', RELEASE, swap(CI, '  pull_request:\n    branches: [main]\n', '')],
];
for (const [rule, releaseSrc, ciSrc] of mutants) {
  const broken = audit(releaseSrc, ciSrc);
  ok(`REL-SHAPE-MUTANT: breaking "${rule}" is reported, and only that`, broken.length === 1 && broken[0] === rule);
}

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
