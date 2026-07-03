#!/usr/bin/env node
/**
 * run-breadcrumb.js — Breadcrumb mechanism guards + resolver primitives + project parity.
 *
 * Phase 1 (Task 1): relocation + manifest assertions only.
 * Phase 2 (Task 2): resolver primitives (BR5–BR14) + project parity proof (BR15–BR23)
 *                   — LEGACY snapshot vs NEW registry-driven mechanism, byte-identical HTML.
 */
const fs = require('fs');
const path = require('path');
const VERSION_SNAPSHOT = require('./fixtures/component-versions.snapshot.json');
const ROOT = path.resolve(__dirname, '..', '..');
const MECH    = path.join(ROOT, 'platform', 'mechanisms', 'breadcrumb', 'breadcrumb.js');
const MAN     = path.join(ROOT, 'platform', 'mechanisms', 'breadcrumb', 'manifest.json');
const CAT     = path.join(ROOT, 'platform', 'manifest.json');
const LEGACY  = path.join(ROOT, 'platform', 'blueprints', 'project', 'helpers', 'breadcrumb.js');
const SNAPSHOT = path.join(ROOT, 'platform', 'test', 'fixtures', 'breadcrumb-legacy.js');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

// ── Stub el() — captures children + style + innerHTML so we can read the wrapper's innerHTML ──
function makeEl(tag, txt, opts) {
  const el = {
    tag,
    txt: txt || '',
    cls: (opts && opts.cls) || '',
    style: { cssText: '' },
    innerHTML: '',
    children: []
  };
  return el;
}

// Stub dv: dv.current() returns the provided cur object; dv.el captures elements;
// dv.pages returns an empty Dataview-like proxy (legacy code calls it from _resolveProjectFromPath).
function makeDv(cur, pagesData) {
  const els = [];
  const data = Array.isArray(pagesData) ? pagesData : [];
  // Array-like + Dataview-like: supports .where(fn), .array(), Array.from(), and .length.
  const result = { where: (fn) => data.filter(fn), array: () => data, length: data.length };
  return {
    current: () => cur,
    el: (tag, txt, opts) => { const e = makeEl(tag, txt, opts); els.push(e); return e; },
    pages: () => result,
    _els: els
  };
}

// ── Phase 1: BR1–BR4 ──────────────────────────────────────────────────────
ok('BR1 mechanism file at platform/mechanisms/breadcrumb/breadcrumb.js', fs.existsSync(MECH));
ok('BR2 legacy project-helper copy gone', !fs.existsSync(LEGACY));

let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(MAN, 'utf8')); } catch (_e) {}
ok('BR3 mechanism manifest declares customjs_classes: ["Breadcrumb"]',
   manifest && Array.isArray(manifest.customjs_classes) && manifest.customjs_classes.includes('Breadcrumb'));

let cat = null;
try { cat = JSON.parse(fs.readFileSync(CAT, 'utf8')); } catch (_e) {}
const catEntry = cat && Array.isArray(cat.mechanisms) && cat.mechanisms.find(m => m.name === 'breadcrumb');
ok('BR4 catalogue includes breadcrumb', catEntry && catEntry.version === VERSION_SNAPSHOT.components.breadcrumb);

// ── Load NEW class ────────────────────────────────────────────────────────
const NEW_SRC = fs.existsSync(MECH) ? fs.readFileSync(MECH, 'utf8') : '';
const NewBreadcrumb = NEW_SRC ? new Function(`${NEW_SRC}\nreturn Breadcrumb;`)() : null;

