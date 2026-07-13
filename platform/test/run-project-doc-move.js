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

// ---- DocBulkMoveActions pure helpers (Project Doc Updating Wiring PR3) ----
// The bulk Move-docs modal + runtime batch move are dogfood-only; these cover
// the three pure helpers it owns (normalizeHubs, groupDocsBySection, planBulkMove)
// including the batch planner's already-there / no-dest / intra-batch collision
// skips. Loads the class from source, so reverting doc-bulk-move.js fails DBM0
// (Gate B L1 red).
{
  const DBM_SRCFILE = path.join(ROOT, 'platform', 'blueprints', 'project', 'helpers', 'doc-bulk-move.js');
  const DBM_SRC = fs.existsSync(DBM_SRCFILE) ? fs.readFileSync(DBM_SRCFILE, 'utf8') : '';
  const DBMCls = DBM_SRC ? new Function(`${DBM_SRC}\nreturn DocBulkMoveActions;`)() : null;
  ok('DBM0 helper class loads', !!DBMCls);

  // groupDocsBySection — groups by `section` frontmatter, sorted; blank -> "(unsectioned)".
  const grouped = DBMCls && DBMCls.groupDocsBySection([
    { section: 'Knowledge', sub_section: '', path: 'p/docs/knowledge/B.md', file: { name: 'B.md', path: 'p/docs/knowledge/B.md' } },
    { section: 'Knowledge', sub_section: '', path: 'p/docs/knowledge/A.md', file: { name: 'A.md', path: 'p/docs/knowledge/A.md' } },
    { section: '', path: 'p/docs/Loose.md', file: { name: 'Loose.md', path: 'p/docs/Loose.md' } },
    null,
  ]);
  ok('DBM1 groupDocsBySection groups + sorts sections',
    grouped && grouped.length === 2 && grouped[0].section === '(unsectioned)' && grouped[1].section === 'Knowledge');
  ok('DBM2 groupDocsBySection sorts docs by name within a section',
    grouped && grouped[1].docs.length === 2 && grouped[1].docs[0].name === 'A' && grouped[1].docs[1].name === 'B');
  // wikilink section value is stripped to the plain display name.
  const gwl = DBMCls && DBMCls.groupDocsBySection([{ section: '[[Knowledge|Kb]]', path: 'p/docs/knowledge/X.md', file: { name: 'X.md', path: 'p/docs/knowledge/X.md' } }]);
  ok('DBM3 groupDocsBySection strips wikilink section', gwl && gwl.length === 1 && gwl[0].section === 'Knowledge');

  // planBulkMove — uses DocMove for targetPath + isSameLocation; classifies skips.
  const target = { section: 'Knowledge', subSection: '', folder: 'p/docs/knowledge' };
  const plan = DBMCls && D && DBMCls.planBulkMove([
    { path: 'p/docs/notes/A.md' },            // moves -> p/docs/knowledge/A.md
    { path: 'p/docs/knowledge/B.md' },        // already-there (same folder as target)
    { path: 'p/docs/other/A.md' },            // collision: also -> p/docs/knowledge/A.md
    { path: '' },                             // ignored (no path)
  ], target, D);
  ok('DBM4 planBulkMove moves a relocatable doc',
    plan && plan.moves.length === 1 && plan.moves[0].from === 'p/docs/notes/A.md' &&
    plan.moves[0].to === 'p/docs/knowledge/A.md' && plan.moves[0].section === 'Knowledge');
  ok('DBM5 planBulkMove skips already-there',
    plan && plan.skipped.some((s) => s.path === 'p/docs/knowledge/B.md' && s.reason === 'already-there'));
  ok('DBM6 planBulkMove skips intra-batch destination collision',
    plan && plan.skipped.some((s) => s.path === 'p/docs/other/A.md' && s.reason === 'collision'));

  // normalizeHubs — same shape contract as DocLeafActions (depth-2 parent mapping).
  const nh = DBMCls && DBMCls.normalizeHubs([
    { section: 'Knowledge', depth: 1, parent_section: '', file: { name: 'Knowledge', path: 'p/docs/knowledge/Knowledge.md' }, path: 'p/docs/knowledge/Knowledge.md' },
    { section: 'Advanced', depth: 2, parent_section: 'Knowledge', file: { name: 'Advanced', path: 'p/docs/knowledge/advanced/Advanced.md' }, path: 'p/docs/knowledge/advanced/Advanced.md' },
  ]);
  ok('DBM7 normalizeHubs maps depth + parent',
    nh && nh.length === 2 && nh[0].depth === 1 && nh[1].depth === 2 && nh[1].parent === 'Knowledge');

  // docsFolderFor — the docs-hub note lives at spice/projects/<slug>/docs/Docs.md,
  // so its folder IS the docs folder to scan (NOT folder + "/docs"). This pins the
  // exact path-derivation the modal depends on (a regression here dead-ends the button).
  const dbm = DBMCls ? new DBMCls() : null;
  ok('DBM8 docsFolderFor uses the hub note folder as the docs folder',
    dbm && dbm.docsFolderFor({ file: { folder: 'spice/projects/x/docs', path: 'spice/projects/x/docs/Docs.md' } }) === 'spice/projects/x/docs');
  ok('DBM9 docsFolderFor derives folder from path when folder absent',
    dbm && dbm.docsFolderFor({ file: { path: 'spice/projects/x/docs/Docs.md' } }) === 'spice/projects/x/docs');
  ok('DBM10 docsFolderFor rejects a non-docs folder -> ""',
    dbm && dbm.docsFolderFor({ file: { folder: 'spice/projects/x' } }) === '' && dbm.docsFolderFor({ file: {} }) === '');
}

