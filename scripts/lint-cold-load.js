'use strict';
// lint-cold-load — cold-load grammar gate (hard gate; no baseline).
//
// Two rules over platform/blueprints + platform/mechanisms source:
//   R1: no bare `dv.current().<deref>`. Use customJS.RenderSafe.page(dv) (helper
//       bodies) or `dv.current()?.` optional chaining (anywhere). The throw mode
//       is `dv.current()` returning undefined on cold load; optional chaining
//       cannot throw, RenderSafe also supplies the active-file fallback.
//   R2: no bare `customJS.X.Y(` inside a dataviewjs/template block. Route through
//       `dv.view("ranch/views/customjs-guard", { class, method })`.
// Scope per file type:
//   .js helpers/mechanisms  -> R1 over code lines (comments skipped). NOT R2
//                              (helper-internal customJS calls run inside a guard).
//   .md templates           -> R1 + R2 over ```dataviewjs/```js fenced blocks only
//                              (prose is ignored).
//   manifest.json           -> R1 + R2 over every `inline_body` string value only
//                              (descriptions legitimately mention dv.current() in
//                              prose history).
// Per-line opt-out: `// lint-cold-load:allow <reason>` (js) /
//   `<!-- lint-cold-load:allow <reason> -->` (md) on the line or the line above.
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const SCAN_DIRS = [
  path.join(REPO_ROOT, 'platform', 'blueprints'),
  path.join(REPO_ROOT, 'platform', 'mechanisms'),
];
// render-safe.js + the customjs-guard view legitimately define/centralize the
// primitives; README.md files are developer API documentation (never materialized
// into a vault), so their example fences may show the bare class signatures the
// docs describe. All other .md (templates + materialized hub/content notes) are
// real render surfaces and ARE gated.
const EXEMPT_BASENAMES = new Set(['render-safe.js', 'view.js', 'README.md']);
const R1_RE = /dv\.current\(\)\s*\.(?!\s)/;            // dv.current(). — NOT dv.current()?.
const R2_RE = /(?<![.\w])customJS\.[A-Z]\w*\.\w+\s*\(/; // bare customJS.X.y( (not window.customJS, not obj.customJS)
const ALLOW_RE = /lint-cold-load:allow\b/;
const IS_COMMENT_JS = (l) => /^\s*(\/\/|\*|\/\*)/.test(l);

function walk(dir, acc) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return acc; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js') || e.name.endsWith('.md') || e.name === 'manifest.json') acc.push(p);
  }
  return acc;
}

// Returns array of { line, message }. line is 1-based within `content`.
function lintJs(content) {
  const out = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (IS_COMMENT_JS(line)) continue;
    if (!R1_RE.test(line)) continue;
    const prev = i > 0 ? lines[i - 1] : '';
    if (ALLOW_RE.test(line) || ALLOW_RE.test(prev)) continue;
    out.push({ line: i + 1, message: `bare dv.current() deref — use customJS.RenderSafe.page(dv) or dv.current()?. : ${line.trim()}` });
  }
  return out;
}

// Scans only inside ```dataviewjs / ```js fences. Applies R1 + R2.
function lintMdBlocks(content) {
  const out = [];
  const lines = content.split('\n');
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```(\w*)/.exec(line);
    if (fence) { const lang = (fence[1] || '').toLowerCase(); inBlock = inBlock ? false : (lang === 'dataviewjs' || lang === 'js'); continue; }
    if (!inBlock) continue;
    const prev = i > 0 ? lines[i - 1] : '';
    const allowed = ALLOW_RE.test(line) || ALLOW_RE.test(prev);
    if (!allowed && R1_RE.test(line)) out.push({ line: i + 1, message: `bare dv.current() deref in dataviewjs block — use dv.current()?. : ${line.trim()}` });
    if (!allowed && R2_RE.test(line)) out.push({ line: i + 1, message: `bare customJS.X.Y( in dataviewjs block — route through customjs-guard: ${line.trim()}` });
  }
  return out;
}

// Walks parsed manifest JSON; lints every inline_body string (R1 + R2).
function lintManifest(content, relFile) {
  const out = [];
  let m; try { m = JSON.parse(content); } catch (_e) { return out; }
  const bodies = [];
  (function collect(o) {
    if (o && typeof o === 'object') for (const k of Object.keys(o)) {
      if (k === 'inline_body' && typeof o[k] === 'string') bodies.push(o[k]);
      else collect(o[k]);
    }
  })(m);
  for (const body of bodies) {
    if (ALLOW_RE.test(body)) continue;
    if (R1_RE.test(body)) out.push({ line: 0, message: `bare dv.current() deref in inline_body — use dv.current()?. : ${body.slice(0, 70)}…` });
    if (R2_RE.test(body)) out.push({ line: 0, message: `bare customJS.X.Y( in inline_body — route through customjs-guard: ${body.slice(0, 70)}…` });
  }
  return out;
}

function lintFile(file) {
  const base = path.basename(file);
  if (EXEMPT_BASENAMES.has(base)) return [];
  const content = fs.readFileSync(file, 'utf8');
  if (base === 'manifest.json') return lintManifest(content, file);
  if (file.endsWith('.md')) return lintMdBlocks(content);
  return lintJs(content);
}

function runSelfTest() {
  const fx = path.join(REPO_ROOT, 'platform', 'test', 'fixtures', 'lint-cold-load');
  const cases = [
    { dir: 'pass', expect: false },
    { dir: 'fail', expect: true },
  ];
  let passes = 0, fails = 0;
  for (const c of cases) {
    const d = path.join(fx, c.dir);
    let files; try { files = fs.readdirSync(d); } catch (_e) { files = []; }
    for (const name of files) {
      const v = lintFile(path.join(d, name));
      const flagged = v.length > 0;
      if (flagged === c.expect) { console.log(`ok self-test ${c.dir}/${name}: ${c.expect ? `flagged (${v.length})` : 'clean'}`); passes++; }
      else { console.error(`FAIL self-test ${c.dir}/${name}: expected ${c.expect ? 'violations' : 'clean'}, got ${v.length}`); for (const x of v) console.error(`    :${x.line} ${x.message}`); fails++; }
    }
  }
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails === 0 ? 0 : 1);
}

function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();
  const files = SCAN_DIRS.reduce((a, d) => walk(d, a), []);
  const all = [];
  for (const f of files) for (const v of lintFile(f)) all.push({ file: path.relative(REPO_ROOT, f), ...v });
  if (all.length === 0) { console.log(`ok lint-cold-load: ${files.length} file(s) scanned; no violations.`); process.exit(0); }
  console.error(`FAIL lint-cold-load: ${all.length} violation(s):\n`);
  for (const v of all) console.error(`  ${v.file}:${v.line}\n    ${v.message}`);
  console.error('\nUse customJS.RenderSafe.page(dv) (helpers) or dv.current()?. (templates), and route');
  console.error('dataviewjs customJS calls through the customjs-guard view. Opt out a single line with');
  console.error('`// lint-cold-load:allow <reason>` / `<!-- lint-cold-load:allow <reason> -->`.');
  process.exit(1);
}
main();
