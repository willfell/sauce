'use strict';
// Behavioral harness for the task-entity mechanism (TaskEntity customJS class).
//
// TaskEntity is the PURE core of the note-per-task model: every to-do task
// becomes its own tiny note under spice/tasks/ with `type: task` frontmatter,
// and surfaces live-query those notes. This class owns the deterministic
// filename derivation, the note composer, the frontmatter parser/normalizer,
// the today/overdue query, and payload validation. All methods are pure (no
// app/window/moment/Date.now/Math.random) so they are fully Node-testable.
//
// The file is a BARE class (no trailing statements) so the CustomJS loader
// (eval("(" + file + ")") + new()) can register it — we load it here the same
// way run-render-safe.js does, via new Function(src + "; return TaskEntity;").
const fs = require('fs');
const path = require('path');

let passes = 0, fails = 0;
function ok(name, fn) { try { fn(); console.log('ok ' + name); passes++; } catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); fails++; } }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

function loadClass(relPath, className) {
  const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
  return new Function(`${src}; return ${className};`)();
}
// customJS stores classes as INSTANCES (customJS.TaskEntity = new TaskEntity()),
// and cross-class consumers call customJS.TaskEntity.x(). Exercise the SAME
// instance-call form here so a regression to static-only methods (undefined on
// the instance) fails loudly.
const TaskEntityClass = loadClass('mechanisms/task-entity/task-entity.js', 'TaskEntity');
const TaskEntity = new TaskEntityClass();

// TaskDialog is the browser-side create/edit/done/delete dialog for a task note.
// Its static helpers (defaultsForSurface / trashPath / donePath) are PURE and
// Node-testable; the instance open() is browser-only and exercised in-vault. We
// load the class the same bare-class way (new Function(src + "; return X;")) and
// call the statics through an INSTANCE so a regression to instance-less statics
// (undefined on the stored customJS instance) fails loudly.
const TaskDialogClass = loadClass('mechanisms/task-entity/task-dialog.js', 'TaskDialog');
const TaskDialog = new TaskDialogClass();

// Fake moment-like object (deterministic — no wall clock).
const fixedMoment = {
  format: (f) =>
    f === 'YYYYMMDD' ? '20260701' :
    f === 'HHmmss' ? '142233' :
    f === 'YYYY-MM-DDTHH:mm:ssZ' ? '2026-07-01T14:22:33-06:00' :
    '2026-07-01',
};

// 1. taskFilename — human-readable "<title>.md" (no timestamp, no hash).
ok('TE-1 taskFilename is the readable "<title>.md"', () => {
  const fn = TaskEntity.taskFilename({ title: 'Buy milk' }, fixedMoment);
  assert(fn === 'Buy milk.md', 'readable filename: ' + fn);
  // Deterministic — same title → same base (dedupe is the caller's job).
  assert(TaskEntity.taskFilename({ title: 'Buy milk' }, fixedMoment) === 'Buy milk.md', 'stable');
});

// 1a. _sanitizeTitle — strip illegal chars, collapse ws, empty → "Task".
ok('TE-1a _sanitizeTitle strips illegal chars + handles empty', () => {
  assert(TaskEntity._sanitizeTitle('Go/through:mail?') === 'Gothroughmail', 'strips / : ?: ' + TaskEntity._sanitizeTitle('Go/through:mail?'));
  assert(TaskEntity._sanitizeTitle('Go through mail') === 'Go through mail', 'preserves case + spaces');
  assert(TaskEntity._sanitizeTitle('  a   b  ') === 'a b', 'collapses + trims whitespace');
  assert(TaskEntity._sanitizeTitle('') === 'Task', 'empty → Task');
  assert(TaskEntity._sanitizeTitle('///') === 'Task', 'all-illegal → Task');
  assert(TaskEntity._sanitizeTitle(null) === 'Task', 'null → Task');
  assert(TaskEntity._sanitizeTitle('a'.repeat(200)).length === 80, 'caps to ~80 chars');
});

