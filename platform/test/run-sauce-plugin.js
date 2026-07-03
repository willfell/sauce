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

  console.log(`\nrun-sauce-plugin: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('run-sauce-plugin threw:', e); process.exit(1); });
