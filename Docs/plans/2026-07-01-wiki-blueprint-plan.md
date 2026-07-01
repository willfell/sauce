# Wiki Blueprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Work happens in the worktree `/Users/willfellhoelter/projects/repos/sauce/.worktrees/wiki` on branch `cycle/wiki-blueprint`. Run all commands from the worktree root. **Never** hand-bump versions/tags/pins (the release bumper owns those). **Never** add a `Co-Authored-By: Claude` commit trailer in this repo. Stage explicit files (no `git add -A`).

**Goal:** Ship a standalone, project-independent, arbitrary-depth `wiki` blueprint (`spice/wiki/`) with a global nav button, a hub, nested sections, pages, search, and move — reusing platform chrome and graduating `DocSearch` to a shared mechanism.

**Architecture:** Hybrid "C" — graduate `DocSearch` verbatim to a `doc-search` mechanism (both `project` + `wiki` consume it); build a fresh recursive/path-based `WikiTree` in the wiki blueprint; add an additive `path_walk` mode to the `breadcrumb` mechanism for arbitrary-depth trails; `WikiMove` stays wiki-local. Folder-is-truth: the folder path is the hierarchy; frontmatter carries identity only.

**Tech Stack:** Node (zero-dep test harnesses), Obsidian CustomJS classes (bare-class files), Dataview/dataviewjs render blocks via `customjs-guard`, JSON platform manifests.

**Precedent (read before touching each area):**
- Mechanism graduation: `git show` of the `section-label` (v0.122.0) + `breadcrumb` (v0.123.0) cycles; `platform/mechanisms/{section-label,breadcrumb}/manifest.json`.
- Blueprint manifest: `platform/blueprints/scratch/manifest.json` (full precedent).
- Docs entity-create + breadcrumb blocks: `platform/blueprints/project/manifest.json`.
- Search helper being graduated: `platform/blueprints/project/helpers/doc-search.js`.
- Harness template: `platform/test/run-section-label.js`; extend target `platform/test/run-breadcrumb.js`.
- Lint gates: `scripts/lint-note-chrome.js`, `scripts/lint-cold-load.js`.
- Design doc: `Docs/plans/2026-07-01-wiki-blueprint-design.md`.

---

## Stage A — Graduate `DocSearch` to the `doc-search` mechanism

### Task A1: Create the `doc-search` mechanism (relocate verbatim)

**Files:**
- Create dir: `platform/mechanisms/doc-search/`
- Create: `platform/mechanisms/doc-search/manifest.json`
- Create: `platform/mechanisms/doc-search/doc-search.js` (verbatim copy of `platform/blueprints/project/helpers/doc-search.js`)
- Modify: `platform/manifest.json` (add mechanism catalogue entry)

- [ ] **Step 1:** `git mv platform/blueprints/project/helpers/doc-search.js platform/mechanisms/doc-search/doc-search.js` (creates the dir; preserves history; the file is a bare `class DocSearch { … }` with no trailing statements — do NOT edit its body).
- [ ] **Step 2:** Create `platform/mechanisms/doc-search/manifest.json` (mirror the `breadcrumb` mechanism manifest shape exactly):

```json
{
  "name": "doc-search",
  "version": "0.1.0",
  "description": "Shared doc-search primitive. customJS.DocSearch.render(dv, opts) renders a permanent filter strip (text input + dynamic tag chips + scoped Obsidian-search button, 150ms debounce, localStorage-persisted keyed by scopePath) + a separate resultsContainer consumers render into; customJS.DocSearch.matches(page, ctx) is the pure text+tag AND-logic predicate. Entity-agnostic via opts.entityType (default \"doc-note\"). Promoted verbatim from the project blueprint helper at this release so non-project blueprints (wiki) can consume it. Class name unchanged (DocSearch) — existing ProjectDocsIndex / SectionHub / ProjectsHubCards callers keep working.",
  "depends_on": [
    { "name": "customjs-guard", "range": ">=1.0.0" }
  ],
  "customjs_classes": ["DocSearch"],
  "files": [
    { "source": "doc-search.js", "dest": "{{scripts_path}}/doc-search/doc-search.js" }
  ],
  "post_install": [],
  "rule_fragments": []
}
```

- [ ] **Step 3:** Add the catalogue entry to `platform/manifest.json` `mechanisms[]` (place adjacent to `section-label`/`breadcrumb`, keep array formatting consistent):

```json
{ "name": "doc-search", "version": "0.1.0", "path": "mechanisms/doc-search" }
```

- [ ] **Step 4:** Verify the class still loads as a bare class and the loader discovers it at the new path:

Run: `node platform/test/run-customjs-loadable.js`
Expected: PASS (class count unchanged or +0; no failure referencing doc-search).

- [ ] **Step 5:** Commit.

```bash
git add platform/mechanisms/doc-search/manifest.json platform/mechanisms/doc-search/doc-search.js platform/manifest.json
git commit -m "feat(doc-search): promote DocSearch to a shared mechanism (relocation)"
```

### Task A2: Repoint the `project` blueprint at the mechanism

**Files:**
- Modify: `platform/blueprints/project/manifest.json` (remove the `helpers/doc-search.js` `files[]` entry; remove `"DocSearch"` from `customjs_classes[]`; add a `depends_on` entry `{ "name": "doc-search", "range": ">=0.1.0" }`).

- [ ] **Step 1:** In `platform/blueprints/project/manifest.json`, delete the files entry:
```json
{ "source": "helpers/doc-search.js", "dest": "{{scripts_path}}/project/doc-search.js" }
```
- [ ] **Step 2:** Remove `"DocSearch"` from the `customjs_classes[]` array.
- [ ] **Step 3:** Add to `depends_on[]` (alongside the existing `section-label`/`breadcrumb` entries):
```json
{ "name": "doc-search", "range": ">=0.1.0" }
```
- [ ] **Step 4:** Confirm no other project helper hard-references a project-local doc-search path (callers use `customJS.DocSearch.*`, which resolves via the singleton — grep to be sure):

Run: `grep -rn "doc-search.js\|helpers/doc-search" platform/blueprints/project`
Expected: no matches (the `files[]` entry was the only reference).

- [ ] **Step 5:** Commit.

```bash
git add platform/blueprints/project/manifest.json
git commit -m "refactor(project): depend on doc-search mechanism (drop project-local copy)"
```

### Task A3: Add `doc-search` to the fresh-vault default mechanism subscription

**Files:**
- Modify: `platform/bootstrap-lib/wizard.js` (`DEFAULT_MECHANISMS_CHECKED`)

