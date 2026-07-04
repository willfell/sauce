---
purpose: UI / Nav conventions for the project blueprint. Locks the shared rendering primitives + section ordering + spacing rules established in v0.109.0 so future helpers stay cohesive instead of accreting.
---

# Project blueprint — UI / Nav conventions

Authored at the v0.109.0 "projects visual overhaul" cycle. Every helper that renders into a project-related note (project hub, `Docs.md`, section hubs, doc-notes, Project Map, Project Board, Task notes) MUST conform.

When you change an existing helper or write a new one, read this file first.

## 1. Render primitives

| Primitive | What it does | Where it ships | Consumers (today) |
| --- | --- | --- | --- |
| `ProjectChromeBar` | **The single per-surface chrome renderer** (button-nav-refactor). ONE `dv.view` per template = breadcrumb (left, up-nav) + `Go ▾` launcher + one primary `AccentButton` + `⋯` overflow, replacing the Breadcrumb + SpaceNavButtons + ProjectNavButtons + action-row stack. Per-surface controls come from the pure `_surfaceSpec(context)` (`{ primary, overflow, leaf }`); `_dispatch(dv, ctx, id)` routes each action id to its existing helper; `_navEntries` / `navTarget` build the `Go ▾` destinations. `detectContext` is copied verbatim from `ProjectNavButtons`. | `platform/blueprints/project/helpers/project-chrome-bar.js` | Every migrated project template (hub / Docs / section hub / doc-note / Map / Board / Task hub / Task note / Links hub / project-todo). |
| `MenuPopover` | **Shared popup primitive.** `customJS.MenuPopover.open(entries, opts)` → desktop-anchored dropdown / mobile bottom-sheet appended to `document.body`; `{ section }` markers render muted group headers, `danger` rows color the label; ONE `close()` removes the overlay AND the Escape listener (no leak). Powers the `Go ▾` launcher, the `⋯` overflow, and per-row task menus. The DRY extraction of the old `_openLauncher` / `_openMoreMenu` overlays. | `platform/mechanisms/menu-popover/menu-popover.js` | `ProjectChromeBar` (Go ▾ + ⋯); available to any blueprint via `depends_on: menu-popover`. |
| `ProjectCommandsInit` | **Command mirror.** A customjs startup script registering each `Go ▾` / primary / `⋯` action as an Obsidian command (Cmd+P + hotkey-bindable). Every callback resolves the active file + Dataview api, builds `ctx` via `ProjectChromeBar.detectContext`, then delegates to the SAME `ProjectChromeBar._dispatch` (actions) / `navTarget` + `_openNavTarget` (nav) — no path/action logic is reimplemented. | `platform/blueprints/project/helpers/project-commands-init.js` | Registered via the project manifest's `customjs_startup_scripts[]`. |
| `ProjectNavButtons` | **RETAINED as a method library** (button-nav-refactor). Its `render()` is the LEGACY stacked project-nav chrome, superseded by `ProjectChromeBar` and appearing only on un-migrated notes. The class is kept because `ProjectChromeBar._dispatch` + `ProjectCommandsInit` reuse its create/nav methods unchanged: `_promptForTitle` / `_createTaskNote` / `_createTaskBoard` / `_openNavTarget` / `_resolveProjectName`. Keep `detectContext` in sync with the verbatim copy in `project-chrome-bar.js`. | `platform/blueprints/project/helpers/project-nav-buttons.js` | `ProjectChromeBar` + `ProjectCommandsInit` (methods); legacy templates (render). |
| `Breadcrumb` | Clickable parent trail. On migrated surfaces `ProjectChromeBar` consumes `Breadcrumb.buildSegments` directly (renders the crumbs in the bar's left zone); the standalone `Breadcrumb` view remains the FIRST block only on un-migrated notes. Type-dispatched on `cur.type` (project / docs-hub / section-hub / doc-note / map / kanban / task-note). Path-based fallback when frontmatter is missing the `project` / `project_slug` fields. | `platform/blueprints/project/helpers/breadcrumb.js` | `ProjectChromeBar` (buildSegments); every un-migrated project template (added at v0.109.0 S7). |
| `SectionLabel` | Small uppercase muted label + hairline divider above. Replaces every `dv.header(3, ...)` call. Helpers own the label for their section; templates do NOT carry `## H2` headings anymore. | `platform/mechanisms/section-label/section-label.js` (promoted to a shared mechanism at v0.122.0) | `ProjectMeetingsPanel`, `ProjectWorkstreamManager`, `ProjectDocsIndex`, `SectionHub`, plus `to-do` helpers; available to any blueprint that declares `depends_on: section-label`. |
| `DocSearch` | Entity-agnostic filter strip — text input + dynamic tag chips + scoped-Obsidian-search button + 150ms debounce + localStorage state keyed by `scopePath`. Pass `entityType` opt to scope to any blueprint type. | `platform/blueprints/project/helpers/doc-search.js` | `ProjectDocsIndex`, `SectionHub`, `ProjectsHubCards` (entityType: project at v0.109.0 S3). |
| `EntityCreate` (mechanism, not a blueprint helper) | Canonical `+ New <thing>` button. Always rendered ABOVE the cards it would seed; always available even on empty surfaces. | `platform/mechanisms/entity-create/` | Every blueprint that exposes a `+ New X` button. |

## 2. Section ordering (project hub `<Project Name>.md`)

Template, Project.md as of the button-nav-refactor (the old `Breadcrumb` + `SpaceNavButtons` + `ProjectNavButtons` chrome trio is now the single `ProjectChromeBar`):

1. `ProjectChromeBar` — breadcrumb + `Go ▾` launcher + primary `New Task` + `⋯` (`New Doc`). The single chrome unit; see §2a for the per-surface spec and [`note-chrome.md`](note-chrome.md) §1c.
2. `ProjectStatusWidget` — **no SectionLabel, no leading hairline, no surrounding blank lines**. The chip IS the at-a-glance signal and hugs tight under the bar.
3. `ProjectActivityPanel` — "Recent activity"; cards carry a type icon (meeting/doc/task) + doc `section` in the meta.
4. `ProjectOpenTasks` — open tasks from the board.
5. `ProjectMeetingsPanel` — emits its own `SectionLabel` "Meetings" only when meetings exist.
6. `ProjectLinksPanel`.

**Workstreams are NOT on the hub.** Workstream management was consolidated onto the **Project Map** note (`ProjectWorkstreamManager` + `ProjectWorkstreams` render there); the `Map` destination lives in the `Go ▾` launcher. Existing hubs are healed by `applyProjectHubWorkstreamRemovalHeal`.

Sections that follow Status each emit their own SectionLabel. Empty helper output renders NOTHING (no info callouts, no placeholder text). This rule is non-negotiable per v0.106.0.1 + v0.109.0.

## 2a. Per-surface chrome + content ordering

Every project surface leads with the **single `ProjectChromeBar` block**, then its content sections (SectionLabel-led). The bar's controls come from `_surfaceSpec(context)`:

| Surface (context) | Primary | `⋯` overflow | Content below the bar |
| --- | --- | --- | --- |
| project hub / project-todo | New Task | New Doc | Status · Activity · Open Tasks · Meetings · Links |
| projects-hub (`Projects.md`) | New Project | Sort A–Z / Recent | `ProjectsHubCards` |
| docs-hub (`Docs.md`) | New Doc | New Section · Move docs | `ProjectDocsIndex` (render) + simple `DocSearch` |
| section-hub | New Doc | New Sub-Section · Move docs | `SectionHub` in **`contentOnly`** mode (search strip + list only) |
| project map | Add workstream | Remove workstream (danger) | `ProjectWorkstreamManager` in **`contentOnly`** mode + `ProjectWorkstreams` |
| task hub | New Note | Create/Open Board | task-note tiles |
| links hub | Add link | Manage links | `ProjectLinksPanel` |
| doc-note (leaf) | — | Move | doc body |
| board / task-note / card (leaf) | — | — | note body |

**`contentOnly` render mode** (button-nav-refactor): `SectionHub` and `ProjectWorkstreamManager` each render BOTH an action row AND content. The migrated templates invoke them as `args: [{ contentOnly: true }]` so they render ONLY their content (search strip + list / workstream list) — the chrome bar's primary + `⋯` own the create/move/add/remove actions. The install heal rewrites the legacy invocations to `contentOnly: true` in place (drops only the action row, keeps the block).

Leaf surfaces render the bar (breadcrumb + `Go ▾`, optional `⋯`) with `_surfaceSpec` returning `leaf: true` — no primary button.

## 3. Spacing rules

- **The `ProjectChromeBar` is a single unit** — it renders no divider between the breadcrumb and its controls, and no leading hairline above the first content section. The §1a leading-hairline grammar applies only BETWEEN the content sections below the bar.
- **Dividers are helper-owned hairlines, never literal `---`.** Use `customJS.SectionLabel.divider(el)` with **leading-hairline ownership** (each content block renders its own top hairline → exactly one per boundary). Templates carry no literal `---` and no blank-line gaps between chrome blocks. Enforced by `scripts/lint-note-chrome.js` Rule 4 (project-scoped). See [`note-chrome.md`](note-chrome.md) §1a for the full grammar + the reversal rationale.
- **No `## H2` headings** inside project-related templates. Helpers emit `SectionLabel` instead.
- **Empty helper output = render NOTHING.** No info callouts. No placeholder strings. No "(empty state)" UI.

## 4. Naming convention

- Helper source file: `lowercase-kebab.js` under `platform/blueprints/project/helpers/`.
- Helper class: PascalCase, single noun (`SectionLabel`, `Breadcrumb`, `DocSearch`, `ProjectMeetingsPanel`).
- Helper install destination: `{{scripts_path}}/project/<same-kebab>.js`. Wire via the manifest `files[]` array.

## 5. Idempotency / marker conventions

- **Do NOT use visible HTML comment markers** (`<!-- foo-vX.Y.Z -->`) as idempotency proxies. They clutter source-mode editing.
- Use a class-invocation substring (e.g. `'class: "Breadcrumb"'`) or a stable frontmatter-field presence check as the idempotency proxy.
- Marker comments that already shipped (e.g. the v0.103.0 `breadcrumb-v1.17.0` marker stripped at v0.109.0 S8) get cleanup migrations in a subsequent cycle. See `applyDocNoteBreadcrumbMarkerCleanup` at `platform/install.js` for the reference pattern.

## 6. Card meta-line format

- Lowercase first letter. `" · "` separator. No emoji.
- Example: `12 docs · updated 2 hours ago`.
- Plural-dependent: `${n} doc${n === 1 ? "" : "s"}`.
- When a meta would be misleading (count of 0), drop the chip silently — don't render `0 docs · updated never`.

## 7. proxyDv shim pattern

When a helper renders into a `DocSearch.resultsContainer`, build a `_makeProxyDv(dv, container)` shim that forwards `current` and `pages` to the real `dv`, and mints `el / header / paragraph` onto the supplied `container`:

```js
_makeProxyDv(dv, container) {
  return {
    container,
    current: dv.current.bind(dv),
    pages:   dv.pages.bind(dv),
    el: (tag, txt, opts) => {
      const el = container.createEl(tag, { ...(opts || {}) });
      if (txt !== undefined && txt !== null && txt !== "") el.textContent = String(txt);
      return el;
    },
    header: (lvl, txt) => container.createEl(`h${lvl}`, { text: String(txt) }),
    paragraph: (txt) => { const p = container.createEl("p"); p.innerHTML = String(txt); return p; },
  };
}
```

Reference implementations:
- `platform/blueprints/project/helpers/section-hub.js` (the `_makeProxyDv` method).
- `platform/blueprints/project/helpers/project-docs-index.js` (same method, same shape).
- `platform/blueprints/project/helpers/projects-hub-cards.js` (added v0.109.0 S3).

## 8. Cross-references

- Broader cross-blueprint non-negotiables (customjs-guard, module-directory invariant, marker regions, the five non-negotiables): see [`code-conventions.md`](code-conventions.md).
- Installer migration-step pattern (used by S8's marker cleanup): see `applyDocsHubButtonRepair` at `platform/install.js` (around lines 2077–2130) for the reference implementation. Mirror its posture: per-project try/catch, history events, failure-loud-but-never-throws.
- Architecture context (mechanisms vs blueprints, where helpers live, install-time vs runtime): see [`architecture.md`](architecture.md).
