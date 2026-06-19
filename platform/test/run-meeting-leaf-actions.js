#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharedWindow = { app: undefined, customJS: undefined, moment: undefined };
function loadHelperClass(rel, className) {
  const src = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
  const stubs = `const document = {}; const Notice = function () {}; const console = { error(){}, warn(){} };`;
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

console.log(`\nResult: ${pass} passed, ${fail} failed.`);
if (fail) { console.log('Failures:'); failures.forEach(f => console.log('  ' + f)); process.exit(1); }
