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
function makeDv(cur) {
  const els = [];
  return {
    current: () => cur,
    el: (tag, txt, opts) => { const e = makeEl(tag, txt, opts); els.push(e); return e; },
    pages: () => ({ where: () => [], length: 0 }),
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

const REGISTRY = {
  schema_version: 1,
  contributions: {
    project:  { types: PROJECT_TYPES },
    meetings: { types: MEETINGS_TYPES },
    scratch:  { types: SCRATCH_TYPES },
    "to-do":  { types: TODO_TYPES }
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
