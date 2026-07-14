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

const passed = results.filter(([, c]) => c).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
