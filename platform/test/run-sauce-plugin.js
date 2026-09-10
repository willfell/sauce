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

  // ---------- BR-*: boot-stage profiler + idle-deferred receipt ----------
  const RECEIPT_PATH = 'ranch/boot-profile.json';
  const flush = () => new Promise((r) => setImmediate(r));

  // Like makeApp but with a writable adapter + injectable layout/idle scheduling,
  // so the tests can prove exactly WHEN the receipt write happens.
  function makeBootRig(tree) {
    const writes = [];
    const layoutCbs = [];
    const idleCbs = [];
    const cleared = [];
    const store = {};
    const app = {
      vault: {
        adapter: {
          list: async (dir) => tree[dir] || { files: [], folders: [] },
          read: async (p) => {
            if (typeof tree[p] !== 'string') throw new Error('ENOENT ' + p);
            return tree[p];
          },
          write: async (p, c) => { store[p] = c; writes.push(p); },
          exists: async (p) => Object.prototype.hasOwnProperty.call(store, p),
        },
      },
      workspace: {
        getActiveFile: () => null,
        onLayoutReady: (cb) => layoutCbs.push(cb),
      },
    };
    return { app, writes, layoutCbs, idleCbs, cleared, store };
  }

  function makeBootPlugin(SaucePlugin, rig) {
    const p = new SaucePlugin();
    p.app = rig.app;
    p._setTimeoutFn = (fn) => { rig.idleCbs.push(fn); return rig.idleCbs.length; };
    p._clearTimeoutFn = (id) => { rig.cleared.push(id); };
    return p;
  }

  const BOOT_TREE = () => ({
    'ranch/scripts': { files: ['ranch/scripts/foo.js', 'ranch/scripts/notclass.js'], folders: ['ranch/scripts/sub'] },
    'ranch/scripts/sub': { files: ['ranch/scripts/sub/bar.js'], folders: [] },
    'ranch/scripts/foo.js': 'class Foo { hi() { return 1; } }',
    'ranch/scripts/notclass.js': "'use strict';\nconst x = 1;",
    'ranch/scripts/sub/bar.js': 'class Bar { }',
  });

  await ok('BR-1 loadCustomJsClasses captures per-stage timings, file count, and bytes', async () => {
    const mod = loadPluginModule();
    const tree = BOOT_TREE();
    const w = (typeof window !== 'undefined') ? window : globalThis;
    delete w.customJS;
    const res = await mod.loadCustomJsClasses(makeApp(tree));
    delete w.customJS;
    assert(res.profile && Array.isArray(res.profile.stages), 'result carries profile.stages[]');
    const byName = {};
    for (const s of (res.profile && res.profile.stages || [])) byName[s.name] = s;
    const read = byName['read-class-files'];
    assert(read && read.files === 3, 'read stage counts every .js read (3), got ' + JSON.stringify(read));
    const expectedBytes = tree['ranch/scripts/foo.js'].length + tree['ranch/scripts/notclass.js'].length + tree['ranch/scripts/sub/bar.js'].length;
    assert(read && read.bytes === expectedBytes, 'read stage sums body bytes (' + expectedBytes + '), got ' + (read && read.bytes));
    const reg = byName['register-classes'];
    assert(reg && reg.registered === 2 && reg.failed === 0, 'register stage counts registered/failed, got ' + JSON.stringify(reg));
    assert(reg && reg.loaded === 2 && reg.skipped === 0, 'register stage counts loaded/skipped (empty registry → all loaded), got ' + JSON.stringify(reg));
    for (const s of (res.profile.stages)) {
      assert(typeof s.elapsed_ms === 'number' && s.elapsed_ms >= 0, s.name + ' has non-negative elapsed_ms');
    }
    assert(typeof res.profile.total_ms === 'number' && res.profile.total_ms >= 0, 'profile.total_ms is a non-negative number');
  });

  await ok('BR-2 receipt writes ONLY after layout-ready + idle deferral (zero writes before)', async () => {
    const SaucePlugin = loadPluginModule();
    const rig = makeBootRig(BOOT_TREE());
    const w = (typeof window !== 'undefined') ? window : globalThis;
    delete w.customJS;
    const p = makeBootPlugin(SaucePlugin, rig);
    await p.onload();
    assert(typeof w.customJS.Foo === 'object', 'classes registered during onload');
    assert(rig.writes.length === 0, 'zero vault writes at onload completion, got ' + JSON.stringify(rig.writes));
    assert(rig.layoutCbs.length === 1, 'onload registered exactly one layout-ready callback');
    rig.layoutCbs[0]();
    await flush();
    assert(rig.writes.length === 0, 'zero vault writes after layout-ready but before idle, got ' + JSON.stringify(rig.writes));
    assert(rig.idleCbs.length === 1, 'layout-ready scheduled exactly one idle deferral');
    rig.idleCbs[0]();
    await flush();
    assert(rig.writes.length === 1 && rig.writes[0] === RECEIPT_PATH, 'exactly one write to ' + RECEIPT_PATH + ', got ' + JSON.stringify(rig.writes));
    const receipt = JSON.parse(rig.store[RECEIPT_PATH]);
    assert(receipt.schema_version === 1, 'receipt carries schema_version 1');
    assert(Array.isArray(receipt.stages) && receipt.stages.some((s) => s.name === 'read-class-files' && s.files === 3), 'receipt carries the boot stages array');
    delete w.customJS;
  });

  await ok('BR-3 repeated boots overwrite the single receipt (no unbounded growth)', async () => {
    const SaucePlugin = loadPluginModule();
    const tree = BOOT_TREE();
    const rig = makeBootRig(tree);
    const w = (typeof window !== 'undefined') ? window : globalThis;
    delete w.customJS;
    const boot = async () => {
      const p = makeBootPlugin(SaucePlugin, rig);
      await p.onload();
      rig.layoutCbs.pop()();
      await flush();
      rig.idleCbs.pop()();
      await flush();
    };
    await boot();
    delete tree['ranch/scripts/sub/bar.js'];
    tree['ranch/scripts/sub'] = { files: [], folders: [] };
    await boot();
    delete w.customJS;
    assert(rig.writes.length === 2 && rig.writes.every((x) => x === RECEIPT_PATH), 'both boots wrote the same single path');
    const receipt = JSON.parse(rig.store[RECEIPT_PATH]);
    const read = receipt.stages.find((s) => s.name === 'read-class-files');
    assert(read && read.files === 2, 'receipt holds ONLY the last boot (2 files after removal), got ' + (read && read.files));
    assert(!Array.isArray(receipt.boots), 'receipt is not an append-log of boots');
  });

  await ok('BR-4 a failing receipt write degrades to console.warn — onload chain never throws', async () => {
    const SaucePlugin = loadPluginModule();
    const rig = makeBootRig(BOOT_TREE());
    rig.app.vault.adapter.write = async () => { throw new Error('disk full'); };
    const w = (typeof window !== 'undefined') ? window : globalThis;
    delete w.customJS;
    const warns = [];
    const origWarn = console.warn;
    console.warn = (m) => warns.push(String(m));
    let threw = false;
    try {
      const p = makeBootPlugin(SaucePlugin, rig);
      await p.onload();
      rig.layoutCbs[0]();
      await flush();
      rig.idleCbs[0]();
      await flush();
    } catch (_e) { threw = true; }
    finally { console.warn = origWarn; }
    assert(threw === false, 'failed write must never throw');
    assert(typeof w.customJS.Foo === 'object', 'classes still registered despite failed receipt');
    assert(warns.some((m) => m.indexOf('boot-profile') >= 0), 'failure surfaced as a console.warn mentioning the receipt: ' + JSON.stringify(warns));
    delete w.customJS;
  });

  await ok('BR-5 unload cancels the pending idle write — reload cycles cannot double-write', async () => {
    const SaucePlugin = loadPluginModule();
    const rig = makeBootRig(BOOT_TREE());
    const w = (typeof window !== 'undefined') ? window : globalThis;
    delete w.customJS;
    const p = makeBootPlugin(SaucePlugin, rig);
    await p.onload();
    rig.layoutCbs[0]();
    await flush();
    assert(rig.idleCbs.length === 1, 'idle deferral pending before unload');
    p.onunload();
    assert(rig.cleared.length === 1, 'unload cancelled the pending idle timer');
    rig.idleCbs[0]();
    await flush();
    assert(rig.writes.length === 0, 'a stale idle callback after unload writes nothing');
    delete w.customJS;
  });

  // ---------- DP-*: single-pass class-loading dedupe ----------
  // The CustomJS community plugin evals the same corpus; whichever party runs
  // second must skip classes the registry already owns instead of paying the
  // full eval+construct pass again. Constructor side-effects (counters on
  // globalThis) prove exactly which classes were constructed, and how often.
  const dpG = (typeof window !== 'undefined') ? window : globalThis;
  const dpBody = (name) =>
    'class ' + name + ' { constructor() { const g = (typeof window !== "undefined") ? window : globalThis; '
    + 'g.__dpConstructs[' + JSON.stringify(name) + '] = (g.__dpConstructs[' + JSON.stringify(name) + '] || 0) + 1; } }';
  const DP_TREE = () => ({
    'ranch/scripts': { files: ['ranch/scripts/foo.js', 'ranch/scripts/bar.js'], folders: [] },
    'ranch/scripts/foo.js': dpBody('Foo'),
    'ranch/scripts/bar.js': dpBody('Bar'),
  });

  await ok('DP-0 extractClassName is parse-only text inspection (no eval), conservative on odd shapes', async () => {
    const mod = loadPluginModule();
    assert(typeof mod.extractClassName === 'function', 'extractClassName is exported');
    assert(mod.extractClassName('class Foo { }') === 'Foo', 'plain class → Foo');
    assert(mod.extractClassName('// header\n/* block */\nclass Bar extends Baz { }') === 'Bar', 'comments then class extends → Bar');
    assert(mod.extractClassName('class Qux{ hi() {} }') === 'Qux', 'no space before brace → Qux');
    assert(mod.extractClassName('class /* pinned */ Weird { }') === null, 'comment between class and name → null (fallback, not a guess)');
    assert(mod.extractClassName('class { }') === null, 'anonymous class → null');
    assert(mod.extractClassName("'use strict';\nclass X { }") === null, 'non-class-first file → null');
  });

  await ok('DP-1 empty registry → every class evaluated and registered exactly once (cold-load kill preserved)', async () => {
    const mod = loadPluginModule();
    delete dpG.customJS;
    dpG.__dpConstructs = {};
    const res = await mod.loadCustomJsClasses(makeApp(DP_TREE()));
    assert(typeof dpG.customJS.Foo === 'object' && typeof dpG.customJS.Bar === 'object', 'both classes registered');
    assert(dpG.__dpConstructs.Foo === 1 && dpG.__dpConstructs.Bar === 1, 'each constructor ran exactly once: ' + JSON.stringify(dpG.__dpConstructs));
    assert(res.registered.length === 2, 'both counted as registered');
    assert(Array.isArray(res.skipped) && res.skipped.length === 0, 'nothing skipped on an empty registry');
    delete dpG.customJS;
    delete dpG.__dpConstructs;
  });

  await ok('DP-2 fully populated registry → zero evals, zero constructs, no overwrites', async () => {
    const mod = loadPluginModule();
    const seededFoo = { seeded: 'Foo' };
    const seededBar = { seeded: 'Bar' };
    dpG.customJS = { Foo: seededFoo, Bar: seededBar };
    dpG.__dpConstructs = {};
    const res = await mod.loadCustomJsClasses(makeApp(DP_TREE()));
    assert(Object.keys(dpG.__dpConstructs).length === 0, 'zero constructor invocations: ' + JSON.stringify(dpG.__dpConstructs));
    assert(dpG.customJS.Foo === seededFoo && dpG.customJS.Bar === seededBar, 'existing registry entries untouched (merged, never replaced)');
    assert(res.registered.length === 0, 'zero registered this pass');
    assert(res.skipped.length === 2 && res.skipped.indexOf('Foo') >= 0 && res.skipped.indexOf('Bar') >= 0, 'both skipped: ' + JSON.stringify(res.skipped));
    delete dpG.customJS;
    delete dpG.__dpConstructs;
  });

  await ok('DP-3 partially populated registry → only the missing classes evaluated and registered', async () => {
    const mod = loadPluginModule();
    const seededFoo = { seeded: 'Foo' };
    dpG.customJS = { Foo: seededFoo };
    dpG.__dpConstructs = {};
    const res = await mod.loadCustomJsClasses(makeApp(DP_TREE()));
    assert(!('Foo' in dpG.__dpConstructs), 'the already-owned class was never constructed');
    assert(dpG.__dpConstructs.Bar === 1, 'the missing class was constructed exactly once');
    assert(dpG.customJS.Foo === seededFoo, 'the owned entry untouched');
    assert(typeof dpG.customJS.Bar === 'object' && dpG.customJS.Bar.seeded === undefined, 'the missing class registered fresh');
    assert(res.registered.length === 1 && res.registered[0] === 'Bar', 'only Bar counted as registered');
    assert(res.skipped.length === 1 && res.skipped[0] === 'Foo', 'only Foo counted as skipped');
    delete dpG.customJS;
    delete dpG.__dpConstructs;
  });

  await ok('DP-4 unextractable class name → falls back to the eval path, never silently skipped', async () => {
    const mod = loadPluginModule();
    const tree = {
      'ranch/scripts': { files: ['ranch/scripts/weird.js'], folders: [] },
      'ranch/scripts/weird.js':
        'class /* pinned */ Weird { constructor() { const g = (typeof window !== "undefined") ? window : globalThis; '
        + 'g.__dpConstructs.Weird = (g.__dpConstructs.Weird || 0) + 1; } }',
    };
    delete dpG.customJS;
    dpG.__dpConstructs = {};
    await mod.loadCustomJsClasses(makeApp(tree));
    assert(typeof dpG.customJS.Weird === 'object', 'empty registry: unextractable file still registered via eval');
    assert(dpG.__dpConstructs.Weird === 1, 'empty registry: constructed exactly once');
    dpG.customJS = { Weird: { seeded: true } };
    dpG.__dpConstructs = {};
    await mod.loadCustomJsClasses(makeApp(tree));
    assert(dpG.__dpConstructs.Weird === 1, 'populated registry: extraction failure still means eval (a wasted eval beats a lost class)');
    assert(typeof dpG.customJS.Weird === 'object' && dpG.customJS.Weird.seeded === undefined, 'last-write consistency: the eval fallback re-registered');
    delete dpG.customJS;
    delete dpG.__dpConstructs;
  });

  await ok('DP-5 register-classes profile stage records skipped versus loaded counts', async () => {
    const mod = loadPluginModule();
    dpG.customJS = { Foo: { seeded: 'Foo' } };
    dpG.__dpConstructs = {};
    const res = await mod.loadCustomJsClasses(makeApp(DP_TREE()));
    const reg = (res.profile.stages || []).find((s) => s.name === 'register-classes');
    assert(reg && reg.loaded === 1, 'stage carries loaded=1, got ' + JSON.stringify(reg));
    assert(reg && reg.skipped === 1, 'stage carries skipped=1, got ' + JSON.stringify(reg));
    assert(reg && reg.registered === 1 && reg.failed === 0, 'schema-1 registered/failed counts preserved');
    delete dpG.customJS;
    delete dpG.__dpConstructs;
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
