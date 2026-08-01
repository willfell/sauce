#!/usr/bin/env node
/**
 * deploy — the autoloop's vault deployer. After a release ships to the brew
 * tap, the loop pulls it into ALL consumer vaults on this machine — ERO,
 * accuris, and headspace — in a single action, per-vault fail-closed.
 *
 * Deploy model: any vault behind the latest INSTALLABLE bottle is upgraded
 * this turn; each vault must verify to the target version or it is flagged
 * `ok:false` (a failed vault never counts as deployed, and the CLI exits
 * non-zero). There is no canary/soak tier — a green-CI release propagates to
 * every vault at once. Blast-radius containment now lives entirely in the
 * gate stack (CI + Gate A/B) that runs before the release ships, not in a
 * per-vault rollout order.
 *
 * Pure: cmpVersion, deployPlan, verifyDeploy. Side effects (brew upgrade +
 * `sauce update --bump-pins` + version read) live only in the CLI.
 *
 * Exports: cmpVersion, deployPlan, verifyDeploy, VAULTS
 * CLI: node scripts/autoloop/deploy.js run [--dry] [--json]
 *      node scripts/autoloop/deploy.js plan        (compute only, no side effects)
 */
'use strict';

// Machine-local loop infrastructure (not shipped platform code): the consumer
// vaults on this dev machine. All three deploy together (no canary tier).
const HOME = require('os').homedir();
const VAULTS = [
  { name: 'ero-sauce', path: `${HOME}/obsidian/ero-sauce` },
  { name: 'accuris-sauce', path: `${HOME}/obsidian/accuris-sauce` },
  { name: 'headspace-sauce', path: `${HOME}/obsidian/headspace-sauce` },
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
 * deployPlan — decide this turn's deploy action: upgrade every vault behind
 * the shipped bottle, all at once.
 * @param {{shippedVersion:string, vaults:{name:string,version:string}[]}} o
 * @returns {{action:'deploy'|'none', target?:string, vaults?:string[], reason:string}}
 */
function deployPlan(o) {
  const { shippedVersion, vaults = [] } = o || {};
  if (!shippedVersion) return { action: 'none', reason: 'no shipped version known' };
  // Any vault below the installable bottle is deployed this turn (a missing/
  // empty version reads as behind). No canary ordering — all behind vaults go.
  const behind = vaults.filter((v) => cmpVersion(v.version, shippedVersion) < 0);
  if (behind.length) {
    return { action: 'deploy', target: shippedVersion, vaults: behind.map((v) => v.name),
      reason: `behind shipped ${shippedVersion}: ${behind.map((v) => `${v.name}@${v.version || 'none'}`).join(', ')}` };
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

module.exports = { cmpVersion, deployPlan, verifyDeploy, VAULTS };

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
  // every turn. When a newer tag exists we poll the tap once and whatever the
  // bottle becomes is the deploy ceiling; a later turn retries until the tap
  // catches up. The poll MUST `brew update` first — without it the local tap
  // clone is stale and `brew upgrade` never sees newly-published versions
  // (so NO HOMEBREW_NO_AUTO_UPDATE here — that flag is exactly what would
  // pin the deployer to whatever it last saw).
  const tag = latestTag();
  let brewOut = 'current';
  if (!dry && cmpVersion(bottleVersion(), tag) < 0) {
    try {
      execFileSync('brew', ['update'], { encoding: 'utf8', stdio: 'pipe', maxBuffer: MAXBUF });
      execFileSync('brew', ['upgrade', 'sauce'], { encoding: 'utf8', stdio: 'pipe', maxBuffer: MAXBUF });
      brewOut = `polled tap → bottle ${bottleVersion()}`;
    } catch (e) { brewOut = `brew update/upgrade failed: ${e.message.split('\n')[0]}`; }
  }
  const shipped = bottleVersion();
  const vaults = VAULTS.map((v) => ({ name: v.name, version: installedVersion(v.path) }));
  const plan = deployPlan({ shippedVersion: shipped, vaults });

  if (plan.action === 'none' || dry) {
    const tagAhead = cmpVersion(tag, shipped) > 0 ? `tag ${tag} not yet on the tap` : null;
    console.log(JSON.stringify({ tag, shipped, vaults, plan, brew: brewOut, tagAhead, executed: false }, null, 2));
    process.exit(0);
  }

  const byName = Object.fromEntries(VAULTS.map((v) => [v.name, v]));
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
