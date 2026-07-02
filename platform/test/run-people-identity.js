'use strict';

// run-people-identity.js — behavioral coverage for the people-identity mechanism
// (PeopleIdentity). Autoloop queue item cov-mechanism-people-identity-customjs-behavioral
// (0/4): the mechanism had NO test harness, yet it is live + consumed (people
// blueprint depends_on it, registered in platform/manifest.json + subscription).
// Its 4 public methods are pure resolver logic (no render):
//   resolvePerson(input)       — 4-tier resolution: basename exact → typed-alias
//                                exact → basename CI → alias CI; collision → first
//                                match (folder-sort) + warn; null on miss/bad input.
//   findByAlias(type, value)   — exact type+value match; null on miss; collision warn.
//   getAliases(personLink)     — strips wikilink/path/pipe/hash/.md; reads frontmatter
//                                aliases; normalizes string→{type:"name"} and object.
//   listAliasesOfType(type)    — collect {personLink, value} across all people notes.
//
// A synthetic `app` stub feeds people notes via getMarkdownFiles + metadataCache.
// PeopleIdentity reads the global `app`. Zero-dep. "PASS N/N" exit 0, "FAIL X/N" exit 1.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'mechanisms', 'people-identity', 'people-identity.js');
const PeopleIdentity = new Function(`${fs.readFileSync(SRC, 'utf8')}; return PeopleIdentity;`)();

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + label); }
  else { fail++; const m = `${label}${detail ? ' — ' + detail : ''}`; failures.push(m); console.log('  FAIL  ' + m); }
}

// Build a synthetic vault. `people` maps basename -> aliases (raw frontmatter value).
function installVault(people) {
  const files = Object.keys(people).map(basename => ({
    basename,
    path: `spice/people/${basename}.md`,
  }));
  // include the People hub + a non-people file to exercise the _collectPeople filter
  files.push({ basename: 'People', path: 'spice/people/People.md' });
  files.push({ basename: 'RandomNote', path: 'spice/notes/RandomNote.md' });
  const byPath = {}; const byBasename = {};
  for (const f of files) { byPath[f.path] = f; byBasename[f.basename] = f; }
  const cacheFor = (f) => {
    if (!f) return null;
    if (f.basename === 'People' || !(f.basename in people)) return { frontmatter: {} };
    return { frontmatter: { aliases: people[f.basename] } };
  };
  global.app = {
    vault: {
      getMarkdownFiles: () => files.slice(),
      getAbstractFileByPath: (p) => byPath[p] || null,
    },
    metadataCache: {
      getFileCache: (f) => cacheFor(f),
      getFirstLinkpathDest: (basename) => byBasename[basename] || null,
    },
  };
}

const PEOPLE = {
  'Alice Smith': [{ type: 'email', value: 'alice@x.com' }, { type: 'handle', value: '@alice' }, 'Ally'],
  'Bob Jones': [{ type: 'phone', value: '555-1234' }, { type: 'email', value: 'bob@x.com' }],
  'Carol': [{ type: 'handle', value: '@shared' }],
  'Dave': [{ type: 'handle', value: '@shared' }, { type: 'bad' }, 42],
};

installVault(PEOPLE);
const pi = new PeopleIdentity();

// ── resolvePerson ──────────────────────────────────────────────────────────
ok('PI-1 resolvePerson basename exact', pi.resolvePerson('Alice Smith') === '[[Alice Smith]]');
ok('PI-2 resolvePerson basename case-insensitive', pi.resolvePerson('alice smith') === '[[Alice Smith]]');
ok('PI-3 resolvePerson typed-alias exact (email)', pi.resolvePerson('alice@x.com') === '[[Alice Smith]]');
ok('PI-4 resolvePerson string-alias (normalized to name)', pi.resolvePerson('Ally') === '[[Alice Smith]]');
ok('PI-5 resolvePerson alias case-insensitive', pi.resolvePerson('ALLY') === '[[Alice Smith]]');
ok('PI-6 resolvePerson collision → first in folder order (Carol before Dave)', pi.resolvePerson('@shared') === '[[Carol]]');
ok('PI-7 resolvePerson miss → null', pi.resolvePerson('Nobody At All') === null);
ok('PI-8 resolvePerson empty string → null', pi.resolvePerson('') === null);
ok('PI-9 resolvePerson whitespace → null', pi.resolvePerson('   ') === null);
ok('PI-10 resolvePerson non-string → null', pi.resolvePerson(42) === null);
ok('PI-11 resolvePerson basename beats alias (priority order)',
  pi.resolvePerson('Carol') === '[[Carol]]');

