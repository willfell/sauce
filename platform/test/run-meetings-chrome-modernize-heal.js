#!/usr/bin/env node
'use strict';

// run-meetings-chrome-modernize-heal.js — unit harness for the meetings
// chrome-modernize install heal. Drives the PURE string transform
// _modernizeMeetingBody (exported by install.js) against synthetic meeting
// note bodies. Asserts: Agenda fold into Notes, Action-Items removal, Tasks
// preserved, idempotence, and no-op on a modern body. Prints "N passed, M
// failed"; exits 0 iff M === 0.

const install = require('../install.js');
const _modernizeMeetingBody = install._modernizeMeetingBody;

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

if (typeof _modernizeMeetingBody !== 'function') {
  console.log('  FAIL LOAD: _modernizeMeetingBody not found');
  console.log('0 passed, 1 failed');
  process.exit(1);
}

const V = 'ranch/views';
const label = (text, extra) =>
  '```dataviewjs\n' +
  `await dv.view("${V}/customjs-guard", { class: "SectionLabel", args: [{ text: "${text}"${extra ? ', ' + extra : ''} }] });\n` +
  '```';
const taskList =
  '```dataviewjs\n' +
  `await dv.view("${V}/customjs-guard", { class: "TaskMeetingList" });\n` +
  '```';

// ---- 1 + 2 + 3: legacy body with Agenda seed, Action Items marker, Notes, Tasks ----
{
  const before = [
    label('Attendees', 'top: true'),
    '',
    label('Agenda'),
    '',
    '- Discuss roadmap',
    '',
    label('Notes'),
    '',
    '-',
    '',
    label('Action Items'),
    '',
    '<!-- ACTION_ITEMS_MARKER -->',
    '',
    label('Tasks'),
    '',
    taskList,
    '',
  ].join('\n');

  const after = _modernizeMeetingBody(before);

  ok('MCM-1a: Agenda SectionLabel fence removed',
    !/text:\s*"Agenda"/.test(after), after);
  const notesIdx = after.indexOf('"Notes"');
  const roadmapIdx = after.indexOf('Discuss roadmap');
  ok('MCM-1b: Agenda seed folded after Notes',
    roadmapIdx > -1 && notesIdx > -1 && roadmapIdx > notesIdx, after);

  ok('MCM-2a: Action Items SectionLabel fence removed',
    !/text:\s*"Action Items"/.test(after), after);
  ok('MCM-2b: dead ACTION_ITEMS_MARKER removed',
    !/ACTION_ITEMS_MARKER/.test(after), after);

  const taskCount = (after.match(/class:\s*"TaskMeetingList"/g) || []).length;
  ok('MCM-3: TaskMeetingList preserved exactly once', taskCount === 1,
    `count=${taskCount}\n${after}`);

  // ---- 4: idempotent ----
  const again = _modernizeMeetingBody(after);
  ok('MCM-4: idempotent — second pass is a no-op', again === after, again);
}

// ---- 5: modern body (no Agenda / Action Items) returned unchanged ----
{
  const modern = [
    label('Attendees', 'top: true'),
    '',
    label('Notes'),
    '',
    '-',
    '',
    label('Tasks'),
    '',
    taskList,
    '',
  ].join('\n');
  const after = _modernizeMeetingBody(modern);
  ok('MCM-5: modern body unchanged', after === modern, after);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