- [ ] **Step 1:** In `DEFAULT_MECHANISMS_CHECKED`, add `"doc-search"` immediately after the `"breadcrumb"` entry, with a comment matching the established style:

```javascript
    "doc-search",    // <this release> — project blueprint (in the default
                     // blueprint set) depends on doc-search since this release
                     // (DocSearch graduated to a mechanism); pre-include so
                     // fresh-vault bootstrap doesn't skip project with
                     // "depends on doc-search ... not subscribed". Same class
                     // of bug as the breadcrumb entry above.
```

- [ ] **Step 2:** Verify bootstrap harness still passes (it builds a fresh vault from the defaults):

Run: `node platform/test/run-bootstrap.js`
Expected: PASS.

- [ ] **Step 3:** Commit.

```bash
git add platform/bootstrap-lib/wizard.js
git commit -m "fix(wizard): include doc-search in fresh-vault default subscription"
```

### Task A4: Re-owner the schema index entry

**Files:**
- Modify: `platform/schemas-index.json`

- [ ] **Step 1:** Add a new entry for the doc-search mechanism (helper-read-contract), and update the `project-rule-fragments` entry's `consumers[]` if it references the old doc-search path. Add:

```json
{
  "id": "doc-search-mechanism",
  "kind": "helper-read-contract",
  "owner": { "type": "mechanism", "name": "doc-search" },
  "source": "platform/mechanisms/doc-search/doc-search.js",
  "consumers": [
    "platform/blueprints/project/helpers/project-docs-index.js",
    "platform/blueprints/project/helpers/section-hub.js",
    "platform/blueprints/project/helpers/projects-hub-cards.js",
    "platform/blueprints/wiki/helpers/wiki-tree.js"
  ],
  "notes": "DocSearch.render(dv, opts) → filterContext { text, tags:Set, hasActiveFilter, resultsContainer }; DocSearch.matches(page, ctx) pure predicate. opts: scopePath, recursive, entityType (default doc-note), onChange, hideTags, persist, placeholder, tagExclude. Graduated verbatim from the project blueprint helper at this release."
}
```

- [ ] **Step 2:** Validate the schema index:

Run: `npm run lint-schemas`
Expected: exit 0 (no hard failure; the `wiki-tree.js` consumer path may soft-warn until Stage D creates it — acceptable now, resolved after Stage D).

- [ ] **Step 3:** Commit.

```bash
git add platform/schemas-index.json
git commit -m "feat(schemas): index doc-search mechanism read-contract"
```

### Task A5: Behavioral harness for the graduated mechanism

**Files:**
- Create: `platform/test/run-doc-search.js`
- Modify: `package.json` (`release:preflight` chain — append `&& node platform/test/run-doc-search.js`)

- [ ] **Step 1: Write the harness.** Base it on the `run-section-label.js` zero-dep skeleton (stub `createEl`, load the class via `new Function(SRC + "\nreturn DocSearch;")()`, `ok(name, cond)` asserts, verdict footer). Assert:
  - `DS1` the mechanism file exists at `platform/mechanisms/doc-search/doc-search.js` and the legacy `platform/blueprints/project/helpers/doc-search.js` is gone (single source of truth).
  - `DS2` `matches()` returns true when `ctx.hasActiveFilter` is false (fast-path).
  - `DS3` `matches()` text filter: `{text:"vpc",hasActiveFilter:true,tags:new Set()}` matches a page with `file.name:"VPC Runbook"`, rejects `file.name:"Budget"`.
  - `DS4` `matches()` tag AND-logic: `{tags:new Set(["aws","networking"]),hasActiveFilter:true,text:""}` matches a page tagged `["aws","networking","x"]`, rejects one tagged `["aws"]` only.
  - `DS5` `_countTags()` excludes the entityType tag: pages tagged `["doc-note","aws"]` → counts `{aws:1}`, no `doc-note` key.
  - `DS6` `render()` builds a permanent strip + a separate `resultsContainer` (call `render` with a stubbed `dv` whose `container.createEl` records children; assert the returned ctx has a `resultsContainer` distinct from the strip, and `ctx.text===""`, `ctx.hasActiveFilter===false`). Stub `dv.pages` to return an object with `.where(fn)` → array; stub `localStorage`, `app`, `document` minimally.

Concrete DOM stub (extend the section-label stub with the fields DocSearch touches — `createEl(tag,{cls,attr,text})`, `.style.cssText`, `.addEventListener` no-op, `.innerHTML`, `.title`, `.value`, `.textContent`, `.children`, `.empty()`, `.remove()`, `.dispatchEvent`):

```javascript
function makeEl(tag) {
  const el = {
    tag, textContent: '', innerHTML: '', title: '', value: '',
    style: { cssText: '', background: '', color: '' }, children: [], attrs: {},
  };
  el.createEl = (t, o) => { const c = makeEl(t); if (o && o.text) c.textContent = o.text; el.children.push(c); return c; };
  el.addEventListener = () => {};
  el.dispatchEvent = () => {};
  el.remove = () => {};
  el.empty = () => { el.children.length = 0; };
  el.querySelector = () => null;
  return el;
}
global.localStorage = { _d:{}, getItem(k){return this._d[k]||null;}, setItem(k,v){this._d[k]=v;} };
global.app = { commands: { executeCommandById(){} } };
global.document = { querySelector: () => null };
global.Event = class { constructor(t){ this.type=t; } };
global.window = {};
function makeDv(pages) {
  const container = makeEl('div');
  return { container, pages: () => ({ where: () => pages }), current: () => ({}) };
}
```

- [ ] **Step 2:** Run to verify it passes:

Run: `node platform/test/run-doc-search.js`
Expected: `6/6 passed`, exit 0.

- [ ] **Step 3:** Wire into `package.json` `release:preflight` (append at the end of the chain, before the closing quote): `&& node platform/test/run-doc-search.js`. Also add a `test:doc-search` script line: `"test:doc-search": "node platform/test/run-doc-search.js",`.

- [ ] **Step 4:** Commit.

```bash
git add platform/test/run-doc-search.js package.json
git commit -m "test(doc-search): behavioral harness for graduated mechanism"
```

---

## Stage B — `breadcrumb` path-walk mode (additive)

### Task B1: Add `path_walk` mode to the breadcrumb mechanism

**Files:**
- Modify: `platform/mechanisms/breadcrumb/breadcrumb.js`

