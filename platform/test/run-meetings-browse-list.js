#!/usr/bin/env node
'use strict';

// MeetingsBrowseList harness — verifies the pure statics of the persistent
// Meetings hub list helper. The class is a BARE CLASS (customJS loader wraps the
// file in `( ... )`), so we load it via `new Function(src + "return X;")()` —
// NOT require() (there is no module.exports trailer, by design).

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  return new Function(`${src}\nreturn ${name};`)();
}

const MeetingsBrowseList = loadClass(
  'platform/blueprints/meetings/helpers/meetings-browse-list.js',
  'MeetingsBrowseList'
);
const MeetingsHubCards = loadClass(
  'platform/blueprints/meetings/helpers/meetings-hub-cards.js',
  'MeetingsHubCards'
);

const results = [];
function ok(name, cond) {
  results.push([name, !!cond]);
  console.log(`  ${cond ? 'PASS' : 'FAIL'} — ${name}`);
}

// ---------- MBL-MONTHKEY ----------
ok('MBL-MONTHKEY-1 ISO string → YYYY-MM',
  MeetingsBrowseList._monthKey('2026-07-13T09:00:00Z') === '2026-07');
ok('MBL-MONTHKEY-2 plain date → YYYY-MM',
  MeetingsBrowseList._monthKey('2026-07-13') === '2026-07');
{
  let threw = false;
  let a, b;
  try { a = MeetingsBrowseList._monthKey(''); b = MeetingsBrowseList._monthKey(null); }
  catch (_e) { threw = true; }
  ok('MBL-MONTHKEY-3 empty/null → stable fallback, no throw',
    !threw && typeof a === 'string' && typeof b === 'string' && a === b);
}

// ---------- MBL-ATTENDEES ----------
{
  const names = MeetingsBrowseList._attendeeNames({ attendees: ['[[Ada Lovelace]]', '[[Bob]]'] });
  ok('MBL-ATTENDEES-1 strips [[ ]] from attendees',
    Array.isArray(names) && names.length === 2 && names[0] === 'Ada Lovelace' && names[1] === 'Bob');
}
{
  const names = MeetingsBrowseList._attendeeNames({ attendees: ['[[Ada Lovelace|Ada]]'] });
  ok('MBL-ATTENDEES-2 prefers |alias display name',
    names.length === 1 && names[0] === 'Ada');
}
{
  const names = MeetingsBrowseList._attendeeNames({ people: ['[[Carol]]'] });
  ok('MBL-ATTENDEES-3 falls back to page.people when attendees absent',
    names.length === 1 && names[0] === 'Carol');
}
{
  const names = MeetingsBrowseList._attendeeNames({ attendees: [], people: ['[[Dave]]'] });
  ok('MBL-ATTENDEES-4 falls back to page.people when attendees empty',
    names.length === 1 && names[0] === 'Dave');
}
{
  let threw = false;
  let a, b, c, d;
  try {
    a = MeetingsBrowseList._attendeeNames(null);
    b = MeetingsBrowseList._attendeeNames(undefined);
    c = MeetingsBrowseList._attendeeNames({});
    d = MeetingsBrowseList._attendeeNames({ attendees: 'Not an array' });
  } catch (_e) { threw = true; }
  ok('MBL-ATTENDEES-5 null/undefined/{}/garbage → [] without throwing',
    !threw && Array.isArray(a) && a.length === 0
    && Array.isArray(b) && b.length === 0
    && Array.isArray(c) && c.length === 0
    && Array.isArray(d) && d.length === 0);
}
{
  const names = MeetingsBrowseList._attendeeNames({ attendees: ['Eve', '[[Frank]]'] });
  ok('MBL-ATTENDEES-6 plain-string attendees pass through',
    names.length === 2 && names[0] === 'Eve' && names[1] === 'Frank');
}

{
  const dataArray = {
    *[Symbol.iterator]() { yield '[[Grace Hopper]]'; yield { path: 'spice/people/Linus.md' }; },
  };
  const names = MeetingsBrowseList._attendeeNames({ attendees: dataArray });
  ok('PERF5-DATAARRAY-ITERABLE accepts a non-Array Dataview iterable',
    names.length === 2 && names[0] === 'Grace Hopper' && names[1] === 'Linus');
}

{
  const chain = (items) => ({
    where(fn) { return chain(items.filter(fn)); },
    array() { return items.slice(); },
    [Symbol.iterator]: function* () { yield* items; },
  });
  const counts = MeetingsBrowseList._openTaskCountsBySource({
    pages: () => chain([
      { type: 'task', status: 'open', source: 'meeting', source_note: '[[Standup]]', file: { path: 'spice/tasks/meeting.md' } },
      { type: 'task', status: 'open', source: 'project', source_note: '[[Standup]]', file: { path: 'spice/tasks/project.md' } },
    ]),
  });
  ok('PERF5B-TASK-SOURCE-CORRELATION counts only canonical meeting-sourced tasks',
    counts.Standup === 1);
}

