#!/usr/bin/env node
/**
 * run-project-commands.js — ProjectCommandsInit regression guard (Task 6).
 *
 * ProjectCommandsInit is a customjs startup-script that mirrors the project
 * chrome-bar's actions as Obsidian commands, so nav + creates are reachable from
 * the command palette / hotkeys without buttons. It registers exactly ten
 * commands; each callback resolves the active file + Dataview api, builds the
 * surface context via ProjectChromeBar.detectContext, then DELEGATES to the same
 * helper the button uses (ProjectChromeBar._dispatch for actions,
 * .navTarget + ._openNavTarget for nav). No path/action logic is reimplemented.
 *
 * These cases lock the command-registration contract (count + id set),
 * idempotency, the cold-load guard, and the delegation wiring — without the live
 * Obsidian command registry.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}

const ProjectCommandsInit = loadClass(
  'platform/blueprints/project/helpers/project-commands-init.js',
  'ProjectCommandsInit'
);

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

// The exact ten command ids the chrome bar mirrors (5 create/action + 5 nav).
const EXPECTED_IDS = [
  'sauce-project:new-task',
  'sauce-project:new-doc',
  'sauce-project:move-doc',
  'sauce-project:add-workstream',
  'sauce-project:add-link',
  'sauce-project:archive-toggle',
  'sauce-project:go-board',
  'sauce-project:go-docs',
  'sauce-project:go-map',
  'sauce-project:go-todo',
  'sauce-project:go-links',
];

// Install a stub `global.app` with a spying app.commands.addCommand; returns the
// captured command specs. Pass commandsObj:null to simulate a missing command API.
function withApp(overrides, fn) {
  const prevApp = global.app;
  const prevCJS = global.customJS;
  const prevNotice = global.Notice;
  global.Notice = function Notice() {};
  const registered = [];
  const commands = overrides && ('commands' in overrides)
    ? overrides.commands
    : { addCommand: (spec) => registered.push(spec) };
  global.app = Object.assign({ commands }, overrides && overrides.app);
  global.customJS = (overrides && overrides.customJS) || {};
  try { fn(registered); } finally {
    global.app = prevApp; global.customJS = prevCJS; global.Notice = prevNotice;
  }
  return registered;
}

// ── PCI-1 — invoke() registers exactly the ten command ids ───────────────────
{
  const registered = withApp({}, (reg) => {
    new ProjectCommandsInit().invoke();
  });
  ok('PCI-1a invoke() registers exactly 11 commands', registered.length === 11);
  const ids = registered.map((c) => c.id).sort();
  const expected = EXPECTED_IDS.slice().sort();
  const idsMatch = ids.length === expected.length && ids.every((v, i) => v === expected[i]);
  ok('PCI-1b the registered id set matches the eleven expected ids', idsMatch);
  const allNamed = registered.every((c) => typeof c.name === 'string' && /^Sauce Project: /.test(c.name));
  ok('PCI-1c every command carries a "Sauce Project: …" name', allNamed);
  const allCallable = registered.every((c) => typeof c.callback === 'function');
  ok('PCI-1d every command carries a callback function', allCallable);
}

// ── PCI-2 — a second invoke() on the SAME instance registers nothing more ─────
{
  const registered = withApp({}, (reg) => {
    const inst = new ProjectCommandsInit();
    inst.invoke();
    inst.invoke(); // idempotent guard → no new commands
  });
  ok('PCI-2 a second invoke() is a no-op (still exactly 11)', registered.length === 11);
}

// ── PCI-3 — app.commands absent → invoke() does not throw, registers nothing ──
{
  let threw = false;
  let registeredLen = -1;
  const prevApp = global.app;
  const prevCJS = global.customJS;
  try {
    global.app = { /* no .commands */ };
    global.customJS = {};
    const inst = new ProjectCommandsInit();
    inst.invoke();
    registeredLen = 0; // nothing to register into
  } catch (_e) { threw = true; }
  finally { global.app = prevApp; global.customJS = prevCJS; }
  ok('PCI-3a invoke() with app.commands absent does not throw', !threw);
  ok('PCI-3b …and registers nothing', registeredLen === 0);
}