**Contract:** A registry type entry may carry `"path_walk": { "root_label": "<str>", "root_dir": "<vault-relative dir>", "root_file": "<basename>.md" }` INSTEAD of `ancestors[]`. When present, `Breadcrumb.render` builds the trail from the current file's path:
- crumb 0: `root_label` linked to `<root_dir>/<root_file>`.
- one crumb per folder segment strictly between `root_dir` and the file's own folder; each segment `<seg>` links to `<accumulated_path>/<SegBasename>.md` where `<SegBasename>` is the folder's display name (the section-hub is named `<folder-title>.md`; use the segment text as basename since folders are created titled). Skip the segment that equals the current file's own basename-folder when the current note IS the section hub (avoid self-crumb).
- final crumb: the current page — `fm:title|file:basename`, not linked.
Non-`path_walk` types are unchanged.

- [ ] **Step 1:** Read `platform/mechanisms/breadcrumb/breadcrumb.js` fully. In `render(dv)`, after resolving `entry` from the registry, branch: `if (entry.path_walk) return this._renderPathWalk(dv, entry.path_walk);` before the existing `ancestors` loop.
- [ ] **Step 2:** Implement `_renderPathWalk(dv, pw)` reusing the existing `_link(label, link)` / `_currentLabel(label)` / segment-join rendering already in the class (match how the existing render emits `segments` + separators — read that block and mirror it exactly so the DOM output is identical to normal breadcrumbs). Compute segments from `dv.current()?.file?.path`. Guard: if `cur?.file?.path` is missing, return (render nothing). Derive the file's folder via `path.slice(0, path.lastIndexOf('/'))`; strip the leading `root_dir + '/'`; split remaining on `/` for the intermediate section segments; the current note's own crumb label is `dv.current().title || <basename without .md>`.
- [ ] **Step 3:** Confirm no bare `dv.current().` deref (use `const cur = dv.current(); if (!cur || !cur.file) return;` as the existing code does).

Run: `node scripts/lint-cold-load.js`
Expected: PASS (no new violations).

- [ ] **Step 4:** Commit (test added next task, but commit the mechanism change with its test together in B2 — skip commit here, proceed to B2).

### Task B2: Extend `run-breadcrumb.js` with path-walk asserts

**Files:**
- Modify: `platform/test/run-breadcrumb.js`

- [ ] **Step 1:** Read the existing harness's registry stub + `makeDv` + render-invocation pattern. Add a `wiki` contribution to the registry stub with three types:
```javascript
wiki: { types: {
  "wiki-hub":     { path_walk: { root_label: "Wiki", root_dir: "spice/wiki", root_file: "Wiki.md" } },
  "wiki-section": { path_walk: { root_label: "Wiki", root_dir: "spice/wiki", root_file: "Wiki.md" } },
  "wiki-page":    { path_walk: { root_label: "Wiki", root_dir: "spice/wiki", root_file: "Wiki.md" } },
} }
```
- [ ] **Step 2:** Add asserts (mirror the existing invocation style — build a `dv` whose `current()` returns `{ type, title, file: { path, name } }`, call `await inst.render(dv)`, inspect the recorded segment labels/links):
  - `BC-WIKI-1` page at `spice/wiki/infra/aws/VPC Peering.md` (`type:"wiki-page"`, `title:"VPC Peering"`) → crumbs: `Wiki` (link `spice/wiki/Wiki.md`), `infra` (link `spice/wiki/infra/Infra.md` OR `spice/wiki/infra/infra.md` per the basename rule you implemented — assert the folder title segment is present + linked), `aws` (linked), current `VPC Peering` (not linked).
  - `BC-WIKI-2` section hub at `spice/wiki/infra/Infra.md` (`type:"wiki-section"`, `title:"Infra"`) → crumbs: `Wiki` (linked), current `Infra` (not linked); NO self-crumb for `infra`.
  - `BC-WIKI-3` root hub at `spice/wiki/Wiki.md` (`type:"wiki-hub"`) → single crumb `Wiki` (current, not linked, since it IS the root).
  - `BC-WIKI-4` existing fixed-arity project types still pass (leave the existing project asserts intact and green).
- [ ] **Step 2b:** If BC-WIKI-1/2/3 reveal an edge-case bug in `_renderPathWalk` (self-crumb, root-is-current, trailing slash), fix `breadcrumb.js` until green.

Run: `node platform/test/run-breadcrumb.js`
Expected: all asserts pass incl. the 4 new BC-WIKI-* and all pre-existing.

- [ ] **Step 3:** Commit.

```bash
git add platform/mechanisms/breadcrumb/breadcrumb.js platform/test/run-breadcrumb.js
git commit -m "feat(breadcrumb): additive path_walk mode for arbitrary-depth trails"
```

---

## Stage C — Wiki blueprint: manifest, templates, registration

### Task C1: Discover the entity-create folder-relative-create mechanism

**Files:** read-only — `platform/mechanisms/entity-create/entity-create.js`

- [ ] **Step 1:** Read `entity-create.js`. Determine (a) the available substitution tokens, specifically whether a current-file **folder/dir/path** token exists (beyond `{{current_file.frontmatter.*}}`), and (b) whether `create({instance, dv, ...})` accepts a destination or prompt-preset override.
- [ ] **Step 2:** Choose the folder-relative create mechanism and record it in a one-line comment at the top of the wiki manifest task (C2):
  - **Preferred:** if a `{{current_file.folder}}`-style token exists → destination `folder_prefix` = that token (+ `/{{prompts.slug}}` for sections). Purest folder-is-truth.
  - **Fallback (robust, known-good):** carry a `dir` field in hub + section frontmatter holding the note's own folder path; child create uses `folder_prefix: "{{current_file.frontmatter.dir}}"` (pages) and `"{{current_file.frontmatter.dir}}/{{prompts.slug}}"` (sections), with the new section's own `dir` set to `"{{current_file.frontmatter.dir}}/{{prompts.slug}}"`. Renderer + move IGNORE `dir` (folder is still truth); `dir` is a create-routing convenience only.
- [ ] No commit (discovery only). Carry the decision into C2.

### Task C2: Author the wiki manifest

**Files:**
- Create dir: `platform/blueprints/wiki/`
- Create: `platform/blueprints/wiki/manifest.json`

- [ ] **Step 1:** Author `manifest.json` by diffing against `scratch/manifest.json` + the project docs blocks. Use the C1 decision for `destination.folder_prefix`. Full manifest (fallback `dir`-token variant shown; swap to the folder token if C1 found one):

