#!/usr/bin/env node
/**
 * run-reader.js — behavioral harness for the reader blueprint's three helper
 * classes: ReaderQueue / ReaderArticleActions / ReaderArticleView.
 *
 * Uses the `new Function(SRC + "\nreturn ClassName;")()` load pattern to replicate
 * the CustomJS eval-expression loader (this ALSO proves each file loads as ONE
 * bare-class expression). Exercises the PURE helpers only (no full DOM required
 * for the logic asserts) plus a handful of source-structure guards.
 *
 * Asserts HC-READER-N per Stage E of the reader-blueprint cycle.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '..', '..');
const RDIR       = path.join(ROOT, 'platform', 'blueprints', 'reader');
const QUEUE_SRC  = path.join(RDIR, 'helpers', 'reader-queue.js');
const ACT_SRC    = path.join(RDIR, 'helpers', 'reader-article-actions.js');
const VIEW_SRC   = path.join(RDIR, 'helpers', 'reader-article-view.js');
const CHROME_SRC = path.join(RDIR, 'helpers', 'reader-chrome-bar.js');
const LEDGER_DOC = path.join(ROOT, 'Docs', 'agent-guides', 'code-conventions.md');

// ---------------------------------------------------------------------------
// Loader — also proves each file evals as one bare-class expression.
// ---------------------------------------------------------------------------
function loadClass(srcPath, className) {
  const src = fs.readFileSync(srcPath, 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}

const ReaderQueue          = loadClass(QUEUE_SRC, 'ReaderQueue');
const ReaderArticleActions = loadClass(ACT_SRC,   'ReaderArticleActions');
const ReaderArticleView    = loadClass(VIEW_SRC,  'ReaderArticleView');
const ReaderChromeBar      = loadClass(CHROME_SRC, 'ReaderChromeBar');

// ---------------------------------------------------------------------------
// Assert helpers
// ---------------------------------------------------------------------------
const results = [];
const ok = (name, cond, msg) => {
  results.push([name, !!cond]);
  console.log(`  ${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : (msg ? ' :: ' + msg : '')}`);
};

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// dv stub — selectArticles calls dv.pages('"spice/reader"').where(fn), then reads
// `.array()` off the result (falling back to Array.from). Stub exactly that
// surface: .pages(src) → { where(fn) → array-like with .array() }.
// ---------------------------------------------------------------------------
function makeDv(pages) {
  return {
    pages(_src) {
      const list = pages || [];
      return {
        where(fn) {
          const filtered = list.filter((p) => { try { return fn(p); } catch (_e) { return false; } });
          filtered.array = () => filtered.slice();
          return filtered;
        },
      };
    },
  };
}

function art(title, status, capturedAt, extra) {
  return Object.assign({
    type: 'reader-article',
    title,
    status,
    captured_at: capturedAt,
    file: { path: 'spice/reader/' + title + '.md', name: title + '.md' },
  }, extra || {});
}

// ---------------------------------------------------------------------------
// HC-READER-1 — selectArticles buckets by status + counts, cross-status pages.
// ---------------------------------------------------------------------------
{
  const pages = [
    art('U1', 'unread',   '2026-06-01T00:00:00Z'),
    art('U2', 'unread',   '2026-06-03T00:00:00Z'),
    art('R1', 'reading',  '2026-06-02T00:00:00Z'),
    art('A1', 'archived', '2026-06-04T00:00:00Z'),
    art('A2', 'archived', '2026-06-05T00:00:00Z'),
  ];
  const sel = ReaderQueue.selectArticles(makeDv(pages));
  ok('HC-READER-1 selectArticles buckets by status with correct counts',
     sel.reading.length === 1 && sel.unread.length === 2 && sel.archived.length === 2 &&
     eq(sel.counts, { unread: 2, reading: 1, archived: 2 }),
     `counts=${JSON.stringify(sel.counts)}`);
}

// ---------------------------------------------------------------------------
// HC-READER-2 — within a bucket, newest-first by captured_at (string compare).
// ---------------------------------------------------------------------------
{
  const pages = [
    art('old',   'unread', '2026-06-01T00:00:00Z'),
    art('newest','unread', '2026-06-09T00:00:00Z'),
    art('mid',   'unread', '2026-06-05T00:00:00Z'),
  ];
  const sel = ReaderQueue.selectArticles(makeDv(pages));
  const order = sel.unread.map((p) => p.title);
  ok('HC-READER-2 unread bucket is newest-first by captured_at',
     eq(order, ['newest', 'mid', 'old']), `order=${JSON.stringify(order)}`);
}

// ---------------------------------------------------------------------------
// HC-READER-3 — unknown/blank status → unread bucket (never dropped).
// ---------------------------------------------------------------------------
{
  const pages = [
    art('blank', '',        '2026-06-01T00:00:00Z'),
    art('weird', 'to-read', '2026-06-02T00:00:00Z'),
    art('nully', null,      '2026-06-03T00:00:00Z'),
  ];
  const sel = ReaderQueue.selectArticles(makeDv(pages));
  ok('HC-READER-3 unknown/blank/null status → unread bucket',
     sel.unread.length === 3 && sel.reading.length === 0 && sel.archived.length === 0 &&
     eq(sel.counts, { unread: 3, reading: 0, archived: 0 }),
     `counts=${JSON.stringify(sel.counts)}`);
}

// ---------------------------------------------------------------------------
// HC-READER-4 — empty / cold vault → all-empty buckets, zero counts, no throw.
// ---------------------------------------------------------------------------
{
  let threw = false, sel = null, selNull = null, selNoPages = null;
  try {
    sel = ReaderQueue.selectArticles(makeDv([]));   // dv.pages → empty
    selNull = ReaderQueue.selectArticles(null);     // null dv
    selNoPages = ReaderQueue.selectArticles({});    // dv without .pages
  } catch (_e) { threw = true; }
  const allEmpty = (s) => s && !s.reading.length && !s.unread.length && !s.archived.length &&
    eq(s.counts, { unread: 0, reading: 0, archived: 0 });
  ok('HC-READER-4 empty/null/no-pages dv → all-empty buckets + zero counts, no throw',
     !threw && allEmpty(sel) && allEmpty(selNull) && allEmpty(selNoPages),
     `threw=${threw}`);
}

// ---------------------------------------------------------------------------
// HC-READER-5 — ReaderQueue.nextStatus full cycle + blank → reading.
// ---------------------------------------------------------------------------
{
  ok('HC-READER-5 nextStatus cycle unread→reading→archived→unread, blank→reading',
     ReaderQueue.nextStatus('unread') === 'reading' &&
     ReaderQueue.nextStatus('reading') === 'archived' &&
     ReaderQueue.nextStatus('archived') === 'unread' &&
     ReaderQueue.nextStatus('') === 'reading' &&
     ReaderQueue.nextStatus('bogus') === 'reading' &&
     new ReaderQueue().nextStatus('unread') === 'reading');
}

// ---------------------------------------------------------------------------
// HC-READER-6 — ReaderArticleActions._nextStatusForward matches the same cycle.
// ---------------------------------------------------------------------------
{
  const N = ReaderArticleActions._nextStatusForward;
  ok('HC-READER-6 _nextStatusForward matches the nextStatus cycle (+ blank→reading)',
     N('unread') === 'reading' && N('reading') === 'archived' &&
     N('archived') === 'unread' && N('') === 'reading' && N('???') === 'reading' &&
     new ReaderArticleActions()._nextStatusForward('reading') === 'archived');
}

// ---------------------------------------------------------------------------
// HC-READER-7 — statusTransitions returns the exact label/next arrays per status.
// ---------------------------------------------------------------------------
{
  const S = ReaderArticleActions.statusTransitions;
  const unread   = [{ label: 'Mark reading', next: 'reading' }, { label: 'Mark read', next: 'archived' }];
  const reading  = [{ label: 'Mark read', next: 'archived' }, { label: 'Back to unread', next: 'unread' }];
  const archived = [{ label: 'Back to reading', next: 'reading' }, { label: 'Mark unread', next: 'unread' }];
  ok('HC-READER-7a statusTransitions(unread) → [Mark reading, Mark read]', eq(S('unread'), unread), JSON.stringify(S('unread')));
  ok('HC-READER-7b statusTransitions(reading) → [Mark read, Back to unread]', eq(S('reading'), reading), JSON.stringify(S('reading')));
  ok('HC-READER-7c statusTransitions(archived) → [Back to reading, Mark unread]', eq(S('archived'), archived), JSON.stringify(S('archived')));
  ok('HC-READER-7d statusTransitions(blank/unknown) → unread list', eq(S(''), unread) && eq(S('xyz'), unread), JSON.stringify(S('')));
}

// ---------------------------------------------------------------------------
// HC-READER-NOCREATEROW — legacy create-button row is gone (nav owns creation).
// ---------------------------------------------------------------------------
ok('HC-READER-NOCREATEROW ReaderArticleActions no longer exposes renderCreateRow',
   typeof ReaderArticleActions.renderCreateRow === 'undefined' &&
   typeof (new ReaderArticleActions()).renderCreateRow === 'undefined');

// ---------------------------------------------------------------------------
// HC-READER-STATUSTS — _setStatus stamps status_changed_at alongside status.
// ---------------------------------------------------------------------------
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'blueprints', 'reader', 'helpers', 'reader-article-actions.js'), 'utf8');
  ok('HC-READER-STATUSTS _setStatus stamps status_changed_at alongside status',
     /fm\.status\s*=\s*next/.test(src) && /status_changed_at/.test(src));
}

// ---------------------------------------------------------------------------
// HC-READER-8 — ReaderArticleView._humanDate: short date + full ISO both →
// "Thu, Jul 2, 2026"; blank/null/garbage → { text: '' }.
// ---------------------------------------------------------------------------
{
  const H = ReaderArticleView._humanDate;
  const short = H('2026-07-02');
  const iso   = H('2026-07-02T14:45:00Z');
  ok('HC-READER-8a _humanDate("2026-07-02") → "Thu, Jul 2, 2026"',
     short.text === 'Thu, Jul 2, 2026' && short.weekday === 'Thu', JSON.stringify(short));
  ok('HC-READER-8b _humanDate(full ISO) → "Thu, Jul 2, 2026"',
     iso.text === 'Thu, Jul 2, 2026', JSON.stringify(iso));
  ok('HC-READER-8c _humanDate(blank/null/garbage) → { text: "" }',
     eq(H(''), { text: '' }) && eq(H(null), { text: '' }) && eq(H('not-a-date'), { text: '' }),
     JSON.stringify([H(''), H(null), H('not-a-date')]));
}

// ---------------------------------------------------------------------------
// HC-READER-9 — _readingMinutes on both classes: 400→2, 50→1, 0/undefined→null.
// ---------------------------------------------------------------------------
{
  const check = (fn) => fn(400) === 2 && fn(50) === 1 && fn(0) === null && fn(undefined) === null && fn(-10) === null;
  ok('HC-READER-9a ReaderQueue._readingMinutes (400→2, 50→1, 0/undefined→null)',
     check(ReaderQueue._readingMinutes) && new ReaderQueue().selectArticles === ReaderQueue.prototype.selectArticles);
  ok('HC-READER-9b ReaderArticleView._readingMinutes (400→2, 50→1, 0/undefined→null)',
     check(ReaderArticleView._readingMinutes) && new ReaderArticleView()._readingMinutes(400) === 2);
}

// ---------------------------------------------------------------------------
// HC-READER-10 — Structural: hub template + hub content each carry the
// ReaderChromeBar + ReaderQueue guarded blocks (legacy Breadcrumb/SpaceNavButtons
// blocks retired onto the shared ChromeBar) and NO literal `---` outside
// frontmatter; article template carries the ReaderChromeBar + ReaderArticleView
// guarded blocks (legacy Breadcrumb/SpaceNavButtons/ReaderArticleActions blocks
// retired) + both markers and NO frontmatter; reader-clip.json parses with
// path "spice/reader".
// ---------------------------------------------------------------------------
{
  // Strip a leading YAML frontmatter block so a `---` check only sees the body.
  const stripFm = (s) => s.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const hasBlock = (s, cls) => new RegExp('class:\\s*"' + cls + '"').test(s);

  const hubTpl  = fs.readFileSync(path.join(RDIR, 'templates', 'Reader.md'), 'utf8');
  const hubBody = stripFm(hubTpl);
  ok('HC-READER-10a templates/Reader.md: ReaderChromeBar + ReaderQueue guarded blocks, no legacy nav blocks, no literal --- outside frontmatter',
     hasBlock(hubTpl, 'ReaderChromeBar') && hasBlock(hubTpl, 'ReaderQueue') &&
     !hasBlock(hubTpl, 'Breadcrumb') && !hasBlock(hubTpl, 'SpaceNavButtons') &&
     !/^-{3,}\s*$/m.test(hubBody),
     'body---=' + /^-{3,}\s*$/m.test(hubBody));

  const hubContent = fs.readFileSync(path.join(RDIR, 'content', 'Reader Hub.md'), 'utf8');
  const hubContentBody = stripFm(hubContent);
  ok('HC-READER-10b content/Reader Hub.md: ReaderChromeBar + ReaderQueue guarded blocks, no legacy nav blocks, no literal --- outside frontmatter',
     hasBlock(hubContent, 'ReaderChromeBar') && hasBlock(hubContent, 'ReaderQueue') &&
     !hasBlock(hubContent, 'Breadcrumb') && !hasBlock(hubContent, 'SpaceNavButtons') &&
     !/^-{3,}\s*$/m.test(hubContentBody),
     'body---=' + /^-{3,}\s*$/m.test(hubContentBody));

  const artTpl = fs.readFileSync(path.join(RDIR, 'templates', 'Reader Article.md'), 'utf8');
  const hasFm  = /^---\r?\n/.test(artTpl);
  ok('HC-READER-10c templates/Reader Article.md: ReaderChromeBar + ReaderArticleView guarded blocks, no legacy nav/actions blocks, both markers, NO frontmatter',
     hasBlock(artTpl, 'ReaderChromeBar') && hasBlock(artTpl, 'ReaderArticleView') &&
     !hasBlock(artTpl, 'Breadcrumb') && !hasBlock(artTpl, 'SpaceNavButtons') && !hasBlock(artTpl, 'ReaderArticleActions') &&
     /READER_HIGHLIGHTS/.test(artTpl) && /READER_CONTENT/.test(artTpl) && !hasFm,
     'hasFm=' + hasFm);

  let clip = null, clipErr = '';
  try { clip = JSON.parse(fs.readFileSync(path.join(RDIR, 'assets', 'reader-clip.json'), 'utf8')); }
  catch (e) { clipErr = String(e && e.message || e); }
  ok('HC-READER-10d assets/reader-clip.json parses and has path "spice/reader"',
     !!clip && clip.path === 'spice/reader', clipErr || ('path=' + (clip && clip.path)));

  // HC-READER-10e — the Web Clipper capture template's noteContentFormat is the
  // ONLY source of chrome for a freshly-clipped article (it's never healed —
  // applyNoteChromeHeal only touches EXISTING vault files, not the browser
  // extension's own captured content). It must carry ReaderChromeBar + no
  // legacy blocks, same contract as templates/Reader Article.md above, or
  // every newly clipped article regresses to the old visible button row.
  const ncf = clip && clip.noteContentFormat || '';
  ok('HC-READER-10e reader-clip.json noteContentFormat: ReaderChromeBar + ReaderArticleView, no legacy nav/actions blocks',
     hasBlock(ncf, 'ReaderChromeBar') && hasBlock(ncf, 'ReaderArticleView') &&
     !hasBlock(ncf, 'Breadcrumb') && !hasBlock(ncf, 'SpaceNavButtons') && !hasBlock(ncf, 'ReaderArticleActions'));
}

// ---------------------------------------------------------------------------
// HC-READER-11 — Structural: all three helper files are BARE classes (start with
// `class`, no module.exports) — the CustomJS loadability contract.
// ---------------------------------------------------------------------------
{
  function bareClass(srcPath) {
    const src = fs.readFileSync(srcPath, 'utf8');
    const stripped = src.replace(/^(\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)+/, '').trimStart();
    // Match `module.exports` only as CODE — the reader helpers' docstrings mention
    // "module.exports" in prose (as the trailer to avoid), so strip block + line
    // comments before checking, else the doc mention false-fails the guard.
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    return stripped.startsWith('class ') && !/module\.exports/.test(codeOnly);
  }
  ok('HC-READER-11a reader-queue.js is a bare class (no module.exports)',          bareClass(QUEUE_SRC));
  ok('HC-READER-11b reader-article-actions.js is a bare class (no module.exports)', bareClass(ACT_SRC));
  ok('HC-READER-11c reader-article-view.js is a bare class (no module.exports)',    bareClass(VIEW_SRC));
}

// ---------------------------------------------------------------------------
// HC-READER-12 — reader fixes: launcher icon resolves, + New article dialog
// captures the URL, and the article renders the "Open article" access link.
// ---------------------------------------------------------------------------
{
  const manifest = JSON.parse(fs.readFileSync(path.join(RDIR, 'manifest.json'), 'utf8'));

  // (a) Nav-button icon resolves via the icons mechanism Tier-1 (so the Reader
  //     entry in the Go-to launcher shows an icon, not a blank).
  const navIcon = (manifest.nav_buttons && manifest.nav_buttons[0] && manifest.nav_buttons[0].icon) || '';
  let iconSvg = null, iconErr = '';
  try {
    const iconsSrc = fs.readFileSync(path.join(ROOT, 'platform', 'mechanisms', 'icons', 'icons.js'), 'utf8');
    const Icons = new Function(iconsSrc + '\nreturn Icons;')();
    iconSvg = new Icons().resolve(navIcon);
  } catch (e) { iconErr = String(e && e.message || e); }
  ok('HC-READER-12a Reader nav icon "book-open" resolves via icons Tier-1',
     navIcon === 'book-open' && typeof iconSvg === 'string' && iconSvg.length > 0,
     iconErr || ('navIcon=' + navIcon + ' svg=' + (iconSvg ? iconSvg.length : 'NULL')));

  // (b) "+ New article" dialog prompts for BOTH title and (optional) url; url feeds frontmatter.
  const btn = (manifest.new_entity_buttons || []).find((b) => b.id === 'reader-article') || {};
  const prompts = btn.prompts || [];
  const urlPrompt = prompts.find((p) => p.key === 'url');
  ok('HC-READER-12b + New article prompts for title + optional url → frontmatter url',
     prompts.some((p) => p.key === 'title') &&
     !!urlPrompt && urlPrompt.type === 'string' && urlPrompt.required === false &&
     !!btn.frontmatter_template && btn.frontmatter_template.url === '{{prompts.url}}',
     'prompts=' + prompts.map((p) => p.key).join(',') + ' fmUrl=' + (btn.frontmatter_template && btn.frontmatter_template.url));

  // (c) The article action row builds the "Open article ↗" external link (real <a>,
  //     target=_blank) gated on a non-empty url.
  const actSrc = fs.readFileSync(ACT_SRC, 'utf8');
  ok('HC-READER-12c article renders the "Open article ↗" access link (a target=_blank)',
     actSrc.includes('Open article ↗') && !actSrc.includes('Open source ↗') &&
     /createEl\('a'|createEl\("a"/.test(actSrc) && /target:\s*'_blank'|target="_blank"/.test(actSrc));
}

// ---------------------------------------------------------------------------
// HC-READER-13 — ReaderArticleActions.render() presence-guards against
// ReaderChromeBar: when the preview view already hosts a `.reader-chrome-root`
// (the new ChromeBar-owned status row), render() returns early and does NOT
// build its own legacy `.reader-article-actions` row (would double the chrome).
// Minimal DOM stub: a container whose `.closest('.markdown-preview-view')`
// resolves to a stub exposing `.querySelector('.reader-chrome-root')` → truthy.
// ---------------------------------------------------------------------------
{
  function makeStubEl(overrides) {
    const el = Object.assign({
      style: {},
      children: [],
      closest() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createEl(_tag, _opts) { const child = makeStubEl(); this.children.push(child); return child; },
      addEventListener() {},
      remove() {},
    }, overrides || {});
    return el;
  }

  // Case A: a `.reader-chrome-root` IS present under the preview view → guarded,
  // no `.reader-article-actions` row created.
  {
    const previewView = makeStubEl({ querySelector: (sel) => (sel === '.reader-chrome-root' ? makeStubEl() : null) });
    const container = makeStubEl({
      closest: (sel) => (sel === '.markdown-preview-view' ? previewView : null),
      querySelector: () => null, // no pre-existing .reader-article-actions to dedupe
    });
    const dv = {
      container,
      current: () => ({ file: { path: 'spice/reader/Foo.md' }, type: 'reader-article', status: 'unread', url: '' }),
    };
    let threw = false;
    try { new ReaderArticleActions().render(dv); } catch (_e) { threw = true; }
    const builtRow = container.children.some((c) => c._clsIsActionsRow);
    ok('HC-READER-13a render() returns early when .reader-chrome-root is present (no legacy row, no throw)',
       !threw && container.children.length === 0,
       'threw=' + threw + ' childCount=' + container.children.length);
  }

  // Case B: NO `.reader-chrome-root` present (legacy/cold-load path) → render()
  // proceeds and builds its row as before (regression guard for the guard itself).
  // render() reaches `window.customJS.AccentButton` for its buttons — stub a
  // minimal global.window for this case only, restoring it after.
  {
    const hadWindow = Object.prototype.hasOwnProperty.call(global, 'window');
    const prevWindow = global.window;
    global.window = { customJS: { AccentButton: { render: () => makeStubEl() } } };
    try {
      const previewView = makeStubEl({ querySelector: () => null });
      const container = makeStubEl({
        closest: (sel) => (sel === '.markdown-preview-view' ? previewView : null),
        querySelector: () => null,
      });
      const dv = {
        container,
        current: () => ({ file: { path: 'spice/reader/Foo.md' }, type: 'reader-article', status: 'unread', url: '' }),
      };
      let threw = false;
      try { new ReaderArticleActions().render(dv); } catch (_e) { threw = true; }
      ok('HC-READER-13b render() still builds its row when .reader-chrome-root is absent (no regression)',
         !threw && container.children.length > 0,
         'threw=' + threw + ' childCount=' + container.children.length);
    } finally {
      if (hadWindow) global.window = prevWindow; else delete global.window;
    }
  }
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------
function makeDomEl(tag, opts) {
  const options = opts || {};
  const el = {
    tag: tag || 'div', cls: options.cls || '', style: {}, children: [], parentNode: null,
    textContent: options.text || '', innerHTML: '', focused: false, listeners: {},
    get childNodes() { return this.children; },
    get firstChild() { return this.children[0] || null; },
    createEl(childTag, childOpts) { const child = makeDomEl(childTag, childOpts); return this.appendChild(child); },
    appendChild(child) {
      if (child.parentNode && child.parentNode !== this) child.parentNode.removeChild(child);
      if (!this.children.includes(child)) this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; return child; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    empty() { for (const child of this.children) child.parentNode = null; this.children = []; },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    setAttribute(name, value) { this[name] = value; },
    focus() {
      this.focused = true;
      try { if (global.document) global.document.activeElement = this; } catch (_e) {}
    },
    contains(node) {
      for (let cur = node; cur; cur = cur.parentNode) if (cur === this) return true;
      return false;
    },
    closest() { return null; },
    querySelector(selector) { return walk(this).find((node) => node !== this && matches(node, selector)) || null; },
    querySelectorAll(selector) { return walk(this).filter((node) => node !== this && matches(node, selector)); },
  };
  return el;
}

function walk(root) {
  const out = [];
  const visit = (node) => { out.push(node); for (const child of node.children || []) visit(child); };
  visit(root);
  return out;
}

function matches(node, selector) {
  if (!selector || selector[0] !== '.') return false;
  return String(node.cls || '').split(/\s+/).includes(selector.slice(1));
}

async function dataviewCorrectnessCases() {
  const article = art('Structural', 'unread', '2026-08-03T00:00:00Z');
  const overrides = new Map([[article.file.path, 'reading']]);
  const selected = ReaderQueue.selectArticles(makeDv([article]), overrides);
  ok('HC-READER-PERF-1 optimistic status authority re-buckets without mutating the Dataview page',
     selected.reading[0] === article && selected.unread.length === 0 && article.status === 'unread');

  const queue = new ReaderQueue();
  const container = makeDomEl('div');
  const dv = makeDv([article]);
  const state = { statuses: new Map(), structuralQueue: null, toggles: new Map(), container, ctx: null };
  const priorApp = global.app;
  const priorCustomJS = global.customJS;
  const priorWindow = global.window;
  const priorNotice = global.Notice;
  let writes = 0;
  let forceRefreshes = 0;
  const file = { path: article.file.path, _fm: { status: 'unread' } };
  global.Notice = function Notice() {};
  global.app = {
    vault: { getAbstractFileByPath: (p) => p === file.path ? file : null },
    fileManager: { processFrontMatter: async (_file, mutate) => { writes++; mutate(file._fm); } },
    commands: { executeCommandById: () => { forceRefreshes++; } },
  };
  global.window = { app: global.app };
  try {
    queue._renderResults(dv, container, null, state);
    const originalChildren = container.children.slice();
    const originalRow = container.querySelector('.sauce-reader-row');
    const originalToggle = state.toggles.get(file.path);
    let clickStopped = false;
    let routedGesture = null;
    queue._queueStatusTransition = async (...args) => { routedGesture = args; return true; };
    await originalToggle.listeners.click({ stopPropagation: () => { clickStopped = true; } });
    ok('HC-READER-PERF-1A rendered status control routes through the serialized queue with exact gesture state',
       clickStopped && routedGesture && routedGesture[0] === dv && routedGesture[1] === state
       && routedGesture[2] === file.path && routedGesture[3] === 'unread'
       && routedGesture[4] === 'reading' && routedGesture[5] === originalToggle);
    let appliedBeforeWrite = false;
    global.customJS = { RenderSafe: { mutateStructure: async (opts) => {
      const receipt = await opts.apply();
      appliedBeforeWrite = state.statuses.get(file.path) === 'reading'
        && !!container.querySelector('.sauce-reader-row')
        && state.toggles.get(file.path) !== originalToggle;
      try { throw new Error('fixture persistence failure'); }
      catch (error) { await opts.rollback(receipt, error); return { ok: false, error }; }
    } } };
    global.window.customJS = global.customJS;
    const failed = await queue._setStatus(dv, state, file.path, 'reading', originalToggle);
    ok('HC-READER-PERF-2 structural status applies before persistence and reports rejection',
       failed === false && appliedBeforeWrite && writes === 0);
    ok('HC-READER-PERF-3 rejection restores exact queue children, row identity, status, and focus',
       container.children.length === originalChildren.length
       && container.children.every((child, i) => child === originalChildren[i])
       && container.querySelector('.sauce-reader-row') === originalRow
       && state.statuses.get(file.path) === 'unread'
       && state.toggles.get(file.path) === originalToggle && originalToggle.focused);

    originalToggle.focused = false;
    global.customJS.RenderSafe.mutateStructure = async (opts) => {
      const receipt = await opts.apply();
      try { await opts.write(); return { ok: true, receipt }; }
      catch (error) { await opts.rollback(receipt, error); return { ok: false, error }; }
    };
    const saved = await queue._setStatus(dv, state, file.path, 'reading', originalToggle);
    const optimisticToggle = state.toggles.get(file.path);
    const renderedNodes = walk(container);
    const readingCount = renderedNodes.find((node) => node.tag === 'span' && node.textContent === 'Reading 1');
    const unreadCount = renderedNodes.find((node) => node.tag === 'span' && node.textContent === 'Unread 1');
    const readingBand = renderedNodes.find((node) => node.tag === 'div' && node.textContent === 'Reading');
    const unreadBand = renderedNodes.find((node) => node.tag === 'div' && node.textContent === 'Unread');
    const replacementRow = container.querySelector('.sauce-reader-row');
    ok('HC-READER-PERF-4 success keeps the optimistic band model and focuses its replacement control',
       saved === true && state.statuses.get(file.path) === 'reading'
       && optimisticToggle && optimisticToggle !== originalToggle && optimisticToggle.focused
       && readingCount && !unreadCount && readingBand && unreadBand && replacementRow
       && renderedNodes.indexOf(readingBand) < renderedNodes.indexOf(replacementRow)
       && renderedNodes.indexOf(replacementRow) < renderedNodes.indexOf(unreadBand));
    ok('HC-READER-PERF-5 persistence writes status + ISO status_changed_at with no global refresh',
       writes === 1 && file._fm.status === 'reading'
       && /^\d{4}-\d{2}-\d{2}T/.test(file._fm.status_changed_at || '') && forceRefreshes === 0);

    const beforeUnavailable = container.children.slice();
    delete global.customJS.RenderSafe;
    const unavailable = await queue._setStatus(dv, state, file.path, 'archived', optimisticToggle);
    ok('HC-READER-PERF-6 missing RenderSafe fails closed before DOM or persistence',
       unavailable === false && writes === 1
       && container.children.every((child, i) => child === beforeUnavailable[i]));

    let coldThrows = 0;
    const coldContainer = makeDomEl('div');
    const throwingDv = { container: coldContainer, current: () => { throw new Error('cold current'); } };
    try { new ReaderQueue().render(throwingDv); } catch (_e) { coldThrows++; }
    try { new ReaderArticleActions().render(throwingDv); } catch (_e) { coldThrows++; }
    try { await new ReaderArticleView().render(throwingDv); } catch (_e) { coldThrows++; }
    try { new ReaderChromeBar().render(throwingDv); } catch (_e) { coldThrows++; }
    ok('HC-READER-PERF-7 every Reader Dataview entry fails closed on a throwing cold current page', coldThrows === 0);

    const activeCustomJS = global.customJS;
    const activeWindow = global.window;
    let matrixThrows = 0;
    let matrixCases = 0;
    try {
      global.customJS = {};
      global.window = {};
      const entries = [
        { make: () => new ReaderQueue(), valid: { file: { path: 'spice/reader/Reader.md' }, type: 'reader-hub' } },
        { make: () => new ReaderArticleActions(), valid: { file: { path: file.path }, type: 'reader-article' } },
        { make: () => new ReaderArticleView(), valid: { file: { path: file.path }, type: 'reader-article' } },
        { make: () => new ReaderChromeBar(), valid: { file: { path: file.path }, type: 'reader-article' } },
      ];
      for (const entry of entries) {
        const pages = [
          null,
          () => undefined,
          () => ({ file: { path: file.path } }),
          () => entry.valid,
        ];
        for (const current of pages) {
          matrixCases++;
          const matrixDv = { container: makeDomEl('div') };
          if (current) matrixDv.current = current;
          try { await Promise.resolve(entry.make().render(matrixDv)); } catch (_e) { matrixThrows++; }
        }
      }
    } finally {
      global.customJS = activeCustomJS;
      global.window = activeWindow;
    }
    ok('HC-READER-PERF-7A all four Reader entries survive missing current, undefined current, file-only frontmatter, and valid-page missing dependencies',
       matrixCases === 16 && matrixThrows === 0);

    const chromeSrc = fs.readFileSync(CHROME_SRC, 'utf8');
    const chromeGuardMutant = chromeSrc.replace(
      '} catch (_e) { /* never throw */ }',
      '} catch (_e) { throw _e; }',
    );
    const MutantReaderChromeBar = new Function(`${chromeGuardMutant}\nreturn ReaderChromeBar;`)();
    const beforeChromeCustomJS = global.customJS;
    let liveChromeThrew = false;
    let mutantChromeThrew = false;
    try {
      delete global.customJS;
      try { new ReaderChromeBar().render({ container: makeDomEl('div') }); } catch (_e) { liveChromeThrew = true; }
      try { new MutantReaderChromeBar().render({ container: makeDomEl('div') }); } catch (_e) { mutantChromeThrew = true; }
    } finally {
      global.customJS = beforeChromeCustomJS;
    }
    ok('PERF6B-CHROME-ENTRY-COLD-LOAD ReaderChromeBar.render fails closed while a disabled never-throw guard mutant fails',
       chromeGuardMutant !== chromeSrc && !liveChromeThrew && mutantChromeThrew);

    const queueSrc = fs.readFileSync(QUEUE_SRC, 'utf8');
    const structuralGuard = (src) => /renderSafe\.mutateStructure\s*\(\{/.test(src)
      && /apply:\s*async/.test(src) && /rollback:\s*async/.test(src)
      && /status_changed_at/.test(src)
      && !/dataview:dataview-force-refresh-views/.test(src);
    const seamMutant = queueSrc.replace('renderSafe.mutateStructure({', 'renderSafe.mutate({');
    const rollbackMutant = queueSrc.replace('rollback: async (receipt) => {', 'revert: async (receipt) => {');
    ok('HC-READER-PERF-8 structural seam guard kills seam and rollback mutants',
       structuralGuard(queueSrc) && !structuralGuard(seamMutant) && !structuralGuard(rollbackMutant));

    const readerLedgerRows = fs.readFileSync(LEDGER_DOC, 'utf8').split('\n')
      .filter((line) => /^\| Reader \|/.test(line));
    const queueLedgerRow = readerLedgerRows.find((line) => /`ReaderQueue`/.test(line)) || '';
    const articleLedgerRow = readerLedgerRows.find((line) => /`ReaderArticleView`/.test(line)) || '';
    ok('PERF6-LEDGER-TOUCH-ZONE both canonical Reader rows bind structural, serialization, rollback, and cold-load receipts',
       readerLedgerRows.length === 2 && readerLedgerRows.every((line) => !/GAP PERF-6/.test(line))
       && (queueLedgerRow.match(/\*\*OK\*\*/g) || []).length === 4
       && /mutateStructure/.test(queueLedgerRow) && /serialized persistence/.test(queueLedgerRow)
       && /exact prior child nodes/.test(queueLedgerRow) && /triggering focus/.test(queueLedgerRow)
       && /throwing cold-load/.test(queueLedgerRow)
       && /ReaderArticleActions/.test(articleLedgerRow)
       && /ReaderChromeBar/.test(articleLedgerRow)
       && /undefined, file-only, throwing-current, and missing-dependency/.test(articleLedgerRow));

    const serialState = { statuses: new Map([[file.path, 'unread']]), structuralQueue: null };
    const serialQueue = new ReaderQueue();
    let releaseFirst = null;
    let serialCalls = 0;
    serialQueue._setStatus = async (_dv, localState, _path, next) => {
      serialCalls++;
      localState.statuses.set(file.path, next);
      if (serialCalls === 1) await new Promise((resolve) => { releaseFirst = resolve; });
      return true;
    };
    const first = serialQueue._queueStatusTransition({}, serialState, file.path, 'unread', 'reading', null);
    await new Promise((resolve) => setImmediate(resolve));
    const second = serialQueue._queueStatusTransition({}, serialState, file.path, 'reading', 'archived', null);
    releaseFirst();
    await Promise.all([first, second]);
    ok('HC-READER-PERF-9 rapid same-article gestures serialize in user order',
       serialCalls === 2 && serialState.statuses.get(file.path) === 'archived');

    const rejectState = { statuses: new Map([[file.path, 'unread']]), structuralQueue: null };
    const rejectQueue = new ReaderQueue();
    const releaseRejects = [];
    let rejectCalls = 0;
    rejectQueue._setStatus = async (_dv, localState) => {
      rejectCalls++;
      localState.statuses.set(file.path, 'reading');
      await new Promise((resolve) => { releaseRejects.push(resolve); });
      localState.statuses.set(file.path, 'unread');
      return false;
    };
    const rejectedFirst = rejectQueue._queueStatusTransition({}, rejectState, file.path, 'unread', 'reading', null);
    await new Promise((resolve) => setImmediate(resolve));
    const rejectedChild = rejectQueue._queueStatusTransition({}, rejectState, file.path, 'reading', 'archived', null);
    await new Promise((resolve) => setImmediate(resolve));
    for (const releaseReject of releaseRejects.splice(0)) releaseReject();
    await Promise.all([rejectedFirst, rejectedChild]);
    ok('HC-READER-PERF-10 rejected parent gesture invalidates its queued stale descendant',
       rejectCalls === 1 && rejectState.statuses.get(file.path) === 'unread');

    const pathA = 'spice/reader/Cross A.md';
    const pathB = 'spice/reader/Cross B.md';
    const crossState = {
      statuses: new Map([[pathA, 'unread'], [pathB, 'unread']]),
      structuralQueue: null,
      queues: new Map(),
    };
    const crossQueue = new ReaderQueue();
    const crossOrder = [];
    let crossActive = 0;
    let crossMaxActive = 0;
    let releaseCrossA = null;
    crossQueue._setStatus = async (_dv, localState, path, next) => {
      crossOrder.push(path);
      crossActive++;
      crossMaxActive = Math.max(crossMaxActive, crossActive);
      if (path === pathA) {
        localState.statuses.set(pathA, next);
        await new Promise((resolve) => { releaseCrossA = resolve; });
        localState.statuses.set(pathA, 'unread');
        crossActive--;
        return false;
      }
      localState.statuses.set(pathB, next);
      crossActive--;
      return true;
    };
    const crossA = crossQueue._queueStatusTransition({}, crossState, pathA, 'unread', 'reading', null);
    await new Promise((resolve) => setImmediate(resolve));
    const crossB = crossQueue._queueStatusTransition({}, crossState, pathB, 'unread', 'reading', null);
    await new Promise((resolve) => setImmediate(resolve));
    const siblingWaited = crossOrder.length === 1 && crossOrder[0] === pathA;
    releaseCrossA();
    const crossResults = await Promise.all([crossA, crossB]);
    ok('HC-READER-PERF-11 cross-article whole-container mutations serialize so a rejected sibling cannot erase a successful render',
       siblingWaited && crossMaxActive === 1 && crossOrder.join('|') === pathA + '|' + pathB
       && crossResults[0] === false && crossResults[1] === true
       && crossState.statuses.get(pathA) === 'unread' && crossState.statuses.get(pathB) === 'reading'
       && crossState.structuralQueue === null);

    const focusArticleA = art('Focus A', 'unread', '2026-08-03T02:00:00Z');
    const focusArticleB = art('Focus B', 'unread', '2026-08-03T01:00:00Z');
    const focusPathA = focusArticleA.file.path;
    const focusPathB = focusArticleB.file.path;
    const focusFiles = new Map([
      [focusPathA, { path: focusPathA, _fm: { status: 'unread' } }],
      [focusPathB, { path: focusPathB, _fm: { status: 'unread' } }],
    ]);
    const focusPending = new Map();
    const focusReceipts = new Map();
    const focusApp = {
      vault: { getAbstractFileByPath: (path) => focusFiles.get(path) || null },
      fileManager: {
        processFrontMatter: (target, mutate) => new Promise((resolve, reject) => {
          focusPending.set(target.path, {
            resolve: () => { mutate(target._fm); resolve(); },
            reject,
          });
        }),
      },
    };
    const focusQueue = new ReaderQueue();
    const focusContainer = makeDomEl('div');
    const focusDv = makeDv([focusArticleA, focusArticleB]);
    const focusState = { statuses: new Map(), structuralQueue: null, toggles: new Map(), container: focusContainer, ctx: null };
    const priorFocusApp = global.app;
    const priorFocusWindow = global.window;
    const priorFocusCustomJS = global.customJS;
    const waitForPending = async (path) => {
      for (let i = 0; i < 20 && !focusPending.has(path); i++) await new Promise((resolve) => setImmediate(resolve));
      return focusPending.has(path);
    };
    let focusReceiptPassed = false;
    try {
      global.app = focusApp;
      global.window = { app: focusApp };
      global.customJS = { RenderSafe: { mutateStructure: async (opts) => {
        const receipt = await opts.apply();
        focusReceipts.set(opts.path, receipt);
        try { await opts.write(); return { ok: true, receipt }; }
        catch (error) { await opts.rollback(receipt, error); return { ok: false, error }; }
      } } };
      global.window.customJS = global.customJS;
      focusQueue._renderResults(focusDv, focusContainer, null, focusState);
      const initialChildren = focusContainer.children.slice();
      const initialToggleA = focusState.toggles.get(focusPathA);
      const initialToggleB = focusState.toggles.get(focusPathB);
      const pendingA = focusQueue._queueStatusTransition(focusDv, focusState, focusPathA, 'unread', 'reading', initialToggleA);
      const aApplied = await waitForPending(focusPathA);
      const detachedBClickTarget = focusState.toggles.get(focusPathB);
      const pendingB = focusQueue._queueStatusTransition(focusDv, focusState, focusPathB, 'unread', 'reading', detachedBClickTarget);
      await new Promise((resolve) => setImmediate(resolve));
      const bWaited = !focusPending.has(focusPathB);
      focusPending.get(focusPathA).reject(new Error('focus fixture A rejected'));
      const bApplied = await waitForPending(focusPathB);
      const reboundBTarget = focusReceipts.get(focusPathB)?.focusTarget;
      focusPending.get(focusPathB).reject(new Error('focus fixture B rejected'));
      const settled = await Promise.all([pendingA, pendingB]);
      focusReceiptPassed = aApplied && bWaited && bApplied
        && settled[0] === false && settled[1] === false
        && detachedBClickTarget !== initialToggleB && reboundBTarget === initialToggleB
        && focusState.toggles.get(focusPathB) === initialToggleB
        && initialToggleB.focused && !detachedBClickTarget.focused
        && focusState.statuses.get(focusPathA) === 'unread'
        && focusState.statuses.get(focusPathB) === 'unread'
        && focusContainer.children.length === initialChildren.length
        && focusContainer.children.every((child, index) => child === initialChildren[index])
        && focusState.structuralQueue === null;
    } finally {
      global.app = priorFocusApp;
      global.window = priorFocusWindow;
      global.customJS = priorFocusCustomJS;
    }
    ok('PERF6C-CROSS-ARTICLE-FOCUS-REBIND queued sibling rejection focuses the restored live toggle, never its detached click-time node',
       focusReceiptPassed);

    const hiddenArticleA = art('Hidden Focus A', 'archived', '2026-08-03T06:00:00Z');
    const hiddenFillers = [5, 4, 3, 2].map((hour) =>
      art('Hidden Focus filler ' + hour, 'archived', `2026-08-03T0${hour}:00:00Z`));
    const hiddenArticleB = art('Hidden Focus B', 'archived', '2026-08-03T01:00:00Z');
    const hiddenPages = [hiddenArticleA].concat(hiddenFillers, hiddenArticleB);
    const hiddenPathA = hiddenArticleA.file.path;
    const hiddenPathB = hiddenArticleB.file.path;
    const hiddenFiles = new Map([
      [hiddenPathA, { path: hiddenPathA, _fm: { status: 'archived' } }],
      [hiddenPathB, { path: hiddenPathB, _fm: { status: 'archived' } }],
    ]);
    const hiddenPending = new Map();
    const hiddenReceipts = new Map();
    const hiddenApp = {
      vault: { getAbstractFileByPath: (path) => hiddenFiles.get(path) || null },
      fileManager: {
        processFrontMatter: (target, mutate) => new Promise((resolve, reject) => {
          hiddenPending.set(target.path, {
            resolve: () => { mutate(target._fm); resolve(); },
            reject,
          });
        }),
      },
    };
    const hiddenQueue = new ReaderQueue();
    const hiddenContainer = makeDomEl('div');
    const hiddenDv = makeDv(hiddenPages);
    const hiddenState = { statuses: new Map(), structuralQueue: null, toggles: new Map(), container: hiddenContainer, ctx: null };
    const priorHiddenApp = global.app;
    const priorHiddenWindow = global.window;
    const priorHiddenCustomJS = global.customJS;
    const hadDocument = Object.prototype.hasOwnProperty.call(global, 'document');
    const priorDocument = global.document;
    const waitForHiddenPending = async (path) => {
      for (let i = 0; i < 20 && !hiddenPending.has(path); i++) await new Promise((resolve) => setImmediate(resolve));
      return hiddenPending.has(path);
    };
    let hiddenFocusPassed = false;
    let hiddenDiagnostics = {};
    try {
      global.document = { activeElement: null };
      global.app = hiddenApp;
      global.window = { app: hiddenApp };
      global.customJS = { RenderSafe: { mutateStructure: async (opts) => {
        const receipt = await opts.apply();
        hiddenReceipts.set(opts.path, receipt);
        try { await opts.write(); return { ok: true, receipt }; }
        catch (error) { await opts.rollback(receipt, error); return { ok: false, error }; }
      } } };
      global.window.customJS = global.customJS;
      hiddenQueue._renderResults(hiddenDv, hiddenContainer, null, hiddenState);
      const initialChildren = hiddenContainer.children.slice();
      const initialToggleA = hiddenState.toggles.get(hiddenPathA);
      const bInitiallyHidden = !hiddenState.toggles.has(hiddenPathB);
      const pendingA = hiddenQueue._queueStatusTransition(
        hiddenDv, hiddenState, hiddenPathA, 'archived', 'unread', initialToggleA,
      );
      const aApplied = await waitForHiddenPending(hiddenPathA);
      const detachedBClickTarget = hiddenState.toggles.get(hiddenPathB);
      const bWasRevealed = !!detachedBClickTarget && hiddenContainer.contains(detachedBClickTarget);
      const pendingB = hiddenQueue._queueStatusTransition(
        hiddenDv, hiddenState, hiddenPathB, 'archived', 'unread', detachedBClickTarget,
      );
      await new Promise((resolve) => setImmediate(resolve));
      const bWaited = !hiddenPending.has(hiddenPathB);
      hiddenPending.get(hiddenPathA).reject(new Error('hidden focus fixture A rejected'));
      const bApplied = await waitForHiddenPending(hiddenPathB);
      const reboundBTarget = hiddenReceipts.get(hiddenPathB)?.focusTarget;
      hiddenPending.get(hiddenPathB).reject(new Error('hidden focus fixture B rejected'));
      const settled = await Promise.all([pendingA, pendingB]);
      const reboundWasLive = hiddenContainer.contains(reboundBTarget);
      hiddenFocusPassed = bInitiallyHidden && aApplied && bWasRevealed && bWaited && bApplied
        && settled[0] === false && settled[1] === false
        && reboundBTarget === initialToggleA && reboundWasLive
        && !hiddenState.toggles.has(hiddenPathB)
        && global.document.activeElement === initialToggleA
        && initialToggleA.focused && !detachedBClickTarget.focused
        && hiddenState.statuses.get(hiddenPathA) === 'archived'
        && hiddenState.statuses.get(hiddenPathB) === 'archived'
        && hiddenContainer.children.length === initialChildren.length
        && hiddenContainer.children.every((child, index) => child === initialChildren[index])
        && hiddenState.structuralQueue === null;
      hiddenDiagnostics = { bInitiallyHidden, aApplied, bWasRevealed, bWaited, bApplied,
        settled, reboundIsA: reboundBTarget === initialToggleA, reboundWasLive,
        bHiddenAfter: !hiddenState.toggles.has(hiddenPathB), activeIsA: global.document.activeElement === initialToggleA,
        aFocused: initialToggleA.focused, detachedFocused: detachedBClickTarget.focused,
        statusA: hiddenState.statuses.get(hiddenPathA), statusB: hiddenState.statuses.get(hiddenPathB),
        childCount: hiddenContainer.children.length, initialCount: initialChildren.length,
        exactChildren: hiddenContainer.children.every((child, index) => child === initialChildren[index]),
        queueCleared: hiddenState.structuralQueue === null };
    } finally {
      global.app = priorHiddenApp;
      global.window = priorHiddenWindow;
      global.customJS = priorHiddenCustomJS;
      if (hadDocument) global.document = priorDocument; else delete global.document;
    }
    ok('PERF6C-CROSS-ARTICLE-FOCUS-REBIND hidden sibling rejection focuses a live restored control, never its detached click-time node',
       hiddenFocusPassed,
       JSON.stringify(hiddenDiagnostics));

    const runSearchRollbackFixture = async (QueueClass) => {
      const searchArticle = art('Search Race', 'unread', '2026-08-03T07:00:00Z');
      const searchPath = searchArticle.file.path;
      const searchFile = { path: searchPath, _fm: { status: 'unread' } };
      let pendingWrite = null;
      let onSearchChange = null;
      let capturedState = null;
      const searchApp = {
        vault: { getAbstractFileByPath: (path) => (path === searchPath ? searchFile : null) },
        fileManager: {
          processFrontMatter: (_target, mutate) => new Promise((resolve, reject) => {
            pendingWrite = { resolve: () => { mutate(searchFile._fm); resolve(); }, reject };
          }),
        },
      };
      const resultsContainer = makeDomEl('div');
      const hostContainer = makeDomEl('div');
      const searchInput = hostContainer.createEl('input');
      hostContainer.appendChild(resultsContainer);
      const searchDv = Object.assign(makeDv([searchArticle]), {
        container: hostContainer,
        current: () => ({ type: 'reader-hub', file: { path: 'spice/reader/Reader.md' } }),
      });
      const initialCtx = { resultsContainer, hasActiveFilter: false, query: '' };
      const priorSearchApp = global.app;
      const priorSearchWindow = global.window;
      const priorSearchCustomJS = global.customJS;
      const hadSearchDocument = Object.prototype.hasOwnProperty.call(global, 'document');
      const priorSearchDocument = global.document;
      try {
        global.document = {
          activeElement: null,
          body: null,
          contains: (node) => hostContainer.contains(node),
        };
        global.app = searchApp;
        global.window = { app: searchApp };
        global.customJS = {
          DocSearch: {
            render: (_dv, opts) => { onSearchChange = opts.onChange; return initialCtx; },
            matches: (page, ctx) => !ctx.query || page.file.path === searchPath,
          },
          RenderSafe: {
            page: (dv) => dv.current(),
            mutateStructure: async (opts) => {
              const receipt = await opts.apply();
              try { await opts.write(); return { ok: true, receipt }; }
              catch (error) { await opts.rollback(receipt, error); return { ok: false, error }; }
            },
          },
        };
        global.window.customJS = global.customJS;
        const queue = new QueueClass();
        const renderResults = queue._renderResults;
        queue._renderResults = function (...args) {
          capturedState = args[3];
          return renderResults.apply(this, args);
        };
        queue.render(searchDv);
        const initialToggle = capturedState && capturedState.toggles.get(searchPath);
        const transition = initialToggle.listeners.click({ stopPropagation() {} });
        for (let i = 0; i < 20 && !pendingWrite; i++) await new Promise((resolve) => setImmediate(resolve));
        if (!pendingWrite || typeof onSearchChange !== 'function') return false;
        const activeCtx = { resultsContainer, hasActiveFilter: true, query: 'Search Race' };
        onSearchChange(activeCtx);
        const activeSearchRendered = resultsContainer.children.some((child) => child.textContent === 'Results (1)');
        const optimisticSearchToggle = capturedState.toggles.get(searchPath);
        const optimisticSearchCoherent = optimisticSearchToggle
          && optimisticSearchToggle.textContent === 'Reading'
          && resultsContainer.contains(optimisticSearchToggle);
        searchInput.focus();
        const searchFocusBeforeRejection = global.document.activeElement === searchInput;
        pendingWrite.reject(new Error('search race fixture rejected'));
        await transition;
        const restoredToggle = capturedState.toggles.get(searchPath);
        return activeSearchRendered && optimisticSearchCoherent && searchFocusBeforeRejection
          && capturedState.ctx === activeCtx && capturedState.statuses.get(searchPath) === 'unread'
          && resultsContainer.children.some((child) => child.textContent === 'Results (1)')
          && !resultsContainer.children.some((child) => child.textContent === 'Unread')
          && restoredToggle && restoredToggle !== optimisticSearchToggle
          && restoredToggle.textContent === 'Unread' && resultsContainer.contains(restoredToggle)
          && global.document.activeElement === searchInput && searchInput.focused
          && capturedState.structuralQueue === null;
      } catch (_e) {
        return false;
      } finally {
        global.app = priorSearchApp;
        global.window = priorSearchWindow;
        global.customJS = priorSearchCustomJS;
        if (hadSearchDocument) global.document = priorSearchDocument; else delete global.document;
      }
    };
    const staleSearchMutantSrc = queueSrc.replace(
      'if (this._receiptOwnsSurface(state, receipt)) {',
      'if (true) { // controlled stale-receipt mutant',
    );
    const StaleSearchReaderQueue = new Function(`${staleSearchMutantSrc}\nreturn ReaderQueue;`)();
    const liveSearchRollback = await runSearchRollbackFixture(ReaderQueue);
    const mutantSearchRollback = await runSearchRollbackFixture(StaleSearchReaderQueue);
    ok('PERF6D-DOCSEARCH-ROLLBACK-COORDINATION rejection preserves the newest filtered render and kills stale whole-container restoration',
       staleSearchMutantSrc !== queueSrc && liveSearchRollback && !mutantSearchRollback);

    const runHiddenSuccessFixture = async (QueueClass, preserveUserFocus) => {
      const hiddenSuccessTarget = art('Hidden Success target', 'reading', '2026-08-03T00:00:00Z');
      const hiddenSuccessArchived = [5, 4, 3, 2, 1].map((hour) =>
        art('Hidden Success archived ' + hour, 'archived', `2026-08-03T0${hour}:00:00Z`));
      const targetPath = hiddenSuccessTarget.file.path;
      const targetFile = { path: targetPath, _fm: { status: 'reading' } };
      let pendingSuccess = null;
      const successApp = {
        vault: { getAbstractFileByPath: (path) => (path === targetPath ? targetFile : null) },
        fileManager: {
          processFrontMatter: (_target, mutate) => new Promise((resolve) => {
            pendingSuccess = { resolve: () => { mutate(targetFile._fm); resolve(); } };
          }),
        },
      };
      const successHost = makeDomEl('div');
      const successInput = successHost.createEl('input');
      const successContainer = successHost.createEl('div');
      const successDv = makeDv([hiddenSuccessTarget].concat(hiddenSuccessArchived));
      const successState = {
        statuses: new Map(), structuralQueue: null, toggles: new Map(),
        container: successContainer, ctx: null, renderGeneration: 0,
      };
      const priorSuccessApp = global.app;
      const priorSuccessWindow = global.window;
      const priorSuccessCustomJS = global.customJS;
      const hadSuccessDocument = Object.prototype.hasOwnProperty.call(global, 'document');
      const priorSuccessDocument = global.document;
      try {
        global.app = successApp;
        global.window = { app: successApp };
        global.document = {
          activeElement: null,
          body: null,
          contains: (node) => successHost.contains(node),
        };
        global.customJS = { RenderSafe: { mutateStructure: async (opts) => {
          const receipt = await opts.apply();
          try { await opts.write(); return { ok: true, receipt }; }
          catch (error) { await opts.rollback(receipt, error); return { ok: false, error }; }
        } } };
        global.window.customJS = global.customJS;
        const queue = new QueueClass();
        queue._renderResults(successDv, successContainer, null, successState);
        const clickTarget = successState.toggles.get(targetPath);
        global.document.activeElement = clickTarget;
        const saving = queue._setStatus(successDv, successState, targetPath, 'archived', clickTarget);
        for (let i = 0; i < 20 && !pendingSuccess; i++) await new Promise((resolve) => setImmediate(resolve));
        if (!pendingSuccess) return false;
        const appliedFallback = global.document.activeElement;
        const appliedFallbackWasLive = appliedFallback && appliedFallback !== clickTarget
          && successContainer.contains(appliedFallback);
        queue._clearContainer(successContainer);
        queue._renderResults(successDv, successContainer, null, successState);
        const appliedFallbackWasDetached = !successContainer.contains(appliedFallback);
        if (preserveUserFocus) successInput.focus();
        pendingSuccess.resolve();
        const saved = await saving;
        const active = global.document.activeElement;
        const focusIsCorrect = preserveUserFocus
          ? active === successInput && successInput.focused
          : active && active !== clickTarget && active !== appliedFallback
            && successContainer.contains(active)
            && [...successState.toggles.values()].includes(active) && active.focused;
        return saved && appliedFallbackWasLive && appliedFallbackWasDetached
          && targetFile._fm.status === 'archived'
          && successState.statuses.get(targetPath) === 'archived'
          && !successState.toggles.has(targetPath)
          && successContainer.querySelectorAll('.sauce-reader-row').length === 5
          && focusIsCorrect
          && !successContainer.contains(clickTarget);
      } catch (_e) {
        return false;
      } finally {
        global.app = priorSuccessApp;
        global.window = priorSuccessWindow;
        global.customJS = priorSuccessCustomJS;
        if (hadSuccessDocument) global.document = priorSuccessDocument; else delete global.document;
      }
    };
    const hiddenSuccessMutantSrc = queueSrc.replace(
      'const settledFocusTarget = this._liveFocusTarget(state, path, focusTarget, true);',
      'const settledFocusTarget = state.toggles.get(path); // controlled hidden-success mutant',
    );
    const HiddenSuccessReaderQueue = new Function(`${hiddenSuccessMutantSrc}\nreturn ReaderQueue;`)();
    const liveHiddenSuccess = await runHiddenSuccessFixture(ReaderQueue, false);
    const liveHiddenSuccessInput = await runHiddenSuccessFixture(ReaderQueue, true);
    const mutantHiddenSuccess = await runHiddenSuccessFixture(HiddenSuccessReaderQueue, false);
    ok('PERF6E-HIDDEN-SUCCESS-FOCUS capped archive success rebinds a rerender-detached fallback at settlement',
       hiddenSuccessMutantSrc !== queueSrc && liveHiddenSuccess && liveHiddenSuccessInput && !mutantHiddenSuccess);

    const runQueuedApplyFocusFixture = async (QueueClass) => {
      const queuedA = art('Queued Focus A', 'unread', '2026-08-03T07:00:00Z');
      const queuedB = art('Queued Focus B', 'reading', '2026-08-03T00:00:00Z');
      const queuedArchived = [5, 4, 3, 2, 1].map((hour) =>
        art('Queued Focus archived ' + hour, 'archived', `2026-08-03T0${hour}:00:00Z`));
      const pathA = queuedA.file.path;
      const pathB = queuedB.file.path;
      const queuedFiles = new Map([
        [pathA, { path: pathA, _fm: { status: 'unread' } }],
        [pathB, { path: pathB, _fm: { status: 'reading' } }],
      ]);
      const queuedWrites = new Map();
      const queuedApp = {
        vault: { getAbstractFileByPath: (path) => queuedFiles.get(path) || null },
        fileManager: {
          processFrontMatter: (target, mutate) => new Promise((resolve) => {
            queuedWrites.set(target.path, { resolve: () => { mutate(target._fm); resolve(); } });
          }),
        },
      };
      const queuedHost = makeDomEl('div');
      const queuedInput = queuedHost.createEl('input');
      const queuedContainer = queuedHost.createEl('div');
      const queuedDv = makeDv([queuedA, queuedB].concat(queuedArchived));
      const queuedState = {
        statuses: new Map(), structuralQueue: null, toggles: new Map(),
        container: queuedContainer, ctx: null, renderGeneration: 0,
      };
      const priorQueuedApp = global.app;
      const priorQueuedWindow = global.window;
      const priorQueuedCustomJS = global.customJS;
      const hadQueuedDocument = Object.prototype.hasOwnProperty.call(global, 'document');
      const priorQueuedDocument = global.document;
      const waitForQueuedWrite = async (path) => {
        for (let i = 0; i < 20 && !queuedWrites.has(path); i++) await new Promise((resolve) => setImmediate(resolve));
        return queuedWrites.has(path);
      };
      try {
        global.app = queuedApp;
        global.window = { app: queuedApp };
        global.document = {
          activeElement: null,
          body: null,
          contains: (node) => queuedHost.contains(node),
        };
        global.customJS = { RenderSafe: { mutateStructure: async (opts) => {
          const receipt = await opts.apply();
          try { await opts.write(); return { ok: true, receipt }; }
          catch (error) { await opts.rollback(receipt, error); return { ok: false, error }; }
        } } };
        global.window.customJS = global.customJS;
        const queue = new QueueClass();
        queue._renderResults(queuedDv, queuedContainer, null, queuedState);
        const clickA = queuedState.toggles.get(pathA);
        const transitionA = queue._queueStatusTransition(queuedDv, queuedState, pathA, 'unread', 'reading', clickA);
        const aApplied = await waitForQueuedWrite(pathA);
        const clickB = queuedState.toggles.get(pathB);
        const transitionB = queue._queueStatusTransition(queuedDv, queuedState, pathB, 'reading', 'archived', clickB);
        await new Promise((resolve) => setImmediate(resolve));
        const bWaited = !queuedWrites.has(pathB);
        queuedInput.focus();
        queuedWrites.get(pathA).resolve();
        const bApplied = await waitForQueuedWrite(pathB);
        const focusSurvivedApply = global.document.activeElement === queuedInput;
        const bHiddenAfterApply = !queuedState.toggles.has(pathB) && !queuedContainer.contains(clickB);
        queuedWrites.get(pathB).resolve();
        const settled = await Promise.all([transitionA, transitionB]);
        return aApplied && bWaited && bApplied && focusSurvivedApply && bHiddenAfterApply
          && settled[0] === true && settled[1] === true
          && queuedState.statuses.get(pathA) === 'reading'
          && queuedState.statuses.get(pathB) === 'archived'
          && queuedFiles.get(pathA)._fm.status === 'reading'
          && queuedFiles.get(pathB)._fm.status === 'archived'
          && global.document.activeElement === queuedInput && queuedInput.focused
          && queuedState.structuralQueue === null;
      } catch (_e) {
        return false;
      } finally {
        global.app = priorQueuedApp;
        global.window = priorQueuedWindow;
        global.customJS = priorQueuedCustomJS;
        if (hadQueuedDocument) global.document = priorQueuedDocument; else delete global.document;
      }
    };
    const queuedApplyMutantSrc = queueSrc.replace(
      'const appliedFocusTarget = this._liveFocusTarget(state, path, focusTarget, true);',
      'const appliedFocusTarget = this._liveFocusTarget(state, path, focusTarget); // controlled queued-focus mutant',
    );
    const QueuedApplyReaderQueue = new Function(`${queuedApplyMutantSrc}\nreturn ReaderQueue;`)();
    const liveQueuedApplyFocus = await runQueuedApplyFocusFixture(ReaderQueue);
    const mutantQueuedApplyFocus = await runQueuedApplyFocusFixture(QueuedApplyReaderQueue);
    ok('PERF6F-QUEUED-APPLY-FOCUS queued apply and settlement preserve newer connected DocSearch focus',
       queuedApplyMutantSrc !== queueSrc && liveQueuedApplyFocus && !mutantQueuedApplyFocus);
  } finally {
    global.app = priorApp;
    global.customJS = priorCustomJS;
    global.window = priorWindow;
    global.Notice = priorNotice;
  }
}

const harnessTimeout = setTimeout(() => {
  console.error('Reader harness timed out before the final verdict; unresolved async fixtures are failures.');
  process.exit(1);
}, 10000);

dataviewCorrectnessCases().then(() => {
  clearTimeout(harnessTimeout);
  const passed = results.filter(([, p]) => p).length;
  const total  = results.length;
  console.log(`\n${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}).catch((error) => {
  clearTimeout(harnessTimeout);
  console.error(error && error.stack || error);
  process.exit(1);
});
