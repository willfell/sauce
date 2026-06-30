#!/usr/bin/env node
/**
 * deploy — the autoloop's canary-and-promote deployer. After a release ships
 * to the brew tap, the loop pulls it into the consumer vaults: ERO is the
 * CANARY (gets it first), and only once ERO has held the new version for a
 * full turn does it PROMOTE to the protected vaults (accuris + headspace).
 *
 * The soak is stateless — enforced by doing at most ONE deploy action per turn:
 *   turn A: ERO behind shipped  → deploy ERO (canary)            [ERO now current, prod behind]
 *   turn B: ERO == shipped, prod behind ERO → promote prod       [one full turn elapsed = soak]
 * A canary that fails to reach the target never lets prod promote, so a bad
 * release is contained to ERO.
 *
 * Pure: cmpVersion, deployPlan, verifyDeploy. Side effects (brew upgrade +
 * `sauce update --bump-pins` + version read) live only in the CLI.
 *
 * Exports: cmpVersion, deployPlan, verifyDeploy, CANARY, PROD
 * CLI: node scripts/autoloop/deploy.js run [--dry] [--json]
 *      node scripts/autoloop/deploy.js plan        (compute only, no side effects)
 */
'use strict';

// Machine-local loop infrastructure (not shipped platform code): the consumer
// vaults on this dev machine and their deploy roles.
const HOME = require('os').homedir();
const CANARY = { name: 'ero-sauce', path: `${HOME}/notes/sauce/ero-sauce`, role: 'canary' };
const PROD = [
  { name: 'accuris-sauce', path: `${HOME}/notes/sauce/accuris-sauce`, role: 'prod' },
  { name: 'headspace-sauce', path: `${HOME}/notes/sauce/headspace-sauce`, role: 'prod' },
];

// Compare dotted numeric versions ("0.145.1"). → -1 | 0 | 1.
function cmpVersion(a, b) {
  const pa = String(a == null ? '' : a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b == null ? '' : b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * deployPlan — decide the single deploy action for this turn.
 * @param {{shippedVersion:string, canaryVersion:string, prodVersions:{name:string,version:string}[]}} o
 * @returns {{action:'canary'|'promote'|'none', target?:string, vaults?:string[], reason:string}}
 */
function deployPlan(o) {
  const { shippedVersion, canaryVersion, prodVersions = [] } = o || {};
  if (!shippedVersion) return { action: 'none', reason: 'no shipped version known' };
  // 1. Canary first: ERO must reach the latest shipped version before anything else.
  if (cmpVersion(canaryVersion, shippedVersion) < 0) {
    return { action: 'canary', target: shippedVersion, vaults: [CANARY.name],
      reason: `canary ${canaryVersion || '(none)'} < shipped ${shippedVersion}` };
  }
  // 2. Promote: ERO is current (soaked ≥1 turn since it caught up) → bring prod up to ERO's version.
  const behind = prodVersions.filter((p) => cmpVersion(p.version, canaryVersion) < 0);
  if (behind.length) {
    return { action: 'promote', target: canaryVersion, vaults: behind.map((p) => p.name),
      reason: `canary stable on ${canaryVersion}; prod behind: ${behind.map((p) => `${p.name}@${p.version || 'none'}`).join(', ')}` };
  }
  return { action: 'none', reason: `all vaults current at ${shippedVersion}` };
}

// A deploy is good only if the vault actually reached the target version.
function verifyDeploy(o) {
  const { target, installed } = o || {};
  if (!installed) return { ok: false, reason: 'no installed version after deploy' };
  if (cmpVersion(installed, target) !== 0) return { ok: false, reason: `installed ${installed} != target ${target}` };
  return { ok: true };
}

module.exports = { cmpVersion, deployPlan, verifyDeploy, CANARY, PROD };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const ROOT = path.resolve(__dirname, '..', '..');
  const MAXBUF = 64 * 1024 * 1024; // `sauce update` is verbose (install log is ~MB); default cap masks success as exit-1.
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const dry = argv.includes('--dry') || cmd === 'plan';

  const readVersion = (manifestPath) => {
    try { return String(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).workshop_version || ''); } catch (_) { return ''; }
  };
  const installedVersion = (vaultPath) => readVersion(path.join(vaultPath, 'ranch', 'platform-installed.json'));
  const bottleVersion = () => readVersion('/opt/homebrew/opt/sauce/libexec/platform/manifest.json');
  const latestTag = () => {
    try { return execFileSync('git', ['-C', ROOT, 'tag', '--sort=-creatordate'], { encoding: 'utf8', maxBuffer: MAXBUF }).split('\n')[0].trim().replace(/^v/, ''); }
    catch (_) { return ''; }
  };

  // "shipped" = what is actually INSTALLABLE (the brew bottle), NOT the git
  // tag. The release pipeline's brew-ship leg lags the tag, so targeting the
  // tag would try to install a version the tap hasn't published yet and fail
  // every turn. When a newer tag exists we poll the tap once (brew upgrade);
  // whatever the bottle becomes is the deploy ceiling. A later turn retries
  // until the tap catches up.
  const tag = latestTag();
  let brewOut = 'current';
  if (!dry && cmpVersion(bottleVersion(), tag) < 0) {
    try { execFileSync('brew', ['upgrade', 'sauce'], { encoding: 'utf8', stdio: 'pipe', maxBuffer: MAXBUF, env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' } }); brewOut = `polled tap → bottle ${bottleVersion()}`; }
    catch (e) { brewOut = `brew upgrade failed: ${e.message.split('\n')[0]}`; }
  }
  const shipped = bottleVersion();
  const canaryVersion = installedVersion(CANARY.path);
  const prodVersions = PROD.map((p) => ({ name: p.name, version: installedVersion(p.path) }));
  const plan = deployPlan({ shippedVersion: shipped, canaryVersion, prodVersions });

  if (plan.action === 'none' || dry) {
    const tagAhead = cmpVersion(tag, shipped) > 0 ? `tag ${tag} not yet on the tap` : null;
    console.log(JSON.stringify({ tag, shipped, canaryVersion, prodVersions, plan, brew: brewOut, tagAhead, executed: false }, null, 2));
    process.exit(0);
  }

  const byName = Object.fromEntries([CANARY, ...PROD].map((v) => [v.name, v]));
  const results = [];
  for (const name of plan.vaults) {
    const v = byName[name];
    let ok = false; let reason = '';
    try {
      execFileSync('sauce', ['update', '--bump-pins'], { cwd: v.path, encoding: 'utf8', stdio: 'pipe', maxBuffer: MAXBUF });
      const verdict = verifyDeploy({ target: plan.target, installed: installedVersion(v.path) });
      ok = verdict.ok; reason = verdict.reason || 'deployed';
    } catch (e) { reason = `install error: ${e.message.split('\n')[0]}`; }
    results.push({ vault: name, ok, version: installedVersion(v.path), reason });
  }
  const allOk = results.every((r) => r.ok);
  console.log(JSON.stringify({ shipped, plan, brew: brewOut, results, executed: true, allOk }, null, 2));
  process.exit(allOk ? 0 : 1);
}