```json
{
  "name": "wiki",
  "version": "0.1.0",
  "kind": "blueprint",
  "module_directory": "wiki",
  "skills_dir": ".claude/skills/wiki",
  "description": "Standalone, project-independent, arbitrary-depth knowledge base. spice/wiki/ root hub (wiki-hub) → section hubs (wiki-section) nested to any depth → wiki-page leaves. Folder-is-truth: the folder path IS the hierarchy; frontmatter carries identity only. Reuses nav-buttons, entity-create, section-label, breadcrumb (path_walk mode), cards, accent-button, render-safe, open-helpers, doc-search. WikiTree renders hub + section views recursively; WikiMove relocates pages/sections between folders; WikiLeafActions renders the Move action.",
  "depends_on": [
    { "name": "nav-buttons", "range": ">=2.6.1" },
    { "name": "customjs-guard", "range": ">=1.0.0" },
    { "name": "cards", "range": ">=0.2.4" },
    { "name": "accent-button", "range": ">=0.1.0" },
    { "name": "entity-create", "range": ">=0.4.0" },
    { "name": "section-label", "range": ">=0.1.0" },
    { "name": "breadcrumb", "range": ">=0.1.0" },
    { "name": "doc-search", "range": ">=0.1.0" },
    { "name": "render-safe", "range": ">=0.1.0" },
    { "name": "open-helpers", "range": ">=0.1.0" },
    { "name": "platform-claude", "range": ">=0.1.1" }
  ],
  "breadcrumb": {
    "types": {
      "wiki-hub":     { "path_walk": { "root_label": "Wiki", "root_dir": "spice/wiki", "root_file": "Wiki.md" }, "current": { "label": "lit:Wiki" } },
      "wiki-section": { "path_walk": { "root_label": "Wiki", "root_dir": "spice/wiki", "root_file": "Wiki.md" }, "current": { "label": "fm:title|file:basename" } },
      "wiki-page":    { "path_walk": { "root_label": "Wiki", "root_dir": "spice/wiki", "root_file": "Wiki.md" }, "current": { "label": "fm:title|file:basename" } }
    }
  },
  "customjs_classes": ["WikiTree", "WikiMove", "WikiLeafActions"],
  "files": [
    { "source": "templates/Wiki.md", "dest": "{{templates_path}}/Wiki.md" },
    { "source": "templates/Section Hub.md", "dest": "{{templates_path}}/Wiki Section Hub.md" },
    { "source": "templates/Wiki Page.md", "dest": "{{templates_path}}/Wiki Page.md" },
    { "source": "content/Wiki Hub.md", "dest": "{{module_directory}}/Wiki.md" },
    { "source": "helpers/wiki-tree.js", "dest": "{{scripts_path}}/wiki/wiki-tree.js" },
    { "source": "helpers/wiki-move.js", "dest": "{{scripts_path}}/wiki/wiki-move.js" },
    { "source": "helpers/wiki-leaf-actions.js", "dest": "{{scripts_path}}/wiki/wiki-leaf-actions.js" }
  ],
  "claude_surface": [
    { "kind": "command", "source": "commands/wiki.md", "dest": ".claude/commands/wiki.md" },
    { "kind": "skill", "source": "skills/new-wiki-page/SKILL.md", "dest": "{{skills_dir}}/new-wiki-page/SKILL.md" },
    { "kind": "claude_md_row", "table": "resolvers", "row": { "topic": "Wiki", "path": "{{module_directory}}", "command": "/wiki" } }
  ],
  "nav_buttons": [
    {
      "id": "wiki-hub",
      "label": "Wiki",
      "icon": "book-open",
      "order": 135,
      "action": { "type": "openLink", "target": "{{module_directory}}/Wiki.md" }
    }
  ],
  "new_entity_buttons": [
    {
      "id": "wiki-section",
      "label": "+ New Section",
      "icon": "folder-plus",
      "prompts": [
        { "key": "name", "label": "Section name", "type": "string", "required": true, "validate": "safe-filename" },
        { "key": "slug", "label": "(derived from name)", "type": "string", "derive": "slugify(prompts.name)" }
      ],
      "destination": {
        "folder_prefix": "{{current_file.frontmatter.dir}}/{{prompts.slug}}",
        "filename_prefix": "{{prompts.name|sanitize-filename}}"
      },
      "frontmatter_template": {
        "type": "wiki-section",
        "title": "{{prompts.name}}",
        "dir": "{{current_file.frontmatter.dir}}/{{prompts.slug}}",
        "created_at": "{{now.YYYY-MM-DDTHH:mm:ssZ}}",
        "tags": ["wiki-section"]
      },
      "body_template": "Wiki Section Hub.md"
    },
    {
      "id": "wiki-page",
      "label": "+ New Page",
      "icon": "file-plus",
      "prompts": [
        { "key": "title", "label": "Page title", "type": "string", "required": true, "validate": "safe-filename" }
      ],
      "destination": {
        "folder_prefix": "{{current_file.frontmatter.dir}}",
        "filename_prefix": "{{prompts.title|sanitize-filename}}"
      },
      "frontmatter_template": {
        "type": "wiki-page",
        "title": "{{prompts.title}}",
        "created_at": "{{now.YYYY-MM-DDTHH:mm:ssZ}}",
        "tags": ["wiki-page"]
      },
      "body_template": "Wiki Page.md"
    }
  ],
  "rule_fragments": [
    {
      "target": "wiki-hub",
      "fragment": {
        "scope": { "path_glob": "spice/wiki/Wiki.md" },
        "extends": "_canonical-vocab",
        "required_frontmatter": { "type": { "required": true, "equals": "wiki-hub" } }
      }
    },
    {
      "target": "wiki-section",
      "fragment": {
        "scope": { "path_glob": "spice/wiki/**/*.md" },
        "extends": "_canonical-vocab",
        "required_frontmatter": { "type": { "required": true, "type": "string" } }
      }
    }
  ]
}
```

Notes for the implementer: `open-helpers`/`platform-claude` ranges must match the current catalogue — read `platform/manifest.json` and set each `range` to `>=<current-version>` for every dep (do not invent versions). `icon` values (`book-open`, `folder-plus`, `file-plus`, `pencil-plus`) must exist in the `icons` mechanism registry — grep `platform/mechanisms/icons/` and pick registered names; if `book-open` is absent, use a registered alternative (e.g. `book`, `library`) and note it.

- [ ] **Step 2:** Validate the manifest parses + version-sync unaffected:

