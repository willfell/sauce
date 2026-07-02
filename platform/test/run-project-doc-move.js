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

// ---- defensive / fallback branches (Gate B test-adequacy feedback) ----
{
  // D31 — pipe-alias wikilink [[Target|Display]] parent strips to the TARGET (not the display)
  const t = D && D.sectionTargets([
    { label: 'Sub', path: 'p/docs/knowledge/sub/Sub.md', depth: 2, parent: '[[Knowledge|Kb]]' },
  ]);
  ok('D31 pipe-alias parent strips to target', t && t.length === 1 && t[0].section === 'Knowledge' && t[0].subSection === 'Sub');
  // D32 — rewriteSection strips a pipe-alias wikilink too
  const r = D && D.rewriteSection({}, '[[Knowledge|Kb]]', '');
  ok('D32 rewriteSection pipe-alias strip', r && r.section === 'Knowledge');
  // D33 — _strip drops a trailing .md (hub label given as a filename)
  const t2 = D && D.sectionTargets([{ label: 'Notes.md', path: 'p/docs/notes/Notes.md', depth: 1, parent: '' }]);
  ok('D33 label .md stripped', t2 && t2.length === 1 && t2[0].section === 'Notes');
  // D34 — empty/whitespace-label hub is skipped
  const t3 = D && D.sectionTargets([
    { label: '   ', path: 'p/docs/blank/Blank.md', depth: 1, parent: '' },
    { label: 'Real', path: 'p/docs/real/Real.md', depth: 1, parent: '' },
  ]);
  ok('D34 empty-label hub skipped', t3 && t3.length === 1 && t3[0].section === 'Real');
  // D35 — slugFolder returns "" when the section slugifies to empty (e.g. all punctuation)
  ok('D35 slugFolder empty-section guard', D && D.slugFolder('p', '!!!', '') === '');
  // D36 — targetPath with empty folder yields just the filename (no leading slash)
  ok('D36 targetPath empty folder -> filename only', D && D.targetPath('', 'a/b/Doc.md') === 'Doc.md');
  // D37 — inferSectionFromPath uses the LAST "docs" segment (a doc inside a section literally named "docs")
  const inf = D && D.inferSectionFromPath('spice/projects/docs/docs/reference/Note.md');
  ok('D37 infer last-docs semantics', inf && inf.section === 'reference' && inf.subSection === '');
}

// ---- DocLeafActions pure helpers (Project Doc Updating Wiring PR2) ----
// The Move dialog's runtime (renameFile/processFrontMatter) + modal are
// dogfood-only; these cover the two pure helpers it relies on plus the
// normalizeHubs -> DocMove.sectionTargets seam. Loads DocLeafActions from
// source, so reverting doc-leaf-actions.js makes DLA0 fail (Gate B L1 red).
{
  const DLA_SRCFILE = path.join(ROOT, 'platform', 'blueprints', 'project', 'helpers', 'doc-leaf-actions.js');
  const DLA_SRC = fs.existsSync(DLA_SRCFILE) ? fs.readFileSync(DLA_SRCFILE, 'utf8') : '';
  const DLACls = DLA_SRC ? new Function(`${DLA_SRC}\nreturn DocLeafActions;`)() : null;
  ok('DLA0 helper class loads', !!DLACls);
  const dla = DLACls ? new DLACls() : null;

  // normalizeHubs — maps queried section-hub pages to { label, path, depth, parent }.
  const hubs = DLACls && DLACls.normalizeHubs([
    { section: 'Knowledge', depth: 1, parent_section: '', file: { name: 'Knowledge', path: 'spice/projects/x/docs/knowledge/Knowledge.md' }, path: 'spice/projects/x/docs/knowledge/Knowledge.md' },
    { section: 'Advanced', depth: 2, parent_section: 'Knowledge', file: { name: 'Advanced', path: 'spice/projects/x/docs/knowledge/advanced/Advanced.md' }, path: 'spice/projects/x/docs/knowledge/advanced/Advanced.md' },
    null,
  ]);
  ok('DLA1 normalizeHubs drops null + maps fields',
    hubs && hubs.length === 2 && hubs[0].label === 'Knowledge' && hubs[0].depth === 1 &&
    hubs[1].parent === 'Knowledge' && hubs[1].depth === 2);
  // falls back to the hub file basename when frontmatter `section` is absent; depth defaults to 1.
  const hb2 = DLACls && DLACls.normalizeHubs([{ file: { name: 'Ops', path: 'p/docs/ops/Ops.md' } }]);
  ok('DLA2 normalizeHubs name fallback + depth default',
    hb2 && hb2.length === 1 && hb2[0].label === 'Ops' && hb2[0].depth === 1 && hb2[0].path === 'p/docs/ops/Ops.md');

  // normalizeHubs -> DocMove.sectionTargets seam produces the right ordered targets.
  const tgts = D && DLACls && D.sectionTargets(DLACls.normalizeHubs([
    { section: 'Knowledge', depth: 1, parent_section: '', file: { name: 'Knowledge', path: 'spice/projects/x/docs/knowledge/Knowledge.md' }, path: 'spice/projects/x/docs/knowledge/Knowledge.md' },
    { section: 'Advanced', depth: 2, parent_section: 'Knowledge', file: { name: 'Advanced', path: 'spice/projects/x/docs/knowledge/advanced/Advanced.md' }, path: 'spice/projects/x/docs/knowledge/advanced/Advanced.md' },
  ]));
  ok('DLA3 normalizeHubs feeds sectionTargets',
    tgts && tgts.length === 2 &&
    tgts.some((t) => t.label === 'Knowledge' && t.folder === 'spice/projects/x/docs/knowledge') &&
    tgts.some((t) => t.label === 'Knowledge / Advanced' && t.folder === 'spice/projects/x/docs/knowledge/advanced'));

  // projectDirFor — derives the project root from a doc-note path; "" when not under docs/.
  ok('DLA4 projectDirFor derives project root',
    dla && dla.projectDirFor('spice/projects/x/docs/knowledge/Note.md') === 'spice/projects/x');
  ok('DLA5 projectDirFor nested sub-section',
    dla && dla.projectDirFor('spice/projects/x/docs/knowledge/advanced/Note.md') === 'spice/projects/x');
  ok('DLA6 projectDirFor non-docs path -> ""',
    dla && dla.projectDirFor('spice/projects/x/tasks/T.md') === '' && dla.projectDirFor('') === '');
}

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
process.exit(allPass ? 0 : 1);