// 1b. _uniqueName — free base returned as-is; collision → " 2", " 3", …
ok('TE-1b _uniqueName dedupes against the vault', () => {
  // Nothing exists → base returned unchanged.
  assert(TaskEntity._uniqueName('X.md', () => false) === 'X.md', 'free base returned');
  // "spice/tasks/X.md" taken → "X 2.md".
  assert(TaskEntity._uniqueName('X.md', (p) => p === 'spice/tasks/X.md') === 'X 2.md',
    'collision → X 2.md: ' + TaskEntity._uniqueName('X.md', (p) => p === 'spice/tasks/X.md'));
  // X.md AND X 2.md taken → X 3.md.
  const taken2 = (p) => p === 'spice/tasks/X.md' || p === 'spice/tasks/X 2.md';
  assert(TaskEntity._uniqueName('X.md', taken2) === 'X 3.md', 'two collisions → X 3.md');
});

// 2. composeNote — full payload → frontmatter with exact keys/values.
ok('TE-2 composeNote emits schema-exact frontmatter', () => {
  const out = TaskEntity.composeNote({
    title: 'Call X',
    scheduled: '2026-07-01',
    project: { name: 'Sauce', slug: 'sauce' },
    source: 'daily',
    now: '2026-07-01T10:00:00-06:00',
  });
  const fm = out.frontmatter;
  assert(fm.type === 'task', 'type');
  assert(fm.status === 'open', 'status defaults open');
  assert(fm.scheduled === '2026-07-01', 'scheduled');
  assert(fm.project === '[[Sauce]]', 'project wikilink');
  assert(fm.project_slug === 'sauce', 'project_slug');
  assert(fm.source === 'daily', 'source');
  assert(!!fm.created_at, 'created_at truthy');
  assert(fm.created_at === '2026-07-01T10:00:00-06:00', 'created_at from payload.now');
  assert(fm.due === '', 'absent due → empty string');
  assert(fm.completed_at === '', 'absent completed_at → empty string');
  assert(out.path === 'spice/tasks/Call X.md', 'path is readable "<title>.md": ' + out.path);
  // Body is now the CHROME body (SpaceNavButtons + TaskNoteView + marker), not empty.
  assert(out.body.includes('<!-- TASK_NOTES -->'), 'body has the TASK_NOTES marker');
  assert(out.body.includes('class: "SpaceNavButtons"'), 'body renders SpaceNavButtons nav');
  assert(out.body.includes('class: "TaskNoteView"'), 'body renders TaskNoteView card');
});

// 3. composeNote — minimal payload → blank scheduled, still valid.
ok('TE-3 composeNote minimal payload → blank scheduled + valid', () => {
  const out = TaskEntity.composeNote({ title: 'x' });
  assert(out.frontmatter.scheduled === '', 'absent scheduled → empty string');
  assert(TaskEntity.validatePayload({ title: 'x' }).valid === true, 'minimal payload valid');
});

// 4. parseNote — normalize a dataview page: missing status → open, blank date → null.
ok('TE-4 parseNote normalizes status + blank dates', () => {
  const parsed = TaskEntity.parseNote({ status: undefined, scheduled: '', title: 't', file: { path: 'spice/tasks/a.md' } });
  assert(parsed.status === 'open', 'missing status → open');
  assert(parsed.scheduled === null, 'blank scheduled → null');
  assert(parsed.title === 't', 'title preserved');
  assert(parsed.path === 'spice/tasks/a.md', 'path from file.path');
});

// 5. queryToday — partition open tasks into today / overdue; excludes done/future.
ok('TE-5 queryToday partitions today + overdue (open only)', () => {
  const res = TaskEntity.queryToday([
    { scheduled: '2026-07-01', status: 'open' },
    { scheduled: '2026-06-30', status: 'open' },
    { scheduled: '2026-07-02', status: 'open' },
    { scheduled: '2026-07-01', status: 'done' },
  ], '2026-07-01');
  assert(res.today.length === 1, 'today = the single open 07-01: got ' + res.today.length);
  assert(res.overdue.length === 1, 'overdue = the open 06-30: got ' + res.overdue.length);
});

// 6. validatePayload — title required; date format enforced.
ok('TE-6 validatePayload requires title + validates date shape', () => {
  assert(TaskEntity.validatePayload({ title: '' }).valid === false, 'empty title invalid');
  assert(TaskEntity.validatePayload({ title: 'ok' }).valid === true, 'non-empty title valid');
  assert(TaskEntity.validatePayload({ title: 'ok', scheduled: '2026-7-1' }).valid === false, 'bad scheduled shape invalid');
  assert(TaskEntity.validatePayload({ title: 'ok', due: 'nope' }).valid === false, 'bad due shape invalid');
  assert(TaskEntity.validatePayload({ title: 'ok', scheduled: '2026-07-01', due: '2026-06-30' }).valid === true, 'good dates valid');
});

