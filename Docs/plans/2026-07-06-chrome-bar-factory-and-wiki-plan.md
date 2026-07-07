# ChromeBar Factory + Wiki Adoption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a `ChromeBar.makeAdapter(config)` factory to the chrome-bar mechanism and make the wiki blueprint the second adopter of the shared `Go ▾ / primary / ⋯` bar — behavior-preserving (same New Page / New Section / Move + Wiki/up nav), just in the unified bar.

**Architecture:** `makeAdapter(config)` assembles the render-ready adapter (resolve/navEntries/openNavTarget/rootClass/btnClass) from a small per-blueprint config (detect/surfaceSpec/dispatch/destinations). `WikiChromeBar` supplies that config, reusing the EXISTING `EntityCreate` (create) + `WikiLeafActions._openMoveDialog` (move) + `WikiLeafActions._resolveSectionHub` (up-nav). WikiTree stops rendering the hub-action buttons (they move into the bar) and keeps its search+tree as content. Existing wiki notes are healed.

**Tech Stack:** CustomJS classes (instance methods; `new Function` test loader). Design: `Docs/plans/2026-07-06-chrome-bar-factory-and-wiki-design.md`.

**Base:** worktree `sauce-cb-wiki` on `feat/chrome-bar-wiki` off `origin/main` (v0.199.0, chrome-bar@0.2.0 present).

**Global rules:** work only in the worktree; customJS methods are INSTANCE methods (tests drive `new Class()`); never hand-bump version records except NEW entries; every branch never-throw + cold-load-safe.

---

### Task 1: `ChromeBar.openNavTarget` + `ChromeBar.makeAdapter` (the factory)

**Files:**
- Modify: `platform/mechanisms/chrome-bar/chrome-bar.js` (add 2 methods)
- Test: `platform/test/run-chrome-bar.js` (add CB-FACTORY cases into the async chain)

- [ ] **Step 1: Write the failing tests** — insert this async case fn at the `// PLACEHOLDER-ANCHOR:` (or alongside the other `cb*Cases` fns) in `run-chrome-bar.js`, and add `await cbFactoryCases();` to the async IIFE tail before `summarize()`:

```js
// ── CB-FACTORY-1..6 — makeAdapter(config) assembles a render-ready adapter;
// openNavTarget opens cold-cache-safe.
async function cbFactoryCases() {
  // openNavTarget: resolvable path → getLeaf().openFile(TFile); else openLinkText.
  const openFiles = [], openLinks = [];
  const prevApp = global.app;
  const f = { path: 'spice/wiki/Wiki.md' };
  global.app = { vault: { getAbstractFileByPath: (p) => (p === f.path ? f : null) },
    workspace: { getLeaf: () => ({ openFile: (x) => openFiles.push(x) }), openLinkText: (p) => openLinks.push(p) } };
  inst.openNavTarget('spice/wiki/Wiki.md', {});
  inst.openNavTarget('spice/wiki/Missing.md', {});
  global.app = prevApp;
  ok('CB-FACTORY-1 openNavTarget opens a resolvable path via getLeaf().openFile (TFile)', openFiles.length === 1 && openFiles[0] === f);
  ok('CB-FACTORY-2 openNavTarget falls back to openLinkText for an unresolved path', openLinks.length === 1 && openLinks[0] === 'spice/wiki/Missing.md');

  const cfg = {
    detect: (dv, page) => (page && page.file && page.file.path.indexOf('/wiki/') >= 0 ? { context: 'wiki-hub' } : null),
    surfaceSpec: (ctx) => ({ primary: { id: 'new-page', label: 'New Page', icon: '<svg/>' }, overflow: [], leaf: false }),
    dispatch: (dv, ctx, id) => { dv.__dispatched = id; },
    destinations: (dv, ctx) => ([{ section: 'This wiki' }, { label: 'Wiki', icon: '<svg/>', onSelect() {} }]),
    rootClass: 'wiki-chrome-root',
    btnClass: (v) => `wiki-chrome-btn wiki-chrome-btn-${v}`,
  };
  const adapter = inst.makeAdapter(cfg);
  ok('CB-FACTORY-3 resolve → null when detect returns null', adapter.resolve({}, { file: { path: 'x.md' } }) === null);
  const r = adapter.resolve({}, { file: { path: 'spice/wiki/Wiki.md' } });
  ok('CB-FACTORY-4 resolve → { ctx, spec } when detect matches', r && r.ctx.context === 'wiki-hub' && r.spec.primary.id === 'new-page');
  ok('CB-FACTORY-5 rootClass/btnClass thread through', adapter.rootClass === 'wiki-chrome-root' && adapter.btnClass('go') === 'wiki-chrome-btn wiki-chrome-btn-go');
  // navEntries = destinations + Vault grid (Vault empty here since no registry stub) → at least the destinations.
  const prevApp2 = global.app, prevCJS = global.customJS;
  global.app = { vault: { adapter: { read: async () => { throw new Error('ENOENT'); } } } };
  global.customJS = { SpaceNavButtons: { firstEntryPerSource: () => [] }, Icons: { resolve: () => '' } };
  const entries = await adapter.navEntries({}, { context: 'wiki-hub' });
  global.app = prevApp2; global.customJS = prevCJS;
  ok('CB-FACTORY-6 navEntries begins with the config.destinations (This wiki + Wiki)',
    entries[0] && entries[0].section === 'This wiki' && entries.some((e) => e && e.label === 'Wiki'));
}
```

