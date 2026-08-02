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
const SauceModalClass = loadClass('mechanisms/modal/sauce-modal.js', 'SauceModal');

const TaskChromeBarClass = loadClass('mechanisms/task-entity/task-chrome-bar.js', 'TaskChromeBar');
const TaskChromeBar = new TaskChromeBarClass();

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
    due: '2026-07-01',
    project: { name: 'Sauce', slug: 'sauce' },
    source: 'daily',
    now: '2026-07-01T10:00:00-06:00',
  });
  const fm = out.frontmatter;
  assert(fm.type === 'task', 'type');
  assert(fm.status === 'open', 'status defaults open');
  assert(fm.due === '2026-07-01', 'due');
  assert(fm.project === '[[Sauce]]', 'project wikilink');
  assert(fm.project_slug === 'sauce', 'project_slug');
  assert(fm.source === 'daily', 'source');
  assert(!!fm.created_at, 'created_at truthy');
  assert(fm.created_at === '2026-07-01T10:00:00-06:00', 'created_at from payload.now');
  assert(fm.completed_at === '', 'absent completed_at → empty string');
  // FIX 5 — links is always present as an array (empty when none provided).
  assert(Array.isArray(fm.links), 'links is an array');
  assert(fm.links.length === 0, 'absent links → empty array');
  assert(out.path === 'spice/tasks/Call X.md', 'path is readable "<title>.md": ' + out.path);
  // Body is now the CHROME body (TaskChromeBar + TaskNoteView + marker), not empty.
  assert(out.body.includes('<!-- TASK_NOTES -->'), 'body has the TASK_NOTES marker');
  assert(out.body.includes('class: "TaskChromeBar"'), 'body renders TaskChromeBar nav');
  assert(out.body.includes('class: "TaskNoteView"'), 'body renders TaskNoteView card');
});

// 2t. composeNote — trip/trip_slug linkage mirrors project (additive).
ok('TE-2t composeNote emits trip + trip_slug (parallel to project)', () => {
  const out = TaskEntity.composeNote({ title: 'Book hotel', trip: { name: 'Bussin', slug: 'bussin' } });
  assert(out.frontmatter.trip === '[[Bussin]]', 'trip wikilink: ' + out.frontmatter.trip);
  assert(out.frontmatter.trip_slug === 'bussin', 'trip_slug: ' + out.frontmatter.trip_slug);
  // trip empty when only project given; project still works.
  const fp = TaskEntity.composeNote({ title: 'X', project: { name: 'Acme', slug: 'acme' } }).frontmatter;
  assert(fp.trip === '', 'trip empty when only project: ' + JSON.stringify(fp.trip));
  assert(fp.trip_slug === '', 'trip_slug empty when only project: ' + JSON.stringify(fp.trip_slug));
  assert(fp.project_slug === 'acme', 'project still works: ' + fp.project_slug);
  // trip_slug sits immediately after project_slug in canonical order.
  const keys = Object.keys(out.frontmatter);
  assert(keys.indexOf('project_slug') === keys.indexOf('trip') - 1, 'trip follows project_slug: ' + keys.join(','));
  assert(keys.indexOf('trip') === keys.indexOf('trip_slug') - 1, 'trip_slug follows trip: ' + keys.join(','));
});

// 2u. parseNote — trip_slug plain string preserved; trip coerced via _linkText.
ok('TE-2u parseNote preserves trip_slug + coerces trip basename', () => {
  const parsed = TaskEntity.parseNote({ type: 'task', trip: '[[Bussin]]', trip_slug: 'bussin', file: { path: 'spice/tasks/x.md' } });
  assert(parsed.trip_slug === 'bussin', 'plain string preserved: ' + JSON.stringify(parsed.trip_slug));
  assert(parsed.trip === 'Bussin', 'trip coerced to basename: ' + parsed.trip);
  const bare = TaskEntity.parseNote({ type: 'task', file: { path: 'spice/tasks/y.md' } });
  assert(bare.trip === '', 'absent trip -> empty string: ' + JSON.stringify(bare.trip));
  assert(bare.trip_slug === '', 'absent trip_slug -> empty string: ' + JSON.stringify(bare.trip_slug));
});

// 3. composeNote — minimal payload → blank due, still valid.
ok('TE-3 composeNote minimal payload → blank due + valid', () => {
  const out = TaskEntity.composeNote({ title: 'x' });
  assert(out.frontmatter.due === '', 'absent due → empty string');
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

ok('TE-recur-1 composeNote emits recurrence (set + empty)', () => {
  const withRecur = TaskEntity.composeNote({ title: 'Feed the dogs', recurrence: 'every day', moment: fixedMoment });
  assert(withRecur.frontmatter.recurrence === 'every day', 'recurrence set: ' + withRecur.frontmatter.recurrence);
  const bare = TaskEntity.composeNote({ title: 'One-shot', moment: fixedMoment });
  assert(bare.frontmatter.recurrence === '', 'recurrence empty-string-not-omitted: ' + JSON.stringify(bare.frontmatter.recurrence));
  // Schema position: recurrence sits right after due, before priority.
  const keys = Object.keys(withRecur.frontmatter);
  assert(keys.indexOf('due') === keys.indexOf('recurrence') - 1, 'recurrence follows due: ' + keys.join(','));
  assert(keys.indexOf('recurrence') === keys.indexOf('priority') - 1, 'recurrence precedes priority: ' + keys.join(','));
});

ok('TE-recur-2 parseNote normalizes recurrence like priority (empty string, not null)', () => {
  const withRecur = TaskEntity.parseNote({ title: 'Feed the dogs', recurrence: 'every day', file: { path: 'spice/tasks/Feed the dogs.md' } });
  assert(withRecur.recurrence === 'every day', 'recurrence read back: ' + withRecur.recurrence);
  const bare = TaskEntity.parseNote({ title: 'One-shot', file: { path: 'spice/tasks/One-shot.md' } });
  assert(bare.recurrence === '', 'absent recurrence -> empty string: ' + JSON.stringify(bare.recurrence));
});

ok('TE-recur-3 nextOccurrence finds the next matching date after fromDateStr', () => {
  // Simple predicate: matches every date whose day-of-month is even.
  const evenDayMatches = (dateStr) => {
    const day = parseInt(dateStr.slice(8, 10), 10);
    return day % 2 === 0;
  };
  const next = TaskEntity.nextOccurrence('every 2 days (test grammar)', '2026-07-08', null, evenDayMatches);
  assert(next === '2026-07-10', 'next even day after the 8th (itself even) is the 10th: ' + next);
});

ok('TE-recur-4 nextOccurrence never returns fromDateStr itself, even if it matches', () => {
  const alwaysMatches = () => true;
  const next = TaskEntity.nextOccurrence('every day', '2026-07-08', null, alwaysMatches);
  assert(next === '2026-07-09', 'strictly AFTER fromDateStr: ' + next);
});

ok('TE-recur-5 nextOccurrence returns null when the predicate never matches within the horizon', () => {
  const neverMatches = () => false;
  const next = TaskEntity.nextOccurrence('every leap-day-2400', '2026-07-08', null, neverMatches);
  assert(next === null, 'unsupported/never-matching grammar -> null: ' + next);
});

ok('TE-recur-6 nextOccurrence tolerates a missing/throwing matchesFn (never throws)', () => {
  let threw = false;
  try {
    const next = TaskEntity.nextOccurrence('every day', '2026-07-08', null, null);
    assert(next === null, 'no matchesFn -> null, not a throw: ' + next);
  } catch (_e) { threw = true; }
  assert(!threw, 'nextOccurrence must never throw');
});

ok('TE-sub-1 composeNote emits parent_task (set + empty)', () => {
  const child = TaskEntity.composeNote({ title: 'Write intro', parent_task: '[[Ship the report]]', moment: fixedMoment });
  assert(child.frontmatter.parent_task === '[[Ship the report]]', 'parent_task set: ' + child.frontmatter.parent_task);
  const bare = TaskEntity.composeNote({ title: 'Top-level', moment: fixedMoment });
  assert(bare.frontmatter.parent_task === '', 'parent_task empty-string-not-omitted: ' + JSON.stringify(bare.frontmatter.parent_task));
  const keys = Object.keys(child.frontmatter);
  assert(keys.indexOf('source_note') === keys.indexOf('parent_task') - 1, 'parent_task follows source_note: ' + keys.join(','));
});

ok('TE-sub-2 parseNote normalizes parent_task via _linkText (Link object -> basename)', () => {
  const linkObj = { path: 'spice/tasks/Ship the report.md', display: null };
  const parsed = TaskEntity.parseNote({ title: 'Write intro', parent_task: linkObj, file: { path: 'spice/tasks/Write intro.md' } });
  assert(parsed.parent_task === 'Ship the report', 'coerced to basename: ' + parsed.parent_task);
  const bare = TaskEntity.parseNote({ title: 'Top-level', file: { path: 'spice/tasks/Top-level.md' } });
  assert(bare.parent_task === '', 'absent parent_task -> empty string: ' + JSON.stringify(bare.parent_task));
});

ok('TD-sub-1 createQuick-shaped payload carries parent_task through composeNote', () => {
  const composed = TaskEntity.composeNote({ title: 'Write intro', parent_task: '[[Ship the report]]', due: '', source: 'daily', links: [], moment: fixedMoment });
  assert(composed.frontmatter.parent_task === '[[Ship the report]]', 'parent_task in composed frontmatter: ' + composed.frontmatter.parent_task);
});

// 4. parseNote — normalize a dataview page: missing status → open, blank date → null.
ok('TE-4 parseNote normalizes status + blank dates', () => {
  const parsed = TaskEntity.parseNote({ status: undefined, due: '', title: 't', file: { path: 'spice/tasks/a.md' } });
  assert(parsed.status === 'open', 'missing status → open');
  assert(parsed.due === null, 'blank due → null');
  assert(parsed.title === 't', 'title preserved');
  assert(parsed.path === 'spice/tasks/a.md', 'path from file.path');
});

// 5. queryToday — partition open tasks into today / overdue; excludes done/future.
ok('TE-5 queryToday partitions today + overdue (open only)', () => {
  const res = TaskEntity.queryToday([
    { due: '2026-07-01', status: 'open' },
    { due: '2026-06-30', status: 'open' },
    { due: '2026-07-02', status: 'open' },
    { due: '2026-07-01', status: 'done' },
  ], '2026-07-01');
  assert(res.today.length === 1, 'today = the single open 07-01: got ' + res.today.length);
  assert(res.overdue.length === 1, 'overdue = the open 06-30: got ' + res.overdue.length);
});

// 6. validatePayload — title required; date format enforced.
ok('TE-6 validatePayload requires title + validates date shape', () => {
  assert(TaskEntity.validatePayload({ title: '' }).valid === false, 'empty title invalid');
  assert(TaskEntity.validatePayload({ title: 'ok' }).valid === true, 'non-empty title valid');
  assert(TaskEntity.validatePayload({ title: 'ok', due: 'nope' }).valid === false, 'bad due shape invalid');
  assert(TaskEntity.validatePayload({ title: 'ok', due: '2026-06-30' }).valid === true, 'good due valid');
});

function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ---------- TaskDialog static helpers (pure) ----------

// TD-1. defaultsForSurface daily → { due: today, source: "daily" }.
ok('TD-1 defaultsForSurface daily seeds due + source', () => {
  const d = TaskDialog.defaultsForSurface({ surface: 'daily', today: '2026-07-01' });
  assert(deepEq(d, { due: '2026-07-01', source: 'daily' }), 'got ' + JSON.stringify(d));
});

// TD-2. defaultsForSurface project → { project, source: "project" }, no due.
ok('TD-2 defaultsForSurface project seeds project + source (no due)', () => {
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

// TD-4. The to-do page's "New Task" button must dispatch surface:'daily' (NOT
// 'today') so defaultsForSurface actually seeds due+source. Regression
// net for the "New Task on daily to-do never shows in Today" bug.
ok('TD-4 to-do chrome bar New Task dispatch uses surface "daily"', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'blueprints', 'to-do', 'helpers', 'todo-chrome-bar.js'),
    'utf8'
  );
  assert(
    /TaskDialog\.open\(\{\s*surface:\s*"daily"/.test(src),
    'todo-chrome-bar.js must call TaskDialog.open({ surface: "daily", ... }) for the daily to-do New Task button'
  );
  assert(
    !/TaskDialog\.open\(\{\s*surface:\s*"today"/.test(src),
    'todo-chrome-bar.js must not use the unrecognized surface "today" anymore'
  );
});

// TD-5. trashPath rewrites spice/tasks/ prefix → spice/tasks/_trash/.
ok('TD-5 trashPath rewrites prefix into _trash', () => {
  assert(TaskDialog.trashPath('spice/tasks/task-a.md') === 'spice/tasks/_trash/task-a.md',
    'got ' + TaskDialog.trashPath('spice/tasks/task-a.md'));
});

// TD-6. donePath rewrites spice/tasks/ prefix → spice/tasks/_done/.
ok('TD-6 donePath rewrites prefix into _done', () => {
  assert(TaskDialog.donePath('spice/tasks/task-a.md') === 'spice/tasks/_done/task-a.md',
    'got ' + TaskDialog.donePath('spice/tasks/task-a.md'));
});

// TD-7. _bodyNotesBelowMarker returns only the user-notes portion (below marker).
ok('TD-7 _bodyNotesBelowMarker extracts notes below the marker', () => {
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

// TD-8. _replaceBody preserves chrome + marker, swaps only the notes below it.
ok('TD-8 _replaceBody preserves marker + chrome, swaps notes', () => {
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

// TD-9. _replaceBody on a legacy (no-marker) note re-injects chrome + marker.
ok('TD-9 _replaceBody un-bares a legacy note (injects chrome + marker)', () => {
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

// TD-10. _wikilink wraps a note basename; empty/nullish → "".
ok('TD-10 _wikilink wraps a basename (trims; empty → "")', () => {
  assert(TaskDialog._wikilink('Note A') === '[[Note A]]', 'got ' + TaskDialog._wikilink('Note A'));
  assert(TaskDialog._wikilink('  Trimmed  ') === '[[Trimmed]]', 'trims: ' + TaskDialog._wikilink('  Trimmed  '));
  assert(TaskDialog._wikilink('') === '', 'empty → ""');
  assert(TaskDialog._wikilink(null) === '', 'null → ""');
  assert(TaskDialog._wikilink(undefined) === '', 'undefined → ""');
  assert(TaskDialog._wikilink('   ') === '', 'all-whitespace → ""');
});

// TD-11. _mdLink builds a markdown link; label optional; no url → "".
ok('TD-11 _mdLink builds [label](url) / <url> / "" per inputs', () => {
  assert(TaskDialog._mdLink('site', 'https://x.com') === '[site](https://x.com)', 'labelled: ' + TaskDialog._mdLink('site', 'https://x.com'));
  assert(TaskDialog._mdLink('', 'https://x.com') === '<https://x.com>', 'no label → autolink: ' + TaskDialog._mdLink('', 'https://x.com'));
  assert(TaskDialog._mdLink('   ', 'https://x.com') === '<https://x.com>', 'blank label → autolink');
  assert(TaskDialog._mdLink('site', '') === '', 'no url → ""');
  assert(TaskDialog._mdLink('', '') === '', 'nothing → ""');
  assert(TaskDialog._mdLink(null, null) === '', 'null/null → ""');
  assert(TaskDialog._mdLink('  Docs  ', '  https://x.com  ') === '[Docs](https://x.com)', 'trims both');
});

// TD-12. _insertAt splices insertion into text at [start,end); invalid → append.
ok('TD-12 _insertAt splices at selection; invalid range → append', () => {
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

// TD-13. _addLink appends a trimmed, non-empty, DEDUPED entry (returns a new array).
ok('TD-13 _addLink appends a trimmed non-empty deduped entry', () => {
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

// TD-14. _removeLink drops the entry at index i (returns a new array; oob → clone).
ok('TD-14 _removeLink drops index i (out-of-range → unchanged clone)', () => {
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

// TD-15. _payloadFromState carries state.links onto the payload (FIX 5).
ok('TD-15 _payloadFromState includes state.links', () => {
  const p = TaskDialog._payloadFromState({ title: 't', links: ['[[A]]', '[b](u)'] });
  assert(Array.isArray(p.links) && p.links.length === 2, 'links on payload: ' + JSON.stringify(p.links));
  assert(p.links[0] === '[[A]]' && p.links[1] === '[b](u)', 'link entries preserved');
  // Missing state.links → an empty array on the payload (never undefined).
  const p2 = TaskDialog._payloadFromState({ title: 't' });
  assert(Array.isArray(p2.links) && p2.links.length === 0, 'missing links → []');
});

// TD-15t. _payloadFromState carries a trip linkage onto the payload (parallel
// to the project plumbing). state.tripName present → payload.trip = {name, slug}
// (slug from state.tripSlug, or slugified from the name when absent). No
// state.tripName → no payload.trip. Project flow is unaffected.
ok('TD-15t _payloadFromState includes trip linkage (parallel project)', () => {
  const p = TaskDialog._payloadFromState({ title: 't', tripName: 'Bussin', tripSlug: 'bussin' });
  assert(deepEq(p.trip, { name: 'Bussin', slug: 'bussin' }), 'trip on payload: ' + JSON.stringify(p.trip));
  // slug derived from name when tripSlug omitted.
  const p2 = TaskDialog._payloadFromState({ title: 't', tripName: 'Road Trip' });
  assert(deepEq(p2.trip, { name: 'Road Trip', slug: 'road-trip' }), 'trip slug derived: ' + JSON.stringify(p2.trip));
  // Slug-only (a SECTION note has no `name`) → still links; name falls back to the slug.
  const p4 = TaskDialog._payloadFromState({ title: 't', tripSlug: 'destin-florida' });
  assert(deepEq(p4.trip, { name: 'destin-florida', slug: 'destin-florida' }), 'trip from slug only: ' + JSON.stringify(p4.trip));
  // No trip name AND no trip slug → no payload.trip; project still works independently.
  const p3 = TaskDialog._payloadFromState({ title: 't', projectName: 'Sauce' });
  assert(p3.trip === undefined, 'no trip when name+slug absent: ' + JSON.stringify(p3.trip));
  assert(deepEq(p3.project, { name: 'Sauce', slug: 'sauce' }), 'project unaffected: ' + JSON.stringify(p3.project));
});

// TD-2t. defaultsForSurface threads a `trip` through for the trip surface,
// parallel to how project is threaded (source 'trip').
ok('TD-2t defaultsForSurface trip seeds trip + source', () => {
  const d = TaskDialog.defaultsForSurface({ surface: 'trip', trip: { name: 'Bussin', slug: 'bussin' } });
  assert(deepEq(d.trip, { name: 'Bussin', slug: 'bussin' }), 'trip: ' + JSON.stringify(d.trip));
  assert(d.source === 'trip', 'source trip: ' + d.source);
});

ok('TD-recur-1 _payloadFromState carries recurrence through', () => {
  const state = { title: 'Feed the dogs', due: '2026-07-08', priority: '', projectName: '', source: 'manual', source_note: '', links: [], recurrence: 'every day' };
  const payload = TaskDialog._payloadFromState(state);
  assert(payload.recurrence === 'every day', 'recurrence in payload: ' + payload.recurrence);
});

ok('TD-recur-2 _payloadFromState defaults recurrence to empty string', () => {
  const state = { title: 'One-shot', due: '', priority: '', projectName: '', source: 'manual', source_note: '', links: [] };
  const payload = TaskDialog._payloadFromState(state);
  assert(payload.recurrence === '', 'no recurrence -> empty string: ' + JSON.stringify(payload.recurrence));
});

// TD-recur-6/7 exercise _rollForwardDate, which delegates through
// TaskDialog._taskEntity() (reads window.customJS.TaskEntity). Stub/restore
// global.window scoped to just these two tests (narrower than a module-wide
// stub) so no other test in this file gains an unexpected window.customJS.
ok('TD-recur-6 _rollForwardDate: recurring task rolls from TODAY, not from stale scheduled', () => {
  const prevWindow = global.window;
  global.window = { customJS: { TaskEntity: TaskEntity } };
  try {
    // "every day" done late (scheduled 5th, actually completed on the 8th) rolls to the 9th.
    const matchesFn = (dateStr) => true; // "every day" always matches.
    const next = TaskDialog._rollForwardDate('every day', '2026-07-08', '2026-07-01', matchesFn);
    assert(next === '2026-07-09', 'rolls from today (8th) not from scheduled (5th): ' + next);
  } finally {
    if (prevWindow === undefined) delete global.window; else global.window = prevWindow;
  }
});

ok('TD-recur-7 _rollForwardDate returns null for an unsupported/never-matching grammar', () => {
  const prevWindow = global.window;
  global.window = { customJS: { TaskEntity: TaskEntity } };
  try {
    const next = TaskDialog._rollForwardDate('every leap year', '2026-07-08', '2026-07-01', () => false);
    assert(next === null, 'unsupported grammar -> null (caller falls back to archiving): ' + next);
  } finally {
    if (prevWindow === undefined) delete global.window; else global.window = prevWindow;
  }
});

// ---------- TaskDialog _moreOptionsShouldStartExpanded (pure) ----------
//
// Decides whether the dialog's "More options" section (Repeats/Priority/
// Project/Notes/Links) should start expanded: true iff ANY of those fields
// already has a value (so existing edit-mode data is never hidden by
// default); create mode's all-blank state naturally collapses.

ok('TD-polish-1 _moreOptionsShouldStartExpanded: false when no optional field is set', () => {
  const state = { priority: '', projectName: '', recurrence: '', notes: '', links: [] };
  assert(TaskDialog._moreOptionsShouldStartExpanded(state) === false, 'bare state -> collapsed');
});

ok('TD-polish-2 _moreOptionsShouldStartExpanded: true when ANY optional field is set', () => {
  assert(TaskDialog._moreOptionsShouldStartExpanded({ priority: 'high', projectName: '', recurrence: '', notes: '', links: [] }) === true, 'priority set -> expanded');
  assert(TaskDialog._moreOptionsShouldStartExpanded({ priority: '', projectName: 'Connectors', recurrence: '', notes: '', links: [] }) === true, 'project set -> expanded');
  assert(TaskDialog._moreOptionsShouldStartExpanded({ priority: '', projectName: '', recurrence: 'every day', notes: '', links: [] }) === true, 'recurrence set -> expanded');
  assert(TaskDialog._moreOptionsShouldStartExpanded({ priority: '', projectName: '', recurrence: '', notes: 'some notes', links: [] }) === true, 'notes set -> expanded');
  assert(TaskDialog._moreOptionsShouldStartExpanded({ priority: '', projectName: '', recurrence: '', notes: '', links: ['[[A]]'] }) === true, 'links set -> expanded');
});

ok('TD-polish-3 _moreOptionsShouldStartExpanded tolerates a missing/null state', () => {
  assert(TaskDialog._moreOptionsShouldStartExpanded(null) === false, 'null state -> collapsed, never throws');
});

// ---------- TaskDialog._composeRecurrenceGrammar (pure) ----------
//
// Builds the RecurrenceParser grammar string from the picker's structured
// state: { days: [0..6], weeks: N, dayOfMonth: 1..31 }. Days are deduped +
// sorted Sun..Sat so click order never affects the composed string.

ok('CRG-1 none -> empty string', () => {
  assert(TaskDialog._composeRecurrenceGrammar('none', {}) === '', 'none -> ""');
});

ok('CRG-2 daily -> "every day"', () => {
  assert(TaskDialog._composeRecurrenceGrammar('daily', {}) === 'every day');
});

ok('CRG-3 weekday -> "every weekday"', () => {
  assert(TaskDialog._composeRecurrenceGrammar('weekday', {}) === 'every weekday');
});

ok('CRG-4 monthly with dayOfMonth=15 -> "every 15th of month"', () => {
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 15 }) === 'every 15th of month');
});

ok('CRG-5 monthly ordinal suffixes: 1st/2nd/3rd/4th/11th/21st', () => {
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 1 }) === 'every 1st of month');
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 2 }) === 'every 2nd of month');
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 3 }) === 'every 3rd of month');
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 4 }) === 'every 4th of month');
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 11 }) === 'every 11th of month');
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 21 }) === 'every 21st of month');
});