// ---- DocMoveDialog pure helpers (WS5 — wiki-style Move tree dialog) ----------
// Mirrors the shipped WikiMove pattern: sectionTargets(pages, projectDir) returns
// depth-ordered { folder, label, depth } (root first, then every section-hub under
// docs/ sorted lexically so parents precede children); targetPath/isNoop join +
// no-op-guard exactly like WikiMove. The overlay + runtime move (renameFile +
// processFrontMatter) are dogfood-only; these cover the pure logic. Loads the
// class from source so reverting doc-move-dialog.js fails DMD0 (Gate B L1 red).
{
  const DMD_SRCFILE = path.join(ROOT, 'platform', 'blueprints', 'project', 'helpers', 'doc-move-dialog.js');
  const DMD_SRC = fs.existsSync(DMD_SRCFILE) ? fs.readFileSync(DMD_SRCFILE, 'utf8') : '';
  const DMDCls = DMD_SRC ? new Function(`${DMD_SRC}\nreturn DocMoveDialog;`)() : null;
  ok('DMD0 helper class loads', !!DMDCls);
  const dm = DMDCls ? new DMDCls() : null;

  // sectionTargets — root first, then section-hubs depth-ordered (parent precedes child).
  {
    const pages = [
      { type: 'section-hub', section: 'A', file: { path: 'spice/projects/p/docs/a/A.md' } },
      { type: 'section-hub', section: 'B', file: { path: 'spice/projects/p/docs/a/b/B.md' } },
    ];
    const t = dm && dm.sectionTargets(pages, 'spice/projects/p');
    ok('DMD1 sectionTargets count (root + 2 sections)', t && t.length === 3);
    ok('DMD2 labels root/A/B', t && t[0].label === 'Docs (root)' && t[1].label === 'A' && t[2].label === 'B');
    ok('DMD3 depths 0/1/2', t && t[0].depth === 0 && t[1].depth === 1 && t[2].depth === 2);
    ok('DMD4 root folder = projectDir/docs', t && t[0].folder === 'spice/projects/p/docs');
    ok('DMD5 section folders = dirname of hub path',
      t && t[1].folder === 'spice/projects/p/docs/a' && t[2].folder === 'spice/projects/p/docs/a/b');
  }
  // sectionTargets — lexical sort places a parent before its children even out of order,
  // and ignores non-section-hub pages + pages outside projectDir/docs.
  {
    const pages = [
      { type: 'section-hub', section: 'Zeta', file: { path: 'spice/projects/p/docs/z/Zeta.md' } },
      { type: 'section-hub', section: 'Alpha', file: { path: 'spice/projects/p/docs/a/Alpha.md' } },
      { type: 'section-hub', section: 'Alpha Sub', file: { path: 'spice/projects/p/docs/a/sub/Alpha Sub.md' } },
      { type: 'doc-note', file: { path: 'spice/projects/p/docs/a/Note.md' } },       // not a hub — ignored
      { type: 'section-hub', section: 'Other', file: { path: 'spice/projects/other/docs/x/Other.md' } }, // other project — ignored
    ];
    const t = dm && dm.sectionTargets(pages, 'spice/projects/p');
    ok('DMD6 sort places parent before child + filters foreign pages',
      t && t.length === 4 &&
      t[0].label === 'Docs (root)' &&
      t[1].folder === 'spice/projects/p/docs/a' &&
      t[2].folder === 'spice/projects/p/docs/a/sub' &&
      t[3].folder === 'spice/projects/p/docs/z');
    ok('DMD7 label prefers section over basename', t && t[1].label === 'Alpha' && t[2].label === 'Alpha Sub');
  }
  // label fallback: section absent -> title -> basename.
  {
    const pages = [
      { type: 'section-hub', title: 'Titled', file: { path: 'spice/projects/p/docs/t/Titled Hub.md' } },
      { type: 'section-hub', file: { path: 'spice/projects/p/docs/n/No Label.md' } },
    ];
    // sorted lexically by folder: docs(root), .../n (No Label), .../t (Titled)
    const t = dm && dm.sectionTargets(pages, 'spice/projects/p');
    ok('DMD8 label fallback title then basename',
      t && t[1].label === 'No Label' && t[2].label === 'Titled');
  }

  // targetPath / isNoop — mirror WikiMove.
  ok('DMD9 targetPath joins folder + basename',
    dm && dm.targetPath('spice/projects/p/docs/a', 'spice/projects/p/docs/b/Doc.md') === 'spice/projects/p/docs/a/Doc.md');
  ok('DMD10 isNoop true when already in folder',
    dm && dm.isNoop('spice/projects/p/docs/a', 'spice/projects/p/docs/a/Doc.md') === true);
  ok('DMD11 isNoop false when elsewhere',
    dm && dm.isNoop('spice/projects/p/docs/a', 'spice/projects/p/docs/b/Doc.md') === false);
}

