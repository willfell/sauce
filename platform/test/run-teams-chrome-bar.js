#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const TeamsChromeBar = loadClass('platform/blueprints/teams/scripts/teams-chrome-bar.js', 'TeamsChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new TeamsChromeBar();
const cfg = inst._config();

async function main() {

// TMCB-DETECT
{
  const hub = cfg.detect({}, { file: { path: 'spice/teams/Teams.md' }, type: 'teams-hub' });
  const team = cfg.detect({}, { file: { path: 'spice/teams/Platform.md' }, type: 'team' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('TMCB-DETECT-1 teams-hub/team classify; non-teams → null',
    hub && hub.context === 'teams-hub' && team && team.context === 'team' && off === null);
}
// TMCB-SPEC
{
  const h = cfg.surfaceSpec({ context: 'teams-hub' });
  const t = cfg.surfaceSpec({ context: 'team' });
  ok('TMCB-SPEC-1 hub: primary new-team + not leaf', h.primary.id === 'new-team' && h.leaf === false);
  ok('TMCB-SPEC-2 team: leaf + primary null + overflow empty', t.leaf === true && t.primary === null && t.overflow.length === 0);
}
// TMCB-DISPATCH
{
  const calls = [];
  const prevApp = global.app;
  global.app = {
    plugins: { plugins: { "templater-obsidian": { templater: { create_new_note_from_template: (tpl, folder) => { calls.push({ create: folder }); return Promise.resolve(); } } } } },
    vault: { getAbstractFileByPath: (p) => ({ path: p }) },
  };
  global.Notice = function () {};
  await cfg.dispatch({}, { context: 'teams-hub' }, 'new-team');
  global.app = prevApp;
  ok('TMCB-DISPATCH-1 new-team → templater.create_new_note_from_template("spice/teams")', calls.some(c => c.create === 'spice/teams'));
}

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
}

main();
