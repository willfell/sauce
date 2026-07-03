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
  // FIX 5 — links is always present as an array (empty when none provided).
  assert(Array.isArray(fm.links), 'links is an array');
  assert(fm.links.length === 0, 'absent links → empty array');
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

// 3a. composeNote — provided links[] flow through to the frontmatter (FIX 5).
ok('TE-3a composeNote carries a provided links[] onto the frontmatter', () => {
  const out = TaskEntity.composeNote({ title: 'x', links: ['[[Retro Notes]]', '[Scalr run](https://scalr.io/r/1)'] });
  assert(Array.isArray(out.frontmatter.links), 'links is an array');
  assert(out.frontmatter.links.length === 2, 'two links carried: ' + out.frontmatter.links.length);
  assert(out.frontmatter.links[0] === '[[Retro Notes]]', 'note link preserved');
  assert(out.frontmatter.links[1] === '[Scalr run](https://scalr.io/r/1)', 'web link preserved');
  // Non-array / nullish links → normalized to [].
  assert(Array.isArray(TaskEntity.composeNote({ title: 'x', links: null }).frontmatter.links), 'null links → []');
  assert(TaskEntity.composeNote({ title: 'x', links: 'nope' }).frontmatter.links.length === 0, 'string links → []');
  // Blank/nullish entries are dropped; strings are trimmed.
  const cleaned = TaskEntity.composeNote({ title: 'x', links: ['  [[A]]  ', '', null, '[b](u)'] }).frontmatter.links;
  assert(cleaned.length === 2 && cleaned[0] === '[[A]]' && cleaned[1] === '[b](u)', 'trims + drops blanks: ' + JSON.stringify(cleaned));
});