ok('CRG-6 monthly with missing/invalid dayOfMonth -> empty string', () => {
  assert(TaskDialog._composeRecurrenceGrammar('monthly', {}) === '', 'no dayOfMonth -> ""');
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 0 }) === '', '0 out of range -> ""');
  assert(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 32 }) === '', '32 out of range -> ""');
});

ok('CRG-7 weekly single day, weeks=1 -> "every Mon"', () => {
  assert(TaskDialog._composeRecurrenceGrammar('weekly', { days: [1], weeks: 1 }) === 'every Mon');
});

ok('CRG-8 weekly multi-day sorted regardless of input order -> "every Mon Wed Fri"', () => {
  assert(TaskDialog._composeRecurrenceGrammar('weekly', { days: [5, 1, 3], weeks: 1 }) === 'every Mon Wed Fri');
});

ok('CRG-9 weekly with weeks>1 -> "every N weeks on ..."', () => {
  assert(TaskDialog._composeRecurrenceGrammar('weekly', { days: [5], weeks: 2 }) === 'every 2 weeks on Fri');
});

ok('CRG-10 weekly with weeks=1 (explicit) omits the "N weeks on" wrapper', () => {
  assert(TaskDialog._composeRecurrenceGrammar('weekly', { days: [0, 6], weeks: 1 }) === 'every Sun Sat');
});

ok('CRG-11 weekly with zero days -> empty string (guards against "every ")', () => {
  assert(TaskDialog._composeRecurrenceGrammar('weekly', { days: [], weeks: 1 }) === '');
  assert(TaskDialog._composeRecurrenceGrammar('weekly', {}) === '', 'missing days array -> ""');
});

ok('CRG-12 weekly de-dupes repeated day values', () => {
  assert(TaskDialog._composeRecurrenceGrammar('weekly', { days: [1, 1, 1], weeks: 1 }) === 'every Mon');
});

ok('CRG-13 round-trips through RecurrenceParser.matches for every composed kind', () => {
  const RecurrenceParserClass = loadClass('blueprints/to-do/helpers/recurrence-parser.js', 'RecurrenceParser');
  const RP = new RecurrenceParserClass();
  const mon = { day: () => 1, date: () => 15 };
  assert(RP.matches(TaskDialog._composeRecurrenceGrammar('daily', {}), mon) === true, 'daily fires');
  assert(RP.matches(TaskDialog._composeRecurrenceGrammar('weekday', {}), mon) === true, 'weekday fires on Mon');
  assert(RP.matches(TaskDialog._composeRecurrenceGrammar('weekly', { days: [1], weeks: 1 }), mon) === true, 'weekly Mon fires on Mon');
  assert(RP.matches(TaskDialog._composeRecurrenceGrammar('monthly', { dayOfMonth: 15 }), mon) === true, 'monthly 15th fires on the 15th');
});

// ---------- TaskDialog._recurrenceStateFromDescribe (pure) ----------
//
// Reverse-maps RecurrenceParser.describe()'s output into the picker's initial
// UI state, for edit-mode hydration.

ok('RSD-1 null (no recurrence) -> freq none, all blank', () => {
  const s = TaskDialog._recurrenceStateFromDescribe(null);
  assert(s.freq === 'none' && s.days.length === 0 && s.weeks === 1 && s.dayOfMonth === null, JSON.stringify(s));
});

ok('RSD-2 {kind: daily} -> freq daily', () => {
  assert(TaskDialog._recurrenceStateFromDescribe({ kind: 'daily' }).freq === 'daily');
});

ok('RSD-3 {kind: weekday-block} -> freq weekday', () => {
  assert(TaskDialog._recurrenceStateFromDescribe({ kind: 'weekday-block' }).freq === 'weekday');
});

ok('RSD-4 {kind: weekend-block} -> freq weekly, days [0,6]', () => {
  const s = TaskDialog._recurrenceStateFromDescribe({ kind: 'weekend-block' });
  assert(s.freq === 'weekly' && JSON.stringify(s.days) === JSON.stringify([0, 6]), JSON.stringify(s));
});

ok('RSD-5 {kind: day-of-month, day: 15} -> freq monthly, dayOfMonth 15', () => {
  const s = TaskDialog._recurrenceStateFromDescribe({ kind: 'day-of-month', day: 15 });
  assert(s.freq === 'monthly' && s.dayOfMonth === 15, JSON.stringify(s));
});

ok('RSD-6 {kind: weekday-set, days: [1,3,5]} -> freq weekly, weeks 1', () => {
  const s = TaskDialog._recurrenceStateFromDescribe({ kind: 'weekday-set', days: [1, 3, 5] });
  assert(s.freq === 'weekly' && JSON.stringify(s.days) === JSON.stringify([1, 3, 5]) && s.weeks === 1, JSON.stringify(s));
});

ok('RSD-7 {kind: every-n-weeks-on-day, weeks: 2, days: [5]} -> freq weekly, weeks 2', () => {
  const s = TaskDialog._recurrenceStateFromDescribe({ kind: 'every-n-weeks-on-day', weeks: 2, days: [5] });
  assert(s.freq === 'weekly' && s.weeks === 2 && JSON.stringify(s.days) === JSON.stringify([5]), JSON.stringify(s));
});

// ---------- TaskDialog._recurrencePickerValid (pure) ----------
//
// Gates Save: the only structurally-invalid picker state is Weekly with zero
// days selected (would silently compose to "" — i.e. "doesn't repeat", not
// what picking Weekly implied).

ok('RPV-1 non-weekly freq is always valid', () => {
  assert(TaskDialog._recurrencePickerValid({ recurrenceFreq: 'none' }) === true);
  assert(TaskDialog._recurrencePickerValid({ recurrenceFreq: 'daily' }) === true);
  assert(TaskDialog._recurrencePickerValid({ recurrenceFreq: 'weekday' }) === true);
  assert(TaskDialog._recurrencePickerValid({ recurrenceFreq: 'monthly', recurrenceDayOfMonth: null }) === true);
});

ok('RPV-2 weekly with at least one day is valid', () => {
  assert(TaskDialog._recurrencePickerValid({ recurrenceFreq: 'weekly', recurrenceDays: [1] }) === true);
});

ok('RPV-3 weekly with zero days is invalid', () => {
  assert(TaskDialog._recurrencePickerValid({ recurrenceFreq: 'weekly', recurrenceDays: [] }) === false);
  assert(TaskDialog._recurrencePickerValid({ recurrenceFreq: 'weekly' }) === false, 'missing recurrenceDays -> invalid');
});

ok('RPV-4 tolerates a missing/null state', () => {
  assert(TaskDialog._recurrencePickerValid(null) === true, 'null state -> valid (freq defaults away from weekly)');
});

// ---------- Recurrence picker round-trip (describe -> hydrate -> recompose) ----------
//
// Simulates opening the edit dialog on a task with an existing recurrence:
// RecurrenceParser.describe() parses it, _recurrenceStateFromDescribe()
// hydrates the picker state, and _composeRecurrenceGrammar() rebuilds an
// equivalent grammar string with no user interaction — confirms the picker
// never silently mutates an existing recurring task's schedule just by
// opening and re-saving it unchanged.

ok('RRT-1 round-trips "every 2 weeks on Friday" unchanged (short day name)', () => {
  const RecurrenceParserClass = loadClass('blueprints/to-do/helpers/recurrence-parser.js', 'RecurrenceParser');
  const grammar = 'every 2 weeks on Friday';
  const described = RecurrenceParserClass.describe(grammar);
  const hydrated = TaskDialog._recurrenceStateFromDescribe(described);
  const recomposed = TaskDialog._composeRecurrenceGrammar(hydrated.freq, { days: hydrated.days, weeks: hydrated.weeks, dayOfMonth: hydrated.dayOfMonth });
  assert(recomposed === 'every 2 weeks on Fri', 'recomposed: ' + recomposed);
});

ok('RRT-2 round-trips "every 15th of month" unchanged', () => {
  const RecurrenceParserClass = loadClass('blueprints/to-do/helpers/recurrence-parser.js', 'RecurrenceParser');
  const grammar = 'every 15th of month';
  const described = RecurrenceParserClass.describe(grammar);
  const hydrated = TaskDialog._recurrenceStateFromDescribe(described);
  const recomposed = TaskDialog._composeRecurrenceGrammar(hydrated.freq, { days: hydrated.days, weeks: hydrated.weeks, dayOfMonth: hydrated.dayOfMonth });
  assert(recomposed === grammar, 'recomposed: ' + recomposed);
});

ok('RRT-3 round-trips "every weekday" unchanged', () => {
  const RecurrenceParserClass = loadClass('blueprints/to-do/helpers/recurrence-parser.js', 'RecurrenceParser');
  const grammar = 'every weekday';
  const described = RecurrenceParserClass.describe(grammar);
  const hydrated = TaskDialog._recurrenceStateFromDescribe(described);
  const recomposed = TaskDialog._composeRecurrenceGrammar(hydrated.freq, { days: hydrated.days, weeks: hydrated.weeks, dayOfMonth: hydrated.dayOfMonth });
  assert(recomposed === grammar, 'recomposed: ' + recomposed);
});

ok('RRT-4 round-trips an empty/no-recurrence task unchanged', () => {
  const hydrated = TaskDialog._recurrenceStateFromDescribe(null);
  const recomposed = TaskDialog._composeRecurrenceGrammar(hydrated.freq, { days: hydrated.days, weeks: hydrated.weeks, dayOfMonth: hydrated.dayOfMonth });
  assert(recomposed === '', 'recomposed: ' + recomposed);
});

// ---------- TaskTodayList static helpers (pure) ----------

// TaskTodayList is the daily live-query widget. Its render() is browser-only
// (exercised in-vault), but buildBands is a PURE partition helper mirroring
// TaskEntity.queryToday: open-only, today = due === todayStr, overdue =
// due < todayStr. We load it the same bare-class way and call the static
// through an INSTANCE so a regression to instance-less statics fails loudly.
const TaskTodayListClass = loadClass('mechanisms/task-entity/task-today-list.js', 'TaskTodayList');
const TaskTodayList = new TaskTodayListClass();

// TD-1a3: timezone-safe calendar arithmetic for quick reschedule.
ok('TD1A-NEXT-DAY advances normalized dates across month + year boundaries', () => {
  assert(typeof TaskTodayListClass.nextDay === 'function', 'static nextDay is present');
  assert(typeof TaskTodayList.nextDay === 'function', 'instance nextDay delegator is present');
  assert(TaskTodayList.nextDay('2026-01-31') === '2026-02-01',
    'month boundary: ' + TaskTodayList.nextDay('2026-01-31'));
  assert(TaskTodayList.nextDay('2026-12-31') === '2027-01-01',
    'year boundary: ' + TaskTodayList.nextDay('2026-12-31'));
  assert(TaskTodayList.nextDay('2026-02-29') === '',
    'invalid calendar dates fail closed');
});

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
    due: '2026-07-01', priority: 'high', project: '[[Sauce]]',
  });
  const byLabel = {};
  for (const r of rows) byLabel[r.label] = r.value;
  assert(rows.length === 3, 'only 3 set fields: got ' + rows.length);
  assert(byLabel.Due === '2026-07-01', 'due row');
  assert(byLabel.Priority === 'high', 'priority row');
  assert(byLabel.Project === 'Sauce', 'project unwrapped: ' + byLabel.Project);
  assert(!('Scheduled' in byLabel), 'no Scheduled row ever produced');
});

// TNV-2. _fieldRows tolerates a null / empty task (never throws → []).
ok('TNV-2 _fieldRows tolerates null / empty task', () => {
  assert(TaskNoteView._fieldRows(null).length === 0, 'null → []');
  assert(TaskNoteView._fieldRows({}).length === 0, 'empty → []');
});

// TNV-recur-1. _fieldRows includes a Repeats row iff recurrence is set.
ok('TNV-recur-1 _fieldRows includes a Repeats row iff recurrence is set', () => {
  const TaskNoteViewClass = loadClass('mechanisms/task-entity/task-note-view.js', 'TaskNoteView');
  const rows = TaskNoteViewClass._fieldRows({ due: '2026-07-08', recurrence: 'every day' });
  const hit = rows.find(r => r.label === 'Repeats');
  assert(hit && hit.value === 'every day', 'Repeats row present with grammar text: ' + JSON.stringify(rows));

  const rowsNone = TaskNoteViewClass._fieldRows({ due: '2026-07-08' });
  assert(!rowsNone.find(r => r.label === 'Repeats'), 'no recurrence -> no Repeats row: ' + JSON.stringify(rowsNone));
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

ok('TNV-sub-1 _subtaskProgressText: "N/M subtasks done" from a parsed-task array', () => {
  const subtasks = [
    { title: 'A', status: 'done' },
    { title: 'B', status: 'open' },
    { title: 'C', status: 'done' },
  ];
  assert(TaskNoteViewClass._subtaskProgressText(subtasks) === '2/3 subtasks done', 'progress text: ' + TaskNoteViewClass._subtaskProgressText(subtasks));
});

ok('TNV-sub-2 _subtaskProgressText tolerates empty/null input', () => {
  assert(TaskNoteViewClass._subtaskProgressText([]) === '', 'empty array -> empty string');
  assert(TaskNoteViewClass._subtaskProgressText(null) === '', 'null -> empty string, never throws');
});

// TNV-sub-3. Regression test for the "subtask checkbox reappears / double-click
// errors" bug: the SUBTASKS section's live query fetched ALL non-trashed
// children (open + done) and rendered EVERY one of them as a checkbox row. A
// completed subtask (moved to _done/ but still under spice/tasks/) would
// therefore be re-fetched and re-rendered unchecked on Dataview's next
// auto-refresh, and a second click called markDone on the now-stale path,
// throwing "task file not found". Fix: split the fetched list into
// `allSubtasks` (unfiltered — feeds the N/M progress count, unchanged) and
// `openSubtasks` (status === 'open' — the ONLY thing passed to the row-render
// loop). Source-text assertion (this method's dv dependency has no dv-stub
// test in this harness; see TaskTodayList/TaskProjectList/TaskMeetingList
// render() for the same convention).
ok('TNV-sub-3 SUBTASKS section renders only status===open children as rows (regression)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'mechanisms', 'task-entity', 'task-note-view.js'), 'utf8');
  const m = /if\s*\(!isSubtask\s*&&\s*filePath\)\s*\{([\s\S]*?)\n\s+\}\s*catch\s*\(_e\)\s*\{\s*\/\*\s*SUBTASKS section best-effort/;
  const sectionMatch = m.exec(src);
  assert(sectionMatch, 'SUBTASKS section block found in task-note-view.js');
  const section = sectionMatch[1];
  assert(/openSubtasks\s*=\s*allSubtasks\.filter/.test(section),
    'openSubtasks must be derived by filtering allSubtasks (status===open), got section:\n' + section);
  assert(/for\s*\(const st of openSubtasks\)/.test(section),
    'the row-render loop must iterate openSubtasks, not the unfiltered list');
});

// TNV-DONE-1/2. Completed-subtask history: the SUBTASKS section renders a
// collapsible "Completed (N)" <details> block listing every subtask whose
// status is 'done' (from allSubtasks, the unfiltered open+done list — NOT
// openSubtasks, which only feeds the open rows above it), each row's
// checkbox pre-checked (mirrors TaskDoneTodayList's exact convention:
// render via the shared renderTaskRow, then set cb.checked = true via
// querySelector afterward, since renderTaskRow always starts unchecked).
// Rendered ONLY when there is at least one done subtask — no empty
// "Completed (0)" clutter. Source-text assertion (this method's dv
// dependency has no dv-stub test in this harness; see TNV-sub-3 for the
// same convention).
ok('TNV-DONE-1 SUBTASKS section renders a Completed(N) details block from done subtasks only when non-empty', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'mechanisms', 'task-entity', 'task-note-view.js'), 'utf8');
  const m = /if\s*\(!isSubtask\s*&&\s*filePath\)\s*\{([\s\S]*?)\n\s+\}\s*catch\s*\(_e\)\s*\{\s*\/\*\s*SUBTASKS section best-effort/;
  const sectionMatch = m.exec(src);
  assert(sectionMatch, 'SUBTASKS section block found in task-note-view.js');
  const section = sectionMatch[1];
  assert(/doneSubtasks\s*=\s*allSubtasks\.filter/.test(section),
    'doneSubtasks must be derived by filtering allSubtasks (status===done), got section:\n' + section);
  assert(/if\s*\(doneSubtasks\.length\)/.test(section),
    'the Completed block must be gated on doneSubtasks.length (no empty block)');
  assert(/for\s*\(const st of doneSubtasks\)/.test(section),
    'the Completed row loop must iterate doneSubtasks');
  assert(/cb\.checked\s*=\s*true/.test(section),
    'each Completed row must have its checkbox pre-checked (mirrors TaskDoneTodayList)');
});

// ---------- TaskEntity.subtaskCountsByParent (SCP-*) ----------
//
// Pure grouping core: given an array of ALREADY-PARSED tasks (parseNote
// output — parent_task already coerced to a basename string, '' when unset),
// group by parent_task and count { done, total }. Parents with zero children
// are simply absent from the map (no zero-entries) so callers can do a plain
// `counts[basename] || null` presence check.

ok('SCP-1 _groupSubtaskCounts groups children by parent_task and counts done/total', () => {
  const tasks = [
    { parent_task: 'Groceries', status: 'open' },
    { parent_task: 'Groceries', status: 'done' },
    { parent_task: 'Groceries', status: 'done' },
    { parent_task: 'Errands', status: 'open' },
  ];
  const counts = TaskEntity._groupSubtaskCounts(tasks);
  assert(deepEq(counts.Groceries, { done: 2, total: 3 }), 'Groceries: 2/3, got ' + JSON.stringify(counts.Groceries));
  assert(deepEq(counts.Errands, { done: 0, total: 1 }), 'Errands: 0/1, got ' + JSON.stringify(counts.Errands));
});

ok('SCP-2 _groupSubtaskCounts ignores tasks with no parent_task (not subtasks)', () => {
  const tasks = [
    { parent_task: '', status: 'open' },
    { parent_task: null, status: 'done' },
    { parent_task: 'Groceries', status: 'open' },
  ];
  const counts = TaskEntity._groupSubtaskCounts(tasks);
  assert(Object.keys(counts).length === 1, 'only Groceries present, got ' + JSON.stringify(counts));
  assert(deepEq(counts.Groceries, { done: 0, total: 1 }), 'Groceries: 0/1');
});

ok('SCP-3 _groupSubtaskCounts returns {} for null/non-array/empty input', () => {
  assert(deepEq(TaskEntity._groupSubtaskCounts(null), {}), 'null -> {}');
  assert(deepEq(TaskEntity._groupSubtaskCounts([]), {}), 'empty -> {}');
  assert(deepEq(TaskEntity._groupSubtaskCounts('not an array'), {}), 'non-array -> {}');
});

ok('SCP-4 _groupSubtaskCounts tolerates malformed entries without throwing', () => {
  const tasks = [null, undefined, { status: 'open' }, { parent_task: 'X' }, { parent_task: 'X', status: 'done' }];
  let counts;
  assert((() => { counts = TaskEntity._groupSubtaskCounts(tasks); return true; })(), 'never throws');
  assert(deepEq(counts.X, { done: 1, total: 2 }), 'X: 1/2 (missing status treated as open), got ' + JSON.stringify(counts.X));
});

ok('SCP-5 subtaskCountsByParent is a function (class + instance) and delegates to _groupSubtaskCounts', () => {
  assert(typeof TaskEntityClass.subtaskCountsByParent === 'function', 'static on the class');
  assert(typeof TaskEntity.subtaskCountsByParent === 'function', 'delegator on the instance');
});

// ---------- TaskChromeBar (TCB-*) ----------
//
// Task notes are pure leaf entities in the ChromeBar model: no primary
// action (creation/editing happen elsewhere on the card), no overflow menu,
// no cross-links ("This task" section) since the card's own SOURCE / Part-of
// / SUBTASKS sections already cover task-to-task navigation.

ok('TCB-1 detect() matches type:task pages, returns null for others', () => {
  const config = TaskChromeBar._config();
  const ctx = config.detect(null, { type: 'task', file: { path: 'spice/tasks/Groceries.md' } });
  assert(ctx && ctx.context === 'task', 'detects a task page');
  assert(ctx.path === 'spice/tasks/Groceries.md', 'carries the page path');
  assert(config.detect(null, { type: 'meeting' }) === null, 'non-task type -> null');
  assert(config.detect(null, null) === null, 'null page -> null');
});

ok('TCB-2 surfaceSpec() is a nav-only leaf: no primary, no overflow', () => {
  const config = TaskChromeBar._config();
  const spec = config.surfaceSpec({ context: 'task' });
  assert(spec.primary === null, 'no primary action');
  assert(Array.isArray(spec.overflow) && spec.overflow.length === 0, 'no overflow actions');
  assert(spec.leaf === true, 'leaf surface');
});

ok('TCB-3 destinations() returns no cross-links', () => {
  const config = TaskChromeBar._config();
  assert(deepEq(config.destinations(null, { context: 'task' }), []), 'no This-task section');
});

ok('TCB-4 dispatch() never throws for any id', () => {
  const config = TaskChromeBar._config();
  let threw = false;
  try { config.dispatch(null, { context: 'task' }, 'anything'); } catch (_e) { threw = true; }
  assert(!threw, 'dispatch is a safe no-op');
});

// TTL-1. buildBands partitions parsed tasks into today / overdue (open only).
ok('TTL-1 buildBands partitions today + overdue (open only)', () => {
  const res = TaskTodayList.buildBands([
    { due: '2026-07-01', status: 'open' },
    { due: '2026-06-29', status: 'open' },
    { due: '2026-07-01', status: 'done' },
  ], '2026-07-01');
  assert(res.today.length === 1, 'today = the single open 07-01: got ' + res.today.length);
  assert(res.overdue.length === 1, 'overdue = the open 06-29: got ' + res.overdue.length);
});

