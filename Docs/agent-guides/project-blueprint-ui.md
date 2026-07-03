---
purpose: UI / Nav conventions for the project blueprint. Locks the shared rendering primitives + section ordering + spacing rules established in v0.109.0 so future helpers stay cohesive instead of accreting.
---

# Project blueprint — UI / Nav conventions

Authored at the v0.109.0 "projects visual overhaul" cycle. Every helper that renders into a project-related note (project hub, `Docs.md`, section hubs, doc-notes, Project Map, Project Board, Task notes) MUST conform.

When you change an existing helper or write a new one, read this file first.

## 1. Render primitives

| Primitive | What it does | Where it ships | Consumers (today) |
| --- | --- | --- | --- |
| `Breadcrumb` | Clickable parent trail rendered as the FIRST block of every project-related note. Type-dispatched on `cur.type` (project / docs-hub / section-hub / doc-note / map / kanban / task-note). Path-based fallback when frontmatter is missing the `project` / `project_slug` fields. | `platform/blueprints/project/helpers/breadcrumb.js` | Every project-related template (added at v0.109.0 S7 for Map / Board / Task Note). |
| `SectionLabel` | Small uppercase muted label + hairline divider above. Replaces every `dv.header(3, ...)` call. Helpers own the label for their section; templates do NOT carry `## H2` headings anymore. | `platform/mechanisms/section-label/section-label.js` (promoted to a shared mechanism at v0.122.0) | `ProjectMeetingsPanel`, `ProjectWorkstreamManager`, `ProjectDocsIndex`, `SectionHub`, plus `to-do` helpers; available to any blueprint that declares `depends_on: section-label`. |
| `DocSearch` | Entity-agnostic filter strip — text input + dynamic tag chips + scoped-Obsidian-search button + 150ms debounce + localStorage state keyed by `scopePath`. Pass `entityType` opt to scope to any blueprint type. | `platform/blueprints/project/helpers/doc-search.js` | `ProjectDocsIndex`, `SectionHub`, `ProjectsHubCards` (entityType: project at v0.109.0 S3). |
| `EntityCreate` (mechanism, not a blueprint helper) | Canonical `+ New <thing>` button. Always rendered ABOVE the cards it would seed; always available even on empty surfaces. | `platform/mechanisms/entity-create/` | Every blueprint that exposes a `+ New X` button. |

## 2. Section ordering (project hub `<Project Name>.md`)

Template, Project.md as of the 2026-07-02 chrome overhaul:

1. `Breadcrumb`
2. `SpaceNavButtons`
3. `ProjectNavButtons` — core `Project · Board · Docs` (+ context `Task:`) + a `More ▾` overflow holding `Map · To-Do · Helpful Links` (see [`note-chrome.md`](note-chrome.md) §5).
4. `ProjectStatusWidget` — **no SectionLabel, no leading hairline, no surrounding blank lines**. The chip IS the at-a-glance signal and hugs tight under the nav.
5. `ProjectActivityPanel` — "Recent activity"; cards carry a type icon (meeting/doc/task) + doc `section` in the meta.
6. `ProjectOpenTasks` — open tasks from the board.
7. `ProjectMeetingsPanel` — emits its own `SectionLabel` "Meetings" only when meetings exist.
8. `ProjectLinksPanel`.

**Workstreams are NOT on the hub.** Workstream management was consolidated onto the **Project Map** note (`ProjectWorkstreamManager` + `ProjectWorkstreams` render there); the `Map` destination lives in the nav overflow. Existing hubs are healed by `applyProjectHubWorkstreamRemovalHeal`.

Sections that follow Status each emit their own SectionLabel. Empty helper output renders NOTHING (no info callouts, no placeholder text). This rule is non-negotiable per v0.106.0.1 + v0.109.0.

## 3. Spacing rules

- **Dividers are helper-owned hairlines, never literal `---`.** Use `customJS.SectionLabel.divider(el)` (`margin: 8px 0`) with **leading-hairline ownership** (each block renders its own top hairline → exactly one per boundary). Templates carry no literal `---` and no blank-line gaps between chrome blocks. Enforced by `scripts/lint-note-chrome.js` Rule 4 (project-scoped). See [`note-chrome.md`](note-chrome.md) §1a for the full grammar + the reversal rationale.
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