// ── Project types — inlined verbatim from design §3 (mirrors what Task 3
// adds to platform/blueprints/project/manifest.json). Self-contained so the
// resolver/parity tests don't depend on Task 3 ordering or manifest edits. ──
const PROJECT_TYPES = {
  "project": {
    "ancestors": [
      {
        "label": "fm:project_name|path:2",
        "link":  "spice/projects/{path:2}/{fm:project_name|path:2}.md"
      }
    ]
  },
  "project-todo": {
    "ancestors": [
      {
        "label": "fm:project_name|path:2",
        "link":  "spice/projects/{path:2}/{fm:project_name|path:2}.md"
      }
    ]
  },
  "docs-hub": {
    "ancestors": [
      {
        "label": "fm:project_name|path:2",
        "link":  "spice/projects/{path:2}/{fm:project_name|path:2}.md"
      }
    ],
    "current": { "label": "lit:Docs" }
  },
  "section-hub": {
    "ancestors": [
      {
        "label": "fm:project_name|path:2",
        "link":  "spice/projects/{path:2}/{fm:project_name|path:2}.md"
      },
      {
        "label": "lit:Docs",
        "link":  "spice/projects/{path:2}/docs/Docs.md"
      },
      {
        "when":  { "fm:depth": "2" },
        "label": "fm:parent_section",
        "link":  "spice/projects/{path:2}/docs/{slug:fm:parent_section}/{fm:parent_section}.md"
      }
    ],
    "current": { "label": "fm:section|file:basename" }
  },
  "doc-note": {
    "ancestors": [
      {
        "label": "fm:project_name|path:2",
        "link":  "spice/projects/{path:2}/{fm:project_name|path:2}.md"
      },
      {
        "label": "lit:Docs",
        "link":  "spice/projects/{path:2}/docs/Docs.md"
      },
      {
        "when":  { "fm:section": "present" },
        "label": "fm:section",
        "link":  "spice/projects/{path:2}/docs/{slug:fm:section}/{fm:section}.md"
      },
      {
        "when":  { "fm:sub_section": "present" },
        "label": "fm:sub_section",
        "link":  "spice/projects/{path:2}/docs/{slug:fm:section}/{slug:fm:sub_section}/{fm:sub_section}.md"
      }
    ],
    "current": { "label": "file:basename" }
  },
  "map": {
    "ancestors": [
      {
        "label": "fm:project_name|path:2",
        "link":  "spice/projects/{path:2}/{fm:project_name|path:2}.md"
      }
    ],
    "current": { "label": "lit:Map" }
  },
  "kanban": {
    "ancestors": [
      {
        "label": "fm:project_name|path:2",
        "link":  "spice/projects/{path:2}/{fm:project_name|path:2}.md"
      }
    ],
    "current": { "label": "lit:Board" }
  },
  "task-note": {
    "ancestors": [
      {
        "label": "fm:project_name|path:2",
        "link":  "spice/projects/{path:2}/{fm:project_name|path:2}.md"
      },
      {
        "label": "lit:Board",
        "link":  "spice/projects/{path:2}/{path:2}-board.md"
      }
    ],
    "current": { "label": "file:basename" }
  },
  "task-hub": {
    "ancestors": [
      {
        "label": "fm:project_name|path:2",
        "link":  "spice/projects/{path:2}/{fm:project_name|path:2}.md"
      },
      {
        "label": "lit:Board",
        "link":  "spice/projects/{path:2}/{path:2}-board.md"
      }
    ],
    "current": { "label": "file:basename" }
  },
  "task-board-card": {
    "ancestors": [
      {
        "label": "fm:project_name|path:2",
        "link":  "spice/projects/{path:2}/{fm:project_name|path:2}.md"
      },
      {
        "label": "path:4",
        "link":  "spice/projects/{path:2}/tasks/{path:4}/{path:4}.md"
      }
    ],
    "current": { "label": "file:basename" }
  }
};

// ── Wave-1 types — inlined verbatim from Task 1 §3–§5 (mirrors what this task
// adds to platform/blueprints/{meetings,scratch,to-do}/manifest.json). Kept
// self-contained so BR24–BR27 don't depend on manifest-edit ordering. ──
const MEETINGS_TYPES = {
  "meeting": {
    "ancestors": [
      { "label": "lit:Meetings" },
      { "label": "path:4" }
    ],
    "current": { "label": "file:basename" }
  }
};

const SCRATCH_TYPES = {
  "scratch": {
    "ancestors": [
      { "label": "lit:Scratch" },
      { "label": "path:3" },
      { "label": "path:4", "link": "spice/scratch/{path:2}/{path:3}/{path:4}/Scratch-Day-{path:4}.md" }
    ],
    "current": { "label": "fm:time|file:basename" }
  },
  "scratch-day": {
    "ancestors": [
      { "label": "lit:Scratch" },
      { "label": "path:3" }
    ],
    "current": { "label": "path:4" }
  }
};