- [ ] **Step 2: Run to verify FAIL** — `cd /Users/willfellhoelter/projects/repos/sauce-cb-wiki && node platform/test/run-chrome-bar.js` → FAIL (`inst.openNavTarget`/`inst.makeAdapter` not a function).

- [ ] **Step 3: Implement** — add both methods to the `ChromeBar` class (after `vaultEntries`, before `render`). `openNavTarget` is copied VERBATIM from the current `platform/blueprints/project/helpers/project-chrome-bar.js` `_openNavTarget` body:

```js
  // ── openNavTarget — cold-cache-safe absolute-path open (generalized from
  // ProjectChromeBar._openNavTarget so every adapter gets it): resolve the TFile
  // and getLeaf().openFile (bypasses the link resolver, which can double an
  // absolute path against the current note's folder on a cold cache), else fall
  // back to openLinkText. Never throws.
  openNavTarget(path, dv) {
    try {
      const f = app.vault.getAbstractFileByPath(path);
      if (f && app.workspace && typeof app.workspace.getLeaf === "function") {
        app.workspace.getLeaf(false).openFile(f);
        return;
      }
    } catch (_e) { /* fall through to openLinkText */ }
    try { app.workspace.openLinkText(path, ""); } catch (_err) { /* never throw */ }
  }

  // ── makeAdapter — build a render(dv, adapter)-ready adapter from a per-blueprint
  // config. Centralizes everything identical across blueprints (resolve wrapping,
  // navEntries = the blueprint's This-<space> destinations + the shared Vault grid,
  // the cold-cache-safe open). A blueprint supplies only what differs.
  //   config = { detect(dv,page)->ctx|null, surfaceSpec(ctx)->{primary,overflow,leaf},
  //              dispatch(dv,ctx,id), destinations(dv,ctx)->entry[], rootClass, btnClass }
  makeAdapter(config) {
    const self = this;
    return {
      resolve(dv, page) {
        const ctx = config.detect(dv, page);
        if (!ctx) return null;
        return { ctx, spec: config.surfaceSpec(ctx) };
      },
      async navEntries(dv, ctx) {
        const entries = [];
        try { for (const e of (config.destinations(dv, ctx) || [])) entries.push(e); } catch (_e) { /* best-effort */ }
        const open = (p) => self.openNavTarget(p, dv);
        try { for (const e of await self.vaultEntries(dv, open)) entries.push(e); } catch (_e) { /* best-effort */ }
        return entries;
      },
      dispatch: (dv, ctx, id) => { try { config.dispatch(dv, ctx, id); } catch (_e) { /* never throw */ } },
      openNavTarget: (p, dv) => self.openNavTarget(p, dv),
      rootClass: config.rootClass,
      btnClass: config.btnClass,
    };
  }
```