Run: `node -e "JSON.parse(require('fs').readFileSync('platform/blueprints/wiki/manifest.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3:** Commit.

```bash
git add platform/blueprints/wiki/manifest.json
git commit -m "feat(wiki): blueprint manifest (types, nav button, create dialogs, breadcrumb)"
```

### Task C3: Author the templates + root hub content note

**Files:**
- Create: `platform/blueprints/wiki/templates/Wiki.md`
- Create: `platform/blueprints/wiki/templates/Section Hub.md`
- Create: `platform/blueprints/wiki/templates/Wiki Page.md`
- Create: `platform/blueprints/wiki/content/Wiki Hub.md`

All templates: `Breadcrumb` view FIRST, then `SpaceNavButtons`, no `## H2`, no `---` between breadcrumb and nav. Entity-create via explicit `EntityCreate` dataviewjs blocks (mirror project's Docs Hub `entity-create:doc-note` block). Use `{{views_path}}/customjs-guard` (template-variable form, per scratch).

- [ ] **Step 1:** `content/Wiki Hub.md` (installed to `spice/wiki/Wiki.md`; declare `materialize_once` semantics by NOT overwriting — the installer treats content-file dests as create-if-absent; confirm by reading how scratch's `content/Scratch Hub.md` → `{{module_directory}}/Scratch.md` behaves and match it):

```markdown
---
type: wiki-hub
title: Wiki
dir: spice/wiki
created_at: "{{now.YYYY-MM-DDTHH:mm:ssZ}}"
tags:
  - wiki-hub
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "Breadcrumb" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
// entity-create:wiki-section — installer-managed; do not delete this comment
await dv.view("{{views_path}}/customjs-guard", { class: "EntityCreate", args: [{ instance: "wiki-section" }] });
```

```dataviewjs
// entity-create:wiki-page — installer-managed; do not delete this comment
await dv.view("{{views_path}}/customjs-guard", { class: "EntityCreate", args: [{ instance: "wiki-page" }] });
```

---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "WikiTree" });
```
```

- [ ] **Step 2:** `templates/Wiki.md` — identical body to `content/Wiki Hub.md` but with Templater tokens for a hub re-created via nav (frontmatter `created_at` uses `<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>`). Since the nav button uses `openLink` (not template creation), this template exists mainly for parity/regeneration; keep it identical in body to the content note. (Confirm whether the blueprint needs the `templates/Wiki.md` at all given `openLink`; if the installer requires a template for the `templater_folder_templates` or nav action, keep it — otherwise it is harmless.)

- [ ] **Step 3:** `templates/Section Hub.md` (installed as `Wiki Section Hub.md`; `body_template` for the `wiki-section` create button — entity-create prepends frontmatter, so this file is the BODY only, no frontmatter block; mirror project's `Section Hub.md` which is body-only):

```markdown
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "Breadcrumb" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
// entity-create:wiki-section — installer-managed; do not delete this comment
await dv.view("{{views_path}}/customjs-guard", { class: "EntityCreate", args: [{ instance: "wiki-section" }] });
```

```dataviewjs
// entity-create:wiki-page — installer-managed; do not delete this comment
await dv.view("{{views_path}}/customjs-guard", { class: "EntityCreate", args: [{ instance: "wiki-page" }] });
```

---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "WikiTree" });
```
```

- [ ] **Step 4:** `templates/Wiki Page.md` (body_template for the `wiki-page` create button; body-only):

```markdown
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "Breadcrumb" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "WikiLeafActions" });
```

---

```

- [ ] **Step 5:** Verify note-chrome + cold-load lints on the new templates:

Run: `node scripts/lint-note-chrome.js && node scripts/lint-cold-load.js`
Expected: PASS (Breadcrumb-first present; no `## H2`; no bare derefs).

- [ ] **Step 6:** Commit.

```bash
git add platform/blueprints/wiki/templates platform/blueprints/wiki/content
git commit -m "feat(wiki): hub / section / page templates (note-chrome conformant)"
```

### Task C4: Register `wiki` in the catalogue + workshop + seed subscriptions

**Files:**
- Modify: `platform/manifest.json` (`blueprints[]`)
- Modify: `ranch/platform-subscription.json` (workshop dogfood — add `wiki` + ensure `doc-search`)
- Modify: `platform/test/seed-vault/ranch/platform-subscription.json` (add `wiki` + `doc-search`)

- [ ] **Step 1:** Add to `platform/manifest.json` `blueprints[]`:
```json
{ "name": "wiki", "version": "0.1.0", "path": "blueprints/wiki" }
```
- [ ] **Step 2:** In `ranch/platform-subscription.json`, add subscription entries for `wiki` and `doc-search` (match the existing entry shape in that file — read it first; pin form mirrors siblings, e.g. `latest` or a version object). Ensure `doc-search` is present (project now depends on it).
- [ ] **Step 3:** Same additions in `platform/test/seed-vault/ranch/platform-subscription.json` (the seed subscribes to all — add `wiki` + `doc-search`).
- [ ] **Step 4:** Workshop dogfood must still install cleanly:

Run: `node platform/install.js --vault . --auto-approve`
Expected: exit 0; `spice/wiki/Wiki.md` materialized at the worktree root with `type: wiki-hub`; console shows no "skipping wiki — depends on … not subscribed".

- [ ] **Step 5:** Confirm the dogfood materialized the hub:

Run: `node -e "const s=require('fs').readFileSync('spice/wiki/Wiki.md','utf8'); if(!/type:\s*wiki-hub/.test(s)) throw new Error('no wiki-hub fm'); console.log('wiki hub ok')"`
Expected: `wiki hub ok`.

- [ ] **Step 6:** Commit (isolate the dogfood runtime-artifact churn — stage ONLY the intended files + the legitimately-changed registries if the dogfood updated them; do not `git add -A`).

```bash
git add platform/manifest.json ranch/platform-subscription.json platform/test/seed-vault/ranch/platform-subscription.json
# stage the dogfood-materialized wiki hub + any registry deltas that reflect the new blueprint:
git add spice/wiki ranch/nav-buttons-registry.json ranch/entity-create-registry.json ranch/breadcrumb-registry.json ranch/claude-surface-registry.json
git commit -m "feat(wiki): register blueprint + workshop/seed subscriptions (dogfood)"
```

---

## Stage D — Wiki helpers (the render + move logic)