// TTL-2. buildBands routes future-due into Upcoming; undated tasks enter Today.
ok('TTL-2 buildBands routes future to upcoming, undated enter today', () => {
  const res = TaskTodayList.buildBands([
    { due: '2026-07-02', status: 'open' },  // future → upcoming
    { due: '', status: 'open' },            // undated → today
    { due: null, status: 'open' },          // undated → today
  ], '2026-07-01');
  assert(res.today.length === 2, 'undated in today: got ' + res.today.length);
  assert(res.overdue.length === 0, 'no overdue: got ' + res.overdue.length);
  assert(res.upcoming.length === 1, 'future-due in upcoming: got ' + res.upcoming.length);
  assert(res.upcoming[0].due === '2026-07-02', 'upcoming holds the future task');
});

// TTL-5. buildBands sorts upcoming soonest-first (independent of priority).
ok('TTL-5 buildBands sorts upcoming ascending by due (soonest first)', () => {
  const tasks = [
    { status: 'open', due: '2026-07-15', title: 'C' },
    { status: 'open', due: '2026-07-09', title: 'A' },
    { status: 'open', due: '2026-07-12', title: 'B' },
  ];
  const bands = TaskTodayList.buildBands(tasks, '2026-07-08');
  const order = bands.upcoming.map((t) => t.title);
  assert(JSON.stringify(order) === JSON.stringify(['A', 'B', 'C']),
    'expected A,B,C (soonest first), got ' + JSON.stringify(order));
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
// (that duplicate was the bug). Today/Overdue = open, due, NO project, NOT
// meeting-sourced (personal daily tasks only).
ok('TTL-4 buildBands excludes project-connected + meeting-sourced tasks (dedup)', () => {
  const res = TaskTodayList.buildBands([
    // Due today, but has a project → shown in its Project section, NOT today.
    { due: '2026-07-01', status: 'open', project_slug: 'sauce', source: 'daily' },
    // Due today, meeting-sourced → shown in Meeting Tasks, NOT today.
    { due: '2026-07-01', status: 'open', project_slug: '', source: 'meeting' },
    // Plain due-today personal task (no project, source daily) → IN today.
    { due: '2026-07-01', status: 'open', project_slug: '', source: 'daily' },
    // Overdue but has a project → excluded from overdue too.
    { due: '2026-06-30', status: 'open', project_slug: 'sauce', source: 'daily' },
    // Overdue meeting-sourced → excluded from overdue too.
    { due: '2026-06-30', status: 'open', project_slug: '', source: 'meeting' },
    // Plain overdue personal task → IN overdue.
    { due: '2026-06-29', status: 'open', project_slug: '', source: 'daily' },
  ], '2026-07-01');
  assert(res.today.length === 1, 'today = the single plain personal 07-01: got ' + res.today.length);
  assert(res.today[0].due === '2026-07-01' && !res.today[0].project_slug && res.today[0].source !== 'meeting',
    'today band holds only the personal daily task');
  assert(res.overdue.length === 1, 'overdue = the single plain personal 06-29: got ' + res.overdue.length);
  assert(res.overdue[0].due === '2026-06-29' && !res.overdue[0].project_slug && res.overdue[0].source !== 'meeting',
    'overdue band holds only the personal daily task');
  // A whitespace-only project_slug is treated as "no project" (still shown in today).
  const ws = TaskTodayList.buildBands([
    { due: '2026-07-01', status: 'open', project_slug: '   ', source: 'daily' },
  ], '2026-07-01');
  assert(ws.today.length === 1, 'whitespace-only project_slug → still a personal task: got ' + ws.today.length);
});

ok('TTL-sub-1 buildBands excludes a task with parent_task set (shown in its parent Subtasks section instead)', () => {
  const tasks = [
    { title: 'Top-level today', status: 'open', due: '2026-07-08', parent_task: '' },
    { title: 'Subtask today', status: 'open', due: '2026-07-08', parent_task: 'Ship the report' },
  ];
  const bands = TaskTodayList.buildBands(tasks, '2026-07-08');
  assert(bands.today.length === 1 && bands.today[0].title === 'Top-level today', 'subtask excluded from Today: ' + JSON.stringify(bands.today));
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

// DT-2. parseNote coerces a Luxon `due` into a plain string (was a DateTime).
ok('DT-2 parseNote coerces Luxon due → string', () => {
  const parsed = TaskEntity.parseNote({
    type: 'task', status: 'open',
    due: luxon('2026-07-01'),
    file: { path: 'spice/tasks/a.md' },
  });
  assert(parsed.due === '2026-07-01', 'due is the string, not a DateTime: got ' + JSON.stringify(parsed.due));
});

// DT-3. THE REPRO — Luxon-due open tasks must land in a band, not vanish.
ok('DT-3 buildBands partitions Luxon-scheduled tasks (the render bug)', () => {
  const tasks = [
    TaskEntity.parseNote({ status: 'open', due: luxon('2026-07-01') }),
    TaskEntity.parseNote({ status: 'open', due: luxon('2026-06-28') }),
  ];
  const res = TaskTodayList.buildBands(tasks, '2026-07-01');
  assert(res.today.length === 1, 'today = the 07-01 Luxon task: got ' + res.today.length);
  assert(res.overdue.length === 1, 'overdue = the 06-28 Luxon task: got ' + res.overdue.length);
});

// ---------- buildBands sort order (Today/Overdue chronological ordering) ----------

ok('TBB-SORT-1 buildBands sorts overdue ascending by due (oldest/most-overdue first)', () => {
  const tasks = [
    { status: 'open', due: '2026-07-05', title: 'C' },
    { status: 'open', due: '2026-07-01', title: 'A' },
    { status: 'open', due: '2026-07-03', title: 'B' },
  ];
  const bands = TaskTodayList.buildBands(tasks, '2026-07-08');
  const order = bands.overdue.map((t) => t.title);
  assert(JSON.stringify(order) === JSON.stringify(['A', 'B', 'C']),
    'expected A,B,C (oldest first), got ' + JSON.stringify(order));
});

// NOTE: `due` now drives BOTH band membership (buildBands's today/overdue split)
// and the secondary within-Today sort key (today.sort by a.due/b.due — see the
// plan's Task 3: that sort block is left unchanged, a leftover secondary sort
// that's now a no-op tie for same-due tasks since membership already pins every
// Today-band task's `due` to todayStr). So every fixture row here necessarily
// shares the SAME due (todayStr) to land in Today at all, and the sort collapses
// to the title tie-break in all cases — this test now documents that behavior.
ok('TBB-SORT-2 buildBands sorts today by title when due ties (secondary sort is a no-op post-merge)', () => {
  const tasks = [
    { status: 'open', due: '2026-07-08', title: 'zeta' },
    { status: 'open', due: '2026-07-08', title: 'Alpha' },
    { status: 'open', due: '2026-07-08', title: 'beta' },
  ];
  const bands = TaskTodayList.buildBands(tasks, '2026-07-08');
  const order = bands.today.map((t) => t.title);
  assert(JSON.stringify(order) === JSON.stringify(['Alpha', 'beta', 'zeta']),
    'expected case-insensitive alpha order (title tie-break), got ' + JSON.stringify(order));
});

ok('TBB-SORT-3 buildBands ties break by title case-insensitively', () => {
  const tasks = [
    { status: 'open', due: '2026-07-08', title: 'zeta' },
    { status: 'open', due: '2026-07-08', title: 'Alpha' },
    { status: 'open', due: '2026-07-08', title: 'beta' },
  ];
  const bands = TaskTodayList.buildBands(tasks, '2026-07-08');
  const order = bands.today.map((t) => t.title);
  assert(JSON.stringify(order) === JSON.stringify(['Alpha', 'beta', 'zeta']),
    'expected case-insensitive alpha order, got ' + JSON.stringify(order));
});

// ---------- buildBands: priority ordering + undated tasks + trip_slug ----------

ok('BB-PRIO-1 undated open tasks enter Today band', () => {
  const tasks = [
    { status: 'open', due: '', title: 'No date task', priority: 'medium' },
    { status: 'open', due: '2026-07-13', title: 'Today task', priority: 'low' },
  ];
  const bands = TaskTodayList.buildBands(tasks, '2026-07-13');
  assert(bands.today.length === 2, 'both tasks in today: ' + bands.today.length);
  assert(bands.overdue.length === 0, 'no overdue');
});

ok('BB-PRIO-2 today band sorted by priority descending then due then title', () => {
  const tasks = [
    { status: 'open', due: '2026-07-13', title: 'Low A', priority: 'low' },
    { status: 'open', due: '2026-07-13', title: 'Highest B', priority: 'highest' },
    { status: 'open', due: '2026-07-13', title: 'High C', priority: 'high' },
    { status: 'open', due: '', title: 'Medium no-date', priority: 'medium' },
    { status: 'open', due: '2026-07-13', title: 'No prio', priority: '' },
  ];
  const bands = TaskTodayList.buildBands(tasks, '2026-07-13');
  const titles = bands.today.map(t => t.title);
  assert(titles[0] === 'Highest B', 'highest first: ' + JSON.stringify(titles));
  assert(titles[1] === 'High C', 'high second: ' + JSON.stringify(titles));
  assert(titles[2] === 'Medium no-date', 'medium third (undated): ' + JSON.stringify(titles));
  assert(titles[3] === 'Low A', 'low fourth: ' + JSON.stringify(titles));
  assert(titles[4] === 'No prio', 'unset last: ' + JSON.stringify(titles));
});

ok('BB-PRIO-3 overdue band sorted by priority descending then due ascending', () => {
  const tasks = [
    { status: 'open', due: '2026-07-11', title: 'Old low', priority: 'low' },
    { status: 'open', due: '2026-07-12', title: 'Recent high', priority: 'high' },
    { status: 'open', due: '2026-07-10', title: 'Oldest high', priority: 'high' },
  ];
  const bands = TaskTodayList.buildBands(tasks, '2026-07-13');
  const titles = bands.overdue.map(t => t.title);
  assert(titles[0] === 'Oldest high', 'high+oldest first: ' + JSON.stringify(titles));
  assert(titles[1] === 'Recent high', 'high+recent second: ' + JSON.stringify(titles));
  assert(titles[2] === 'Old low', 'low last: ' + JSON.stringify(titles));
});

ok('BB-PRIO-4 trip_slug tasks excluded from buildBands', () => {
  const tasks = [
    { status: 'open', due: '2026-07-13', title: 'Personal', priority: 'medium' },
    { status: 'open', due: '2026-07-13', title: 'Trip task', priority: 'high', trip_slug: 'destin-florida' },
    { status: 'open', due: '', title: 'Trip no date', priority: 'low', trip_slug: 'nyc' },
  ];
  const bands = TaskTodayList.buildBands(tasks, '2026-07-13');
  assert(bands.today.length === 1, 'only personal task: ' + bands.today.length);
  assert(bands.today[0].title === 'Personal', 'personal kept');
});

// ---------- _chromeBody: no --- separators ----------

ok('CB-1 TaskEntity._chromeBody has no --- separators', () => {
  const body = TaskEntity._chromeBody();
  const lines = body.split('\n');
  const hrLines = lines.filter(l => l.trim() === '---');
  assert(hrLines.length === 0, 'should have 0 --- lines, got ' + hrLines.length);
  assert(body.includes('TaskChromeBar'), 'has TaskChromeBar');
  assert(body.includes('TaskNoteView'), 'has TaskNoteView');
  assert(body.includes('<!-- TASK_NOTES -->'), 'has TASK_NOTES marker');
});

ok('CB-2 TaskDialog._chromeBody has no --- separators', () => {
  const body = TaskDialog._chromeBody();
  const lines = body.split('\n');
  const hrLines = lines.filter(l => l.trim() === '---');
  assert(hrLines.length === 0, 'should have 0 --- lines, got ' + hrLines.length);
});

// ---------- renderTaskRow CSS structure (checkbox/title never split across lines) ----------
//
// row is `flex-wrap: wrap` with (pre-fix) THREE direct children: cbWrap, title,
// rightCluster. CSS line-wrapping decides breaks using each flex item's
// UNSHRUNK hypothetical width, so a long title can push the whole `title` item
// to its own line, stranding the checkbox alone on line 1 — even though title
// itself wraps internally (overflow-wrap/word-break). The fix nests cbWrap +
// title inside a new `titleGroup` sub-container (flex-wrap: nowrap, flex: 1 1
// auto, min-width: 0) so the two can never split from each other; rightCluster
// remains the only sibling allowed to wrap to its own line.
function makeRowStubEl(tag) {
  const el = {
    tag, style: {}, children: [], _attrs: {}, _listeners: {},
    classList: { add() {} },
    createEl(t, o) {
      const c = makeRowStubEl(t);
      if (o && o.cls) c._attrs.cls = o.cls;
      if (o && o.text != null) c.textContent = o.text;
      el.children.push(c);
      return c;
    },
    createSpan(o) { return el.createEl('span', o); },
    addEventListener(name, fn) { el._listeners[name] = fn; },
    setAttribute(k, v) { el._attrs[k] = v; },
    empty() { el.children = []; },
    querySelector() { return null; },
  };
  return el;
}

// Recursive finder — searches the whole subtree (not just direct children)
// for the first element whose _attrs.cls matches. Needed because the fix
// nests cbWrap/title one level deeper (inside titleGroup) than before.
function findByClsAttr(root, cls) {
  if (!root) return null;
  if (root._attrs && root._attrs.cls === cls) return root;
  for (const c of (root.children || [])) {
    const found = findByClsAttr(c, cls);
    if (found) return found;
  }
  return null;
}

ok('RTR-WRAP-1 checkbox + title are non-wrapping siblings (never split by a long title flex-wrapping the row)', () => {
  const container = makeRowStubEl('div');
  const task = { title: 'A very long task title that could overflow the row width by itself', path: 'spice/tasks/Long.md' };
  const row = TaskTodayList.renderTaskRow(container, task, null);
  assert(row, 'row created');
  const cbWrap = findByClsAttr(row, 'sauce-task-today-cbwrap');
  const title = findByClsAttr(row, 'sauce-task-today-title');
  assert(cbWrap && title, 'both cbWrap and title exist somewhere under row');
  // Neither may be a DIRECT child of `row` (the outer flex-wrap:wrap row) —
  // the fix nests both one level deeper, inside a non-wrapping titleGroup, so
  // they never split across flex lines from each other.
  assert(!row.children.includes(cbWrap), 'cbWrap must NOT be a direct child of row (must be nested in a nowrap titleGroup)');
  assert(!row.children.includes(title), 'title must NOT be a direct child of row (must be nested in a nowrap titleGroup)');
});

ok('RTR-WRAP-2 nested title group never wraps (flex-wrap: nowrap) and contains both cbWrap + title', () => {
  const container = makeRowStubEl('div');
  const task = { title: 'Task', path: 'spice/tasks/Task.md' };
  const row = TaskTodayList.renderTaskRow(container, task, null);
  const titleGroup = findByClsAttr(row, 'sauce-task-today-titlegroup');
  assert(titleGroup, 'a sauce-task-today-titlegroup wrapper exists');
  assert(row.children.includes(titleGroup), 'titleGroup IS a direct child of row (the only nesting level added)');
  assert(/flex-wrap:\s*nowrap/.test(titleGroup.style.cssText || ''),
    'titleGroup must be flex-wrap: nowrap, got: ' + titleGroup.style.cssText);
  const cbWrap = titleGroup.children.find((c) => c._attrs.cls === 'sauce-task-today-cbwrap');
  const title = titleGroup.children.find((c) => c._attrs.cls === 'sauce-task-today-title');
  assert(cbWrap && title, 'titleGroup directly contains both cbWrap and title');
});

// DT-4. THE UTC-SAFETY FIX — a Luxon-like DateTime that exposes BOTH
// toISODate() (naive, LOCAL-zone) and toUTC() (returns a UTC-anchored
// DateTime) must prefer the UTC path. A bare YAML date parses UTC
// midnight; naive .toISODate() in a negative-offset zone (e.g.
// America/Chicago, -06:00) rolls the calendar date back one day —
// WRONG, so it must be discarded in favor of .toUTC().toISODate(),
// which returns the correct one.
function luxonUtcMidnight(correctUtcIsoDate, wrongLocalIsoDate) {
  return {
    toISODate: () => wrongLocalIsoDate,
    toUTC: () => ({
      toISODate: () => correctUtcIsoDate,
      toFormat: (fmt) => (fmt === 'yyyy-MM-dd' ? correctUtcIsoDate : correctUtcIsoDate),
    }),
  };
}

ok('DT-4 _toDateStr prefers toUTC().toISODate() over local-zone toISODate() (negative-offset bug)', () => {
  const stub = luxonUtcMidnight('2026-07-08', '2026-07-07');
  assert(TaskEntity._toDateStr(stub) === '2026-07-08',
    'expected UTC-safe date 2026-07-08, got ' + TaskEntity._toDateStr(stub));
});

// DT-5. Same UTC-safety fix, but the value only exposes toFormat (no
// toISODate) — mirrors real Luxon DateTime objects, which always expose
// BOTH, but a value that only implements toFormat must still route
// through .toUTC() first.
function luxonUtcMidnightFormatOnly(correctUtcIsoDate, wrongLocalIsoDate) {
  return {
    toFormat: (fmt) => (fmt === 'yyyy-MM-dd' ? wrongLocalIsoDate : wrongLocalIsoDate),
    toUTC: () => ({
      toFormat: (fmt) => (fmt === 'yyyy-MM-dd' ? correctUtcIsoDate : correctUtcIsoDate),
    }),
  };
}

ok('DT-5 _toDateStr prefers toUTC().toFormat() over local-zone toFormat() (negative-offset bug)', () => {
  const stub = luxonUtcMidnightFormatOnly('2026-07-08', '2026-07-07');
  assert(TaskEntity._toDateStr(stub) === '2026-07-08',
    'expected UTC-safe date 2026-07-08, got ' + TaskEntity._toDateStr(stub));
});

// DT-6. Plain JS Date branch must read the calendar date via UTC
// getters (getUTCFullYear/getUTCMonth/getUTCDate), not local getters
// (getFullYear/getMonth/getDate). A bare YAML date parses UTC midnight;
// on a machine running in a negative-offset TZ, local getters would
// roll the date back one day. This sanity-checks against the same
// Date.UTC()-constructed value regardless of the test-runner's TZ.
ok('DT-6 _toDateStr reads plain JS Date via UTC getters, not local getters', () => {
  const d = new Date(Date.UTC(2026, 6, 8, 0, 0, 0)); // 2026-07-08T00:00:00Z
  const expected = d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
  assert(expected === '2026-07-08', 'sanity: UTC getters give 2026-07-08, got ' + expected);
  assert(TaskEntity._toDateStr(d) === '2026-07-08',
    'expected 2026-07-08 via UTC getters, got ' + TaskEntity._toDateStr(d));
});

// DT-7. Regression guard — a moment-like value is mutable, so .utc()
// must be called on a CLONE before conversion (moment mutates in
// place), and the fix must read via the UTC clone, not the naive one.
function momentUtcMidnight(correctUtcIsoDate, wrongLocalIsoDate) {
  const self = {
    _isUtc: false,
    format: (fmt) => {
      const iso = self._isUtc ? correctUtcIsoDate : wrongLocalIsoDate;
      return fmt === 'YYYY-MM-DD' ? iso : iso;
    },
    clone: () => momentUtcMidnight(correctUtcIsoDate, wrongLocalIsoDate),
    utc: () => { self._isUtc = true; return self; },
  };
  return self;
}

ok('DT-7 _toDateStr prefers cloned .utc().format() over local .format() for moment-like values', () => {
  const stub = momentUtcMidnight('2026-07-08', '2026-07-07');
  assert(TaskEntity._toDateStr(stub) === '2026-07-08',
    'expected UTC-safe date 2026-07-08, got ' + TaskEntity._toDateStr(stub));
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
ok('CB-1 _chromeBody emits TaskChromeBar + HR + TaskNoteView + HR + marker in order (no bare SpaceNavButtons)', () => {
  const body = TaskEntity._chromeBody();
  assert(body.includes('class: "TaskChromeBar"'), '_chromeBody must invoke TaskChromeBar');
  assert(!body.includes('class: "SpaceNavButtons"'), '_chromeBody must no longer invoke the legacy bare SpaceNavButtons');
  assert(body.includes('class: "TaskNoteView"'), '_chromeBody still invokes TaskNoteView');
  assert(body.includes('<!-- TASK_NOTES -->'), '_chromeBody still carries the TASK_NOTES marker');
  assert(body.indexOf('TaskChromeBar') < body.indexOf('TaskNoteView'), 'TaskChromeBar renders before TaskNoteView');
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

// RTR-SUB-1/2. Subtask-count chip: renderTaskRow reads an OPTIONAL
// `task.subtask_count = { done, total }` (attached by the CALLER — daily /
// project / meeting render() via TaskEntity.subtaskCountsByParent — never
// queried by renderTaskRow itself, which stays dv-free per its existing
// design). When present and total > 0, render one more chip
// "{done}/{total} subtasks" with cls 'sauce-task-today-subtask-chip' so tests
// (and nothing else) can find it. Absent or total===0 → no chip.
ok('RTR-SUB-1 renderTaskRow renders the subtask-count chip when subtask_count.total > 0', () => {
  const container = makeRowStubEl('div');
  const task = { title: 'Groceries', path: 'spice/tasks/Groceries.md', subtask_count: { done: 2, total: 5 } };
  const row = TaskTodayList.renderTaskRow(container, task, null);
  const chip = findByClsAttr(row, 'sauce-task-today-subtask-chip');
  assert(chip, 'subtask chip exists');
  assert(chip.textContent === '2/5 subtasks', 'chip text is "2/5 subtasks", got ' + chip.textContent);
});

ok('RTR-SUB-2 renderTaskRow renders no subtask chip when subtask_count is absent or total is 0', () => {
  const container1 = makeRowStubEl('div');
  const row1 = TaskTodayList.renderTaskRow(container1, { title: 'No subtasks', path: 'spice/tasks/X.md' }, null);
  assert(!findByClsAttr(row1, 'sauce-task-today-subtask-chip'), 'no chip when subtask_count absent');

  const container2 = makeRowStubEl('div');
  const row2 = TaskTodayList.renderTaskRow(container2, { title: 'Zero total', path: 'spice/tasks/Y.md', subtask_count: { done: 0, total: 0 } }, null);
  assert(!findByClsAttr(row2, 'sauce-task-today-subtask-chip'), 'no chip when total is 0');
});

// RTR-DIV-1. Row has border-bottom for inter-row separation; last-child
// rule (injected in the browser) strips it at section boundaries.
ok('RTR-DIV-1 renderTaskRow row has border-bottom divider', () => {
  const container = makeRowStubEl('div');
  const task = { title: 'Task', path: 'spice/tasks/Task.md' };
  const row = TaskTodayList.renderTaskRow(container, task, null);
  assert(/border-bottom/.test(row.style.cssText || ''),
    'row must have border-bottom, got: ' + row.style.cssText);
});

// RTR-3. Title click OPENS THE TASK NOTE (app.workspace.openLinkText(path)), NOT the
// edit dialog. Drives the REAL renderTaskRow against a DOM stub + a fake app +
// a TaskDialog spy — the same faithful pattern as RIL-2 (not a hand-built replica).
// The checkbox keeps its markDone gesture; only the title/row click changed target.
ok('RTR-3 renderTaskRow: title click opens the task NOTE, not the edit dialog', () => {
  const opened = [];
  const openDialogCalls = [];
  const prevWindow = global.window;
  global.window = { app: { workspace: { openLinkText: (t, sp, nl) => opened.push([t, sp, nl]) } } };
  const mkEl = () => ({
    style: {}, dataset: {}, textContent: '', type: '', checked: false, cls: '',
    children: [], _listeners: {},
    createEl(tag, opts) {
      const c = mkEl();
      c.tagName = String(tag).toUpperCase();
      if (opts) { if (opts.cls) c.cls = opts.cls; if (opts.text != null) c.textContent = opts.text; }
      this.children.push(c);
      return c;
    },
    createSpan(opts) { return this.createEl('span', opts); },
    appendText(v) { this.children.push({ tagName: '#text', textContent: v }); },
    setText(v) { this.textContent = v; this.children = []; },
    empty() { this.children = []; },
    setAttribute(k, v) { this.dataset[k] = v; },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    removeChild() {},
    get firstChild() { return null; },
  });
  const container = mkEl();
  const path = 'spice/tasks/go through mail.md';
  const TD = { open: (a) => openDialogCalls.push(a), markDone: () => ({ ok: true }) };
  const row = TaskTodayList.renderTaskRow(container, { title: 'go through mail', path }, TD);
  const findByCls = (node, cls) => {
    if (!node || !node.children) return null;
    for (const c of node.children) { if (c.cls === cls) return c; const d = findByCls(c, cls); if (d) return d; }
    return null;
  };
  const title = findByCls(row, 'sauce-task-today-title');
  assert(title, 'title element rendered');
  const clickFns = title._listeners.click || [];
  assert(clickFns.length >= 1, 'title has a click handler');
  clickFns[0]({ target: {}, preventDefault() {}, stopPropagation() {} });
  assert(opened.length === 1 && opened[0][0] === path,
    'title click opens the task note via openLinkText(path): ' + JSON.stringify(opened));
  assert(openDialogCalls.length === 0,
    'title click must NOT open the edit dialog: ' + JSON.stringify(openDialogCalls));
  global.window = prevWindow;
});

// TTL-recur-1. renderTaskRow draws a repeat-icon badge iff task.recurrence is
// set — a small icon (not a text chip), visually distinct at a glance without
// opening the note. Uses a minimal Obsidian-like createEl-shaped DOM stub.
ok('TTL-recur-1 renderTaskRow shows a repeat badge iff task.recurrence is set', () => {
  function stubEl(tag) {
    const el = {
      tag, children: [], _text: '',
      style: {}, attrs: {},
      createEl(t, opts) { const c = stubEl(t); if (opts && opts.text != null) c._text = opts.text; if (opts && opts.cls) c.className = opts.cls; this.children.push(c); return c; },
      addEventListener() {}, setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); },
    };
    return el;
  }
  const container = stubEl('div');
  const recurring = { title: 'Feed the dogs', path: 'spice/tasks/Feed the dogs.md', recurrence: 'every day' };
  TaskTodayList.renderTaskRow(container, recurring, null);
  const rowRecur = container.children[0];
  const findByClassDeep = (node, cls) => {
    if (node.className === cls) return node;
    for (const c of (node.children || [])) { const hit = findByClassDeep(c, cls); if (hit) return hit; }
    return null;
  };
  assert(!!findByClassDeep(rowRecur, 'sauce-task-today-recur-badge'), 'recurring row has the badge');

  const container2 = stubEl('div');
  const oneShot = { title: 'One-shot', path: 'spice/tasks/One-shot.md', recurrence: '' };
  TaskTodayList.renderTaskRow(container2, oneShot, null);
  const rowOneShot = container2.children[0];
  assert(!findByClassDeep(rowOneShot, 'sauce-task-today-recur-badge'), 'one-shot row has NO badge');
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

// ---------- TaskDialog._buildNoteLinkCandidates (note-link picker) ----------

ok('NLC-1 sorts candidates by mtime descending, ties broken alphabetically', () => {
  const files = [
    { path: 'spice/wiki/Alpha.md', basename: 'Alpha', stat: { mtime: 100 } },
    { path: 'spice/wiki/Beta.md', basename: 'Beta', stat: { mtime: 300 } },
    { path: 'spice/wiki/Gamma.md', basename: 'Gamma', stat: { mtime: 300 } },
  ];
  const names = TaskDialogClass._buildNoteLinkCandidates(files, null);
  assert(JSON.stringify(names) === JSON.stringify(['Beta', 'Gamma', 'Alpha']),
    'expected Beta,Gamma,Alpha (mtime desc, tie alpha), got ' + JSON.stringify(names));
});

ok('NLC-2 excludes notes under spice/tasks/ and the file currently being edited', () => {
  const files = [
    { path: 'spice/tasks/Buy milk.md', basename: 'Buy milk', stat: { mtime: 500 } },
    { path: 'spice/projects/connectors/Connectors.md', basename: 'Connectors', stat: { mtime: 400 } },
    { path: 'spice/wiki/Notes.md', basename: 'Notes', stat: { mtime: 300 } },
  ];
  const names = TaskDialogClass._buildNoteLinkCandidates(files, 'spice/wiki/Notes.md');
  assert(JSON.stringify(names) === JSON.stringify(['Connectors']),
    'expected only Connectors (task excluded, editPath excluded), got ' + JSON.stringify(names));
});

ok('NLC-3 dedupes by basename', () => {
  const files = [
    { path: 'spice/wiki/A/Dup.md', basename: 'Dup', stat: { mtime: 200 } },
    { path: 'spice/wiki/B/Dup.md', basename: 'Dup', stat: { mtime: 100 } },
  ];
  const names = TaskDialogClass._buildNoteLinkCandidates(files, null);
  assert(names.length === 1, 'expected exactly 1 deduped entry, got ' + names.length);
});

ok('NLC-4 note basename matching an inherited Object.prototype key is NOT silently dropped', () => {
  const files = [
    { path: 'spice/wiki/constructor.md', basename: 'constructor', stat: { mtime: 500 } },
    { path: 'spice/wiki/hasOwnProperty.md', basename: 'hasOwnProperty', stat: { mtime: 400 } },
    { path: 'spice/wiki/Normal.md', basename: 'Normal', stat: { mtime: 300 } },
  ];
  const names = TaskDialogClass._buildNoteLinkCandidates(files, null);
  assert(names.includes('constructor'), 'a note literally named "constructor" must still surface: ' + JSON.stringify(names));
  assert(names.includes('hasOwnProperty'), 'a note literally named "hasOwnProperty" must still surface: ' + JSON.stringify(names));
  assert(names.length === 3, 'expected all 3 candidates, got ' + names.length + ': ' + JSON.stringify(names));
});

ok('NLC-5 realistic vault snapshot (many files, missing stat) never returns empty', () => {
  const files = [];
  for (let i = 0; i < 50; i++) {
    files.push({ path: `spice/wiki/Note ${i}.md`, basename: `Note ${i}`, stat: { mtime: i * 10 } });
  }
  files.push({ path: 'spice/wiki/NoStat.md', basename: 'NoStat' }); // missing .stat entirely
  files.push({ path: 'spice/tasks/_done/Old task.md', basename: 'Old task', stat: { mtime: 999999 } });
  const names = TaskDialogClass._buildNoteLinkCandidates(files, null);
  assert(names.length === 51, 'expected 51 (50 notes + NoStat, task excluded), got ' + names.length);
  assert(names[0] === 'Note 49', 'highest mtime first: ' + names[0]);
  assert(names.includes('NoStat'), 'a file with no .stat still surfaces (mtime defaults to 0): ' + JSON.stringify(names));
  assert(!names.includes('Old task'), 'spice/tasks/ files are excluded even under _done/: ' + JSON.stringify(names));
});

// ---------- ToDoLeafActions "Completed" button (Task 6) ----------
async function runToDoLeafActionsCompletedTests() {
  await okAsync('TLA-COMPLETED-1 ToDoLeafActions exposes an openCompletedTasks handler that creates the archive note', async () => {
    const created = [];
    let opened = null;
    global.window = { moment: () => ({ format: () => '2026-07-08T09:00:00-0600' }) };
    global.app = {
      vault: {
        getAbstractFileByPath: () => null,
        create: async (p, body) => { created.push({ path: p, body }); return { path: p }; },
      },
      workspace: { openLinkText: (p) => { opened = p; } },
    };
    const inst = new ToDoLeafActionsClass();
    await inst.openCompletedTasks();
    assert(created.length === 1, 'exactly one vault.create: got ' + created.length);
    assert(created[0].path === 'spice/to-do/Completed Tasks.md',
      'path is spice/to-do/Completed Tasks.md: ' + created[0].path);
    assert(/TaskDoneArchive/.test(created[0].body), 'body embeds TaskDoneArchive: ' + created[0].body);
    assert(opened === 'spice/to-do/Completed Tasks.md', 'opens the note after create');
  });

  await okAsync('TLA-COMPLETED-2 an existing well-formed note is left alone (not overwritten)', async () => {
    const modified = [];
    let opened = null;
    const existingBody = '---\ntype: to-do-hub\n---\n\n```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "TaskDoneArchive" });\n```\n';
    global.window = { moment: () => ({ format: () => '2026-07-08T09:00:00-0600' }) };
    global.app = {
      vault: {
        getAbstractFileByPath: () => ({ path: 'spice/to-do/Completed Tasks.md' }),
        read: async () => existingBody,
        modify: async (f, body) => { modified.push(body); },
      },
      workspace: { openLinkText: (p) => { opened = p; } },
    };
    const inst = new ToDoLeafActionsClass();
    await inst.openCompletedTasks();
    assert(modified.length === 0, 'existing well-formed note left alone: got ' + modified.length + ' modify calls');
    assert(opened === 'spice/to-do/Completed Tasks.md', 'still opens note');
  });
}

// ---------- HC-TQC: TaskDialog.createQuick — modal-less one-file create ----------
//
// createQuick is the Home command center's inline "Jot a task…" capture path: a
// modal-less one-gesture task create that reuses the SAME single-file _create
// path. It grabs `app` from the runtime global (window.app / globalThis.app) and
// reaches the real TaskEntity via window.customJS.TaskEntity + window.moment. We
// stub those globals with a spying vault + a REAL TaskEntity instance (loaded from
// source) so we exercise the ACTUAL compose → dedupe → create path.
async function okAsync(name, fn) {
  try { await fn(); console.log('ok ' + name); passes++; }
  catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); fails++; }
}

// Build a fresh spying app.vault. `taken` decides which paths getAbstractFileByPath
// reports as existing (drives _uniqueName dedupe). Records every create call.
function makeQuickApp(taken) {
  const creates = [];
  const folders = [];
  return {
    _creates: creates,
    _folders: folders,
    vault: {
      getAbstractFileByPath: (p) => (taken && taken(p) ? { path: p } : null),
      createFolder: async (p) => { folders.push(p); },
      create: async (p, content) => { creates.push({ path: p, content }); return { path: p }; },
    },
  };
}

async function runCreateQuickTests() {
  // Real TaskEntity instance (customJS stores instances) + a deterministic moment.
  const TE = new TaskEntityClass();
  const momentStub = () => ({
    format: (f) => (f === 'YYYY-MM-DDTHH:mm:ssZ' ? '2026-07-02T09:00:00-06:00' : '2026-07-02'),
  });

  // Install the runtime globals createQuick / _create read.
  const prevWindow = global.window;
  const prevGlobalApp = global.app;

  await okAsync('HC-TQC-1 createQuick writes exactly ONE file at spice/tasks/<title>.md', async () => {
    const app = makeQuickApp(() => false);
    global.window = { app, customJS: { TaskEntity: TE }, moment: momentStub };
    const TD = new TaskDialogClass();
    await TD.createQuick({ title: 'call dentist', today: '2026-07-02', source: 'daily' });
    assert(app._creates.length === 1, 'exactly one vault.create: got ' + app._creates.length);
    assert(app._creates[0].path === 'spice/tasks/call dentist.md',
      'path is readable "<title>.md": ' + app._creates[0].path);
    const c = app._creates[0].content;
    assert(/\ntype: task\n/.test(c), 'content carries type: task');
    assert(/\nstatus: open\n/.test(c), 'content carries status: open');
    assert(/\ndue: 2026-07-02\n/.test(c), 'content carries due: 2026-07-02');
    assert(/\nsource: daily\n/.test(c), 'content carries source: daily');
  });

  await okAsync('HC-TQC-2 blank / whitespace title → zero creates (no-op)', async () => {
    const app = makeQuickApp(() => false);
    global.window = { app, customJS: { TaskEntity: TE }, moment: momentStub };
    const TD = new TaskDialogClass();
    await TD.createQuick({ title: '', today: '2026-07-02', source: 'daily' });
    await TD.createQuick({ title: '   ', today: '2026-07-02', source: 'daily' });
    await TD.createQuick({ today: '2026-07-02', source: 'daily' }); // no title key
    assert(app._creates.length === 0, 'blank titles create nothing: got ' + app._creates.length);
  });

  await okAsync('HC-TQC-3 filename collision dedupes to " 2.md"', async () => {
    // The base name is taken once → _uniqueName bumps to "call dentist 2.md".
    const app = makeQuickApp((p) => p === 'spice/tasks/call dentist.md');
    global.window = { app, customJS: { TaskEntity: TE }, moment: momentStub };
    const TD = new TaskDialogClass();
    await TD.createQuick({ title: 'call dentist', today: '2026-07-02', source: 'daily' });
    assert(app._creates.length === 1, 'still one create: got ' + app._creates.length);
    assert(app._creates[0].path === 'spice/tasks/call dentist 2.md',
      'deduped path: ' + app._creates[0].path);
  });

  await okAsync('HC-TQC-4 no app (cold load) → no-op, never throws', async () => {
    global.window = { app: null, customJS: { TaskEntity: TE }, moment: momentStub };
    const TD = new TaskDialogClass();
    // Should resolve without throwing and without creating anything.
    await TD.createQuick({ title: 'orphan', today: '2026-07-02', source: 'daily' });
  });

  await okAsync('PERF-1-QUICK-PLAN prepares the exact deduped row path and suppresses create reconciliation', async () => {
    const app = makeQuickApp((p) => p === 'spice/tasks/call dentist.md');
    global.window = { app, customJS: { TaskEntity: TE }, moment: momentStub };
    const TD = new TaskDialogClass();
    let reconciles = 0;
    TD._reconcileAfterCreate = () => { reconciles++; };
    const plan = TD.prepareQuick({ title: 'call dentist', parent_task: '[[Parent]]' });
    assert(plan && plan.path === 'spice/tasks/call dentist 2.md', 'plan owns exact deduped path: ' + JSON.stringify(plan && plan.path));
    assert(plan.task && plan.task.path === plan.path && plan.task.parent_task === '[[Parent]]',
      'optimistic task is a real row payload: ' + JSON.stringify(plan && plan.task));
    const result = await TD.createQuick({ plan, reconcile: false });
    assert(result && result.ok && result.path === plan.path, 'commit returns exact created path');
    assert(reconciles === 0, 'structural quick-create never schedules a global reconcile');
  });

  await okAsync('PERF-1-QUICK-COLLISION reserves distinct paths for concurrent sanitized-title collisions', async () => {
    const app = makeQuickApp(() => false);
    global.window = { app, customJS: { TaskEntity: TE }, moment: momentStub };
    const TD = new TaskDialogClass();
    const first = TD.prepareQuick({ title: 'A/B', parent_task: '[[Parent]]' });
    const second = TD.prepareQuick({ title: 'AB', parent_task: '[[Parent]]' });
    assert(first.path === 'spice/tasks/AB.md', 'first sanitized path: ' + first.path);
    assert(second.path === 'spice/tasks/AB 2.md', 'second in-flight path is deduped: ' + second.path);
    await Promise.all([
      TD.createQuick({ plan: first, reconcile: false }),
      TD.createQuick({ plan: second, reconcile: false }),
    ]);
    assert(app._creates.length === 2, 'both rapid submissions persist: ' + app._creates.length);
    assert(new Set(app._creates.map((entry) => entry.path)).size === 2, 'rapid creates own distinct paths');
  });

  await okAsync('PERF-1-QUICK-RETRY releases a failed plan reservation', async () => {
    const app = makeQuickApp(() => false);
    app.vault.create = async () => { throw new Error('write rejected'); };
    global.window = { app, customJS: { TaskEntity: TE }, moment: momentStub };
    const TD = new TaskDialogClass();
    const failed = TD.prepareQuick({ title: 'Retry me' });
    try { await TD.createQuick({ plan: failed, reconcile: false }); } catch (_e) {}
    const retry = TD.prepareQuick({ title: 'Retry me' });
    assert(retry.path === 'spice/tasks/Retry me.md', 'failed reservation released: ' + retry.path);
    TD.releaseQuickPlan(retry);
  });

  // Restore globals so nothing leaks into later modules.
  if (prevWindow === undefined) delete global.window; else global.window = prevWindow;
  if (prevGlobalApp === undefined) delete global.app; else global.app = prevGlobalApp;
}

// ---------- TaskDialog.markDone / markDeleted (path-based, no dialog) ----------
// These are the one-tap complete/delete internals surface widgets call (e.g.
// TaskTodayList's row checkbox → markDone) — they resolve { app, file } from
// window.app/globalThis.app, stamp frontmatter (status + completed_at / deleted),
// ensure the _done/_trash folder, and renameFile the note there. Exercised here
// through an INSTANCE (dialog.markDone(path)) with a spying app so the real
// frontmatter mutation + move + {ok} contract is asserted (not just the pure
// path helpers TD-4/TD-5).
function makeDialogApp(taskPath, initialFm) {
  const file = { path: taskPath, _fm: Object.assign({}, initialFm || {}) };
  const app = {
    _file: file,
    _renamed: null,
    _createdFolders: [],
    vault: {
      // Only the seeded task path resolves; the _done/_trash folder lookups
      // return null so _ensureFolder records a createFolder call.
      getAbstractFileByPath: (p) => (p === taskPath ? file : null),
      createFolder: async (p) => { app._createdFolders.push(p); },
    },
    fileManager: {
      processFrontMatter: async (f, fn) => { await fn(f._fm); },
      renameFile: async (f, newPath) => { app._renamed = { from: f.path, to: newPath }; f.path = newPath; },
    },
  };
  return app;
}

async function runMarkDoneDeletedTests() {
  const momentStub = () => ({
    format: (f) => (f === 'YYYY-MM-DDTHH:mm:ssZ' ? '2026-07-03T08:00:00-06:00' : '2026-07-03'),
  });
  const prevWindow = global.window;
  const prevGlobalApp = global.app;

  await okAsync('TD-MD-1 markDone stamps status=done + completed_at and moves the note into _done', async () => {
    const app = makeDialogApp('spice/tasks/task-x.md', { title: 'x', status: 'open' });
    global.window = { app, moment: momentStub };
    global.app = null;
    const dialog = new TaskDialogClass();
    const res = await dialog.markDone('spice/tasks/task-x.md');
    assert(res && res.ok === true, '{ok:true} expected, got ' + JSON.stringify(res));
    assert(app._file._fm.status === 'done', 'status→done: ' + app._file._fm.status);
    assert(typeof app._file._fm.completed_at === 'string' && app._file._fm.completed_at.length > 0,
      'completed_at stamped: ' + app._file._fm.completed_at);
    assert(app._renamed && app._renamed.to === 'spice/tasks/_done/task-x.md',
      'renamed into _done via donePath: ' + JSON.stringify(app._renamed));
    assert(app._createdFolders.includes('spice/tasks/_done'), '_done folder ensured: ' + JSON.stringify(app._createdFolders));
  });

  await okAsync('TD-SE-trip _saveEdit persists trip / trip_slug (parallel project), clears when absent', async () => {
    const app = makeDialogApp('spice/tasks/task-t.md', { title: 'x', status: 'open' });
    global.window = { app, moment: momentStub };
    global.app = null;
    const dialog = new TaskDialogClass();
    // Edit a task with a trip linkage → trip / trip_slug written to the note fm.
    await dialog._saveEdit(app, app._file, { title: 'Book hotel', trip: { name: 'Bussin', slug: 'bussin' } }, '');
    assert(app._file._fm.trip === '[[Bussin]]', 'trip wikilink written: ' + app._file._fm.trip);
    assert(app._file._fm.trip_slug === 'bussin', 'trip_slug survives edit: ' + app._file._fm.trip_slug);
    // A subsequent edit clearing the trip → both fields blanked (never left stale).
    await dialog._saveEdit(app, app._file, { title: 'Book hotel' }, '');
    assert(app._file._fm.trip === '' && app._file._fm.trip_slug === '',
      'trip cleared when absent: ' + JSON.stringify([app._file._fm.trip, app._file._fm.trip_slug]));
  });

  await okAsync('TD-MD-2 markDone with no app (cold load) → {ok:false, app unavailable}, never throws', async () => {
    global.window = { app: null };
    global.app = null;
    const dialog = new TaskDialogClass();
    const res = await dialog.markDone('spice/tasks/task-x.md');
    assert(res && res.ok === false && /app unavailable/.test(res.reason || ''),
      'expected app-unavailable, got ' + JSON.stringify(res));
  });

  await okAsync('TD-MD-3 markDone with an unknown path → {ok:false, task file not found}, no rename', async () => {
    const app = makeDialogApp('spice/tasks/task-x.md', { status: 'open' });
    global.window = { app, moment: momentStub };
    global.app = null;
    const dialog = new TaskDialogClass();
    const res = await dialog.markDone('spice/tasks/DOES-NOT-EXIST.md');
    assert(res && res.ok === false && /task file not found/.test(res.reason || ''),
      'expected file-not-found, got ' + JSON.stringify(res));
    assert(app._renamed === null, 'no rename when the file is missing');
    assert(app._file._fm.status === 'open', 'seeded note untouched: ' + app._file._fm.status);
  });

  await okAsync('TD-MD-4 markDeleted stamps status=deleted and moves the note into _trash', async () => {
    const app = makeDialogApp('spice/tasks/task-y.md', { status: 'open' });
    global.window = { app, moment: momentStub };
    global.app = null;
    const dialog = new TaskDialogClass();
    const res = await dialog.markDeleted('spice/tasks/task-y.md');
    assert(res && res.ok === true, '{ok:true} expected, got ' + JSON.stringify(res));
    assert(app._file._fm.status === 'deleted', 'status→deleted: ' + app._file._fm.status);
    assert(app._renamed && app._renamed.to === 'spice/tasks/_trash/task-y.md',
      'renamed into _trash via trashPath: ' + JSON.stringify(app._renamed));
    assert(app._createdFolders.includes('spice/tasks/_trash'), '_trash folder ensured: ' + JSON.stringify(app._createdFolders));
  });

  await okAsync('TD-MD-5 markDeleted with an unknown path → {ok:false, task file not found}, never throws', async () => {
    const app = makeDialogApp('spice/tasks/task-y.md', { status: 'open' });
    global.window = { app, moment: momentStub };
    global.app = null;
    const dialog = new TaskDialogClass();
    const res = await dialog.markDeleted('spice/tasks/nope.md');
    assert(res && res.ok === false && /task file not found/.test(res.reason || ''),
      'expected file-not-found, got ' + JSON.stringify(res));
    assert(app._renamed === null, 'no rename when the file is missing');
  });

  // Restore globals so nothing leaks into later modules.
  if (prevWindow === undefined) delete global.window; else global.window = prevWindow;
  if (prevGlobalApp === undefined) delete global.app; else global.app = prevGlobalApp;
}

// ---------- L2: optimistic row removal on complete (RTR-4..7 + RTR-CAP) ----------
// Drives the REAL renderTaskRow checkbox `change` handler against a self-contained
// DOM stub with true tree semantics (parentNode / nextSibling / insertBefore /
// remove) — the same faithful-not-replica discipline as RTR-3. The handler must
// detach the row BEFORE awaiting markDone (instant feedback) and re-insert it at
// its original index on {ok:false}/throw.
function makeTreeNode(tag) {
  const n = {
    tagName: String(tag || 'div').toUpperCase(),
    style: {}, dataset: {}, attributes: {}, type: '', checked: false, cls: '', className: '',
    _textContent: '', children: [], parentNode: null, _listeners: {},
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v == null ? '' : v); this.children = []; },
    createEl(t, opts) {
      const c = makeTreeNode(t);
      if (opts) {
        if (opts.cls) { c.cls = opts.cls; c.className = opts.cls; }
        if (opts.text != null) c.textContent = opts.text;
        if (opts.type) c.type = opts.type;
      }
      this.appendChild(c);
      return c;
    },
    createSpan(opts) { return this.createEl('span', opts); },
    createDiv(opts) { return this.createEl('div', opts); },
    appendText(v) { this.children.push({ tagName: '#text', textContent: String(v == null ? '' : v), parentNode: this }); },
    setText(v) { this.textContent = v; this.children = []; },
    empty() { this.children = []; },
    setAttribute(k, v) { this.attributes[k] = v; if (k === 'class') { this.cls = String(v); this.className = String(v); } },
    getAttribute(k) { return this.attributes[k]; },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) { const list = this._listeners[ev] || []; const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(node, ref) {
      node.parentNode = this;
      if (ref == null) { this.children.push(node); return node; }
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(node); else this.children.splice(i, 0, node);
      return node;
    },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); if (c) c.parentNode = null; return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    get nextSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return (i >= 0 && i + 1 < this.parentNode.children.length) ? this.parentNode.children[i + 1] : null;
    },
    get firstChild() { return this.children[0] || null; },
    get options() { return this.children.filter((child) => child.tagName === 'OPTION'); },
    classList: { add() {} },
    focus() { this._focusCount = (this._focusCount || 0) + 1; },
    click() {
      const event = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} };
      if (typeof this.onclick === 'function') return this.onclick(event);
      const listeners = this._listeners.click || [];
      return listeners[0] ? listeners[0](event) : undefined;
    },
    contains(candidate) {
      if (candidate === this) return true;
      return this.children.some((child) => child && typeof child.contains === 'function' && child.contains(candidate));
    },
    querySelector(selector) {
      const selectors = String(selector || '').split(',').map((value) => value.trim());
      const match = (node, part) => {
        if (part.startsWith('.')) return (` ${node.className || node.cls || ''} `).includes(` ${part.slice(1)} `);
        if (/^(input|select|textarea|button)/.test(part)) return node.tagName === part.match(/^\w+/)[0].toUpperCase() && !node.disabled;
        return node.tagName === part.toUpperCase();
      };
      const stack = this.children.slice();
      while (stack.length) {
        const node = stack.shift();
        if (selectors.some((part) => match(node, part))) return node;
        if (node && node.children) stack.unshift(...node.children);
      }
      return null;
    },
    querySelectorAll(selector) {
      const out = [];
      const stack = this.children.slice();
      while (stack.length) {
        const node = stack.shift();
        if (selector.startsWith('.') && (` ${node.className || node.cls || ''} `).includes(` ${selector.slice(1)} `)) out.push(node);
        if (node && node.children) stack.unshift(...node.children);
      }
      return out;
    },
    closest() { return null; },
  };
  n.classList = {
    add(...names) {
      const current = String(n.className || n.cls || '').split(/\s+/).filter(Boolean);
      for (const name of names) if (!current.includes(name)) current.push(name);
      n.className = current.join(' ');
      n.cls = n.className;
    },
  };
  return n;
}