- [ ] **Step 4: Run to verify PASS** — `node platform/test/run-chrome-bar.js` → PASS (17 prior + CB-FACTORY-1..6 = 23/23).

- [ ] **Step 5: Commit**

```bash
cd /Users/willfellhoelter/projects/repos/sauce-cb-wiki
git add platform/mechanisms/chrome-bar/chrome-bar.js platform/test/run-chrome-bar.js
git commit -m "feat(chrome-bar): makeAdapter(config) factory + openNavTarget — adopt the bar with just a config"
```

---

### Task 2: `WikiChromeBar` helper (the wiki config)

**Files:**
- Create: `platform/blueprints/wiki/helpers/wiki-chrome-bar.js`
- Modify: `platform/blueprints/wiki/manifest.json` (register class + depend on chrome-bar)
- Create: `platform/test/run-wiki-chrome-bar.js`
- Modify: `package.json` (`test:wiki-chrome-bar` + append to `release:preflight`)

- [ ] **Step 1: Create `platform/test/run-wiki-chrome-bar.js`** — drives the real WikiChromeBar config. The three icon SVGs (`filePlus`/`folderPlus`/`moveIcon`) don't need exact bytes in the test (assert `id`/`label`/`leaf` + dispatch routes). Loader mirrors run-chrome-bar.js.

```js
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const WikiChromeBar = loadClass('platform/blueprints/wiki/helpers/wiki-chrome-bar.js', 'WikiChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new WikiChromeBar();
const cfg = inst._config();

// WCB-DETECT — classify surfaces by frontmatter type; null off-surface.
{
  const hub = cfg.detect({}, { file: { path: 'spice/wiki/Wiki.md' }, type: 'wiki-hub' });
  const sec = cfg.detect({}, { file: { path: 'spice/wiki/Foo/Foo.md' }, type: 'wiki-section' });
  const page = cfg.detect({}, { file: { path: 'spice/wiki/Foo/Bar.md' }, type: 'wiki-page' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('WCB-DETECT-1 wiki-hub/section/page classify; non-wiki → null',
    hub && hub.context === 'wiki-hub' && sec && sec.context === 'wiki-section' && page && page.context === 'wiki-page' && off === null);
}
// WCB-SPEC — hub/section = New Page primary + New Section overflow, not leaf; page = leaf + Move overflow.
{
  const h = cfg.surfaceSpec({ context: 'wiki-hub' });
  const p = cfg.surfaceSpec({ context: 'wiki-page' });
  ok('WCB-SPEC-1 hub: primary new-page + overflow new-section + not leaf',
    h.primary.id === 'new-page' && h.overflow.some((o) => o.id === 'new-section') && h.leaf === false);
  ok('WCB-SPEC-2 page: leaf + primary null + overflow move',
    p.leaf === true && p.primary === null && p.overflow.length === 1 && p.overflow[0].id === 'move');
}
// WCB-DISPATCH — new-page/new-section → EntityCreate.create(instance); move → WikiLeafActions._openMoveDialog.
{
  const calls = [];
  const prevCJS = global.customJS;
  global.customJS = {
    EntityCreate: { create: (o) => calls.push({ create: o.instance }) },
    WikiLeafActions: { _openMoveDialog: (dv, p) => calls.push({ move: p }) },
  };
  const dv = { current: () => ({ file: { path: 'spice/wiki/Foo/Bar.md' } }) };
  cfg.dispatch(dv, { context: 'wiki-hub' }, 'new-page');
  cfg.dispatch(dv, { context: 'wiki-hub' }, 'new-section');
  cfg.dispatch(dv, { context: 'wiki-page' }, 'move');
  global.customJS = prevCJS;
  ok('WCB-DISPATCH-1 new-page → EntityCreate.create(instance:"wiki-page")', calls.some((c) => c.create === 'wiki-page'));
  ok('WCB-DISPATCH-2 new-section → EntityCreate.create(instance:"wiki-section")', calls.some((c) => c.create === 'wiki-section'));
  ok('WCB-DISPATCH-3 move → WikiLeafActions._openMoveDialog(dv, currentPath)', calls.some((c) => c.move === 'spice/wiki/Foo/Bar.md'));
}
// WCB-DEST — destinations lead with a { section:"This wiki" } marker + a Wiki-home entry;
// the root hub omits its own Wiki entry (no self-nav).
{
  const prevCJS = global.customJS;
  global.customJS = { WikiLeafActions: { _resolveSectionHub: () => ({ label: 'Foo', path: 'spice/wiki/Foo/Foo.md' }) } };
  const page = cfg.destinations({ current: () => ({ file: { path: 'spice/wiki/Foo/Bar.md' } }) }, { context: 'wiki-page' });
  const rootHub = cfg.destinations({ current: () => ({ file: { path: 'spice/wiki/Wiki.md' } }) }, { context: 'wiki-hub' });
  global.customJS = prevCJS;
  ok('WCB-DEST-1 page destinations: This wiki marker + Wiki home + up-section',
    page[0] && page[0].section === 'This wiki' && page.some((e) => e && e.label === 'Wiki') && page.some((e) => e && e.label === 'Foo'));
  ok('WCB-DEST-2 root hub omits its own Wiki self-link', !rootHub.some((e) => e && e._navTarget === 'spice/wiki/Wiki.md'));
}
console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
```

