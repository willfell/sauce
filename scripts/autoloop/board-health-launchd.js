#!/usr/bin/env node
// One-shot installer for the hourly board-health launchd job (macOS), one
// entry per loop-bound repo — the cowork-reconciler launchd pattern, not a new
// mechanism. Each entry runs the INSTALLED coordinator (`brew --prefix sauce`)
// with the repo as cwd so the loop binding resolver picks the right board.
//
// Usage: node scripts/autoloop/board-health-launchd.js install [repoPath]
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'Docs', 'install', 'board-health-launchd.plist.template');

function renderBoardHealthPlist({ user, home, nodePath, coordinatorPath, repoPath, slug }) {
  return fs.readFileSync(TEMPLATE_PATH, 'utf8')
    .replaceAll('{{$user}}', user)
    .replaceAll('{{$home}}', home)
    .replaceAll('{{$node_path}}', nodePath)
    .replaceAll('{{$coordinator_path}}', coordinatorPath)
    .replaceAll('{{$repo_path}}', repoPath)
    .replaceAll('{{$slug}}', slug);
}

function installedCoordinatorPath() {
  const prefix = execSync('brew --prefix sauce', { encoding: 'utf8' }).trim();
  const coordinator = path.join(prefix, 'libexec', 'scripts', 'autoloop', 'codex-coordinator.js');
  if (!fs.existsSync(coordinator)) {
    throw new Error(`installed coordinator not found at ${coordinator} — brew install sauce first`);
  }
  return coordinator;
}

function boundProjectSlug(repoPath) {
  const resolver = require(path.join(__dirname, '..', '..', 'plugins', 'loop', 'scripts', 'loop-config.js'));
  const res = resolver.resolveBinding(repoPath, { brewPrefix: () => '' });
  if (!res || !res.ok) {
    throw new Error(`${repoPath} is not loop-bound (.loop/config.json missing or invalid) — run /loop:init first`);
  }
  return path.basename(path.dirname(res.config.board_path_abs));
}

function installBoardHealthLaunchd(repoPath = process.cwd()) {
  const repo = path.resolve(repoPath);
  const user = process.env.USER || os.userInfo().username;
  const home = os.homedir();
  const slug = boundProjectSlug(repo);
  const plist = renderBoardHealthPlist({
    user,
    home,
    nodePath: process.execPath,
    coordinatorPath: installedCoordinatorPath(),
    repoPath: repo,
    slug,
  });
  const plistPath = path.join(home, 'Library/LaunchAgents', `com.${user}.sauce-board-health.${slug}.plist`);
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.writeFileSync(plistPath, plist, 'utf8');
  console.log(`Wrote launchd plist: ${plistPath}`);
  try { execSync(`launchctl unload -w ${JSON.stringify(plistPath)} 2>/dev/null || true`, { stdio: 'inherit', shell: '/bin/bash' }); } catch (_) { /* ok */ }
  execSync(`launchctl load -w ${JSON.stringify(plistPath)}`, { stdio: 'inherit', shell: '/bin/bash' });
  console.log(`Loaded launchd job: com.${user}.sauce-board-health.${slug} (hourly)`);
  console.log(`Log: ${home}/Library/Logs/sauce-board-health.${slug}.log`);
  console.log(`To uninstall: launchctl unload -w ${plistPath} && rm ${plistPath}`);
  return plistPath;
}

module.exports = { renderBoardHealthPlist, installBoardHealthLaunchd, boundProjectSlug, TEMPLATE_PATH };

if (require.main === module) {
  const [verb, repoArg] = process.argv.slice(2);
  if (verb !== 'install') {
    console.error('usage: board-health-launchd.js install [repoPath]');
    process.exit(2);
  }
  try {
    installBoardHealthLaunchd(repoArg || process.cwd());
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