const TODO_TYPES = {
  "to-do": {
    "ancestors": [
      { "label": "lit:To-Do" },
      { "label": "path:3" }
    ],
    "current": { "label": "file:basename" }
  }
};

// ── Wiki types — path_walk entries (BC-WIKI-1 through BC-WIKI-3) ─────────────
const WIKI_TYPES = {
  "wiki-hub":     { path_walk: { root_label: "Wiki", root_dir: "spice/wiki", root_file: "Wiki.md" } },
  "wiki-section": { path_walk: { root_label: "Wiki", root_dir: "spice/wiki", root_file: "Wiki.md" } },
  "wiki-page":    { path_walk: { root_label: "Wiki", root_dir: "spice/wiki", root_file: "Wiki.md" } },
};

const REGISTRY = {
  schema_version: 1,
  contributions: {
    project:  { types: PROJECT_TYPES },
    meetings: { types: MEETINGS_TYPES },
    scratch:  { types: SCRATCH_TYPES },
    "to-do":  { types: TODO_TYPES },
    wiki:     { types: WIKI_TYPES }
  }
};

// Inject global `app` with stub adapter.read so the mechanism's _loadRegistry works.
global.app = {
  vault: {
    adapter: {
      read: async (p) => {
        if (p === 'ranch/breadcrumb-registry.json') return JSON.stringify(REGISTRY);
        throw new Error('ENOENT ' + p);
      }
    }
  }
};

// Helper — synchronously await a promise (the harness is sync until here).
async function runAsync(fn) { return await fn(); }

