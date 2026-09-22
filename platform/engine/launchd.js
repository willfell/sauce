// platform/engine/launchd.js — unattended cadence for one graph note on
// macOS: render sauce-engine.plist.sample, write it under
// ~/Library/LaunchAgents, load it. Mirrors scripts/autoloop/board-health-launchd.js.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { slugOf } = require('./run.js');

const TEMPLATE_PATH = path.join(__dirname, 'sauce-engine.plist.sample');

function renderPlist({ user, home, nodePath, cliPath, notePath, slug, intervalSeconds }) {
  return fs.readFileSync(TEMPLATE_PATH, 'utf8')
    .replaceAll('{{$user}}', user)
    .replaceAll('{{$home}}', home)
    .replaceAll('{{$node_path}}', nodePath)
    .replaceAll('{{$cli_path}}', cliPath)
    .replaceAll('{{$note_path}}', notePath)
    .replaceAll('{{$slug}}', slug)
    .replaceAll('{{$interval}}', String(intervalSeconds));
}

function plistPathFor({ user, home, slug }) {
  return path.join(home, 'Library', 'LaunchAgents', `com.${user}.sauce-run.${slug}.plist`);
}

function identity() {
  return { user: process.env.USER || os.userInfo().username, home: os.homedir() };
}

function install({ notePath, intervalSeconds, cliPath, launchctl }) {
  const { user, home } = identity();
  const abs = path.resolve(notePath);
  const slug = slugOf(abs);
  const plist = renderPlist({ user, home, nodePath: process.execPath, cliPath: path.resolve(cliPath), notePath: abs, slug, intervalSeconds: intervalSeconds || 900 });
  const plistPath = plistPathFor({ user, home, slug });
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.writeFileSync(plistPath, plist, 'utf8');
  const run = launchctl || ((cmd) => execSync(cmd, { stdio: 'inherit', shell: '/bin/bash' }));
  try { run(`launchctl unload -w ${JSON.stringify(plistPath)} 2>/dev/null || true`); } catch (_e) { /* not loaded yet */ }
  run(`launchctl load -w ${JSON.stringify(plistPath)}`);
  return { plist: plistPath, label: `com.${user}.sauce-run.${slug}`, interval: intervalSeconds || 900, log: path.join(home, 'Library', 'Logs', `sauce-run.${slug}.log`), message: `loaded com.${user}.sauce-run.${slug} every ${intervalSeconds || 900}s (plist ${plistPath})` };
}

function uninstall({ notePath, launchctl }) {
  const { user, home } = identity();
  const slug = slugOf(path.resolve(notePath));
  const plistPath = plistPathFor({ user, home, slug });
  const run = launchctl || ((cmd) => execSync(cmd, { stdio: 'inherit', shell: '/bin/bash' }));
  if (fs.existsSync(plistPath)) {
    try { run(`launchctl unload -w ${JSON.stringify(plistPath)} 2>/dev/null || true`); } catch (_e) { /* ok */ }
    fs.unlinkSync(plistPath);
    return { plist: plistPath, removed: true, message: `unloaded and removed ${plistPath}` };
  }
  return { plist: plistPath, removed: false, message: `no launchd job for this note (${plistPath} absent)` };
}

module.exports = { renderPlist, install, uninstall, plistPathFor, TEMPLATE_PATH };
