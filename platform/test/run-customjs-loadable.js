'use strict';

// customJS-loadability gate (CJS-LOAD) — hard gate; no baseline.
//
// WHY THIS EXISTS
// ---------------
// The CustomJS plugin (samlewis0602, v1.0.x) loads each script file like this
// (main.js `evalFile`):
//
//     const def = eval(`(${fileBody})`);   // whole file wrapped in ( ... )
//     const cls = new def();               // then instantiated
//     window.customJS[cls.constructor.name] = cls;
//
// i.e. it wraps the ENTIRE file in parentheses and evaluates it as a SINGLE
// EXPRESSION, then `new`s the resulting class. A file that is a bare class
// definition works. A file with ANY trailing statement after the class — most
// notably the Node dual-export trailer
//
//     class Foo { ... }
//     if (typeof module !== "undefined" && module.exports) { module.exports = { Foo }; }
//
// parses fine as a Node *script* (class declaration + if statement are both
// valid statements), so `node --check` and `require()` are GREEN. But as an
// *expression* `(class Foo {} if (...) {})` is a SyntaxError ("Unexpected
// token 'if'"). CustomJS's `new def()` then throws (it swallows the error to
// the console), the class NEVER registers on window.customJS, and every
// customjs-guard block referencing it falls back to the
// "_<ClassName> unavailable_" placeholder. This is exactly how
// SpaceDailyDashboard broke on the daily note.
//
// `node --check` / `require()` cannot catch this because they use a *statement*
// parse context, not customJS's *expression* wrap. This gate replicates
// customJS's loader precisely, so the divergence can never regress silently.
//
// SCOPE
// -----
// Every customJS class file under the source-of-truth + dogfood trees:
//   - ranch/scripts/            (dogfood self-install = exact customJS load set)
//   - platform/blueprints/      (canonical blueprint helpers)
//   - platform/mechanisms/      (canonical mechanism scripts)
//   - platform/customjs/        (platform-level customJS classes)
// A file is treated as a customJS class file iff, after stripping leading
// comments + whitespace, its first token is `class` — this cleanly includes
// every customJS class and excludes node-only scripts (which begin with
// 'use strict' / const/require / a function). Node scripts are NOT loaded by
// customJS and are skipped.
//
// The gate replicates customJS exactly: `new (eval("(" + body + ")"))()`.
// (Verified: zero customJS class files have a constructor that touches
// app/window/customJS/moment/Notice, so instantiating in Node is
// false-positive-free.)

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCAN_DIRS = [
  'ranch/scripts',
  'platform/blueprints',
  'platform/mechanisms',
  'platform/customjs',
];

function walk(dir, acc) {
  const abs = path.isAbsolute(dir) ? dir : path.join(REPO_ROOT, dir);
  let ents;
  try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch (_e) { return acc; }
  for (const e of ents) {
    const p = path.join(abs, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

// Return the first ~80 chars of the file AFTER skipping leading whitespace,
// line comments, and block comments — used to decide if the file is a
// customJS class file (first real token is `class`).
function firstRealToken(src) {
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl + 1; continue; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
    break;
  }
  return src.slice(i, i + 80);
}

function isCustomJsClassFile(src) {
  return /^class\b/.test(firstRealToken(src));
}

// Replicate customJS's evalFile: eval(`(${body})`) then new def().
// Returns null on success, or an error string describing the failure.
function loadFailure(body) {
  let def;
  try {
    // eslint-disable-next-line no-eval
    def = eval('(' + body + ')');
  } catch (e) {
    return `eval("(" + file + ")") threw: ${e.constructor.name}: ${String(e.message).split('\n')[0]}`;
  }
  if (typeof def !== 'function') {
    return `eval did not yield a constructable class (got ${typeof def})`;
  }
  try {
    new def(); // eslint-disable-line no-new
  } catch (e) {
    return `new def() threw: ${e.constructor.name}: ${String(e.message).split('\n')[0]}`;
  }
  return null;
}

// Scan a set of directories; return { scanned, classFiles, failures }.
function scan(dirs) {
  const files = dirs.reduce((a, d) => walk(d, a), []);
  const failures = [];
  let classFiles = 0;
  for (const f of files) {
    const body = fs.readFileSync(f, 'utf8');
    if (!isCustomJsClassFile(body)) continue;
    classFiles++;
    const fail = loadFailure(body);
    if (fail) failures.push({ file: path.relative(REPO_ROOT, f), message: fail });
  }
  return { scanned: files.length, classFiles, failures };
}

function runSelfTest() {
  const fx = path.join(REPO_ROOT, 'platform', 'test', 'fixtures', 'customjs-loadable');
  const cases = [
    { dir: 'pass', expectFail: false },
    { dir: 'fail', expectFail: true },
  ];
  let passes = 0, fails = 0;
  for (const c of cases) {
    const d = path.join(fx, c.dir);
    let names; try { names = fs.readdirSync(d); } catch (_e) { names = []; }
    for (const name of names) {
      if (!name.endsWith('.js')) continue;
      const body = fs.readFileSync(path.join(d, name), 'utf8');
      const fail = loadFailure(body);
      const flagged = fail !== null;
      if (flagged === c.expectFail) {
        console.log(`ok self-test ${c.dir}/${name}: ${c.expectFail ? `flagged (${fail})` : 'loads cleanly'}`);
        passes++;
      } else {
        console.error(`FAIL self-test ${c.dir}/${name}: expected ${c.expectFail ? 'a load failure' : 'clean load'}, got ${flagged ? fail : 'clean'}`);
        fails++;
      }
    }
  }
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails === 0 ? 0 : 1);
}

function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();
  const { scanned, classFiles, failures } = scan(SCAN_DIRS);
  if (failures.length === 0) {
    console.log(`ok CJS-LOAD: ${classFiles} customJS class file(s) load via customJS's eval("(" + file + ")") + new (of ${scanned} .js scanned); no violations.`);
    process.exit(0);
  }
  console.error(`FAIL CJS-LOAD: ${failures.length} customJS class file(s) do NOT load the way the CustomJS plugin loads them:\n`);
  for (const v of failures) console.error(`  ${v.file}\n    ${v.message}`);
  console.error('\nCustomJS wraps each file in ( ... ) and evals it as a SINGLE expression, then calls new().');
  console.error('A customJS class file must be a bare class definition with NO trailing statements.');
  console.error('For Node-testable statics, do NOT append a `module.exports` trailer — load the class in the');
  console.error('harness via `new Function(src + "\\nreturn ClassName;")` instead (see run-renderer.js).');
  process.exit(1);
}

main();
