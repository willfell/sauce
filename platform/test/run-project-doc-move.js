#!/usr/bin/env node
/**
 * run-project-doc-move.js — pure DocMove helpers (project blueprint).
 * Covers slugify, section-target enumeration, target-path computation, slug
 * folder, same-location guard, section-frontmatter rewrite, folder inference.
 * Fails (cannot load the class) if the helper source is reverted — the Gate B
 * Layer 1 mutation guard.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const SRCFILE = path.join(ROOT, 'platform', 'blueprints', 'project', 'helpers', 'doc-move.js');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

const SRC = fs.existsSync(SRCFILE) ? fs.readFileSync(SRCFILE, 'utf8') : '';
const Cls = SRC ? new Function(`${SRC}\nreturn DocMove;`)() : null;
ok('D0 helper class loads', !!Cls);
const D = Cls ? new Cls() : null;

// ---- slugify ----
{
  ok('D1 slugify basic', D && D.slugify('Knowledge') === 'knowledge');
  ok('D2 slugify spaces+amp', D && D.slugify('API & Networking') === 'api-networking');
  ok('D3 slugify trims dashes/invalid', D && D.slugify('  Advanced Tips!  ') === 'advanced-tips');
  ok('D4 slugify empty/null', D && D.slugify('') === '' && D.slugify(null) === '');
}

// ---- sectionTargets ----
{
  const hubs = [
    { label: 'Notes', path: 'spice/projects/p/docs/notes/Notes.md', depth: 1, parent: '' },
    { label: 'Knowledge', path: 'spice/projects/p/docs/knowledge/Knowledge.md', depth: 1, parent: '' },
    { label: 'Advanced', path: 'spice/projects/p/docs/knowledge/advanced/Advanced.md', depth: 2, parent: '[[Knowledge]]' },
  ];
  const t = D && D.sectionTargets(hubs);
  // sorted: Knowledge, Knowledge/Advanced, Notes
  ok('D5 targets count', t && t.length === 3);
  ok('D6 targets sorted (section then sub)', t && t[0].label === 'Knowledge' && t[1].label === 'Knowledge / Advanced' && t[2].label === 'Notes');
  ok('D7 depth-2 parent stripped from wikilink', t && t[1].section === 'Knowledge' && t[1].subSection === 'Advanced');
  ok('D8 folder = dirname of hub path', t && t[0].folder === 'spice/projects/p/docs/knowledge' && t[1].folder === 'spice/projects/p/docs/knowledge/advanced');
  ok('D9 top-level subSection empty', t && t[0].subSection === '' && t[2].subSection === '');
}
{
  // orphan depth-2 (no parent) is skipped; dedup by (section,sub); non-array -> []
  const hubs = [
    { label: 'Orphan', path: 'x/Orphan.md', depth: 2, parent: '' },
    { label: 'Dup', path: 'a/Dup.md', depth: 1, parent: '' },
    { label: 'Dup', path: 'b/Dup.md', depth: 1, parent: '' },
  ];
  const t = D && D.sectionTargets(hubs);
  ok('D10 orphan sub skipped + dedup', t && t.length === 1 && t[0].section === 'Dup');
  ok('D11 non-array -> []', D && Array.isArray(D.sectionTargets(null)) && D.sectionTargets(null).length === 0);
}

// ---- targetPath ----
{
  ok('D12 targetPath joins folder+basename', D && D.targetPath('spice/projects/p/docs/notes', 'spice/projects/p/docs/knowledge/Doc A.md') === 'spice/projects/p/docs/notes/Doc A.md');
  ok('D13 targetPath trims trailing slash', D && D.targetPath('a/b/', 'x/Doc.md') === 'a/b/Doc.md');
  ok('D14 targetPath empty doc -> ""', D && D.targetPath('a/b', '') === '');
}

// ---- slugFolder ----
{
  ok('D15 slugFolder with sub', D && D.slugFolder('my-proj', 'Knowledge', 'Advanced Tips') === 'spice/projects/my-proj/docs/knowledge/advanced-tips');
  ok('D16 slugFolder top-level (no sub)', D && D.slugFolder('my-proj', 'Knowledge', '') === 'spice/projects/my-proj/docs/knowledge');
  ok('D17 slugFolder custom root', D && D.slugFolder('p', 'Sec', '', 'notes/projects') === 'notes/projects/p/docs/sec');
  ok('D18 slugFolder empty projectSlug -> ""', D && D.slugFolder('', 'Sec', '') === '');
}

// ---- isSameLocation ----
{
  ok('D19 isSameLocation true', D && D.isSameLocation('a/b/Doc.md', 'a/b') === true);
  ok('D20 isSameLocation trailing slash', D && D.isSameLocation('a/b/Doc.md', 'a/b/') === true);
  ok('D21 isSameLocation false', D && D.isSameLocation('a/b/Doc.md', 'a/c') === false);
}

// ---- rewriteSection ----
{
  const out = D && D.rewriteSection({ title: 'X', section: 'Old', sub_section: 'OldSub', keep: 1 }, 'New', 'NewSub');
  ok('D22 rewriteSection sets section+sub', out && out.section === 'New' && out.sub_section === 'NewSub');
  ok('D23 rewriteSection preserves other keys', out && out.title === 'X' && out.keep === 1);
  const top = D && D.rewriteSection({ section: 'Old', sub_section: 'S' }, 'New', '');
  ok('D24 rewriteSection top-level clears sub', top && top.section === 'New' && top.sub_section === '');
  const wl = D && D.rewriteSection({}, '[[Knowledge]]', '[[Advanced]]');
  ok('D25 rewriteSection strips wikilinks', wl && wl.section === 'Knowledge' && wl.sub_section === 'Advanced');
  const nofm = D && D.rewriteSection(null, 'S', '');
  ok('D26 rewriteSection null fm safe', nofm && nofm.section === 'S' && nofm.sub_section === '');
}

// ---- inferSectionFromPath ----
{
  const a = D && D.inferSectionFromPath('spice/projects/p/docs/knowledge/advanced/Debugging.md');
  ok('D27 infer depth-2', a && a.section === 'knowledge' && a.subSection === 'advanced');
  const b = D && D.inferSectionFromPath('spice/projects/p/docs/Custom Section/Custom Note.md');
  ok('D28 infer depth-1 (legacy display folder)', b && b.section === 'Custom Section' && b.subSection === '');
  const c = D && D.inferSectionFromPath('spice/projects/p/docs/Docs.md');
  ok('D29 infer direct-in-docs -> empty', c && c.section === '' && c.subSection === '');
  const d = D && D.inferSectionFromPath('spice/projects/p/Project.md');
  ok('D30 infer not-under-docs -> empty', d && d.section === '' && d.subSection === '');
}

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
process.exit(allPass ? 0 : 1);