// PERF5-HUB-NPLUS1 — the compatibility hub performs exactly one task snapshot
// and correlates all meeting rows in memory. The underlying vault read seam is
// intentionally poisoned: any legacy per-row body read turns this fixture red.
{
  const pageQueries = [];
  let vaultReads = 0;
  let rendered = null;
  const chain = (items) => ({
    where(fn) { return chain(items.filter(fn)); },
    sort() { return chain(items); },
    array() { return items.slice(); },
    [Symbol.iterator]: function* () { yield* items; },
  });
  const meetings = [
    { file: { name: 'Alpha-2026-07-13', path: 'spice/meetings/notes/Alpha-2026-07-13.md' }, date: '2026-07-13 09:00', attendees: ['[[Ada Lovelace|Ada]]'] },
    { file: { name: 'Beta-2026-07-13', path: 'spice/meetings/notes/Beta-2026-07-13.md' }, date: '2026-07-13 10:00', attendees: { *[Symbol.iterator]() { yield '[[Bob]]'; } } },
  ];
  const tasks = [
    { type: 'task', status: 'open', source: 'meeting', source_note: '[[Alpha-2026-07-13]]', file: { path: 'spice/tasks/a.md' } },
    { type: 'task', status: 'open', source: 'project', source_note: '[[Alpha-2026-07-13]]', file: { path: 'spice/tasks/unrelated.md' } },
    { type: 'task', status: 'done', source: 'meeting', source_note: { path: 'spice/meetings/notes/Beta-2026-07-13.md' }, file: { path: 'spice/tasks/_done/b.md' } },
  ];
  const people = [
    { file: { name: 'Ada Lovelace', path: 'spice/people/Ada Lovelace.md' } },
    { file: { name: 'Bob', path: 'spice/people/Bob.md' } },
  ];
  const previous = { customJS: global.customJS, window: global.window, app: global.app, moment: global.moment };
  const momentFn = () => ({ format: () => '9:00 AM' });
  global.customJS = {
    RenderSafe: { page: () => ({ file: { name: 'Meetings-2026-07-13' } }) },
    BeaconCards: { render: async (_dv, opts) => { rendered = opts.pages; } },
    PeopleRendering: { renderChip() {} },
  };
  global.window = { customJS: global.customJS, moment: momentFn };
  global.moment = momentFn;
  global.app = { vault: { async read() { vaultReads += 1; throw new Error('per-row read'); } } };
  const dv = {
    pages(query) {
      pageQueries.push(query);
      if (query === '"spice/meetings/notes"') return chain(meetings);
      if (query === '"spice/tasks"') return chain(tasks);
      if (query === '"spice/people"') return chain(people);
      return chain([]);
    },
    current: () => null,
  };
  Promise.resolve(new MeetingsHubCards().render(dv)).then(() => {
    ok('PERF5-HUB-NPLUS1 renders two rows with zero per-meeting vault reads',
      vaultReads === 0 && Array.isArray(rendered) && rendered.length === 2);
    ok('PERF5-HUB-NPLUS1 uses one meeting, one task, and one people snapshot',
      pageQueries.filter((q) => q === '"spice/meetings/notes"').length === 1
      && pageQueries.filter((q) => q === '"spice/tasks"').length === 1
      && pageQueries.filter((q) => q === '"spice/people"').length === 1);
    ok('PERF5-HUB-NPLUS1 correlates open/done task-note counts by source_note',
      rendered[0].openTasks === 1 && rendered[1].doneTasks === 1);
    ok('PERF5B-ALIASED-PEOPLE-CORRELATION preserves link identity separately from display alias',
      JSON.stringify(rendered[0].attendees) === JSON.stringify(['Ada'])
      && JSON.stringify(rendered[0].peopleAttendeeLinks) === JSON.stringify(['[[Ada Lovelace|Ada]]']));

    const browseSrc = fs.readFileSync(path.join(ROOT, 'platform/blueprints/meetings/helpers/meetings-browse-list.js'), 'utf8');
    const hubSrc = fs.readFileSync(path.join(ROOT, 'platform/blueprints/meetings/helpers/meetings-hub-cards.js'), 'utf8');
    const iterableContract = (src) => /_iterableValues\(page\.attendees\)/.test(src) && /value\[Symbol\.iterator\]/.test(src);
    const boundedHubContract = (src) => /_taskCountsBySource\(dv\)/.test(src) && !/app\.vault\.read\s*\(/.test(src);
    const arrayOnlyMutant = browseSrc.replace("let list = MeetingsBrowseList._iterableValues(page.attendees);", "let list = Array.isArray(page.attendees) ? page.attendees : [];");
    const perRowReadMutant = hubSrc.replace('const attendeeEntries = MeetingsHubCards._attendeeEntries(p);', 'app.vault.read(p.file); const attendeeEntries = MeetingsHubCards._attendeeEntries(p);');
    ok('PERF5-REQUIREMENT-MUTANTS kills the Array-only attendee source mutant',
      iterableContract(browseSrc) && !iterableContract(arrayOnlyMutant));
    ok('PERF5-REQUIREMENT-MUTANTS kills the per-row vault-read source mutant',
      boundedHubContract(hubSrc) && !boundedHubContract(perRowReadMutant));

    global.customJS = previous.customJS;
    global.window = previous.window;
    global.app = previous.app;
    global.moment = previous.moment;
    const passed = results.filter(([, c]) => c).length;
    console.log(`\n${passed}/${results.length} passed`);
    process.exit(results.every(([, c]) => c) ? 0 : 1);
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