function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ---------- TaskDialog static helpers (pure) ----------

// TD-1. defaultsForSurface daily → { scheduled: today, source: "daily" }.
ok('TD-1 defaultsForSurface daily seeds scheduled + source', () => {
  const d = TaskDialog.defaultsForSurface({ surface: 'daily', today: '2026-07-01' });
  assert(deepEq(d, { scheduled: '2026-07-01', source: 'daily' }), 'got ' + JSON.stringify(d));
});

// TD-2. defaultsForSurface project → { project, source: "project" }, no scheduled.
ok('TD-2 defaultsForSurface project seeds project + source (no scheduled)', () => {
  const d = TaskDialog.defaultsForSurface({ surface: 'project', project: { name: 'Sauce', slug: 'sauce' } });
  assert(deepEq(d, { project: { name: 'Sauce', slug: 'sauce' }, source: 'project' }), 'got ' + JSON.stringify(d));
});

// TD-3. defaultsForSurface meeting → source meeting + source_note + project.
ok('TD-3 defaultsForSurface meeting seeds source_note + project + source', () => {
  const d = TaskDialog.defaultsForSurface({ surface: 'meeting', sourceNote: '[[M]]', project: { name: 'P', slug: 'p' } });
  assert(d.source === 'meeting', 'source meeting: ' + d.source);
  assert(d.source_note === '[[M]]', 'source_note: ' + d.source_note);
  assert(deepEq(d.project, { name: 'P', slug: 'p' }), 'project: ' + JSON.stringify(d.project));
});

// TD-4. trashPath rewrites spice/tasks/ prefix → spice/tasks/_trash/.
ok('TD-4 trashPath rewrites prefix into _trash', () => {
  assert(TaskDialog.trashPath('spice/tasks/task-a.md') === 'spice/tasks/_trash/task-a.md',
    'got ' + TaskDialog.trashPath('spice/tasks/task-a.md'));
});

// TD-5. donePath rewrites spice/tasks/ prefix → spice/tasks/_done/.
ok('TD-5 donePath rewrites prefix into _done', () => {
  assert(TaskDialog.donePath('spice/tasks/task-a.md') === 'spice/tasks/_done/task-a.md',
    'got ' + TaskDialog.donePath('spice/tasks/task-a.md'));
});

// TD-6. _bodyNotesBelowMarker returns only the user-notes portion (below marker).
ok('TD-6 _bodyNotesBelowMarker extracts notes below the marker', () => {
  const fileText = [
    '---', 'type: task', 'title: X', '---', '',
    '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });', '```',
    '', '<!-- TASK_NOTES -->', 'my note line 1', 'my note line 2', '',
  ].join('\n');
  const notes = TaskDialog._bodyNotesBelowMarker(fileText);
  assert(notes === 'my note line 1\nmy note line 2', 'notes below marker: ' + JSON.stringify(notes));
  // No marker (legacy) → whole body minus frontmatter.
  const legacy = '---\ntype: task\ntitle: X\n---\nraw legacy note\n';
  assert(TaskDialog._bodyNotesBelowMarker(legacy) === 'raw legacy note\n',
    'legacy fallback: ' + JSON.stringify(TaskDialog._bodyNotesBelowMarker(legacy)));
});

// TD-7. _replaceBody preserves chrome + marker, swaps only the notes below it.
ok('TD-7 _replaceBody preserves marker + chrome, swaps notes', () => {
  const fileText = [
    '---', 'type: task', 'title: X', '---', '',
    '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });', '```',
    '', '<!-- TASK_NOTES -->', 'OLD NOTE', '',
  ].join('\n');
  const out = TaskDialog._replaceBody(fileText, 'NEW NOTE');
  assert(out.includes('<!-- TASK_NOTES -->'), 'marker preserved');
  assert(out.includes('class: "SpaceNavButtons"'), 'chrome preserved');
  assert(out.includes('type: task'), 'frontmatter preserved');
  assert(out.includes('NEW NOTE') && !out.includes('OLD NOTE'), 'notes swapped');
  // Notes sit AFTER the marker.
  assert(out.indexOf('NEW NOTE') > out.indexOf('<!-- TASK_NOTES -->'), 'notes below marker');
  // Clearing notes leaves just the chrome+marker (marker still present).
  const cleared = TaskDialog._replaceBody(fileText, '');
  assert(cleared.includes('<!-- TASK_NOTES -->') && !cleared.includes('OLD NOTE'), 'cleared notes');
});