> All three are bare `class` files (first token `class`) with no trailing statements. Guard `dv.current()` as `const cur = dv.current(); if (!cur || !cur.file) return;`. No bare `customJS.X.Y(` inside — call other helpers via `customJS.<Class>.<method>(...)` from JS is fine (lint-cold-load R2 only flags inside dataviewjs `.md` fences, not `.js` files) but still prefer defensive access. Reuse the `_makeProxyDv` shim (copy from `platform/blueprints/project/helpers/section-hub.js`).

### Task D1: `WikiTree` (hub + section render)

**Files:**
- Create: `platform/blueprints/wiki/helpers/wiki-tree.js`

**Contract:** `render(dv)` dispatches on `dv.current()?.type`:
- Instantiate `DocSearch` strip: `const ctx = customJS.DocSearch.render(dv, { scopePath: <current folder>, recursive: true, entityType: "wiki-page", onChange: (c)=>{ c.resultsContainer.empty(); this._renderResults(dv, c); } });` then first-paint `this._renderResults(dv, ctx)`. `scopePath` = current file's folder (`cur.file.path` minus basename). For `wiki-hub` this is `spice/wiki`.
- `_renderResults(dv, ctx)` renders into `ctx.resultsContainer` via `_makeProxyDv`:
  - **Immediate sub-sections:** enumerate `dv.pages('"'+scopePath+'"').where(p => p.type === "wiki-section")` whose file folder is an IMMEDIATE child of scopePath (folder depth == scopePath depth + 1). Render as cards (reuse `customJS.BeaconCards`/`cards` — match how `section-hub.js` renders section cards). Meta: `${pageCount} page${s} · updated ${moment(maxMtime).fromNow()}`. Precede with `SectionLabel` text "Sections" (only if any).
  - **Immediate pages:** `dv.pages(...).where(p => p.type === "wiki-page")` whose folder === scopePath, filtered by `customJS.DocSearch.matches(p, ctx)`, sorted `file.mtime` desc. Render as a list/cards. Precede with `SectionLabel` "Pages" (only if sub-sections also present).
  - **Hub-only extras (when `cur.type === "wiki-hub"`):** a "Recently updated" roll-up — top N (e.g. 8) `wiki-page` across ALL of `spice/wiki` by `file.mtime` desc — under `SectionLabel` "Recently updated".
  - Empty output renders nothing.
- Provide static-ish testable helpers so the harness can exercise logic headlessly WITHOUT a full Dataview: `_immediateChildFolders(scopePath, pages)` → array of `{folder, title, pageCount, maxMtime}`; `_immediatePages(scopePath, pages)` → filtered/sorted array; `_recentPages(pages, n)`. Keep DOM rendering thin around these pure helpers.

- [ ] **Step 1:** Read `platform/blueprints/project/helpers/section-hub.js` + `project-docs-index.js` for the proxyDv + DocSearch + card-render patterns; write `wiki-tree.js` mirroring them but folder-based (not frontmatter-section-based).
- [ ] **Step 2:** Lint:

Run: `node scripts/lint-cold-load.js && node platform/test/run-customjs-loadable.js`
Expected: PASS; WikiTree discovered + loadable.

- [ ] **Step 3:** Commit.

```bash
git add platform/blueprints/wiki/helpers/wiki-tree.js
git commit -m "feat(wiki): WikiTree recursive hub + section renderer"
```

### Task D2: `WikiMove`

**Files:**
- Create: `platform/blueprints/wiki/helpers/wiki-move.js`

**Contract:** pure-ish move logic + a dialog trigger.
- `sectionTargets(pages)` → ordered list of `{ folder, label }` for every `wiki-section` in `spice/wiki` + the root `{ folder: "spice/wiki", label: "Wiki (root)" }`. Label is the section `title` (or folder basename). Sorted by folder path.
- `targetPath(targetFolder, currentPath)` → `targetFolder + "/" + <basename of currentPath>`.
- `isNoop(targetFolder, currentPath)` → true when `targetFolder` === current file's folder.
- `async move(dv, targetFolder)` → resolve the active file; if `isNoop` return; else `await app.fileManager.renameFile(file, targetPath(...))` so inbound links auto-update. No frontmatter rewrite (folder-is-truth). Wrap in try/catch; log failures loudly.

- [ ] **Step 1:** Read `platform/blueprints/project/helpers/doc-move.js` for shape; write `wiki-move.js` simplified to folder-based targets.
- [ ] **Step 2:** Lint + loadable:

Run: `node scripts/lint-cold-load.js && node platform/test/run-customjs-loadable.js`
Expected: PASS.

- [ ] **Step 3:** Commit.

```bash
git add platform/blueprints/wiki/helpers/wiki-move.js
git commit -m "feat(wiki): WikiMove folder-based relocation"
```

### Task D3: `WikiLeafActions`

**Files:**
- Create: `platform/blueprints/wiki/helpers/wiki-leaf-actions.js`

**Contract:** `render(dv)` on a `wiki-page` (and optionally `wiki-section`): render a **Move** button via `customJS.AccentButton` (match how `scratch-leaf-actions.js` renders its buttons). On click → open a picker of `customJS.WikiMove.sectionTargets(dv.pages('"spice/wiki"').array())` → on choose → `customJS.WikiMove.move(dv, chosenFolder)`. Provide `_buildMoveOptions(pages, currentPath)` (pure — targets minus the current folder) so the harness can assert option-building headlessly.

- [ ] **Step 1:** Read `platform/blueprints/scratch/helpers/scratch-leaf-actions.js` for the button-render + dialog pattern; write `wiki-leaf-actions.js`.
- [ ] **Step 2:** Lint + loadable:

Run: `node scripts/lint-cold-load.js && node platform/test/run-customjs-loadable.js`
Expected: PASS.

- [ ] **Step 3:** Commit.

```bash
git add platform/blueprints/wiki/helpers/wiki-leaf-actions.js
git commit -m "feat(wiki): WikiLeafActions Move button"
```

### Task D4: `run-wiki.js` behavioral harness

**Files:**
- Create: `platform/test/run-wiki.js`
- Modify: `package.json` (`release:preflight` append `&& node platform/test/run-wiki.js`; add `"test:wiki"` script)

