#!/usr/bin/env node
/**
 * run-todo-phone-fit.js — the To-Do surfaces and the task dialog fit a phone.
 * A theme's phone button height must not inflate the pills, the filter row is
 * one sideways-scrolling line, week-strip cells stack day over date, the bulk
 * bar stays compact and clears the floating toolbar, and the task dialog clears
 * the status bar, stays inside the screen and stacks its footer into two rows.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
function loadClass(relPath, className) {
  return new Function(`${read(relPath)}\nreturn ${className};`)();
}
const block = (css, selector) => {
  const at = css.indexOf(selector + ' {');
  if (at < 0) return '';
  return css.slice(at, css.indexOf('}', at) + 1);
};

const core = read('mechanisms/styling/assets/snippets/sauce-core.css');
ok('PF-PILL on a phone the pill sets its own height, so a theme\'s tall phone button cannot inflate it',
  /height:\s*auto/.test(block(core, 'body.is-phone .sauce-pill-toggle.sauce-pill-toggle.sauce-pill-toggle'))
  && /min-height:\s*28px/.test(block(core, 'body.is-phone .sauce-pill-toggle.sauce-pill-toggle.sauce-pill-toggle')));
const controls = block(core, 'body.is-phone .sauce-todo-filter-controls');
ok('PF-CONTROLS on a phone the filter row stays one line and scrolls sideways',
  /flex-wrap:\s*nowrap/.test(controls) && /overflow-x:\s*auto/.test(controls)
  && /flex-wrap:\s*nowrap/.test(block(core, 'body.is-phone .sauce-todo-filter-right')));
ok('PF-STRIP-CSS on a phone both day strips stack the day name over the date',
  /body\.is-phone \.sauce-todo-week-label > span,\s*body\.is-phone \.sauce-done-day-cell-label > span \{\s*display: block;/.test(core));
ok('PF-BULK-BOTTOM on a phone the sticky bulk bar sits above the floating toolbar',
  /--sauce-bulk-bottom:\s*calc\(env\(safe-area-inset-bottom/.test(block(core, 'body.is-phone .sauce-todo-daily-filter-view')));

const View = loadClass('blueprints/to-do/helpers/todo-daily-filter-view.js', 'ToDoDailyFilterView');
ok('PF-BULK-CSS the bulk bar\'s buttons are compact on a phone',
  View.BULKBAR_CSS.includes('body.is-phone .sauce-todo-bulkbar button.sauce-todo-bulk-action { height: auto; min-height: 30px;'));
ok('PF-STRIP-ROW on a phone the week arrows and calendar button sit above the seven cells, each control 36px',
  View.STRIP_CSS.includes('body.is-phone .sauce-todo-strip-row { grid-template-columns: auto minmax(0, 1fr) auto auto; grid-template-areas: "prev title next tools" "cells cells cells cells";')
  && /\.sauce-todo-month-head button \{[^}]*min-width: 36px; min-height: 36px;/.test(View.STRIP_CSS));
ok('PF-MONTH the month grid is seven shrinking columns of days at least 36px tall',
  View.STRIP_CSS.includes('.sauce-todo-month-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr));')
  && /button\.sauce-todo-month-cell \{[^}]*min-height: 40px;/.test(View.STRIP_CSS));
const viewSrc = read('blueprints/to-do/helpers/todo-daily-filter-view.js');
ok('PF-BULK-HOST the bulk host reads its sticky offset from --sauce-bulk-bottom',
  viewSrc.includes('position:sticky; bottom:var(--sauce-bulk-bottom, 12px);'));

function makeEl(tag, cls) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), className: cls || '', children: [], parentNode: null,
    style: { cssText: '' }, attributes: {}, dataset: {}, _text: '', _listeners: {},
    createEl(t, o) { const c = makeEl(t, (o && o.cls) || ''); c.parentNode = this; if (o && o.text != null) c.textContent = o.text; this.children.push(c); return c; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; c.parentNode = this; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    addEventListener(t, fn) { this._listeners[t] = fn; },
    querySelector() { return null; },
    closest() { return null; },
    get firstChild() { return this.children[0] || null; },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
    set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; },
  };
  return el;
}
const all = (n) => (n.children || []).flatMap((c) => [c, ...all(c)]);
const byClass = (root, cls) => all(root).filter((n) => String(n.className).split(/\s+/).includes(cls));

(async () => {
  {
    const TE = new (loadClass('mechanisms/task-entity/task-entity.js', 'TaskEntity'))();
    const TTL = loadClass('mechanisms/task-entity/task-today-list.js', 'TaskTodayList');
    const today = '2026-11-09';
    const pages = [{ type: 'task', title: 'A', status: 'open', due: '2026-11-10', file: { path: 'spice/tasks/A.md' } }];
    global.window = {
      customJS: {
        TaskEntity: TE,
        TaskTodayList: Object.assign(Object.create(new TTL()), { renderTaskRow: (c) => c.createEl('div') }),
        RenderSafe: { page: () => ({ type: 'to-do', file: { name: 'ToDo-2026-11-09' } }) },
      },
      moment: () => ({ format: () => today }),
      localStorage: { getItem: () => null, setItem() {} },
      app: {},
    };
    const container = makeEl('div');
    const dv = { container, current: () => ({}), pages: () => { const a = pages.slice(); a.where = (fn) => { const b = a.filter(fn); b.where = a.where; b.array = () => b; return b; }; return a.where(() => true); } };
    await new View().render(dv);
    const labels = byClass(container, 'sauce-todo-week-label');
    ok('PF-STRIP every week-strip label is day name and date as two spans, reading "Mon 9" as one line on desktop',
      labels.length === 7 && labels.every((l) => l.children.length === 2)
      && labels[0].textContent === 'Mon 9' && labels[1].children[1].textContent === '10');
  }

  {
    const TD = loadClass('mechanisms/task-entity/task-dialog.js', 'TaskDialog');
    const css = TD._DIALOG_CSS;
    const phoneAt = css.indexOf('@media (max-width: 600px) {');
    const phone = phoneAt >= 0 ? css.slice(phoneAt) : '';
    ok('PF-DIALOG-SAFE-AREA on a phone the dialog clears the status bar and home indicator',
      /\.sauce-modal-backdrop:has\(> \.sauce-task-dialog\) \{ padding: calc\(env\(safe-area-inset-top, 0px\) \+ 8px\) 8px calc\(env\(safe-area-inset-bottom, 0px\) \+ 8px\);/.test(phone));
    ok('PF-DIALOG-WIDTH the stacked column cannot grow past the screen',
      /\.sauce-task-dialog-cols \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(css) && /min-width: 0;/.test(block(phone, '  .sauce-modal.sauce-task-dialog')));
    ok('PF-DIALOG-FOOTER on a phone the footer stacks into two rows of side-by-side buttons',
      phone.includes('.sauce-task-dialog > .sauce-modal-footer { flex-direction: column;')
      && phone.includes('.sauce-task-dialog > .sauce-modal-footer > .sauce-task-footer-left, .sauce-task-dialog > .sauce-modal-footer > .sauce-task-footer-right { flex: 0 0 auto;')
      && phone.includes('.sauce-task-footer-left > .sauce-btn, .sauce-task-footer-right > .sauce-btn { flex: 1 1 0;'));
    ok('PF-DIALOG-PILLS on a phone the dialog pills reset a theme\'s tall button height',
      /button\.sauce-task-pill, \.sauce-task-dialog button\.sauce-task-quiet \{ height: auto;/.test(phone));
    ok('PF-DIALOG-FOOTER-BOX the footer\'s padding sits inside its width, so the last button is never clipped',
      /\.sauce-task-dialog > \.sauce-modal-footer \{ box-sizing: border-box;/.test(css));
    const src = read('mechanisms/task-entity/task-dialog.js');
    ok('PF-DIALOG-HINT the shortcut hint no longer says the fields are "on the right" (they are below on a phone)',
      !src.includes('matching field on the right') && src.includes('Each fills its matching field.'));
  }

  const failed = results.filter(([, pass]) => !pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