// ── Phase 2a: resolver primitives BR5–BR14 ────────────────────────────────
(async () => {
  if (!NewBreadcrumb) {
    ok('BR5–BR23 SKIP (mechanism not loadable)', false);
    return finish();
  }

  // BR5 — fm:project_name resolves frontmatter field
  {
    const b = new NewBreadcrumb();
    const dv = makeDv({ project_name: 'test-project', file: { path: 'x', name: 'x' } });
    ok('BR5 fm:project_name reads frontmatter', b._resolveAtom('fm:project_name', dv) === 'test-project');
  }
  // BR6 — path:<n> is 0-indexed (so `path:2` resolves to project slug for
  // `spice/projects/<slug>/...` paths, matching the design's example links).
  {
    const b = new NewBreadcrumb();
    const dv = makeDv({ file: { path: 'spice/projects/test-project/docs/Docs.md', name: 'Docs' } });
    ok('BR6 path:2 returns project-slug segment (0-indexed)',
       b._resolveAtom('path:2', dv) === 'test-project');
  }
  // BR7 — file:basename
  {
    const b = new NewBreadcrumb();
    const dv = makeDv({ file: { path: 'x/Foo.md', name: 'Foo' } });
    ok('BR7 file:basename returns current.file.name', b._resolveAtom('file:basename', dv) === 'Foo');
  }
  // BR8 — lit:<text>
  {
    const b = new NewBreadcrumb();
    const dv = makeDv({ file: { path: 'x', name: 'x' } });
    ok('BR8 lit:Docs returns literal', b._resolveAtom('lit:Docs', dv) === 'Docs');
  }
  // BR9 — slug:fm:section slugifies FM value
  {
    const b = new NewBreadcrumb();
    const dv = makeDv({ section: 'Knowledge Base', file: { path: 'x', name: 'x' } });
    ok('BR9 slug:fm:section slugifies', b._resolveAtom('slug:fm:section', dv) === 'knowledge-base');
  }
  // BR10 — |-chain: first non-empty wins
  {
    const b = new NewBreadcrumb();
    const dv = makeDv({ file: { path: 'a/b/c.md', name: 'c' } });
    // fm:absent is empty; path:2 = 'c.md' (0-indexed); first non-empty wins
    ok('BR10 fm:absent|path:2 = path:2 value', b._resolveChain('fm:absent|path:2', dv) === 'c.md');
  }
  // BR11 — all-empty chain → empty string → ancestor segment dropped
  {
    const b = new NewBreadcrumb();
    const dv = makeDv({ file: { path: '', name: '' } });
    ok('BR11 all-empty chain → empty string', b._resolveChain('fm:nope|fm:also-nope', dv) === '');
  }
  // BR12 — link template with empty slot → returns null
  {
    const b = new NewBreadcrumb();
    const dv = makeDv({ file: { path: '', name: '' } });
    // No fm fields, path empty → both slots fail
    const out = b._resolveTemplate('spice/projects/{path:2}/{fm:project_name}.md', dv);
    ok('BR12 template with empty slot returns null', out === null);
  }
  // BR13 — when: { "fm:depth": "2" } gates correctly
  {
    const b = new NewBreadcrumb();
    const dv2 = makeDv({ depth: 2, file: { path: 'x', name: 'x' } });
    const dv1 = makeDv({ depth: 1, file: { path: 'x', name: 'x' } });
    const okGate = b._evalWhen({ "fm:depth": "2" }, dv2) === true
                && b._evalWhen({ "fm:depth": "2" }, dv1) === false;
    ok('BR13 when fm:depth literal gate', okGate);
  }
  // BR14 — when: { "fm:section": "present" } evaluates non-empty
  {
    const b = new NewBreadcrumb();
    const dvPresent = makeDv({ section: 'Knowledge', file: { path: 'x', name: 'x' } });
    const dvAbsent  = makeDv({ file: { path: 'x', name: 'x' } });
    const okPres = b._evalWhen({ "fm:section": "present" }, dvPresent) === true
                && b._evalWhen({ "fm:section": "present" }, dvAbsent)  === false;
    ok('BR14 when fm:section present', okPres);
  }

  // ── Phase 2b: project parity proof BR15–BR23 ──────────────────────────
  const LEGACY_SRC = fs.readFileSync(SNAPSHOT, 'utf8');
  const LegacyBreadcrumb = new Function(`${LEGACY_SRC}\nreturn Breadcrumb;`)();

  const FIXTURES = [
    { name: 'BR15 project',
      cur: { project_name: 'test-project', project: 'test-project', project_slug: 'test-project', type: 'project',
             file: { path: 'spice/projects/test-project/test-project.md', name: 'test-project' } } },
    { name: 'BR16 project-todo',
      cur: { project_name: 'test-project', project: 'test-project', project_slug: 'test-project', type: 'project-todo',
             file: { path: 'spice/projects/test-project/test-project To-Do.md', name: 'test-project To-Do' } } },
    { name: 'BR17 docs-hub',
      cur: { project_name: 'test-project', project: 'test-project', project_slug: 'test-project', type: 'docs-hub',
             file: { path: 'spice/projects/test-project/docs/Docs.md', name: 'Docs' } } },
    { name: 'BR18 section-hub depth 1',
      cur: { project_name: 'test-project', project: 'test-project', project_slug: 'test-project',
             type: 'section-hub', section: 'Knowledge', depth: 1,
             file: { path: 'spice/projects/test-project/docs/knowledge/Knowledge.md', name: 'Knowledge' } } },
    { name: 'BR19 section-hub depth 2',
      cur: { project_name: 'test-project', project: 'test-project', project_slug: 'test-project',
             type: 'section-hub', section: 'Subsec', parent_section: '[[Knowledge]]', depth: 2,
             file: { path: 'spice/projects/test-project/docs/knowledge/subsec/Subsec.md', name: 'Subsec' } } },
    { name: 'BR20 doc-note',
      cur: { project_name: 'test-project', project: 'test-project', project_slug: 'test-project',
             type: 'doc-note', section: 'Knowledge',
             file: { path: 'spice/projects/test-project/docs/knowledge/Architecture.md', name: 'Architecture' } } },
    { name: 'BR21 map',
      cur: { type: 'map',
             file: { path: 'spice/projects/test-project/Project Map.md', name: 'Project Map' } } },
    { name: 'BR22 kanban',
      cur: { type: 'kanban',
             file: { path: 'spice/projects/test-project/test-project-board.md', name: 'test-project-board' } } },
    { name: 'BR23 task-note',
      cur: { type: 'task-note',
             file: { path: 'spice/projects/test-project/tasks/sometask/sometask.md', name: 'sometask' } } }
  ];

  function firstDiff(a, b) {
    if (a === b) return null;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const pre = a.slice(Math.max(0, i - 40), i);
    const aRest = a.slice(i, i + 80);
    const bRest = b.slice(i, i + 80);
    return `pos=${i} (..."${pre}") legacy="${aRest}" | new="${bRest}"`;
  }

  for (const fx of FIXTURES) {
    // Legacy render — note legacy needs project + project_slug FM; for map/kanban/task-note
    // it falls back to _resolveProjectFromPath which uses path[1] = "projects" + path[2] = "test-project".
    // The legacy returns { projectSlug: "test-project", projectName: "test-project" } from the fall-back
    // branch (since dv.pages stub returns empty). For PROJECT type explicitly we set FM project too.
    const legacyDv = makeDv(fx.cur);
    const legacyInst = new LegacyBreadcrumb();
    await legacyInst.render(legacyDv);

    const newDv = makeDv(fx.cur);
    const newInst = new NewBreadcrumb();
    await newInst.render(newDv);

    const legacyWrap = legacyDv._els[0];
    const newWrap = newDv._els[0];

    // Both should either render or both not render
    if (!legacyWrap && !newWrap) {
      ok(fx.name + ' (no render — both empty)', true);
      continue;
    }
    if (!legacyWrap || !newWrap) {
      ok(fx.name + ' both should render or both should be empty', false);
      console.log(`    legacy: ${legacyWrap ? 'rendered' : 'empty'}; new: ${newWrap ? 'rendered' : 'empty'}`);
      continue;
    }
    const a = legacyWrap.innerHTML;
    const b = newWrap.innerHTML;
    const eq = a === b;
    ok(fx.name + ' byte-identical innerHTML', eq);
    if (!eq) console.log(`    DIFF: ${firstDiff(a, b)}`);
  }

  // ── BR24–BR27: wave-1 adoption (meetings / scratch / scratch-day / to-do) ──
  const WAVE1 = [
    { name: 'BR24 meeting',
      cur: { type: 'meeting',
             file: { path: 'spice/meetings/notes/2026/06-June/Standup-2026-06-17.md', name: 'Standup-2026-06-17' } },
      expect: ['Meetings', '06-June', 'Standup-2026-06-17'] },
    { name: 'BR25 scratch',
      cur: { type: 'scratch', time: '14:30',
             file: { path: 'spice/scratch/2026/06-June/2026-06-17/Scratch-2026-06-17-14-30.md', name: 'Scratch-2026-06-17-14-30' } },
      expect: ['Scratch', '06-June', '2026-06-17', '14:30'] },
    { name: 'BR26 scratch-day',
      cur: { type: 'scratch-day',
             file: { path: 'spice/scratch/2026/06-June/2026-06-17/Scratch-Day-2026-06-17.md', name: 'Scratch-Day-2026-06-17' } },
      expect: ['Scratch', '06-June', '2026-06-17'] },
    { name: 'BR27 to-do',
      cur: { type: 'to-do',
             file: { path: 'spice/to-do/2026/06-June/ToDo-2026-06-17.md', name: 'ToDo-2026-06-17' } },
      expect: ['To-Do', '06-June', 'ToDo-2026-06-17'] },
  ];
  for (const fx of WAVE1) {
    const dv = makeDv(fx.cur);
    const inst = new NewBreadcrumb();
    await inst.render(dv);
    const wrap = dv._els[0];
    const html = wrap ? wrap.innerHTML : '';
    const all = fx.expect.every((seg) => html.includes(seg));
    ok(fx.name + ' trail contains ' + fx.expect.join(' / '), !!wrap && all);
    if (!all) console.log(`    HTML: ${html}`);
  }

  // ── BR28–BR29: WS7 board-card breadcrumb coverage (task-hub / task-board-card) ──
  // task-hub is the promoted project kanban card at tasks/<Task>/<Task>.md — its
  // trail mirrors task-note: Project > Board > <this card>. task-board-card is the
  // deeper card at tasks/<Task>/board/<Card>/<Card>.md — Project > <Task> > <card>.
  {
    const dv = makeDv({
      type: 'task-hub',
      project_name: 'test-project',
      file: { path: 'spice/projects/test-project/tasks/Ship It/Ship It.md', name: 'Ship It' }
    });
    const inst = new NewBreadcrumb();
    await inst.render(dv);
    const wrap = dv._els[0];
    const html = wrap ? wrap.innerHTML : '';
    // Project ancestor: linked to the atlas note, label from fm:project_name.
    const hasProject = html.includes('href="spice/projects/test-project/test-project.md"') && html.includes('>test-project<');
    // Board ancestor: linked to <slug>-board.md, literal label "Board".
    const hasBoard = html.includes('href="spice/projects/test-project/test-project-board.md"') && html.includes('>Board<');
    // Current crumb: unlinked file basename "Ship It".
    const hasCurrent = html.includes('>Ship It<');
    ok('BR28 task-hub: Project(atlas link) / Board / <card> current', !!wrap && hasProject && hasBoard && hasCurrent);
    if (!wrap || !hasProject || !hasBoard || !hasCurrent) console.log(`    BR28 HTML: ${html}`);
  }
  {
    const dv = makeDv({
      type: 'task-board-card',
      project_name: 'test-project',
      file: { path: 'spice/projects/test-project/tasks/Ship It/board/Card One/Card One.md', name: 'Card One' }
    });
    const inst = new NewBreadcrumb();
    await inst.render(dv);
    const wrap = dv._els[0];
    const html = wrap ? wrap.innerHTML : '';
    // Project ancestor: linked to the atlas note.
    const hasProject = html.includes('href="spice/projects/test-project/test-project.md"') && html.includes('>test-project<');
    // Task hub ancestor: path:4 = "Ship It", linked to the task-hub note.
    const hasTask = html.includes('href="spice/projects/test-project/tasks/Ship It/Ship It.md"') && html.includes('>Ship It<');
    // Current crumb: unlinked file basename "Card One".
    const hasCurrent = html.includes('>Card One<');
    ok('BR29 task-board-card: Project(atlas link) / <Task>(hub link) / <card> current', !!wrap && hasProject && hasTask && hasCurrent);
    if (!wrap || !hasProject || !hasTask || !hasCurrent) console.log(`    BR29 HTML: ${html}`);
  }

  // ── BC-WIKI-1: deep wiki-page — intermediate crumbs resolve section-hub TITLE + real path ──
  {
    // Section hubs present in the vault: folders are slugified (infra/aws), hubs Display-Case.
    const sectionHubs = [
      { type: 'wiki-section', title: 'Infra', file: { folder: 'spice/wiki/infra', path: 'spice/wiki/infra/Infra.md', name: 'Infra.md' } },
      { type: 'wiki-section', title: 'AWS', file: { folder: 'spice/wiki/infra/aws', path: 'spice/wiki/infra/aws/AWS.md', name: 'AWS.md' } },
    ];
    const dv = makeDv({
      type: 'wiki-page',
      title: 'VPC Peering',
      file: { path: 'spice/wiki/infra/aws/VPC Peering.md', name: 'VPC Peering.md' }
    }, sectionHubs);
    const inst = new NewBreadcrumb();
    await inst.render(dv);
    const wrap = dv._els[0];
    const html = wrap ? wrap.innerHTML : '';
    // Root crumb: linked to spice/wiki/Wiki.md with label "Wiki"
    const hasRoot = html.includes('href="spice/wiki/Wiki.md"') && html.includes('>Wiki<');
    // infra crumb: linked to the REAL hub path, label is the display TITLE "Infra"
    const hasInfra = html.includes('href="spice/wiki/infra/Infra.md"') && html.includes('>Infra<');
    // aws crumb: linked to the REAL hub path, label is the display TITLE "AWS"
    const hasAws = html.includes('href="spice/wiki/infra/aws/AWS.md"') && html.includes('>AWS<');
    // current crumb: not linked (span), label "VPC Peering"
    const hasCurrent = html.includes('>VPC Peering<') && !html.includes('href="spice/wiki/infra/aws/VPC Peering.md"');
    ok('BC-WIKI-1 deep page: root+Infra+AWS(title+realpath)+current', !!wrap && hasRoot && hasInfra && hasAws && hasCurrent);
    if (!wrap || !hasRoot || !hasInfra || !hasAws || !hasCurrent)
      console.log(`    BC-WIKI-1 HTML: ${html}`);
  }

  // ── BC-WIKI-1b: fallback — no section hub found → uses folder segment + <seg>.md link ──
  {
    const dv = makeDv({
      type: 'wiki-page',
      title: 'Orphan',
      file: { path: 'spice/wiki/loosedir/Orphan.md', name: 'Orphan.md' }
    }); // no pagesData → no hub resolvable
    const inst = new NewBreadcrumb();
    await inst.render(dv);
    const html = dv._els[0] ? dv._els[0].innerHTML : '';
    const fallbackCrumb = html.includes('href="spice/wiki/loosedir/loosedir.md"') && html.includes('>loosedir<');
    const hasCurrent = html.includes('>Orphan<');
    ok('BC-WIKI-1b fallback: segment label + <seg>.md link when no hub found', fallbackCrumb && hasCurrent);
    if (!fallbackCrumb || !hasCurrent) console.log(`    BC-WIKI-1b HTML: ${html}`);
  }

  // ── BC-WIKI-2: section hub (root + current, no self-crumb for folder) ───
  {
    const dv = makeDv({
      type: 'wiki-section',
      title: 'Infra',
      file: { path: 'spice/wiki/infra/Infra.md', name: 'Infra.md' }
    });
    const inst = new NewBreadcrumb();
    await inst.render(dv);
    const wrap = dv._els[0];
    const html = wrap ? wrap.innerHTML : '';
    // Root linked
    const hasRoot = html.includes('href="spice/wiki/Wiki.md"') && html.includes('>Wiki<');
    // Current "Infra" unlinked (span)
    const hasCurrent = html.includes('>Infra<') && !html.includes('href="spice/wiki/infra/infra.md"');
    // No self-crumb link for the "infra" folder
    const noSelfCrumb = !html.includes('href="spice/wiki/infra/infra.md"');
    ok('BC-WIKI-2 section hub: root+current no self-crumb', !!wrap && hasRoot && hasCurrent && noSelfCrumb);
    if (!wrap || !hasRoot || !hasCurrent || !noSelfCrumb)
      console.log(`    BC-WIKI-2 HTML: ${html}`);
  }

  // ── BC-WIKI-3: root hub — single unlinked crumb ──────────────────────────
  {
    const dv = makeDv({
      type: 'wiki-hub',
      title: 'Wiki',
      file: { path: 'spice/wiki/Wiki.md', name: 'Wiki.md' }
    });
    const inst = new NewBreadcrumb();
    await inst.render(dv);
    const wrap = dv._els[0];
    const html = wrap ? wrap.innerHTML : '';
    // Single "Wiki" span (not linked)
    const hasWikiSpan = html.includes('>Wiki<') && !html.includes('href="spice/wiki/Wiki.md"');
    // No separator (only one segment)
    const onlyOneSeg = !html.includes(' / ');
    ok('BC-WIKI-3 root hub: single unlinked Wiki crumb', !!wrap && hasWikiSpan && onlyOneSeg);
    if (!wrap || !hasWikiSpan || !onlyOneSeg)
      console.log(`    BC-WIKI-3 HTML: ${html}`);
  }

  // ── BC-WIKI-4: pre-existing project types still pass ────────────────────
  // (All BR15–BR27 asserts above already ran; this is a named sentinel confirming
  // the path_walk branch is truly additive and doesn't break existing types.)
  {
    // Quick smoke: render a "project" type and confirm it still produces a link
    const dv = makeDv({
      type: 'project',
      project_name: 'test-project',
      file: { path: 'spice/projects/test-project/test-project.md', name: 'test-project' }
    });
    const inst = new NewBreadcrumb();
    await inst.render(dv);
    const wrap = dv._els[0];
    const html = wrap ? wrap.innerHTML : '';
    ok('BC-WIKI-4 existing project type unaffected by path_walk', !!wrap && html.includes('test-project'));
  }

  // ── BC-SEG-1..3: buildSegments() additive DATA seam ──────────────────────
  // buildSegments(dv) returns the resolved trail as [{ label, link|null }] —
  // the SAME segments render(dv) draws (asserted byte-identical via BR15–BR29
  // above). A later chrome-bar helper renders these crumbs on the left of its
  // bar and needs the data, not pre-rendered HTML. Assert labels AND links.
  function segEq(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].label !== b[i].label) return false;
      if ((a[i].link || null) !== (b[i].link || null)) return false;
    }
    return true;
  }

  // BC-SEG-1 — project doc-note: Project(link) / Docs(link) / <section>(link) / <file>(current)
  {
    const dv = makeDv({
      project_name: 'test-project', project: 'test-project', project_slug: 'test-project',
      type: 'doc-note', section: 'Knowledge',
      file: { path: 'spice/projects/test-project/docs/knowledge/Architecture.md', name: 'Architecture' }
    });
    const inst = new NewBreadcrumb();
    const segs = await inst.buildSegments(dv);
    const expected = [
      { label: 'test-project', link: 'spice/projects/test-project/test-project.md' },
      { label: 'Docs',         link: 'spice/projects/test-project/docs/Docs.md' },
      { label: 'Knowledge',    link: 'spice/projects/test-project/docs/knowledge/Knowledge.md' },
      { label: 'Architecture', link: null },
    ];
    ok('BC-SEG-1 doc-note segments {label,link} match render', segEq(segs, expected));
    if (!segEq(segs, expected)) console.log('    BC-SEG-1 got: ' + JSON.stringify(segs));
  }

  // BC-SEG-2 — section-hub (depth 1): Project(link) / Docs(link) / <section>(current)
  // The depth-2 parent_section ancestor is when-gated on fm:depth==2 → dropped at depth 1.
  {
    const dv = makeDv({
      project_name: 'test-project', project: 'test-project', project_slug: 'test-project',
      type: 'section-hub', section: 'Knowledge', depth: 1,
      file: { path: 'spice/projects/test-project/docs/knowledge/Knowledge.md', name: 'Knowledge' }
    });
    const inst = new NewBreadcrumb();
    const segs = await inst.buildSegments(dv);
    const expected = [
      { label: 'test-project', link: 'spice/projects/test-project/test-project.md' },
      { label: 'Docs',         link: 'spice/projects/test-project/docs/Docs.md' },
      { label: 'Knowledge',    link: null },
    ];
    ok('BC-SEG-2 section-hub segments {label,link} match render', segEq(segs, expected));
    if (!segEq(segs, expected)) console.log('    BC-SEG-2 got: ' + JSON.stringify(segs));
  }

  // BC-SEG-3 — root / no-matching-type → []. The projects-hub root note carries
  // no breadcrumb-registered `type`, so render() bails (no wrap emitted) — the
  // data seam mirrors that with an empty array so callers guard by .length.
  {
    const dvNoType = makeDv({
      file: { path: 'spice/projects/Projects.md', name: 'Projects' }
    });
    const inst = new NewBreadcrumb();
    const segsNoType = await inst.buildSegments(dvNoType);
    // render() produces nothing for this note (no wrap) — confirm parity.
    const renderDv = makeDv({ file: { path: 'spice/projects/Projects.md', name: 'Projects' } });
    await new NewBreadcrumb().render(renderDv);
    const renderedNothing = !renderDv._els[0];
    ok('BC-SEG-3 no-matching-type → [] (render emits nothing)',
       Array.isArray(segsNoType) && segsNoType.length === 0 && renderedNothing);
    if (segsNoType.length !== 0 || !renderedNothing)
      console.log('    BC-SEG-3 got: ' + JSON.stringify(segsNoType) + ' renderedNothing=' + renderedNothing);
  }

  finish();
})().catch(err => {
  console.error('harness error:', err);
  process.exit(2);
});

function finish() {
  const allPass = results.every(([, p]) => p);
  console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
  process.exit(allPass ? 0 : 1);
}