- [ ] **Step 1:** Write the harness on the `run-section-label.js` skeleton. Load all three wiki classes via `new Function(SRC + "\nreturn ClassName;")()`. Feed synthetic page arrays (each page: `{ type, title, file: { path, folder, name, mtime: { ts } }, tags }`). Assert against the PURE helpers (no full DOM needed for logic):
  - `W1` `WikiTree._immediateChildFolders("spice/wiki", pages)` with pages in `spice/wiki/a/A.md`, `spice/wiki/a/b/B.md`, `spice/wiki/c/C.md` returns exactly folders `a` + `c` (not `a/b`), with correct pageCount.
  - `W2` `WikiTree._immediatePages("spice/wiki/a", pages)` returns only pages whose folder === `spice/wiki/a` (a page directly in `a`, not one in `a/b`).
  - `W3` `WikiTree._recentPages(pages, 3)` returns the 3 highest-`mtime.ts` wiki-pages, desc.
  - `W4` `WikiMove.sectionTargets(pages)` includes the root `spice/wiki` target + every `wiki-section` folder; `targetPath("spice/wiki/x","spice/wiki/y/Page.md")` === `"spice/wiki/x/Page.md"`; `isNoop("spice/wiki/y","spice/wiki/y/Page.md")` === true.
  - `W5` `WikiLeafActions._buildMoveOptions(pages, "spice/wiki/y/Page.md")` excludes the current folder `spice/wiki/y`.
  - `W6` (structural) all three helper files start with `class` (bare-class guard) and contain no `module.exports`.
- [ ] **Step 2:** Run:

Run: `node platform/test/run-wiki.js`
Expected: `6/6 passed`, exit 0. If a pure helper is missing/misnamed, go back to D1–D3 and reconcile signatures (keep names EXACTLY: `_immediateChildFolders`, `_immediatePages`, `_recentPages`, `sectionTargets`, `targetPath`, `isNoop`, `_buildMoveOptions`).
- [ ] **Step 3:** Wire preflight + add `"test:wiki": "node platform/test/run-wiki.js",`.
- [ ] **Step 4:** Commit.

```bash
git add platform/test/run-wiki.js package.json
git commit -m "test(wiki): behavioral harness for WikiTree/WikiMove/WikiLeafActions"
```

---

## Stage E — Claude surface (`/wiki` command + skill)

### Task E1: Command + skill

**Files:**
- Create: `platform/blueprints/wiki/commands/wiki.md`
- Create: `platform/blueprints/wiki/skills/new-wiki-page/SKILL.md`

- [ ] **Step 1:** Author `commands/wiki.md` mirroring `platform/blueprints/scratch/commands/scratch.md` (read it): navigate — open `spice/wiki/Wiki.md`, create a section/page, find a page by title/tag. Keep it short + action-oriented.
- [ ] **Step 2:** Author `skills/new-wiki-page/SKILL.md` mirroring `platform/blueprints/scratch/skills/new-scratch/SKILL.md`: create a new wiki page honoring the pre-write vault-identity self-check.
- [ ] **Step 3:** Verify claude-surface harness still green:

Run: `node platform/test/run-claude-surface.js`
Expected: PASS.

- [ ] **Step 4:** Commit.

```bash
git add platform/blueprints/wiki/commands platform/blueprints/wiki/skills
git commit -m "feat(wiki): /wiki command + new-wiki-page skill"
```

---

## Stage F — Seed-vault migration coverage

### Task F1: Extend the seed + add the `SEED-MIGRATE-WIKI` family

