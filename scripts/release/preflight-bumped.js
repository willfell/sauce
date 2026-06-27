'use strict';
// preflight-bumped — replicate the release pipeline's `prepare-release` validation
// LOCALLY before merge: apply the computed per-component bumps, run the full
// preflight on the bumped tree, then restore the working tree. Catches stale
// version-literal assertions (which only fail on the BUMPED state) before they
// wedge prepare-release. Run on a CLEAN working tree (it hard-restores at the end).
//
// Usage: node scripts/release/preflight-bumped.js   (or: npm run release:preflight-bumped)
const { execFileSync } = require('child_process');

function sh(cmd, args) {
  return execFileSync(cmd, args, { stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 });
}

// Refuse to run on a dirty tree — we hard-restore at the end and must not clobber edits.
const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
if (status.trim()) {
  console.error('preflight-bumped: working tree is dirty. Commit or stash first (this tool hard-restores tracked files at the end).');
  process.exit(2);
}

let code = 0;
try {
  console.log('preflight-bumped: applying computed bumps (compute-release --write)…');
  sh('node', ['scripts/release/compute-release.js', '--write']);
  console.log('\npreflight-bumped: running release:preflight on the BUMPED state…');
  sh('npm', ['run', 'release:preflight']);
  console.log('\npreflight-bumped: PASS — the bumped state is green; prepare-release will not wedge.');
} catch (e) {
  code = 1;
  console.error('\npreflight-bumped: FAIL — a stale assertion (or real regression) breaks the bumped state.');
  console.error('Fix it (migrate version pins to VERSION_SNAPSHOT) before merging, or prepare-release will wedge.');
} finally {
  // Restore tracked files the bumper rewrote (versions/snapshot/subscriptions/package.json).
  try { execFileSync('git', ['checkout', '--', '.'], { stdio: 'inherit' }); } catch (_e) {}
  console.log('preflight-bumped: working tree restored.');
}
process.exit(code);
