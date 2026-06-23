#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharedWindow = { app: undefined, customJS: undefined, moment: undefined };
function loadHelperClass(rel, className) {
  const src = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
  const stubs = `const document = {}; const Notice = function (msg, ms) { if (window.__captureNotice) window.__captureNotice(msg, ms); }; const console = { error(){}, warn(){} };`;
  // eslint-disable-next-line no-new-func
  return new Function('window', `${stubs}\n${src}\nreturn ${className};`)(sharedWindow);
}
const MLA = loadHelperClass('blueprints/meetings/helpers/meeting-leaf-actions.js', 'MeetingLeafActions');
let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) { if (cond) { console.log(`  ok  ${label}`); pass++; } else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; } }
console.log('run-meeting-leaf-actions:');

ok('MLA-1 stripWikilink unwraps', MLA.stripWikilink('[[Q3 Planning]]') === 'Q3 Planning');
ok('MLA-2 stripWikilink passthrough plain', MLA.stripWikilink('Plain') === 'Plain');
ok('MLA-3 stripWikilink empty/nullish', MLA.stripWikilink('') === '' && MLA.stripWikilink(undefined) === '' && MLA.stripWikilink(null) === '');

const projects = [{ slug: 'q3-planning', name: 'Q3 Planning' }, { slug: 'sauce', name: 'Sauce' }];
ok('MLA-4 preselect matches project → object', JSON.stringify(MLA.resolveProjectPreselect({ project: '[[Q3 Planning]]' }, projects)) === JSON.stringify({ type: 'project', slug: 'q3-planning', name: 'Q3 Planning' }));
ok('MLA-5 preselect no project → today', MLA.resolveProjectPreselect({ project: '' }, projects) === 'today');
ok('MLA-6 preselect unknown project → today', MLA.resolveProjectPreselect({ project: '[[Nonexistent]]' }, projects) === 'today');

const fm = MLA.buildAttendeeFrontmatter(['Alex Kim', 'Sam Lee', 'Alex Kim']);
ok('MLA-7 attendees wikilinked + deduped', JSON.stringify(fm.attendees) === JSON.stringify(['[[Alex Kim]]', '[[Sam Lee]]']));
ok('MLA-8 people kept in sync with attendees', JSON.stringify(fm.people) === JSON.stringify(fm.attendees));
ok('MLA-9 empty selection → empty arrays', (() => { const e = MLA.buildAttendeeFrontmatter([]); return Array.isArray(e.attendees) && e.attendees.length === 0 && e.people.length === 0; })());

const stub = MLA.personStubBody('Jordan Fox', '2026-06-19T10:00:00Z');
ok('MLA-10 personStubBody has type: person frontmatter', /^---\ntype: person\n/.test(stub) && /\n---\n/.test(stub));
ok('MLA-11 personStubBody embeds the name', stub.includes('Jordan Fox'));

// ── HC-V0127-MLA-NT-* — v0.127.0 §C cases (instance helpers) ────────────────
// Build an instance and stub dv.pages for _projectTodoPath; Notice for _noticeDualWrite.
const inst = new MLA();

function fakeDv(pagesArr) {
  return {
    pages(_q) {
      const arr = pagesArr.slice();
      const wrapper = {
        where(pred) { return fakeDv(arr.filter(pred)).pages(); },
        array() { return arr; },
      };
      return wrapper;
    },
  };
}
// _projectTodoPath uses dv.pages(...).where(...).array(); construct a thin chainable.
function chainDv(arr) {
  return {
    pages(_q) {
      return {
        where(pred) {
          const filtered = arr.filter(pred);
          return { array() { return filtered; } };
        },
      };
    },
  };
}

const databricksHub = { type: "project", file: { name: "Databricks", folder: "spice/projects/databricks" } };
const dvWithHub = chainDv([databricksHub]);
ok('HC-V0127-MLA-NT-PATH-A _projectTodoPath resolves known project',
  inst._projectTodoPath('Databricks', dvWithHub) === 'spice/projects/databricks/Databricks To-Do.md');

const dvEmpty = chainDv([]);
ok('HC-V0127-MLA-NT-PATH-B _projectTodoPath returns null when no matching hub',
  inst._projectTodoPath('Databricks', dvEmpty) === null);

// _noticeDualWrite: capture Notice via the loader stub's window bridge.
const captured = [];
sharedWindow.__captureNotice = function (msg, _ms) { captured.push(String(msg)); };

captured.length = 0;
inst._noticeDualWrite('spice/meetings/notes/2026/06-June/Standup-2026-06-23.md', 'Databricks', { ok: false, reason: 'no-action-items-anchor' }, null);
ok('HC-V0127-MLA-NT-NOTICE-A meeting failure surfaces reason',
  captured.length === 1 && captured[0] === 'Could not write to meeting: no-action-items-anchor');

captured.length = 0;
inst._noticeDualWrite('spice/meetings/notes/2026/06-June/Standup-2026-06-23.md', '', { ok: true }, null);
ok('HC-V0127-MLA-NT-NOTICE-B meeting OK + no project',
  captured.length === 1 && captured[0] === 'Added to Standup-2026-06-23');

captured.length = 0;
inst._noticeDualWrite('spice/meetings/notes/2026/06-June/Standup-2026-06-23.md', 'Databricks', { ok: true }, { ok: true });
ok('HC-V0127-MLA-NT-NOTICE-C meeting + project both OK',
  captured.length === 1 && captured[0] === 'Added to Standup-2026-06-23 and Databricks To-Do');

captured.length = 0;
inst._noticeDualWrite('spice/meetings/notes/2026/06-June/Standup-2026-06-23.md', 'Databricks', { ok: true }, { ok: false, reason: 'project-todo-missing' });
ok('HC-V0127-MLA-NT-NOTICE-D meeting OK + project To-Do missing',
  captured.length === 1 && captured[0] === 'Added to Standup-2026-06-23; Databricks To-Do not found');

captured.length = 0;
inst._noticeDualWrite('spice/meetings/notes/2026/06-June/Standup-2026-06-23.md', 'Databricks', { ok: true }, { ok: false, reason: 'write-failed' });
ok('HC-V0127-MLA-NT-NOTICE-E meeting OK + project write fails (other reason)',
  captured.length === 1 && captured[0] === 'Added to Standup-2026-06-23; could not update Databricks To-Do: write-failed');

// _projectSlugFor: stub _listProjects via monkey-patch (instance method).
const slugInst = new MLA();
slugInst._listProjects = () => [{ slug: 'databricks', name: 'Databricks' }, { slug: 'q3-planning', name: 'Q3 Planning' }];
ok('HC-V0127-MLA-NT-SLUG-A _projectSlugFor returns listed slug',
  slugInst._projectSlugFor('Q3 Planning', {}) === 'q3-planning');
ok('HC-V0127-MLA-NT-SLUG-B _projectSlugFor falls back to slugified default for unlisted',
  slugInst._projectSlugFor('Some New Thing!', {}) === 'some-new-thing-');

console.log(`\nResult: ${pass} passed, ${fail} failed.`);
if (fail) { console.log('Failures:'); failures.forEach(f => console.log('  ' + f)); process.exit(1); }
