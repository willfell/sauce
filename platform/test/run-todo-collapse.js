#!/usr/bin/env node
/**
 * run-todo-collapse.js — a grouped to-do list folds each group away and back.
 * ToDoDailyFilterView.wireCollapsible gives a group section a rail button that
 * collapses and expands the group's rows, keeps the choice across repaints,
 * and labels itself for screen readers; animateCollapse animates when motion
 * is allowed and just shows or hides otherwise. sauce-core.css shows the rail
 * on hover and always on touch. Zero-dep; exit 0 iff all pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c, d) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}${c || d == null ? '' : ' — ' + d}`); };
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const View = new Function(`${read('blueprints/to-do/helpers/todo-daily-filter-view.js')}\nreturn ToDoDailyFilterView;`)();

function makeEl(tag, cls) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), className: cls || '', children: [], parentNode: null,
    style: { cssText: '' }, attributes: {}, _listeners: {}, scrollHeight: 120,
    createEl(t, o) {
      const c = makeEl(t, (o && o.cls) || '');
      c.parentNode = this; this.children.push(c); return c;
    },
    insertBefore(c, ref) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      const at = this.children.indexOf(ref);
      this.children.splice(at < 0 ? this.children.length : at, 0, c);
      return c;
    },
    get firstChild() { return this.children[0] || null; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    addEventListener(t, fn) { this._listeners[t] = fn; },
  };
  el.classList = {
    add: (c) => { if (!el.className.split(/\s+/).includes(c)) el.className = (el.className + ' ' + c).trim(); },
    remove: (c) => { el.className = el.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
    contains: (c) => el.className.split(/\s+/).includes(c),
  };
  return el;
}

const build = () => {
  const section = makeEl('div', 'sauce-todo-filter-project-group');
  section.createEl('div', { cls: 'sauce-todo-project-head' });
  const list = section.createEl('ul', { cls: 'sauce-todo-daily-filter-list' });
  list.style.display = 'flex';
  list.createEl('li'); list.createEl('li');
  return { section, list };
};

global.window = { matchMedia: () => ({ matches: true }) };
{
  const store = new Set();
  const { section, list } = build();
  const rail = View.wireCollapsible(section, list, 'daily|project|live|ERC', 'ERC', store);
  ok('TC-RAIL the rail is the section\'s first child, a button labelled for the group, expanded',
    section.children[0] === rail && rail.className === 'sauce-todo-group-rail' && rail.tagName === 'BUTTON'
    && rail.attributes['aria-expanded'] === 'true' && rail.attributes['aria-label'] === 'Collapse ERC');
  rail._listeners.click({ stopPropagation() {} });
  ok('TC-COLLAPSE a click hides the rows, marks the section collapsed and remembers it',
    list.style.display === 'none' && section.classList.contains('is-collapsed') && store.has('daily|project|live|ERC')
    && rail.attributes['aria-expanded'] === 'false' && rail.attributes['aria-label'] === 'Expand ERC');
  rail._listeners.click({ stopPropagation() {} });
  ok('TC-EXPAND a second click shows the rows with their own display and forgets it',
    list.style.display === 'flex' && !section.classList.contains('is-collapsed') && !store.has('daily|project|live|ERC'));

  store.add('daily|project|live|ERC');
  const again = build();
  View.wireCollapsible(again.section, again.list, 'daily|project|live|ERC', 'ERC', store);
  ok('TC-REPAINT a group collapsed before a repaint is drawn collapsed', again.list.style.display === 'none'
    && again.section.classList.contains('is-collapsed'));
  const other = build();
  View.wireCollapsible(other.section, other.list, 'daily|project|live|MCP', 'MCP', store);
  ok('TC-PER-GROUP other groups stay open', other.list.style.display === 'flex');
}

{
  global.window = { matchMedia: () => ({ matches: false }) };
  const anims = [];
  const { list } = build();
  list.animate = (k, o) => { const a = { k, o, cancel() { a.cancelled = true; } }; anims.push(a); return a; };
  for (const row of list.children) row.animate = (k, o) => { anims.push({ row: true, k, o }); return {}; };
  View.animateCollapse(list, true);
  const fold = anims[0];
  ok('TC-ANIM-FOLD folding animates height to 0 and fades, then hides',
    fold && fold.k[0].height === '120px' && fold.k[1].height === '0px' && fold.k[1].opacity === 0
    && list.style.display === 'flex' && (fold.onfinish(), list.style.display === 'none'));
  anims.length = 0;
  View.animateCollapse(list, false);
  ok('TC-ANIM-OPEN opening shows the list, grows it and staggers its rows',
    list.style.display === 'flex' && anims[0].k[1].height === '120px'
    && anims.filter((a) => a.row).length === 2 && anims.filter((a) => a.row)[1].o.delay > anims.filter((a) => a.row)[0].o.delay);
  const running = anims[0];
  View.animateCollapse(list, true);
  ok('TC-ANIM-CANCEL a toggle mid-animation cancels the running one', running.cancelled === true);
  global.window = { matchMedia: () => ({ matches: true }) };
  anims.length = 0;
  View.animateCollapse(list, false);
  ok('TC-ANIM-REDUCED under reduced motion nothing animates', anims.length === 0 && list.style.display === 'flex');
}

{
  const src = read('blueprints/to-do/helpers/todo-daily-filter-view.js');
  ok('TC-WIRED every group section in the list gets a rail', /View\.wireCollapsible\(section, list,/.test(src));
  const css = read('mechanisms/styling/assets/snippets/sauce-core.css');
  ok('TC-CSS the rail shows on hover, always on touch and mobile, and stays lit while collapsed',
    /\.sauce-todo-filter-project-group:hover > \.sauce-todo-group-rail \{ opacity: 1; \}/.test(css)
    && /@media \(hover: none\) \{\s*body \.sauce-todo-group-rail\.sauce-todo-group-rail \{ opacity: 1; \}/.test(css)
    && /body\.is-mobile \.sauce-todo-group-rail/.test(css)
    && /\.is-collapsed > \.sauce-todo-group-rail\.sauce-todo-group-rail::before/.test(css));
  ok('TC-CSS-MOTION the rail\'s transitions sit behind prefers-reduced-motion: no-preference',
    /@media \(prefers-reduced-motion: no-preference\) \{\s*body \.sauce-todo-group-rail/.test(css));
}

delete global.window;
const failed = results.filter(([, c]) => !c).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