// ── findByAlias ──────────────────────────────────────────────────────────────
ok('PI-12 findByAlias email exact', pi.findByAlias('email', 'bob@x.com') === '[[Bob Jones]]');
ok('PI-13 findByAlias phone exact', pi.findByAlias('phone', '555-1234') === '[[Bob Jones]]');
ok('PI-14 findByAlias wrong type → null (@alice is handle, not email)', pi.findByAlias('email', '@alice') === null);
ok('PI-15 findByAlias miss → null', pi.findByAlias('email', 'ghost@x.com') === null);
ok('PI-16 findByAlias collision → first (Carol)', pi.findByAlias('handle', '@shared') === '[[Carol]]');
ok('PI-17 findByAlias empty type → null', pi.findByAlias('', 'x') === null);
ok('PI-18 findByAlias empty value → null', pi.findByAlias('email', '') === null);
ok('PI-19 findByAlias non-string → null', pi.findByAlias('email', 42) === null);

// ── getAliases ───────────────────────────────────────────────────────────────
{
  const a = pi.getAliases('[[Alice Smith]]');
  ok('PI-20 getAliases wikilink form → normalized list (3 entries: 2 obj + 1 string→name)',
    a.length === 3 && a.some(x => x.type === 'name' && x.value === 'Ally') && a.some(x => x.type === 'email' && x.value === 'alice@x.com'),
    JSON.stringify(a));
}
ok('PI-21 getAliases bare basename form', pi.getAliases('Alice Smith').length === 3);
ok('PI-22 getAliases full path form (strips path + .md)', pi.getAliases('spice/people/Alice Smith.md').length === 3);
ok('PI-23 getAliases piped wikilink (strips |alias)', pi.getAliases('[[Alice Smith|Ali]]').length === 3);
ok('PI-24 getAliases unknown person → []', pi.getAliases('Ghost Person').length === 0);
ok('PI-25 getAliases non-string → []', pi.getAliases(42).length === 0);
{
  // Dave has a malformed object {type:"bad"} (no value) + a number 42 — both dropped.
  const a = pi.getAliases('Dave');
  ok('PI-26 getAliases drops malformed entries (only @shared survives)',
    a.length === 1 && a[0].type === 'handle' && a[0].value === '@shared', JSON.stringify(a));
}

// ── listAliasesOfType ────────────────────────────────────────────────────────
{
  const emails = pi.listAliasesOfType('email');
  ok('PI-27 listAliasesOfType(email) → both people, personLink + value',
    emails.length === 2 && emails.some(e => e.personLink === '[[Alice Smith]]' && e.value === 'alice@x.com') && emails.some(e => e.personLink === '[[Bob Jones]]' && e.value === 'bob@x.com'),
    JSON.stringify(emails));
}
{
  const handles = pi.listAliasesOfType('handle');
  ok('PI-28 listAliasesOfType(handle) → @alice + @shared×2', handles.length === 3, JSON.stringify(handles));
}
ok('PI-29 listAliasesOfType unknown type → []', pi.listAliasesOfType('fax').length === 0);
ok('PI-30 listAliasesOfType empty type → []', pi.listAliasesOfType('').length === 0);

// ── empty vault ──────────────────────────────────────────────────────────────
installVault({});
const pi2 = new PeopleIdentity();
ok('PI-31 resolvePerson on empty vault → null', pi2.resolvePerson('Anyone') === null);
ok('PI-32 listAliasesOfType on empty vault → []', pi2.listAliasesOfType('email').length === 0);

console.log('');
if (fail === 0) { console.log(`PASS ${pass}/${pass + fail}`); process.exit(0); }
console.log(`FAIL ${fail}/${pass + fail}`);
for (const f of failures) console.log('  - ' + f);
process.exit(1);