async function runPerf1StructuralTests() {
  const prevWindow = global.window;
  const prevNotice = global.Notice;
  global.Notice = function () {};

  await okAsync('PERF-1-ADD shared seam inserts concurrent real rows, rolls back rejection, and never force-refreshes', async () => {
    const parentPage = { type: 'task', title: 'Parent', status: 'open', parent_task: '', file: { path: 'spice/tasks/Parent.md' } };
    const childPages = [
      { type: 'task', title: 'Existing', status: 'open', parent_task: 'Parent', file: { path: 'spice/tasks/Existing.md' } },
      { type: 'task', malformed: true, parent_task: 'Parent', file: { path: 'spice/tasks/Broken.md' } },
      { type: 'task', title: 'Stale done', status: 'open', parent_task: 'Parent', file: { path: 'spice/tasks/_done/Stale done.md' } },
    ];
    const commands = [];
    const pendingWrites = [];
    let seamCalls = 0;
    const TTL = {
      renderTaskRow(container, task) {
        const row = makeTreeNode('div');
        row.className = 'test-subtask-row';
        row._task = task;
        container.appendChild(row);
        return row;
      },
    };
    const TD = {
      prepareQuick(opts) {
        return { path: 'spice/tasks/' + opts.title + '.md', task: {
          title: opts.title, status: 'open', parent_task: opts.parent_task,
          path: 'spice/tasks/' + opts.title + '.md',
        } };
      },
      createQuick() {
        return new Promise((resolve, reject) => pendingWrites.push({ resolve, reject }));
      },
      markDone: async () => ({ ok: true }),
      confirmDelete: async () => ({ ok: false, cancelled: true }),
      open() {},
    };
    const RS = {
      page: () => parentPage,
      async mutateStructure(opts) {
        seamCalls++;
        try {
          const receipt = await opts.apply();
          try { return { ok: true, value: await opts.write() }; }
          catch (error) { await opts.rollback(receipt, error); return { ok: false, error }; }
        } catch (error) { return { ok: false, error }; }
      },
    };
    const TE = {
      parseNote(page) {
        if (page && page.malformed) throw new Error('malformed child');
        return {
          title: String((page && page.title) || ''), status: String((page && page.status) || 'open'),
          parent_task: String((page && page.parent_task) || ''), path: page && page.file && page.file.path,
          due: '', priority: '', project: '', source_note: '', created_at: '', links: [],
        };
      },
      _linkText: (value) => String(value || ''),
    };
    global.window = {
      app: { commands: { executeCommandById: (id) => commands.push(id) } },
      moment: () => ({ format: () => '2026-08-02' }),
      customJS: { RenderSafe: RS, TaskEntity: TE, TaskTodayList: TTL, TaskDialog: TD },
    };
    const container = makeTreeNode('div');
    container.closest = () => null;
    const dv = {
      container,
      current: () => parentPage,
      pages: () => ({ where: (predicate) => ({ array: () => childPages.filter(predicate) }) }),
    };
    await new TaskNoteViewClass().render(dv);
    const walk = (node, predicate, out) => {
      out = out || [];
      if (predicate(node)) out.push(node);
      for (const child of (node && node.children) || []) walk(child, predicate, out);
      return out;
    };
    const inputs = walk(container, (node) => node && node.tagName === 'INPUT' && node.placeholder === '+ Add subtask…');
    assert(inputs.length === 1, 'subtask input rendered despite malformed child');
    const input = inputs[0];
    const keydown = input._listeners.keydown && input._listeners.keydown[0];
    assert(typeof keydown === 'function', 'Enter handler is wired');
    const submit = (title) => {
      input.value = title;
      keydown({ key: 'Enter', isComposing: false, preventDefault() {} });
    };
    submit('First');
    await Promise.resolve();
    submit('Second');
    await Promise.resolve();
    let rows = walk(container, (node) => !!(node && node._task));
    assert(rows.map((row) => row._task.title).join(',') === 'Existing,First,Second',
      'malformed and stale _done child are absent while both pending rows are unique: ' + rows.map((row) => row._task.title));
    assert(input.value === '' && input._focusCount >= 2, 'every optimistic submit clears and refocuses immediately');
    pendingWrites[0].resolve({ ok: true });
    pendingWrites[1].resolve({ ok: true });
    await Promise.resolve(); await Promise.resolve();
    submit('Rejected');
    await Promise.resolve();
    assert(walk(container, (node) => node && node._task && node._task.title === 'Rejected').length === 1,
      'rejected row is visible before persistence settles');
    pendingWrites[2].reject(new Error('create failed'));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    rows = walk(container, (node) => node && node._task && node._task.title === 'Rejected');
    assert(rows.length === 0, 'rejected create removes the exact optimistic row');
    assert(input.value === 'Rejected' && input._focusCount >= 3, 'latest rejected title and focus are restored');
    assert(seamCalls === 3, 'every create uses mutateStructure: ' + seamCalls);
    assert(commands.length === 0, 'no dataview force-refresh command on structural success');
  });

  await okAsync('PERF1-PARTIAL-COLD-LOAD-PHANTOM fails closed before apply and succeeds once TaskEntity warms', async () => {
    const parentPage = { type: 'task', title: 'Parent', status: 'open', parent_task: '', file: { path: 'spice/tasks/Parent.md' } };
    const app = makeQuickApp(() => false);
    app.commands = { executeCommandById() { throw new Error('refresh forbidden'); } };
    let seamCalls = 0;
    const RS = {
      page: () => parentPage,
      async mutateStructure(opts) {
        seamCalls++;
        const receipt = await opts.apply();
        try { return { ok: true, value: await opts.write() }; }
        catch (error) { await opts.rollback(receipt, error); return { ok: false, error }; }
      },
    };
    const TTL = {
      renderTaskRow(container, task) {
        const row = makeTreeNode('div');
        row._task = task;
        container.appendChild(row);
        return row;
      },
    };
    const TE = new TaskEntityClass();
    const TD = new TaskDialogClass();
    global.window = {
      app,
      moment: () => ({ format: (f) => f === 'YYYY-MM-DDTHH:mm:ssZ' ? '2026-08-02T06:00:00-06:00' : '2026-08-02' }),
      customJS: { RenderSafe: RS, TaskEntity: TE, TaskTodayList: TTL, TaskDialog: TD },
    };
    const container = makeTreeNode('div');
    container.closest = () => null;
    const dv = {
      container,
      current: () => parentPage,
      pages: () => ({ where: () => ({ array: () => [] }) }),
    };
    await new TaskNoteViewClass().render(dv);
    const walk = (node, predicate, out) => {
      out = out || [];
      if (predicate(node)) out.push(node);
      for (const child of (node && node.children) || []) walk(child, predicate, out);
      return out;
    };
    const input = walk(container, (node) => node && node.tagName === 'INPUT' && node.placeholder === '+ Add subtask…')[0];
    const keydown = input && input._listeners.keydown && input._listeners.keydown[0];
    assert(typeof keydown === 'function', 'partial-load fixture owns the real Enter handler');

    delete global.window.customJS.TaskEntity;
    input.value = 'Cold child';
    keydown({ key: 'Enter', isComposing: false, preventDefault() {} });
    await Promise.resolve(); await Promise.resolve();
    assert(seamCalls === 0, 'missing TaskEntity refuses before optimistic apply');
    assert(app._creates.length === 0, 'missing TaskEntity writes no file');
    assert(walk(container, (node) => node && node._task).length === 0, 'no phantom optimistic row survives');
    assert(input.value === 'Cold child' && input._focusCount >= 1, 'typed input stays recoverable and focused');

    global.window.customJS.TaskEntity = TE;
    keydown({ key: 'Enter', isComposing: false, preventDefault() {} });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const rows = walk(container, (node) => node && node._task);
    assert(seamCalls === 1 && app._creates.length === 1, 'warm retry runs one structural mutation and one create');
    assert(rows.length === 1 && rows[0]._task.title === 'Cold child' && rows[0]._task.path === app._creates[0].path,
      'warm retry leaves exactly one real path-bound row');
    assert(input.value === '', 'warm success clears the recovered input');

    delete global.window.customJS.RenderSafe;
    input.value = 'Cold fallback';
    keydown({ key: 'Enter', isComposing: false, preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert(app._creates.length === 2 && app._creates[1].path === 'spice/tasks/Cold fallback.md',
      'fallback commits the already-reserved base path without suffix drift');
    assert(TD._quickCreateReservations && TD._quickCreateReservations.size === 0,
      'fallback releases the committed plan reservation');
    assert(input.value === '', 'fallback success clears input after persistence');
    global.window.customJS.RenderSafe = RS;

    let legacyWrites = 0;
    global.window.customJS.TaskDialog = {
      createQuick: async () => { legacyWrites++; return undefined; },
      markDone: async () => ({ ok: true }),
      confirmDelete: async () => ({ ok: false, cancelled: true }),
      open() {},
    };
    input.value = 'Legacy child';
    keydown({ key: 'Enter', isComposing: false, preventDefault() {} });
    await Promise.resolve(); await Promise.resolve();
    assert(legacyWrites === 0 && seamCalls === 1, 'dialog without prepareQuick fails before write or optimistic mutation');
    assert(walk(container, (node) => node && node._task).length === 1, 'legacy version skew leaves no phantom row');
    assert(input.value === 'Legacy child' && input._focusCount >= 3, 'legacy version skew preserves recoverable input and focus');

    global.window.customJS.TaskDialog = TD;
    keydown({ key: 'Enter', isComposing: false, preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
    const warmRows = walk(container, (node) => node && node._task);
    assert(app._creates.length === 3 && warmRows.length === 2, 'compatible warm retry performs exactly one write and one optimistic insert');
    assert(warmRows[1]._task.title === 'Legacy child' && warmRows[1]._task.path === app._creates[2].path,
      'compatible retry leaves one real path-bound legacy-skew row');

    const realRenderTaskRow = TTL.renderTaskRow;
    const rowsBeforeApplyFailure = walk(container, (node) => node && node._task);
    TTL.renderTaskRow = (rowContainer, task) => {
      const partial = makeTreeNode('div');
      partial._task = task;
      rowContainer.appendChild(partial);
      throw new Error('row render failed after append');
    };
    input.value = 'Apply failure';
    keydown({ key: 'Enter', isComposing: false, preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert(seamCalls === 3 && app._creates.length === 3, 'optimistic apply failure performs no write');
    assert(TD._quickCreateReservations && TD._quickCreateReservations.size === 0,
      'pre-write apply abandonment releases its reserved path');
    const rowsAfterApplyFailure = walk(container, (node) => node && node._task);
    assert(input.value === 'Apply failure'
      && rowsAfterApplyFailure.length === rowsBeforeApplyFailure.length
      && rowsAfterApplyFailure.every((row, index) => row === rowsBeforeApplyFailure[index]),
    'post-append apply failure preserves input and exact live row identities');

    TTL.renderTaskRow = realRenderTaskRow;
    keydown({ key: 'Enter', isComposing: false, preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
    const retryRows = walk(container, (node) => node && node._task);
    assert(seamCalls === 4 && app._creates.length === 4, 'post-abandonment retry writes exactly once');
    assert(app._creates[3].path === 'spice/tasks/Apply failure.md', 'retry reuses the unwritten base path without suffix drift');
    assert(retryRows.length === 3 && retryRows[2]._task.path === app._creates[3].path,
      'retry leaves exactly one real path-bound row');
  });

  await okAsync('PERF-1-DELETE shared seam removes before write and restores exact node/index/focus on rejection', async () => {
    let settleDelete;
    let seamCalls = 0;
    const RS = {
      async mutateStructure(opts) {
        seamCalls++;
        const receipt = await opts.apply();
        try { return { ok: true, value: await opts.write() }; }
        catch (error) { await opts.rollback(receipt, error); return { ok: false, error }; }
      },
    };
    const TD = {
      open() {},
      supportsDeferredDelete: () => true,
      confirmDelete: async (_path, opts) => ({ ok: !!(opts && opts.deferWrite), confirmed: true }),
      markDeleted: () => new Promise((resolve) => { settleDelete = resolve; }),
    };
    global.window = { app: { workspace: { openLinkText() {} }, commands: { executeCommandById() { throw new Error('refresh forbidden'); } } }, customJS: { RenderSafe: RS } };
    const container = makeTreeNode('div');
    const before = container.createEl('div');
    const row = TaskTodayList.renderTaskRow(container, { title: 'child', path: 'spice/tasks/child.md', status: 'open' }, TD);
    const after = container.createEl('div');
    const deleteButton = findByCls(row, 'sauce-task-action-delete');
    const pending = fireClick(deleteButton);
    await Promise.resolve(); await Promise.resolve();
    assert(childIndex(container, row) === -1, 'row detaches before markDeleted settles');
    settleDelete({ ok: false, reason: 'write rejected' });
    await pending;
    assert(container.children[0] === before && container.children[1] === row && container.children[2] === after,
      'rollback restores the exact row identity at its exact ordinal');
    assert(deleteButton._focusCount === 1, 'rollback restores focus to the delete control');
    assert(seamCalls === 1, 'delete uses mutateStructure exactly once');
  });

  await okAsync('PERF1-LEGACY-CONFIRM-DELETE-NO-DOUBLE-WRITE keeps legacy confirm-and-write atomic', async () => {
    let seamCalls = 0;
    let confirmWrites = 0;
    let duplicateWrites = 0;
    const RS = {
      async mutateStructure(opts) {
        seamCalls++;
        const receipt = await opts.apply();
        try { return { ok: true, value: await opts.write() }; }
        catch (error) { await opts.rollback(receipt, error); return { ok: false, error }; }
      },
    };
    const legacyTD = {
      open() {},
      confirmDelete: async () => { confirmWrites++; return { ok: true }; },
      markDeleted: async () => { duplicateWrites++; return { ok: false, reason: 'task file not found' }; },
    };
    global.window = {
      app: { workspace: { openLinkText() {} } },
      customJS: { RenderSafe: RS },
    };
    const container = makeTreeNode('div');
    const before = container.createEl('div');
    const row = TaskTodayList.renderTaskRow(container,
      { title: 'legacy child', path: 'spice/tasks/legacy child.md', status: 'open' }, legacyTD);
    const after = container.createEl('div');
    await fireClick(findByCls(row, 'sauce-task-action-delete'));
    assert(confirmWrites === 1 && duplicateWrites === 0,
      'legacy confirmation owns exactly one write and markDeleted is not called again');
    assert(seamCalls === 1 && childIndex(container, row) === -1,
      'confirmed legacy delete removes the row through the shared seam without stale rollback');
    assert(container.children[0] === before && container.children[1] === after,
      'legacy delete preserves sibling identity and order');
  });

  await okAsync('PERF1-NO-RENDERSAFE-DELETE-FAILURE-SILENCE reports result-level delete failure', async () => {
    const notices = [];
    let markCalls = 0;
    global.Notice = function (message) { notices.push(String(message)); };
    const currentTD = {
      open() {},
      supportsDeferredDelete: () => true,
      confirmDelete: async (_path, opts) => ({ ok: !!(opts && opts.deferWrite), confirmed: true, deferred: true }),
      markDeleted: async () => { markCalls++; return { ok: false, reason: 'write rejected' }; },
    };
    global.window = {
      app: { workspace: { openLinkText() {} } },
      customJS: {},
    };
    const container = makeTreeNode('div');
    const before = container.createEl('div');
    const row = TaskTodayList.renderTaskRow(container,
      { title: 'current child', path: 'spice/tasks/current child.md', status: 'open' }, currentTD);
    const after = container.createEl('div');
    await fireClick(findByCls(row, 'sauce-task-action-delete'));
    assert(markCalls === 1, 'no-RenderSafe fallback calls markDeleted exactly once');
    assert(container.children[0] === before && container.children[1] === row && container.children[2] === after,
      'result-level delete failure leaves the exact row and sibling order intact');
    assert(notices.length === 1 && notices[0].includes('Could not delete task: write rejected'),
      'result-level delete failure emits one explicit reason-bound notice: ' + JSON.stringify(notices));

    currentTD.markDeleted = async () => { markCalls++; return { ok: true }; };
    const successRow = TaskTodayList.renderTaskRow(container,
      { title: 'successful child', path: 'spice/tasks/successful child.md', status: 'open' }, currentTD);
    const successAfter = container.createEl('div');
    await fireClick(findByCls(successRow, 'sauce-task-action-delete'));
    assert(markCalls === 2 && childIndex(container, successRow) === -1,
      'no-RenderSafe ok:true calls markDeleted once and removes its exact row');
    assert(childIndex(container, row) >= 0 && childIndex(container, successAfter) >= 0 && notices.length === 1,
      'successful fallback preserves other rows/siblings and emits no failure notice');

    currentTD.markDeleted = async () => { markCalls++; throw new Error('delete exploded'); };
    const throwBefore = container.createEl('div');
    const throwRow = TaskTodayList.renderTaskRow(container,
      { title: 'throwing child', path: 'spice/tasks/throwing child.md', status: 'open' }, currentTD);
    const throwAfter = container.createEl('div');
    await fireClick(findByCls(throwRow, 'sauce-task-action-delete'));
    assert(markCalls === 3 && childIndex(container, throwRow) >= 0,
      'no-RenderSafe throw calls markDeleted once and leaves its exact row intact');
    assert(childIndex(container, throwBefore) < childIndex(container, throwRow)
      && childIndex(container, throwRow) < childIndex(container, throwAfter),
    'thrown delete preserves exact sibling order');
    assert(notices.length === 2 && notices[1].includes('Could not delete task: delete exploded'),
      'thrown delete emits exactly one additional reason-bound notice: ' + JSON.stringify(notices));
    global.Notice = function () {};
  });

  global.window = prevWindow;
  global.Notice = prevNotice;
}
function findInput(node) {
  if (!node || !node.children) return null;
  for (const c of node.children) { if (c.tagName === 'INPUT') return c; const d = findInput(c); if (d) return d; }
  return null;
}
function fireChange(cb) { const fns = (cb._listeners && cb._listeners.change) || []; return fns[0] ? fns[0]() : Promise.resolve(); }

async function runOptimisticRemovalTests() {
  const prevWindow = global.window;
  const prevNotice = global.Notice;

  await okAsync('RTR-4 complete detaches the row BEFORE markDone is awaited, stays removed on ok', async () => {
    global.window = { customJS: { RenderSafe: { captureScroll: () => {} } } };
    const container = makeTreeNode('div');
    let removedAtCall = null, resolveMD;
    const TD = { markDone: () => { removedAtCall = (container.children.indexOf(row) < 0); return new Promise((r) => { resolveMD = () => r({ ok: true }); }); } };
    const row = TaskTodayList.renderTaskRow(container, { title: 'x', path: 'spice/tasks/x.md' }, TD);
    const cb = findInput(row); cb.checked = true;
    const p = fireChange(cb);
    assert(removedAtCall === true, 'row detached BEFORE markDone awaited');
    resolveMD(); await p;
    assert(container.children.indexOf(row) < 0, 'row stays removed on success');
  });

  await okAsync('RTR-5 {ok:false} re-inserts the row at its original index + unchecks + Notice', async () => {
    const notices = [];
    global.window = { customJS: { RenderSafe: { captureScroll: () => {} } } };
    global.Notice = function (m) { notices.push(String(m)); };
    const container = makeTreeNode('div');
    let resolveMD;
    const TD = { markDone: () => new Promise((r) => { resolveMD = () => r({ ok: false, reason: 'collision' }); }) };
    const row = TaskTodayList.renderTaskRow(container, { title: 'x', path: 'p.md' }, TD);
    const sib = container.createEl('div');           // sibling after the row
    const cb = findInput(row); cb.checked = true;
    const p = fireChange(cb);
    assert(container.children.indexOf(row) < 0, 'row removed during the pending write');
    resolveMD(); await p;
    assert(container.children.indexOf(row) === 0, 're-inserted at original index (before sibling)');
    assert(container.children.indexOf(sib) === 1, 'sibling order preserved');
    assert(cb.checked === false, 'unchecked on failure');
    assert(notices.some((m) => /complete/i.test(m)), 'Notice shown: ' + JSON.stringify(notices));
  });

  await okAsync('RTR-6 markDone throwing re-inserts + unchecks (no unhandled rejection)', async () => {
    global.window = { customJS: { RenderSafe: { captureScroll: () => {} } } };
    global.Notice = function () {};
    const container = makeTreeNode('div');
    const TD = { markDone: async () => { throw new Error('boom'); } };
    const row = TaskTodayList.renderTaskRow(container, { title: 'x', path: 'p.md' }, TD);
    const cb = findInput(row); cb.checked = true;
    await fireChange(cb);
    assert(container.children.indexOf(row) === 0 && cb.checked === false, 'reverted on throw');
  });

  await okAsync('RTR-7 cold load (no TD) unchecks, no removal, no throw', async () => {
    global.window = { customJS: {} };
    const container = makeTreeNode('div');
    const row = TaskTodayList.renderTaskRow(container, { title: 'x', path: 'p.md' }, null);
    const cb = findInput(row); cb.checked = true;
    await fireChange(cb);
    assert(container.children.indexOf(row) === 0 && cb.checked === false, 'no-op revert (row untouched)');
  });

  await okAsync('RTR-CAP captureScroll is invoked before markDone', async () => {
    const events = [];
    global.window = { customJS: { RenderSafe: { captureScroll: () => events.push('capture') } } };
    const container = makeTreeNode('div');
    const TD = { markDone: async () => { events.push('markDone'); return { ok: true }; } };
    const row = TaskTodayList.renderTaskRow(container, { title: 'x', path: 'p.md' }, TD);
    const cb = findInput(row); cb.checked = true;
    await fireChange(cb);
    assert(events[0] === 'capture' && events.indexOf('markDone') > 0, 'captureScroll ran before markDone: ' + JSON.stringify(events));
  });

  global.window = prevWindow;
  global.Notice = prevNotice;
}

// ---------- Row action icons: edit + delete (RACT-1..6) ----------
// renderTaskRow now draws two subtle right-aligned action buttons AFTER the chips:
// an EDIT icon (opens the TaskDialog edit dialog — NOT the note) and a DELETE icon
// (opens TaskDialog.confirmDelete → on confirm the row is removed optimistically).
// This is the shared row renderer used by EVERY surface (daily / meeting / project),
// so one wiring test covers them all. Drives the REAL renderTaskRow against the
// faithful tree stub + TD spies (same discipline as RTR-3 / the optimistic RTR-4..7).
function findByCls(node, cls) {
  if (!node || !node.children) return null;
  for (const c of node.children) {
    const classes = String((c && (c.className || c.cls)) || '').split(/\s+/);
    if (c && classes.includes(cls)) return c;
    const d = findByCls(c, cls); if (d) return d;
  }
  return null;
}
function fireClick(el) {
  const fns = (el && el._listeners && el._listeners.click) || [];
  const event = { target: el, currentTarget: el, preventDefault() {}, stopPropagation() {} };
  if (fns[0]) return fns[0](event);
  return el && typeof el.onclick === 'function' ? el.onclick(event) : undefined;
}
function childIndex(parent, node) { return (parent && parent.children) ? parent.children.indexOf(node) : -1; }

async function runRowActionTests() {
  const prevWindow = global.window;
  const prevNotice = global.Notice;
  global.Notice = function () {};

  await okAsync('RACT-1 renderTaskRow draws edit + delete action buttons, edit before delete, at the far right', async () => {
    global.window = { app: { workspace: { openLinkText() {} } } };
    const container = makeTreeNode('div');
    const TD = { open() {}, confirmDelete: async () => ({ ok: false }) };
    const row = TaskTodayList.renderTaskRow(container, { title: 'x', path: 'spice/tasks/x.md' }, TD);
    const actions = findByCls(row, 'sauce-task-today-actions');
    assert(actions, 'actions group rendered');
    // Chips + actions live in a right cluster that is the LAST child of the row
    // (the far-right end / far-right wrapped line); actions is the far-right element
    // WITHIN that cluster.
    const cluster = findByCls(row, 'sauce-task-today-right');
    assert(cluster, 'right cluster rendered');
    assert(row.children[row.children.length - 1] === cluster,
      'right cluster is the row far-right (idx ' + childIndex(row, cluster) + '/' + (row.children.length - 1) + ')');
    assert(cluster.children[cluster.children.length - 1] === actions,
      'actions are the far-right element of the cluster');
    const edit = findByCls(actions, 'sauce-task-action-edit');
    const del = findByCls(actions, 'sauce-task-action-delete');
    assert(edit && del, 'both edit + delete buttons present');
    assert(childIndex(actions, edit) < childIndex(actions, del), 'edit is LEFT of delete');
    assert(edit.tagName === 'BUTTON' && del.tagName === 'BUTTON', 'both are <button>');
    assert(edit.attributes['aria-label'] === 'Edit task', 'edit aria-label: ' + edit.attributes['aria-label']);
    assert(del.attributes['aria-label'] === 'Delete task', 'delete aria-label: ' + del.attributes['aria-label']);
  });

  await okAsync('RACT-2 edit click opens the edit DIALOG (TD.open{edit}), not the note, not confirmDelete', async () => {
    const opened = [], openedNote = [], confirmed = [];
    global.window = { app: { workspace: { openLinkText: (t) => openedNote.push(t) } } };
    const container = makeTreeNode('div');
    const path = 'spice/tasks/go through mail.md';
    const TD = { open: (a) => opened.push(a), confirmDelete: async (p) => { confirmed.push(p); return { ok: false }; } };
    const row = TaskTodayList.renderTaskRow(container, { title: 'go through mail', path }, TD);
    await fireClick(findByCls(row, 'sauce-task-action-edit'));
    assert(opened.length === 1 && opened[0] && opened[0].edit === path, 'edit → TD.open({edit: path}): ' + JSON.stringify(opened));
    assert(openedNote.length === 0, 'edit must NOT open the note: ' + JSON.stringify(openedNote));
    assert(confirmed.length === 0, 'edit must NOT confirmDelete');
  });

  await okAsync('RACT-3 delete click routes to TD.confirmDelete(path), not TD.open, not the note', async () => {
    const opened = [], openedNote = [], confirmed = [];
    global.window = { app: { workspace: { openLinkText: (t) => openedNote.push(t) } } };
    const container = makeTreeNode('div');
    const path = 'spice/tasks/x.md';
    const TD = { open: (a) => opened.push(a), confirmDelete: async (p) => { confirmed.push(p); return { ok: false, cancelled: true }; } };
    const row = TaskTodayList.renderTaskRow(container, { title: 'x', path }, TD);
    await fireClick(findByCls(row, 'sauce-task-action-delete'));
    assert(confirmed.length === 1 && confirmed[0] === path, 'delete → confirmDelete(path): ' + JSON.stringify(confirmed));
    assert(opened.length === 0, 'delete must NOT open the edit dialog');
    assert(openedNote.length === 0, 'delete must NOT open the note');
  });

  await okAsync('RACT-4 delete CONFIRMED (ok:true) removes the row; sibling preserved', async () => {
    global.window = { app: { workspace: { openLinkText() {} } }, customJS: { RenderSafe: { captureScroll: () => {} } } };
    const container = makeTreeNode('div');
    const TD = { open() {}, confirmDelete: async () => ({ ok: true }) };
    const row = TaskTodayList.renderTaskRow(container, { title: 'x', path: 'p.md' }, TD);
    const sib = container.createEl('div');
    assert(childIndex(container, row) === 0, 'row present before delete');
    await fireClick(findByCls(row, 'sauce-task-action-delete'));
    assert(childIndex(container, row) < 0, 'row removed after confirmed delete');
    assert(childIndex(container, sib) >= 0, 'sibling preserved');
  });

  await okAsync('RACT-5 delete CANCELLED (ok:false) leaves the row in place', async () => {
    global.window = { app: { workspace: { openLinkText() {} } }, customJS: { RenderSafe: { captureScroll: () => {} } } };
    const container = makeTreeNode('div');
    const TD = { open() {}, confirmDelete: async () => ({ ok: false, cancelled: true }) };
    const row = TaskTodayList.renderTaskRow(container, { title: 'x', path: 'p.md' }, TD);
    await fireClick(findByCls(row, 'sauce-task-action-delete'));
    assert(childIndex(container, row) === 0, 'row stays after cancel');
  });

  await okAsync('RACT-6 cold load (no TaskDialog) — edit + delete clicks no-op, never throw', async () => {
    global.window = { customJS: {}, app: { workspace: { openLinkText() {} } } };
    const container = makeTreeNode('div');
    const row = TaskTodayList.renderTaskRow(container, { title: 'x', path: 'p.md' }, null);
    let threw = false;
    try { await fireClick(findByCls(row, 'sauce-task-action-edit')); await fireClick(findByCls(row, 'sauce-task-action-delete')); }
    catch (_e) { threw = true; }
    assert(!threw, 'no throw on cold-load clicks');
    assert(childIndex(container, row) === 0, 'row untouched');
  });

  global.window = prevWindow;
  global.Notice = prevNotice;
}

// ---------- TD-1a3 quick reschedule + completed-row exclusion ----------
async function runTomorrowActionTests() {
  const prevWindow = global.window;
  const prevGlobalApp = global.app;
  const prevNotice = global.Notice;
  global.Notice = function () {};

  await okAsync('TD1A-SHARED-OPEN-ROW writes nextDay(viewedDay) and removes only its row optimistically', async () => {
    const viewedDay = '2026-01-31';
    const path = 'spice/tasks/x.md';
    const file = { path, _fm: { status: 'open', due: viewedDay, untouched: 'yes' } };
    let resolveWrite;
    const app = {
      vault: { getAbstractFileByPath: (p) => (p === path ? file : null) },
      fileManager: {
        processFrontMatter(f, mutate) {
          assert(f === file, 'processFrontMatter receives the exact resolved task file');
          mutate(f._fm);
          return new Promise((resolve) => { resolveWrite = resolve; });
        },
      },
      workspace: { openLinkText() {} },
    };
    global.window = {
      app,
      customJS: { TaskDialog: { open() {} }, RenderSafe: { captureScroll() {} } },
      moment: () => ({ format: () => '2099-12-31' }),
    };
    global.app = null;

    const container = makeTreeNode('div');
    const row = TaskTodayList.renderTaskRow(
      container,
      { title: 'x', path, due: viewedDay, status: 'open' },
      null,
      { viewedDay }
    );
    const sibling = container.createEl('div', { cls: 'sibling' });
    const tomorrow = findByCls(row, 'sauce-task-action-tomorrow');
    assert(tomorrow, 'open row exposes Move to tomorrow');
    const pending = fireClick(tomorrow);
    assert(file._fm.due === '2026-02-01',
      'writes from viewed day rather than wall clock: ' + file._fm.due);
    assert(file._fm.untouched === 'yes', 'unrelated frontmatter remains byte-identical');
    assert(childIndex(container, row) < 0, 'activated row removed before write settles');
    assert(childIndex(container, sibling) === 0, 'sibling remains present');
    resolveWrite();
    await pending;
    assert(childIndex(container, row) < 0, 'row stays removed after success');
  });

  await okAsync('TD1A-SHARED-ROLLBACK restores the row at its exact position on mutation failure', async () => {
    const path = 'spice/tasks/fail.md';
    const file = { path, _fm: { status: 'open', due: '2026-12-31' } };
    global.window = {
      app: {
        vault: { getAbstractFileByPath: () => file },
        fileManager: { processFrontMatter: async (f, mutate) => { mutate(f._fm); throw new Error('write failed'); } },
        workspace: { openLinkText() {} },
      },
      customJS: { TaskDialog: { open() {} }, RenderSafe: { captureScroll() {} } },
    };
    const container = makeTreeNode('div');
    const row = TaskTodayList.renderTaskRow(
      container,
      { title: 'fail', path, due: '2026-12-31', status: 'open' },
      null,
      { viewedDay: '2026-12-31' }
    );
    const sibling = container.createEl('div');
    await fireClick(findByCls(row, 'sauce-task-action-tomorrow'));
    assert(childIndex(container, row) === 0, 'failed row restored before its original sibling');
    assert(childIndex(container, sibling) === 1, 'sibling order preserved');
  });

  await okAsync('TD1A4-DUPLICATE-ACTIVATION-MIXED-OUTCOME suppresses a second same-task write and permits retry after failure', async () => {
    const path = 'spice/tasks/duplicate-activation.md';
    const task = { title: 'duplicate activation', path, due: '2026-07-27', status: 'open' };
    const file = { path, _fm: { status: 'open', due: '2026-07-27' } };
    let writes = 0;
    let rejectFirst;
    global.window = {
      app: {
        vault: { getAbstractFileByPath: (candidate) => (candidate === path ? file : null) },
        fileManager: {
          processFrontMatter: (resolved, mutate) => {
            writes++;
            mutate(resolved._fm);
            if (writes === 1) {
              return new Promise((_resolve, reject) => { rejectFirst = reject; });
            }
            return Promise.resolve();
          },
        },
        workspace: { openLinkText() {} },
      },
      customJS: { TaskDialog: { open() {} }, RenderSafe: { captureScroll() {} } },
    };

    // Browser-strict: inserting against a detached saved anchor throws instead
    // of silently appending, matching real DOM insertBefore semantics.
    const container = makeTreeNode('div');
    const permissiveInsertBefore = container.insertBefore;
    container.insertBefore = function strictInsertBefore(node, ref) {
      if (ref != null && ref.parentNode !== this) {
        throw new Error('NotFoundError: reference node is not a child');
      }
      return permissiveInsertBefore.call(this, node, ref);
    };
    const row = TaskTodayList.renderTaskRow(
      container,
      task,
      null,
      { viewedDay: '2026-07-27' }
    );
    const sibling = container.createEl('div');

    const firstPending = TaskTodayList.rescheduleTomorrow(row, task, '2026-07-27');
    assert(writes === 1 && childIndex(container, row) < 0,
      'first activation starts one write and removes the row optimistically');

    // Invoke the canonical method again while the first write is unresolved.
    // Without synchronous ownership this starts a second write that succeeds,
    // then the first failure restores a stale row despite that mixed success.
    const duplicateResult = await TaskTodayList.rescheduleTomorrow(row, task, '2026-07-27');
    rejectFirst(new Error('first write failed after duplicate activation'));
    const firstResult = await firstPending;

    assert(writes === 1,
      'duplicate activation is a no-op while the same task path is in flight: writes=' + writes);
    assert(duplicateResult && duplicateResult.no_op === true,
      'duplicate activation reports a no-op instead of a mixed success: ' + JSON.stringify(duplicateResult));
    assert(firstResult && firstResult.ok === false,
      'the authoritative first failure is reported: ' + JSON.stringify(firstResult));
    assert(childIndex(container, row) === 0 && childIndex(container, sibling) === 1,
      'authoritative failure restores the original row exactly once');

    // The failed operation must release ownership synchronously on settlement:
    // a deliberate retry is a real write and becomes the authoritative success.
    const retryResult = await TaskTodayList.rescheduleTomorrow(row, task, '2026-07-27');
    assert(writes === 2, 'legitimate retry starts exactly one new write: writes=' + writes);
    assert(retryResult && retryResult.ok === true,
      'legitimate retry succeeds after failure: ' + JSON.stringify(retryResult));
    assert(childIndex(container, row) < 0 && childIndex(container, sibling) === 0,
      'successful retry removes only the retried task row');
  });

  await okAsync('TD1A4-COMPLETED-DIRECT-MUTATION-UNBOUND rejects direct done and archived task mutations', async () => {
    let writes = 0;
    const files = new Map([
      ['spice/tasks/_done/done.md', { path: 'spice/tasks/_done/done.md', _fm: { due: '2026-07-27' } }],
      ['spice/tasks/_done/archived.md', { path: 'spice/tasks/_done/archived.md', _fm: { due: '2026-07-27' } }],
    ]);
    global.window = {
      app: {
        vault: { getAbstractFileByPath: (path) => files.get(path) || null },
        fileManager: {
          processFrontMatter: async (file, mutate) => {
            writes++;
            mutate(file._fm);
          },
        },
        workspace: { openLinkText() {} },
      },
      customJS: { TaskDialog: { open() {} }, RenderSafe: { captureScroll() {} } },
    };
    const TD = global.window.customJS.TaskDialog;
    const TaskDoneTodayListClass = loadClass(
      'mechanisms/task-entity/task-done-today-list.js', 'TaskDoneTodayList');
    const TaskDoneArchiveClass = loadClass(
      'blueprints/to-do/helpers/task-done-archive.js', 'TaskDoneArchive');
    const doneToday = new TaskDoneTodayListClass().filterToday([
      {
        title: 'Done',
        path: 'spice/tasks/_done/done.md',
        due: '2026-07-27',
        status: 'done',
        completed_at: '2026-07-27',
      },
    ], '2026-07-27');
    const archived = new TaskDoneArchiveClass().groupByDate([
      {
        title: 'Archived',
        path: 'spice/tasks/_done/archived.md',
        due: '2026-07-27',
        status: 'done',
        completed_at: '2026-07-20',
      },
    ]).get('2026-07-20');
    assert(doneToday.length === 1 && archived.length === 1,
      'real completed helpers produce one done and one archived task');
    const tasks = doneToday.concat(archived);

    for (const task of tasks) {
      const container = makeTreeNode('div');
      const row = container.createEl('div');
      const result = await TaskTodayList.rescheduleTomorrow(row, task, '2026-07-27', TD);
      assert(result && result.ok === false && result.no_op === true,
        'direct non-open mutation is a no-op for ' + task.path + ': ' + JSON.stringify(result));
      assert(childIndex(container, row) === 0 && row.parentNode === container,
        'direct non-open mutation leaves the row in place for ' + task.path);
    }
    assert(writes === 0, 'direct done/archive calls perform zero writes: ' + writes);
    assert(files.get('spice/tasks/_done/done.md')._fm.due === '2026-07-27'
      && files.get('spice/tasks/_done/archived.md')._fm.due === '2026-07-27',
      'direct done/archive calls leave frontmatter unchanged');
  });

  await okAsync('TD1A8-STALE-OPEN-COMPLETION-RACE revalidates live status atomically and releases ownership', async () => {
    const liveStatuses = ['done', 'deleted', null];
    const notices = [];
    global.Notice = function (message) { notices.push(String(message)); };

    for (const liveStatus of liveStatuses) {
      const suffix = liveStatus || 'missing';
      const path = `spice/tasks/stale-open-${suffix}.md`;
      const liveFrontmatter = {
        status: liveStatus,
        due: '2026-07-27',
        untouched: `keep-${suffix}`,
      };
      if (liveStatus === null) delete liveFrontmatter.status;
      const file = { path, _fm: liveFrontmatter };
      let writes = 0;
      global.window = {
        app: {
          vault: { getAbstractFileByPath: (candidate) => (candidate === path ? file : null) },
          fileManager: {
            processFrontMatter: async (resolved, mutate) => {
              writes++;
              mutate(resolved._fm);
            },
          },
          workspace: { openLinkText() {} },
        },
        customJS: { TaskDialog: { open() {} }, RenderSafe: { captureScroll() {} } },
      };
      const task = { title: `stale ${suffix}`, path, due: '2026-07-27', status: 'open' };
      const container = makeTreeNode('div');
      const row = TaskTodayList.renderTaskRow(
        container,
        task,
        null,
        { viewedDay: '2026-07-27' }
      );
      const sibling = container.createEl('div');
      const before = JSON.stringify(file._fm);

      const result = await TaskTodayList.rescheduleTomorrow(row, task, '2026-07-27');

      assert(writes === 1, `stale ${suffix} reaches exactly one atomic frontmatter callback`);
      assert(JSON.stringify(file._fm) === before,
        `stale ${suffix} leaves due and all live frontmatter unchanged: ${JSON.stringify(file._fm)}`);
      assert(result && result.ok === false && result.no_op === true
        && result.reason === 'task is no longer open'
        && result.live_status === suffix,
      `stale ${suffix} reports a clear silent no-op: ${JSON.stringify(result)}`);
      assert(childIndex(container, row) === 0 && childIndex(container, sibling) === 1,
        `stale ${suffix} restores the optimistically removed row at its exact position`);
      assert(notices.length === 0, `stale ${suffix} emits no failure Notice`);

      // A live transition back to open is deliberately synthetic, but proves
      // the no-op settled and released same-path in-flight ownership.
      file._fm.status = 'open';
      const retry = await TaskTodayList.rescheduleTomorrow(row, task, '2026-07-27');
      assert(writes === 2 && retry && retry.ok === true,
        `stale ${suffix} releases ownership for a later valid retry: ${JSON.stringify(retry)}`);
      assert(file._fm.due === '2026-07-28',
        `valid retry after stale ${suffix} writes tomorrow`);
      assert(childIndex(container, row) < 0 && childIndex(container, sibling) === 0,
        `valid retry after stale ${suffix} removes only its task row`);
    }

    global.Notice = function () {};
  });

  await okAsync('TD1A-SHARED-CONCURRENT-ROLLBACK restores adjacent failures when the saved anchor is detached', async () => {
    const paths = ['spice/tasks/first.md', 'spice/tasks/second.md'];
    const files = new Map(paths.map((path) => [path, { path, _fm: { status: 'open', due: '2026-07-27' } }]));
    const rejectWrites = new Map();
    global.window = {
      app: {
        vault: { getAbstractFileByPath: (path) => files.get(path) || null },
        fileManager: {
          processFrontMatter: (file, mutate) => {
            mutate(file._fm);
            return new Promise((_resolve, reject) => { rejectWrites.set(file.path, reject); });
          },
        },
        workspace: { openLinkText() {} },
      },
      customJS: { TaskDialog: { open() {} }, RenderSafe: { captureScroll() {} } },
    };

    const container = makeTreeNode('div');
    const permissiveInsertBefore = container.insertBefore;
    container.insertBefore = function strictInsertBefore(node, ref) {
      if (ref != null && ref.parentNode !== this) {
        throw new Error('NotFoundError: reference node is not a child');
      }
      return permissiveInsertBefore.call(this, node, ref);
    };
    const first = TaskTodayList.renderTaskRow(
      container,
      { title: 'first', path: paths[0], due: '2026-07-27', status: 'open' },
      null,
      { viewedDay: '2026-07-27' }
    );
    const second = TaskTodayList.renderTaskRow(
      container,
      { title: 'second', path: paths[1], due: '2026-07-27', status: 'open' },
      null,
      { viewedDay: '2026-07-27' }
    );

    const firstPending = fireClick(findByCls(first, 'sauce-task-action-tomorrow'));
    const secondPending = fireClick(findByCls(second, 'sauce-task-action-tomorrow'));
    assert(container.children.length === 0,
      'both adjacent final rows are removed while their writes are pending');

    // Fail the first write while its immediate saved anchor (second) is still
    // detached. A real DOM insertBefore throws here; rollback must find a valid
    // surviving anchor instead of swallowing the error and losing the row.
    rejectWrites.get(paths[0])(new Error('first write failed'));
    await firstPending;
    assert(childIndex(container, first) === 0,
      'first failed row restores even though its immediate anchor is detached');

    rejectWrites.get(paths[1])(new Error('second write failed'));
    await secondPending;
    assert(container.children.length === 2,
      'both failed rows restore exactly once: ' + container.children.length);
    assert(container.children[0] === first && container.children[1] === second,
      'concurrent rollback preserves original first, second order without a surviving anchor');
  });

  await okAsync('TD1A-SHARED-RERENDER-ROLLBACK does not duplicate a replacement row after rerender', async () => {
    const path = 'spice/tasks/rerendered.md';
    const file = { path, _fm: { status: 'open', due: '2026-07-27' } };
    let rejectWrite;
    global.window = {
      app: {
        vault: { getAbstractFileByPath: () => file },
        fileManager: {
          processFrontMatter: (resolved, mutate) => {
            mutate(resolved._fm);
            return new Promise((_resolve, reject) => { rejectWrite = reject; });
          },
        },
        workspace: { openLinkText() {} },
      },
      customJS: { TaskDialog: { open() {} }, RenderSafe: { captureScroll() {} } },
    };

    const container = makeTreeNode('div');
    const original = TaskTodayList.renderTaskRow(
      container,
      { title: 'rerendered', path, due: '2026-07-27', status: 'open' },
      null,
      { viewedDay: '2026-07-27' }
    );
    const pending = fireClick(findByCls(original, 'sauce-task-action-tomorrow'));
    assert(container.children.length === 0, 'original row is removed while write is pending');

    // Simulate Dataview rebuilding this list while the write is in flight.
    const replacement = TaskTodayList.renderTaskRow(
      container,
      { title: 'rerendered', path, due: '2026-07-27', status: 'open' },
      null,
      { viewedDay: '2026-07-27' }
    );
    rejectWrite(new Error('write failed after rerender'));
    await pending;
    assert(container.children.length === 1 && container.children[0] === replacement,
      'rollback recognizes the rerendered replacement and never inserts a stale duplicate');
  });

  await okAsync('TD1A4-DETACHED-TREE-ROLLBACK-UNBOUND never restores into a disconnected old Dataview tree', async () => {
    const path = 'spice/tasks/detached-tree.md';
    const task = { title: 'detached tree', path, due: '2026-07-27', status: 'open' };
    const file = { path, _fm: { status: 'open', due: '2026-07-27' } };
    let rejectWrite;
    let writes = 0;
    global.window = {
      app: {
        vault: { getAbstractFileByPath: (candidate) => (candidate === path ? file : null) },
        fileManager: {
          processFrontMatter: (resolved, mutate) => {
            writes++;
            mutate(resolved._fm);
            return new Promise((_resolve, reject) => { rejectWrite = reject; });
          },
        },
        workspace: { openLinkText() {} },
      },
      customJS: { TaskDialog: { open() {} }, RenderSafe: { captureScroll() {} } },
    };

    const oldContainer = makeTreeNode('div');
    oldContainer.isConnected = true;
    const original = TaskTodayList.renderTaskRow(
      oldContainer,
      task,
      null,
      { viewedDay: '2026-07-27' }
    );
    const pending = TaskTodayList.rescheduleTomorrow(original, task, '2026-07-27');
    assert(writes === 1 && oldContainer.children.length === 0,
      'write starts while the connected old row is optimistically removed');

    // Dataview replaces the old render tree while the write is pending. The
    // replacement lives under a different connected parent; the old parent is
    // now detached and must never receive stale DOM during rollback.
    oldContainer.isConnected = false;
    const replacementContainer = makeTreeNode('div');
    replacementContainer.isConnected = true;
    const replacement = TaskTodayList.renderTaskRow(
      replacementContainer,
      task,
      null,
      { viewedDay: '2026-07-27' }
    );
    rejectWrite(new Error('write failed after Dataview tree replacement'));
    const result = await pending;

    assert(result && result.ok === false, 'failed write is reported: ' + JSON.stringify(result));
    assert(oldContainer.children.length === 0 && original.parentNode === null,
      'rollback never reinserts the stale row into the disconnected old tree');
    assert(replacementContainer.children.length === 1 && replacementContainer.children[0] === replacement,
      'the connected replacement tree remains independently intact');
  });

  await okAsync('TD1A-COLD-LOAD tomorrow activation is a silent no-op before TaskDialog readiness', async () => {
    let writes = 0;
    global.window = {
      app: {
        vault: { getAbstractFileByPath: () => ({ path: 'spice/tasks/x.md' }) },
        fileManager: { processFrontMatter: async () => { writes++; } },
        workspace: { openLinkText() {} },
      },
      customJS: {},
    };
    const container = makeTreeNode('div');
    const row = TaskTodayList.renderTaskRow(
      container,
      { title: 'x', path: 'spice/tasks/x.md', status: 'open' },
      null,
      { viewedDay: '2026-07-27' }
    );
    let threw = false;
    try { await fireClick(findByCls(row, 'sauce-task-action-tomorrow')); } catch (_e) { threw = true; }
    assert(!threw, 'cold-load activation never throws');
    assert(writes === 0, 'no frontmatter write before TaskDialog readiness');
    assert(childIndex(container, row) === 0, 'cold-load activation leaves row intact');

    global.window.customJS.TaskDialog = {};
    try { await fireClick(findByCls(row, 'sauce-task-action-tomorrow')); } catch (_e) { threw = true; }
    assert(!threw, 'partially registered TaskDialog never throws');
    assert(writes === 0, 'no frontmatter write before TaskDialog.open is callable');
    assert(childIndex(container, row) === 0, 'partial TaskDialog leaves row intact');
  });

  await okAsync('TD1A-COMPLETED-ROW-RESCHEDULE-LEAK excludes TaskDoneTodayList and archive-style completed rows', async () => {
    let writes = 0;
    global.window = {
      app: {
        vault: { getAbstractFileByPath: (p) => ({ path: p }) },
        fileManager: { processFrontMatter: async () => { writes++; } },
        workspace: { openLinkText() {} },
      },
      customJS: { TaskDialog: { open() {} } },
    };
    const TaskDoneTodayListClass = loadClass(
      'mechanisms/task-entity/task-done-today-list.js', 'TaskDoneTodayList');
    const TaskDoneArchiveClass = loadClass(
      'blueprints/to-do/helpers/task-done-archive.js', 'TaskDoneArchive');
    const doneToday = new TaskDoneTodayListClass().filterToday([
      { title: 'Done today', path: 'spice/tasks/_done/today.md', status: 'done', due: '2026-07-27', completed_at: '2026-07-27' },
    ], '2026-07-27');
    const archived = new TaskDoneArchiveClass().groupByDate([
      { title: 'Archived done', path: 'spice/tasks/_done/old.md', status: 'done', due: '2026-07-20', completed_at: '2026-07-20' },
    ]).get('2026-07-20');
    assert(doneToday.length === 1 && archived.length === 1,
      'actual completed helpers select one row apiece');

    for (const task of doneToday.concat(archived)) {
      const container = makeTreeNode('div');
      const row = TaskTodayList.renderTaskRow(container, task, null, { viewedDay: '2026-07-27' });
      assert(!findByCls(row, 'sauce-task-action-tomorrow'),
        'completed shared row has no tomorrow action: ' + task.path);
    }
    assert(writes === 0, 'completed/archive rows cannot mutate due');
  });

  if (prevWindow === undefined) delete global.window; else global.window = prevWindow;
  if (prevGlobalApp === undefined) delete global.app; else global.app = prevGlobalApp;
  global.Notice = prevNotice;
}

// ---------- Per-row inline wrench + trash icons (RTR-ICONS-1..2) ----------
// renderTaskRow always retains wrench (edit) + trash (delete). Open rows may
// prepend tomorrow; there is still no MenuPopover/dots branching.
async function runDotsMenuTests() {
  const prevWindow = global.window;
  const prevNotice = global.Notice;
  global.Notice = function () {};

  await okAsync('RTR-ICONS-1 renders wrench + trash icons (no dots menu)', async () => {
    global.window = { app: { workspace: { openLinkText() {} } }, customJS: {} };
    const container = makeTreeNode('div');
    const TD = { open() {}, confirmDelete: async () => ({ ok: false }) };
    const row = TaskTodayList.renderTaskRow(container, { title: 'x', path: 'spice/tasks/x.md' }, TD);
    const actions = findByCls(row, 'sauce-task-today-actions');
    assert(actions, 'actions group rendered');
    const edit = findByCls(actions, 'sauce-task-action-edit');
    const del = findByCls(actions, 'sauce-task-action-delete');
    assert(edit, 'wrench edit icon present');
    assert(del, 'trash delete icon present');
    assert(!findByCls(actions, 'sauce-task-action-more'), 'no dots menu');
    assert(edit.attributes['aria-label'] === 'Edit task', 'edit aria-label');
    assert(del.attributes['aria-label'] === 'Delete task', 'delete aria-label');
    assert(childIndex(actions, edit) < childIndex(actions, del), 'edit is LEFT of delete');
  });

  await okAsync('RTR-ICONS-2 wrench click calls doEdit, trash click calls doDelete', async () => {
    const editPaths = [];
    const deletePaths = [];
    global.window = {
      app: { workspace: { openLinkText() {} } },
      customJS: { RenderSafe: { captureScroll: () => {} } },
    };
    const container = makeTreeNode('div');
    const path = 'spice/tasks/x.md';
    const TD = {
      open: (opts) => { editPaths.push(opts && opts.edit); },
      confirmDelete: async (p) => { deletePaths.push(p); return { ok: true }; },
    };
    const row = TaskTodayList.renderTaskRow(container, { title: 'x', path }, TD);
    const edit = findByCls(row, 'sauce-task-action-edit');
    const del = findByCls(row, 'sauce-task-action-delete');
    await fireClick(edit);
    assert(editPaths.length === 1 && editPaths[0] === path,
      'wrench click → TaskDialog.open({edit:path}): ' + JSON.stringify(editPaths));
    await fireClick(del);
    assert(deletePaths.length === 1 && deletePaths[0] === path,
      'trash click → confirmDelete(path): ' + JSON.stringify(deletePaths));
  });

  global.window = prevWindow;
  global.Notice = prevNotice;
}

// ---------- TaskDialog.confirmDelete — yes/no delete modal (TDCD-1..4) ----------
// confirmDelete(path) opens a small confirm overlay and resolves:
//   { ok: true }                    after the user confirms AND markDeleted succeeds
//   { ok: false, cancelled: true }  when the user cancels / dismisses
//   { ok: false, reason }           on cold-load / delete failure (never throws)
// Drives the REAL confirmDelete against a document stub (faithful, not a replica).
function makeDocumentStub() {
  const body = makeTreeNode('body');
  const listeners = [];
  return {
    body,
    listeners,
    createElement(tag) { return makeTreeNode(tag); },
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
    removeEventListener(type, fn, capture) {
      const i = listeners.findIndex((item) => item.type === type && item.fn === fn && item.capture === capture);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatch(type, event) { for (const item of listeners.filter((entry) => entry.type === type)) item.fn(event); },
    querySelector(selector) { return body.querySelector(selector); },
  };
}

async function runConfirmDeleteTests() {
  const prevWindow = global.window;
  const prevApp = global.app;
  const prevDoc = global.document;
  const prevNotice = global.Notice;
  const prevCustomJS = global.customJS;
  global.Notice = function () {};

  await okAsync('TDCD-1 confirmDelete is a function on the instance', async () => {
    assert(typeof TaskDialog.confirmDelete === 'function', 'instance method present');
  });

  await okAsync('TDCD-2 confirmDelete with no app (cold load) resolves {ok:false}, never touches document / throws', async () => {
    global.window = {}; delete global.app; delete global.customJS; global.document = undefined;
    let threw = false, res;
    try { res = await new TaskDialogClass().confirmDelete('spice/tasks/x.md'); } catch (_e) { threw = true; }
    assert(!threw, 'never throws');
    assert(res && res.ok === false, 'resolves {ok:false}: ' + JSON.stringify(res));
  });

  await okAsync('TDCD-3 confirm → Delete button calls markDeleted + resolves {ok:true}, dismisses overlay', async () => {
    const doc = makeDocumentStub();
    global.document = doc;
    const deleted = [];
    global.app = {
      vault: { getAbstractFileByPath: (p) => ({ path: p, basename: 'go through mail' }) },
      metadataCache: { getFileCache: () => ({ frontmatter: { title: 'go through mail' } }) },
    };
    global.window = { app: global.app };
    global.customJS = { SauceModal: new SauceModalClass() };
    const dialog = new TaskDialogClass();
    dialog.markDeleted = async (p) => { deleted.push(p); return { ok: true }; };
    const p = dialog.confirmDelete('spice/tasks/go through mail.md');
    const del = findByCls(doc.body, 'sauce-task-confirm-delete');
    assert(del, 'confirm Delete button rendered');
    await fireClick(del);
    const res = await p;
    assert(deleted.length === 1 && deleted[0] === 'spice/tasks/go through mail.md', 'markDeleted(path): ' + JSON.stringify(deleted));
    assert(res && res.ok === true, 'resolves {ok:true}: ' + JSON.stringify(res));
    assert(findByCls(doc.body, 'sauce-task-confirm-delete') === null, 'overlay dismissed after delete');
  });

  await okAsync('TDCD-4 Cancel button resolves {ok:false, cancelled} + does NOT delete', async () => {
    const doc = makeDocumentStub();
    global.document = doc;
    const deleted = [];
    global.app = {
      vault: { getAbstractFileByPath: (p) => ({ path: p, basename: 'x' }) },
      metadataCache: { getFileCache: () => null },
    };
    global.window = { app: global.app };
    global.customJS = { SauceModal: new SauceModalClass() };
    const dialog = new TaskDialogClass();
    dialog.markDeleted = async (p) => { deleted.push(p); return { ok: true }; };
    const p = dialog.confirmDelete('spice/tasks/x.md');
    const cancel = findByCls(doc.body, 'sauce-task-confirm-cancel');
    assert(cancel, 'Cancel button rendered');
    await fireClick(cancel);
    const res = await p;
    assert(deleted.length === 0, 'markDeleted NOT called on cancel');
    assert(res && res.ok === false && res.cancelled === true, 'resolves cancelled: ' + JSON.stringify(res));
  });

  await okAsync('TDCD-5 missing SauceModal fails closed with zero dialog DOM and recovers on the next call', async () => {
    const doc = makeDocumentStub();
    global.document = doc;
    global.app = { vault: { getAbstractFileByPath: (p) => ({ path: p, basename: 'x' }) } };
    global.window = { app: global.app };
    delete global.customJS;
    const dialog = new TaskDialogClass();
    const missing = await Promise.race([
      dialog.confirmDelete('spice/tasks/x.md'),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 25)),
    ]);
    assert(missing.reason === 'SauceModal unavailable' && doc.body.children.length === 0,
      'missing modal must fail closed without legacy DOM: ' + JSON.stringify(missing));
    global.customJS = { SauceModal: new SauceModalClass() };
    const pending = dialog.confirmDelete('spice/tasks/x.md');
    const cancel = findByCls(doc.body, 'sauce-task-confirm-cancel');
    assert(cancel && findByCls(doc.body, 'sauce-modal-backdrop'), 'warm retry mounts real SauceModal');
    await fireClick(cancel);
    const recovered = await pending;
    assert(recovered.cancelled === true, 'warm retry keeps cancellation contract');
  });

  await okAsync('TDCD-6 real SauceModal owns Escape lifecycle and exact sauce-core button tones', async () => {
    const doc = makeDocumentStub();
    global.document = doc;
    global.app = { vault: { getAbstractFileByPath: (p) => ({ path: p, basename: 'x' }) } };
    global.window = { app: global.app };
    global.customJS = { SauceModal: new SauceModalClass() };
    const pending = new TaskDialogClass().confirmDelete('spice/tasks/x.md');
    const cancel = findByCls(doc.body, 'sauce-task-confirm-cancel');
    const danger = findByCls(doc.body, 'sauce-task-confirm-delete');
    assert(cancel && String(cancel.className).includes('sauce-btn'), 'Cancel uses sauce-btn');
    assert(danger && String(danger.className).includes('sauce-btn-danger'), 'Delete uses danger tone');
    let prevented = 0;
    doc.dispatch('keydown', { key: 'Escape', preventDefault() { prevented += 1; } });
    const result = await pending;
    assert(prevented === 1 && result.cancelled === true && doc.body.children.length === 0,
      'Escape is owned by SauceModal teardown');
  });

  await okAsync('PERF-1-TDCD deferred confirmation resolves before persistence so the shared seam owns delete', async () => {
    const doc = makeDocumentStub();
    global.document = doc;
    const deleted = [];
    global.app = { vault: { getAbstractFileByPath: (p) => ({ path: p, basename: 'child' }) } };
    global.window = { app: global.app };
    global.customJS = { SauceModal: new SauceModalClass() };
    const dialog = new TaskDialogClass();
    assert(dialog.supportsDeferredDelete() === true, 'TaskDialog explicitly advertises deferred-delete support');
    dialog.markDeleted = async (path) => { deleted.push(path); return { ok: true }; };
    const pending = dialog.confirmDelete('spice/tasks/child.md', { deferWrite: true });
    const danger = findByCls(doc.body, 'sauce-task-confirm-delete');
    assert(danger, 'deferred confirmation renders the real danger control');
    await fireClick(danger);
    const result = await pending;
    assert(result && result.ok && result.deferred === true, 'deferred confirmation receipt: ' + JSON.stringify(result));
    assert(deleted.length === 0, 'markDeleted is deferred to RenderSafe.mutateStructure.write');
  });

  global.window = prevWindow;
  if (prevApp === undefined) delete global.app; else global.app = prevApp;
  if (prevCustomJS === undefined) delete global.customJS; else global.customJS = prevCustomJS;
  global.document = prevDoc;
  global.Notice = prevNotice;
}

// ---------- GA-C4a TaskDialog onto SauceModal (TDSM-1..6) ----------
// Drives the real create/edit renderer against the real SauceModal class. These
// fixtures distinguish shared lifecycle delegation from a legacy overlay that
// merely copies SauceModal class names.
function treeText(node) {
  if (!node) return '';
  return String(node._textContent || node.textContent || '')
    + (node.children || []).map(treeText).join('');
}

function findByTagText(node, tag, text) {
  if (!node) return null;
  if (node.tagName === String(tag).toUpperCase() && treeText(node) === text) return node;
  for (const child of node.children || []) {
    const found = findByTagText(child, tag, text);
    if (found) return found;
  }
  return null;
}

function findInputByPlaceholder(node, placeholder) {
  if (!node) return null;
  if (node.tagName === 'INPUT' && node.placeholder === placeholder) return node;
  for (const child of node.children || []) {
    const found = findInputByPlaceholder(child, placeholder);
    if (found) return found;
  }
  return null;
}

function makeTaskDialogRenderApp(editFile) {
  const file = editFile || null;
  return {
    vault: {
      getAbstractFileByPath(path) { return file && file.path === path ? file : null; },
      getMarkdownFiles() { return []; },
      getFiles() { return []; },
      read: async () => '<!-- TASK_NOTES -->\n',
    },
    metadataCache: {
      getFileCache(target) {
        return target === file ? { frontmatter: { title: 'Existing task', due: '2026-07-21', links: [] } } : null;
      },
    },
  };
}

async function runTaskDialogSauceModalTests() {
  const prevWindow = global.window;
  const prevApp = global.app;
  const prevDoc = global.document;
  const prevNotice = global.Notice;
  const prevCustomJS = global.customJS;
  global.Notice = function () {};

  ok('TDSM-1 task-entity declares modal >=0.2.0 and legacy dialog chrome source is absent', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mechanisms', 'task-entity', 'manifest.json'), 'utf8'));
    const modalDep = manifest.depends_on.find((item) => item.name === 'modal');
    assert(modalDep && modalDep.range === '>=0.2.0', 'exact modal dependency required');
    const source = fs.readFileSync(path.join(__dirname, '..', 'mechanisms', 'task-entity', 'task-dialog.js'), 'utf8');
    assert(!source.includes('BTN_BASE'), 'both duplicated BTN_BASE paths must be deleted');
    assert(!source.includes('sauce-todo-create-overlay') && !source.includes('sauce-task-confirm-overlay'),
      'legacy overlay identities must be absent');
    assert((source.match(/globalThis\.customJS\.SauceModal/g) || []).length === 2,
      'create/edit and confirmDelete each resolve the real global SauceModal instance');
  });

  await okAsync('TDSM-2 create renderer mounts real SauceModal skeleton and sauce-core footer controls', async () => {
    const doc = makeDocumentStub();
    const app = makeTaskDialogRenderApp();
    const customJS = {
      SauceModal: new SauceModalClass(),
      TaskEntity,
      RecurrenceParser: { describe() { return null; } },
    };
    global.document = doc;
    global.app = app;
    global.customJS = customJS;
    global.window = { app, customJS };
    new TaskDialogClass().open({ surface: 'daily', today: '2026-07-20' });
    const backdrop = findByCls(doc.body, 'sauce-modal-backdrop');
    const modal = findByCls(doc.body, 'sauce-modal');
    const title = findByCls(doc.body, 'sauce-modal-title');
    const cancel = [...(findByCls(doc.body, 'sauce-modal-footer').children || [])]
      .flatMap((group) => group.children || []).find((button) => treeText(button) === 'Cancel');
    const save = findByCls(doc.body, 'sauce-btn-accent');
    assert(backdrop && modal && title && treeText(title) === 'New Task', 'real shared modal skeleton and title');
    assert(cancel && String(cancel.className).includes('sauce-btn'), 'Cancel uses sauce-btn');
    assert(save && String(save.className).includes('sauce-btn-accent'), 'Save uses sauce-btn-accent');
    assert(!findByCls(doc.body, 'sauce-todo-create-overlay'), 'no legacy create overlay');
  });

  await okAsync('TDSM-3 missing SauceModal fails closed before mounting and warm retry succeeds', async () => {
    const doc = makeDocumentStub();
    const app = makeTaskDialogRenderApp();
    const customJS = { TaskEntity, RecurrenceParser: { describe() { return null; } } };
    global.document = doc;
    global.app = app;
    global.customJS = customJS;
    global.window = { app, customJS };
    const dialog = new TaskDialogClass();
    dialog.open({ surface: 'daily', today: '2026-07-20' });
    assert(doc.body.children.length === 0, 'partial CustomJS load leaves no half-mounted dialog');
    customJS.SauceModal = new SauceModalClass();
    dialog.open({ surface: 'daily', today: '2026-07-20' });
    assert(findByCls(doc.body, 'sauce-modal-backdrop'), 'later invocation recovers through SauceModal');
  });

  await okAsync('TDSM-4 only Title Enter submits; nested web-link and note-filter Enter retain local behavior', async () => {
    const doc = makeDocumentStub();
    const app = makeTaskDialogRenderApp();
    const customJS = { SauceModal: new SauceModalClass(), TaskEntity, RecurrenceParser: { describe() { return null; } } };
    global.document = doc;
    global.app = app;
    global.customJS = customJS;
    global.window = { app, customJS };
    const dialog = new TaskDialogClass();
    const creates = [];
    dialog._create = async (_app, payload) => { creates.push(payload); };
    dialog.open({ surface: 'daily', today: '2026-07-20' });
    const body = findByCls(doc.body, 'sauce-modal-body');
    const titleInput = findInput(body);
    titleInput.value = 'Create through Enter';
    titleInput.oninput();
    doc.dispatch('keydown', { key: 'Enter', target: titleInput, isComposing: true, preventDefault() {} });
    await Promise.resolve();
    assert(creates.length === 0, 'IME composition must not submit');

    const more = findByTagText(body, 'button', 'More options ▾');
    await fireClick(more);
    const webButton = findByTagText(body, 'button', '＋ Web link');
    await fireClick(webButton);
    const urlInput = findInputByPlaceholder(body, 'https://…');
    const labelInput = findInputByPlaceholder(body, 'Link text (optional)');
    assert(urlInput && labelInput, 'web-link mini-form inputs rendered');
    urlInput.value = 'https://example.test/path';
    labelInput.value = 'Example';
    const webEvent = { key: 'Enter', target: urlInput, isComposing: false, preventDefault() {} };
    doc.dispatch('keydown', webEvent); // SauceModal capture phase
    for (const listener of urlInput._listeners.keydown || []) listener(webEvent); // target phase
    await Promise.resolve();
    assert(creates.length === 0, 'web-link Enter inserts locally without prematurely saving');
    assert(treeText(body).includes('[Example](https://example.test/path)'), 'web-link Enter adds the link chip');

    const noteButton = findByTagText(body, 'button', '＋ Link note');
    await fireClick(noteButton);
    const filterInput = findInputByPlaceholder(body, 'Filter notes (recent first)…');
    assert(filterInput, 'note-filter input rendered');
    doc.dispatch('keydown', { key: 'Enter', target: filterInput, isComposing: false, preventDefault() {} });
    await Promise.resolve();
    assert(creates.length === 0, 'note-filter Enter does not submit the task');

    let prevented = 0;
    doc.dispatch('keydown', { key: 'Enter', target: titleInput, isComposing: false, preventDefault() { prevented += 1; } });
    await Promise.resolve(); await Promise.resolve();
    assert(prevented === 1 && creates.length === 1 && creates[0].title === 'Create through Enter',
      'Title Enter submits exactly once through SauceModal');
    assert(creates[0].links[0] === '[Example](https://example.test/path)', 'locally inserted link persists in saved payload');
    assert(doc.body.children.length === 0, 'successful submit closes through shared lifecycle');
  });

  await okAsync('TDSM-5 Save click/click and click/Title-Enter share SauceModal concurrency ownership', async () => {
    const openDeferredCreate = () => {
      const doc = makeDocumentStub();
      const app = makeTaskDialogRenderApp();
      const customJS = { SauceModal: new SauceModalClass(), TaskEntity, RecurrenceParser: { describe() { return null; } } };
      global.document = doc;
      global.app = app;
      global.customJS = customJS;
      global.window = { app, customJS };
      let createCalls = 0;
      let releaseCreate;
      const createPending = new Promise((resolve) => { releaseCreate = resolve; });
      const dialog = new TaskDialogClass();
      dialog._create = async () => { createCalls += 1; await createPending; };
      dialog.open({ surface: 'daily', today: '2026-07-20' });
      const body = findByCls(doc.body, 'sauce-modal-body');
      const titleInput = findInput(body);
      titleInput.value = 'Concurrency fixture';
      titleInput.oninput();
      return {
        doc,
        titleInput,
        save: findByCls(doc.body, 'sauce-btn-accent'),
        calls: () => createCalls,
        releaseCreate,
      };
    };

    const clicks = openDeferredCreate();
    const clickChild = (fixture, childIndex) => fixture.save.onclick({
      target: fixture.save.children[childIndex],
      currentTarget: fixture.save,
      preventDefault() {},
      stopPropagation() {},
    });
    assert(clicks.save.children.length === 2, 'Save renders distinct icon and label child targets');
    const firstClick = clickChild(clicks, 0);
    const secondClick = clickChild(clicks, 1);
    await Promise.resolve();
    assert(clicks.calls() === 1,
      'rapid Save icon/label click targets invoke persistence once while the first save is pending');
    clicks.releaseCreate();
    await Promise.all([firstClick, secondClick]);
    assert(clicks.calls() === 1 && clicks.doc.body.children.length === 0,
      'rapid Save child-target click/click remains single-shot after settlement and closes once');

    const mixed = openDeferredCreate();
    const clickSubmit = clickChild(mixed, 1);
    let prevented = 0;
    mixed.doc.dispatch('keydown', {
      key: 'Enter',
      target: mixed.titleInput,
      isComposing: false,
      preventDefault() { prevented += 1; },
    });
    await Promise.resolve();
    assert(prevented === 1 && mixed.calls() === 1,
      'Save click followed by Title Enter invokes persistence once while the first save is pending');
    mixed.releaseCreate();
    await clickSubmit;
    await Promise.resolve();
    assert(mixed.calls() === 1 && mixed.doc.body.children.length === 0,
      'Save click followed by Title Enter remains single-shot after settlement and closes once');
  });

  await okAsync('TDSM-6 autofocus remains create-only across real create and edit dialogs', async () => {
    const createDoc = makeDocumentStub();
    const createApp = makeTaskDialogRenderApp();
    let customJS = { SauceModal: new SauceModalClass(), TaskEntity, RecurrenceParser: { describe() { return null; } } };
    global.document = createDoc; global.app = createApp; global.customJS = customJS; global.window = { app: createApp, customJS };
    new TaskDialogClass().open({ surface: 'daily', today: '2026-07-20' });
    const createTitle = findInput(findByCls(createDoc.body, 'sauce-modal-body'));
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert(createTitle._focusCount === 1, 'create title autofocus fires once');

    const editFile = { path: 'spice/tasks/existing.md', basename: 'existing' };
    const editDoc = makeDocumentStub();
    const editApp = makeTaskDialogRenderApp(editFile);
    customJS = { SauceModal: new SauceModalClass(), TaskEntity, RecurrenceParser: { describe() { return null; } } };
    global.document = editDoc; global.app = editApp; global.customJS = customJS; global.window = { app: editApp, customJS };
    new TaskDialogClass().open({ edit: editFile.path });
    const editTitle = findInput(findByCls(editDoc.body, 'sauce-modal-body'));
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert(editTitle.value === 'Existing task' && !editTitle._focusCount, 'edit title is hydrated without autofocus');
  });

  if (prevWindow === undefined) delete global.window; else global.window = prevWindow;
  if (prevApp === undefined) delete global.app; else global.app = prevApp;
  if (prevDoc === undefined) delete global.document; else global.document = prevDoc;
  if (prevCustomJS === undefined) delete global.customJS; else global.customJS = prevCustomJS;
  global.Notice = prevNotice;
}

// ---------- L4: metadataCache-gated reconcile after add (TD-REC-1..4) ----------
// _reconcileAfterCreate registers a one-shot metadataCache 'changed' listener for
// the new file's path (or a 1200ms fallback if it's missed), then POLLS Dataview's
// own `dv.page(path)` until Dataview itself reports the new page indexed before
// firing the force-refresh command — metadataCache 'changed' only means Obsidian
// re-parsed frontmatter, not that Dataview's separate async index caught up, so
// firing on 'changed' alone can redraw from a stale index and never retrigger
// (TD-REC-4 guards this). Absent Dataview API degrades to fire-on-signal. Never
// throws (absent APIs degrade to the natural ~2.5s tick).
function runReconcileTests() {
  ok('TD-REC-1 reconcile force-refreshes when the new file is indexed, then detaches', () => {
    const calls = { cmd: [], on: 0, off: 0 };
    let handler = null;
    const app = {
      metadataCache: { on: (ev, fn) => { calls.on++; handler = { ev, fn }; return { ev }; }, offref: () => { calls.off++; } },
      commands: { executeCommandById: (id) => { calls.cmd.push(id); return true; } },
      _setTimeout: () => 0,   // never auto-fire the fallback in this case
    };
    new TaskDialogClass()._reconcileAfterCreate(app, 'spice/tasks/x.md');
    assert(calls.on === 1 && handler && handler.ev === 'changed', 'one changed-listener registered');
    handler.fn({ path: 'spice/tasks/other.md' });
    assert(calls.cmd.length === 0, 'no refresh for a different path');
    handler.fn({ path: 'spice/tasks/x.md' });
    assert(calls.cmd.indexOf('dataview:dataview-force-refresh-views') >= 0, 'force-refresh fired on the matching path');
    assert(calls.off === 1, 'listener detached after firing');
  });

  ok('TD-REC-2 timeout fallback force-refreshes if the event never fires', () => {
    const calls = [];
    const app = {
      metadataCache: { on: () => ({}), offref: () => {} },
      commands: { executeCommandById: (id) => calls.push(id) },
      _setTimeout: (fn) => { fn(); return 0; },   // fire the fallback immediately
    };
    new TaskDialogClass()._reconcileAfterCreate(app, 'p.md');
    assert(calls.indexOf('dataview:dataview-force-refresh-views') >= 0, 'fallback fired the force-refresh');
  });

  ok('TD-REC-3 absent commands/API → no throw', () => {
    const app = { metadataCache: { on: () => ({}), offref: () => {} }, _setTimeout: () => 0 };
    new TaskDialogClass()._reconcileAfterCreate(app, 'p.md');   // must not throw
    new TaskDialogClass()._reconcileAfterCreate(null, 'p.md');  // null app → no throw
    assert(true, 'no throw');
  });

  ok('TD-REC-4 waits for Dataview to actually index the page before force-refreshing (root-cause regression)', () => {
    const calls = { cmd: [] };
    let handler = null;
    const timers = [];
    let pollCount = 0;
    const indexedAfter = 2; // dv.page reports the new page only from the 3rd poll onward
    const app = {
      metadataCache: { on: (ev, fn) => { handler = { ev, fn }; return { ev }; }, offref: () => {} },
      commands: { executeCommandById: (id) => calls.cmd.push(id) },
      plugins: { plugins: { dataview: { api: { page: (p) => {
        pollCount++;
        return pollCount > indexedAfter ? { file: { path: p } } : null;
      } } } } },
      _setTimeout: (fn) => { timers.push(fn); return timers.length; },  // queued, drained manually below
    };
    new TaskDialogClass()._reconcileAfterCreate(app, 'spice/tasks/x.md');
    handler.fn({ path: 'spice/tasks/x.md' }); // metadataCache fires — starts polling
    assert(calls.cmd.length === 0, 'must NOT force-refresh before dv.page reports the new page indexed');
    let guard = 0;
    while (calls.cmd.length === 0 && guard < 30) {
      const t = timers.shift();
      assert(t, 'a retry timer should be queued while waiting for the index');
      t();
      guard++;
    }
    assert(calls.cmd.indexOf('dataview:dataview-force-refresh-views') >= 0, 'force-refresh eventually fired once dv.page reported the new page');
    assert(pollCount === indexedAfter + 1, 'polled dv.page exactly until it succeeded: ' + pollCount);
  });
}

// ---------- TDTL: TaskDoneTodayList static helpers ----------
function runTaskDoneTodayListTests() {
  const TaskDoneTodayListClass = loadClass(
    'mechanisms/task-entity/task-done-today-list.js', 'TaskDoneTodayList');
  const TDTL = new TaskDoneTodayListClass();

  ok('TDTL-1 filterToday returns tasks where completed_at === todayStr (plain string)', () => {
    const tasks = [
      { title: 'A', completed_at: '2026-07-06' },
      { title: 'B', completed_at: '2026-07-06' },
      { title: 'C', completed_at: '2026-07-05' },
    ];
    const result = TDTL.filterToday(tasks, '2026-07-06');
    assert(result.length === 2, 'expected 2 tasks, got ' + result.length);
    assert(result[0].title === 'A', 'first task title');
    assert(result[1].title === 'B', 'second task title');
  });

  ok('TDTL-1b filterToday matches ISO timestamp strings (Dataview stores full ISO in frontmatter)', () => {
    const tasks = [
      { title: 'Done', completed_at: '2026-07-06T15:08:14-06:00' },
      { title: 'Yesterday', completed_at: '2026-07-05T09:00:00-06:00' },
    ];
    const result = TDTL.filterToday(tasks, '2026-07-06');
    assert(result.length === 1, 'expected 1, got ' + result.length);
    assert(result[0].title === 'Done', 'ISO timestamp task returned');
  });

  ok('TDTL-1c filterToday matches Luxon-style DateTime objects (Dataview parses ISO datetime frontmatter)', () => {
    const makeLuxon = (dateStr) => ({ toFormat: (fmt) => fmt === 'yyyy-MM-dd' ? dateStr : '' });
    const tasks = [
      { title: 'DvTask', completed_at: makeLuxon('2026-07-06') },
      { title: 'OldTask', completed_at: makeLuxon('2026-07-05') },
    ];
    const result = TDTL.filterToday(tasks, '2026-07-06');
    assert(result.length === 1, 'expected 1, got ' + result.length);
    assert(result[0].title === 'DvTask', 'Luxon DateTime task returned');
  });

  ok('TDTL-2 filterToday excludes tasks completed on other dates', () => {
    const tasks = [
      { title: 'Yesterday', completed_at: '2026-07-05' },
      { title: 'Old', completed_at: '2026-06-01' },
    ];
    const result = TDTL.filterToday(tasks, '2026-07-06');
    assert(result.length === 0, 'expected 0, got ' + result.length);
  });

  ok('TDTL-3 filterToday excludes tasks with null completed_at', () => {
    const tasks = [
      { title: 'NullDate', completed_at: null },
      { title: 'EmptyDate', completed_at: '' },
      { title: 'Today', completed_at: '2026-07-06' },
    ];
    const result = TDTL.filterToday(tasks, '2026-07-06');
    assert(result.length === 1, 'expected 1, got ' + result.length);
    assert(result[0].title === 'Today', 'only Today task returned');
  });

  ok('TDTL-4 filterToday returns [] on null/empty input', () => {
    assert(TDTL.filterToday(null, '2026-07-06').length === 0, 'null input');
    assert(TDTL.filterToday([], '2026-07-06').length === 0, 'empty array');
    assert(TDTL.filterToday([{ title: 'X', completed_at: '2026-07-06' }], '').length === 0, 'empty todayStr');
    assert(TDTL.filterToday([{ title: 'X', completed_at: '2026-07-06' }], null).length === 0, 'null todayStr');
  });
}

// ---------- TDARCH: TaskDoneArchive static helpers ----------
function runTaskDoneArchiveTests() {
  const TaskDoneArchiveClass = loadClass(
    'blueprints/to-do/helpers/task-done-archive.js', 'TaskDoneArchive');
  const TDARCH = new TaskDoneArchiveClass();

  ok('TDARCH-1 groupByDate groups tasks by completed_at sorted desc', () => {
    const tasks = [
      { title: 'A', completed_at: '2026-07-04' },
      { title: 'B', completed_at: '2026-07-06' },
      { title: 'C', completed_at: '2026-07-06' },
      { title: 'D', completed_at: '2026-07-05' },
    ];
    const map = TDARCH.groupByDate(tasks);
    const keys = [...map.keys()];
    assert(keys[0] === '2026-07-06', 'first key is newest: ' + keys[0]);
    assert(keys[1] === '2026-07-05', 'second key: ' + keys[1]);
    assert(keys[2] === '2026-07-04', 'third key: ' + keys[2]);
    assert(map.get('2026-07-06').length === 2, '2 tasks on Jul 6');
  });

  ok('TDARCH-2 groupByDate drops tasks with null completed_at', () => {
    const tasks = [
      { title: 'A', completed_at: null },
      { title: 'B', completed_at: '' },
      { title: 'C', completed_at: '2026-07-06' },
    ];
    const map = TDARCH.groupByDate(tasks);
    assert(map.size === 1, 'only 1 date group: ' + map.size);
    assert(map.get('2026-07-06').length === 1, '1 task on Jul 6');
  });

  ok('TDARCH-3 groupByDate returns empty Map on null/empty input', () => {
    assert(TDARCH.groupByDate(null).size === 0, 'null input');
    assert(TDARCH.groupByDate([]).size === 0, 'empty array');
  });

  ok('TDARCH-4 filterByText returns tasks whose title includes text (case-insensitive)', () => {
    const tasks = [
      { title: 'Fix Dev CDC' },
      { title: 'Deploy staging' },
      { title: 'fix login bug' },
    ];
    const result = TDARCH.filterByText(tasks, 'fix');
    assert(result.length === 2, 'expected 2, got ' + result.length);
    assert(result[0].title === 'Fix Dev CDC', 'first match');
    assert(result[1].title === 'fix login bug', 'second match');
  });

  ok('TDARCH-5 filterByText returns all tasks when text is empty/blank', () => {
    const tasks = [{ title: 'A' }, { title: 'B' }];
    assert(TDARCH.filterByText(tasks, '').length === 2, 'empty string returns all');
    assert(TDARCH.filterByText(tasks, '   ').length === 2, 'blank string returns all');
    assert(TDARCH.filterByText(tasks, null).length === 2, 'null returns all');
  });

  ok('TDARCH-6 filterByText returns [] when no titles match', () => {
    const tasks = [{ title: 'Foo' }, { title: 'Bar' }];
    const result = TDARCH.filterByText(tasks, 'zzz-no-match');
    assert(result.length === 0, 'no matches');
  });
}

// ---------- ToDoAllList static helper (pure) ----------
//
// ToDoAllList is the "All To-Dos" flat query view (to-do blueprint) —
// groupByDate buckets parsed OPEN tasks by their `due` date relative to
// today: overdue (due < today, oldest first), today, future (due > today,
// soonest first, split per-date into futureByDate), noDate (no due value).

ok('TAL-1 groupByDate buckets overdue/today/future/noDate by due date', () => {
  const ToDoAllListClass = loadClass('blueprints/to-do/helpers/todo-all-list.js', 'ToDoAllList');
  const tasks = [
    { title: 'Yesterday', due: '2026-07-07' },
    { title: 'TwoDaysAgo', due: '2026-07-06' },
    { title: 'Today', due: '2026-07-08' },
    { title: 'Tomorrow', due: '2026-07-09' },
    { title: 'NextWeek', due: '2026-07-15' },
    { title: 'Undated', due: null },
  ];
  const groups = ToDoAllListClass.groupByDate(tasks, '2026-07-08');
  assert(groups.overdue.length === 2, 'overdue has 2: ' + groups.overdue.length);
  assert(groups.overdue[0].title === 'TwoDaysAgo' && groups.overdue[1].title === 'Yesterday', 'overdue sorted oldest-first: ' + groups.overdue.map(t => t.title).join(','));
  assert(groups.today.length === 1 && groups.today[0].title === 'Today', 'today has the today task');
  assert(groups.future.length === 2, 'future has 2: ' + groups.future.length);
  assert(groups.future[0].title === 'Tomorrow' && groups.future[1].title === 'NextWeek', 'future sorted soonest-first: ' + groups.future.map(t => t.title).join(','));
  assert(groups.futureByDate.get('2026-07-09')[0].title === 'Tomorrow', 'futureByDate keyed by due date');
  assert(groups.noDate.length === 1 && groups.noDate[0].title === 'Undated', 'noDate has the undated task');
});

ok('TAL-2 groupByDate tolerates null/non-array input', () => {
  const ToDoAllListClass = loadClass('blueprints/to-do/helpers/todo-all-list.js', 'ToDoAllList');
  const groups = ToDoAllListClass.groupByDate(null, '2026-07-08');
  assert(groups.overdue.length === 0 && groups.today.length === 0 && groups.future.length === 0 && groups.noDate.length === 0, 'all-empty groups on null input');
  assert(groups.futureByDate.size === 0, 'empty futureByDate map on null input');
});

// ---------- TaskRecurringList static helper (pure) ----------
//
// TaskRecurringList is the "Recurring" index view (to-do blueprint) — lists
// every OPEN task note with a non-empty `recurrence` grammar, sorted by
// `due` ascending (undated recurring tasks sort last). Only the
// filterRecurring static is pure/Node-testable; render() is browser-only.

ok('TRL-1 filterRecurring keeps only open tasks with a non-empty recurrence, sorted by due ascending', () => {
  const TaskRecurringListClass = loadClass('blueprints/to-do/helpers/task-recurring-list.js', 'TaskRecurringList');
  const tasks = [
    { title: 'B', status: 'open', due: '2026-07-20', recurrence: 'every day' },
    { title: 'A', status: 'open', due: '2026-07-09', recurrence: 'every Monday' },
    { title: 'No recurrence', status: 'open', due: '2026-07-08', recurrence: '' },
    { title: 'Done recurring', status: 'done', due: '2026-07-08', recurrence: 'every day' },
    { title: 'No date', status: 'open', due: null, recurrence: 'every day' },
  ];
  const out = TaskRecurringListClass.filterRecurring(tasks);
  assert(out.length === 3, 'keeps the 3 open+recurring tasks (including the undated one): ' + out.length);
  assert(out[0].title === 'A' && out[1].title === 'B', 'sorted by due ascending, dated first: ' + out.map(t => t.title).join(','));
  assert(out[2].title === 'No date', 'undated recurring task sorts last: ' + out.map(t => t.title).join(','));
});

ok('TRL-2 filterRecurring tolerates null/non-array input', () => {
  const TaskRecurringListClass = loadClass('blueprints/to-do/helpers/task-recurring-list.js', 'TaskRecurringList');
  assert(Array.isArray(TaskRecurringListClass.filterRecurring(null)), 'null -> []');
  assert(TaskRecurringListClass.filterRecurring(null).length === 0, 'null -> empty array');
});

(async () => {
  await runCreateQuickTests();
  await runMarkDoneDeletedTests();
  await runOptimisticRemovalTests();
  await runPerf1StructuralTests();
  await runRowActionTests();
  await runTomorrowActionTests();
  await runDotsMenuTests();
  await runTaskDialogSauceModalTests();
  await runConfirmDeleteTests();
  runReconcileTests();
  runTaskDoneTodayListTests();
  runTaskDoneArchiveTests();
  await runToDoLeafActionsCompletedTests();
  console.log(`\nrun-task-entity: ${passes} passed, ${fails} failed`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => {
  console.error('run-task-entity threw:', e);
  process.exit(1);
});
