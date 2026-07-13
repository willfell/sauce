#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const StickyChromeBar = loadClass('platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js', 'StickyChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new StickyChromeBar();
const cfg = inst._config();

// SCB-DETECT — classify sticky surfaces; null off-surface.
{
  const hub = cfg.detect({}, { file: { path: 'spice/sticky-notes/Sticky.md' }, type: 'sticky-hub' });
  const day = cfg.detect({}, { file: { path: 'spice/sticky-notes/2026/07-July/2026-07-06/Sticky-Day-2026-07-06.md' }, type: 'sticky-day', day: '2026-07-06' });
  const leaf = cfg.detect({}, { file: { path: 'spice/sticky-notes/2026/07-July/2026-07-06/Sticky-2026-07-06-14-30.md' }, type: 'sticky-note', day: '2026-07-06' });
  const off = cfg.detect({}, { file: { path: 'spice/wiki/Wiki.md' }, type: 'wiki-hub' });
  ok('SCB-DETECT-1 sticky-hub/day/note classify; non-sticky → null',
    hub && hub.context === 'sticky-hub' && day && day.context === 'sticky-day'
    && leaf && leaf.context === 'sticky-note' && off === null);
}

// SCB-SPEC — surface specs match approved design.
{
  const h = cfg.surfaceSpec({ context: 'sticky-hub' });
  const d = cfg.surfaceSpec({ context: 'sticky-day' });
  const l = cfg.surfaceSpec({ context: 'sticky-note' });
  ok('SCB-SPEC-1 hub: primary Today + no overflow + not leaf',
    h.primary && h.primary.id === 'today' && h.overflow.length === 0 && h.leaf === false);
  ok('SCB-SPEC-2 day: primary new-sticky-note + overflow hub + not leaf',
    d.primary && d.primary.id === 'new-sticky-note' && d.overflow.length === 1 && d.overflow[0].id === 'hub' && d.leaf === false);
  ok('SCB-SPEC-3 note: no primary + overflow back-day,hub,rename,add-link,move-day,delete + leaf',
    l.primary === null && l.overflow.length === 6
    && l.overflow[0].id === 'back-day' && l.overflow[1].id === 'hub'
    && l.overflow[2].id === 'rename' && l.overflow[3].id === 'add-link'
    && l.overflow[4].id === 'move-day' && l.overflow[5].id === 'delete');
}

// SCB-DISPATCH — routes to correct handlers.
{
  const calls = [];
  const prevCJS = global.customJS;
  global.customJS = {
    EntityCreate: { create: (o) => calls.push({ create: o.instance }) },
    RenderSafe: { page: () => ({ day: '2026-07-06' }) },
    ChromeBar: { openNavTarget: () => {} },
  };
  global.app = {
    workspace: { openLinkText: (p) => calls.push({ openLink: p }) },
    vault: { getAbstractFileByPath: () => null },
    plugins: { plugins: {} },
  };
  global.window = { moment: (d, f, s) => ({
    format: (fmt) => {
      if (fmt === 'YYYY-MM-DD') return '2026-07-06';
      if (fmt === 'YYYY/MM-MMMM') return '2026/07-July';
      return '2026-07-06';
    },
    isValid: () => true,
  }) };
  global.Notice = function(m) { calls.push({ notice: m }); };

  cfg.dispatch({}, { context: 'sticky-day' }, 'new-sticky-note');
  cfg.dispatch({}, { context: 'sticky-note' }, 'hub');
  cfg.dispatch({}, { context: 'sticky-note', day: '2026-07-06' }, 'back-day');

  ok('SCB-DISPATCH-1 new-sticky-note → EntityCreate.create(sticky-note)', calls.some(c => c.create === 'sticky-note'));
  ok('SCB-DISPATCH-2 hub → openLinkText(Sticky.md)', calls.some(c => c.openLink === 'spice/sticky-notes/Sticky.md'));
  ok('SCB-DISPATCH-3 back-day → openLinkText(Sticky-Day-*)', calls.some(c => c.openLink && c.openLink.includes('Sticky-Day-2026-07-06')));

  global.customJS = prevCJS;
  delete global.window;
  delete global.app;
  delete global.Notice;
}

// SCB-DEST — destinations include section marker + hub.
{
  const prevCJS = global.customJS;
  global.customJS = { ChromeBar: { openNavTarget: () => {} }, RenderSafe: { page: () => ({ day: '2026-07-06' }) } };
  global.window = { moment: (d, f, s) => ({ format: (fmt) => fmt === 'YYYY/MM-MMMM' ? '2026/07-July' : '2026-07-06', isValid: () => true }) };
  const dests = cfg.destinations({}, { context: 'sticky-note', path: 'spice/sticky-notes/2026/07-July/2026-07-06/Sticky-2026-07-06-14-30.md', day: '2026-07-06' });
  ok('SCB-DEST-1 includes This sticky note section + Sticky Notes Hub + Day Hub',
    dests[0] && dests[0].section === 'This sticky note'
    && dests.some(e => e && e.label === 'Sticky Notes Hub')
    && dests.some(e => e && e.label === 'Day Hub'));
  global.customJS = prevCJS;
  delete global.window;
}

// SCB-CLASS — rootClass + btnClass correct.
{
  ok('SCB-CLASS-1 rootClass + btnClass',
    cfg.rootClass === 'sticky-chrome-root' && cfg.btnClass('go') === 'sticky-chrome-btn sticky-chrome-btn-go');
}