**Files:**
- Create (seed content): `platform/test/seed-vault/spice/wiki/Wiki.md`, `.../spice/wiki/infra/Infra.md`, `.../spice/wiki/infra/aws/AWS.md`, `.../spice/wiki/infra/aws/VPC Peering.md`, `.../spice/wiki/Loose Note.md` (a page at the root). Each at the correct frontmatter schema (hub/section/page).
- Modify: `platform/test/run-seed-migrations.js` (append an `HC-V0XXX-SEED-MIGRATE-WIKI-*` family — use the closing workshop version once known; until then use a placeholder token `WIKI` and let the version prefix be filled at cycle close, matching the file's existing family-naming convention).

> Per `Docs/agent-guides/migration-regression-net.md`, hand-editing `seed-vault/` for a new blueprint's fixtures is sanctioned (landmine #26 case). The seed's `platform-subscription.json` was already given `wiki` + `doc-search` in Task C4.

- [ ] **Step 1:** Create the seed wiki tree notes (frontmatter per the schemas in the design doc §4.3; include a `dir:` field on hub + sections matching their folder). Bodies can be the materialized template bodies (Breadcrumb + nav + WikiTree). Add 1–2 `tags` on the pages so DocSearch has chips.
- [ ] **Step 2:** In `run-seed-migrations.js`, append the family (mirror an existing `HC-*-SEED-*` family's `ok(...)` style + `helpers.readNote`/`parseFrontmatter`):
  - `WIKI-1` `spice/wiki/Wiki.md` exists post-install with `type: wiki-hub`.
  - `WIKI-2` `spice/wiki/infra/Infra.md` is `type: wiki-section`.
  - `WIKI-3` `spice/wiki/infra/aws/VPC Peering.md` is `type: wiki-page`.
  - `WIKI-4` the `entity-create-registry.json` contains `wiki-section` + `wiki-page` contributions.
  - `WIKI-5` the `nav-buttons-registry.json` contains the `wiki-hub` button.
  - `WIKI-6` the `breadcrumb-registry.json` contains the `wiki` contribution with `wiki-page` type.
  - `WIKI-7` (project docs still work) `DocSearch` resolves from the mechanism: assert `platform/mechanisms/doc-search/doc-search.js` exists AND the project manifest no longer lists `helpers/doc-search.js` (single-source-of-truth post-graduation).
- [ ] **Step 3:** Run:

Run: `node platform/test/run-seed-migrations.js`
Expected: all families green incl. the new WIKI-* asserts + existing PRESERVE/IDEMP families still pass.
- [ ] **Step 4:** Commit.

```bash
git add platform/test/seed-vault/spice/wiki platform/test/run-seed-migrations.js
git commit -m "test(seed): wiki tree fixtures + SEED-MIGRATE-WIKI family"
```

---

## Stage G — Full verification (gate before PR)

### Task G1: Full preflight green

- [ ] **Step 1:** Run the whole suite:

Run: `npm run release:preflight`
Expected: every harness PASS, exit 0. Fix any red (common: an `icon` name not in the registry; a `range` mismatch; a lint-note-chrome miss on a template; a schemas-index soft-warn becoming a fail). Re-run until fully green.

### Task G2: Workshop dogfood

- [ ] **Step 1:** Re-run the dogfood on a clean tree (commit or stash any runtime artifacts first):

Run: `node platform/install.js --vault . --auto-approve && node -e "require('fs').accessSync('spice/wiki/Wiki.md'); console.log('dogfood wiki ok')"`
Expected: exit 0; `dogfood wiki ok`. Isolate any registry/hub artifact churn into a `chore(dogfood)` commit (do not mix into feature commits).

### Task G3: Bumped-state preflight (catch a release wedge pre-merge)

- [ ] **Step 1:** On a CLEAN tree (all committed), run:

Run: `npm run release:preflight-bumped`
Expected: green (it runs `compute-release --write`, full preflight on the bumped tree, then hard-restores). If it fails, a version assertion is reading a literal instead of the snapshot SSOT — fix that (do NOT hand-edit versions). Re-run until green.

- [ ] **Step 2:** Confirm the tree is clean after the restore:

Run: `git status --short`
Expected: empty.

### Task G4: Cycle-close artifacts (design + plan already committed)

**Files:**
- Create: `Docs/plans/2026-07-01-wiki-blueprint-result.md` (what shipped, surfaces hit, lessons, carry-forwards, commit list).
- Modify: `Docs/cycle-history.md` (append a `## <version> wiki blueprint CLOSED 2026-07-01` section — version filled at close).
- Create: `Docs/prompts/2026-07-01-post-wiki-next-cycle-handoff.md`.

- [ ] **Step 1:** Write the result doc + history entry + handoff (version tokens left as `<version>` until the pipeline assigns — a `docs(...)` follow-up can stamp them, or leave the pipeline's `chore(release)` to close the loop). `regen-cycle-status` runs post-merge.
- [ ] **Step 2:** Commit.

```bash
git add Docs/plans/2026-07-01-wiki-blueprint-result.md Docs/cycle-history.md Docs/prompts/2026-07-01-post-wiki-next-cycle-handoff.md
git commit -m "docs(plans): wiki blueprint result + handoff"
```

---

## Stage H — PR, CI, merge, ship, deploy (driven by the lead, not subagents)

> This stage is executed by the orchestrating session (me), not dispatched to subagents. It touches `main`, the release pipeline, and three real consumer vaults.

### Task H1: Push + open PR

- [ ] Push the branch: `git push -u origin cycle/wiki-blueprint`.
- [ ] Open the PR: `gh pr create --base main --title "feat(wiki): standalone arbitrary-depth wiki blueprint + doc-search mechanism" --body "<summary + test evidence + risk notes; reference the design + plan docs>"`.
- [ ] Watch CI (`preflight (macos-latest)` + `preflight (ubuntu-latest)`): `gh pr checks --watch`. Fix any CI-only failures (path-case, OS-specific) and push follow-ups until green.

### Task H2: Merge feature PR → let pipeline ship

- [ ] When CI is green AND a self-review of the diff looks right, merge the FEATURE PR (squash): `gh pr merge <n> --squash`. (This is the only manual ship step.)
- [ ] The release pipeline auto-bumps versions, opens + auto-merges the RELEASE PR, tags `v<X.Y.Z>`, ships to brew. Monitor: `gh pr list` + `gh run list`. **Never** admin-merge the release PR. If it gets BEHIND-wedged (green but `mergeStateStatus: BEHIND`), unstick ONLY via `gh pr update-branch <release-pr>`. If a concurrent autoloop release PR is racing, let reconcile settle; do not force.
- [ ] Confirm the tag shipped: `git fetch --tags && git tag --sort=-creatordate | head -3` shows the new `v<X.Y.Z>`; `platform/manifest.json` on `main` shows `wiki` + `doc-search` in the catalogue at their bumped versions.

### Task H3: Deploy to the three consumer vaults (ero → headspace → accuris)

> Consumers resolve `workshop_relative_path` to THIS local clone. Pull the shipped `main` into the main workshop checkout first: `cd /Users/willfellhoelter/projects/repos/sauce && git checkout main && git pull`.

For EACH vault in order `ero-sauce`, `headspace-sauce`, `accuris-sauce` at `/Users/willfellhoelter/notes/sauce/<vault>`:
- [ ] **Add the new subscriptions** (a new blueprint is NOT added by `--bump-pins` alone — the transitive-add trap): edit `<vault>/ranch/platform-subscription.json` to add a `wiki` blueprint subscription entry AND a `doc-search` mechanism entry (match the file's existing entry shape + pin convention; `doc-search` is required because the vault's `project` blueprint now depends on it).
- [ ] Run `cd /Users/willfellhoelter/notes/sauce/<vault> && sauce update --bump-pins && sauce install`.
- [ ] Verify: `sauce status` → `Drift: none` + git head matches workshop HEAD; and `ls "<vault>/spice/wiki/Wiki.md"` exists with `type: wiki-hub`.
- [ ] Watch for `skipping wiki — depends on <mech> … not subscribed` — if seen, add the missing transitive mechanism to that vault's subscription and re-install.
- [ ] Preserve the invariant from memory: `ero-sauce` must keep `workshop_relative_path = /opt/homebrew/opt/sauce/libexec` if it is brew-only — CHECK its `ranch/platform-config.json` first; if brew-only, ensure the shipped brew bottle is at the new version before installing ero (the pipeline ships the tap), otherwise install from the local clone consistent with the other vaults per the current machine's local-clone convention. Resolve per the actual config; do not flip ero's resolution.

### Task H4: Final report

- [ ] Report: shipped version, the three vaults' `sauce status` output, `spice/wiki/` materialization confirmation, and a note that the user must `Cmd+R` in each Obsidian vault to load the new CustomJS classes. Then hand back for live iteration.

---

## Self-review notes (author)

- **Spec coverage:** nav button (C2), hub (C3/D1), arbitrary-depth sections (folder-is-truth C2/D1), pages (C3), search (A-stage graduation + D1 consumption), move (D2/D3), breadcrumb arbitrary-depth (B), create dialogs (C2/C3), deploy to 3 vaults (H3). Deferred items (ingestion, correlation, MOC) intentionally absent.
- **Type/name consistency:** helper pure-method names are pinned in D4 and MUST match D1–D3 (`_immediateChildFolders`, `_immediatePages`, `_recentPages`, `sectionTargets`, `targetPath`, `isNoop`, `_buildMoveOptions`). Note types `wiki-hub`/`wiki-section`/`wiki-page` used identically across manifest, templates, seed, harness.
- **Open contract resolved at execution:** C1 (entity-create folder token) — primary + concrete fallback (`dir` frontmatter) both specified, no placeholder.
- **Versions:** every `range`/catalogue/subscription version is either pinned to a concrete value the implementer reads from the live catalogue, or `0.1.0` for the two new components. No hand-bump of `workshop_version`/tags.
