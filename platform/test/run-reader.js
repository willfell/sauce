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
const passed = results.filter(([, p]) => p).length;
const total  = results.length;
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