- [ ] **Step 2: Run to verify FAIL** — `node platform/test/run-wiki-chrome-bar.js` → FAIL (cannot read wiki-chrome-bar.js).

- [ ] **Step 3: Create `platform/blueprints/wiki/helpers/wiki-chrome-bar.js`.** Copy the `filePlus` / `folderPlus` / `moveIcon` SVG strings VERBATIM from `wiki-hub-actions.js` (filePlus, folderPlus) and `wiki-leaf-actions.js` (moveIcon).

```js
/**
 * WikiChromeBar (CustomJS) — the wiki blueprint's ChromeBar adapter config.
 *
 * Renders the shared Go ▾ / primary / ⋯ bar on wiki surfaces via
 * customJS.ChromeBar.makeAdapter(this._config()). Reuses the EXISTING wiki
 * helpers for actions (EntityCreate for New Page/New Section, WikiLeafActions
 * for Move + parent-section resolution) — no new action code. Instance methods;
 * never-throw; cold-load-safe.
 */
class WikiChromeBar {
  get ICON() {
    return {
      folderPlus: `<PASTE folderPlus SVG VERBATIM FROM wiki-hub-actions.js>`,
      filePlus: `<PASTE filePlus SVG VERBATIM FROM wiki-hub-actions.js>`,
      move: `<PASTE moveIcon SVG VERBATIM FROM wiki-leaf-actions.js>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }

  _config() {
    const ICON = this.ICON;
    const ROOT = "spice/wiki";
    return {
      // Classify by frontmatter type; null → not a wiki surface (render nothing).
      detect: (dv, page) => {
        const t = page && page.type;
        if (t !== "wiki-hub" && t !== "wiki-section" && t !== "wiki-page") return null;
        return { context: t, path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: (ctx) => {
        if (ctx.context === "wiki-page") {
          return { primary: null, overflow: [{ id: "move", label: "Move", icon: ICON.move }], leaf: true };
        }
        // wiki-hub / wiki-section
        return {
          primary: { id: "new-page", label: "New Page", icon: ICON.filePlus },
          overflow: [{ id: "new-section", label: "New Section", icon: ICON.folderPlus }],
          leaf: false,
        };
      },
      dispatch: (dv, ctx, id) => {
        if (id === "new-page" || id === "new-section") {
          const instance = id === "new-page" ? "wiki-page" : "wiki-section";
          if (customJS && customJS.EntityCreate && typeof customJS.EntityCreate.create === "function") {
            customJS.EntityCreate.create({ instance, dv });
          } else if (typeof Notice === "function") { new Notice("WikiChromeBar: EntityCreate unavailable — reinstall wiki blueprint.", 6000); }
          return;
        }
        if (id === "move") {
          let cur = null; try { cur = dv && dv.current ? dv.current() : null; } catch (_e) { cur = null; }
          const p = (cur && cur.file && cur.file.path) || (ctx && ctx.path) || "";
          if (customJS && customJS.WikiLeafActions && typeof customJS.WikiLeafActions._openMoveDialog === "function") {
            customJS.WikiLeafActions._openMoveDialog(dv, p);
          } else if (typeof Notice === "function") { new Notice("WikiChromeBar: WikiLeafActions unavailable — reinstall wiki blueprint.", 6000); }
          return;
        }
      },
      // The Go ▾ "This wiki" section: Wiki home + (on section/page) the parent
      // section hub. Reuses WikiLeafActions._resolveSectionHub. The current surface
      // omits its own self-link.
      destinations: (dv, ctx) => {
        const out = [{ section: "This wiki" }];
        let curPath = ctx && ctx.path;
        if (!curPath) { try { const c = dv && dv.current ? dv.current() : null; curPath = (c && c.file && c.file.path) || ""; } catch (_e) { curPath = ""; } }
        const wikiHome = ROOT + "/Wiki.md";
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        // Wiki home — omit when we ARE the root hub.
        if (curPath !== wikiHome) {
          out.push({ label: "Wiki", icon: ICON.filePlus, _navTarget: wikiHome, onSelect: () => open(wikiHome) });
        }
        // Up to parent section (section/page only), via the existing resolver.
        if (ctx.context !== "wiki-hub" && curPath) {
          const folder = curPath.slice(0, curPath.lastIndexOf("/"));
          const parent = ctx.context === "wiki-section" ? folder.slice(0, folder.lastIndexOf("/")) : folder;
          if (parent && parent !== ROOT && parent.startsWith(ROOT + "/")
            && customJS && customJS.WikiLeafActions && typeof customJS.WikiLeafActions._resolveSectionHub === "function") {
            try {
              const hub = customJS.WikiLeafActions._resolveSectionHub(dv, parent);
              if (hub && hub.path && hub.path !== curPath) {
                out.push({ label: hub.label, icon: ICON.folderPlus, _navTarget: hub.path, onSelect: () => open(hub.path) });
              }
            } catch (_e) { /* best-effort up-nav */ }
          }
        }
        return out;
      },
      rootClass: "wiki-chrome-root",
      btnClass: (v) => `wiki-chrome-btn wiki-chrome-btn-${v}`,
    };
  }
}
```

- [ ] **Step 4: Register the class + dependency** — in `platform/blueprints/wiki/manifest.json`: add `"WikiChromeBar"` to `customjs_classes`; add a file entry mapping `helpers/wiki-chrome-bar.js` → `{{scripts_path}}/wiki/wiki-chrome-bar.js` (mirror the existing wiki helper file entries); add `{ "name": "chrome-bar", "range": ">=0.3.0" }` to `depends_on` (the makeAdapter bump).

- [ ] **Step 5: Register the test** — `package.json`: add `"test:wiki-chrome-bar": "node platform/test/run-wiki-chrome-bar.js"` and append ` && node platform/test/run-wiki-chrome-bar.js` to `release:preflight`.

- [ ] **Step 6: Run to verify PASS** — `node platform/test/run-wiki-chrome-bar.js` → PASS (all WCB-*). Also `node platform/test/run-customjs-loadable.js` → PASS (WikiChromeBar loads).

- [ ] **Step 7: Commit**

```bash
git add platform/blueprints/wiki/helpers/wiki-chrome-bar.js platform/blueprints/wiki/manifest.json platform/test/run-wiki-chrome-bar.js package.json
git commit -m "feat(wiki): WikiChromeBar adapter config (reuses EntityCreate + WikiLeafActions)"
```

---

### Task 3: WikiTree stops rendering the hub-action buttons

**Files:**
- Modify: `platform/blueprints/wiki/helpers/wiki-tree.js` (remove the `WikiHubActions.render` call)
- Modify: `platform/test/run-wiki.js` (if it asserts WikiTree renders hub actions)

The +New Page/+New Section buttons now live in the ChromeBar (Task 2), so WikiTree must stop drawing them or they double.

- [ ] **Step 1: Check the existing assertion** — `grep -n "WikiHubActions\|hub-actions\|New Page\|New Section" platform/test/run-wiki.js`. If a case asserts WikiTree renders the hub actions, it will need updating in Step 3.

- [ ] **Step 2: Remove the call** in `wiki-tree.js` — delete the try/catch block that calls `customJS.WikiHubActions.render(dv)` (the ~6 lines: `try { if (customJS && customJS.WikiHubActions && …) { customJS.WikiHubActions.render(dv); } } catch (_e) { /* buttons are best-effort */ }`) and its preceding comment about "Render the create/nav buttons at the top of THIS block". WikiTree now renders ONLY the search strip + tree (content). Leave everything else byte-unchanged.

- [ ] **Step 3: Update any broken run-wiki assertion** — if Step 1 found a hub-actions assertion, change it to assert WikiTree NO LONGER renders WikiHubActions (or drop that specific sub-assert). Keep all search/tree assertions.

- [ ] **Step 4: Run to verify** — `node platform/test/run-wiki.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/wiki/helpers/wiki-tree.js platform/test/run-wiki.js
git commit -m "refactor(wiki): WikiTree no longer renders hub actions (moved into the ChromeBar)"
```

---

### Task 4: Rewrite the 3 wiki templates

**Files:**
- Modify: `platform/blueprints/wiki/templates/Wiki.md`
- Modify: `platform/blueprints/wiki/templates/Section Hub.md`
- Modify: `platform/blueprints/wiki/templates/Wiki Page.md`

- [ ] **Step 1: Rewrite `Wiki.md` and `Section Hub.md`** — replace the `Breadcrumb` + `SpaceNavButtons` dataviewjs blocks with ONE `WikiChromeBar` block; keep the `WikiTree` block below. The chrome region becomes:

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "WikiChromeBar" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "WikiTree" });
```
(No literal `---` between them — the bar owns its spacing.) Preserve each file's frontmatter unchanged.

- [ ] **Step 2: Rewrite `Wiki Page.md`** — replace the `Breadcrumb` + `SpaceNavButtons` + `WikiLeafActions` blocks with ONE `WikiChromeBar` block:

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "WikiChromeBar" });
```
(followed by whatever page-body content the template had after the chrome; if it was only chrome, the block is the whole chrome region.)

- [ ] **Step 3: Lint** — `node scripts/lint-note-chrome.js` → PASS (no literal chrome `---`, bar is the chrome unit).

- [ ] **Step 4: Commit**

```bash
git add "platform/blueprints/wiki/templates/Wiki.md" "platform/blueprints/wiki/templates/Section Hub.md" "platform/blueprints/wiki/templates/Wiki Page.md"
git commit -m "feat(wiki): templates render the single WikiChromeBar block"
```

---

### Task 5: `applyWikiChromeBarHeal` (migrate existing wiki notes)

**Files:**
- Modify: `platform/install.js` (add the heal fn + invoke it, mirroring `applyProjectChromeBarHeal`)
- Test: `platform/test/run-wiki-chrome-bar-heal.js`

- [ ] **Step 1: Read the reference heal** — study `applyProjectChromeBarHeal` in `platform/install.js` (definition + where it's invoked in the install sequence + its `.sauce-backup` + per-note-sentinel + never-throw structure). The wiki heal mirrors it exactly, differing only in: the note-type filter (`type` ∈ {wiki-hub, wiki-section, wiki-page}), the legacy blocks it strips, and the block it inserts.

- [ ] **Step 2: Write the failing test** `platform/test/run-wiki-chrome-bar-heal.js`:

```js
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'platform/install.js'), 'utf8');
const applyWikiChromeBarHeal = new Function(`${src}\nreturn typeof applyWikiChromeBarHeal === 'function' ? applyWikiChromeBarHeal : null;`)();
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