// TD-8. _replaceBody on a legacy (no-marker) note re-injects chrome + marker.
ok('TD-8 _replaceBody un-bares a legacy note (injects chrome + marker)', () => {
  const legacy = '---\ntype: task\ntitle: X\n---\nsome old body\n';
  const out = TaskDialog._replaceBody(legacy, 'kept note');
  assert(out.includes('<!-- TASK_NOTES -->'), 'marker injected');
  assert(out.includes('class: "TaskNoteView"'), 'chrome injected');
  assert(out.includes('type: task'), 'frontmatter preserved');
  assert(out.includes('kept note') && out.indexOf('kept note') > out.indexOf('<!-- TASK_NOTES -->'),
    'notes below the injected marker');
});

// ---------- TaskDialog link-inserter static helpers (pure) ----------
//
// The edit/create dialog can insert a note-link ([[wikilink]]) or a web link
// ([label](url) / <url>) into the Notes textarea. The markdown-building and
// cursor-splice logic is factored into three PURE statics so the browser UI is
// a thin shell over Node-testable helpers. Called through an INSTANCE (customJS
// stores instances) so a regression to instance-less statics fails loudly.

// TD-9. _wikilink wraps a note basename; empty/nullish → "".
ok('TD-9 _wikilink wraps a basename (trims; empty → "")', () => {
  assert(TaskDialog._wikilink('Note A') === '[[Note A]]', 'got ' + TaskDialog._wikilink('Note A'));
  assert(TaskDialog._wikilink('  Trimmed  ') === '[[Trimmed]]', 'trims: ' + TaskDialog._wikilink('  Trimmed  '));
  assert(TaskDialog._wikilink('') === '', 'empty → ""');
  assert(TaskDialog._wikilink(null) === '', 'null → ""');
  assert(TaskDialog._wikilink(undefined) === '', 'undefined → ""');
  assert(TaskDialog._wikilink('   ') === '', 'all-whitespace → ""');
});

// TD-10. _mdLink builds a markdown link; label optional; no url → "".
ok('TD-10 _mdLink builds [label](url) / <url> / "" per inputs', () => {
  assert(TaskDialog._mdLink('site', 'https://x.com') === '[site](https://x.com)', 'labelled: ' + TaskDialog._mdLink('site', 'https://x.com'));
  assert(TaskDialog._mdLink('', 'https://x.com') === '<https://x.com>', 'no label → autolink: ' + TaskDialog._mdLink('', 'https://x.com'));
  assert(TaskDialog._mdLink('   ', 'https://x.com') === '<https://x.com>', 'blank label → autolink');
  assert(TaskDialog._mdLink('site', '') === '', 'no url → ""');
  assert(TaskDialog._mdLink('', '') === '', 'nothing → ""');
  assert(TaskDialog._mdLink(null, null) === '', 'null/null → ""');
  assert(TaskDialog._mdLink('  Docs  ', '  https://x.com  ') === '[Docs](https://x.com)', 'trims both');
});

// TD-11. _insertAt splices insertion into text at [start,end); invalid → append.
ok('TD-11 _insertAt splices at selection; invalid range → append', () => {
  assert(TaskDialog._insertAt('ab', 'X', 1, 1) === 'aXb', 'insert at caret: ' + TaskDialog._insertAt('ab', 'X', 1, 1));
  assert(TaskDialog._insertAt('abcd', 'X', 1, 3) === 'aXd', 'replaces selection: ' + TaskDialog._insertAt('abcd', 'X', 1, 3));
  assert(TaskDialog._insertAt('', 'X', 0, 0) === 'X', 'empty text → just insertion');
  // Invalid range (null / NaN / out of range) → append with a leading space when
  // text is non-empty and doesn't already end in whitespace.
  assert(TaskDialog._insertAt('ab', 'X', null, null) === 'ab X', 'null range → space-append: ' + TaskDialog._insertAt('ab', 'X', null, null));
  assert(TaskDialog._insertAt('ab', 'X', NaN, NaN) === 'ab X', 'NaN range → space-append');
  assert(TaskDialog._insertAt('ab', 'X', 9, 9) === 'ab X', 'out-of-range → space-append');
  assert(TaskDialog._insertAt('ab ', 'X', null, null) === 'ab X', 'trailing space kept, no double: ' + TaskDialog._insertAt('ab ', 'X', null, null));
  assert(TaskDialog._insertAt('', 'X', null, null) === 'X', 'empty text append → just insertion (no leading space)');
});

