#!/usr/bin/env node
/**
 * run-todo-all-list.js — consistency-audit C3 regression guard for ToDoAllList.
 *
 * note-chrome: content section headers must use SectionLabel, never a bare
 * markdown/DOM heading. ToDoAllList used to render `dv.container.createEl('h2')`
 * per date group; it now calls customJS.SectionLabel.render(dv, {text}). This
 * harness drives render() with a Dataview-ish stub and asserts: (a) it emits a
 * SectionLabel per date group, (b) it creates ZERO <h2> elements, (c) today's
 * ToDo is excluded, (d) completed tasks are dropped, (e) empty backlog renders a
 * paragraph (no heading). Reverting the fix (h2 back) makes (b) red.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const SRC = path.resolve(__dirname, '..', 'blueprints', 'to-do', 'helpers', 'todo-all-list.js');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

// ---- Obsidian/Dataview-ish stubs ----
function makeEl(tag) {
  const el = {
    tag, textContent: '', children: [], _attrs: {},
    classList: { add() {} },
    createEl(t) { const c = makeEl(t); el.children.push(c); return c; },
    createSpan(o) { const c = makeEl('span'); if (o && o.text != null) c.textContent = o.text; el.children.push(c); return c; },
    setAttribute() {}, set onclick(_v) {}, closest() { return null; },
    get firstChild() { return el.children.length ? el.children[0] : null; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); },
  };
  return el;
}
const allEls = (root, out = []) => { for (const c of root.children) { out.push(c); allEls(c, out); } return out; };
const whereArr = (arr) => Object.assign(arr.slice(), { where(fn) { return whereArr(arr.filter(fn)); } });
const mkTasks = (list) => whereArr(list.map((t) => ({ text: t.text, completed: !!t.completed })));
const mkPage = (name, tasks) => ({ file: { name, tasks: mkTasks(tasks) } });

const sectionLabelCalls = [];
function runRender(pages) {
  sectionLabelCalls.length = 0;
  const container = makeEl('div');
  const paraCalls = [];
  const dv = {
    container,
    pages: (_q) => whereArr(pages),
    paragraph: (t) => paraCalls.push(t),
  };
  global.window = {
    moment: () => ({ format: () => '2026-07-01' }),
    customJS: { SectionLabel: { render: (dvArg, o) => { sectionLabelCalls.push(o && o.text); } } },
  };
  global.app = { workspace: { openLinkText() {} } };
  const src = fs.readFileSync(SRC, 'utf8');
  const Cls = new Function(`${src}\nreturn ToDoAllList;`)();
  // render is async but synchronous in this stub path
  const inst = new Cls();
  return Promise.resolve(inst.render(dv)).then(() => ({ container, paraCalls, sectionLabelCalls: sectionLabelCalls.slice() }));
}

(async () => {
  // Two prior dates + today (excluded). 06-30 has 1 incomplete + 1 complete; 06-29 has 1 incomplete.
  const pages = [
    mkPage('ToDo-2026-06-30', [{ text: 'alpha', completed: false }, { text: 'done-one', completed: true }]),
    mkPage('ToDo-2026-06-29', [{ text: 'beta', completed: false }]),
    mkPage('ToDo-2026-07-01', [{ text: 'today-task', completed: false }]), // == today -> excluded
    mkPage('NotAToDo', [{ text: 'x', completed: false }]),                  // name mismatch -> excluded
  ];
  const { container, sectionLabelCalls: labels } = await runRender(pages);
  const els = allEls(container);
  const h2s = els.filter((e) => e.tag === 'h2');

  ok('TAL-0 renders without throwing', true);
  ok('TAL-1 ZERO <h2> elements created (note-chrome)', h2s.length === 0);
  ok('TAL-2 SectionLabel emitted per date group (2), newest-first', labels.length === 2 && labels[0] === '2026-06-30' && labels[1] === '2026-06-29');
  ok('TAL-3 today ToDo excluded (no 2026-07-01 label)', !labels.includes('2026-07-01'));
  ok('TAL-4 completed tasks dropped (no "done-one" span)', !els.some((e) => e.textContent === 'done-one'));
  ok('TAL-5 incomplete tasks rendered ("alpha" + "beta" spans)', els.some((e) => e.textContent === 'alpha') && els.some((e) => e.textContent === 'beta'));

  // Empty backlog: only today + non-matching -> byDate empty -> paragraph, no label/h2.
  const empty = await runRender([mkPage('ToDo-2026-07-01', [{ text: 't', completed: false }])]);
  const eEls = allEls(empty.container);
  ok('TAL-6 empty backlog -> paragraph, no h2, no SectionLabel',
    empty.paraCalls.length === 1 && empty.sectionLabelCalls.length === 0 && !eEls.some((e) => e.tag === 'h2'));

  const allPass = results.every(([, p]) => p);
  console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
  process.exit(allPass ? 0 : 1);
})();