// Legacy wiki-page body: Breadcrumb + SpaceNavButtons + WikiLeafActions blocks.
const legacyPage = [
  '---', 'type: wiki-page', '---', '',
  '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });', '```', '',
  '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });', '```', '',
  '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "WikiLeafActions" });', '```', '',
  'Page body here.', '',
].join('\n');

// The heal takes (body, type) and returns { body, changed } (match the real
// applyProjectChromeBarHeal signature — adjust the call below to whatever the
// reference uses; assert on the returned body).
const r1 = applyWikiChromeBarHeal(legacyPage, 'wiki-page');
ok('WCBH-1 heal inserts a WikiChromeBar block', /class:\s*"WikiChromeBar"/.test(r1.body));
ok('WCBH-2 heal removes the legacy WikiLeafActions block', !/class:\s*"WikiLeafActions"/.test(r1.body));
ok('WCBH-3 heal removes the legacy SpaceNavButtons block', !/class:\s*"SpaceNavButtons"/.test(r1.body));
ok('WCBH-4 heal preserves page content', /Page body here\./.test(r1.body));
const r2 = applyWikiChromeBarHeal(r1.body, 'wiki-page');
ok('WCBH-5 idempotent — 2nd pass makes no further change', r2.body === r1.body && r2.changed === false);

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
```

Note: match the EXACT signature/return shape of `applyProjectChromeBarHeal` (it may be `(body, type) => ({ body, changed })` or take a note object). Read the reference in Step 1 and align both the impl (Step 3) and this test's call/asserts to that shape before running.

- [ ] **Step 3: Run to verify FAIL** — `node platform/test/run-wiki-chrome-bar-heal.js` → FAIL (`applyWikiChromeBarHeal` is null).

- [ ] **Step 4: Implement** `applyWikiChromeBarHeal` in `platform/install.js`, mirroring `applyProjectChromeBarHeal`:
  - Filter: only `type` ∈ {wiki-hub, wiki-section, wiki-page}.
  - Strip the legacy chrome blocks by their invocation substrings: the `Breadcrumb`, `SpaceNavButtons`, `WikiLeafActions` dataviewjs blocks (and, if present, any standalone `WikiHubActions` block). Do NOT strip the `WikiTree` block (content).
  - Insert the `WikiChromeBar` dataviewjs block at the top of the chrome region (where Breadcrumb was).
  - Per-note sentinel: skip when the body already contains `class: "WikiChromeBar"`.
  - `.sauce-backup` snapshot before writing; never throw; return the same `{ body, changed }` shape as the reference.
  - Invoke it in the install sequence exactly where `applyProjectChromeBarHeal` is invoked (same loop over vault markdown files, gated to wiki types).

- [ ] **Step 5: Run to verify PASS** — `node platform/test/run-wiki-chrome-bar-heal.js` → PASS (WCBH-1..5).

- [ ] **Step 6: Register the heal test** — `package.json`: add `"test:wiki-chrome-bar-heal": "node platform/test/run-wiki-chrome-bar-heal.js"` + append to `release:preflight`.

- [ ] **Step 7: Commit**

```bash
git add platform/install.js platform/test/run-wiki-chrome-bar-heal.js package.json
git commit -m "feat(wiki): applyWikiChromeBarHeal migrates existing wiki notes to the ChromeBar block"
```

---

### Task 6: Docs

**Files:**
- Modify: `Docs/agent-guides/note-chrome.md` (§1d — wiki is the 2nd adopter)
- Modify: `Docs/agent-guides/wiki-blueprint.md` (chrome section → WikiChromeBar)

- [ ] **Step 1: note-chrome.md §1d** — add 2-3 sentences: wiki adopts the bar via `ChromeBar.makeAdapter(config)` (`WikiChromeBar`), the 2nd blueprint after project; the factory is how remaining blueprints adopt.

- [ ] **Step 2: wiki-blueprint.md** — replace the chrome description (Breadcrumb + nav + WikiHubActions/WikiLeafActions render the chrome) with: the bar is `WikiChromeBar` (an `makeAdapter` config); WikiHubActions/WikiLeafActions still own the *actions* (create + move dialog + section resolution) but no longer draw chrome; WikiTree is content-only.

- [ ] **Step 3: Commit**

```bash
git add Docs/agent-guides/note-chrome.md Docs/agent-guides/wiki-blueprint.md Docs/plans/2026-07-06-chrome-bar-factory-and-wiki-design.md Docs/plans/2026-07-06-chrome-bar-factory-and-wiki-plan.md
git commit -m "docs(wiki): WikiChromeBar adapter is canonical wiki chrome (via makeAdapter)"
```

---

### Task 7: Full preflight + PR

- [ ] **Step 1: Full preflight** — `npm run release:preflight` → whole-suite GREEN (exit 0), including run-chrome-bar (CB-FACTORY), run-wiki-chrome-bar, run-wiki-chrome-bar-heal, run-wiki, run-customjs-loadable, install/seed. Fix any failure in the owning task's file.

- [ ] **Step 2: Dry-run the heal on a real note (optional but recommended)** — pick a real wiki note from a consumer vault, run the heal body against its content, confirm a byte-identical 2nd pass (the docs-hub-heal discipline).

- [ ] **Step 3: Push + PR**

```bash
cd /Users/willfellhoelter/projects/repos/sauce-cb-wiki
git push -u origin feat/chrome-bar-wiki
gh pr create --repo willfell/sauce --base main --head feat/chrome-bar-wiki \
  --title "feat(chrome-bar): makeAdapter factory + wiki adoption (2nd blueprint on the shared bar)" \
  --body "<summary: factory, wiki adopts, reuses existing helpers, heal, tests, deploy note>"
