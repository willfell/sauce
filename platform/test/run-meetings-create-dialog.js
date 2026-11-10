#!/usr/bin/env node
/**
 * run-meetings-create-dialog.js — "+ New Meeting" as one dialog.
 *
 * Drives the real SauceModal, TaskDialog (its shared dialog parts),
 * PeoplePicker, EntityCreate and MeetingCreateDialog against a fake DOM:
 * every field in one dialog, the defaults, the When pills, the payload
 * handed to EntityCreate as presetPrompts, a created note byte-identical to
 * the old prompt chain's, Enter / ⌘↵ / Esc, adding a person (and refusing a
 * path-hostile name), the cold-load fallback, EntityCreate's people prompt
 * and Edit attendees on the same picker, no second Templater prompt, and the
 * phone CSS contract.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const results = [];
const ok = (n, c, detail) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}${!c && detail ? ' — ' + detail : ''}`); };
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const load = (rel, name) => new Function(`${read(rel)}\nreturn ${name};`)();

const SauceModal = load('mechanisms/modal/sauce-modal.js', 'SauceModal');
const TaskDialog = load('mechanisms/task-entity/task-dialog.js', 'TaskDialog');
const PeoplePicker = load('mechanisms/entity-create/people-picker.js', 'PeoplePicker');
const EntityCreate = load('mechanisms/entity-create/entity-create.js', 'EntityCreate');
const MeetingCreateDialog = load('blueprints/meetings/helpers/meeting-create-dialog.js', 'MeetingCreateDialog');
const MeetingChromeBar = load('blueprints/meetings/helpers/meeting-chrome-bar.js', 'MeetingChromeBar');
const MeetingLeafActions = load('blueprints/meetings/helpers/meeting-leaf-actions.js', 'MeetingLeafActions');
const MEETINGS_MANIFEST = JSON.parse(read('blueprints/meetings/manifest.json'));
const MEETING_SPEC = () => {
  const e = JSON.parse(JSON.stringify(MEETINGS_MANIFEST.new_entity_buttons.find((x) => x.id === 'meeting')));
  e.destination.folder_prefix = e.destination.folder_prefix.replace('{{module_directory}}', 'spice/meetings');
  return e;
};

// ── fake DOM ────────────────────────────────────────────────────────────────
function makeEl(tag, doc) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), className: '', children: [], parentNode: null, ownerDocument: doc,
    style: { cssText: '', display: '' }, attributes: {}, _text: '', _listeners: {}, value: '', disabled: false,
    placeholder: '', type: '', id: '', focused: 0,
    classList: {
      add(c) { const s = new Set(String(el.className).split(/\s+/).filter(Boolean)); s.add(c); el.className = Array.from(s).join(' '); },
      remove(c) { el.className = String(el.className).split(/\s+/).filter((x) => x && x !== c).join(' '); },
      contains(c) { return String(el.className).split(/\s+/).includes(c); },
    },
    createEl(t, o) {
      const c = makeEl(t, doc);
      if (o && o.cls) c.className = o.cls;
      if (o && o.text != null) c.textContent = o.text;
      if (o && o.type) c.type = o.type;
      c.parentNode = this;
      this.children.push(c);
      return c;
    },
    createDiv(o) { return this.createEl('div', o); },
    createSpan(o) { return this.createEl('span', o); },
    empty() { for (const c of this.children) c.parentNode = null; this.children = []; this._text = ''; },
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
    insertBefore(c, ref) {
      const i = ref ? this.children.indexOf(ref) : -1;
      c.parentNode = this;
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    replaceChildren(...cs) { this.children = cs; for (const c of cs) c.parentNode = this; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener() {},
    focus() { this.focused += 1; if (doc) doc.activeElement = this; },
    querySelector() { return null; },
    closest() { return null; },
    get firstChild() { return this.children[0] || null; },
    get childNodes() { return this.children; },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
    set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; },
    get innerHTML() { return this._text; },
    set innerHTML(v) { this._text = ''; this.children = []; },
  };
  return el;
}
function makeDoc() {
  const doc = { _keydown: [], activeElement: null };
  doc.createElement = (t) => makeEl(t, doc);
  doc.head = makeEl('head', doc);
  doc.body = makeEl('body', doc);
  doc.addEventListener = (t, fn) => { if (t === 'keydown') doc._keydown.push(fn); };
  doc.removeEventListener = (t, fn) => { if (t === 'keydown') doc._keydown = doc._keydown.filter((f) => f !== fn); };
  doc.key = (target, key, mods) => {
    const ev = { key, target, defaultPrevented: false, isComposing: false, shiftKey: false, altKey: false,
      metaKey: false, ctrlKey: false, ...(mods || {}), preventDefault() { ev.defaultPrevented = true; }, stopPropagation() {} };
    for (const fn of doc._keydown.slice()) fn(ev);
    for (const fn of (target && target._listeners.keydown) || []) fn(ev);
    return ev;
  };
  return doc;
}
const all = (n) => (n.children || []).flatMap((c) => [c, ...all(c)]);
const has = (n, cls) => String(n.className).split(/\s+/).includes(cls);
const byClass = (root, cls) => all(root).filter((n) => has(n, cls));
const one = (root, cls) => byClass(root, cls)[0];
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

// ── fake moment, fixed clock 2026-11-10 13:20:05 -06:00 ─────────────────────
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function momentAt(y, mo, d, h, mi, s) {
  const p = (x) => String(x).padStart(2, '0');
  const tok = { YYYY: String(y), MMMM: MONTHS[mo - 1], MM: p(mo), DD: p(d), HH: p(h), mm: p(mi), ss: p(s), ZZ: '-0600', Z: '-06:00' };
  return {
    format(fmt) { return String(fmt).replace(/YYYY|MMMM|MM|DD|HH|mm|ss|ZZ|Z/g, (t) => tok[t]); },
    isValid() { return true; },
  };
}
const NOW = () => momentAt(2026, 11, 10, 13, 20, 5);

// ── environment ─────────────────────────────────────────────────────────────
function env(opts) {
  const o = opts || {};
  const doc = makeDoc();
  const files = new Map();
  for (const n of (o.people || ['Ada Lovelace', 'Bob Ng', 'Cy Park'])) files.set(`spice/people/${n}.md`, { path: `spice/people/${n}.md`, basename: n, fm: { type: 'person' } });
  files.set('spice/people/People.md', { path: 'spice/people/People.md', basename: 'People', fm: {} });
  for (const n of (o.projects || ['Atlas', 'Beacon'])) files.set(`spice/projects/${n.toLowerCase()}/${n}.md`, { path: `spice/projects/${n.toLowerCase()}/${n}.md`, basename: n, fm: { type: 'project', name: n } });
  const created = [];
  const opened = [];
  const notices = [];
  const app = {
    isMobile: !!o.mobile,
    vault: {
      getMarkdownFiles: () => Array.from(files.values()),
      getAbstractFileByPath: (p) => files.get(p) || (o.folders && o.folders.has(p) ? { path: p } : null),
      async create(p, content) {
        if (o.failCreate && o.failCreate(p)) throw new Error('fixture create failure');
        const f = { path: p, basename: p.replace(/^.*\//, '').replace(/\.md$/, ''), fm: {} };
        files.set(p, f);
        created.push({ path: p, content });
        return f;
      },
      async createFolder() {},
    },
    metadataCache: { getFileCache: (f) => (f && f.fm ? { frontmatter: f.fm } : null) },
    workspace: { getLeaf: () => ({ openFile: async (f) => { opened.push(f.path); } }) },
  };
  const ec = new EntityCreate();
  ec._loadSpec = async () => MEETING_SPEC();
  const promptCalls = [];
  const realPrompt = ec._prompt.bind(ec);
  ec._prompt = (p, ctx) => { promptCalls.push(p.key); return o.promptAnswers ? Promise.resolve(o.promptAnswers[p.key]) : realPrompt(p, ctx); };
  ec._resolveOptionsSource = () => ['(none)'].concat(o.projects || ['Atlas', 'Beacon']);
  const mutateCalls = [];
  const customJS = {
    SauceModal: new SauceModal(),
    PeoplePicker: new PeoplePicker(),
    EntityCreate: ec,
    MeetingCreateDialog: new MeetingCreateDialog(),
    RenderSafe: {
      async mutateStructure(opts2) {
        mutateCalls.push(opts2.path);
        const receipt = opts2.apply();
        try { const value = await opts2.write(); return { ok: true, value, receipt }; }
        catch (error) { opts2.rollback(receipt, error); return { ok: false, error }; }
      },
    },
  };
  if (o.taskDialog !== false) customJS.TaskDialog = new TaskDialog();
  if (o.drop) for (const k of o.drop) delete customJS[k];
  global.document = doc;
  global.app = app;
  global.customJS = customJS;
  global.window = { app, customJS, moment: () => NOW(), localStorage: null };
  global.Notice = function (msg) { notices.push(String(msg)); };
  Object.defineProperty(global, 'navigator', { value: { platform: 'MacIntel' }, configurable: true, writable: true });
  return { doc, app, files, created, opened, notices, customJS, ec, promptCalls, mutateCalls };
}
const modalOf = (doc) => one(doc.body, 'sauce-modal');
const openDialog = (e, extra) => e.customJS.MeetingCreateDialog.open({ dv: { current: () => ({}) }, now: NOW(), ...(extra || {}) });
const pick = (root, cls, text) => byClass(root, cls).find((n) => n.textContent === text || n.textContent.indexOf(text) >= 0);
const typeInto = (input, text) => { input.value = text; if (input.oninput) input.oninput(); };

(async () => {
  // ── One dialog, every field ───────────────────────────────────────────────
  {
    const e = env();
    const opened = openDialog(e);
    const m = modalOf(e.doc);
    const titles = byClass(e.doc.body, 'sauce-modal-title').map((n) => n.textContent);
    ok('MCD-ONE-DIALOG one .sauce-modal holds title, attendees, When, Project, Cancel and Create meeting',
      opened === true && byClass(e.doc.body, 'sauce-modal').length === 1
      && JSON.stringify(titles) === JSON.stringify(['New meeting'])
      && !!one(m, 'sauce-meeting-title-input') && !!one(m, 'sauce-people-picker-search') && !!one(m, 'sauce-people-picker-list')
      && byClass(m, 'sauce-meeting-when').length === 4 && !!one(m, 'sauce-meeting-when-input')
      && !!one(m, 'sauce-task-project-search')
      && !!pick(m, 'sauce-meeting-cancel', 'Cancel') && !!pick(m, 'sauce-meeting-create', 'Create meeting')
      && e.promptCalls.length === 0);
    ok('MCD-SHARED-SHELL the dialog is TaskDialog.openShell: sauce-task-dialog class, two columns, header ✕',
      has(m, 'sauce-task-dialog') && has(m, 'sauce-meeting-create-dialog') && !!one(m, 'sauce-task-dialog-cols')
      && !!one(m, 'sauce-task-dialog-left') && !!one(m, 'sauce-task-dialog-right') && !!one(m, 'sauce-task-dialog-close'));
    ok('MCD-SECTIONS section labels read Attendees, When, Project in the task dialog style',
      JSON.stringify(byClass(m, 'sauce-task-section-label').map((n) => n.textContent)) === JSON.stringify(['Attendees', 'When', 'Project']));
    const people = byClass(m, 'sauce-people-picker-name').map((n) => n.textContent);
    ok('MCD-PEOPLE-LIST attendee list is spice/people/*.md without the People hub, sorted',
      JSON.stringify(people) === JSON.stringify(['Ada Lovelace', 'Bob Ng', 'Cy Park']));

    // Defaults.
    const nowPill = byClass(m, 'sauce-meeting-when').find((b) => b.attributes['data-key'] === 'now');
    const input = one(m, 'sauce-meeting-when-input');
    const create = pick(m, 'sauce-meeting-create', 'Create meeting');
    ok('MCD-DEFAULTS datetime defaults to now (Now pressed, picker hidden), project none, Create waits for a title',
      has(nowPill, 'is-selected') && nowPill.attributes['aria-pressed'] === 'true'
      && input.value === '2026-11-10T13:20' && input.style.display === 'none'
      && one(m, 'sauce-meeting-when-caption').textContent === 'Tue Nov 10, 1:20 PM'
      && byClass(m, 'sauce-task-project-chip').every((c) => !has(c, 'is-selected'))
      && create.disabled === true);
    ok('MCD-KBD-HINT the Create button shows the ⌘↵ hint on desktop',
      one(create, 'sauce-task-kbd') && one(create, 'sauce-task-kbd').textContent === '⌘↵');
  }

  // ── When pills ────────────────────────────────────────────────────────────
  {
    const W = MeetingCreateDialog.whenOptions('2026-11-10T13:20');
    ok('MCD-WHEN-OPTIONS Now / Next hour / Tomorrow 9 AM / Pick… with their datetimes',
      JSON.stringify(W.map((w) => [w.key, w.label, w.value])) === JSON.stringify([
        ['now', 'Now', '2026-11-10T13:20'], ['next-hour', 'Next hour', '2026-11-10T14:00'],
        ['tomorrow', 'Tomorrow 9 AM', '2026-11-11T09:00'], ['pick', 'Pick…', null]]));
    ok('MCD-WHEN-ROLLOVER next hour and tomorrow cross the day, month and year',
      MeetingCreateDialog.whenOptions('2026-12-31T23:40')[1].value === '2027-01-01T00:00'
      && MeetingCreateDialog.whenOptions('2026-11-30T08:00')[2].value === '2026-12-01T09:00');
    ok('MCD-WHEN-CAPTION 12-hour caption with weekday; unparseable asks to pick',
      MeetingCreateDialog.whenCaption('2026-11-11T09:00') === 'Wed Nov 11, 9:00 AM'
      && MeetingCreateDialog.whenCaption('2026-11-10T00:05') === 'Tue Nov 10, 12:05 AM'
      && MeetingCreateDialog.whenCaption('2026-11-10T12:30') === 'Tue Nov 10, 12:30 PM'
      && MeetingCreateDialog.whenCaption('') === 'Pick a date and time');
    const e = env();
    openDialog(e);
    const m = modalOf(e.doc);
    const pill = (k) => byClass(m, 'sauce-meeting-when').find((b) => b.attributes['data-key'] === k);
    const input = one(m, 'sauce-meeting-when-input');
    pill('tomorrow').onclick();
    const afterTomorrow = input.value;
    pill('pick').onclick();
    const shown = input.style.display === '';
    input.value = '2026-11-20T15:45';
    input.onchange();
    ok('MCD-WHEN-PICK a pill sets its datetime; Pick… shows the picker and keeps what it is given',
      afterTomorrow === '2026-11-11T09:00' && shown && has(pill('pick'), 'is-selected')
      && one(m, 'sauce-meeting-when-caption').textContent === 'Fri Nov 20, 3:45 PM');
    input.value = '';
    input.onchange();
    ok('MCD-WHEN-EMPTY clearing the picker keeps the last datetime (the note always gets a date)',
      input.value === '2026-11-20T15:45');
  }

  // ── Payload into presetPrompts, and the byte-identical note ───────────────
  let dialogNote = null;
  {
    const e = env({ folders: new Set() });
    const calls = [];
    const realCreate = e.ec.create.bind(e.ec);
    e.ec.create = (args) => { calls.push(args); return realCreate(args); };
    const lifecycle = { apply: () => ({ node: null }), rollback: () => {} };
    openDialog(e, { structuralLifecycle: lifecycle });
    const m = modalOf(e.doc);
    typeInto(one(m, 'sauce-meeting-title-input'), 'Design sync');
    const row = (name) => byClass(m, 'sauce-people-picker-row').find((r) => r.textContent.indexOf(name) >= 0);
    row('Bob Ng').onclick();
    row('Ada Lovelace').onclick();
    const chips = byClass(m, 'sauce-people-picker-chip').map((c) => c.children[0].textContent);
    const pickBtn = byClass(m, 'sauce-meeting-when').find((b) => b.attributes['data-key'] === 'pick');
    pickBtn.onclick();
    const input = one(m, 'sauce-meeting-when-input');
    input.value = '2026-11-10T14:30';
    input.onchange();
    typeInto(one(m, 'sauce-task-project-search'), 'atl');
    byClass(m, 'sauce-task-project-chip').find((c) => c.textContent === 'Atlas').onclick();
    const create = pick(m, 'sauce-meeting-create', 'Create meeting');
    ok('MCD-CHIPS picked attendees show as chips, in pick order',
      JSON.stringify(chips) === JSON.stringify(['Bob Ng', 'Ada Lovelace']) && create.disabled === false);
    await create.onclick({ currentTarget: create, target: create });
    await settle();
    ok('MCD-PAYLOAD Create hands EntityCreate one meeting create with every answer as presetPrompts',
      calls.length === 1 && calls[0].instance === 'meeting' && calls[0].structuralLifecycle === lifecycle
      && JSON.stringify(calls[0].presetPrompts) === JSON.stringify({
        title: 'Design sync', attendees: ['Bob Ng', 'Ada Lovelace'], datetime: '2026-11-10T14:30', project: '[[Atlas]]' })
      && e.promptCalls.length === 0);
    ok('MCD-CLOSES the dialog closes once the create starts',
      !modalOf(e.doc));
    dialogNote = e.created.find((c) => c.path.indexOf('spice/meetings/notes/') === 0);
    ok('MCD-OPENS-NOTE the created meeting opens',
      !!dialogNote && e.opened.indexOf(dialogNote.path) >= 0);
  }
  {
    const e = env({ promptAnswers: { title: 'Design sync', attendees: ['Bob Ng', 'Ada Lovelace'], datetime: '2026-11-10T14:30', project: 'Atlas' } });
    await e.ec.create({ instance: 'meeting', dv: { current: () => ({}) } });
    const promptNote = e.created.find((c) => c.path.indexOf('spice/meetings/notes/') === 0);
    ok('MCD-BYTE-IDENTICAL the dialog writes the same path and bytes as the old prompt chain given the same answers',
      !!promptNote && !!dialogNote && promptNote.path === dialogNote.path && promptNote.content === dialogNote.content
      && JSON.stringify(e.promptCalls) === JSON.stringify(['title', 'attendees', 'datetime', 'project']),
      promptNote && dialogNote ? `${promptNote.path} vs ${dialogNote.path}` : 'missing note');
    ok('MCD-NOTE-SHAPE the note carries the links pipe, project link and datetime',
      !!dialogNote && dialogNote.path === 'spice/meetings/notes/2026/11-November/Design sync-2026-11-10.md'
      && /attendees:\n {2}- "\[\[Bob Ng\]\]"\n {2}- "\[\[Ada Lovelace\]\]"/.test(dialogNote.content)
      && dialogNote.content.indexOf('project: "[[Atlas]]"') >= 0 && dialogNote.content.indexOf('2026-11-10T14:30') >= 0,
      dialogNote && dialogNote.content.slice(0, 400));
  }
  {
    const e = env({ promptAnswers: { title: 'Solo', attendees: [], datetime: '2026-11-10T13:20', project: '(none)' } });
    await e.ec.create({ instance: 'meeting', dv: { current: () => ({}) } });
    const viaPrompts = e.created[0];
    const e2 = env();
    openDialog(e2);
    const m = modalOf(e2.doc);
    typeInto(one(m, 'sauce-meeting-title-input'), '  Solo  ');
    const create = pick(m, 'sauce-meeting-create', 'Create meeting');
    await create.onclick({ currentTarget: create, target: create });
    await settle();
    ok('MCD-BYTE-IDENTICAL-DEFAULTS defaults only (no attendees, Now, no project) also match the prompt chain; the title is trimmed',
      !!viaPrompts && !!e2.created[0] && viaPrompts.path === e2.created[0].path && viaPrompts.content === e2.created[0].content);
  }

  // ── Keys ──────────────────────────────────────────────────────────────────
  {
    const e = env();
    const calls = [];
    e.ec.create = async (args) => { calls.push(args); };
    openDialog(e);
    const m = modalOf(e.doc);
    const title = one(m, 'sauce-meeting-title-input');
    e.doc.key(title, 'Enter');
    await settle();
    const emptyEnter = calls.length;
    typeInto(one(m, 'sauce-people-picker-search'), 'Ada');
    e.doc.key(one(m, 'sauce-people-picker-search'), 'Enter');
    await settle();
    const afterPeopleEnter = { calls: calls.length, open: !!modalOf(e.doc), chips: byClass(m, 'sauce-people-picker-chip').length };
    typeInto(title, 'Standup');
    e.doc.key(title, 'Enter');
    await settle();
    ok('MCD-ENTER Enter in the title creates once it has text; Enter in the people search picks a person, never creates',
      emptyEnter === 0 && afterPeopleEnter.calls === 0 && afterPeopleEnter.open && afterPeopleEnter.chips === 1
      && calls.length === 1 && calls[0].presetPrompts.title === 'Standup'
      && JSON.stringify(calls[0].presetPrompts.attendees) === JSON.stringify(['Ada Lovelace']));
  }
  {
    const e = env();
    const calls = [];
    e.ec.create = async (args) => { calls.push(args); };
    openDialog(e);
    const m = modalOf(e.doc);
    typeInto(one(m, 'sauce-meeting-title-input'), 'Retro');
    e.doc.key(one(m, 'sauce-task-project-search'), 'Enter', { metaKey: true });
    await settle();
    ok('MCD-CMD-ENTER ⌘↵ from any field creates', calls.length === 1 && calls[0].presetPrompts.title === 'Retro');
  }
  {
    const e = env();
    const calls = [];
    e.ec.create = async (args) => { calls.push(args); };
    openDialog(e);
    const m = modalOf(e.doc);
    typeInto(one(m, 'sauce-meeting-title-input'), 'Never');
    e.doc.key(one(m, 'sauce-meeting-title-input'), 'Escape');
    await settle();
    const escClosed = !modalOf(e.doc);
    openDialog(e);
    pick(modalOf(e.doc), 'sauce-meeting-cancel', 'Cancel').onclick();
    ok('MCD-ESC-CANCEL Esc and Cancel close without creating', escClosed && !modalOf(e.doc) && calls.length === 0);
  }

  // ── Add a person; refuse a path-hostile name ──────────────────────────────
  {
    const e = env();
    openDialog(e);
    const m = modalOf(e.doc);
    const search = one(m, 'sauce-people-picker-search');
    const add = one(m, 'sauce-people-picker-add');
    const hiddenAtRest = add.style.display === 'none';
    typeInto(search, '  Grace   Hopper ');
    const label = add.textContent;
    await add.onclick();
    await settle();
    const stub = e.created.find((c) => c.path === 'spice/people/Grace Hopper.md');
    ok('MCD-ADD-PERSON ＋ Add new person creates the stub (trimmed name), selects them and clears the search',
      hiddenAtRest && label === '＋ Add new person “Grace Hopper”' && !!stub
      && stub.content === PeoplePicker.stubBody('Grace Hopper', '2026-11-10T13:20:05-06:00')
      && byClass(m, 'sauce-people-picker-chip').map((c) => c.children[0].textContent).join() === 'Grace Hopper'
      && search.value === '');
    typeInto(search, 'ada lovelace');
    ok('MCD-ADD-EXISTING a name that already exists (any case) offers no add',
      add.style.display === 'none');
    typeInto(search, 'R&D / Ops');
    const note = one(m, 'sauce-people-picker-note');
    const hostileShown = add.style.display === 'none' && note.style.display === '' && /can.t contain/.test(note.textContent);
    e.doc.key(search, 'Enter');
    await settle();
    ok('MCD-HOSTILE a path-hostile name is refused with a caption, by button and by Enter, and writes nothing',
      hostileShown && e.created.length === 1
      && PeoplePicker.cleanName('A/B') === '' && PeoplePicker.cleanName('.hidden') === '' && PeoplePicker.cleanName('x[y]') === ''
      && PeoplePicker.cleanName('  Ann  Lee ') === 'Ann Lee');
  }
  {
    const e = env({ failCreate: (p) => p.indexOf('spice/people/') === 0 });
    openDialog(e);
    const m = modalOf(e.doc);
    typeInto(one(m, 'sauce-people-picker-search'), 'Dee');
    let threw = false;
    try { await one(m, 'sauce-people-picker-add').onclick(); await settle(); } catch (_e) { threw = true; }
    ok('MCD-ADD-FAILS a failed stub write selects no one and never throws',
      !threw && byClass(m, 'sauce-people-picker-chip').length === 0);
  }
  {
    const e = env();
    const calls = [];
    e.ec.create = async (args) => { calls.push(args); };
    let release;
    const gate = new Promise((r) => { release = r; });
    const realVaultCreate = e.app.vault.create;
    e.app.vault.create = async (p, c) => { await gate; return realVaultCreate(p, c); };
    openDialog(e);
    const m = modalOf(e.doc);
    typeInto(one(m, 'sauce-meeting-title-input'), 'Sync');
    typeInto(one(m, 'sauce-people-picker-search'), 'Eve');
    one(m, 'sauce-people-picker-add').onclick();
    const create = pick(m, 'sauce-meeting-create', 'Create meeting');
    const submitting = create.onclick({ currentTarget: create, target: create });
    await settle();
    const beforeRelease = calls.length;
    release();
    await submitting;
    await settle();
    ok('MCD-ADD-THEN-CREATE Create waits for a pending new person and includes them',
      beforeRelease === 0 && calls.length === 1 && JSON.stringify(calls[0].presetPrompts.attendees) === JSON.stringify(['Eve']));
  }

  // ── Cold load, entry points ───────────────────────────────────────────────
  {
    const e = env({ taskDialog: false });
    ok('MCD-COLD-LOAD without TaskDialog open() returns false and draws nothing',
      openDialog(e) === false && !modalOf(e.doc));
    const e2 = env({ drop: ['PeoplePicker'] });
    const e3 = env({ drop: ['EntityCreate'] });
    ok('MCD-COLD-LOAD-PARTS without PeoplePicker or EntityCreate open() returns false and leaves no dialog behind',
      openDialog(e2) === false && openDialog(e3) === false && !modalOf(e2.doc) && !modalOf(e3.doc));
  }
  {
    const e = env({ taskDialog: false });
    const calls = [];
    e.ec.create = async (args) => { calls.push(args); };
    const cfg = new MeetingChromeBar()._config();
    cfg.dispatch({ container: e.doc.body, current: () => ({}) }, { context: 'meetings-hub' }, 'new-meeting');
    const fellBack = calls.length === 1 && calls[0].instance === 'meeting' && !calls[0].presetPrompts
      && typeof calls[0].structuralLifecycle.apply === 'function';
    const e2 = env();
    const calls2 = [];
    e2.ec.create = async (args) => { calls2.push(args); };
    cfg.dispatch({ container: e2.doc.body, current: () => ({}) }, { context: 'meetings-hub' }, 'new-meeting');
    ok('MCD-CHROME-BAR + New Meeting opens the dialog; with it unavailable it falls back to EntityCreate prompts with the lifecycle',
      fellBack && !!modalOf(e2.doc) && has(modalOf(e2.doc), 'sauce-meeting-create-dialog') && calls2.length === 0);
  }
  {
    const homeSrc = read('blueprints/home/helpers/space-home.js');
    const at = homeSrc.indexOf('if (key === "meeting") {');
    const block = homeSrc.slice(at, homeSrc.indexOf('if (key === "sticky-note")', at));
    ok('MCD-HOME Home\'s New meeting tries the dialog first, then EntityCreate',
      block.indexOf('cjs.MeetingCreateDialog.open({ dv: dv }) === true') > 0
      && block.indexOf('cjs.MeetingCreateDialog.open') < block.indexOf('cjs.EntityCreate.create({ instance: "meeting"'));
  }

  // ── EntityCreate's people prompt is the same picker ───────────────────────
  {
    const e = env();
    const pending = e.ec._promptPeopleMulti({ key: 'attendees', label: 'Attendees' }, { now: NOW() });
    const m = modalOf(e.doc);
    const isShell = !!m && has(m, 'sauce-task-dialog') && has(m, 'sauce-task-dialog-single') && !!one(m, 'sauce-people-picker');
    byClass(m, 'sauce-people-picker-row').find((r) => r.textContent.indexOf('Cy Park') >= 0).onclick();
    await one(m, 'sauce-people-prompt-done').onclick();
    const v = await pending;
    const pending2 = e.ec._promptPeopleMulti({ key: 'attendees', label: 'Attendees' }, { now: NOW() });
    e.doc.key(one(modalOf(e.doc), 'sauce-people-picker-search'), 'Escape');
    const v2 = await pending2;
    const e3 = env({ taskDialog: false });
    const v3 = await e3.ec._promptPeopleMulti({ key: 'attendees', label: 'Attendees' }, { now: NOW() });
    ok('MCD-PROMPT-WRAPPER people-multi prompt mounts PeoplePicker in the shared shell: Done → names, Esc → null, cold load → [] with a Notice',
      isShell && JSON.stringify(v) === JSON.stringify(['Cy Park']) && v2 === null
      && JSON.stringify(v3) === '[]' && e3.notices.some((n) => /picker unavailable/.test(n)));
    const ecSrc = read('mechanisms/entity-create/entity-create.js');
    ok('MCD-ONE-PICKER EntityCreate no longer carries its own attendee overlay',
      ecSrc.indexOf('Search or add a person…') < 0 && ecSrc.indexOf('PP.mount(shell.left') > 0
      && (ecSrc.match(/rgba\(0,0,0,0\.5\)/g) || []).length === 2);
  }

  // ── Edit attendees is the same picker ─────────────────────────────────────
  {
    const e = env();
    const meeting = { path: 'spice/meetings/notes/x.md', basename: 'x', fm: { type: 'meeting' } };
    e.files.set(meeting.path, meeting);
    const mla = new MeetingLeafActions();
    mla._onEditAttendees({ current: () => ({}) }, { file: { path: meeting.path }, attendees: ['[[Bob Ng]]'] });
    const m = modalOf(e.doc);
    ok('MCD-EDIT-SAME-PICKER Edit attendees opens the shared shell with PeoplePicker, current attendees as chips',
      !!m && has(m, 'sauce-task-dialog') && has(m, 'sauce-meeting-modal') && !!one(m, 'sauce-people-picker')
      && byClass(m, 'sauce-people-picker-chip').map((c) => c.children[0].textContent).join() === 'Bob Ng'
      && !!byClass(m, 'sauce-meeting-attendees-save').length);
  }

  // ── No second Templater prompt ────────────────────────────────────────────
  {
    const body = dialogNote ? dialogNote.content.replace(/^---\n[\s\S]*?\n---\n/, '') : '';
    const tpl = read('blueprints/meetings/templates/Meeting.md');
    ok('MCD-TEMPLATER the created note has a body and no Templater tags, so Templater neither applies the folder template nor runs a prompt',
      body.trim().length > 0 && dialogNote.content.indexOf('<%') < 0
      && MEETINGS_MANIFEST.templater_folder_templates.some((t) => t.folder === '{{module_directory}}/notes'));
    ok('MCD-TEMPLATER-SENTINEL the Templater Meeting.md path keeps its attendee suggester loop (SUGGESTER_LOOP_V0880)',
      tpl.indexOf('SUGGESTER_LOOP_V0880') >= 0);
  }

  // ── Phone CSS contract ────────────────────────────────────────────────────
  {
    const css = TaskDialog._DIALOG_CSS;
    const phone = css.slice(css.indexOf('@media (max-width: 600px) {'));
    const pcss = PeoplePicker.PICKER_CSS;
    const mcss = MeetingCreateDialog.MEETING_CSS;
    ok('MCD-PHONE-SAFE-AREA on a phone the backdrop clears the status bar and home indicator and the sheet stretches',
      /\.sauce-modal-backdrop:has\(> \.sauce-task-dialog\) \{ padding: calc\(env\(safe-area-inset-top, 0px\) \+ 8px\) 8px calc\(env\(safe-area-inset-bottom, 0px\) \+ 8px\); align-items: stretch; \}/.test(phone)
      && /\.sauce-modal\.sauce-task-dialog \{ max-height: 100%; min-width: 0; \}/.test(phone));
    ok('MCD-PHONE-GRID every grid column is minmax(0, …), never a bare 1fr',
      [css, pcss, mcss].every((c) => !/grid-template-columns:[^;]*(^|[\s(,])1fr/.test(c.replace(/minmax\(0, 1fr\)/g, '')))
      && css.indexOf('grid-template-columns: minmax(0, 1fr)') >= 0);
    ok('MCD-PHONE-PILLS pills and quiet buttons are height:auto, min-height 32px, and out-rank a body.is-phone button rule',
      /button\.sauce-task-pill, \.sauce-task-dialog button\.sauce-task-quiet \{ height: auto; min-height: 32px;/.test(phone)
      && css.indexOf('body.is-phone .sauce-task-dialog button.sauce-task-pill, body.is-phone .sauce-task-dialog button.sauce-task-quiet { height: auto; min-height: 32px; }') >= 0);
    ok('MCD-PHONE-SMALL-BUTTONS a chip ✕ and the header ✕ keep their size under a phone theme\'s button rule',
      css.indexOf('body.is-phone .sauce-task-dialog button.sauce-task-chip-x { height: 18px; min-height: 18px; }') >= 0
      && css.indexOf('body.is-phone .sauce-task-dialog button.sauce-task-dialog-close { height: 32px; min-height: 32px; }') >= 0);
    ok('MCD-PHONE-FOOTER the footer is border-box and stacks with full-width buttons on a phone',
      /\.sauce-task-dialog > \.sauce-modal-footer \{ box-sizing: border-box;/.test(css)
      && phone.indexOf('.sauce-task-dialog > .sauce-modal-footer { flex-direction: column; align-items: stretch;') >= 0
      && phone.indexOf('.sauce-task-footer-right > .sauce-btn { flex: 1 1 0; min-width: 0; }') >= 0);
    ok('MCD-PHONE-KBD the shortcut hint is hidden on a phone',
      phone.indexOf('.sauce-task-kbd { display: none; }') >= 0 && css.indexOf('body.is-phone .sauce-task-kbd { display: none; }') >= 0);
    ok('MCD-PHONE-LIST the people list scrolls inside the dialog and is shorter on a phone',
      pcss.indexOf('.sauce-people-picker-list.sauce-task-picker-results { margin-top: 0; max-height: 200px; overscroll-behavior: contain;') >= 0
      && pcss.indexOf('body.is-phone .sauce-people-picker-list.sauce-task-picker-results { max-height: 168px; }') >= 0
      && /overflow-y: auto/.test(css.slice(css.indexOf('.sauce-task-picker-results {'))));
    ok('MCD-PHONE-CHIPS a long attendee name ellipsizes instead of widening the dialog',
      pcss.indexOf('.sauce-people-picker-chip > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }') >= 0
      && pcss.indexOf('.sauce-people-picker-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }') >= 0);
    const e = env({ mobile: true });
    openDialog(e);
    const create = pick(modalOf(e.doc), 'sauce-meeting-create', 'Create meeting');
    ok('MCD-PHONE-NO-HINT on mobile the Create button carries no shortcut hint',
      !one(create, 'sauce-task-kbd'));
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  {
    const ecMan = JSON.parse(read('mechanisms/entity-create/manifest.json'));
    const manifest = JSON.parse(read('test/preflight-manifest.json'));
    const steps = JSON.stringify(manifest);
    const ranch = (rel, src) => {
      try { return fs.readFileSync(path.resolve(__dirname, '..', '..', 'ranch', 'scripts', rel), 'utf8') === read(src); } catch (_e) { return false; }
    };
    ok('MCD-MANIFEST MeetingCreateDialog and PeoplePicker are shipped classes with their files',
      MEETINGS_MANIFEST.customjs_classes.indexOf('MeetingCreateDialog') >= 0
      && MEETINGS_MANIFEST.files.some((f) => f.source === 'helpers/meeting-create-dialog.js' && f.dest === '{{scripts_path}}/meetings/meeting-create-dialog.js')
      && ecMan.customjs_classes.indexOf('PeoplePicker') >= 0
      && ecMan.files.some((f) => f.source === 'people-picker.js' && f.dest === '{{scripts_path}}/entity-create/people-picker.js'));
    ok('MCD-PREFLIGHT this harness is a preflight step', steps.indexOf('platform/test/run-meetings-create-dialog.js') >= 0);
    ok('MCD-DOGFOOD the workshop\'s ranch copies match the sources',
      ranch('meetings/meeting-create-dialog.js', 'blueprints/meetings/helpers/meeting-create-dialog.js')
      && ranch('entity-create/people-picker.js', 'mechanisms/entity-create/people-picker.js')
      && ranch('entity-create/entity-create.js', 'mechanisms/entity-create/entity-create.js')
      && ranch('task-entity/task-dialog.js', 'mechanisms/task-entity/task-dialog.js')
      && ranch('meetings/meeting-leaf-actions.js', 'blueprints/meetings/helpers/meeting-leaf-actions.js')
      && ranch('meetings/meeting-chrome-bar.js', 'blueprints/meetings/helpers/meeting-chrome-bar.js')
      && ranch('home/space-home.js', 'blueprints/home/helpers/space-home.js'));
  }

  console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
  process.exit(results.every(([, c]) => c) ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