// ---------- TaskTodayList static helpers (pure) ----------

// TaskTodayList is the daily live-query widget. Its render() is browser-only
// (exercised in-vault), but buildBands is a PURE partition helper mirroring
// TaskEntity.queryToday: open-only, today = scheduled === todayStr, overdue =
// scheduled < todayStr. We load it the same bare-class way and call the static
// through an INSTANCE so a regression to instance-less statics fails loudly.
const TaskTodayListClass = loadClass('mechanisms/task-entity/task-today-list.js', 'TaskTodayList');
const TaskTodayList = new TaskTodayListClass();

// ---------- TaskNoteView static helper (pure) ----------
//
// TaskNoteView is the clean task-note card rendered in a task note's body. Its
// render() is browser-only, but _fieldRows is a PURE helper that returns the
// metadata rows to draw (SET fields only), so it's Node-testable. We load the
// class the same bare-class way and call the static through an INSTANCE so a
// regression to instance-less statics fails loudly.
const TaskNoteViewClass = loadClass('mechanisms/task-entity/task-note-view.js', 'TaskNoteView');
const TaskNoteView = new TaskNoteViewClass();

// TNV-1. _fieldRows includes only set fields; strips project wikilink brackets.
ok('TNV-1 _fieldRows returns only set fields (project unwrapped)', () => {
  const rows = TaskNoteView._fieldRows({
    scheduled: '2026-07-01', due: '', priority: 'high', project: '[[Sauce]]',
  });
  const byLabel = {};
  for (const r of rows) byLabel[r.label] = r.value;
  assert(rows.length === 3, 'only 3 set fields (no due): got ' + rows.length);
  assert(byLabel.Scheduled === '2026-07-01', 'scheduled row');
  assert(byLabel.Priority === 'high', 'priority row');
  assert(byLabel.Project === 'Sauce', 'project unwrapped: ' + byLabel.Project);
  assert(!('Due' in byLabel), 'empty due omitted');
});

// TNV-2. _fieldRows tolerates a null / empty task (never throws → []).
ok('TNV-2 _fieldRows tolerates null / empty task', () => {
  assert(TaskNoteView._fieldRows(null).length === 0, 'null → []');
  assert(TaskNoteView._fieldRows({}).length === 0, 'empty → []');
});

// TNV-3. _humanDate formats a YYYY-MM-DD into "Ddd, Mon D, YYYY" (pure, no wall clock).
// Weekdays VERIFIED via `node -e "new Date('<d>T00:00:00Z').toUTCString()"`:
//   2026-07-02 = Thu, 2026-07-03 = Fri, 2026-06-29 = Mon, 2026-07-10 = Fri,
//   2024-02-29 = Thu (leap-year), 2026-12-25 = Fri.
ok('TNV-3 _humanDate formats text with the REAL weekday', () => {
  assert(TaskNoteView._humanDate('2026-07-02', '2026-07-02').text === 'Thu, Jul 2, 2026',
    'got ' + TaskNoteView._humanDate('2026-07-02', '2026-07-02').text);
  assert(TaskNoteView._humanDate('2026-07-10', '2026-07-02').text === 'Fri, Jul 10, 2026',
    'got ' + TaskNoteView._humanDate('2026-07-10', '2026-07-02').text);
  assert(TaskNoteView._humanDate('2024-02-29', '2026-07-02').text === 'Thu, Feb 29, 2024',
    'leap-year weekday: ' + TaskNoteView._humanDate('2024-02-29', '2026-07-02').text);
  assert(TaskNoteView._humanDate('2026-12-25', '2026-07-02').text === 'Fri, Dec 25, 2026',
    'got ' + TaskNoteView._humanDate('2026-12-25', '2026-07-02').text);
});

