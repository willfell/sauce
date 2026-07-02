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

// --- CJS-REF: template class-ref resolution (sibling failure to a non-loadable
// class). A note template / content note / manifest `inline_body` that invokes
// customjs-guard with { class: "X" } for a class X that has NO `class X`
// definition in any shipped helper produces the SAME "_X unavailable_"
// placeholder as a class file that fails to load — customJS simply never
// registers X. This is exactly how finance shipped the deleted InvoiceNavButtons
// ref (consistency-audit W0). run-finance-template-classes.js is the finance-
// scoped regression lock; this is the PLATFORM-WIDE guardrail across all
// blueprints + mechanisms. Only literal `class: "Name"` refs are checked;
// dynamic/variable class names are not statically resolvable and are skipped.
const REF_SCAN_DIRS = ['platform/blueprints', 'platform/mechanisms'];

// Class DEFINITIONS are the runtime truth (customJS loads the shipped .js files,
// not the manifest customjs_classes[] catalogue), so resolve refs against actual
// `class X` definitions — a class shipped but omitted from a manifest still
// resolves at render, and must not false-positive here.
function collectClassNames(dirs) {
  const names = new Set();
  for (const d of dirs) {
    for (const f of walk(d, [])) {
      const t = fs.readFileSync(f, 'utf8');
      const re = /(?:^|\n)\s*class\s+([A-Za-z0-9_]+)/g;
      let m;
      while ((m = re.exec(t)) !== null) names.add(m[1]);
    }
  }
  return names;
}

function scanClassRefs() {
  const defs = collectClassNames(REF_SCAN_DIRS);
  const refs = [];
  function rec(abs) {
    let ents;
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch (_e) { return; }
    for (const e of ents) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) { if (e.name === 'node_modules') continue; rec(p); }
      else if (e.name.endsWith('.md') || e.name === 'manifest.json') {
        const text = fs.readFileSync(p, 'utf8');
        const re = /customjs-guard["'][^)]*\bclass\s*:\s*["']([A-Za-z0-9_]+)["']/g;
        let m;
        while ((m = re.exec(text)) !== null) refs.push({ cls: m[1], file: path.relative(REPO_ROOT, p) });
      }
    }
  }
  for (const d of REF_SCAN_DIRS) rec(path.join(REPO_ROOT, d));
  const unresolved = refs.filter((r) => !defs.has(r.cls));
  return { refCount: refs.length, defCount: defs.size, unresolved };
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

  // Gate 1 (CJS-LOAD): every customJS class FILE loads the way the plugin loads it.
  const { scanned, classFiles, failures } = scan(SCAN_DIRS);
  if (failures.length) {
    console.error(`FAIL CJS-LOAD: ${failures.length} customJS class file(s) do NOT load the way the CustomJS plugin loads them:\n`);
    for (const v of failures) console.error(`  ${v.file}\n    ${v.message}`);
    console.error('\nCustomJS wraps each file in ( ... ) and evals it as a SINGLE expression, then calls new().');
    console.error('A customJS class file must be a bare class definition with NO trailing statements.');
    console.error('For Node-testable statics, do NOT append a `module.exports` trailer — load the class in the');
    console.error('harness via `new Function(src + "\\nreturn ClassName;")` instead (see run-renderer.js).');
    process.exit(1);
  }
  console.log(`ok CJS-LOAD: ${classFiles} customJS class file(s) load via customJS's eval("(" + file + ")") + new (of ${scanned} .js scanned); no violations.`);

  // Gate 2 (CJS-REF): every customjs-guard { class: "X" } literal ref resolves to
  // a shipped `class X` definition (same "_X unavailable_" failure otherwise).
  const { refCount, defCount, unresolved } = scanClassRefs();
  if (unresolved.length) {
    console.error(`\nFAIL CJS-REF: ${unresolved.length} customjs-guard class ref(s) reference a class with NO shipped definition (renders "_<class> unavailable_" on every note born from that template):\n`);
    for (const u of unresolved) console.error(`  { class: "${u.cls}" } <- ${u.file}`);
    console.error('\nEither the class was deleted/renamed (repoint the ref to a live class) or its helper file is missing.');
    process.exit(1);
  }
  console.log(`ok CJS-REF: ${refCount} customjs-guard class ref(s) across ${REF_SCAN_DIRS.join(' + ')} all resolve to a shipped class definition (of ${defCount} known).`);
  process.exit(0);
}

main();