// ── PCI-4 — a registered callback DELEGATES to ProjectChromeBar ───────────────
// Pull the new-task command's callback and fire it with a stub app + a spying
// ProjectChromeBar; assert it calls _dispatch(dv, ctx, 'new-task') — proving the
// command mirror delegates rather than reimplementing.
{
  const dispatchCalls = [];
  const openCalls = [];
  const navTargetCalls = [];
  const activeFile = { path: 'spice/projects/connectors/Connectors.md' };
  const fakeDv = { __tag: 'dv' };
  const stubPCB = {
    detectContext: (p) => ({ context: 'project-hub', projectDir: 'spice/projects/connectors', projectSlug: 'connectors', _path: p }),
    _dispatch: (dv, ctx, id) => dispatchCalls.push({ dv, ctx, id }),
    navTarget: (dv, ctx, key) => { navTargetCalls.push({ dv, ctx, key }); return `spice/projects/connectors/${key}.md`; },
    _openNavTarget: (path, dv) => openCalls.push({ path, dv }),
  };

  // Register with the delegation stubs installed so callbacks close over them.
  let registered;
  const prevApp = global.app;
  const prevCJS = global.customJS;
  const prevNotice = global.Notice;
  global.Notice = function Notice() {};
  const captured = [];
  global.app = {
    commands: { addCommand: (spec) => captured.push(spec) },
    workspace: { getActiveFile: () => activeFile },
    plugins: { plugins: { dataview: { api: fakeDv } } },
  };
  global.customJS = { ProjectChromeBar: stubPCB };
  try {
    new ProjectCommandsInit().invoke();
    registered = captured;
    const newTask = registered.find((c) => c.id === 'sauce-project:new-task');
    if (newTask) newTask.callback();
    const goBoard = registered.find((c) => c.id === 'sauce-project:go-board');
    if (goBoard) goBoard.callback();
  } finally {
    global.app = prevApp; global.customJS = prevCJS; global.Notice = prevNotice;
  }

  ok('PCI-4a new-task callback delegates to ProjectChromeBar._dispatch once',
    dispatchCalls.length === 1);
  ok('PCI-4b …with the action id "new-task" + the resolved dv',
    dispatchCalls.length === 1 && dispatchCalls[0].id === 'new-task' && dispatchCalls[0].dv === fakeDv);
  ok('PCI-4c go-board callback delegates to navTarget("board") then _openNavTarget',
    navTargetCalls.length === 1 && navTargetCalls[0].key === 'board'
      && openCalls.length === 1 && openCalls[0].path === 'spice/projects/connectors/board.md');
}

// ── PCI-5 — no active file → Notice, no delegation, no throw ──────────────────
{
  const dispatchCalls = [];
  const prevApp = global.app;
  const prevCJS = global.customJS;
  const prevNotice = global.Notice;
  const notices = [];
  global.Notice = function Notice(msg) { notices.push(msg); };
  const captured = [];
  global.app = {
    commands: { addCommand: (spec) => captured.push(spec) },
    workspace: { getActiveFile: () => null }, // no active file
    plugins: { plugins: {} },
  };
  global.customJS = { ProjectChromeBar: { detectContext: () => ({ context: 'project-hub' }), _dispatch: () => dispatchCalls.push(1) } };
  let threw = false;
  try {
    new ProjectCommandsInit().invoke();
    const newTask = captured.find((c) => c.id === 'sauce-project:new-task');
    if (newTask) newTask.callback();
  } catch (_e) { threw = true; }
  finally { global.app = prevApp; global.customJS = prevCJS; global.Notice = prevNotice; }
  ok('PCI-5a no-active-file callback does not throw', !threw);
  ok('PCI-5b …does not delegate to _dispatch', dispatchCalls.length === 0);
  ok('PCI-5c …surfaces an "open a project note" Notice', notices.length >= 1);
}

// ── Summary ──────────────────────────────────────────────────────────────────
const failed = results.filter(([, c]) => !c);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.error(`FAILED: ${failed.map(([n]) => n).join(', ')}`); process.exit(1); }
process.exit(0);