// TNV-4. _humanDate relative hint is computed from todayStr (pure date math).
ok('TNV-4 _humanDate relative hint (Today/Tomorrow/Yesterday/in N/N ago)', () => {
  assert(TaskNoteView._humanDate('2026-07-02', '2026-07-02').relative === 'Today',
    'same day → Today: ' + TaskNoteView._humanDate('2026-07-02', '2026-07-02').relative);
  assert(TaskNoteView._humanDate('2026-07-03', '2026-07-02').relative === 'Tomorrow',
    '+1 → Tomorrow: ' + TaskNoteView._humanDate('2026-07-03', '2026-07-02').relative);
  assert(TaskNoteView._humanDate('2026-07-01', '2026-07-02').relative === 'Yesterday',
    '-1 → Yesterday: ' + TaskNoteView._humanDate('2026-07-01', '2026-07-02').relative);
  assert(TaskNoteView._humanDate('2026-06-29', '2026-07-02').relative === '3 days ago',
    '-3 → 3 days ago: ' + TaskNoteView._humanDate('2026-06-29', '2026-07-02').relative);
  assert(TaskNoteView._humanDate('2026-07-10', '2026-07-02').relative === 'in 8 days',
    '+8 → in 8 days: ' + TaskNoteView._humanDate('2026-07-10', '2026-07-02').relative);
  // Cross-month / cross-year deltas still count real calendar days.
  assert(TaskNoteView._humanDate('2026-08-01', '2026-07-02').relative === 'in 30 days',
    'cross-month +30: ' + TaskNoteView._humanDate('2026-08-01', '2026-07-02').relative);
});

// TNV-5. _humanDate tolerates ISO / Luxon-ish / blank input (never throws).
ok('TNV-5 _humanDate coerces ISO + tolerates blank/null', () => {
  // Full ISO timestamp (what Dataview would surface raw) → coerced to the date.
  const iso = TaskNoteView._humanDate('2026-07-02T00:00:00.000-06:00', '2026-07-02');
  assert(iso.text === 'Thu, Jul 2, 2026', 'ISO coerced to date text: ' + iso.text);
  assert(iso.relative === 'Today', 'ISO coerced relative: ' + iso.relative);
  // Blank / null → empty text + empty relative, no throw.
  assert(TaskNoteView._humanDate('', '2026-07-02').text === '', 'blank → empty text');
  assert(TaskNoteView._humanDate(null, '2026-07-02').relative === '', 'null → empty relative');
  // No todayStr → text still formats, relative blank (can't compute).
  assert(TaskNoteView._humanDate('2026-07-02').text === 'Thu, Jul 2, 2026', 'text without todayStr');
  assert(TaskNoteView._humanDate('2026-07-02').relative === '', 'relative blank without todayStr');
});

// TNV-6. _priorityMeta maps a priority to { label, color }; unset → null.
ok('TNV-6 _priorityMeta returns capitalized label + color (unset → null)', () => {
  assert(TaskNoteView._priorityMeta('high').label === 'High', 'high label: ' + JSON.stringify(TaskNoteView._priorityMeta('high')));
  assert(typeof TaskNoteView._priorityMeta('high').color === 'string' && TaskNoteView._priorityMeta('high').color.length > 0, 'high has a color');
  assert(TaskNoteView._priorityMeta('highest').label === 'Highest', 'highest label');
  assert(TaskNoteView._priorityMeta('medium').label === 'Medium', 'medium label');
  assert(TaskNoteView._priorityMeta('low').label === 'Low', 'low label');
  assert(TaskNoteView._priorityMeta('') === null, 'empty → null');
  assert(TaskNoteView._priorityMeta(null) === null, 'null → null');
  assert(TaskNoteView._priorityMeta('  ') === null, 'whitespace → null');
  // Unknown priority is tolerated (capitalized passthrough, non-empty color).
  const weird = TaskNoteView._priorityMeta('urgent');
  assert(weird && weird.label === 'Urgent', 'unknown → capitalized: ' + JSON.stringify(weird));
});

