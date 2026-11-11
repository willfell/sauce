#!/usr/bin/env node
/**
 * run-todo-project-head.js — projects get a quiet colour of their own, and a
 * grouped list opens each project with a plain heading.
 * TaskTodayList.projectHue/projectTint give one soft colour per project name,
 * shown as the dot on a row's project chip.
 * ToDoDailyFilterView.renderProjectHeader draws the name as a link, the count
 * and overdue, in the theme's own text. Rows show subtask progress as a small
 * meter. Zero-dep; exit 0 iff all pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const loadClass = (rel, name) => new Function(`${read(rel)}\nreturn ${name};`)();

function makeEl(tag, cls) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), className: cls || '', children: [], parentNode: null,
    style: { cssText: '' }, attributes: {}, dataset: {}, _text: '', _listeners: {},
    classList: { add() {}, contains: () => false },
    createEl(t, o) {
      const c = makeEl(t, (o && o.cls) || '');
      if (o && o.text != null) c.textContent = o.text;
      c.parentNode = this; this.children.push(c); return c;
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    addEventListener(t, fn) { this._listeners[t] = fn; },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
    set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; },
  };
  return el;
}
const all = (n) => (n.children || []).flatMap((c) => [c, ...all(c)]);
const one = (root, cls) => all(root).find((n) => String(n.className).split(/\s+/).includes(cls)) || null;

const TTL = loadClass('mechanisms/task-entity/task-today-list.js', 'TaskTodayList');
const View = loadClass('blueprints/to-do/helpers/todo-daily-filter-view.js', 'ToDoDailyFilterView');

const hue = TTL.projectHue('Content-Registry');
ok('PH-HUE a project keeps one hue whatever its case, on one of 24 evenly spaced steps',
  hue === TTL.projectHue('content-registry') && hue % 15 === 0 && hue >= 0 && hue < 360);
ok('PH-HUE-NONE no project, or "No project", has no hue', TTL.projectHue('') === null && TTL.projectHue('No project') === null && TTL.projectHue(null) === null);
ok('PH-HUE-SPREAD different projects mostly get different hues',
  new Set(['Content-Registry', 'ERC', 'MCP Mesh', 'Decomposition', 'Hemi', 'CDC'].map((n) => TTL.projectHue(n))).size >= 5);
{
  const hues = Array.from({ length: 400 }, (_, i) => TTL.projectHue('project-' + i + '-x'));
  ok('PH-HUE-RANGE every hue is a whole step from 0 to 345, and all 24 steps get used',
    hues.every((h) => Number.isInteger(h) && h >= 0 && h <= 345 && h % 15 === 0) && new Set(hues).size === 24);
}
const tint = TTL.projectTint('ERC');
ok('PH-TINT the tint is a soft, low-saturation pastel mixed into the theme\'s muted text, faint for backgrounds',
  tint.base === 'hsl(' + TTL.projectHue('ERC') + ' 30% 62%)'
  && /^color-mix\(in srgb, hsl\([^)]*\) 70%, var\(--text-muted/.test(tint.dot)
  && /^color-mix\(in srgb, hsl\([^)]*\) 45%, var\(--text-muted/.test(tint.fg)
  && /12%, transparent\)$/.test(tint.bg) && TTL.projectTint('') === null);

{
  const host = makeEl('div');
  const opened = [];
  global.window = { app: { workspace: { openLinkText: (n) => opened.push(n) } } };
  const TE = { bucketOf: (t) => t.bucket };
  const head = View.renderProjectHeader(host, { label: 'Content-Registry', tasks: [{ bucket: 'overdue' }, { bucket: 'today' }, { bucket: 'overdue' }] }, { TTL, TE, todayStr: '2026-11-10', first: true });
  ok('PH-HEAD the heading is the name, the count and overdue, with no badge and no colour of its own',
    head.className === 'sauce-todo-project-head is-first'
    && head.style.cssText === '' && !one(head, 'sauce-todo-project-badge')
    && head.children.map((c) => c.className).join() === 'sauce-todo-project-name,sauce-todo-project-count,sauce-todo-project-late'
    && one(head, 'sauce-todo-project-name').textContent === 'Content-Registry'
    && one(head, 'sauce-todo-project-count').textContent === '3'
    && one(head, 'sauce-todo-project-late').textContent === '2 overdue');
  one(head, 'sauce-todo-project-name')._listeners.click({ preventDefault() {} });
  ok('PH-HEAD-LINK the name opens the project note', one(head, 'sauce-todo-project-name').tagName === 'A' && opened[0] === 'Content-Registry');
  const none = View.renderProjectHeader(makeEl('div'), { label: 'No project', tasks: [{ bucket: 'today' }] }, { TTL, TE, todayStr: '2026-11-10' });
  ok('PH-HEAD-NONE "No project" is plain text, not a link, with no overdue line when none are late',
    none.className === 'sauce-todo-project-head is-none' && none.style.cssText === ''
    && one(none, 'sauce-todo-project-name').tagName === 'SPAN' && !one(none, 'sauce-todo-project-late'));
}

const viewSrc = read('blueprints/to-do/helpers/todo-daily-filter-view.js');
ok('PH-WIRED grouping by project draws the project heading; other groupings keep the plain label',
  /if \(prefs\.group === 'project'\) View\.renderProjectHeader\(section, group, \{ first, todayStr, TE, TTL \}\);\s*else label\(section, group\.label, first\);/.test(viewSrc));

{
  const row = makeEl('div');
  const chip = TTL.renderSubtaskMeter(row, { done: 3, total: 3 });
  ok('PH-METER the subtask meter fills to the share done and turns green when all are done',
    chip.className === 'sauce-task-today-subtask-chip is-complete' && /width: 100%/.test(one(chip, 'sauce-task-subtask-fill').style.cssText)
    && chip.textContent === '3/3' && chip.attributes.title === '3 of 3 subtasks done');
  ok('PH-METER-NONE no subtasks, no meter', TTL.renderSubtaskMeter(makeEl('div'), { done: 0, total: 0 }) === null);
}

{
  const container = makeEl('div');
  container.querySelector = () => null;
  global.window = { customJS: {}, moment: () => ({ format: () => '2026-11-10' }) };
  const row = TTL.renderTaskRow(container, { title: 'Ship it', path: 'spice/tasks/Ship it.md', project: '[[ERC]]', status: 'open' }, null, { todayStr: '2026-11-10' });
  const chip = one(row, 'sauce-task-project');
  ok('PH-ROW-CHIP a row\'s project chip stays neutral grey with a small dot in its project colour',
    chip && chip.style.cssText.includes('background: var(--background-modifier-border);')
    && chip.style.cssText.includes('background-image: radial-gradient(circle at 7px 50%, ' + TTL.projectTint('ERC').dot + ' 2.6px, transparent 3.2px);')
    && !chip.style.cssText.includes('color: ' + TTL.projectTint('ERC').fg));
}

const core = read('mechanisms/styling/assets/snippets/sauce-core.css');
{
  const block = (sel) => { const at = core.indexOf(sel + ' {'); return at < 0 ? '' : core.slice(at, core.indexOf('}', at) + 1); };
  ok('PH-CSS the heading is the theme\'s own text: no badge styles, no project colour, no band, gradient or glow',
    !core.includes('.sauce-todo-project-badge') && !core.includes('--sauce-proj')
    && /color: var\(--text-normal\)/.test(block('.sauce-todo-project-name'))
    && !/gradient|box-shadow/.test(block('.sauce-todo-project-head')));
}

const failed = results.filter(([, pass]) => !pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
