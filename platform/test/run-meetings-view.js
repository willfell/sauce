#!/usr/bin/env node
/**
 * run-meetings-view.js — the meetings pages drawn in the To-Do grammar.
 * Drives the real FilterBar (section-label mechanism) and the real
 * MeetingsBrowseList against a fake DOM: search, day strip, range tabs with
 * counts, Person / Project menus, the Open tasks toggle, the caption, day and
 * month sections, the meeting row, per-surface prefs, in-memory state that
 * survives a re-render, the project and one-day surfaces, cold-load
 * fallbacks, the phone rules, and the install heal that drops the hub's
 * duplicate "Meetings" label.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const loadSrc = (src, className) => new Function(`${src}\nreturn ${className};`)();
const loadClass = (rel, className) => loadSrc(read(rel), className);

const FB_SRC = read('mechanisms/section-label/filter-bar.js');
const MBL_SRC = read('blueprints/meetings/helpers/meetings-browse-list.js');
const FilterBar = loadSrc(FB_SRC, 'FilterBar');
const MeetingsBrowseList = loadSrc(MBL_SRC, 'MeetingsBrowseList');
const ProjectMeetingsList = loadClass('blueprints/project/helpers/project-meetings-list.js', 'ProjectMeetingsList');
const MeetingsHubCards = loadClass('blueprints/meetings/helpers/meetings-hub-cards.js', 'MeetingsHubCards');
const MeetingLeafActions = loadClass('blueprints/meetings/helpers/meeting-leaf-actions.js', 'MeetingLeafActions');

function makeEl(tag, cls) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), className: cls || '', children: [], parentNode: null,
    style: { cssText: '' }, attributes: {}, dataset: {}, _text: '', _listeners: {}, value: '',
    createEl(t, o) {
      const c = makeEl(t, (o && o.cls) || '');
      c.parentNode = this;
      if (o && o.text != null) c.textContent = o.text;
      if (o && o.type) c.type = o.type;
      this.children.push(c);
      return c;
    },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
    insertBefore(c, ref) {
      const at = this.children.indexOf(c);
      if (at >= 0) this.children.splice(at, 1);
      const i = ref ? this.children.indexOf(ref) : -1;
      c.parentNode = this;
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    async fire(t, e) {
      const ev = { preventDefault() {}, stopPropagation() {}, target: this, ...(e || {}) };
      let out;
      for (const fn of this._listeners[t] || []) out = await fn(ev);
      return out;
    },
    querySelector() { return null; },
    closest() { return null; },
    get firstChild() { return this.children[0] || null; },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
    set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; },
  };
  return el;
}
const all = (n) => (n.children || []).flatMap((c) => [c, ...all(c)]);
const has = (n, cls) => String(n.className).split(/\s+/).includes(cls);
const byClass = (root, cls) => all(root).filter((n) => has(n, cls));
const one = (root, cls) => byClass(root, cls)[0];
const pillTexts = (root) => one(root, 'sauce-filter-pills').children.map((b) => b.textContent);
const rowTitles = (root) => byClass(root, 'sauce-meeting-title').map((n) => n.textContent);
const sectionTexts = (root) => byClass(root, 'sauce-meetings-section').map((n) => n.textContent);

const TODAY = '2026-11-10';
const mtg = (name, fields) => ({
  type: 'meeting',
  file: { name, path: `spice/meetings/notes/2026/11-November/${name}.md` },
  ...fields,
});
const BASE_MEETINGS = () => [
  mtg('Standup-2026-11-10', { date: '2026-11-10T09:00:00-06:00', attendees: ['[[Ada Lovelace|Ada]]', '[[Bob]]'], project: '[[Atlas]]', summary: 'Daily sync' }),
  mtg('Review-2026-11-10', { date: '2026-11-10 14:30', attendees: ['[[Ada Lovelace|Ada]]'] }),
  mtg('Planning-2026-11-12', { date: { toISODate: () => '2026-11-12', hour: 10, minute: 0 }, project: { path: 'spice/projects/atlas/Atlas.md', display: 'Atlas' } }),
  mtg('Retro-2026-11-06', { date: '2026-11-06T16:00', attendees: ['[[Cy]]'] }),
  mtg('Kickoff-2026-10-01', { date: '2026-10-01', project: '[[Beacon]]' }),
  mtg('Loose notes', {}),
];
const TASKS = [
  { type: 'task', status: 'open', source: 'meeting', source_note: '[[Retro-2026-11-06]]', file: { path: 'spice/tasks/t1.md' } },
];

function chain(items) {
  const a = items.slice();
  a.where = (fn) => chain(a.filter(fn));
  a.sort = () => chain(a);
  a.array = () => a.slice();
  return a;
}

function env(opts) {
  const o = opts || {};
  const store = o.store || new Map();
  const menus = [];
  const opened = [];
  const slCalls = [];
  const meetings = o.meetings || BASE_MEETINGS();
  const customJS = {
    RenderSafe: { page: () => (o.page || { file: { name: 'Meetings', path: 'spice/meetings/Meetings.md' }, tags: ['meetings-hub'] }) },
    SectionLabel: { render: (dv, args) => { slCalls.push(args); dv.container.createEl('div', { text: args.text }); } },
    MenuPopover: { open: (entries, mopts) => { menus.push({ entries, anchor: mopts && mopts.anchor }); return {}; } },
  };
  if (o.filterBar !== false) customJS.FilterBar = new FilterBar();
  if (o.leaf) customJS.MeetingLeafActions = o.leaf;
  customJS.MeetingsBrowseList = new MeetingsBrowseList();
  global.window = {
    customJS,
    moment: () => ({ format: () => TODAY }),
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    app: { workspace: { openLinkText: (p, src, how) => opened.push([p, how]) } },
  };
  global.customJS = customJS;
  const container = makeEl('div');
  const dv = {
    container,
    current: () => ({}),
    pages: (q) => {
      if (o.pagesThrow) throw new Error('not indexed');
      if (q === '"spice/meetings/notes"') return chain(meetings);
      if (q === '"spice/tasks"') return chain(TASKS);
      return chain([]);
    },
  };
  return { dv, container, store, menus, opened, slCalls, customJS };
}

(async () => {
  // ── FilterBar: pure date helpers ──────────────────────────────────────────
  {
    const r = (p) => JSON.stringify(FilterBar.rangeFor(p, TODAY));
    ok('FB-RANGE week runs Monday to Sunday, last week before it, month to its last day',
      r('today') === '{"from":"2026-11-10","to":"2026-11-10"}'
      && r('week') === '{"from":"2026-11-09","to":"2026-11-15"}'
      && r('last-week') === '{"from":"2026-11-02","to":"2026-11-08"}'
      && r('month') === '{"from":"2026-11-01","to":"2026-11-30"}'
      && FilterBar.rangeFor('nope', TODAY) === null && FilterBar.rangeFor('week', 'garbage') === null);
    ok('FB-LABELS day "Tue Nov 10", month "November 2026", undated fallback, range words',
      FilterBar.dayLabel(TODAY) === 'Tue Nov 10' && FilterBar.monthLabel('2026-11') === 'November 2026'
      && FilterBar.monthLabel('') === 'Undated' && FilterBar.rangeLabel('week', FilterBar.rangeFor('week', TODAY)) === 'this week'
      && FilterBar.rangeLabel('month', FilterBar.rangeFor('month', TODAY)) === 'in November');
    const cells = FilterBar.dayCells({ '2026-11-10': 2 }, '2026-11-09', '2026-11-15', TODAY);
    ok('FB-CELLS one cell per day with its count and today marked; none for one day or over six weeks',
      cells.lead === 0 && cells.cells.length === 7 && cells.cells[1].count === 2 && cells.cells[1].isToday
      && cells.cells[1].label === 'Tue 10' && cells.cells[0].count === 0
      && FilterBar.dayCells({}, TODAY, TODAY, TODAY) === null
      && FilterBar.dayCells({}, '2026-01-01', '2026-03-01', TODAY) === null
      && FilterBar.dayCells({}, '2026-11-01', '2026-11-30', TODAY).lead === 6);
  }

  // ── FilterBar: markup primitives ──────────────────────────────────────────
  {
    global.window = { customJS: {} };
    const host = makeEl('div');
    const hosts = FilterBar.layout(host, { search: true, strip: true, caption: true });
    const order = hosts.root.children.map((c) => c.tagName === 'STYLE' ? 'style' : String(c.className).split(' ')[0]);
    ok('FB-LAYOUT search, strip, controls, caption, rule, list in the To-Do order and classes',
      order.join('|') === 'style|sauce-todo-search|sauce-filter-strip-host|sauce-todo-filter-controls|sauce-todo-caption|sauce-todo-filter-rule|sauce-filter-list'
      && has(hosts.pills, 'sauce-pill-group') && has(hosts.right, 'sauce-todo-filter-right'));
    let typed = '';
    const input = FilterBar.search(hosts.search, { placeholder: 'Search meetings…', onInput: (t) => { typed = t; } });
    input.value = 'ada';
    await input.fire('input');
    ok('FB-SEARCH same markup as the To-Do search (icon + input.sauce-todo-search-input) and reports text',
      has(hosts.search.children[0], 'sauce-todo-search-icon') && has(input, 'sauce-todo-search-input')
      && input.type === 'search' && input.attributes.placeholder === 'Search meetings…' && typed === 'ada');
    const tab = FilterBar.pill(hosts.pills, { text: 'Today', active: true, role: 'tab' });
    FilterBar.dayPill(hosts.pills, { label: 'Tue Nov 10', onExit: () => {} });
    ok('FB-PILL tabs are sauce-pill-toggle with is-active and aria-selected; the day pill leads the group',
      has(tab, 'sauce-pill-toggle') && has(tab, 'is-active') && tab.attributes['aria-selected'] === 'true'
      && has(hosts.pills.children[0], 'sauce-filter-day-pill') && hosts.pills.children[0].textContent === 'Tue Nov 10×');
    const picked = [];
    FilterBar.strip(hosts.strip, { strip: FilterBar.dayCells({ '2026-11-10': 2 }, '2026-11-09', '2026-11-15', TODAY), selected: TODAY, onPick: (d) => picked.push(d) });
    const cellsEl = byClass(hosts.strip, 'sauce-filter-day-cell');
    await cellsEl[1].fire('click');
    await cellsEl[2].fire('click');
    ok('FB-STRIP seven cells, the shown day pressed, clicking it again leaves the day, another picks it',
      cellsEl.length === 7 && cellsEl[1].attributes['aria-pressed'] === 'true' && has(cellsEl[1], 'is-today')
      && picked.join(',') === ',2026-11-11');
    const seen = [];
    FilterBar.menu(tab, { entries: [{ label: 'Ada', value: 'Ada', sublabel: '2 meetings' }], current: 'Ada', allLabel: 'Everyone',
      MenuPopover: { open: (e) => seen.push(e) }, onPick: (v) => seen.push(v) });
    seen[0][0].onSelect();
    ok('FB-MENU the All entry first, a ✓ on the current entry, sublabels kept, a pick reports its value',
      seen[0][0].label === 'Everyone' && !seen[0][0].icon && seen[0][1].icon === '✓' && seen[0][1].sublabel === '2 meetings' && seen[1] === '');
    const cycled = [];
    FilterBar.menu(tab, { entries: [{ label: 'A', value: 'A' }, { label: 'B', value: 'B' }], current: 'A', onPick: (v) => cycled.push(v) });
    ok('FB-MENU-COLD without MenuPopover a click cycles to the next value', cycled[0] === 'B');
    const calls = [];
    const SL = { render: (dv, a) => { calls.push(a); } };
    const list = makeEl('div');
    FilterBar.section(null, list, 'One', { SectionLabel: SL });
    FilterBar.section(null, list, 'Two', { SectionLabel: SL });
    ok('FB-SECTION the first section under the rule passes top:true, later ones keep their hairline',
      calls[0].top === true && calls[1].top === undefined);
    const core = read('mechanisms/styling/assets/snippets/sauce-core.css');
    const block = (sel) => { const at = core.indexOf(sel + ' {'); return at < 0 ? '' : core.slice(at, core.indexOf('}', at)); };
    ok('FB-PHONE on a phone pills are 28px tall and the row is one sideways-scrolling line (sauce-core rules on the classes FilterBar emits); strip cells stack day over date',
      /min-height:\s*28px/.test(block('body.is-phone .sauce-pill-toggle.sauce-pill-toggle.sauce-pill-toggle'))
      && /overflow-x:\s*auto/.test(block('body.is-phone .sauce-todo-filter-controls'))
      && has(hosts.controls, 'sauce-todo-filter-controls') && has(tab, 'sauce-pill-toggle')
      && FilterBar.PHONE_CSS.includes('body.is-phone .sauce-filter-bar .sauce-filter-day-cell-label > span { display: block; }')
      && hosts.root.children[0].textContent.includes(FilterBar.PHONE_CSS));
    const inst = new FilterBar();
    const statics = Object.getOwnPropertyNames(FilterBar).filter((k) => typeof FilterBar[k] === 'function' && !k.startsWith('_'));
    ok('FB-INSTANCE every public static has an instance delegate (customJS stores an instance)',
      statics.every((k) => typeof inst[k] === 'function'));
  }

  // ── MeetingsBrowseList: pure ──────────────────────────────────────────────
  {
    const [standup, review, planning, , , loose] = BASE_MEETINGS();
    ok('MV-DAY a meeting\'s day from its date string, a Dataview DateTime, else its filename',
      MeetingsBrowseList.meetingDay(standup) === '2026-11-10' && MeetingsBrowseList.meetingDay(planning) === '2026-11-12'
      && MeetingsBrowseList.meetingDay(mtg('X-2026-01-02', {})) === '2026-01-02' && MeetingsBrowseList.meetingDay(loose) === null);
    ok('MV-TIME 9:00 AM / 2:30 PM / 10:00 AM from ISO, "date time" and DateTime; none for a bare date',
      MeetingsBrowseList.timeLabel(MeetingsBrowseList.meetingClock(standup)) === '9:00 AM'
      && MeetingsBrowseList.timeLabel(MeetingsBrowseList.meetingClock(review)) === '2:30 PM'
      && MeetingsBrowseList.timeLabel(MeetingsBrowseList.meetingClock(planning)) === '10:00 AM'
      && MeetingsBrowseList.meetingClock(mtg('K', { date: '2026-10-01' })) === '');
    ok('MV-TITLE the filename without its date; project from a link string or a Link object',
      MeetingsBrowseList.meetingTitle(standup) === 'Standup' && MeetingsBrowseList.meetingTitle(loose) === 'Loose notes'
      && MeetingsBrowseList.projectName(standup) === 'Atlas' && MeetingsBrowseList.projectName(planning) === 'Atlas'
      && MeetingsBrowseList.projectName(mtg('n', { project: '(none)' })) === '');
    const models = BASE_MEETINGS().map((p) => MeetingsBrowseList.toModel(p, {}));
    global.window = { customJS: { FilterBar: new FilterBar() } };
    ok('MV-SEARCH every word, across title, attendees, project and summary',
      MeetingsBrowseList.searchMeetings(models, 'ada sync').map((m) => m.title).join() === 'Standup'
      && MeetingsBrowseList.searchMeetings(models, 'atlas').length === 2
      && MeetingsBrowseList.searchMeetings(models, '').length === 6);
    const g = Array.from(MeetingsBrowseList.groupByDay(models).entries()).map(([d, l]) => d + ':' + l.map((m) => m.title).join('/'));
    ok('MV-GROUP days newest first, earliest meeting first inside a day, undated last',
      g.join('|') === '2026-11-12:Planning|2026-11-10:Standup/Review|2026-11-06:Retro|2026-10-01:Kickoff|:Loose notes');
  }

  // ── Browse surface through the real view ─────────────────────────────────
  {
    const e = env();
    await new MeetingsBrowseList().render(e.dv);
    const c = e.container;
    ok('MV-PILLS Today / This week / Last week / This month / All with counts; This week by default',
      pillTexts(c).join('|') === 'Today · 2|This week · 3|Last week · 1|This month · 4|All · 6'
      && one(c, 'sauce-filter-pills').children[1].attributes['aria-selected'] === 'true');
    ok('MV-SEARCH-FIELD search sits on top, with the To-Do classes',
      one(c, 'sauce-filter-bar').children[1] === one(c, 'sauce-todo-search') && !!one(c, 'sauce-todo-search-input'));
    const cells = byClass(c, 'sauce-filter-day-cell');
    ok('MV-STRIP this week as seven day cells with meeting counts; today marked',
      cells.length === 7 && cells.map((b) => byClass(b, 'sauce-filter-day-cell-count')[0].textContent).join('') === '0201000'
      && has(cells[1], 'is-today'));
    ok('MV-RIGHT Person ▾, Project ▾ and Open tasks on the right, none lit at rest',
      one(c, 'sauce-filter-right').children.map((b) => b.textContent).join('|') === 'Person ▾|Project ▾|Open tasks'
      && one(c, 'sauce-filter-right').children.every((b) => !has(b, 'is-active')));
    ok('MV-CAPTION "3 meetings this week, across 1 project"',
      one(c, 'sauce-filter-caption').textContent === '3 meetings this week, across 1 project');
    ok('MV-SECTIONS day sections, newest first, each with its count; the first skips its hairline',
      sectionTexts(c).join('|') === 'Thu Nov 12 · 1|Tue Nov 10 · 2' && e.slCalls[0].top === true && e.slCalls[1].top === undefined);
    ok('MV-ROWS rows in day order, earliest first within a day', rowTitles(c).join('|') === 'Planning|Standup|Review');
    const row = byClass(c, 'sauce-meeting-row')[1];
    const slot = (k) => one(row, 'is-' + k);
    ok('MV-ROW time | title + summary | project, people, open-task slots | ⋯',
      one(row, 'sauce-meeting-time').textContent === '9:00 AM' && one(row, 'sauce-meeting-title').textContent === 'Standup'
      && one(row, 'sauce-meeting-summary').textContent === 'Daily sync'
      && slot('project').textContent === 'Atlas' && slot('people').textContent === 'Ada +1' && one(slot('people'), 'sauce-meeting-chip').attributes.title === 'Ada, Bob' && slot('tasks').textContent === ''
      && one(row, 'sauce-meeting-chips').children.length === 3 && one(row, 'sauce-meeting-more').textContent === '⋯');
    await row.fire('click');
    await row.fire('click', { metaKey: true });
    ok('MV-OPEN clicking a row opens its note; Cmd-click opens it in a new tab',
      e.opened[0][0] === row.dataset.path && e.opened[0][1] === false && e.opened[1][1] === 'tab');

    await cells[1].fire('click');
    ok('MV-DAY-FOCUS a strip day shows only that day, led by an active "Tue Nov 10 ×" pill',
      rowTitles(c).join('|') === 'Standup|Review' && has(one(c, 'sauce-filter-pills').children[0], 'sauce-filter-day-pill')
      && one(c, 'sauce-filter-pills').children[0].textContent === 'Tue Nov 10×'
      && !one(c, 'sauce-filter-pills').children.some((b) => has(b, 'sauce-meetings-tab') && has(b, 'is-active')));
    await byClass(c, 'sauce-filter-day-cell')[2].fire('click');
    ok('MV-DAY-EMPTY an empty day says so', one(c, 'sauce-meetings-empty').textContent === 'Nothing on Wed Nov 11.' && rowTitles(c).length === 0);
    await one(c, 'sauce-filter-day-pill').fire('click');
    ok('MV-DAY-EXIT the day pill goes back to the whole week', rowTitles(c).length === 3 && !one(c, 'sauce-filter-day-pill'));

    // Search repaints follow the last keystroke after a short pause, so a burst
    // of typing costs one rebuild of the list, not one per character.
    const searchSettled = () => new Promise((resolve) => setTimeout(resolve, 180));
    const input = one(c, 'sauce-todo-search-input');
    input.value = 'b';
    await input.fire('input');
    input.value = 'bob';
    await input.fire('input');
    ok('MV-SEARCH-COALESCE typing does not repaint per keystroke', rowTitles(c).length === 3);
    await searchSettled();
    ok('MV-SEARCH-LIST search narrows the list and the tab counts',
      rowTitles(c).join() === 'Standup' && pillTexts(c)[1] === 'This week · 1' && pillTexts(c)[3] === 'This month · 1'
      && one(c, 'sauce-filter-caption').textContent === '3 meetings this week, across 1 project · showing 1');
    input.value = 'zzz';
    await input.fire('input');
    await searchSettled();
    ok('MV-SEARCH-EMPTY a search with no hits says "No meetings match."', one(c, 'sauce-meetings-empty').textContent === 'No meetings match.');
    input.value = '';
    await input.fire('input');
    await searchSettled();

    await one(c, 'sauce-meetings-person-filter').fire('click');
    const menu = e.menus[e.menus.length - 1].entries;
    ok('MV-PERSON-MENU Everyone, then people with "N meetings", most first',
      menu.map((m) => m.label + (m.sublabel ? '/' + m.sublabel : '')).join('|') === 'Everyone|Ada/2 meetings|Bob/1 meeting');
    menu[1].onSelect();
    ok('MV-PERSON-PICK picking a person narrows the list and lights the pill with their name',
      rowTitles(c).join('|') === 'Standup|Review' && one(c, 'sauce-meetings-person-filter').textContent === 'Person: Ada ▾'
      && has(one(c, 'sauce-meetings-person-filter'), 'is-active'));
    await one(c, 'sauce-meetings-person-filter').fire('click');
    e.menus[e.menus.length - 1].entries[0].onSelect();
    await one(c, 'sauce-meetings-project-filter').fire('click');
    const pm = e.menus[e.menus.length - 1].entries;
    ok('MV-PROJECT-MENU projects with counts, "No project" last',
      pm.map((m) => m.label + '/' + (m.sublabel || '')).join('|') === 'All projects/|Atlas/2 meetings|No project/1 meeting');
    pm[2].onSelect();
    ok('MV-PROJECT-PICK "No project" keeps the unaffiliated meetings', rowTitles(c).join() === 'Review');
    await one(c, 'sauce-meetings-project-filter').fire('click');
    e.menus[e.menus.length - 1].entries[0].onSelect();

    await one(c, 'sauce-meetings-open-filter').fire('click');
    ok('MV-OPEN-TOGGLE Open tasks keeps only meetings with open tasks (none this week)',
      has(one(c, 'sauce-meetings-open-filter'), 'is-active') && one(c, 'sauce-meetings-empty').textContent === 'No meetings match.'
      && pillTexts(c)[2] === 'Last week · 1');
    await one(c, 'sauce-filter-pills').children[2].fire('click');
    ok('MV-OPEN-CHIP last week: Retro, with its "1 open" chip',
      rowTitles(c).join() === 'Retro' && one(c, 'is-open').textContent === '1 open');
    await one(c, 'sauce-meetings-open-filter').fire('click');

    await one(c, 'sauce-filter-pills').children[4].fire('click');
    ok('MV-PREFS a tab persists under sauce-meetings:prefs:browse',
      JSON.parse(e.store.get('sauce-meetings:prefs:browse')).tab === 'all');
    ok('MV-ALL All groups by month, undated last, dates each row by its day, and hides the strip',
      sectionTexts(c).join('|') === 'November 2026 · 4|October 2026 · 1|Undated · 1' && !byClass(c, 'sauce-filter-day-cell').length
      && byClass(c, 'sauce-meeting-time').map((n) => n.textContent).join('|') === 'Thu 12|Tue 10|Tue 10|Fri 6|Thu 1|'
      && one(c, 'sauce-filter-caption').textContent === '6 meetings, across 2 projects');

    const searchBox = one(c, 'sauce-todo-search-input');
    searchBox.value = 'kick';
    await searchBox.fire('input');
    const again = env({ store: e.store });
    await new MeetingsBrowseList().render(again.dv);
    await new MeetingsBrowseList().render(again.dv);
    ok('MV-STATE a re-render keeps the tab, the search text and its results',
      one(again.container, 'sauce-todo-search-input').value === 'kick' && rowTitles(again.container).join() === 'Kickoff'
      && pillTexts(again.container)[4] === 'All · 1');
    ok('MV-RERENDER two renders on one container leave one view, not two',
      byClass(again.container, 'sauce-filter-bar').length === 1);
    MeetingsBrowseList.__states = new Map();
  }

  // ── Empty copy ────────────────────────────────────────────────────────────
  {
    const e = env({ meetings: [] });
    await new MeetingsBrowseList().render(e.dv);
    ok('MV-BLANK no meetings at all: "No meetings yet. Use + New Meeting above."',
      one(e.container, 'sauce-meetings-empty').textContent === 'No meetings yet. Use + New Meeting above.');
    const f = env({ meetings: [mtg('Old-2025-01-01', { date: '2025-01-01' })] });
    await new MeetingsBrowseList().render(f.dv);
    await one(f.container, 'sauce-filter-pills').children[0].fire('click');
    ok('MV-EMPTY-TAB an empty tab names its range', one(f.container, 'sauce-meetings-empty').textContent === 'No meetings today.');
    MeetingsBrowseList.__states = new Map();
  }

  // ── Row ⋯ menu ────────────────────────────────────────────────────────────
  {
    const calls = [];
    const leaf = { _onAddToProject: (dv, p) => calls.push(['project', p.file.name]), _onEditAttendees: (dv, p) => calls.push(['people', p.file.name]) };
    const e = env({ leaf });
    await new MeetingsBrowseList().render(e.dv);
    await one(e.container, 'sauce-meeting-more').fire('click');
    const m = e.menus[e.menus.length - 1].entries;
    ok('MV-ROW-MENU ⋯ offers Open / new tab / to the right, then this meeting\'s project and attendees',
      m.map((x) => x.label || x.section).join('|') === 'Open|Open in new tab|Open to the right|This meeting|Change project…|Edit attendees…'
      && e.opened.length === 0);
    m[2].onSelect();
    m[4].onSelect();
    m[5].onSelect();
    ok('MV-ROW-MENU-ACTS the entries open to the right and edit that meeting, not the page it is listed on',
      e.opened[0][1] === 'split' && calls.join('|') === 'project,Planning-2026-11-12|people,Planning-2026-11-12');
    MeetingsBrowseList.__states = new Map();
  }

  // ── Project surface ───────────────────────────────────────────────────────
  {
    const e = env({ page: { type: 'project-meetings', project: '[[Atlas]]', project_name: 'Atlas', file: { name: 'Meetings', path: 'spice/projects/atlas/Meetings.md' } } });
    await new ProjectMeetingsList().render(e.dv);
    ok('MV-PROJECT the project\'s Meetings page lists only its meetings, on All by default',
      rowTitles(e.container).join('|') === 'Planning|Standup' && has(one(e.container, 'sauce-filter-pills').children[4], 'is-active'));
    ok('MV-PROJECT-RIGHT no Project menu or project chip on a project\'s own page',
      one(e.container, 'sauce-filter-right').children.map((b) => b.textContent).join('|') === 'Person ▾|Open tasks'
      && !byClass(e.container, 'sauce-meeting-project').length && !byClass(e.container, 'sauce-meeting-slot').some((n) => has(n, 'is-project')) && one(e.container, 'sauce-filter-caption').textContent === '2 meetings');
    await one(e.container, 'sauce-filter-pills').children[0].fire('click');
    ok('MV-PROJECT-PREFS its tab persists under its own key, never the browse page\'s',
      JSON.parse(e.store.get('sauce-meetings:prefs:project')).tab === 'today' && !e.store.has('sauce-meetings:prefs:browse'));
    const none = env({ page: { type: 'project-meetings', project: '[[Nothing]]', file: { name: 'Meetings', path: 'spice/projects/x/Meetings.md' } } });
    await new ProjectMeetingsList().render(none.dv);
    ok('MV-PROJECT-BLANK a project with no meetings says "No meetings yet."', one(none.container, 'sauce-meetings-empty').textContent === 'No meetings yet.');
    MeetingsBrowseList.__states = new Map();
  }

  // ── One-day hub ───────────────────────────────────────────────────────────
  {
    const e = env({ page: { tags: ['meetings-hub'], file: { name: 'Meetings-2026-11-10', path: 'spice/meetings/hubs/x.md' } } });
    await new MeetingsHubCards().render(e.dv);
    ok('MV-DAYHUB a one-day hub draws that day\'s rows in time order with no tabs, strip or caption',
      rowTitles(e.container).join('|') === 'Standup|Review' && !one(e.container, 'sauce-filter-pills')
      && !byClass(e.container, 'sauce-filter-day-cell').length && !one(e.container, 'sauce-filter-caption'));
    const q = env({ page: { tags: ['meetings-hub'], file: { name: 'Meetings-2026-11-11', path: 'spice/meetings/hubs/y.md' } } });
    await new MeetingsHubCards().render(q.dv);
    ok('MV-DAYHUB-EMPTY an empty day hub says "No meetings on Wed Nov 11."', one(q.container, 'sauce-meetings-empty').textContent === 'No meetings on Wed Nov 11.');
  }

  // ── Cold load and guards ──────────────────────────────────────────────────
  {
    const e = env({ filterBar: false });
    let beacon = 0;
    e.customJS.BeaconCards = { render: async () => { beacon++; } };
    await new MeetingsBrowseList().render(e.dv);
    ok('MV-COLD-FLAT without FilterBar the old month list draws', beacon > 0 && !byClass(e.container, 'sauce-filter-bar').length);
    const n = env({ filterBar: false });
    let hub = 0;
    n.customJS.BeaconCards = { render: async () => { hub++; } };
    n.customJS.RenderSafe.page = () => ({ file: { name: 'Meetings-2026-11-10' } });
    await new MeetingsHubCards().render(n.dv);
    ok('MV-COLD-HUB without FilterBar a day hub keeps its card rows', hub === 1);
    const p = env();
    p.customJS.RenderSafe.page = () => null;
    await new MeetingsBrowseList().render(p.dv);
    ok('MV-COLD-PAGE before the page is indexed nothing draws', p.container.children.length === 0);
    const t = env({ pagesThrow: true });
    let threw = false;
    try { await new MeetingsBrowseList().render(t.dv); } catch (_e) { threw = true; }
    ok('MV-COLD-THROW an unindexed vault never throws out of render', !threw);
    const m = env();
    m.container.closest = (sel) => (sel === '.markdown-embed' ? {} : null);
    await new MeetingsBrowseList().render(m.dv);
    ok('MV-EMBED inside an embed the view stays out', m.container.children.length === 0);
    MeetingsBrowseList.__states = new Map();
  }

  // ── Phone rules ───────────────────────────────────────────────────────────
  {
    const css = MeetingsBrowseList.ROW_CSS;
    ok('MV-PHONE-ROW on a phone the summary hides and the chips drop under the title (two lines at most)',
      css.includes('body.is-phone .sauce-meeting-row .sauce-meeting-summary { display: none; }')
      && css.includes('body.is-phone .sauce-meeting-row .sauce-meeting-chips { order: 3; flex: 1 1 100%;')
      && css.includes('@media (max-width: 480px) {'));
    ok('MV-TOUCH-ROW on touch the ⋯ sits inline and stays visible',
      css.includes('body.is-mobile .sauce-meeting-row .sauce-meeting-actions { position: static; transform: none; opacity: 1;')
      && css.includes('@media (hover: none) {') && css.includes('button.sauce-meeting-more { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;'));
    const d = MeetingLeafActions.DIALOG_CSS;
    ok('MV-PHONE-DIALOG the meeting dialogs clear the status bar and stay on screen on a phone',
      d.includes('body.is-phone .sauce-modal-backdrop.sauce-meeting-modal-overlay { padding: calc(env(safe-area-inset-top, 0px) + 8px)')
      && d.includes('@media (max-width: 600px) {'));
    const leafSrc = read('blueprints/meetings/helpers/meeting-leaf-actions.js');
    ok('MV-DIALOG-SHELL the meeting dialogs use the shared .sauce-modal shell and sauce-btn buttons',
      leafSrc.includes('cls: "sauce-modal-backdrop sauce-meeting-modal-overlay"') && leafSrc.includes('cls: "sauce-modal sauce-meeting-modal"')
      && leafSrc.includes('cls: "sauce-btn sauce-btn-accent"') && !leafSrc.includes('rgba(0,0,0,0.55)'));
  }

  // ── Dialog target from a list row ─────────────────────────────────────────
  {
    const seen = [];
    global.app = { vault: { getAbstractFileByPath: (p) => { seen.push(p); return { path: p }; } } };
    global.Notice = function Notice() {};
    const leaf = new MeetingLeafActions();
    leaf._page = () => ({ file: { path: 'spice/meetings/Meetings.md' } });
    leaf._listProjects = () => [];
    leaf._listPeople = () => [];
    leaf._openModal = () => {};
    const row = { file: { path: 'spice/meetings/notes/Retro.md' }, attendees: [] };
    leaf._onAddToProject({}, row);
    leaf._onEditAttendees({}, row);
    leaf._onAddToProject({});
    ok('MV-LEAF-TARGET Add to project / Edit attendees act on the row\'s meeting when one is passed, else the open note',
      seen.join('|') === 'spice/meetings/notes/Retro.md|spice/meetings/notes/Retro.md|spice/meetings/Meetings.md');
    delete global.app;
    delete global.Notice;
  }

  // ── Template + heal ───────────────────────────────────────────────────────
  {
    const tpl = read('blueprints/meetings/templates/Meetings.md');
    ok('MV-TEMPLATE the Meetings hub template has no heading above the view (it draws its own)',
      !tpl.includes('class: "SectionLabel"') && tpl.indexOf('MeetingChromeBar') < tpl.indexOf('MeetingsBrowseList'));
    const install = require('../install.js');
    const strip = install._stripMeetingsHubLabel;
    const bar = '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "MeetingChromeBar" });\n```\n\n';
    const label = '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Meetings", top: true }] });\n```\n\n';
    const view = '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "MeetingsBrowseList" });\n```\n';
    const fm = '---\ntags:\n  - meetings-hub\n---\n\n';
    const healed = strip(fm + bar + label + view);
    ok('MV-HEAL the hub\'s "Meetings" label block goes; the bar and the view stay byte for byte',
      typeof strip === 'function' && healed === fm + bar + view);
    ok('MV-HEAL-IDEMPOTENT a healed hub is left alone', strip(healed) === healed);
    const other = fm + bar + '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Agenda" }] });\n```\n\n' + view;
    ok('MV-HEAL-SCOPE any other SectionLabel is kept', strip(other) === other);
    const installSrc = read('install.js');
    const at = installSrc.indexOf('async function applyMeetingsHubScaffoldArchiveHeal');
    const scaffold = installSrc.slice(at, installSrc.indexOf('// 1b.', at));
    ok('MV-HEAL-SCAFFOLD a freshly scaffolded hub has no label either',
      at > 0 && scaffold.includes('class: "MeetingsBrowseList"') && !scaffold.includes('text: "Meetings"'));
  }

  // ── Manifest wiring ───────────────────────────────────────────────────────
  {
    const m = JSON.parse(read('mechanisms/section-label/manifest.json'));
    ok('MV-MANIFEST FilterBar registers and installs with the section-label mechanism',
      m.customjs_classes.includes('FilterBar') && m.files.some((f) => f.source === 'filter-bar.js' && f.dest === '{{scripts_path}}/section-label/filter-bar.js'));
    const root = path.resolve(__dirname, '..', '..');
    const mirror = (src, dest) => fs.readFileSync(path.join(root, src), 'utf8') === fs.readFileSync(path.join(root, dest), 'utf8');
    ok('MV-DOGFOOD the workshop\'s ranch copies match the sources',
      mirror('platform/mechanisms/section-label/filter-bar.js', 'ranch/scripts/section-label/filter-bar.js')
      && mirror('platform/blueprints/meetings/helpers/meetings-browse-list.js', 'ranch/scripts/meetings/meetings-browse-list.js')
      && mirror('platform/blueprints/meetings/helpers/meetings-hub-cards.js', 'ranch/scripts/meetings/meetings-hub-cards.js')
      && mirror('platform/blueprints/meetings/helpers/meeting-leaf-actions.js', 'ranch/scripts/meetings/meeting-leaf-actions.js')
      && mirror('platform/blueprints/project/helpers/project-meetings-list.js', 'ranch/scripts/project/project-meetings-list.js'));
  }

  console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
  process.exit(results.every(([, p]) => p) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