// ---- SectionHub `move` adapter block (Task H1 — shared SectionExplorer wiring) ----
// SectionHub._buildConfig now returns a `move` block the shared SectionExplorer
// mechanism reads (rewriteOnDocMove / rewriteOnSectionMove / canAcceptSection /
// enumerateSectionTargets) plus emptySubsectionCount + a recursive canDelete.
// We load SectionHub + the REAL SectionExplorer statics from source (the block
// delegates to customJS.SectionExplorer.sectionTargets / childSectionFolders /
// subtreeDocCount), install a minimal dv + customJS, and drive the block's pure
// hooks directly. Reverting section-hub.js fails SH0 (Gate B L1 red).
{
  const SH_SRCFILE = path.join(ROOT, 'platform', 'blueprints', 'project', 'helpers', 'section-hub.js');
  const SH_SRC = fs.existsSync(SH_SRCFILE) ? fs.readFileSync(SH_SRCFILE, 'utf8') : '';
  const SHCls = SH_SRC ? new Function(`${SH_SRC}\nreturn SectionHub;`)() : null;
  ok('SH0 SectionHub class loads', !!SHCls);

  const SE_SRCFILE = path.join(ROOT, 'platform', 'mechanisms', 'section-explorer', 'section-explorer.js');
  const SE_SRC = fs.existsSync(SE_SRCFILE) ? fs.readFileSync(SE_SRCFILE, 'utf8') : '';
  const SECls = SE_SRC ? new Function(`${SE_SRC}\nreturn SectionExplorer;`)() : null;
  ok('SH0b SectionExplorer class loads', !!SECls);

  // A tiny dv whose pages('"<folder>"') returns the pages under that folder from a
  // fixed corpus (prefix match, like Dataview's folder source). Supplies .array().
  const makeDv = (pages) => ({
    pages: (src) => {
      const m = String(src).match(/^"(.*)"$/);
      const folder = m ? m[1] : String(src);
      const arr = pages.filter((p) => {
        const pf = p && p.file && p.file.path ? String(p.file.path) : '';
        return pf.indexOf(folder + '/') === 0;
      });
      arr.array = () => arr;
      arr.where = (fn) => { const w = arr.filter(fn); w.array = () => w; w.where = arr.where; return w; };
      return arr;
    },
  });

  // Install the real SectionExplorer statics on customJS for the duration of fn
  // (the move block reads customJS.SectionExplorer.* + this._childHubsForRename
  // uses dv.where at call time).
  const withSE = (fn) => {
    const prevCJS = global.customJS;
    const se = SECls ? new SECls() : {};
    se.childSectionFolders = SECls.childSectionFolders;
    se.subtreeDocCount = SECls.subtreeDocCount;
    se.sectionTargets = SECls.sectionTargets;
    se.pagesUnder = SECls.pagesUnder;   // dispatch-time enumeration (metadataCache)
    global.customJS = { SectionExplorer: se };
    try { return fn(); } finally { global.customJS = prevCJS; }
  };

  // Build the `move` block + emptySubsectionCount + canDelete for a depth-1 hub
  // in project "p". customJS.SectionExplorer is the real static class instance.
  const buildBlock = (corpus) => {
    const prevCJS = global.customJS;
    global.customJS = { SectionExplorer: SECls ? new SECls() : {} };
    // statics are referenced by class name inside the block, so expose the class.
    global.customJS.SectionExplorer.childSectionFolders = SECls.childSectionFolders;
    global.customJS.SectionExplorer.subtreeDocCount = SECls.subtreeDocCount;
    global.customJS.SectionExplorer.sectionTargets = SECls.sectionTargets;
    global.customJS.SectionExplorer.pagesUnder = SECls.pagesUnder;
    const sh = SHCls ? new SHCls() : null;
    const dv = makeDv(corpus);
    const cur = { file: { path: 'spice/projects/p/docs/knowledge/Knowledge.md', name: 'Knowledge' }, section: 'Knowledge', section_slug: 'knowledge', depth: 1 };
    const cfg = sh ? sh._buildConfig(dv, cur, 1, 'p', 'knowledge', 'Knowledge') : null;
    global.customJS = prevCJS;
    return { cfg, dv, sh };
  };

  const DOCS = 'spice/projects/p/docs';
  // Corpus: Knowledge (depth-1, HAS a child sub-section Advanced) + Notes (depth-1,
  // childless) + a doc-note inside Advanced.
  const corpus = [
    { type: 'section-hub', depth: 1, section: 'Knowledge', file: { path: `${DOCS}/knowledge/Knowledge.md`, folder: `${DOCS}/knowledge` } },
    { type: 'section-hub', depth: 2, section: 'Advanced', file: { path: `${DOCS}/knowledge/advanced/Advanced.md`, folder: `${DOCS}/knowledge/advanced` } },
    { type: 'section-hub', depth: 1, section: 'Notes', file: { path: `${DOCS}/notes/Notes.md`, folder: `${DOCS}/notes` } },
    { type: 'doc-note', file: { path: `${DOCS}/knowledge/advanced/Deep.md`, folder: `${DOCS}/knowledge/advanced` } },
  ];

  // Dispatch-time enumeration/gates read the metadataCache (mobile-safe), not
  // dv.pages — install a matching global.app built from the corpus.
  const _prevApp = global.app;
  global.app = {
    vault: { getMarkdownFiles: () => corpus.map((p) => ({ path: p.file.path, name: p.file.path.slice(p.file.path.lastIndexOf('/') + 1) })) },
    metadataCache: {
      getFileCache: (f) => {
        const p = corpus.find((pp) => pp.file.path === (f && f.path));
        return p ? { frontmatter: { type: p.type, title: p.title, section: p.section, sub_section: p.sub_section, depth: p.depth, links: p.links } } : { frontmatter: {} };
      },
    },
  };

  const { cfg } = buildBlock(corpus);
  ok('SH1 _buildConfig returns a move block', !!(cfg && cfg.move));

  // rewriteOnDocMove — depth-1 dest → {section:<seg>, sub_section:""};
  // depth-2 dest → {section:parent, sub_section:leaf}; root → both "".
  {
    const mv = cfg && cfg.move;
    const d1 = mv && mv.rewriteOnDocMove(`${DOCS}/knowledge`);
    ok('SH2 rewriteOnDocMove depth-1 dest → {section, sub_section:""}',
      d1 && d1.section === 'knowledge' && d1.sub_section === '');
    const d2 = mv && mv.rewriteOnDocMove(`${DOCS}/knowledge/advanced`);
    ok('SH3 rewriteOnDocMove depth-2 dest → {section:parent, sub_section:leaf}',
      d2 && d2.section === 'knowledge' && d2.sub_section === 'advanced');
    const dr = mv && mv.rewriteOnDocMove(DOCS);
    ok('SH4 rewriteOnDocMove docs root → both ""',
      dr && dr.section === '' && dr.sub_section === '');
    const dtrail = mv && mv.rewriteOnDocMove(`${DOCS}/knowledge/`);
    ok('SH5 rewriteOnDocMove tolerates a trailing slash',
      dtrail && dtrail.section === 'knowledge' && dtrail.sub_section === '');
  }

  // canAcceptSection — 2-level cap. resultDepth = destDepth+1; a section WITH
  // children pushes its deepest child to resultDepth+1. Needs the real
  // SectionExplorer statics at call time (childSectionFolders).
  withSE(() => {
    const mv = cfg && cfg.move;
    const kSection = { folder: `${DOCS}/knowledge`, hubPath: `${DOCS}/knowledge/Knowledge.md`, title: 'Knowledge' }; // HAS children
    const nSection = { folder: `${DOCS}/notes`, hubPath: `${DOCS}/notes/Notes.md`, title: 'Notes' };               // childless

    // childless → dest depth-1 (`knowledge`) → resultDepth 2 → OK.
    ok('SH6 canAcceptSection childless may nest one level (dest depth 1 → depth-2)',
      mv && mv.canAcceptSection(nSection, `${DOCS}/knowledge`) === true);
    // section WITH children → dest depth-1 → child would be depth-3 → BLOCKED.
    ok('SH7 canAcceptSection parent-with-children BLOCKED from dest depth 1 (would be depth-3)',
      mv && mv.canAcceptSection(kSection, `${DOCS}/notes`) === false);
    // section WITH children → docs root (dest depth 0) → child at depth-2 → OK.
    ok('SH8 canAcceptSection parent-with-children OK at docs root (dest depth 0 → child depth-2)',
      mv && mv.canAcceptSection(kSection, DOCS) === true);
    // childless → docs root → resultDepth 1 → OK.
    ok('SH9 canAcceptSection childless OK at docs root',
      mv && mv.canAcceptSection(nSection, DOCS) === true);
  });

  // rewriteOnSectionMove — hubPatch depth/parent_section + child parent_section patches.
  withSE(() => {
    const mv = cfg && cfg.move;
    const kSection = { folder: `${DOCS}/knowledge`, hubPath: `${DOCS}/knowledge/Knowledge.md`, title: 'Knowledge' };
    // Move Knowledge under Notes (dest parent = notes, depth-1) → new depth 2,
    // parent_section "notes"; child Advanced's parent_section → "Knowledge".
    const plan = mv && mv.rewriteOnSectionMove(kSection, `${DOCS}/notes`);
    ok('SH10 rewriteOnSectionMove returns { hubPatch, childPatches }',
      plan && plan.hubPatch && Array.isArray(plan.childPatches));
    ok('SH11 hubPatch depth/parent_section from dest parent (one level in → depth 2)',
      plan && plan.hubPatch.depth === 2 && plan.hubPatch.parent_section === 'notes');
    ok('SH12 child patch retargets parent_section to the moved section title',
      plan && plan.childPatches.length === 1
        && plan.childPatches[0].path === `${DOCS}/knowledge/advanced/Advanced.md`
        && plan.childPatches[0].patch.parent_section === 'Knowledge');
    // Move to docs root → depth 1, parent_section "".
    const planRoot = mv && mv.rewriteOnSectionMove(kSection, DOCS);
    ok('SH13 rewriteOnSectionMove to docs root → depth 1, parent_section ""',
      planRoot && planRoot.hubPatch.depth === 1 && planRoot.hubPatch.parent_section === '');
    // Out of docs tree → null (no-op).
    const planOut = mv && mv.rewriteOnSectionMove(kSection, 'spice/projects/other/docs');
    ok('SH14 rewriteOnSectionMove out of docs tree → null', planOut === null);
  });

  // enumerateSectionTargets — root first, then the two depth-1 hubs + the depth-2.
  {
    const mv = cfg && cfg.move;
    const prevCJS = global.customJS;
    global.customJS = { SectionExplorer: SECls ? new SECls() : {} };
    global.customJS.SectionExplorer.sectionTargets = SECls.sectionTargets;
    global.customJS.SectionExplorer.pagesUnder = SECls.pagesUnder;
    const t = mv && mv.enumerateSectionTargets(makeDv(corpus));
    global.customJS = prevCJS;
    ok('SH15 enumerateSectionTargets returns root + 3 section hubs',
      t && t.length === 4 && t[0].folder === DOCS && t[0].depth === 0);
    ok('SH16 enumerateSectionTargets labels via _stripLink(section)',
      t && t.some((x) => x.label === 'Knowledge') && t.some((x) => x.label === 'Advanced'));
  }

  // emptySubsectionCount — counts child section-hubs under a section.
  {
    const prevCJS = global.customJS;
    global.customJS = { SectionExplorer: SECls ? new SECls() : {} };
    global.customJS.SectionExplorer.childSectionFolders = SECls.childSectionFolders;
    global.customJS.SectionExplorer.pagesUnder = SECls.pagesUnder;
    const kSection = { folder: `${DOCS}/knowledge` };
    const nSection = { folder: `${DOCS}/notes` };
    ok('SH17 emptySubsectionCount counts child section-hubs (Knowledge → 1)',
      cfg && cfg.emptySubsectionCount(kSection) === 1);
    ok('SH18 emptySubsectionCount 0 for a childless section (Notes → 0)',
      cfg && cfg.emptySubsectionCount(nSection) === 0);
    global.customJS = prevCJS;
  }

  // canDelete — recursive doc-note subtree count. Knowledge has a doc-note in
  // Advanced → NOT deletable; Notes is empty → deletable.
  {
    const prevCJS = global.customJS;
    global.customJS = { SectionExplorer: SECls ? new SECls() : {} };
    global.customJS.SectionExplorer.subtreeDocCount = SECls.subtreeDocCount;
    global.customJS.SectionExplorer.pagesUnder = SECls.pagesUnder;
    const kSection = { folder: `${DOCS}/knowledge`, hubPath: `${DOCS}/knowledge/Knowledge.md` };
    const nSection = { folder: `${DOCS}/notes`, hubPath: `${DOCS}/notes/Notes.md` };
    ok('SH19 canDelete false when a doc-note exists in the subtree', cfg && cfg.canDelete(kSection) === false);
    ok('SH20 canDelete true when the subtree has no doc-notes', cfg && cfg.canDelete(nSection) === true);
    ok('SH21 canDelete false without a hubPath', cfg && cfg.canDelete({ folder: `${DOCS}/notes` }) === false);
    global.customJS = prevCJS;
  }

  // sectionPath is folder-is-truth — derived from the note's real cur.file.folder,
  // NOT reconstructed from parent_section frontmatter (which can be stale). Live
  // bug: a depth-2 hub with parent_section:"Misc-Subsection" (should be "Misc")
  // reconstructed docs/misc-subsection/misc-subsection — a folder that doesn't
  // exist — so listPages returned 0 and the hub showed "Nothing here yet.".
  {
    const sh = SHCls ? new SHCls() : null;
    // Minimal dv: _buildConfig closes over its args; only sectionPath (via
    // resolveContext) is under test, so pages/page can return empties.
    const dvStub = { pages: () => { const a = []; a.array = () => a; a.where = () => a; return a; }, page: () => null };

    // SH22 — depth-2 with the EXACT live bug: parent_section stale
    // ("Misc-Subsection" not "Misc"); folder-is-truth must ignore it.
    const curBug = {
      type: 'section-hub', depth: 2, project_slug: 'sauce',
      section: 'Misc-Subsection', section_slug: 'misc-subsection', parent_section: 'Misc-Subsection',
      file: {
        name: 'Misc-Subsection.md',
        folder: 'spice/projects/sauce/docs/misc/misc-subsection',
        path: 'spice/projects/sauce/docs/misc/misc-subsection/Misc-Subsection.md',
      },
    };
    const cfgBug = sh ? sh._buildConfig(dvStub, curBug, 2, 'sauce', 'misc-subsection', 'Misc-Subsection') : null;
    ok('SH22 _buildConfig sectionPath = real folder (folder-is-truth, ignores stale parent_section)',
      cfgBug && cfgBug.resolveContext().sectionPath === 'spice/projects/sauce/docs/misc/misc-subsection');

    // SH23 — depth-1 non-regression: folder-is-truth still equals the depth-1 path.
    const cur1 = {
      type: 'section-hub', depth: 1, project_slug: 'sauce',
      section: 'Misc', section_slug: 'misc',
      file: {
        name: 'Misc.md',
        folder: 'spice/projects/sauce/docs/misc',
        path: 'spice/projects/sauce/docs/misc/Misc.md',
      },
    };
    const cfg1 = sh ? sh._buildConfig(dvStub, cur1, 1, 'sauce', 'misc', 'Misc') : null;
    ok('SH23 _buildConfig sectionPath depth-1 non-regression',
      cfg1 && cfg1.resolveContext().sectionPath === 'spice/projects/sauce/docs/misc');
  }
}

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
process.exit(allPass ? 0 : 1);
