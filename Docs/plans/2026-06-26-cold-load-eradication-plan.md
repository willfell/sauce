# Cold-Load Eradication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the recurring cold-load error class (customJS-TDZ entry + `dv.current()`-undefined deref) from a runtime bug that ships as PATCHes into a build-failing preflight gate, and convert every existing callsite this cycle.

**Architecture:** A new `render-safe@0.1.0` mechanism centralizes the `dv.current()` fallback in one customJS class (`RenderSafe.page/filePath/fileName`). A new `scripts/lint-cold-load.js` gate (wired into `release:preflight`, no baseline) fails the build on any bare `dv.current().` deref or bare `customJS.X.Y(` callsite. All 18 helper derefs + template/manifest args + 3 stragglers are converted; a retireable install heal closes existing button-created notes.

**Tech Stack:** Zero-dependency Node (CommonJS) scripts + customJS classes; Obsidian Dataview render context; the existing sauce installer + preflight harness chain.

**Design:** `Docs/plans/2026-06-26-cold-load-eradication-design.md`. **Posture:** hard gate, no baseline grandfathering. **Do NOT** hand-bump any version beyond the new mechanism's own `0.1.0` + its catalogue entry — the release bumper computes the rest post-merge. Conventional commits only. No `Co-Authored-By: Claude` trailer (workshop rule). Stage explicit files, never `git add -A`.

---

## File Structure

**Created:**
- `platform/mechanisms/render-safe/manifest.json` — mechanism manifest (v0.1.0).
- `platform/mechanisms/render-safe/render-safe.js` — the `RenderSafe` customJS class.
- `platform/test/run-render-safe.js` — behavioral harness for RenderSafe.
- `scripts/lint-cold-load.js` — the gate.
- `platform/test/fixtures/lint-cold-load/pass/*` — clean fixtures.
- `platform/test/fixtures/lint-cold-load/fail/*` — violating fixtures.

**Modified (wiring):**
- `platform/manifest.json` — add render-safe to `mechanisms[]`.
- `ranch/platform-subscription.json` — subscribe render-safe (workshop dogfood).
- `platform/test/seed-vault/ranch/platform-subscription.json` — subscribe render-safe (CI consumer).
- `platform/bootstrap-lib/wizard.js` — add render-safe to `DEFAULT_MECHANISMS_CHECKED`.
- `platform/blueprints/{project,scratch,trips}/manifest.json` — add render-safe to `depends_on`.
- `package.json` — `lint-cold-load` script + wire into `release:preflight`.

**Modified (conversions):**
- `platform/blueprints/project/helpers/project-nav-buttons.js` (9 derefs, capture-once).
- `platform/blueprints/scratch/helpers/scratch-{day-actions,day-list,leaf-actions}.js` (5, capture-once).
- `platform/blueprints/trips/helpers/trip-{nav-buttons,sections-cards}.js` (3, capture-once).
- `platform/mechanisms/backlink-panel/backlink-panel.js` (1, optional-chain).
- `platform/blueprints/people/templates/Template, People.md` + `platform/blueprints/people/manifest.json` (optional-chain).
- `platform/blueprints/scratch/templates/Scratch Day Hub.md` (optional-chain).
- `platform/blueprints/finance/templates/{Budget,Invoice,Paycheck} Template.md` (guard view).
- `platform/install.js` — add the retireable existing-note heal + wire it.

**Modified (verification):**
- `platform/test/run-helper-cases.js` — `HC-V01340-RS-*` source-contract cases.
- `platform/test/run-project-render-guards.js` — re-verify after project refactor.

---

## Task 1: render-safe mechanism (TDD)

**Files:**
- Create: `platform/test/run-render-safe.js`
- Create: `platform/mechanisms/render-safe/render-safe.js`
- Create: `platform/mechanisms/render-safe/manifest.json`

- [ ] **Step 1: Write the failing harness** — `platform/test/run-render-safe.js`:

