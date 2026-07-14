# Reader Article Paste-Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user paste a Web-Clipper "Copy" payload (YAML frontmatter + body) into the reader-hub's "+ New article" dialog and get a fully-populated reader-article note, while empty/manual title+url creation keeps working exactly as before.

**Architecture:** A new reader-local `ReaderArticlePaste` customJS class owns all paste parsing (`parse`), field→presetPrompts mapping (`buildPresetPrompts`), title validation (`validateTitle`), and the single paste+title+url dialog (`open`). It feeds the *unchanged* shared `entity-create` mechanism via `EC.create({instance:'reader-article', dv, presetPrompts})`. The manifest gains preset-only prompt keys; the `Reader Article.md` body template gains `{{prompts.highlights}}`/`{{prompts.content}}` tokens; the "+ New article" button opens the new dialog instead of calling `EC.create` directly.

**Tech Stack:** CustomJS bare-class helpers (Node-testable statics), Obsidian Dataview/entity-create mechanism, JSON blueprint manifest, Node test harness (`platform/test/run-*.js`).

**Design doc:** `Docs/plans/2026-07-12-reader-article-paste-flow-design.md`

**Landmine compliance (apply to every code task):**
- **Bare class only** — `reader-article-paste.js` is ONE `class ReaderArticlePaste { … }` expression, no trailing statements (CustomJS evals the file as one expression; a trailer means the class never registers). Node-test via `new Function(src + "\nreturn ReaderArticlePaste;")()`.
- **Cold-load safety (landmines #1–#5)** — `parse`/`buildPresetPrompts`/`validateTitle` are pure statics that never touch DOM/`app`/`dv`. `open(dv)` reaches other classes via `window.customJS?.X` and never throws.
- **`{{template_variables}}` for all paths** in manifest `files[]` (`{{scripts_path}}/reader/reader-article-paste.js`).
- **JSON not YAML** for `manifest.json`.
- **No manual version bumps** — conventional commits only; the release pipeline bumps `reader`.

---

### Task 1: `parse` — well-formed clip payload (frontmatter + markers)

**Files:**
- Create: `platform/test/run-reader-article-paste.js`
- Create: `platform/blueprints/reader/helpers/reader-article-paste.js`

- [ ] **Step 1: Write the failing test harness**

Create `platform/test/run-reader-article-paste.js`:

```javascript
#!/usr/bin/env node
/**
 * run-reader-article-paste.js — behavioral harness for ReaderArticlePaste.
 *
 * Exercises the PURE statics only (parse / buildPresetPrompts / validateTitle);
 * the browser-side open(dv) dialog is covered by a source-structure guard here
 * and by manual dogfood verification. Loads via new Function(...) to prove the
 * file evals as ONE bare class expression (CustomJS loader contract).
 *
 * Asserts HC-READER-PASTE-N.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'platform', 'blueprints', 'reader', 'helpers', 'reader-article-paste.js');

function loadClass(srcPath, className) {
  const src = fs.readFileSync(srcPath, 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}
const ReaderArticlePaste = loadClass(SRC, 'ReaderArticlePaste');

const results = [];
const ok = (name, cond, msg) => {
  results.push([name, !!cond]);
  console.log(`  ${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : (msg ? ' :: ' + msg : '')}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A faithful Web-Clipper "Copy" payload: frontmatter + chrome + both markers.
const CLIP = [
  '---',
  'type: reader-article',
  'title: "The Bitter Lesson"',
  'url: "http://www.incompleteideas.net/IncIdeas/BitterLesson.html"',
  'author: "Rich Sutton"',
  'site: "incompleteideas.net"',
  'published: 2019-03-13',
  'captured_at: 2026-07-12T10:00:00Z',
  'word_count: 1200',
  'status: unread',
  'summary: "Compute beats cleverness over the long run."',
  'tags: [ai, rl]',
  '---',
  '',
  '```dataviewjs',
  'await dv.view("x", { class: "ReaderChromeBar" });',
  '```',
  '',
  '[//]: # (READER_HIGHLIGHTS)',
  '',
  'A highlighted sentence.',
  '',
  '[//]: # (READER_CONTENT)',
  '',
  'The full article body goes here.',
  '',
].join('\n');

// ---------------------------------------------------------------------------
// HC-READER-PASTE-1 — well-formed clip parses fm + highlights/content split.
// ---------------------------------------------------------------------------
{
  const r = ReaderArticlePaste.parse(CLIP);
  ok('HC-READER-PASTE-1 well-formed clip → frontmatter parsed, not malformed',
     r && r.malformed === false &&
     r.frontmatter.title === 'The Bitter Lesson' &&
     r.frontmatter.author === 'Rich Sutton' &&
     r.frontmatter.word_count === '1200' &&
     eq(r.frontmatter.tags, ['ai', 'rl']),
     JSON.stringify(r && r.frontmatter));
  ok('HC-READER-PASTE-1b highlights + content split on marker comments',
     r && /A highlighted sentence\./.test(r.highlights) &&
     /full article body/.test(r.content) &&
     !/full article body/.test(r.highlights),
     `hl=${JSON.stringify(r && r.highlights)} content=${JSON.stringify(r && r.content)}`);
}

const passed = results.filter(([, p]) => p).length;
const total = results.length;
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-reader-article-paste.js`
Expected: FAIL — throws `ReferenceError: ReaderArticlePaste is not defined` (the helper file doesn't exist yet), non-zero exit.

- [ ] **Step 3: Write minimal implementation**

Create `platform/blueprints/reader/helpers/reader-article-paste.js`:

```javascript
/**
 * ReaderArticlePaste (CustomJS) — the reader-hub's "+ New article" paste dialog.
 *
 * Lets a user paste a Web-Clipper "Copy" payload (YAML frontmatter + body with
 * READER_HIGHLIGHTS / READER_CONTENT markers) into one dialog that also carries
 * editable Title + URL inputs. Parsed fields are injected into the UNCHANGED
 * shared entity-create mechanism via EC.create({instance, dv, presetPrompts}),
 * whose presetPrompts short-circuit skips entity-create's own UI + validation
 * for every supplied key. Malformed pastes fall back to "whole paste = content,
 * manual Title required" — the flow never blocks or errors.
 *
 * PURE STATICS (Node-testable, no DOM/app/dv):
 *   ReaderArticlePaste.parse(raw)               → { frontmatter, highlights, content, malformed }
 *   ReaderArticlePaste.buildPresetPrompts(p, m) → { title, url, author, ... } for EC.create
 *   ReaderArticlePaste.validateTitle(title)     → error string | null
 *
 * BROWSER-SIDE:
 *   ReaderArticlePaste.open(dv)  ← opens the dialog, wires Create → EC.create
 *
 * COLD-LOAD SAFETY (landmines #1-5): statics never touch the DOM; open() reaches
 * other classes via window.customJS?.X and never throws.
 *
 * BARE CLASS ONLY — no trailing statements (CustomJS evals the file as ONE
 * expression). Node-test via new Function(src + "\nreturn ReaderArticlePaste;")().
 */
class ReaderArticlePaste {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------
    parse(raw) { return ReaderArticlePaste.parse(raw); }
    buildPresetPrompts(parsed, manual) { return ReaderArticlePaste.buildPresetPrompts(parsed, manual); }
    validateTitle(title) { return ReaderArticlePaste.validateTitle(title); }
    open(dv) { return ReaderArticlePaste.open(dv); }

    // ---------- parse: raw paste → { frontmatter, highlights, content, malformed } ----------
    static parse(raw) {
        const text = (typeof raw === 'string') ? raw : '';
        const empty = { frontmatter: {}, highlights: '', content: '', malformed: true };
        try {
            // Frontmatter must be a leading --- … --- block.
            const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
            if (!m) { return { frontmatter: {}, highlights: '', content: text, malformed: true }; }
            const fm = ReaderArticlePaste._parseFrontmatter(m[1]);
            if (!fm || typeof fm.title !== 'string' || fm.title.trim() === '') {
                // Frontmatter block present but no usable title → treat as malformed.
                return { frontmatter: {}, highlights: '', content: text, malformed: true };
            }
            const body = m[2] || '';
            const { highlights, content } = ReaderArticlePaste._splitBody(body);
            return { frontmatter: fm, highlights, content, malformed: false };
        } catch (_e) {
            return { frontmatter: {}, highlights: '', content: text, malformed: true };
        }
    }

    // Minimal, shape-scoped frontmatter parser (NOT general YAML): flat
    // `key: value` scalars + one `tags:` array (inline [a, b] or bulleted list).
    static _parseFrontmatter(block) {
        const out = {};
        const lines = String(block).split(/\r?\n/);
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            const km = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
            if (!km) { i++; continue; }
            const key = km[1];
            let val = km[2];
            if (key === 'tags') {
                const inline = val.match(/^\[(.*)\]$/);
                if (inline) {
                    out.tags = inline[1].split(',').map((s) => ReaderArticlePaste._unquote(s.trim())).filter((s) => s !== '');
                    i++;
                    continue;
                }
                if (val.trim() === '') {
                    // Bulleted list on following `- ` lines.
                    const arr = [];
                    let j = i + 1;
                    while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
                        arr.push(ReaderArticlePaste._unquote(lines[j].replace(/^\s*-\s+/, '').trim()));
                        j++;
                    }
                    out.tags = arr.filter((s) => s !== '');
                    i = j;
                    continue;
                }
                out.tags = [ReaderArticlePaste._unquote(val.trim())].filter((s) => s !== '');
                i++;
                continue;
            }
            out[key] = ReaderArticlePaste._unquote(val.trim());
            i++;
        }
        return out;
    }

    static _unquote(s) {
        if (typeof s !== 'string') return s;
        const t = s.trim();
        if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
            return t.slice(1, -1);
        }
        return t;
    }

    // Split a body on the READER_HIGHLIGHTS / READER_CONTENT marker comments.
    static _splitBody(body) {
        const HL = /\[\/\/\]:\s*#\s*\(READER_HIGHLIGHTS\)/;
        const CT = /\[\/\/\]:\s*#\s*\(READER_CONTENT\)/;
        const hlIdx = body.search(HL);
        const ctIdx = body.search(CT);
        if (ctIdx === -1) {
            // No content marker: post-frontmatter remainder is all content.
            return { highlights: '', content: body.trim() };
        }
        const ctMarkerLen = (body.slice(ctIdx).match(CT) || [''])[0].length;
        const contentRaw = body.slice(ctIdx + ctMarkerLen);
        let highlights = '';
        if (hlIdx !== -1 && hlIdx < ctIdx) {
            const hlMarkerLen = (body.slice(hlIdx).match(HL) || [''])[0].length;
            highlights = body.slice(hlIdx + hlMarkerLen, ctIdx);
        }
        return { highlights: highlights.trim(), content: contentRaw.trim() };
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-reader-article-paste.js`
Expected: PASS — `2/2 passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/test/run-reader-article-paste.js platform/blueprints/reader/helpers/reader-article-paste.js
git commit -m "feat(reader): add ReaderArticlePaste.parse for clip-payload paste parsing"
```

---

### Task 2: `parse` — fallback paths (no frontmatter / no markers / empty / malformed)

**Files:**
- Modify: `platform/test/run-reader-article-paste.js`

- [ ] **Step 1: Write the failing tests** — append before the verdict block:

```javascript
// ---------------------------------------------------------------------------
// HC-READER-PASTE-2 — frontmatter but NO markers → whole remainder = content.
// ---------------------------------------------------------------------------
{
  const noMarkers = ['---', 'title: "Plain"', 'url: "http://x.test"', '---', '', 'Just body text, no markers.'].join('\n');
  const r = ReaderArticlePaste.parse(noMarkers);
  ok('HC-READER-PASTE-2 frontmatter + no markers → not malformed, content=remainder, highlights empty',
     r.malformed === false && r.highlights === '' &&
     /Just body text, no markers\./.test(r.content) && r.frontmatter.title === 'Plain',
     JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// HC-READER-PASTE-3 — no frontmatter at all → malformed, whole input = content.
// ---------------------------------------------------------------------------
{
  const raw = 'This is just pasted text with no YAML frontmatter.';
  const r = ReaderArticlePaste.parse(raw);
  ok('HC-READER-PASTE-3 no frontmatter → malformed, whole input as content',
     r.malformed === true && eq(r.frontmatter, {}) && r.content === raw && r.highlights === '',
     JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// HC-READER-PASTE-4 — empty / whitespace / non-string → malformed, empty content.
// ---------------------------------------------------------------------------
{
  const a = ReaderArticlePaste.parse('');
  const b = ReaderArticlePaste.parse(null);
  const c = ReaderArticlePaste.parse(undefined);
  ok('HC-READER-PASTE-4 empty/null/undefined → malformed, no throw',
     a.malformed === true && a.content === '' &&
     b.malformed === true && b.content === '' &&
     c.malformed === true && c.content === '',
     `${JSON.stringify(a)} ${JSON.stringify(b)}`);
}

// ---------------------------------------------------------------------------
// HC-READER-PASTE-5 — frontmatter block present but no title key → malformed.
// ---------------------------------------------------------------------------
{
  const noTitle = ['---', 'url: "http://x.test"', 'status: unread', '---', '', 'body'].join('\n');
  const r = ReaderArticlePaste.parse(noTitle);
  ok('HC-READER-PASTE-5 fm without title → malformed, whole input as content',
     r.malformed === true && r.content === noTitle,
     JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// HC-READER-PASTE-6 — never throws on adversarial input.
// ---------------------------------------------------------------------------
{
  let threw = false;
  try {
    ReaderArticlePaste.parse('---\n:::not yaml:::\n[[[\n---\nbody');
    ReaderArticlePaste.parse('---\n---');
    ReaderArticlePaste.parse(12345);
    ReaderArticlePaste.parse({});
  } catch (_e) { threw = true; }
  ok('HC-READER-PASTE-6 adversarial input never throws', !threw, `threw=${threw}`);
}
```

- [ ] **Step 2: Run test to verify current state**

Run: `node platform/test/run-reader-article-paste.js`
Expected: All new HC-READER-PASTE-2..6 PASS already (Task 1's `parse` handles these). If any FAIL, fix `parse`/`_parseFrontmatter`/`_splitBody` in `reader-article-paste.js` until green — do not weaken the tests.
Expected final: `7/7 passed`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add platform/test/run-reader-article-paste.js platform/blueprints/reader/helpers/reader-article-paste.js
git commit -m "test(reader): cover ReaderArticlePaste.parse fallback + never-throw paths"
```

---

### Task 3: `validateTitle` — required + safe-filename

**Files:**
- Modify: `platform/test/run-reader-article-paste.js`
- Modify: `platform/blueprints/reader/helpers/reader-article-paste.js`

- [ ] **Step 1: Write the failing tests** — append before the verdict block:

```javascript
// ---------------------------------------------------------------------------
// HC-READER-PASTE-7 — validateTitle mirrors the manifest safe-filename prompt.
// ---------------------------------------------------------------------------
{
  ok('HC-READER-PASTE-7a empty/whitespace title → error',
     typeof ReaderArticlePaste.validateTitle('') === 'string' &&
     typeof ReaderArticlePaste.validateTitle('   ') === 'string' &&
     typeof ReaderArticlePaste.validateTitle(null) === 'string');
  ok('HC-READER-PASTE-7b filesystem-unsafe chars → error',
     typeof ReaderArticlePaste.validateTitle('a/b') === 'string' &&
     typeof ReaderArticlePaste.validateTitle('bad:name') === 'string' &&
     typeof ReaderArticlePaste.validateTitle('q?mark') === 'string');
  ok('HC-READER-PASTE-7c ordinary title → null (valid)',
     ReaderArticlePaste.validateTitle('The Bitter Lesson') === null &&
     ReaderArticlePaste.validateTitle('A note, with punctuation!') === null);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-reader-article-paste.js`
Expected: FAIL — `validateTitle` returns `undefined` (not implemented), assertions false.

- [ ] **Step 3: Implement `validateTitle`** — add this static method inside the class in `reader-article-paste.js`, after `_splitBody`:

```javascript
    // Mirror the manifest's `title` prompt: required + safe-filename. Returns an
    // error string when invalid, or null when OK. (entity-create's presetPrompts
    // short-circuit skips its own validation for preset keys, so the dialog must
    // enforce this itself before calling EC.create.)
    static validateTitle(title) {
        if (typeof title !== 'string' || title.trim() === '') return 'Article title is required.';
        // Forbid path/filesystem-hostile characters (matches safe-filename intent).
        if (/[\\/:*?"<>|]/.test(title)) return 'Article title contains an invalid character (\\ / : * ? " < > |).';
        return null;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-reader-article-paste.js`
Expected: PASS — `10/10 passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/test/run-reader-article-paste.js platform/blueprints/reader/helpers/reader-article-paste.js
git commit -m "feat(reader): add ReaderArticlePaste.validateTitle (required + safe-filename)"
```

---

### Task 4: `buildPresetPrompts` — full mapping + defaults

**Files:**
- Modify: `platform/test/run-reader-article-paste.js`
- Modify: `platform/blueprints/reader/helpers/reader-article-paste.js`

- [ ] **Step 1: Write the failing tests** — append before the verdict block:

```javascript
// ---------------------------------------------------------------------------
// HC-READER-PASTE-8 — buildPresetPrompts maps a full parsed clip → all keys.
// ---------------------------------------------------------------------------
{
  const parsed = ReaderArticlePaste.parse(CLIP);
  const pp = ReaderArticlePaste.buildPresetPrompts(parsed, { title: 'The Bitter Lesson', url: 'http://x.test' });
  ok('HC-READER-PASTE-8 full mapping populates every preset key from parsed clip',
     pp.title === 'The Bitter Lesson' &&
     pp.url === 'http://x.test' &&
     pp.author === 'Rich Sutton' &&
     pp.site === 'incompleteideas.net' &&
     pp.published === '2019-03-13' &&
     pp.captured_at === '2026-07-12T10:00:00Z' &&
     pp.word_count === '1200' &&
     pp.status === 'unread' &&
     /Compute beats cleverness/.test(pp.summary) &&
     eq(pp.tags, ['ai', 'rl']) &&
     /A highlighted sentence\./.test(pp.highlights) &&
     /full article body/.test(pp.content),
     JSON.stringify(pp));
}

// ---------------------------------------------------------------------------
// HC-READER-PASTE-9 — empty/malformed parsed → today's manifest defaults.
// ---------------------------------------------------------------------------
{
  const parsed = ReaderArticlePaste.parse('');       // malformed, empty content
  const pp = ReaderArticlePaste.buildPresetPrompts(parsed, { title: 'Manual Only', url: '' });
  ok('HC-READER-PASTE-9 malformed/empty parse → manifest-equivalent defaults',
     pp.title === 'Manual Only' &&
     pp.url === '' &&
     pp.author === '' && pp.site === '' && pp.published === '' &&
     pp.summary === '' && pp.highlights === '' && pp.content === '' &&
     pp.word_count === 0 &&
     pp.status === 'unread' &&
     eq(pp.tags, ['reader-article']) &&
     typeof pp.captured_at === 'string' && pp.captured_at.length > 0,
     JSON.stringify(pp));
}

// ---------------------------------------------------------------------------
// HC-READER-PASTE-10 — malformed paste routes whole text into `content`.
// ---------------------------------------------------------------------------
{
  const raw = 'raw pasted article body, no frontmatter';
  const parsed = ReaderArticlePaste.parse(raw);
  const pp = ReaderArticlePaste.buildPresetPrompts(parsed, { title: 'Fallback', url: '' });
  ok('HC-READER-PASTE-10 malformed paste → whole text becomes content preset',
     pp.content === raw && pp.title === 'Fallback',
     JSON.stringify(pp));
}

// ---------------------------------------------------------------------------
// HC-READER-PASTE-11 — captured_at prefers parsed value, else JS-now ISO.
// ---------------------------------------------------------------------------
{
  const withCap = ReaderArticlePaste.buildPresetPrompts(
    ReaderArticlePaste.parse(CLIP), { title: 'x', url: '' });
  const noCap = ReaderArticlePaste.buildPresetPrompts(
    ReaderArticlePaste.parse('---\ntitle: "N"\n---\nbody'), { title: 'N', url: '' });
  ok('HC-READER-PASTE-11 captured_at: parsed wins, else ISO-now fallback',
     withCap.captured_at === '2026-07-12T10:00:00Z' &&
     /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(noCap.captured_at),
     `${withCap.captured_at} | ${noCap.captured_at}`);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-reader-article-paste.js`
Expected: FAIL — `buildPresetPrompts` returns `undefined`, assertions false.

- [ ] **Step 3: Implement `buildPresetPrompts`** — add this static method inside the class in `reader-article-paste.js`, after `validateTitle`:

```javascript
    // Map a parse() result + the dialog's (possibly edited) title/url inputs into
    // the presetPrompts object EC.create consumes. Every key here MUST also exist
    // in the manifest's new_entity_buttons[0].prompts[] so {{prompts.<key>}} can
    // resolve. Defaults mirror today's manifest frontmatter_template so an empty
    // paste yields a note byte-equivalent to the old title+url-only path.
    static buildPresetPrompts(parsed, manual) {
        const p = (parsed && parsed.frontmatter) ? parsed.frontmatter : {};
        const m = manual || {};
        const str = (v, d) => (typeof v === 'string' && v !== '') ? v : d;
        let tags = ['reader-article'];
        if (Array.isArray(p.tags) && p.tags.length > 0) tags = p.tags;
        let captured = str(p.captured_at, '');
        if (captured === '') {
            try { captured = new Date().toISOString(); } catch (_e) { captured = ''; }
        }
        return {
            title: str(m.title, ''),
            url: str(m.url, ''),
            author: str(p.author, ''),
            site: str(p.site, ''),
            published: str(p.published, ''),
            captured_at: captured,
            word_count: (typeof p.word_count === 'string' && p.word_count !== '') ? p.word_count : 0,
            status: str(p.status, 'unread'),
            summary: str(p.summary, ''),
            tags: tags,
            highlights: str(parsed && parsed.highlights, ''),
            content: str(parsed && parsed.content, ''),
        };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-reader-article-paste.js`
Expected: PASS — `14/14 passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/test/run-reader-article-paste.js platform/blueprints/reader/helpers/reader-article-paste.js
git commit -m "feat(reader): add ReaderArticlePaste.buildPresetPrompts field mapping"
```

---

### Task 5: `open(dv)` — the paste dialog (browser-side)

**Files:**
- Modify: `platform/blueprints/reader/helpers/reader-article-paste.js`
- Modify: `platform/test/run-reader-article-paste.js`

- [ ] **Step 1: Write the failing source-structure guard** — append before the verdict block:

```javascript
// ---------------------------------------------------------------------------
// HC-READER-PASTE-12 — open() exists, is guarded, and wires EC.create.
// (Source-structure guard: the DOM dialog is verified manually in dogfood; here
//  we assert the wiring contract so a refactor can't silently drop it.)
// ---------------------------------------------------------------------------
{
  const src = fs.readFileSync(SRC, 'utf8');
  ok('HC-READER-PASTE-12a open() reaches EntityCreate via window.customJS guard',
     /window\.customJS[\s\S]*EntityCreate/.test(src) &&
     /EC\.create\(\s*\{[\s\S]*instance:\s*'reader-article'[\s\S]*presetPrompts/.test(src),
     'missing guarded EC.create({instance,dv,presetPrompts})');
  ok('HC-READER-PASTE-12b open() validates title before create',
     /validateTitle/.test(src),
     'open() must call validateTitle before EC.create');
  ok('HC-READER-PASTE-12c file evals as ONE bare class (loads via new Function)',
     typeof ReaderArticlePaste === 'function' && ReaderArticlePaste.name === 'ReaderArticlePaste');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-reader-article-paste.js`
Expected: FAIL — `open()` not yet implemented, regexes don't match.

- [ ] **Step 3: Implement `open(dv)`** — add this static method inside the class in `reader-article-paste.js`, after `buildPresetPrompts`. It mirrors entity-create's `_promptText` modal shell (overlay + dialog + accent Create button + Escape/backdrop close), adding a large paste textarea above the Title/URL inputs:

```javascript
    // Open the single "+ New article" dialog: a large paste textarea + editable
    // Title + URL inputs + Cancel/Create. Pasting into the textarea auto-fills
    // Title/URL from the parsed frontmatter (fields stay editable). Create
    // validates the title, then hands every field to entity-create via
    // presetPrompts. Never throws; degrades to a Notice if EntityCreate is absent.
    static open(dv) {
        try {
            const EC = (typeof window !== 'undefined') && window.customJS && window.customJS.EntityCreate;
            if (!EC || typeof EC.create !== 'function') {
                try { new Notice('ReaderArticlePaste: EntityCreate mechanism unavailable.', 8000); } catch (_e) {}
                return;
            }

            const overlay = document.createElement('div');
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;';
            const dialog = document.createElement('div');
            dialog.style.cssText = 'background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 340px; max-width: 560px; width: 90%; box-shadow: 0 8px 32px rgba(0,0,0,0.3);';

            const heading = document.createElement('div');
            heading.textContent = 'New article';
            heading.style.cssText = 'font-size: 1.1em; font-weight: 600; margin-bottom: 4px;';
            dialog.appendChild(heading);

            const hint = document.createElement('div');
            hint.textContent = 'Paste a Web Clipper "Copy" here — or leave empty and just name it.';
            hint.style.cssText = 'font-size: 0.8em; color: var(--text-muted); margin-bottom: 12px;';
            dialog.appendChild(hint);

            const paste = document.createElement('textarea');
            paste.rows = 8;
            paste.placeholder = 'Paste article frontmatter + body…';
            paste.style.cssText = 'width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 0.9em; font-family: var(--font-monospace); resize: vertical; margin-bottom: 12px;';
            dialog.appendChild(paste);

            const mkField = (labelText, type) => {
                const wrap = document.createElement('div');
                wrap.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';
                const lab = document.createElement('label');
                lab.textContent = labelText;
                lab.style.cssText = 'font-size: 0.85em; color: var(--text-muted); flex: 0 0 60px;';
                const input = document.createElement('input');
                input.type = type;
                input.style.cssText = 'flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;';
                wrap.appendChild(lab); wrap.appendChild(input);
                dialog.appendChild(wrap);
                return input;
            };
            const titleInput = mkField('Title', 'text');
            const urlInput = mkField('URL', 'text');

            const status = document.createElement('div');
            status.style.cssText = 'font-size: 0.8em; color: var(--text-error); min-height: 1.2em; margin: 4px 0 12px 0;';
            dialog.appendChild(status);

            // Live paste parse → auto-fill Title/URL (stay editable afterward).
            let lastParsed = ReaderArticlePaste.parse('');
            const reparse = () => {
                lastParsed = ReaderArticlePaste.parse(paste.value);
                const fm = lastParsed.frontmatter || {};
                if (typeof fm.title === 'string' && fm.title !== '') titleInput.value = fm.title;
                if (typeof fm.url === 'string' && fm.url !== '') urlInput.value = fm.url;
            };
            paste.addEventListener('input', reparse);
            paste.addEventListener('paste', () => setTimeout(reparse, 0));

            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.style.cssText = 'padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted);';
            const close = () => { if (overlay.parentNode) document.body.removeChild(overlay); };
            cancelBtn.onclick = () => close();

            const okBtn = document.createElement('button');
            okBtn.textContent = 'Create';
            okBtn.style.cssText = 'padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent);';
            okBtn.onclick = () => {
                const err = ReaderArticlePaste.validateTitle(titleInput.value);
                if (err) { status.textContent = err; return; }
                const presetPrompts = ReaderArticlePaste.buildPresetPrompts(lastParsed, {
                    title: titleInput.value, url: urlInput.value,
                });
                close();
                try { EC.create({ instance: 'reader-article', dv: dv, presetPrompts: presetPrompts }); }
                catch (e) { try { new Notice('ReaderArticlePaste: could not create article — ' + e.message, 8000); } catch (_e) {} }
            };

            dialog.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') { e.preventDefault(); cancelBtn.click(); }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); okBtn.click(); }
            });

            btnRow.appendChild(cancelBtn); btnRow.appendChild(okBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) cancelBtn.click(); });
            document.body.appendChild(overlay);
            setTimeout(() => paste.focus(), 0);
        } catch (_e) {
            try { new Notice('ReaderArticlePaste: dialog error.', 6000); } catch (_e2) {}
        }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node platform/test/run-reader-article-paste.js`
Expected: PASS — `17/17 passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add platform/test/run-reader-article-paste.js platform/blueprints/reader/helpers/reader-article-paste.js
git commit -m "feat(reader): add ReaderArticlePaste.open single paste+title+url dialog"
```

---

### Task 6: Register the class + preset prompts + frontmatter template in the manifest

**Files:**
- Modify: `platform/blueprints/reader/manifest.json`

- [ ] **Step 1: Add the class to `customjs_classes[]`.** Find:

```json
 "customjs_classes": [
```

The array currently ends `…, "ReaderChromeBar"]` (single-line, per the earlier grep at manifest line 79). Add `"ReaderArticlePaste"` as the last element so it reads `…, "ReaderChromeBar", "ReaderArticlePaste"]`. Preserve exact existing formatting/whitespace of that array.

- [ ] **Step 2: Add the `files[]` entry.** The `files[]` array (manifest line ~85) already has entries like:

```json
        { "source": "helpers/reader-chrome-bar.js", "target": "{{scripts_path}}/reader/reader-chrome-bar.js" }
```

Add, immediately after the `reader-chrome-bar.js` entry (matching the exact object shape + key order + trailing-comma style of the surrounding entries):

```json
        { "source": "helpers/reader-article-paste.js", "target": "{{scripts_path}}/reader/reader-article-paste.js" }
```

- [ ] **Step 3: Extend `new_entity_buttons[0].prompts[]`** (manifest lines ~157-171). It currently holds only `title` and `url`. After the existing `url` prompt object, add these 10 preset-only prompt objects (each optional, no `validate` — they are only ever reached via `presetPrompts`, but must exist so `{{prompts.<key>}}` resolves):

```json
        { "key": "author", "label": "Author", "type": "string", "required": false },
        { "key": "site", "label": "Site", "type": "string", "required": false },
        { "key": "published", "label": "Published", "type": "string", "required": false },
        { "key": "captured_at", "label": "Captured at", "type": "string", "required": false },
        { "key": "word_count", "label": "Word count", "type": "number", "required": false },
        { "key": "status", "label": "Status", "type": "string", "required": false },
        { "key": "summary", "label": "Summary", "type": "string", "required": false },
        { "key": "tags", "label": "Tags", "type": "multitext", "required": false },
        { "key": "highlights", "label": "Highlights", "type": "string", "required": false },
        { "key": "content", "label": "Content", "type": "string", "required": false }
```

Match the exact indentation and inline-object style of the existing `title`/`url` prompt objects in the file; ensure the array's comma placement stays valid (the previously-last `url` object needs a trailing comma once these follow it).

- [ ] **Step 4: Update `frontmatter_template`** (manifest lines ~176-186). Replace the existing block:

```json
      "frontmatter_template": {
        "type": "reader-article",
        "title": "{{prompts.title}}",
        "status": "unread",
        "url": "{{prompts.url}}",
        "summary": "",
        "captured_at": "{{now.YYYY-MM-DDTHH:mm:ssZ}}",
        "tags": [
          "reader-article"
        ]
      },
```

with:

```json
      "frontmatter_template": {
        "type": "reader-article",
        "title": "{{prompts.title}}",
        "status": "{{prompts.status}}",
        "url": "{{prompts.url}}",
        "author": "{{prompts.author}}",
        "site": "{{prompts.site}}",
        "published": "{{prompts.published}}",
        "word_count": "{{prompts.word_count}}",
        "summary": "{{prompts.summary}}",
        "captured_at": "{{prompts.captured_at}}",
        "tags": "{{prompts.tags}}"
      },
```

(`tags` becomes a `{{prompts.tags}}` scalar token — entity-create renders a `multitext` prompt value as a YAML list; `buildPresetPrompts` always supplies an array, so this materializes correctly. Verify against Step 6's test.)

- [ ] **Step 5: Validate JSON syntax.**

Run: `node -e "JSON.parse(require('fs').readFileSync('platform/blueprints/reader/manifest.json','utf8')); console.log('manifest OK')"`
Expected: `manifest OK` (no parse error).

- [ ] **Step 6: Run the entity-create + reader harnesses to confirm no manifest regression.**

Run: `node platform/test/run-entity-create.js && node platform/test/run-reader.js && node platform/test/run-reader-chrome-bar.js`
Expected: all PASS (exit 0). If `run-entity-create.js` validates blueprint manifests and objects to the new `multitext`/token shapes, read its failure, and adjust the `frontmatter_template`/`prompts` entries to the shape it expects (do NOT weaken the harness).

- [ ] **Step 7: Commit**

```bash
git add platform/blueprints/reader/manifest.json
git commit -m "feat(reader): register ReaderArticlePaste + preset prompts + full frontmatter template"
```

---

### Task 7: Add `{{prompts.highlights}}`/`{{prompts.content}}` tokens to the body template

**Files:**
- Modify: `platform/blueprints/reader/templates/Reader Article.md`

- [ ] **Step 1: Add the tokens after each marker.** The file currently is:

```markdown
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ReaderChromeBar" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ReaderArticleView" });
```

[//]: # (READER_HIGHLIGHTS)

[//]: # (READER_CONTENT)
```

Change the tail (the two marker lines) to insert a token after each marker, mirroring `reader-clip.json`'s `noteContentFormat` shape:

```markdown
[//]: # (READER_HIGHLIGHTS)

{{prompts.highlights}}

[//]: # (READER_CONTENT)

{{prompts.content}}
```

- [ ] **Step 2: Verify the substitution round-trip with a focused Node check.** This confirms `_readBody` substitutes body-template tokens (the design's load-bearing assumption) using the real `entity-create.js` `_substitute`:

Run:
```bash
node -e '
const fs=require("fs"),path=require("path");
const ecSrc=fs.readFileSync("platform/mechanisms/entity-create/entity-create.js","utf8");
const EntityCreate=new Function(ecSrc+"\nreturn EntityCreate;")();
const ec=new EntityCreate();
const tpl=fs.readFileSync("platform/blueprints/reader/templates/Reader Article.md","utf8");
const ctx={prompts:{highlights:"HL-MARK",content:"CT-MARK"},now:null};
const out=ec._substitute(tpl,ctx);
if(!/HL-MARK/.test(out)||!/CT-MARK/.test(out)){console.error("FAIL: tokens not substituted");process.exit(1);}
if(/\{\{prompts\.(highlights|content)\}\}/.test(out)){console.error("FAIL: leftover token");process.exit(1);}
console.log("OK: body_template tokens substitute");
'
```
Expected: `OK: body_template tokens substitute`. If the file's `entity-create.js` doesn't expose `EntityCreate` via that `new Function` return (e.g. different class name), adjust the loader to match how `run-entity-create.js` loads it (check that harness's loader) — the assertion itself must still pass.

- [ ] **Step 3: Run the content-token-leak lint** (guards against unsubstituted `{{…}}` tokens leaking into shipped notes):

Run: `node platform/test/run-content-token-leaks.js`
Expected: PASS. If it flags `Reader Article.md`'s new tokens, read the harness — it likely allowlists `{{prompts.*}}` in templates (they're substituted at create-time); if it doesn't and legitimately should, that's a harness gap to fix per its own conventions, not a reason to drop the tokens. (Confirm expected behavior before editing the harness.)

- [ ] **Step 4: Commit**

```bash
git add "platform/blueprints/reader/templates/Reader Article.md"
git commit -m "feat(reader): add highlights/content body tokens to Reader Article template"
```

---

### Task 8: Point "+ New article" at the paste dialog

**Files:**
- Modify: `platform/blueprints/reader/helpers/reader-article-actions.js:118-124`

- [ ] **Step 1: Change the button's onClick.** Replace the existing `go` handler (reader-article-actions.js lines 118-125):

```javascript
            const go = () => {
                const EC = window.customJS && window.customJS.EntityCreate;
                if (!EC || typeof EC.create !== 'function') {
                    try { new Notice('ReaderArticleActions: EntityCreate mechanism unavailable.', 8000); } catch (_e) {}
                    return;
                }
                EC.create({ instance: 'reader-article', dv: dv });
            };
```

with:

```javascript
            const go = () => {
                const RAP = window.customJS && window.customJS.ReaderArticlePaste;
                if (RAP && typeof RAP.open === 'function') { RAP.open(dv); return; }
                // Fallback (paste helper unavailable): the plain entity-create flow.
                const EC = window.customJS && window.customJS.EntityCreate;
                if (!EC || typeof EC.create !== 'function') {
                    try { new Notice('ReaderArticleActions: create mechanism unavailable.', 8000); } catch (_e) {}
                    return;
                }
                EC.create({ instance: 'reader-article', dv: dv });
            };
```

- [ ] **Step 2: Run the reader harness to confirm the create-row still builds.**

Run: `node platform/test/run-reader.js`
Expected: PASS — including any `renderCreateRow`/`HC-READER-13*` render guards (the row still constructs; only the click target changed). If a test asserts the old direct `EC.create` string, update it to accept the new `ReaderArticlePaste.open` dispatch (the row's *structure* is unchanged).

- [ ] **Step 3: Commit**

```bash
git add platform/blueprints/reader/helpers/reader-article-actions.js
git commit -m "feat(reader): open ReaderArticlePaste dialog from + New article button"
```

---

### Task 9: Wire the new harness into preflight + a test script alias

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add a `test:reader-article-paste` script.** In `package.json`'s `"scripts"`, next to `"test:reader"` (line ~47), add:

```json
    "test:reader-article-paste": "node platform/test/run-reader-article-paste.js",
```

- [ ] **Step 2: Append the harness to `release:preflight`.** In the long `"release:preflight"` chain, add ` && node platform/test/run-reader-article-paste.js` immediately after the existing ` && node platform/test/run-reader.js` segment.

- [ ] **Step 3: Validate JSON + confirm the alias runs.**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')" && npm run test:reader-article-paste`
Expected: `package.json OK` then `17/17 passed`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "test(reader): wire run-reader-article-paste into preflight + npm alias"
```

---

### Task 10: Full preflight + dogfood install verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full release preflight.**

Run: `npm run release:preflight`
Expected: all gates PASS (exit 0), including `check-version-sync.js`, the lint gates, and every harness incl. `run-reader-article-paste.js`, `run-reader.js`, `run-entity-create.js`, `run-content-token-leaks.js`. If `check-version-sync.js` fails on version drift, STOP — do not hand-bump; report it (the release pipeline owns versioning). Any harness failure: read output, fix the offending source in the reader blueprint, re-run. Do not weaken tests to pass.

- [ ] **Step 2: Dogfood self-install (workshop is its own first consumer).** Per `Docs/agent-guides/build-test-verify.md`, run the workshop self-install and confirm it succeeds and materializes the new file:

Run:
```bash
node platform/install.js . 2>&1 | tail -20
test -f ranch/scripts/reader/reader-article-paste.js && echo "INSTALLED reader-article-paste.js" || echo "MISSING reader-article-paste.js"
```
Expected: install reports success (no fatal error) and prints `INSTALLED reader-article-paste.js`. (If the workshop dogfood scripts path differs — confirm the real `{{scripts_path}}` target via `platform-config.json` — assert the file landed at the substituted path the install log shows.)

- [ ] **Step 3: Confirm no stray/uncommitted changes beyond intended surfaces.**

Run: `git status --short`
Expected: only expected dogfood-install artifacts (if the workshop tracks installed copies) — review each; do NOT `git add -A`. If the install rewrote tracked dogfood files, commit them explicitly per build-test-verify conventions:

```bash
git add ranch/scripts/reader/reader-article-paste.js
git commit -m "chore(reader): dogfood-install ReaderArticlePaste helper"
```
(Only add files that are the legitimate install output for this change. If install touched unrelated files, that's a separate concern — report rather than bundle.)

- [ ] **Step 4: Final green confirmation.**

Run: `npm run release:preflight && git status --short`
Expected: exit 0; working tree clean (or only intended, already-committed artifacts). This is the branch-ready gate before opening the PR.

---

## Self-Review notes (author checklist — completed)

- **Spec coverage:** Architecture (Tasks 1-8), Parsing incl. malformed fallback (Tasks 1-2), Field mapping → presetPrompts w/ exact 12-key list (Task 4 + manifest Task 6), title/url validation seam (Task 3/5), body-template tokens (Task 7), call-site change (Task 8), backward compat (Task 4 HC-9 defaults + Task 8 fallback branch), testing/verification (Tasks 1-5, 9, 10), versioning (no manual bump; header + Task 10 note). `reader-clip.json` left untouched (never referenced as a modify target). All six design decisions reflected.
- **Placeholder scan:** every code step contains full code; every command has expected output; no "TBD"/"add error handling"/"similar to Task N".
- **Type consistency:** `parse` returns `{frontmatter, highlights, content, malformed}` used identically in Tasks 1-5; `buildPresetPrompts(parsed, manual)` signature stable across Tasks 4-5; `validateTitle` returns `string|null` consistently; preset keys in `buildPresetPrompts` (Task 4) exactly match the manifest `prompts[]` + `frontmatter_template` keys (Task 6) and the body tokens (Task 7).