// TTL-1. buildBands partitions parsed tasks into today / overdue (open only).
ok('TTL-1 buildBands partitions today + overdue (open only)', () => {
  const res = TaskTodayList.buildBands([
    { scheduled: '2026-07-01', status: 'open' },
    { scheduled: '2026-06-29', status: 'open' },
    { scheduled: '2026-07-01', status: 'done' },
  ], '2026-07-01');
  assert(res.today.length === 1, 'today = the single open 07-01: got ' + res.today.length);
  assert(res.overdue.length === 1, 'overdue = the open 06-29: got ' + res.overdue.length);
});

// TTL-2. buildBands excludes future-scheduled + unscheduled open tasks.
ok('TTL-2 buildBands excludes future + unscheduled open tasks', () => {
  const res = TaskTodayList.buildBands([
    { scheduled: '2026-07-02', status: 'open' },  // future → neither
    { scheduled: '', status: 'open' },            // unscheduled → neither
    { scheduled: null, status: 'open' },          // unscheduled → neither
  ], '2026-07-01');
  assert(res.today.length === 0, 'no today: got ' + res.today.length);
  assert(res.overdue.length === 0, 'no overdue: got ' + res.overdue.length);
});

// TTL-3. buildBands tolerates a null/undefined list (never throws).
ok('TTL-3 buildBands tolerates non-array input', () => {
  const res = TaskTodayList.buildBands(null, '2026-07-01');
  assert(Array.isArray(res.today) && res.today.length === 0, 'today empty array');
  assert(Array.isArray(res.overdue) && res.overdue.length === 0, 'overdue empty array');
});

// ---------- Dataview DateTime coercion (FIX 1 — tasks-don't-render bug) ----------
//
// Dataview parses an UNQUOTED frontmatter date (`scheduled: 2026-07-01`) into a
// Luxon DateTime object, NOT a string. If parseNote kept that object, buildBands
// / queryToday compare a DateTime against a STRING (`sched === todayStr`) which is
// never true, so EVERY scheduled task falls into neither band and the daily list
// renders empty. TaskEntity._toDateStr normalizes any date-ish value to
// "YYYY-MM-DD" (or null) on READ, so parseNote always yields comparable strings.
const luxon = (iso) => ({ toISODate: () => iso });

// DT-1. _toDateStr normalizes Luxon / string / blank / null / DateTime-format.
ok('DT-1 _toDateStr coerces date-ish values to YYYY-MM-DD strings', () => {
  assert(TaskEntity._toDateStr(luxon('2026-07-01')) === '2026-07-01', 'luxon → string');
  assert(TaskEntity._toDateStr('2026-07-01T00:00:00') === '2026-07-01', 'ISO datetime → date');
  assert(TaskEntity._toDateStr('') === null, 'blank string → null');
  assert(TaskEntity._toDateStr(null) === null, 'null → null');
  assert(TaskEntity._toDateStr({ toFormat: () => '2026-07-01' }) === '2026-07-01', 'toFormat → string');
});

// DT-2. parseNote coerces a Luxon `scheduled` into a plain string (was a DateTime).
ok('DT-2 parseNote coerces Luxon scheduled → string', () => {
  const parsed = TaskEntity.parseNote({
    type: 'task', status: 'open',
    scheduled: luxon('2026-07-01'), due: '',
    file: { path: 'spice/tasks/a.md' },
  });
  assert(parsed.scheduled === '2026-07-01', 'scheduled is the string, not a DateTime: got ' + JSON.stringify(parsed.scheduled));
  assert(parsed.due === null, 'blank due → null');
});

// DT-3. THE REPRO — Luxon-scheduled open tasks must land in a band, not vanish.
ok('DT-3 buildBands partitions Luxon-scheduled tasks (the render bug)', () => {
  const tasks = [
    TaskEntity.parseNote({ status: 'open', scheduled: luxon('2026-07-01') }),
    TaskEntity.parseNote({ status: 'open', scheduled: luxon('2026-06-28') }),
  ];
  const res = TaskTodayList.buildBands(tasks, '2026-07-01');
  assert(res.today.length === 1, 'today = the 07-01 Luxon task: got ' + res.today.length);
  assert(res.overdue.length === 1, 'overdue = the 06-28 Luxon task: got ' + res.overdue.length);
});

console.log(`\nrun-task-entity: ${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
