# Projects Wiki Area — Design

**Date:** 2026-05-16
**Card:** [[Wiki Area]] (Projects Blueprint workstream)
**Target cycle:** `project@1.9.2 → 1.10.0` MINOR · `workshop_version 0.49.2 → 0.50.0` MINOR

---

## 1. Motivation

The card body (verbatim):

> Adding Wiki functionality so projects get their own area, a wiki hub where you can create notes to jot down notes and thoughts.
>
> this would be kind of like an area like the scratch blueprint, but for projects where you can create isolated notes within the wiki hub for the project with cards listed for all the scratch notes for that project so that you just have at least an area within the project to jot down notes related to it without having to write down stuff in other areas

Today there is no per-project notes surface other than the project root note itself and ad-hoc task-note children. Users wanting to jot down thoughts about a project either pollute the root note, scatter them across daily notes, or invent ad-hoc files. The Wiki Area introduces a dedicated, per-project, hub-with-siblings surface that mirrors the **scratch day-hub pattern** (scratch's day-hub renders timestamped scratch siblings) but scoped to projects (each project has its own wiki, holding user-titled wiki notes).

## 2. Layout

```
spice/projects/<slug>/
├── <Project Name>.md          (existing — project root)
├── Project Map.md             (existing — sidecar)
├── <slug>-board.md            (existing — kanban)
└── wiki/                      (NEW)
    ├── Wiki.md                (NEW — per-project hub)
    ├── <Note Title 1>.md      (NEW — wiki-note instance)
    └── <Note Title 2>.md      (...)
```

Landmine #11 (module-directory invariant) holds: all wiki content lives under `spice/projects/`, the project blueprint's owned module directory. The `wiki/` subdir is a per-entity sub-folder analogous to the existing `tasks/` subdir, not a new top-level namespace.

## 3. Components

### 3.1 Wiki.md hub (per-project)

Frontmatter:
```yaml
---
type: wiki-hub
project: "[[<Project Name>]]"
project_slug: <slug>
project_name: <Project Name>
created: <YYYY-MM-DD HH:mm>
tags:
  - wiki-hub
---
```

Body:
```markdown
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });
```

---

```dataviewjs
// entity-create:wiki-note — installer-managed; do not delete this comment
await dv.view("ranch/views/customjs-guard", { class: "AccentButton", args: [{ id: "wiki-note", label: "+ New Wiki Note", icon: "file-plus" }] });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectWikiCards" });
```
```

The inside-block JS comment `// entity-create:wiki-note` is the v0.49.0 sentinel format (invisible in both source and reading modes). The `AccentButton` dispatch hands off to `customJS.EntityCreate.render({ id: "wiki-note", ... })` at runtime; the `<!-- entity-create:wiki-note -->` outside-block marker is NOT used.

### 3.2 Wiki note instance

Frontmatter:
```yaml
---
type: wiki-note
project: "[[<Project Name>]]"
project_slug: <slug>
created: <YYYY-MM-DD HH:mm>
tags:
  - wiki-note
---
```

Body: SpaceNavButtons + ProjectNavButtons blocks. No other scaffolding — the user fills the body.

### 3.3 NEW CustomJS class `ProjectWikiCards`

Mirrors `ProjectNotesCards`:

- Reads `dv.current().file.folder` to identify the wiki dir.
- Calls `dv.pages(\`"${wikiFolder}"\`)` filtered by `type === "wiki-note"`.
- Sorts by `created` descending.
- Dispatches to `customJS.BeaconCards.render(dv, { pages: results, title: p => p.file.name, subtitle: p => p.created || "", target: p => p.file.link })`.
- Falls through to an empty-state callout if no notes exist: `> [!info] No wiki notes yet · Click "+ New Wiki Note" above to create one`.

### 3.4 NEW entity-create entry `id=wiki-note`

Added to `project/manifest.json` `new_entity_buttons[]`:

```json
{
  "id": "wiki-note",
  "label": "+ New Wiki Note",
  "icon": "file-plus",
  "prompts": [
    {
      "key": "title",
      "label": "Wiki note title",
      "type": "string",
      "required": true,
      "validate": "safe-filename"
    }
  ],
  "destination": {
    "folder_prefix": "spice/projects/{{current_file.frontmatter.project_slug}}/wiki",
    "filename_prefix": "{{prompts.title|sanitize-filename}}"
  },
  "frontmatter_template": {
    "type": "wiki-note",
    "project": "[[{{current_file.frontmatter.project_name}}]]",
    "project_slug": "{{current_file.frontmatter.project_slug}}",
    "created": "{{now.YYYY-MM-DD HH:mm}}",
    "tags": ["wiki-note"]
  },
  "body_template": "Template, Wiki Note.md",
  "render_in": {
    "kind": "hub",
    "target_path": "{{templates_path}}/Template, Wiki Hub.md"
  }
}
```

The `render_in.target_path` points at the template (where the install-time sentinel lives). At runtime, instances inherit the sentinel from the template body via the `body_template` path on the project-creation flow OR via the `applyWikiBackfill` installer step for pre-existing projects.

### 3.5 EXTEND `id=project` entity-create's `extra_files[]`

Add one entry:

```json
{ "filename_pattern": "wiki/Wiki.md", "body_template": "Template, Wiki Hub.md" }
```

Every NEW project gets a `wiki/Wiki.md` sidecar materialized automatically. The body_template substitutes `{{prompts.slug}}` and `{{prompts.name}}` into the hub's frontmatter at create time.

### 3.6 NEW Wiki AccentButton on `ProjectNavButtons`

Rendered when current note's frontmatter `type` ∈ `{ project, task-note, wiki-hub, wiki-note }`. Action: `openLink` to `<projectDir>/wiki/Wiki.md`. No lazy-create — the installer backfill (§3.7) ensures Wiki.md exists for every project.

Icon: `book-open` (Lucide; resolved via icons mechanism Tier 2 fallback to Obsidian `setIcon()` since Tier 1 has no wiki-specific vendored SVG; letter `W` fallback applies if both tiers return null).

Order: just after the existing "Open Board" / "Create Board" buttons in the project-context row.

### 3.7 NEW installer helper `applyWikiBackfill(adapter, variables, manifest, history, git)`

Triggered as a per-blueprint pipeline step for the `project` blueprint, immediately AFTER `applyNewEntityButtons`. Algorithm:

1. List entries under `spice/projects/` (vault.adapter.list).
2. For each entry that is a directory AND not in `{ "All Projects" }` reserved names:
   - Find the project root note. Algorithm:
     1. Scan `*.md` files DIRECTLY inside `<dir>` (non-recursive — excludes `tasks/`, `wiki/`, `board/`).
     2. For each, read frontmatter via `app.metadataCache.getFileCache(file)?.frontmatter`.
     3. The first file with `frontmatter.type === "project"` is the project root.
     4. If none → warn and skip (`history.push({ event: "warning", step: "wiki_backfill", reason: \`no project root in ${dir}\` })`).
   - Extract `project_slug` (directory basename) and `project_name` (frontmatter `name` field, falling back to filename without extension).
   - Compute `wikiPath = <dir>/wiki/Wiki.md`.
   - If exists → skip (idempotent).
   - Otherwise: read `{{templates_path}}/Template, Wiki Hub.md`. Substitute `{{prompts.slug}} → project_slug`, `{{prompts.name}} → project_name`, `{{now.YYYY-MM-DD HH:mm}} → ISO timestamp`. Write to `wikiPath` (creating `<dir>/wiki/` directory if absent).
3. On success, push history entry `{ event: "info", step: "wiki_backfill", reason: \`backfilled N projects\` }`.
4. Failure-loud per existing installer convention: catch per-entry exceptions, log warning, continue.

The helper is ~80 LOC. It's the FIRST installer step that walks the consumer vault's content tree (existing helpers walk `.obsidian/`, `ranch/`, or per-blueprint sources). Landmine #20-style read-only posture: only WRITES paths under `spice/projects/*/wiki/Wiki.md`; never modifies project root notes.

### 3.8 NEW rule_fragments

```json
{
  "target": "wiki-hub",
  "fragment": {
    "scope": { "path_glob": "spice/projects/*/wiki/Wiki.md" },
    "frontmatter_branch": [{
      "when": { "frontmatter": { "type": "wiki-hub" } },
      "required_frontmatter": {
        "type":         { "required": true, "type": "string", "matches": "^wiki-hub$" },
        "project_slug": { "required": true, "type": "string" },
        "project_name": { "required": true, "type": "string" },
        "created":      { "required": true, "type": "string" }
      },
      "required_tags": [{ "tag": "wiki-hub" }]
    }]
  }
},
{
  "target": "wiki-note",
  "fragment": {
    "scope": { "path_glob": "spice/projects/*/wiki/*.md", "exclude": "spice/projects/*/wiki/Wiki.md" },
    "frontmatter_branch": [{
      "when": { "frontmatter": { "type": "wiki-note" } },
      "required_frontmatter": {
        "type":         { "required": true, "type": "string", "matches": "^wiki-note$" },
        "project":      { "required": true, "type": "string" },
        "project_slug": { "required": true, "type": "string" },
        "created":      { "required": true, "type": "string" }
      },
      "required_tags": [{ "tag": "wiki-note" }]
    }]
  }
}
```

If `scope.exclude` is not already supported by the audit rule compiler, add it (~10 LOC in `audit/rule-runner.js`). Audit happy/sad fixtures cover both glob inclusion and exclusion.

## 4. New files

### 4.1 Templates

- `platform/blueprints/project/templates/Wiki Hub.md` — template body for `Wiki.md` (renders as §3.1).
- `platform/blueprints/project/templates/Wiki Note.md` — template body for wiki-note instances (§3.2).

### 4.2 Helpers

- `platform/blueprints/project/helpers/project-wiki-cards.js` — ProjectWikiCards class (§3.3).

### 4.3 Installer

- `platform/install.js` — `applyWikiBackfill` helper (§3.7), wired into the project blueprint's per-blueprint pipeline after `applyNewEntityButtons`.

## 5. Test harness deltas

### 5.1 `run-entity-create.js` (+6 sub-asserts: WIKI-1..6)

- WIKI-1: manifest declares `id=wiki-note` entry.
- WIKI-2: `destination.folder_prefix` uses `{{current_file.frontmatter.project_slug}}` token.
- WIKI-3: `frontmatter_template.project` uses `{{current_file.frontmatter.project_name}}` token.
- WIKI-4: `render_in.target_path` points at `{{templates_path}}/Template, Wiki Hub.md`.
- WIKI-5: project's `extra_files[]` contains `wiki/Wiki.md` mapping.
- WIKI-6: end-to-end: seeded project creation produces `wiki/Wiki.md` sidecar.

### 5.2 `run-helper-cases.js` (+4 sub-asserts: PWC-1..4)

- PWC-1: `ProjectWikiCards` class definition parses.
- PWC-2: filters `dv.pages(...)` by `type === "wiki-note"`.
- PWC-3: sorts by `created` descending.
- PWC-4: empty-state callout emitted when zero results.

### 5.3 `run-renderer.js` (+3 cases: R-WIKI-1..3)

- R-WIKI-1: AccentButton fence with `wiki-note` sentinel renders at hub-template path.
- R-WIKI-2: rendered fence references `customJS.EntityCreate` with `id: "wiki-note"`.
- R-WIKI-3: rendered hub body includes `ProjectWikiCards` dispatch block.

### 5.4 `run-audit.js` (+4 sub-asserts: AU-WIKI-1..4)

- AU-WIKI-1: wiki-hub fragment compiles cleanly.
- AU-WIKI-2: wiki-note fragment compiles cleanly with `scope.exclude` honored.
- AU-WIKI-3: happy fixture (valid Wiki.md + valid Note.md) zero findings.
- AU-WIKI-4: sad fixture (missing `project_slug`) raises a finding.

### 5.5 `run-integration-smoke.js` (+3 sub-asserts: WIKI-INT-1..3)

- WIKI-INT-1: new-project flow materializes `wiki/Wiki.md` sidecar.
- WIKI-INT-2: pre-existing project with no `wiki/` dir gets backfilled to `wiki/Wiki.md` on `applyWikiBackfill` run.
- WIKI-INT-3: re-running `applyWikiBackfill` on an already-backfilled project is a no-op (idempotent).

### 5.6 Whole-suite delta

Adds ~20 sub-asserts. 15 harness count unchanged.

## 6. Manifest changes

`platform/blueprints/project/manifest.json`:

- `version`: `1.9.2 → 1.10.0` MINOR.
- `customjs_classes[]`: `+ "ProjectWikiCards"`.
- `files[]`: `+ 3 entries` (Wiki Hub template, Wiki Note template, project-wiki-cards.js).
- `new_entity_buttons[id="project"].extra_files[]`: `+ 1 entry` (`wiki/Wiki.md` → `Template, Wiki Hub.md`).
- `new_entity_buttons[]`: `+ 1 entry` (`id="wiki-note"`, full block per §3.4).
- `rule_fragments[]`: `+ 2 entries` (wiki-hub, wiki-note).

`platform/manifest.json`:

- `workshop_version`: `0.49.2 → 0.50.0` MINOR.
- `date`: `"2026-05-16"`.
- Blueprints catalogue entry for `project`: `1.9.2 → 1.10.0`.

`package.json`:

- `version`: `0.49.2 → 0.50.0`.

`ranch/platform-subscription.json`:

- `project` pin: `1.9.2 → 1.10.0`.
- `workshop_version`: `0.49.2 → 0.50.0`.

## 7. Versioning & release

- Workshop: MINOR bump (additive feature). Tag `v0.50.0`.
- project blueprint: MINOR bump (new entity-create entry + new customjs class + new templates + new installer step).
- entity-create mechanism: UNCHANGED at `0.3.0` (existing schema covers this).
- Brew tap auto-bumps via `.github/workflows/release.yml` preflight + bump-tap chain on tag push.

## 8. Risks & open questions

- **R1 (low):** `ProjectNotesCards` currently includes all `.md` files in the project folder tree; wiki-notes will appear there too. Acceptable for first cycle — wiki-notes ARE project notes. If duplication becomes noisy, a follow-up cycle can add a `type !== "wiki-note"` filter to `ProjectNotesCards`.
- **R2 (low):** Backfill helper's heuristic for finding a project root note assumes either `<DirName>.md` exists in the project folder OR a `*.md` with `type:project` frontmatter is in the folder. Should hold for v1.4.0+ projects. Pre-v1.4.0 projects may have used `slug`-named hub notes; backfill skips them with a clear warning.
- **R3 (low):** `scope.exclude` audit-rule feature is new. If the existing `_compileGlob` function in `audit/rule-runner.js` doesn't already support exclusion, add ~10 LOC. Sub-asserts AU-WIKI-2 + AU-WIKI-3 cover the new branch.
- **R4 (low):** `safe-filename` validate predicate must exist in entity-create's schema validator. It does (from v0.46.0 EntityCreate). Confirm via existing run-entity-create.js predicate enumeration.

## 9. Out of scope (deferred)

- `/wiki` slash command — no obvious current-project resolution heuristic from a vault-wide cold start. Future cycle could add it with an "open most-recently-active project's wiki" semantic.
- Wiki-note status workflow (draft/active/archived) — minimal schema chosen for v1; can extend later.
- Cross-project wiki search/filter UI — Obsidian's global search already handles this.
- Wiki-note templates beyond the bare scaffold — user-fillable.
- Migration of pre-v1.4.0 projects (non-name-style hub notes) — skipped with warning; not a regression.

## 10. Closeout criteria

- All five harness deltas pass.
- Workshop self-install via `sauce reinstall --vault $PWD` clean.
- `sauce audit --strict` zero findings.
- Manual smoke: create a NEW project at the workshop vault → `wiki/Wiki.md` exists; click "+ New Wiki Note" → wiki-note created in `wiki/<Title>.md` with correct frontmatter; ProjectWikiCards renders the new note.
- Brew tap auto-bump succeeds on tag push.