```

---

## Self-Review

**Spec coverage:** factory (`makeAdapter`+`openNavTarget`)→T1; WikiChromeBar config→T2; WikiTree de-dupe→T3; templates→T4; heal→T5; docs→T6; preflight+PR→T7; deploy→runbook. ✓
**Placeholder scan:** SVG "PASTE VERBATIM FROM <file>" = concrete source refs; heal Step "mirror applyProjectChromeBarHeal" names the exact reference + the exact deltas (type filter, blocks, sentinel). No open TBDs.
**Type consistency:** config shape `{detect,surfaceSpec,dispatch,destinations,rootClass,btnClass}` identical in T1 (factory consumer), T1 tests, T2 (`_config`), T2 tests. `makeAdapter`/`openNavTarget` identical T1↔T2. Heal `{body,changed}` shape flagged to align with the reference in T5.

---

## Post-merge deploy runbook (after the feature PR merges + auto-release ships)

1. Wait for auto-release: the bumper opens/auto-merges the release PR, tags a new `v0.x`, ships the tap. Don't merge release/tap PRs by hand.
2. `brew update && brew upgrade sauce`; confirm the new version in `brew info sauce`.
3. Per consumer vault (accuris/ero/headspace) — **no new mechanism this cycle** (chrome-bar already subscribed), so a plain pin-bump carries it: verify the vault subscribes `wiki` (`grep wiki <vault>/ranch/platform-subscription.json`); if yes, `bash -c 'cd <vault> && sauce update --bump-pins'` (bumps chrome-bar→new + wiki→new + reinstalls; the heal runs). If a vault doesn't subscribe wiki, skip it there.
4. Verify per vault: `ranch/scripts/wiki/wiki-chrome-bar.js` present; open a wiki note → the single bar renders (Go ▾ / New Page / ⋯); existing wiki notes migrated (no double buttons). User Cmd+R each Obsidian.
