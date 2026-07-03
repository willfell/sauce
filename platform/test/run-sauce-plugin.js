'use strict';
// run-sauce-plugin.js — headless harness for the sauce-plugin mechanism:
//   PL-* : the bundled Obsidian plugin's onload class-loader (real main.js,
//          mocked Obsidian + a fake ranch/scripts tree).
//   BP-* : the installer's applyBundledPlugin vendoring step (added in Task 4).

const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) pass++; else { fail++; console.log('  FAIL ' + msg); } }
async function ok(name, fn) { try { await fn(); console.log('ok ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); } }

const PLUGIN_MAIN = path.join(__dirname, '..', 'mechanisms', 'sauce-plugin', 'plugin', 'main.js');

// Load the real plugin main.js with `require("obsidian")` stubbed to a bare
// Plugin base class (Obsidian isn't available in Node).
function loadPluginModule() {
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'obsidian') return { Plugin: class {} };
    return orig.call(this, request, parent, isMain);
  };
  try { delete require.cache[require.resolve(PLUGIN_MAIN)]; return require(PLUGIN_MAIN); }
  finally { Module._load = orig; }
}

// A fake vault adapter over an in-memory ranch/scripts tree.
function makeApp(tree) {
  // tree: { "ranch/scripts": { files:[paths], folders:[paths] }, ... , "<path>": "<body>" }
  return {
    vault: {
      adapter: {
        list: async (dir) => tree[dir] || { files: [], folders: [] },
        read: async (p) => {
          if (typeof tree[p] !== 'string') throw new Error('ENOENT ' + p);
          return tree[p];
        },
      },
    },
  };
}

(async () => {
  await ok('PL-1 onload registers class-files onto window.customJS (real main.js)', async () => {
    const SaucePlugin = loadPluginModule();
    const tree = {
      'ranch/scripts': { files: ['ranch/scripts/foo.js', 'ranch/scripts/notclass.js', 'ranch/scripts/bad.js'], folders: ['ranch/scripts/sub'] },
      'ranch/scripts/sub': { files: ['ranch/scripts/sub/bar.js'], folders: [] },
      'ranch/scripts/foo.js': '// header\nclass Foo { hi() { return 1; } }',
      'ranch/scripts/notclass.js': "'use strict';\nconst x = 1; module.exports = x;",
      'ranch/scripts/bad.js': 'class { syntaxerror',            // not a valid class expr
      'ranch/scripts/sub/bar.js': '/* c */ class Bar { }',
    };
    const w = (typeof window !== 'undefined') ? window : globalThis;
    delete w.customJS;
    const p = new SaucePlugin();
    p.app = makeApp(tree);
    await p.onload();                                            // must not throw
    assert(w.customJS && typeof w.customJS.Foo === 'object', 'Foo registered as instance');
    assert(typeof w.customJS.Foo.hi === 'function', 'Foo instance has its method');
    assert(typeof w.customJS.Bar === 'object', 'Bar (nested dir) registered');
    assert(!('x' in w.customJS), 'non-class module.exports file NOT registered');
    delete w.customJS;
  });

  await ok('PL-2 a syntactically-bad class file is skipped, onload never throws', async () => {
    const SaucePlugin = loadPluginModule();
    const tree = {
      'ranch/scripts': { files: ['ranch/scripts/bad.js', 'ranch/scripts/good.js'], folders: [] },
      'ranch/scripts/bad.js': 'class Broken { (((',
      'ranch/scripts/good.js': 'class Good {}',
    };
    const w = (typeof window !== 'undefined') ? window : globalThis;
    delete w.customJS;
    const p = new SaucePlugin();
    p.app = makeApp(tree);
    let threw = false;
    try { await p.onload(); } catch (_e) { threw = true; }
    assert(threw === false, 'onload must never throw');
    assert(w.customJS && typeof w.customJS.Good === 'object', 'the good class still registered despite the bad one');
    delete w.customJS;
  });

  await ok('PL-3 isClassFile skips comment/quote-prefixed non-class files (scanner-safe)', async () => {
    const mod = loadPluginModule();
    assert(mod.isClassFile('// c\nclass A{}') === true, 'comment then class → true');
    assert(mod.isClassFile("'use strict';\nmodule.exports = {}") === false, "'use strict' prefix → false");
    // main.js itself must NOT read as a class file (so customjs scanners skip it).
    const fs = require('fs');
    assert(mod.isClassFile(fs.readFileSync(PLUGIN_MAIN, 'utf8')) === false, 'the plugin main.js is not a bare class → customJS scanners skip it');
  });

  // ---------- BP-*: applyBundledPlugin installer step (vendor + enable) ----------
  global.Notice = global.Notice || function () {};
  const install = require(path.join(__dirname, '..', 'install.js'));
  const WORKSHOP = path.resolve(__dirname, '..', '..');
  const MECH = { name: 'sauce-plugin', bundled_plugin: { id: 'sauce', source_dir: 'plugin', files: ['manifest.json', 'main.js'] } };
  const GIT = { commit: 'test', tag: 'v0', dirty: false };

  function makeAdapter(initial) {
    const store = Object.assign({}, initial);
    const writes = [], mkdirs = [];
    return {
      _store: store, _writes: writes, _mkdirs: mkdirs,
      exists: async (p) => Object.prototype.hasOwnProperty.call(store, p),
      read: async (p) => { if (!(p in store)) throw new Error('ENOENT ' + p); return store[p]; },
      write: async (p, c) => { store[p] = c; writes.push(p); },
      mkdir: async (p) => { mkdirs.push(p); },
    };
  }
  const tpWith = (adapter) => ({ app: { vault: { adapter } } });

  await ok('PL-RESOLVE-1 resolveScriptsFolder reads customJS jsFolder, defaults to ranch/scripts', async () => {
    const mod = loadPluginModule();
    const custom = makeAdapter({ '.obsidian/plugins/customjs/data.json': JSON.stringify({ jsFolder: 'ranch/Scripts-custom' }) });
    assert((await mod.resolveScriptsFolder({ vault: { adapter: custom } })) === 'ranch/Scripts-custom', 'reads configured jsFolder');
    const none = makeAdapter({});
    assert((await mod.resolveScriptsFolder({ vault: { adapter: none } })) === 'ranch/scripts', 'defaults when no customjs config');
    const blank = makeAdapter({ '.obsidian/plugins/customjs/data.json': JSON.stringify({ jsFolder: '' }) });
    assert((await mod.resolveScriptsFolder({ vault: { adapter: blank } })) === 'ranch/scripts', 'defaults on empty jsFolder');
  });

  await ok('BP-fn applyBundledPlugin is exported', async () => {
    assert(typeof install.applyBundledPlugin === 'function', 'install.applyBundledPlugin must be exported');
  });

  await ok('BP-1 vendors manifest.json + main.js and enables "sauce" (preserving others)', async () => {
    const a = makeAdapter({ '.obsidian/community-plugins.json': JSON.stringify(['customjs', 'dataview']) });
    await install.applyBundledPlugin(tpWith(a), MECH, WORKSHOP, WORKSHOP, [], GIT);
    assert(typeof a._store['.obsidian/plugins/sauce/manifest.json'] === 'string' && a._store['.obsidian/plugins/sauce/manifest.json'].includes('"id": "sauce"'), 'manifest.json vendored');
    assert(typeof a._store['.obsidian/plugins/sauce/main.js'] === 'string' && a._store['.obsidian/plugins/sauce/main.js'].includes('SaucePlugin'), 'main.js vendored');
    const enabled = JSON.parse(a._store['.obsidian/community-plugins.json']);
    assert(enabled.includes('sauce') && enabled.includes('customjs') && enabled.includes('dataview'), 'sauce enabled, others preserved: ' + JSON.stringify(enabled));
  });

  await ok('BP-2 idempotent — second run does not duplicate the "sauce" entry', async () => {
    const a = makeAdapter({ '.obsidian/community-plugins.json': JSON.stringify(['customjs']) });
    await install.applyBundledPlugin(tpWith(a), MECH, WORKSHOP, WORKSHOP, [], GIT);
    await install.applyBundledPlugin(tpWith(a), MECH, WORKSHOP, WORKSHOP, [], GIT);
    const enabled = JSON.parse(a._store['.obsidian/community-plugins.json']);
    assert(enabled.filter((x) => x === 'sauce').length === 1, 'exactly one "sauce" entry: ' + JSON.stringify(enabled));
  });

  await ok('BP-3 community-plugins.json absent → files still vendored, no throw', async () => {
    const a = makeAdapter({});
    let threw = false;
    try { await install.applyBundledPlugin(tpWith(a), MECH, WORKSHOP, WORKSHOP, [], GIT); } catch (_e) { threw = true; }
    assert(threw === false, 'must not throw when community-plugins.json is absent');
    assert(typeof a._store['.obsidian/plugins/sauce/main.js'] === 'string', 'files still vendored');
  });

  await ok('BP-4 malformed community-plugins.json → files vendored, enable skipped, no throw', async () => {
    const a = makeAdapter({ '.obsidian/community-plugins.json': 'not json{' });
    let threw = false;
    try { await install.applyBundledPlugin(tpWith(a), MECH, WORKSHOP, WORKSHOP, [], GIT); } catch (_e) { threw = true; }
    assert(threw === false, 'must not throw on malformed community-plugins.json');
    assert(a._store['.obsidian/community-plugins.json'] === 'not json{', 'malformed file preserved untouched');
    assert(typeof a._store['.obsidian/plugins/sauce/main.js'] === 'string', 'files still vendored');
  });

  await ok('BP-5 no bundled_plugin on the manifest → no-op', async () => {
    const a = makeAdapter({ '.obsidian/community-plugins.json': JSON.stringify(['customjs']) });
    await install.applyBundledPlugin(tpWith(a), { name: 'render-safe' }, WORKSHOP, WORKSHOP, [], GIT);
    assert(a._writes.length === 0, 'no writes when bundled_plugin is absent');
  });

  await ok('BP-6 partial vendor (a file write fails) → plugin NOT enabled', async () => {
    const a = makeAdapter({ '.obsidian/community-plugins.json': JSON.stringify(['customjs']) });
    const origWrite = a.write;
    a.write = async (p, c) => { if (p.endsWith('/main.js')) throw new Error('disk full'); return origWrite(p, c); };
    await install.applyBundledPlugin(tpWith(a), MECH, WORKSHOP, WORKSHOP, [], GIT);
    const enabled = JSON.parse(a._store['.obsidian/community-plugins.json']);
    assert(!enabled.includes('sauce'), 'sauce must NOT be enabled when a declared file failed to vendor');
  });

  await ok('BP-7 vendored plugin manifest.json version is stamped from the mechanism version', async () => {
    const a = makeAdapter({ '.obsidian/community-plugins.json': JSON.stringify(['customjs']) });
    await install.applyBundledPlugin(tpWith(a), Object.assign({}, MECH, { version: '9.9.9' }), WORKSHOP, WORKSHOP, [], GIT);
    const vendored = JSON.parse(a._store['.obsidian/plugins/sauce/manifest.json']);
    assert(vendored.version === '9.9.9', 'plugin manifest version stamped to mech version, got ' + vendored.version);
    assert(vendored.id === 'sauce', 'other manifest fields preserved');
  });

  // ---------- RC-*: render reconciler (faster reconcile on background changes) ----------
  await ok('RC-1 shouldReconcile: background change yes, active-file no, null/empty no', async () => {
    const mod = loadPluginModule();
    assert(mod.shouldReconcile('spice/tasks/x.md', 'spice/daily/2026-07-03.md') === true, 'background → true');
    assert(mod.shouldReconcile('spice/daily/2026-07-03.md', 'spice/daily/2026-07-03.md') === false, 'active file → false');
    assert(mod.shouldReconcile('', 'a.md') === false, 'empty → false');
    assert(mod.shouldReconcile(null, null) === false, 'null → false');
  });

  await ok('RC-2 background change → debounced reconcile that force-refreshes; bursts coalesce', async () => {
    const SaucePlugin = loadPluginModule();
    const scheduled = [], cleared = [], cmds = [];
    const p = new SaucePlugin();
    p.app = { workspace: { getActiveFile: () => ({ path: 'active.md' }) }, commands: { executeCommandById: (id) => cmds.push(id) } };
    p._setTimeoutFn = (fn) => { scheduled.push(fn); return scheduled.length; };
    p._clearTimeoutFn = (id) => { cleared.push(id); };
    p._onVaultChange('bg1.md');
    p._onVaultChange('bg2.md');   // burst → clears the first timer (coalesce)
    assert(scheduled.length === 2 && cleared.length === 1, 'coalesced: scheduled=' + scheduled.length + ' cleared=' + cleared.length);
    scheduled[scheduled.length - 1]();   // fire the latest timer
    assert(cmds.indexOf('dataview:dataview-force-refresh-views') >= 0, 'force-refresh fired: ' + JSON.stringify(cmds));
  });

  await ok('RC-3 a change to the ACTIVE file schedules NO reconcile (no typing thrash)', async () => {
    const SaucePlugin = loadPluginModule();
    const scheduled = [];
    const p = new SaucePlugin();
    p.app = { workspace: { getActiveFile: () => ({ path: 'active.md' }) }, commands: { executeCommandById: () => {} } };
    p._setTimeoutFn = (fn) => { scheduled.push(fn); return scheduled.length; };
    p._onVaultChange('active.md');
    assert(scheduled.length === 0, 'active-file change must not schedule a reconcile');
  });

  await ok('RC-4 _fireReconcile with absent commands API → no throw', async () => {
    const SaucePlugin = loadPluginModule();
    const p = new SaucePlugin();
    p.app = {};
    let threw = false;
    try { p._fireReconcile(); } catch (_e) { threw = true; }
    assert(threw === false, 'fire must never throw when commands absent');
  });

  await ok('RC-5 onload wires listeners via registerEvent, never throws', async () => {
    const SaucePlugin = loadPluginModule();
    const events = [];
    const p = new SaucePlugin();
    p.registerEvent = (ref) => events.push(ref);
    p.app = {
      vault: { adapter: { list: async () => ({ files: [], folders: [] }), read: async () => '' }, on: (ev) => ({ ev }) },
      metadataCache: { on: (ev) => ({ ev }) },
      workspace: { getActiveFile: () => null },
    };
    let threw = false;
    try { await p.onload(); } catch (_e) { threw = true; }
    assert(threw === false, 'onload never throws');
    assert(events.length >= 1, 'onload registered ≥1 event via registerEvent: ' + events.length);
  });

  console.log(`\nrun-sauce-plugin: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('run-sauce-plugin threw:', e); process.exit(1); });
