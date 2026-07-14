#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const JournalChromeBar = loadClass('platform/blueprints/journal/helpers/journal-chrome-bar.js', 'JournalChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new JournalChromeBar();
const cfg = inst._config();

// JCB-DETECT — three surfaces + non-journal off-switch.
{
  const hub = cfg.detect({}, { file: { path: 'spice/journal/Journal.md' }, type: 'journal-hub' });
  const day = cfg.detect({}, { file: { path: 'spice/journal/2026/01-January/2026-01-14/Journal-Day-2026-01-14.md' }, type: 'journal-day', day: '2026-01-14' });
  const entry = cfg.detect({}, { file: { path: 'spice/journal/2026/01-January/2026-01-14/Journal-2026-01-14-09-30-00.md' }, type: 'journal-entry', day: '2026-01-14' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('JCB-DETECT-1 journal-hub classifies', hub && hub.context === 'journal-hub');
  ok('JCB-DETECT-2 journal-day classifies + carries day', day && day.context === 'journal-day' && day.day === '2026-01-14');
  ok('JCB-DETECT-3 journal-entry classifies + carries day', entry && entry.context === 'journal-entry' && entry.day === '2026-01-14');
  ok('JCB-DETECT-4 non-journal type → null', off === null);
}
// JCB-SPEC — per-surface primary/overflow/leaf shape.
{
  const hub = cfg.surfaceSpec({ context: 'journal-hub' });
  ok('JCB-SPEC-1 journal-hub: primary=Today, leaf=false', hub.primary && hub.primary.id === 'today' && hub.leaf === false);
  const day = cfg.surfaceSpec({ context: 'journal-day' });
  ok('JCB-SPEC-2 journal-day: primary=new-journal-entry, overflow has hub, leaf=false',
    day.primary && day.primary.id === 'new-journal-entry' && day.overflow.some(o => o.id === 'hub') && day.leaf === false);
  const entry = cfg.surfaceSpec({ context: 'journal-entry' });
  ok('JCB-SPEC-3 journal-entry: primary=null, overflow has back-day+hub, leaf=true',
    entry.primary === null && entry.overflow.some(o => o.id === 'back-day') && entry.overflow.some(o => o.id === 'hub') && entry.leaf === true);
}
// JCB-DISPATCH — never throws for any known id or an unknown one.
{
  let threw = false;
  try {
    cfg.dispatch({}, { context: 'journal-day' }, 'unknown-id');
  } catch (_e) { threw = true; }
  ok('JCB-DISPATCH-1 unknown id never throws', threw === false);
}
// JCB-DEST — leads with "This journal entry" marker; includes hub when not already there.
{
  const prevCJS = global.customJS;
  global.customJS = { ChromeBar: { openNavTarget: () => {} }, RenderSafe: { page: () => ({ day: '2026-01-14' }) } };
  global.window = { moment: (d, f, s) => ({ format: (fmt) => fmt === 'YYYY/MM-MMMM' ? '2026/01-January' : '2026-01-14', isValid: () => true }) };
  const dest = cfg.destinations({}, { context: 'journal-entry', path: 'spice/journal/2026/01-January/2026-01-14/Journal-2026-01-14-09-30-00.md', day: '2026-01-14' });
  ok('JCB-DEST-1 destinations lead with This journal entry marker', dest[0] && dest[0].section === 'This journal entry');
  ok('JCB-DEST-2 destinations include Journal Hub', dest.some(d => d.label === 'Journal Hub'));
  global.customJS = prevCJS;
  delete global.window;
}
// JCB-BANNER — mirrors STCB-BANNER: SectionLabel-style label, filename fallback, hairline below
{
  const inst = new JournalChromeBar();
  ok('JCB-BANNER-1a title used', inst._bannerText({ title: 'Morning notes', file: { name: 'Journal-X' } }) === 'Morning notes');
  ok('JCB-BANNER-1b whitespace → filename', inst._bannerText({ title: '   ', file: { name: 'Journal-Y' } }) === 'Journal-Y');
  ok('JCB-BANNER-1c missing title → filename', inst._bannerText({ file: { name: 'Journal-Z' } }) === 'Journal-Z');
  ok('JCB-BANNER-1d nothing → null', inst._bannerText({}) === null);

  const makeNode = (tag, opts) => {
    const node = {
      tag, cls: (opts && opts.cls) || '', textContent: (opts && opts.text) || '',
      title: '', style: { cssText: '' }, children: [], _removed: false,
      createEl(t, o) { const c = makeNode(t, o); this.children.push(c); return c; },
      addEventListener() {}, remove() { this._removed = true; },
    };
    return node;
  };
  const makeContainer = () => {
    const container = makeNode('div', {});
    container.querySelectorAll = (sel) => {
      const cls = sel.replace(/^\./, '');
      return container.children.filter((c) => !c._removed && c.cls === cls);
    };
    return container;
  };

  const c = makeContainer();
  inst._renderTitleBanner(c, { title: 'Morning notes', file: { path: 'x.md', name: 'Journal-X' } }, { path: 'x.md' });
  inst._renderTitleBanner(c, { title: 'Morning notes', file: { path: 'x.md', name: 'Journal-X' } }, { path: 'x.md' });
  const live = c.children.filter((n) => !n._removed && n.cls === 'journal-title-banner');
  ok('JCB-BANNER-2 dedupes to single banner', live.length === 1);
  const kids = live[0].children;
  const labelIdx = kids.findIndex((n) => n.tag === 'div' && n.textContent === 'Morning notes');
  const hrIdx = kids.findIndex((n) => n.tag === 'hr');
  ok('JCB-BANNER-3 SectionLabel-style label', labelIdx >= 0
    && /text-transform:\s*uppercase/.test(kids[labelIdx].style.cssText)
    && /0\.78em/.test(kids[labelIdx].style.cssText));
  ok('JCB-BANNER-4 NO hairline under title', hrIdx === -1 && labelIdx >= 0);
}

// JCB-SPEC — journal-entry overflow shape
{
  const inst = new JournalChromeBar();
  const cfg = inst._config();
  const l = cfg.surfaceSpec({ context: 'journal-entry' });
  ok('JCB-SPEC-EXTRA-1 leaf overflow includes back-day,hub,rename,delete',
    l.overflow.length === 4
    && l.overflow[0].id === 'back-day' && l.overflow[1].id === 'hub'
    && l.overflow[2].id === 'rename' && l.overflow[3].id === 'delete');
}

// JCB-DIALOG — _openDeleteDialog exists + never-throws under empty globals
{
  const inst = new JournalChromeBar();
  ok('JCB-DIALOG-1 _openDeleteDialog function', typeof inst._openDeleteDialog === 'function');
  const prevApp = global.app, prevDoc = global.document;
  delete global.app; delete global.document;
  let threw = false;
  try { inst._openDeleteDialog(null, 'spice/journal/Journal.md', 'journal entry'); } catch (_e) { threw = true; }
  ok('JCB-DIALOG-2 never-throws under missing app/document', !threw);
  global.app = prevApp; global.document = prevDoc;
}

// JCB-DISPATCH — rename + delete route correctly
{
  const inst = new JournalChromeBar();
  const cfg = inst._config();
  let renameCalled = false, deleteCalled = false;
  inst._openRenameDialog = () => { renameCalled = true; };
  inst._openDeleteDialog = () => { deleteCalled = true; };
  const prevApp = global.app, prevCJS = global.customJS;
  global.app = { vault: { getAbstractFileByPath: () => ({ path: 'x.md' }) } };
  global.customJS = { RenderSafe: { page: () => ({ file: { path: 'x.md' }, title: 'T' }) } };
  cfg.dispatch({ current: () => ({}) }, { context: 'journal-entry', path: 'x.md' }, 'rename');
  cfg.dispatch({ current: () => ({}) }, { context: 'journal-entry', path: 'x.md' }, 'delete');
  ok('JCB-DISPATCH-RENAME rename opens rename dialog', renameCalled);
  ok('JCB-DISPATCH-DELETE delete opens delete dialog', deleteCalled);
  global.app = prevApp; global.customJS = prevCJS;
}

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