// 3b. renderNote serializes links[] as a YAML flow array that round-trips (FIX 5).
ok('TE-3b renderNote emits links as a YAML flow array (round-trips)', () => {
  const out = TaskEntity.composeNote({ title: 'x', links: ['[[Retro Notes]]', '[Scalr run](https://scalr.io/r/1)'] });
  const text = TaskDialog.renderNote(out.frontmatter, out.body);
  // The links line is a bracketed flow array with quoted, escaped entries.
  const m = /\nlinks: (\[.*\])\n/.exec(text);
  assert(m, 'links flow-array line present: ' + JSON.stringify(text.split('\n').filter((l) => l.indexOf('links') === 0)));
  const parsed = JSON.parse(m[1]);
  assert(Array.isArray(parsed) && parsed.length === 2, 'round-trips to a 2-element array: ' + m[1]);
  assert(parsed[0] === '[[Retro Notes]]', 'note link round-trips: ' + parsed[0]);
  assert(parsed[1] === '[Scalr run](https://scalr.io/r/1)', 'web link round-trips: ' + parsed[1]);
  // Empty links → an empty flow array `[]` (not omitted, not a bare key).
  const empty = TaskDialog.renderNote(TaskEntity.composeNote({ title: 'x' }).frontmatter, '');
  assert(/\nlinks: \[\]\n/.test(empty), 'empty links → `links: []`: ' + empty.split('\n').filter((l) => l.indexOf('links') === 0)[0]);
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

// ---------- TaskDialog link-chip pure helpers (FIX 5) ----------
//
// The dialog's ＋Link note / ＋Web link buttons now PUSH a markdown link STRING
// onto state.links (rendered as removable chips), instead of splicing into the
// Notes textarea. The add/remove logic is factored into two PURE statics so the
// browser chip UI is a thin shell. Called through an INSTANCE so a regression to
// instance-less statics fails loudly.

// TD-12. _addLink appends a trimmed, non-empty, DEDUPED entry (returns a new array).
ok('TD-12 _addLink appends a trimmed non-empty deduped entry', () => {
  assert(deepEq(TaskDialog._addLink([], '[[A]]'), ['[[A]]']), 'first add: ' + JSON.stringify(TaskDialog._addLink([], '[[A]]')));
  assert(deepEq(TaskDialog._addLink(['[[A]]'], '  [b](u)  '), ['[[A]]', '[b](u)']), 'trims + appends');
  // Duplicate entry is a no-op (kept unique).
  assert(deepEq(TaskDialog._addLink(['[[A]]'], '[[A]]'), ['[[A]]']), 'dup ignored');
  // Empty / nullish entry is a no-op.
  assert(deepEq(TaskDialog._addLink(['[[A]]'], ''), ['[[A]]']), 'empty ignored');
  assert(deepEq(TaskDialog._addLink(['[[A]]'], null), ['[[A]]']), 'null ignored');
  assert(deepEq(TaskDialog._addLink(['[[A]]'], '   '), ['[[A]]']), 'whitespace ignored');
  // Non-array base → treated as [].
  assert(deepEq(TaskDialog._addLink(null, '[[A]]'), ['[[A]]']), 'null base → [entry]');
  // Purity — the input array is not mutated.
  const base = ['[[A]]'];
  TaskDialog._addLink(base, '[b](u)');
  assert(base.length === 1, 'input array not mutated');
});

// TD-13. _removeLink drops the entry at index i (returns a new array; oob → clone).
ok('TD-13 _removeLink drops index i (out-of-range → unchanged clone)', () => {
  assert(deepEq(TaskDialog._removeLink(['a', 'b', 'c'], 1), ['a', 'c']), 'drops middle');
  assert(deepEq(TaskDialog._removeLink(['a', 'b'], 0), ['b']), 'drops first');
  assert(deepEq(TaskDialog._removeLink(['a', 'b'], 5), ['a', 'b']), 'oob → unchanged');
  assert(deepEq(TaskDialog._removeLink(['a', 'b'], -1), ['a', 'b']), 'negative → unchanged');
  assert(deepEq(TaskDialog._removeLink(null, 0), []), 'null base → []');
  // Purity — input not mutated.
  const base = ['a', 'b'];
  TaskDialog._removeLink(base, 0);
  assert(base.length === 2, 'input array not mutated');
});

// TD-14. _payloadFromState carries state.links onto the payload (FIX 5).
ok('TD-14 _payloadFromState includes state.links', () => {
  const p = TaskDialog._payloadFromState({ title: 't', links: ['[[A]]', '[b](u)'] });
  assert(Array.isArray(p.links) && p.links.length === 2, 'links on payload: ' + JSON.stringify(p.links));
  assert(p.links[0] === '[[A]]' && p.links[1] === '[b](u)', 'link entries preserved');
  // Missing state.links → an empty array on the payload (never undefined).
  const p2 = TaskDialog._payloadFromState({ title: 't' });
  assert(Array.isArray(p2.links) && p2.links.length === 0, 'missing links → []');
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

// TNV-7. _linkEntries returns renderable markdown strings for the LINKS section
// (FIX 5). Coerces each frontmatter entry to a markdown string: a string as-is,
// a Dataview Link object → `[[basename]]`. Drops blanks; null/empty task → [].
ok('TNV-7 _linkEntries coerces links[] to renderable markdown strings', () => {
  // Plain string entries (note link + web link) pass through, trimmed.
  const rows = TaskNoteView._linkEntries({ links: ['  [[Retro Notes]]  ', '[Scalr run](https://scalr.io/r/1)'] });
  assert(rows.length === 2, 'two entries: ' + JSON.stringify(rows));
  assert(rows[0] === '[[Retro Notes]]', 'note link trimmed passthrough: ' + rows[0]);
  assert(rows[1] === '[Scalr run](https://scalr.io/r/1)', 'web link passthrough');
  // A Dataview Link object → `[[basename]]`.
  const objRows = TaskNoteView._linkEntries({ links: [{ path: 'a/b/Retro Notes.md', display: 'Retro Notes' }] });
  assert(objRows.length === 1 && objRows[0] === '[[Retro Notes]]', 'Link object → [[basename]]: ' + JSON.stringify(objRows));
  // Blank / nullish entries are dropped.
  const mixed = TaskNoteView._linkEntries({ links: ['[[A]]', '', null, '   ', '[b](u)'] });
  assert(mixed.length === 2 && mixed[0] === '[[A]]' && mixed[1] === '[b](u)', 'drops blanks: ' + JSON.stringify(mixed));
  // Null / empty / non-array links → [].
  assert(TaskNoteView._linkEntries(null).length === 0, 'null task → []');
  assert(TaskNoteView._linkEntries({}).length === 0, 'no links → []');
  assert(TaskNoteView._linkEntries({ links: 'nope' }).length === 0, 'non-array links → []');
  // A single object that already looks like a bare wikilink target string stays a wikilink.
  assert(deepEq(TaskNoteView._linkEntries({ links: ['[[a/b/Baz.md|Baz]]'] }), ['[[a/b/Baz.md|Baz]]']), 'wikilink string kept verbatim');
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

// TTL-4. buildBands EXCLUDES tasks that belong elsewhere (FIX 1 — dedup): a task
// with a project_slug renders in its Project section, and a meeting-sourced task
// renders in Meeting Tasks — so neither may ALSO show in the Today/Overdue bands
// (that duplicate was the bug). Today/Overdue = open, scheduled, NO project, NOT
// meeting-sourced (personal daily tasks only).
ok('TTL-4 buildBands excludes project-connected + meeting-sourced tasks (dedup)', () => {
  const res = TaskTodayList.buildBands([
    // Scheduled today, but has a project → shown in its Project section, NOT today.
    { scheduled: '2026-07-01', status: 'open', project_slug: 'sauce', source: 'daily' },
    // Scheduled today, meeting-sourced → shown in Meeting Tasks, NOT today.
    { scheduled: '2026-07-01', status: 'open', project_slug: '', source: 'meeting' },
    // Plain scheduled-today personal task (no project, source daily) → IN today.
    { scheduled: '2026-07-01', status: 'open', project_slug: '', source: 'daily' },
    // Overdue but has a project → excluded from overdue too.
    { scheduled: '2026-06-30', status: 'open', project_slug: 'sauce', source: 'daily' },
    // Overdue meeting-sourced → excluded from overdue too.
    { scheduled: '2026-06-30', status: 'open', project_slug: '', source: 'meeting' },
    // Plain overdue personal task → IN overdue.
    { scheduled: '2026-06-29', status: 'open', project_slug: '', source: 'daily' },
  ], '2026-07-01');
  assert(res.today.length === 1, 'today = the single plain personal 07-01: got ' + res.today.length);
  assert(res.today[0].scheduled === '2026-07-01' && !res.today[0].project_slug && res.today[0].source !== 'meeting',
    'today band holds only the personal daily task');
  assert(res.overdue.length === 1, 'overdue = the single plain personal 06-29: got ' + res.overdue.length);
  assert(res.overdue[0].scheduled === '2026-06-29' && !res.overdue[0].project_slug && res.overdue[0].source !== 'meeting',
    'overdue band holds only the personal daily task');
  // A whitespace-only project_slug is treated as "no project" (still shown in today).
  const ws = TaskTodayList.buildBands([
    { scheduled: '2026-07-01', status: 'open', project_slug: '   ', source: 'daily' },
  ], '2026-07-01');
  assert(ws.today.length === 1, 'whitespace-only project_slug → still a personal task: got ' + ws.today.length);
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

// ---------- Dataview Link coercion (source_note / project filter fix) ----------
//
// Dataview surfaces a `[[Meeting]]` frontmatter value as a Link OBJECT (with
// .path / .display / .subpath), NOT a string — so a meeting/project task-list
// filter comparing `page.source_note === meetingBasename` never matches.
// TaskEntity._linkText normalizes any Link shape to a comparable BASENAME string.

// LT-1. _linkText coerces a Dataview Link object → the note basename.
ok('LT-1 _linkText coerces a Dataview Link object to a basename', () => {
  assert(TaskEntity._linkText({ path: 'spice/meetings/notes/2026/07-July/Foo.md', display: 'Foo' }) === 'Foo',
    'link object → basename: ' + TaskEntity._linkText({ path: 'spice/meetings/notes/2026/07-July/Foo.md', display: 'Foo' }));
  // Path with no display still yields the basename.
  assert(TaskEntity._linkText({ path: 'a/b/Bar.md' }) === 'Bar', 'path-only link → basename');
  // Display-only (no path) falls back to display.
  assert(TaskEntity._linkText({ display: 'Baz', subpath: null }) === 'Baz', 'display-only link → display');
});

// LT-2. _linkText coerces a "[[Wikilink]]" string → the basename (pipe/path tolerated).
ok('LT-2 _linkText coerces wikilink strings to a basename', () => {
  assert(TaskEntity._linkText('[[Bar]]') === 'Bar', 'simple wikilink: ' + TaskEntity._linkText('[[Bar]]'));
  assert(TaskEntity._linkText('[[a/b/Baz.md|Baz]]') === 'Baz', 'path+.md+pipe-label → basename: ' + TaskEntity._linkText('[[a/b/Baz.md|Baz]]'));
  assert(TaskEntity._linkText('[[a/b/Qux|Q]]') === 'Qux', 'path+pipe (no .md) → basename: ' + TaskEntity._linkText('[[a/b/Qux|Q]]'));
  assert(TaskEntity._linkText('Plain') === 'Plain', 'bare string passthrough');
});

// LT-3. _linkText handles nullish / empty → ''.
ok('LT-3 _linkText nullish/empty → ""', () => {
  assert(TaskEntity._linkText('') === '', 'empty string → ""');
  assert(TaskEntity._linkText(null) === '', 'null → ""');
  assert(TaskEntity._linkText(undefined) === '', 'undefined → ""');
});

// LT-4. parseNote coerces a Link-valued source_note into a comparable basename.
ok('LT-4 parseNote coerces source_note Link → basename', () => {
  const parsed = TaskEntity.parseNote({
    type: 'task', status: 'open',
    source_note: { path: 'spice/meetings/notes/2026/07-July/Standup.md', display: 'Standup' },
    project_slug: 'sauce',
    file: { path: 'spice/tasks/a.md' },
  });
  assert(parsed.source_note === 'Standup', 'source_note is the basename string: ' + JSON.stringify(parsed.source_note));
  assert(parsed.project_slug === 'sauce', 'project_slug passthrough preserved');
});

// ---------- Chrome body shape (nav → HR → card → HR → notes) ----------
//
// The task-note chrome now emits: SpaceNavButtons, a `---` divider, TaskNoteView,
// a SECOND `---` divider, then the `<!-- TASK_NOTES -->` marker. The
// TaskNoteToDoNav block is GONE. Assert the new shape (two HRs, no ToDoNav) so a
// regression (missing second divider / a resurrected ToDoNav) fails loudly.
ok('CB-1 _chromeBody emits SpaceNavButtons + HR + TaskNoteView + HR + marker in order (no ToDoNav)', () => {
  const body = TaskEntity._chromeBody();
  const iNav = body.indexOf('class: "SpaceNavButtons"');
  const iRule1 = body.indexOf('\n---\n');
  const iView = body.indexOf('class: "TaskNoteView"');
  const iRule2 = body.indexOf('\n---\n', iView);
  const iMarker = body.indexOf('<!-- TASK_NOTES -->');
  assert(iNav >= 0, 'has SpaceNavButtons');
  assert(iRule1 > iNav, 'first divider after SpaceNavButtons');
  assert(iView > iRule1, 'TaskNoteView after first divider');
  assert(iRule2 > iView, 'second divider after TaskNoteView');
  assert(iMarker > iRule2, 'marker after second divider');
  // Exactly two thematic breaks (nav-fence HR + card-fence HR), no third.
  assert((body.match(/\n---\n/g) || []).length === 2, 'exactly two `---` dividers');
  // TaskNoteToDoNav is fully removed from the chrome.
  assert(body.indexOf('TaskNoteToDoNav') < 0, 'no TaskNoteToDoNav block in the chrome');
  // composeNote body carries the new chrome too (has the second divider, no ToDoNav).
  const cn = TaskEntity.composeNote({ title: 'x' }).body;
  assert(cn.indexOf('TaskNoteToDoNav') < 0, 'composeNote body has no ToDoNav block');
  assert((cn.match(/\n---\n/g) || []).length === 2, 'composeNote body has two dividers');
});

// TaskDialog's inline chrome fallback must stay BYTE-IDENTICAL to TaskEntity's.
ok('CB-2 TaskDialog._chromeBody fallback is byte-identical to TaskEntity._chromeBody', () => {
  // Force the fallback path (no window.customJS in Node) → the inline copy.
  assert(TaskDialog._chromeBody() === TaskEntity._chromeBody(),
    'TaskDialog inline chrome must equal TaskEntity chrome');
});

// ---------- TaskTodayList.renderTaskRow (shared static) ----------
//
// The per-row renderer is now a SELF-CONTAINED static so any widget can draw a
// uniform task row cross-class. DOM behavior is Playwright/dogfood-verified; here
// we assert it's a callable function on both the class and the stored instance.
ok('RTR-1 renderTaskRow is a function (class + instance)', () => {
  assert(typeof TaskTodayListClass.renderTaskRow === 'function', 'static on the class');
  assert(typeof TaskTodayList.renderTaskRow === 'function', 'delegator on the instance');
  assert(typeof TaskTodayList._stripWikilink === 'function', '_stripWikilink static present');
  assert(TaskTodayList._stripWikilink('[[Sauce]]') === 'Sauce', '_stripWikilink unwraps');
});

// RTR-2. _projectChipText extracts the CLEAN basename (FIX 2) — Dataview
// resolves a `[[Connectors]]` project value to a FULL-PATH Link, so a bare
// strip-wikilink would show `spice/projects/connectors/Connectors.md|Connectors`.
// The chip must read `Connectors`. Without window.customJS (Node), the LOCAL
// fallback path is exercised; it must still produce the basename.
ok('RTR-2 _projectChipText yields the clean project basename (Link/path/wikilink)', () => {
  assert(typeof TaskTodayListClass._projectChipText === 'function', 'static on the class');
  assert(typeof TaskTodayList._projectChipText === 'function', 'delegator on the instance');
  // Dataview Link object (path + display) → basename.
  assert(TaskTodayList._projectChipText({ path: 'spice/projects/connectors/Connectors.md', display: 'Connectors' }) === 'Connectors',
    'Link object → Connectors: ' + TaskTodayList._projectChipText({ path: 'spice/projects/connectors/Connectors.md', display: 'Connectors' }));
  // Full-path wikilink string with pipe alias → basename.
  assert(TaskTodayList._projectChipText('[[spice/projects/connectors/Connectors.md|Connectors]]') === 'Connectors',
    'path+.md+pipe wikilink → Connectors: ' + TaskTodayList._projectChipText('[[spice/projects/connectors/Connectors.md|Connectors]]'));
  // Simple wikilink → inner name.
  assert(TaskTodayList._projectChipText('[[Sauce]]') === 'Sauce', 'simple wikilink → Sauce');
  // Bare string passthrough.
  assert(TaskTodayList._projectChipText('Sauce') === 'Sauce', 'bare string passthrough');
  // Nullish → "".
  assert(TaskTodayList._projectChipText(null) === '', 'null → ""');
  assert(TaskTodayList._projectChipText('') === '', 'empty → ""');
});

// ---------- _parseInlineLinks (FIX 1 — deterministic inline-link parser) ----------
//
// The title / LINKS renderer no longer depends on Obsidian's MarkdownRenderer
// (which is NOT a global in the customJS eval context, so it always fell back to
// raw text). renderInlineLinks now builds real <a> elements from an ordered
// segment list produced by this PURE parser. Test the parser in isolation.
ok('PIL-1 _parseInlineLinks is a function (class + instance)', () => {
  assert(typeof TaskTodayListClass._parseInlineLinks === 'function', 'static on the class');
  assert(typeof TaskTodayList._parseInlineLinks === 'function', 'delegator on the instance');
});
ok('PIL-2 _parseInlineLinks parses a bare wikilink (no alias)', () => {
  const segs = TaskTodayList._parseInlineLinks('[[Thursday-2026-07-02]]');
  assert(segs.length === 1, 'one segment: ' + JSON.stringify(segs));
  assert(segs[0].type === 'wikilink', 'wikilink type: ' + segs[0].type);
  assert(segs[0].target === 'Thursday-2026-07-02', 'target: ' + segs[0].target);
  assert(segs[0].alias === null, 'no alias: ' + JSON.stringify(segs[0].alias));
});
ok('PIL-3 _parseInlineLinks parses a wikilink with an alias ([[A|B]])', () => {
  const segs = TaskTodayList._parseInlineLinks('[[A|B]]');
  assert(segs.length === 1 && segs[0].type === 'wikilink', 'one wikilink: ' + JSON.stringify(segs));
  assert(segs[0].target === 'A', 'target A: ' + segs[0].target);
  assert(segs[0].alias === 'B', 'alias B: ' + segs[0].alias);
});
ok('PIL-4 _parseInlineLinks parses a markdown link ([label](url))', () => {
  const segs = TaskTodayList._parseInlineLinks('[testing](https://x.com)');
  assert(segs.length === 1 && segs[0].type === 'mdlink', 'one mdlink: ' + JSON.stringify(segs));
  assert(segs[0].label === 'testing', 'label testing: ' + segs[0].label);
  assert(segs[0].url === 'https://x.com', 'url: ' + segs[0].url);
});
ok('PIL-5 _parseInlineLinks splits text + mdlink + text (3 segments)', () => {
  const segs = TaskTodayList._parseInlineLinks('Take a look at X [here](https://y.com) done');
  assert(segs.length === 3, '3 segments: ' + JSON.stringify(segs));
  assert(segs[0].type === 'text' && segs[0].value === 'Take a look at X ', 'lead text: ' + JSON.stringify(segs[0]));
  assert(segs[1].type === 'mdlink' && segs[1].label === 'here' && segs[1].url === 'https://y.com', 'mid mdlink: ' + JSON.stringify(segs[1]));
  assert(segs[2].type === 'text' && segs[2].value === ' done', 'trail text: ' + JSON.stringify(segs[2]));
});
ok('PIL-6 _parseInlineLinks parses a bare http(s) URL', () => {
  const segs = TaskTodayList._parseInlineLinks('https://z.com');
  assert(segs.length === 1 && segs[0].type === 'url', 'one url: ' + JSON.stringify(segs));
  assert(segs[0].url === 'https://z.com', 'url: ' + segs[0].url);
});
ok('PIL-7 _parseInlineLinks returns a single text segment for plain text', () => {
  const segs = TaskTodayList._parseInlineLinks('just some plain text');
  assert(segs.length === 1 && segs[0].type === 'text', 'one text seg: ' + JSON.stringify(segs));
  assert(segs[0].value === 'just some plain text', 'value: ' + segs[0].value);
  // Empty input → [] (no segments to render).
  assert(TaskTodayList._parseInlineLinks('').length === 0, 'empty → []');
  assert(TaskTodayList._parseInlineLinks(null).length === 0, 'null → []');
});

// ---------- renderInlineLinks (FIX 1 — DOM-stub test exercising the REAL fn) ----------
//
// THIS is the test that would have caught the original bug: it runs the ACTUAL
// renderInlineLinks against a minimal fake `el` (capturing createEl'd children +
// their tagName/attrs/text/href/dataset + addEventListener), NOT a hand-built
// <a> replica. It asserts the built children include a real <a href> web anchor
// AND a real <a data-href> internal-link anchor.
ok('RIL-1 renderInlineLinks is a function (class + instance)', () => {
  assert(typeof TaskTodayListClass.renderInlineLinks === 'function', 'static on the class');
  assert(typeof TaskTodayList.renderInlineLinks === 'function', 'delegator on the instance');
});
ok('RIL-2 renderInlineLinks builds REAL <a> anchors (web + internal) via createEl', () => {
  // Minimal fake element: captures createEl'd children + a fake app.workspace.
  const opened = [];
  const prevWindow = global.window;
  global.window = { app: { workspace: { openLinkText: (t, sp) => opened.push([t, sp]) } } };
  const texts = [];
  const makeChild = (tag, opts) => {
    const child = {
      tagName: String(tag).toUpperCase(),
      textContent: (opts && opts.text != null) ? opts.text : '',
      cls: (opts && opts.cls) || '',
      href: (opts && opts.href != null) ? opts.href : null,
      attrs: Object.assign({}, (opts && opts.attr) || {}),
      dataset: {},
      _listeners: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    };
    return child;
  };
  const el = {
    children: [],
    textContent: 'STALE',
    createEl(tag, opts) { const c = makeChild(tag, opts); this.children.push(c); return c; },
    appendText(v) { texts.push(v); this.children.push({ tagName: '#text', textContent: v }); },
    createSpan(opts) { const c = makeChild('span', opts); this.children.push(c); return c; },
    setText(v) { this.textContent = v; this.children = []; },
  };
  TaskTodayList.renderInlineLinks(el, 'Look [here](https://x.com) and [[Note]]', 'src.md');
  const anchors = el.children.filter((c) => c.tagName === 'A');
  assert(anchors.length === 2, 'two anchors built: ' + JSON.stringify(el.children.map((c) => c.tagName)));
  const web = anchors.find((a) => a.href === 'https://x.com');
  assert(web, 'web anchor with href https://x.com present: ' + JSON.stringify(anchors.map((a) => a.href)));
  assert(web.textContent === 'here', 'web anchor text "here": ' + web.textContent);
  assert(web.attrs.target === '_blank' && web.attrs.rel === 'noopener', 'web anchor opens in new tab: ' + JSON.stringify(web.attrs));
  const internal = anchors.find((a) => a.dataset.href === 'Note' || a.attrs['data-href'] === 'Note');
  assert(internal, 'internal anchor with data-href Note present');
  assert(internal.cls === 'internal-link', 'internal-link class: ' + internal.cls);
  assert(internal.textContent === 'Note', 'internal anchor text "Note": ' + internal.textContent);
  // A wikilink click routes to app.workspace.openLinkText(target, sourcePath).
  const clickFns = internal._listeners.click || [];
  assert(clickFns.length === 1, 'internal anchor has a click handler');
  clickFns[0]({ preventDefault() {}, stopPropagation() {} });
  assert(opened.length === 1 && opened[0][0] === 'Note' && opened[0][1] === 'src.md',
    'click opens the note via openLinkText(Note, src.md): ' + JSON.stringify(opened));
  // Plain leading/joining text lands as text nodes (not swallowed).
  assert(texts.indexOf('Look ') >= 0 && texts.indexOf(' and ') >= 0, 'plain text preserved: ' + JSON.stringify(texts));
  global.window = prevWindow;
});
ok('RIL-3 renderInlineLinks tolerates a null element (never throws)', () => {
  let threw = false;
  try { TaskTodayList.renderInlineLinks(null, 'anything', 'src.md'); } catch (_e) { threw = true; }
  assert(!threw, 'null element does not throw');
});

// ---------- _renderTitleMarkdown alias (delegates to renderInlineLinks) ----------
ok('RTM-1 _renderTitleMarkdown is a function (class + instance)', () => {
  assert(typeof TaskTodayListClass._renderTitleMarkdown === 'function', 'static on the class');
  assert(typeof TaskTodayList._renderTitleMarkdown === 'function', 'delegator on the instance');
});

// ---------- TaskMeetingList._matches (pure filter) ----------
const TaskMeetingListClass = loadClass('mechanisms/task-entity/task-meeting-list.js', 'TaskMeetingList');
const TaskMeetingList = new TaskMeetingListClass();

ok('TML-1 _matches keys off the source_note basename (open-only is the query’s job)', () => {
  assert(TaskMeetingList._matches({ source_note: 'Standup' }, 'Standup') === true, 'exact match');
  assert(TaskMeetingList._matches({ source_note: 'Standup' }, 'Other') === false, 'non-match');
  assert(TaskMeetingList._matches({ source_note: '' }, 'Standup') === false, 'blank source_note → false');
  assert(TaskMeetingList._matches({ source_note: 'Standup' }, '') === false, 'blank meeting → false');
  assert(TaskMeetingList._matches(null, 'Standup') === false, 'null task → false');
});

// ---------- TaskProjectList._matches (pure filter) ----------
const TaskProjectListClass = loadClass('mechanisms/task-entity/task-project-list.js', 'TaskProjectList');
const TaskProjectList = new TaskProjectListClass();

ok('TPL-1 _matches keys off project_slug (raw plain-string equality)', () => {
  assert(TaskProjectList._matches({ project_slug: 'sauce' }, 'sauce') === true, 'exact match');
  assert(TaskProjectList._matches({ project_slug: 'sauce' }, 'other') === false, 'non-match');
  assert(TaskProjectList._matches({ project_slug: '' }, 'sauce') === false, 'blank slug → false');
  assert(TaskProjectList._matches({ project_slug: 'sauce' }, '') === false, 'blank target → false');
  assert(TaskProjectList._matches(null, 'sauce') === false, 'null task → false');
});

// TPL-2. _matches EXCLUDES meeting-sourced tasks (they render only in "From
// Meetings"; including them in Project Tasks too would duplicate — FIX 3).
ok('TPL-2 _matches excludes meeting-sourced tasks (dedup with From Meetings)', () => {
  // Same matching slug, but source === 'meeting' → excluded from Project Tasks.
  assert(TaskProjectList._matches({ project_slug: 'sauce', source: 'meeting' }, 'sauce') === false,
    'meeting-sourced with matching slug → false');
  // Non-meeting sources still match.
  assert(TaskProjectList._matches({ project_slug: 'sauce', source: 'project' }, 'sauce') === true,
    'project-sourced → true');
  assert(TaskProjectList._matches({ project_slug: 'sauce', source: 'daily' }, 'sauce') === true,
    'daily-sourced → true');
  // No source field (legacy / blank) → still matches (only 'meeting' is excluded).
  assert(TaskProjectList._matches({ project_slug: 'sauce' }, 'sauce') === true,
    'missing source → true');
  assert(TaskProjectList._matches({ project_slug: 'sauce', source: '' }, 'sauce') === true,
    'blank source → true');
  assert(TaskProjectList._matches({ project_slug: 'sauce', source: null }, 'sauce') === true,
    'null source → true');
});

// ---------- MeetingLeafActions.cleanProjectName (B1 clean-name extractor) ----------
//
// A meeting's `project:` frontmatter surfaces as a RESOLVED Dataview Link whose
// .path is the FULL note path (spice/projects/connectors/Connectors.md). The old
// stripWikilink returned that whole path, so the project-list lookup failed and
// the slug mangled into `spice-projects-connectors-connectors-md-connectors`.
// cleanProjectName extracts the CLEAN basename so the lookup + slug are correct.
// MeetingLeafActions.cleanProjectName / _slugify / resolveProjectPreselect are
// STATIC pure helpers (called as `MeetingLeafActions.x(...)` from render), so we
// exercise them on the CLASS (not an instance) — mirrors the render call form.
const MeetingLeafActions = loadClass('blueprints/meetings/helpers/meeting-leaf-actions.js', 'MeetingLeafActions');

ok('MLA-CPN-1 cleanProjectName extracts basename from a Dataview Link object', () => {
  assert(MeetingLeafActions.cleanProjectName({ path: 'spice/projects/connectors/Connectors.md', display: 'Connectors' }) === 'Connectors',
    'Link object → Connectors: ' + MeetingLeafActions.cleanProjectName({ path: 'spice/projects/connectors/Connectors.md', display: 'Connectors' }));
  assert(MeetingLeafActions.cleanProjectName({ path: 'a/b/Foo.md' }) === 'Foo', 'path-only Link → Foo');
  assert(MeetingLeafActions.cleanProjectName({ display: 'Bar', subpath: null }) === 'Bar', 'display-only Link → Bar');
});

ok('MLA-CPN-2 cleanProjectName extracts basename from wikilink / bare strings', () => {
  assert(MeetingLeafActions.cleanProjectName('[[a/b/Foo.md|Foo]]') === 'Foo', 'path+.md+pipe → Foo: ' + MeetingLeafActions.cleanProjectName('[[a/b/Foo.md|Foo]]'));
  assert(MeetingLeafActions.cleanProjectName('[[Bar]]') === 'Bar', 'simple wikilink → Bar');
  assert(MeetingLeafActions.cleanProjectName('[[Connectors]]') === 'Connectors', 'wikilink → Connectors');
  assert(MeetingLeafActions.cleanProjectName('Plain') === 'Plain', 'bare passthrough');
});

ok('MLA-CPN-3 cleanProjectName nullish/empty → ""', () => {
  assert(MeetingLeafActions.cleanProjectName('') === '', 'empty → ""');
  assert(MeetingLeafActions.cleanProjectName(null) === '', 'null → ""');
  assert(MeetingLeafActions.cleanProjectName(undefined) === '', 'undefined → ""');
});

ok('MLA-CPN-4 _slugify yields the REAL slug (never a path-slug)', () => {
  assert(MeetingLeafActions._slugify('Connectors') === 'connectors', 'Connectors → connectors');
  assert(MeetingLeafActions._slugify('Global K8s') === 'global-k8s', 'Global K8s → global-k8s');
  // The mangled path-string must NOT be what we slugify — cleanProjectName strips
  // the path FIRST, so the slug is `connectors`, not the old path-slug.
  const clean = MeetingLeafActions.cleanProjectName({ path: 'spice/projects/connectors/Connectors.md', display: 'Connectors' });
  assert(MeetingLeafActions._slugify(clean) === 'connectors',
    'clean-then-slugify → connectors (not spice-projects-…): ' + MeetingLeafActions._slugify(clean));
});

// resolveProjectPreselect now keys off cleanProjectName → the list lookup hits.
ok('MLA-CPN-5 resolveProjectPreselect resolves a Link-valued project against the list', () => {
  const list = [{ name: 'Connectors', slug: 'connectors' }];
  const cur = { project: { path: 'spice/projects/connectors/Connectors.md', display: 'Connectors' } };
  const pre = MeetingLeafActions.resolveProjectPreselect(cur, list);
  assert(pre && pre.type === 'project' && pre.slug === 'connectors' && pre.name === 'Connectors',
    'preselect resolves: ' + JSON.stringify(pre));
});

// ---------- ToDoLeafActions clean-name extractor (project-todo create path) ----------
const ToDoLeafActionsClass = loadClass('blueprints/to-do/helpers/todo-leaf-actions.js', 'ToDoLeafActions');

ok('TLA-CPN-1 ToDoLeafActions._cleanProjectName mirrors the meeting extractor', () => {
  assert(ToDoLeafActionsClass._cleanProjectName({ path: 'spice/projects/connectors/Connectors.md', display: 'Connectors' }) === 'Connectors',
    'Link object → Connectors');
  assert(ToDoLeafActionsClass._cleanProjectName('[[Bar]]') === 'Bar', 'wikilink → Bar');
  assert(ToDoLeafActionsClass._cleanProjectName('[[a/b/Foo.md|Foo]]') === 'Foo', 'path+pipe → Foo');
  assert(ToDoLeafActionsClass._cleanProjectName(null) === '', 'null → ""');
  assert(ToDoLeafActionsClass._slugify('Global K8s') === 'global-k8s', 'slugify Global K8s');
});

console.log(`\nrun-task-entity: ${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