```js
'use strict';
// Behavioral harness for the render-safe mechanism (RenderSafe customJS class).
// RenderSafe centralizes the dv.current() cold-load fallback: when Dataview has
// not yet indexed the embedding file, dv.current() is undefined and a bare
// .file deref throws. RenderSafe.page(dv) returns dv.current() when present, else
// a shim built from app.workspace.getActiveFile() + cached frontmatter, else null.
const fs = require('fs');
const path = require('path');

let passes = 0, fails = 0;
function ok(name, fn) { try { fn(); console.log('ok ' + name); passes++; } catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); fails++; } }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
  return new Function(`${src}; return ${className};`)();
}
const RenderSafe = loadClass('mechanisms/render-safe/render-safe.js', 'RenderSafe');

// Global `app` stub used by the getActiveFile fallback branch.
function withApp(activeFile, frontmatter, run) {
  const prev = global.app;
  global.app = {
    workspace: { getActiveFile: () => activeFile },
    metadataCache: { getFileCache: (f) => (f && frontmatter ? { frontmatter } : null) },
  };
  try { return run(); } finally { global.app = prev; }
}

// 1. dv.current() present -> returned verbatim.
ok('RS-1 page returns dv.current() when present', () => {
  const page = { file: { path: 'a/B.md', name: 'B' }, day: '2026-06-26' };
  const out = RenderSafe.page({ current: () => page });
  assert(out === page, 'expected the live page object');
});

// 2. dv.current() undefined + active file -> shim with path/name + frontmatter.
ok('RS-2 page falls back to active-file shim', () => {
  withApp({ path: 'spice/x/Note.md', basename: 'Note' }, { day: '2026-06-26', workstream: 'w1' }, () => {
    const out = RenderSafe.page({ current: () => undefined });
    assert(out && out.file, 'expected a shim with .file');
    assert(out.file.path === 'spice/x/Note.md', 'shim path');
    assert(out.file.name === 'Note', 'shim name = basename (no ext)');
    assert(out.day === '2026-06-26', 'shim carries frontmatter.day');
    assert(out.workstream === 'w1', 'shim carries frontmatter.workstream');
  });
});

// 3. dv.current() null + no active file -> null (never throws).
ok('RS-3 page returns null when no current + no active file', () => {
  withApp(null, null, () => { assert(RenderSafe.page({ current: () => null }) === null, 'expected null'); });
});

// 4. dv lacking .current (unit-test shim) -> null, no throw.
ok('RS-4 page tolerates dv without .current', () => {
  withApp(null, null, () => { assert(RenderSafe.page({}) === null, 'expected null'); });
});

// 5. filePath / fileName helpers.
ok('RS-5 filePath + fileName derive from page', () => {
  const dv = { current: () => ({ file: { path: 'p/Q.md', name: 'Q' } }) };
  assert(RenderSafe.filePath(dv) === 'p/Q.md', 'filePath');
  assert(RenderSafe.fileName(dv) === 'Q', 'fileName');
  withApp(null, null, () => {
    assert(RenderSafe.filePath({ current: () => null }) === null, 'filePath null');
    assert(RenderSafe.fileName({ current: () => null }) === null, 'fileName null');
  });
});

console.log(`\nrun-render-safe: ${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-render-safe.js`
Expected: FAIL — `ENOENT` / cannot read `render-safe.js` (not created yet).

- [ ] **Step 3: Write `platform/mechanisms/render-safe/render-safe.js`**

```js
// render-safe.js — render-safe mechanism v0.1.0.
//
// Cold-load safety for Dataview render context. On cold vault load Dataview can
// render a dataviewjs block before it has indexed the embedding file, so
// dv.current() returns undefined and a bare `dv.current().file.path` deref throws
// the "Cannot read properties of undefined" flash (landmines #1-#2 + the v0.119/
// v0.132/v0.133 point-fixes). RenderSafe is the single home for the fallback:
// helpers call customJS.RenderSafe.page(dv) (window.customJS is already loaded in
// a helper body, since the customjs-guard view resolved the class first).
//
// Templates / dataviewjs-block args CANNOT use this class (customJS may be in the
// TDZ pre-guard) — they use `dv.current()?.x || app.workspace.getActiveFile()?.x`
// optional chaining instead. See Docs/agent-guides/code-conventions.md.
class RenderSafe {
  // Returns the live Dataview page when indexed, else a shim built from the
  // active file (path/name + cached frontmatter), else null. Never throws.
  static page(dv) {
    try {
      const cur = dv && typeof dv.current === 'function' ? dv.current() : null;
      if (cur && cur.file) return cur;
    } catch (_e) { /* fall through to active-file shim */ }
    try {
      const f = (typeof app !== 'undefined' && app.workspace && app.workspace.getActiveFile)
        ? app.workspace.getActiveFile() : null;
      if (!f) return null;
      const fm = (app.metadataCache && app.metadataCache.getFileCache)
        ? (app.metadataCache.getFileCache(f) || {}).frontmatter : null;
      return Object.assign({ file: { path: f.path, name: f.basename } }, fm || {});
    } catch (_e) { return null; }
  }

  static filePath(dv) { const p = RenderSafe.page(dv); return (p && p.file && p.file.path) || null; }
  static fileName(dv) { const p = RenderSafe.page(dv); return (p && p.file && p.file.name) || null; }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node platform/test/run-render-safe.js`
Expected: `5 passed, 0 failed`.

- [ ] **Step 5: Write `platform/mechanisms/render-safe/manifest.json`** (mirrors section-label):

```json
{
  "name": "render-safe",
  "version": "0.1.0",
  "description": "Cold-load-safe Dataview accessor. customJS.RenderSafe.page(dv) / .filePath(dv) / .fileName(dv) return the live dv.current() page when Dataview has indexed the embedding file, else a shim built from app.workspace.getActiveFile() + cached frontmatter, else null — never the 'Cannot read properties of undefined' throw that flashes on cold vault load (landmines #1-#2). The single home for the dv.current() fallback that the v0.119/v0.132/v0.133 point-fixes each re-implemented. Enforced by scripts/lint-cold-load.js.",
  "depends_on": [
    { "name": "customjs-guard", "range": ">=1.0.0" }
  ],
  "customjs_classes": ["RenderSafe"],
  "files": [
    { "source": "render-safe.js", "dest": "{{scripts_path}}/render-safe/render-safe.js" }
  ],
  "post_install": [],
  "rule_fragments": []
}
```

- [ ] **Step 6: Commit**

```bash
git add platform/test/run-render-safe.js platform/mechanisms/render-safe/render-safe.js platform/mechanisms/render-safe/manifest.json
git commit -m "feat(render-safe): cold-load-safe dv.current() accessor mechanism"
```

---

## Task 2: Wire render-safe + prove fresh-vault install BEFORE any conversion

This task de-risks the coupling (the v0.122.0 fresh-vault-bootstrap-skip lesson) first.

**Files:** `platform/manifest.json`, `ranch/platform-subscription.json`, `platform/test/seed-vault/ranch/platform-subscription.json`, `platform/bootstrap-lib/wizard.js`, `platform/blueprints/{project,scratch,trips}/manifest.json`.

- [ ] **Step 1: Add render-safe to the catalogue** — in `platform/manifest.json`, add to the `mechanisms[]` array (alphabetical/near other small mechs; the bumper does not care about order, `check-version-sync` only matches name→version):

```json
    { "name": "render-safe", "version": "0.1.0", "path": "mechanisms/render-safe" }
```

- [ ] **Step 2: Subscribe in workshop + seed-vault** — append to the `mechanisms[]` array in BOTH `ranch/platform-subscription.json` and `platform/test/seed-vault/ranch/platform-subscription.json`:

```json
    { "name": "render-safe", "version": "0.1.0" }
```

- [ ] **Step 3: Add to wizard defaults** — in `platform/bootstrap-lib/wizard.js`, insert into `DEFAULT_MECHANISMS_CHECKED` immediately after the `"customjs-guard"` entry (render-safe depends_on customjs-guard; deps-first ordering):

```js
    "render-safe",   // v0.13x.0 — project/scratch/trips blueprints (project +
                     // scratch are in the default blueprint set) depend on
                     // render-safe since this release; pre-include so
                     // fresh-vault bootstrap doesn't skip them. Same class of
                     // bug as the section-label / breadcrumb entries below.
```

- [ ] **Step 4: Declare the dependency on consuming blueprints** — in each of `platform/blueprints/project/manifest.json`, `platform/blueprints/scratch/manifest.json`, `platform/blueprints/trips/manifest.json`, add to the `depends_on` array:

```json
    { "name": "render-safe", "range": ">=0.1.0" }
```

- [ ] **Step 5: Prove the wiring (no conversions yet)**

Run each, expect exit 0 / all-pass:
```bash
node scripts/check-version-sync.js
node platform/install.js --vault . --auto-approve        # workshop dogfood
node platform/test/run-bootstrap.js                       # fresh-vault wizard
node platform/test/run-seed-migrations.js                 # CI synthetic consumer
```
Expected: dogfood materializes `ranch/scripts/render-safe/render-safe.js`; bootstrap + seed-migrations green; no "skipping <bp> — depends on render-safe but not subscribed" warning. If a count assertion or claude-surface assertion trips, investigate before proceeding (do NOT hand-edit a version literal — that's the bumper's job; a count helper should derive from manifest).

- [ ] **Step 6: Commit**

```bash
git add platform/manifest.json ranch/platform-subscription.json platform/test/seed-vault/ranch/platform-subscription.json platform/bootstrap-lib/wizard.js platform/blueprints/project/manifest.json platform/blueprints/scratch/manifest.json platform/blueprints/trips/manifest.json
git commit -m "feat(render-safe): catalogue + subscribe + wizard-default + blueprint depends_on"
```

---

## Task 3: The gate — `scripts/lint-cold-load.js` (RED against the unconverted tree)

**Files:** Create `scripts/lint-cold-load.js`, `platform/test/fixtures/lint-cold-load/{pass,fail}/*`. Modify `package.json`.

- [ ] **Step 1: Write the fixtures**

`platform/test/fixtures/lint-cold-load/pass/clean.js`:
```js
class Clean {
  render(dv) {
    const page = customJS.RenderSafe.page(dv);
    if (!page || !page.file) return;
    const name = page.file.name;
    const path2 = dv.current()?.file?.path; // optional-chain is allowed
    return [name, path2];
  }
}
```
`platform/test/fixtures/lint-cold-load/pass/clean.md`:
````markdown
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Clean" });
await dv.view("ranch/views/customjs-guard", { class: "P", method: "r", args: [{ p: dv.current()?.file?.path }] });
```
````
`platform/test/fixtures/lint-cold-load/fail/bad.js`:
```js
class Bad {
  render(dv) {
    const name = dv.current().file.name;   // R1 violation
    return name;
  }
}
```
`platform/test/fixtures/lint-cold-load/fail/bad.md`:
````markdown
```dataviewjs
await customJS.Bad.render(dv);
await dv.view("ranch/views/customjs-guard", { class: "P", args: [{ p: dv.current().file.path }] });
```
````

- [ ] **Step 2: Write `scripts/lint-cold-load.js`**

```js
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
// Files that legitimately define/centralize the primitives:
const EXEMPT_BASENAMES = new Set(['render-safe.js', 'view.js']); // customjs-guard view + render-safe class
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
```

- [ ] **Step 3: Verify the self-test passes**

Run: `node scripts/lint-cold-load.js --self-test`
Expected: `2 passed, 0 failed`.

- [ ] **Step 4: Verify the gate is RED against the real tree**

Run: `node scripts/lint-cold-load.js`
Expected: FAIL — ~22 violations (the 18 helper derefs incl. backlink-panel, the 3 template/manifest args, the 3 finance stragglers; counts approximate). This proves the gate bites BEFORE conversions.

- [ ] **Step 5: Wire into preflight + npm script** — in `package.json`: add `"lint-cold-load": "node scripts/lint-cold-load.js"` to `scripts`, and insert `&& node scripts/lint-cold-load.js --self-test && node scripts/lint-cold-load.js` into `release:preflight` immediately after the `lint-note-chrome.js` segment.

- [ ] **Step 6: Commit** (preflight is RED here — that's expected; conversions in Tasks 4-7 turn it green):

```bash
git add scripts/lint-cold-load.js platform/test/fixtures/lint-cold-load package.json
git commit -m "feat(lint-cold-load): build-failing cold-load gate + fixtures (RED pre-conversion)"
```

---

## Task 4: Convert project-nav-buttons (capture-once)

**Files:** `platform/blueprints/project/helpers/project-nav-buttons.js`; verify `platform/test/run-project-render-guards.js`.

**Recipe:** Find the render entry method(s) that contain the 9 `dv.current()` derefs (lines 29, 91, 125, 383, 415, 416, 432, 586, 596). Each is reached from a render path that already has `dv`. In each such method, immediately after the existing `dv`-available point, capture once:

```js
const page = customJS.RenderSafe.page(dv);
if (!page || !page.file) return;   // preserve existing early-return / placeholder behavior
```

Then replace every `dv.current()` token in that method body with `page`:
- `dv.current().file` → `page.file`
- `dv.current().file.name` → `page.file.name`
- `dv.current().file.path` → `page.file.path`
- `dv.current().source_board` → `page.source_board`
- `dv.current().workstream` → `page.workstream`

If the 9 derefs span multiple methods, capture `page` once per method (do NOT hoist across methods). Keep all surrounding logic identical.

- [ ] **Step 1:** Read the file; identify the method(s) containing each dereferenced line; apply the capture-once recipe per method.
- [ ] **Step 2:** Run `node scripts/lint-cold-load.js 2>&1 | grep project-nav-buttons` → expected: no project-nav-buttons lines remain.
- [ ] **Step 3:** Run `node platform/test/run-project-render-guards.js` → expected: all PASS (the harness already stubs `dv.current()` returning undefined/null/file-less; capture-once must still early-return cleanly). If a stub path now routes through `customJS.RenderSafe`, ensure the harness provides a `customJS.RenderSafe` global or the helper tolerates its absence — prefer adding a minimal `global.customJS = { RenderSafe }` to the harness setup (load RenderSafe via the same `loadClass` pattern) so the real fallback is exercised.
- [ ] **Step 4:** Run `node platform/test/run-renderer.js` and `node platform/test/run-v0109-projects-overhaul.js` → expected: PASS (project render contracts intact).
- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/project/helpers/project-nav-buttons.js platform/test/run-project-render-guards.js
git commit -m "fix(project): capture-once RenderSafe in project-nav-buttons (cold-load gate)"
```

---

## Task 5: Convert scratch helpers (capture-once)

**Files:** `platform/blueprints/scratch/helpers/scratch-{day-actions,day-list,leaf-actions}.js`.

**Recipe:** Each helper reads `dv.current().day` (lines: day-actions 38, 41; day-list 52; leaf-actions 30, 33). These feed `this._coerceDay(...)` and a `_pollForDay` race-window loop. Capture the page once at the top of the method that owns the deref:

```js
const page = customJS.RenderSafe.page(dv);
let day = this._coerceDay(page && page.day);
```

Replace each `dv.current().day` with `(page && page.day)` (or capture `const rawDay = page && page.day;` once and reuse). Preserve the `_pollForDay` loop exactly — it still covers the Templater-processing race; RenderSafe only covers the cold-load null. If `_pollForDay` itself re-reads `dv.current().day`, capture inside its loop body via `RenderSafe.page(dv)?.day` (optional-chain is fine inside a poll).

- [ ] **Step 1:** Apply the recipe to all three files.
- [ ] **Step 2:** Run `node scripts/lint-cold-load.js 2>&1 | grep scratch` → expected: no scratch helper lines remain.
- [ ] **Step 3:** Run `node platform/test/run-scratch.js` → expected: PASS.
- [ ] **Step 4: Commit**

```bash
git add platform/blueprints/scratch/helpers/scratch-day-actions.js platform/blueprints/scratch/helpers/scratch-day-list.js platform/blueprints/scratch/helpers/scratch-leaf-actions.js
git commit -m "fix(scratch): capture-once RenderSafe for day resolution (cold-load gate)"
```

---

## Task 6: Convert trips helpers + backlink-panel mechanism

**Files:** `platform/blueprints/trips/helpers/trip-{nav-buttons,sections-cards}.js`, `platform/mechanisms/backlink-panel/backlink-panel.js`.

**Recipe (trips, capture-once):**
- `trip-sections-cards.js:3` `const filePath = dv.current().file.path;` → capture `const page = customJS.RenderSafe.page(dv); if (!page || !page.file) return; const filePath = page.file.path;`
- `trip-nav-buttons.js:19` `getFileCache(dv.current().file)` + `:47` `dv.current().file.path` → capture `const page = customJS.RenderSafe.page(dv);` once at the owning method top with `if (!page || !page.file) return;`, then `page.file` / `page.file.path`.

**Recipe (backlink-panel, optional-chain — NO new dep):** `backlink-panel.js:86`
`const currentFile = dv.current() && dv.current().file;` → `const currentFile = dv.current()?.file;`
(Optional-chain is equivalent to the existing `&&` guard and passes R1; backlink-panel does not gain a render-safe dep.)

- [ ] **Step 1:** Apply both recipes.
- [ ] **Step 2:** Run `node scripts/lint-cold-load.js 2>&1 | grep -E 'trip|backlink'` → expected: none remain.
- [ ] **Step 3:** Run `node platform/test/run-backlink-panel.js` and `node platform/test/run-renderer.js` → expected: PASS.
- [ ] **Step 4: Commit**

```bash
git add platform/blueprints/trips/helpers/trip-nav-buttons.js platform/blueprints/trips/helpers/trip-sections-cards.js platform/mechanisms/backlink-panel/backlink-panel.js
git commit -m "fix(trips,backlink-panel): cold-load-safe dv.current() access (gate)"
```

---

## Task 7: Convert templates/manifests + finance stragglers

**Files:** `platform/blueprints/people/templates/Template, People.md`, `platform/blueprints/people/manifest.json`, `platform/blueprints/scratch/templates/Scratch Day Hub.md`, `platform/blueprints/finance/templates/{Budget,Invoice,Paycheck} Template.md`.

**Recipe (optional-chain in template/manifest args):**
- `Template, People.md` lines 28, 37: `personLink: dv.current().file.link` → `personLink: dv.current()?.file?.link`.
- `people/manifest.json` inline_body (the `new_entity_buttons[].inline_body` with `## Meetings` + `## Daily Mentions`): both `dv.current().file.link` → `dv.current()?.file?.link`. Keep the template + manifest byte-aligned (same two edits).
- `Scratch Day Hub.md:26`: `args: [{ day: dv.current().day }]` → `args: [{ day: dv.current()?.day }]`.

**Recipe (finance stragglers → guard view):** In each finance template, the surrounding blocks already use `dv.view("ranch/views/customjs-guard", …)`. Convert the one bare line:
- `Budget Template.md:20` `await customJS.FinanceStatus.renderBadge(dv, "budget");` → `await dv.view("ranch/views/customjs-guard", { class: "FinanceStatus", method: "renderBadge", args: ["budget"] });`
- `Invoice Template.md:27` → same with `args: ["invoice"]`.
- `Paycheck Template.md:21` → same with `args: ["paycheck"]`.
(Guard calls `target.call(klass, dv, ...args)` → `renderBadge(dv, "budget")`. Arg order preserved.)

- [ ] **Step 1:** Apply all edits.
- [ ] **Step 2:** Run `node scripts/lint-cold-load.js` → **expected: now GREEN** (`no violations`). This is the moment the hard gate goes green.
- [ ] **Step 3:** Run `node platform/test/run-renderer.js` + `node platform/test/run-helper-cases.js` → expected: PASS (people/finance/scratch template source contracts intact; if an HC regex pinned the old bare form, update that case to the new guarded form — that is a legitimate contract move, not a version literal).
- [ ] **Step 4: Commit**

```bash
git add "platform/blueprints/people/templates/Template, People.md" platform/blueprints/people/manifest.json "platform/blueprints/scratch/templates/Scratch Day Hub.md" "platform/blueprints/finance/templates/Budget Template.md" "platform/blueprints/finance/templates/Invoice Template.md" "platform/blueprints/finance/templates/Paycheck Template.md"
git commit -m "fix(people,scratch,finance): optional-chain dv.current() + route stragglers through guard (gate GREEN)"
```

---

## Task 8: Retireable existing-note heal

**Files:** `platform/install.js` (add helper + wire it). Reference the existing v0.133 meetings heal for placement + history-entry conventions.

**Context:** Most render surfaces are template-materialized (refreshed every install) or live views, so deployed *notes* do not carry the buggy code. The exception is button-created `inline_body` content written INTO notes at creation (people person-notes; meetings already healed in v0.133). This heal generalizes the meetings fix to people notes, authored retireable for cycle A.

- [ ] **Step 1: Read** the existing v0.133 meetings dv.current heal in `platform/install.js` (grep for `dv.current` / the meeting heal function) to mirror its scan + `.sauce-backup` + history conventions.

- [ ] **Step 2: Add** `applyPeopleInlineDvGuardHeal(tp, bp, variables, history, git)` near the meetings heal. Skeleton:

```js
// CYCLE-A-RETIREABLE: lift into the migration-retirement registry; gate on
// consumers passing the cold-load-eradication release. Idempotent; .sauce-backup
// before write; failure-loud history under step: people_inline_dv_guard_heal.
// Heals person notes whose button-written inline_body carries a bare
// `dv.current().file.link` (pre-render-safe). Rewrites to dv.current()?.file?.link.
async function applyPeopleInlineDvGuardHeal(tp, bp, variables, history, git) {
  const BARE = /dv\.current\(\)\.file\.link/g;
  const SAFE = 'dv.current()?.file?.link';
  // walk spice/<people module_dir>/**/*.md via the same vault-walk helper the
  // meetings heal uses; for each file whose body matches BARE and is NOT already
  // optional-chained, write body.replace(BARE, SAFE) with a .sauce-backup snapshot
  // and a history entry { step: 'people_inline_dv_guard_heal', action, path }.
}
```

- [ ] **Step 3: Wire** the call into the people-blueprint install branch alongside the other people heals (match how `applyProjectMeetingsPanelHeal` / the meetings dv heal are invoked).

- [ ] **Step 4:** Run `node platform/install.js --vault . --auto-approve` (workshop dogfood) → expected: exit 0; heal is a no-op on the workshop (no buggy person notes), recorded as `action: skipped`/zero-write in history. Run `node platform/test/run-install.js .` → expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/install.js
git commit -m "fix(install): retireable heal for people-note inline dv.current() (cold-load)"
```

---

## Task 9: HC source-contract cases + full green-up

**Files:** `platform/test/run-helper-cases.js`.

- [ ] **Step 1:** Add an `HC-V01340-RS-*` block (mirror an existing manifest-presence HC family) asserting: (a) `platform/mechanisms/render-safe/manifest.json` exists with `name: "render-safe"`, `version: "0.1.0"`, `customjs_classes` includes `"RenderSafe"`; (b) the catalogue `platform/manifest.json` mechanisms[] contains render-safe; (c) `ranch/platform-subscription.json` subscribes it; (d) `render-safe.js` defines `class RenderSafe` with static `page`/`filePath`/`fileName`; (e) a no-bare-deref assertion: `platform/blueprints/{project,scratch,trips}/helpers/*.js` contain no `dv.current().` (regex `/dv\.current\(\)\s*\./`).

- [ ] **Step 2:** Run `node platform/test/run-helper-cases.js` → expected: PASS (new cases green).

- [ ] **Step 3: Full preflight + dogfood** (the bars):

```bash
npm run release:preflight
node platform/install.js --vault . --auto-approve
```
Expected: preflight whole-suite GREEN (incl. `lint-cold-load` self-test + full scan green); dogfood exit 0. Fix any residual failure at its root (do not hand-edit version literals / counts — investigate the helper).

- [ ] **Step 4: Commit**

```bash
git add platform/test/run-helper-cases.js
git commit -m "test(render-safe): HC source-contract cases + no-bare-deref assertion"
```

---

## Task 10: PR — green CI, rebased on main, NO merge

- [ ] **Step 1:** Ensure rebased on latest main:

```bash
git fetch origin main
git rebase origin/main   # resolve conflicts if any; re-run npm run release:preflight after
```

- [ ] **Step 2:** Push the branch:

```bash
git push -u origin cycle/cold-load-eradication
```

- [ ] **Step 3:** Open the PR (body summarizes the cycle; `🤖 Generated with Claude Code` footer; NO Claude co-author trailer on commits per workshop rule):

```bash
gh pr create --base main --head cycle/cold-load-eradication --title "Cold-load eradication: render-safe mechanism + build-failing gate" --body "<summary + design link + test evidence>"
```

- [ ] **Step 4:** Wait for CI (`preflight (macos-latest)` + `preflight (ubuntu-latest)`) to go GREEN:

```bash
gh pr checks --watch
```

- [ ] **Step 5: STOP.** Do NOT merge. Do NOT tag. Do NOT deploy to consumer vaults. Report: PR URL, CI green, rebased on main.

---

## Self-review notes (filled during writing)

- **Spec coverage:** render-safe mechanism (T1) ✓; lint gate + no baseline (T3) ✓; capture-once helper conversion (T4-6) ✓; template/manifest optional-chain + stragglers (T7) ✓; retireable heal (T8) ✓; wiring incl. wizard-default + depends_on (T2) ✓; RenderSafe harness + HC + render-guard (T1,T9,T4) ✓; PR/CI/rebase, no deploy (T10) ✓.
- **Type consistency:** `RenderSafe.page/filePath/fileName` used identically across T1 harness, conversions, HC. Capture variable named `page` throughout.
- **Ordering:** wiring proven (T2) before conversions; gate RED (T3) before conversions; gate GREEN asserted at end of T7; full preflight at T9.
- **Hazards flagged in-task:** fresh-vault skip (T2 step 5), HC pinned-to-bare-form regex (T7 step 3), harness needs a `customJS.RenderSafe` global (T4 step 3), never hand-edit version literals/counts (T2,T9).
```
