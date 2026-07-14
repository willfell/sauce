#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const ReaderChromeBar = loadClass('platform/blueprints/reader/helpers/reader-chrome-bar.js', 'ReaderChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new ReaderChromeBar();
const cfg = inst._config();

// RCB-DETECT
{
  const hub = cfg.detect({}, { file: { path: 'spice/reader/Reader.md' }, type: 'reader-hub' });
  const article = cfg.detect({}, { file: { path: 'spice/reader/Some Article.md' }, type: 'reader-article', status: 'reading', url: 'https://x.com/a' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('RCB-DETECT-1 reader-hub/reader-article classify; non-reader → null',
    hub && hub.context === 'reader-hub' && article && article.context === 'reader-article' && article.status === 'reading' && article.url === 'https://x.com/a' && off === null);
}
// RCB-SPEC
{
  const prevCJS = global.customJS;
  global.customJS = {
    ReaderArticleActions: {
      statusTransitions: (status) => {
        const s = String(status == null ? '' : status).trim().toLowerCase();
        if (s === 'reading') {
          return [
            { label: 'Mark read', next: 'archived' },
            { label: 'Back to unread', next: 'unread' },
          ];
        }
        if (s === 'archived') {
          return [
            { label: 'Back to reading', next: 'reading' },
            { label: 'Mark unread', next: 'unread' },
          ];
        }
        return [
          { label: 'Mark reading', next: 'reading' },
          { label: 'Mark read', next: 'archived' },
        ];
      },
    },
  };
  const h = cfg.surfaceSpec({ context: 'reader-hub' });
  const unread = cfg.surfaceSpec({ context: 'reader-article', status: 'unread', url: '' });
  const reading = cfg.surfaceSpec({ context: 'reader-article', status: 'reading', url: 'https://x.com/a' });
  global.customJS = prevCJS;
  ok('RCB-SPEC-1 hub: primary new-article + not leaf', h.primary.id === 'new-article' && h.leaf === false);
  ok('RCB-SPEC-2 unread article, no url: leaf + no open-article + 2 status actions',
    unread.leaf === true && !unread.overflow.some(o => o.id === 'open-article') && unread.overflow.some(o => o.id === 'status-reading') && unread.overflow.some(o => o.id === 'status-archived'));
  ok('RCB-SPEC-3 reading article with url: open-article + 2 status actions (archived, unread)',
    reading.overflow.some(o => o.id === 'open-article') && reading.overflow.some(o => o.id === 'status-archived') && reading.overflow.some(o => o.id === 'status-unread'));
}
// RCB-SPEC-4 — customJS unavailable entirely: surfaceSpec must not throw, overflow has no status-* entries.
{
  const prevCJS2 = global.customJS;
  delete global.customJS;
  let threw = false;
  let noStatusActions = false;
  try {
    const degraded = cfg.surfaceSpec({ context: 'reader-article', status: 'unread', url: '' });
    noStatusActions = !degraded.overflow.some(o => o.id && o.id.indexOf('status-') === 0);
  } catch (_e) { threw = true; }
  global.customJS = prevCJS2;
  ok('RCB-SPEC-4 surfaceSpec never throws when customJS is entirely undefined, and has no status actions', threw === false && noStatusActions);
}
// RCB-DISPATCH
{
  const calls = [];
  const paste = [];
  const prevCJS = global.customJS;
  const prevWindow = global.window;
  global.window = { open: (url) => calls.push({ openUrl: url }) };
  global.customJS = {
    ReaderArticlePaste: { open: () => paste.push(true) },
    EntityCreate: { create: (o) => calls.push({ create: o.instance }) },
    ReaderArticleActions: { _setStatus: (p, next) => calls.push({ setStatus: p + ':' + next }) },
  };
  const dv = {};
  cfg.dispatch(dv, { context: 'reader-hub' }, 'new-article');
  cfg.dispatch(dv, { context: 'reader-article', url: 'https://x.com/a' }, 'open-article');
  cfg.dispatch(dv, { context: 'reader-article', path: 'spice/reader/Some Article.md' }, 'status-archived');
  global.customJS = prevCJS;
  global.window = prevWindow;
  ok('RCB-DISPATCH-1 new-article → ReaderArticlePaste.open (not EntityCreate)',
    paste.length === 1 && !calls.some(c => c.create === 'reader-article'));
  ok('RCB-DISPATCH-2 open-article → window.open(url)', calls.some(c => c.openUrl === 'https://x.com/a'));
  ok('RCB-DISPATCH-3 status-archived → ReaderArticleActions._setStatus(path, "archived")', calls.some(c => c.setStatus === 'spice/reader/Some Article.md:archived'));
}
// RCB-DISPATCH-1b — no ReaderArticlePaste → falls back to EntityCreate.create.
{
  const calls = [];
  const prevCJS = global.customJS;
  global.customJS = {
    EntityCreate: { create: (o) => calls.push({ create: o.instance }) },
  };
  cfg.dispatch({}, { context: 'reader-hub' }, 'new-article');
  global.customJS = prevCJS;
  ok('RCB-DISPATCH-1b new-article without paste → EntityCreate.create(instance:"reader-article")',
    calls.some(c => c.create === 'reader-article'));
}
// RCB-DEST
{
  const prevCJS = global.customJS;
  global.customJS = { ChromeBar: { openNavTarget: () => {} } };
  const article = cfg.destinations({}, { context: 'reader-article', path: 'spice/reader/Some Article.md' });
  const hub = cfg.destinations({}, { context: 'reader-hub', path: 'spice/reader/Reader.md' });
  global.customJS = prevCJS;
  ok('RCB-DEST-1 article destinations: This reader marker + Reader Hub link', article[0] && article[0].section === 'This reader' && article.some(e => e && e.label === 'Reader Hub'));
  ok('RCB-DEST-2 hub omits its own self-link', !hub.some(e => e && e._navTarget === 'spice/reader/Reader.md'));
}
console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