// STCB-BANNER-1 — _bannerText fallback: title → filename → null
{
  ok('STCB-BANNER-1a title used', inst._bannerText({ title: 'Grocery list', file: { name: 'Sticky-2026-07-06-14-30' } }) === 'Grocery list');
  ok('STCB-BANNER-1b whitespace title → filename', inst._bannerText({ title: '  ', file: { name: 'Sticky-X' } }) === 'Sticky-X');
  ok('STCB-BANNER-1c missing title → filename', inst._bannerText({ file: { name: 'Sticky-Y' } }) === 'Sticky-Y');
  ok('STCB-BANNER-1d nothing → null', inst._bannerText({}) === null);
}

// STCB-BANNER-2/3 — _renderTitleBanner: dedupes, label + hairline BELOW, correct order
{
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

  const titledPage = { title: 'Grocery list', file: { path: 'x.md', name: 'Sticky-X' } };
  const untitledPage = { file: { path: 'y.md', name: 'Sticky-Y' } };
  const emptyPage = { file: { path: 'z.md' } };
  const fileStub = { path: 'x.md' };

  const c1 = makeContainer();
  inst._renderTitleBanner(c1, titledPage, fileStub);
  inst._renderTitleBanner(c1, titledPage, fileStub);
  const live1 = c1.children.filter((n) => !n._removed && n.cls === 'sticky-title-banner');
  ok('STCB-BANNER-2 exactly one banner after double render (dedup)', live1.length === 1);
  const kids1 = live1[0].children;
  ok('STCB-BANNER-3a titled banner shows title text',
    kids1.some((h) => h.textContent === 'Grocery list'));
  ok('STCB-BANNER-3b banner has SectionLabel-style label (uppercase + 0.78em)',
    kids1.some((h) => /text-transform:\s*uppercase/.test(h.style.cssText) && /font-size:\s*0\.78em/.test(h.style.cssText)));
  const labelIdx1 = kids1.findIndex((n) => n.tag === 'div' && n.textContent === 'Grocery list');
  const hrIdx1 = kids1.findIndex((n) => n.tag === 'hr');
  ok('STCB-BANNER-4 hairline is BELOW label (hr appears after label in child order)',
    labelIdx1 >= 0 && hrIdx1 > labelIdx1);
  ok('STCB-BANNER-5 hairline uses border-hover var',
    kids1[hrIdx1].style.cssText.includes('border-modifier-border-hover') || kids1[hrIdx1].style.cssText.includes('background-modifier-border-hover'));

  const c2 = makeContainer();
  inst._renderTitleBanner(c2, untitledPage, { path: 'y.md' });
  const kids2 = c2.children.filter((n) => !n._removed && n.cls === 'sticky-title-banner')[0].children;
  ok('STCB-BANNER-6 no-title falls back to filename stem',
    kids2.some((h) => h.textContent === 'Sticky-Y'));

  const c3 = makeContainer();
  inst._renderTitleBanner(c3, emptyPage, { path: 'z.md' });
  const kids3 = c3.children.filter((n) => !n._removed && n.cls === 'sticky-title-banner')[0].children;
  ok('STCB-BANNER-7 no title AND no filename → placeholder',
    kids3.some((h) => /Untitled/i.test(h.textContent) && /italic/.test(h.style.cssText)));
}

// SCB-LINKS — pinned-links row called on leaf, not on hub/day
{
  const prevCJS = global.customJS;
  const calls = [];
  global.customJS = {
    ChromeBar: {
      makeAdapter: (c) => c,
      render: () => {},
      openNavTarget: () => {},
    },
    RenderSafe: { page: (dv) => (dv && dv._page) || null },
    SectionExplorer: { renderNoteLinks: (dv) => { calls.push({ links: (dv && dv._page && dv._page.type) || 'unknown' }); } },
  };
  const container = { createEl: () => ({ style: {}, addEventListener: () => {}, createEl: () => ({ style: {} }) }), querySelectorAll: () => [] };

  const leafDv = { container, current: () => ({ type: 'sticky-note', file: { path: 'x.md', name: 'X' } }), _page: { type: 'sticky-note', file: { path: 'x.md', name: 'X' } } };
  inst.render(leafDv);
  ok('SCB-LINKS-1 renderNoteLinks called on sticky-note leaf', calls.some((c) => c.links === 'sticky-note'));

  const hubDv = { container, current: () => ({ type: 'sticky-hub', file: { path: 'Sticky.md' } }), _page: { type: 'sticky-hub', file: { path: 'Sticky.md' } } };
  calls.length = 0;
  inst.render(hubDv);
  ok('SCB-LINKS-2 renderNoteLinks NOT called on sticky-hub', calls.length === 0);

  const dayDv = { container, current: () => ({ type: 'sticky-day', file: { path: 'D.md' }, day: '2026-07-13' }), _page: { type: 'sticky-day', file: { path: 'D.md' } } };
  calls.length = 0;
  inst.render(dayDv);
  ok('SCB-LINKS-3 renderNoteLinks NOT called on sticky-day', calls.length === 0);

  global.customJS = prevCJS;
}

// SCB-DIALOG — new dialog methods present, honor guards
{
  ok('SCB-DIALOG-1 _openMoveDayDialog is a function', typeof inst._openMoveDayDialog === 'function');
  ok('SCB-DIALOG-2 _openDeleteDialog is a function', typeof inst._openDeleteDialog === 'function');

  // Guard: no throw when app/document missing.
  const prevApp = global.app, prevDoc = global.document;
  delete global.app; delete global.document;
  let threw = false;
  try {
    inst._openMoveDayDialog({}, { context: 'sticky-note', path: 'x.md', day: '2026-07-06' });
    inst._openDeleteDialog(null, 'spice/sticky-notes/Sticky.md', 'sticky note');
  } catch (_e) { threw = true; }
  ok('SCB-DIALOG-3 dialogs are never-throw when app/document missing', !threw);
  global.app = prevApp; global.document = prevDoc;
}

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
