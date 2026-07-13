# Project dashboard (at-a-glance card) — design

**Date:** 2026-07-13
**Status:** Approved (design), pre-implementation
**Blueprint touched:** project

## Problem

Opening a project note today costs too many clicks. The five real destinations
(Docs, Board, To-Do, Map, Meetings) are only reachable via the ChromeBar `Go ▾`
launcher, so any nav = two clicks minimum. The current hub also stacks four
separate panels (`ProjectActivityPanel`, `ProjectOpenTasks`, `ProjectMeetingsPanel`,
`ProjectLinksPanel`) plus a standalone `ProjectStatusWidget` — visually noisy,
inconsistent counts across surfaces, and no single glance-view for "how big is
this project right now."

We want one compact card at the top of every project note that:

- Shows a status pill + the five destinations as clickable tiles with counts.
- Shows recent activity + links inline, without four separate SectionLabel blocks.
- Feels visually consistent with `TripDashboard` (compact, single card, ~250px).
- Fits mobile 390px cleanly (3-up + 2-up tile wrap).

## Goals

- One-click nav to any of the 5 project sections from the hub.
- At-a-glance counts (Docs / Board / To-Do / Map / Meetings) — actionable where
  it matters (Board, To-Do = open items), total where it doesn't (Docs, Map,
  Meetings).
- Single card replaces StatusWidget + 4 panels — same information, smaller footprint.
- Preserves the leading-hairline chrome grammar (no visible divider between
  ChromeBar and dashboard, per the `note-chrome.md` StatusWidget exception).
- Idempotent install heal migrates existing project notes without user action.

## Non-goals

- No changes to ChromeBar, ProjectNavButtons, or the `Go ▾` launcher.
- No changes to any other surface (Docs.md, Section hub, Board, Map, To-Do note,
  Task note view). Dashboard only lives on the project hub note.
- No new mechanism. Reuses `cards`, `section-label`, `menu-popover`, `render-safe`,
  and the icon set already vendored via `project-chrome-bar.js`.
- No changes to how status is stored (still frontmatter `status` +
  `status_changed_at`).

## Architecture

**New file** — `platform/blueprints/project/helpers/project-dashboard.js`

Single class `ProjectDashboard` with:

- `render(dv)` — top-level entry, called from `Template, Project.md`.
- Private `_counts(dv, ctx)` — returns `{docs, board, todo, map, meetings}`,
  each try/caught with default 0.
- Private `_recent(dv, ctx)` — merged docs+meetings+task-notes by mtime, cap 5.
- Private `_renderHeader(container, ctx)` — status pill row.
- Private `_renderTiles(container, ctx, counts)` — 5 tiles + click wiring.
- Private `_renderRecent(container, ctx, items)` — SectionLabel + 5 rows.
- Private `_renderLinks(container, ctx, links)` — SectionLabel + chips.
- Static `_projectMatches(field, currentPath, projectName)` — imported from
  `ProjectActivityPanel` (move to shared or duplicate; see Decision below).
- Static `_parseBoardOpenTaskCount(app, boardPath)` — reused from
  `ProjectOpenTasks._parseBoard` logic.

**Deleted files** (subsumed by ProjectDashboard):

- `platform/blueprints/project/helpers/project-activity-panel.js`
- `platform/blueprints/project/helpers/project-open-tasks.js`
- `platform/blueprints/project/helpers/project-meetings-panel.js`
- `platform/blueprints/project/helpers/project-links-panel.js`

**Kept unchanged** — `project-status-widget.js` (dashboard imports its `STATES`
map + `set(app, file, status)` method for the picker; single source of truth
preserved).

**Manifest change** — `platform/blueprints/project/manifest.json`:

- Remove `ProjectActivityPanel`, `ProjectOpenTasks`, `ProjectMeetingsPanel`,
  `ProjectLinksPanel` from `customjs_classes`.
- Add `ProjectDashboard`.
- Bump `project` blueprint minor version.

**Template change** — `Template, Project.md`:

- Replace the 5 dataviewjs blocks (StatusWidget + 4 panels) with a single block
  invoking `ProjectDashboard`.
- Keep the `ProjectChromeBar` block above it, unchanged.

### Decision: `_projectMatches` placement

`_projectMatches` currently lives on `ProjectActivityPanel` and is duplicated on
`ProjectMeetingsPanel`. Both classes are being retired. Move the canonical copy
to `ProjectDashboard` as a static method; no consumers outside project blueprint
need it (verified via grep during research).

## Card layout

Single card container:

```
background: var(--background-secondary);
border-radius: 10px;
padding: 12px;
max-width: 720px;
```

Contents, top-to-bottom, inside the container:

### 1. Header row

- Flex row, wraps on narrow screens.
- Left: **status pill** — colored chip using `ProjectStatusWidget.STATES[status].color`.
  Click → `customJS.MenuPopover.open(entries, {anchor: pill})` with the 7 states;
  selection → `ProjectStatusWidget.set(app, file, newStatus)`.
- No leading hairline; hugs tight under ChromeBar (inherits the StatusWidget
  exception from `note-chrome.md` §1a).

### 2. Tile row

- 5 tiles laid out `display:flex; flex-wrap:wrap; gap:8px`.
- Each tile:
  - `min-width: 116px; flex: 1 0 116px; max-width: 180px`
  - `padding: 10px 12px; border-radius: 8px`
  - `background: var(--background-primary); border: 1px solid var(--background-modifier-border)`
  - Hover: `background: var(--background-modifier-hover)`
  - Interior: icon (16–18px, `color: var(--text-muted)`) + label
    (`text-transform: uppercase; letter-spacing: 0.03em; font-size: 0.72em; color: var(--text-muted)`) +
    count chip (`font-size: 1.4em; font-weight: 600; color: var(--interactive-accent)` for >0,
    grayed for 0)
- Tiles never hidden — a 0-count tile still renders (grayed) so the layout is stable.
- Click → `app.workspace.openLinkText(navPath, currentPath, false)`.
- Desktop viewport (>=720px): all 5 fit on one row.
- Mobile 390px: 3-up on row 1, 2-up on row 2 (`min-width: 116px` + `gap: 8px` +
  card horizontal padding = ~360px used for 3 tiles; the last 2 wrap).

### 3. Recent strip

- **Inline muted uppercase label** "Recent" — NOT `SectionLabel` (that primitive
  owns a top hairline, which breaks the single-card feel). Style: `text-transform:
  uppercase; letter-spacing: 0.03em; font-size: 0.72em; color: var(--text-muted);
  margin-top: 12px`.
- Below: 5 condensed rows:
  - Row: `display:flex; align-items:center; gap:8px; padding: 4px 0`.
  - Icon (source-type — `docs`/`board`/`todo` icon from ChromeBar icons) +
    title (`text-overflow: ellipsis; overflow: hidden; white-space: nowrap`) +
    relative time (`margin-left:auto; font-size:0.75em; color: var(--text-muted)`).
- Click row → `app.workspace.openLinkText(item.path, currentPath, false)`.
- Empty items → hide the whole SectionLabel + rows.

### 4. Links row

- **Inline muted uppercase label** "Links" — same style as Recent's label.
- Chips: small clickable pills for each `frontmatter.links[]` entry:
  - Padding 4×10px, border-radius 999px, background `var(--background-modifier-hover)`.
  - External URL → `window.open(url, "_blank")`.
  - Internal `[[Note]]` → `app.workspace.openLinkText(target, currentPath, false)`.
- Empty `links` frontmatter → hide the whole SectionLabel + chips row.

Between internal sub-sections (tiles → Recent → Links): `margin-top: 12px` on
each sub-section — **no visible dividers inside the card**. The card border is
the only boundary; the single-card feel is preserved.

## Data queries

All wrapped in try/catch, default 0 for counts / [] for lists.

| Tile | Query | Notes |
| --- | --- | --- |
| Docs | `dv.pages(\`"${folder}/docs"\`).where(p => p.type === "doc-note").length` | Total doc-notes. |
| Board | `_parseBoardOpenTaskCount(app, \`${folder}/${slug}-board.md\`)` | Reuse ProjectOpenTasks parser: read file text, split on `## `, ignore "Completed" lane, count `- [ ]` in non-Completed. |
| To-Do | Read `${folder}/${projectName} To-Do.md`, count unchecked `- [ ]` lines | Mirrors board parser. Missing note → 0. |
| Map | `(dv.current().workstreams || []).length` | Frontmatter array. |
| Meetings | `dv.pages('"spice/meetings/notes"').where(p => p.type === "meeting" && _projectMatches(p.project, path, name)).length` | Reuse `_projectMatches`. |

Cold-load safety: each query guard-checks `dv?.pages` and `dv?.current`; missing
folder / missing method returns 0.

## Recent strip data

Merged query mirroring current `ProjectActivityPanel`:

```
docs = dv.pages(`"${folder}/docs"`).where(p => p.type === "doc-note")
meets = dv.pages('"spice/meetings/notes"').where(p => p.type === "meeting" && _projectMatches(p.project, ...))
tasks = dv.pages(`"${folder}/tasks"`).where(p => p.type === "task-note")
items = [...docs, ...meets, ...tasks]
  .sort((a, b) => (b.file.mtime.ts ?? 0) - (a.file.mtime.ts ?? 0))
  .slice(0, 5)
```

Each item's `_kind` tagged (`doc` | `meeting` | `task`) for icon selection.

## Navigation targets

| Tile | Target path |
| --- | --- |
| Docs | `${folder}/Docs.md` |
| Board | `${folder}/${slug}-board.md` |
| To-Do | `${folder}/${projectName} To-Do.md` |
| Map | `${folder}/Map.md` |
| Meetings | `spice/meetings/Meetings.md` (verify existence during implementation; fall back to `spice/meetings/` folder open if the note is absent) |

## Install heal

**New function** `applyProjectDashboardConformanceHeal(app)` in `platform/install.js`.

- Scans all `spice/projects/*/*.md` where frontmatter `type === "project"` (via
  `app.metadataCache`).
- For each project note:
  - If body already contains `class: "ProjectDashboard"` → skip (idempotent).
  - Else: strip the 4+1 legacy dataviewjs blocks (StatusWidget, ActivityPanel,
    OpenTasks, MeetingsPanel, LinksPanel) — matched by `class: "Xxx"` substring
    inside a fenced dataviewjs block.
  - Insert a single ProjectDashboard block **immediately after** the ProjectChromeBar
    block (or at the top of body if ChromeBar is missing).
  - Write a `.bak` sidecar (project-note filename with `.bak` extension) once, then
    write updated content.
- Wraps every step in try/catch; a single-note failure never throws.
- Registered in `install.js`'s heal sequence after the ChromeBar heal.

Verification during install:

- Dry-run mode logs the diff without writing.
- Live-run logs `[project-dashboard-heal] N notes migrated, M skipped (already
  migrated), K errors`.

## Testing

### Behavioral harness — new `PROJDASH-*` group in `platform/test/harness/run-project.js`

- **PROJDASH-1** — Render happy path: fixture project with 3 docs, 2 board open,
  1 todo open, 2 workstreams, 4 meetings. Assert all 5 tiles rendered with icon +
  label + correct count text.
- **PROJDASH-2** — Empty project: 0 across the board. Assert all 5 tiles render
  (grayed 0s), Recent section hidden, Links section hidden.
- **PROJDASH-3** — Board count parsing: fixture board with 5 open in Todo lane +
  3 open in In Progress + 2 open in Completed lane. Assert board count = 5+3 = 8
  (Completed excluded).
- **PROJDASH-4** — Recent strip mtime order: fixture with docs/meetings/tasks
  spanning a week. Assert top 5 rendered newest-first with correct icon per kind.
- **PROJDASH-5** — Click wiring: mock `app.workspace.openLinkText`; simulate tile
  clicks; assert each tile calls `openLinkText` with the expected target.
- **PROJDASH-6** — Status pill picker: mock `MenuPopover.open`; click status pill;
  assert `open` called with 7 state entries.
- **PROJDASH-7** — `_projectMatches` matrix: string / `[[Wiki]]` / `[[Wiki|alias]]` /
  page-link / display-object variants all match; unrelated project doesn't.

### Seed-vault heal test

- Add 2 sample `type: project` notes to `platform/test/seed-vault/`, one with the
  legacy 5-block chrome, one with only ChromeBar (no legacy blocks).
- Run `applyProjectDashboardConformanceHeal(mockApp)` twice.
- Assert: (a) after first run both notes have ProjectDashboard block, `.bak`
  written only for the legacy one; (b) after second run 0 mutations (idempotent);
  (c) ChromeBar block preserved verbatim.

### Playwright HTML visual harness

Per [[lesson_verify_chrome_visually_with_playwright_harness]]:

- Faithful HTML replica of dashboard card with CSS vars set for dark theme
  (`--background-secondary`, `--background-primary`, `--background-modifier-border`,
  `--interactive-accent`, `--text-muted`, `--background-modifier-border-hover`).
- Serve via `python3 -m http.server` (Playwright MCP blocks `file://`).
- Screenshot at 390px and 720px viewports.
- Assert tile wrap (3+2 at 390px, 5-in-a-row at 720px), divider hairline visible
  on dark theme, count chip color contrast against card background.

## Version bump / rollout

- `project` blueprint version → next minor (per current cycle counter — pipeline
  computes exact number).
- No new mechanism → no consumer-subscription changes required.
- Release pipeline auto-flow:
  1. Feature PR merges to `main`.
  2. Bumper opens release PR with per-component + umbrella semver.
  3. Release PR auto-merges once CI green.
  4. Tap PR opens against `homebrew-sauce` tap.
  5. Tap PR auto-merges.
  6. `brew update && brew upgrade sauce` bumps the CLI on the machine.
  7. `sauce update --force` on each of accuris / headspace / ero installs the new
     project blueprint (heal runs, migrating any existing project notes in each
     vault).

Manual restart of Obsidian (Cmd+R) after deploy for the new customJS class to load.

## Rollback

- Behavioral rollback: revert the workshop commit and rely on the pipeline to
  auto-release the previous version.
- Data rollback: the `.bak` sidecars written by the heal contain the pre-migration
  body; a small unwrite-heal (not scoped in this cycle) could restore from them if
  needed.

## Landmines to watch during build

- **`_projectMatches` duplication.** Ensure both retired panels' copies get merged
  correctly. Grep for `_projectMatches` after refactor — should exist only on
  `ProjectDashboard`.
- **Board file name.** `{slug}-board.md` not `${projectName}-board.md`. Confirm
  `ctx.projectSlug` vs `projectName` during implementation.
- **`makeAdapter` / installer forwarding.** N/A here (no new mechanism), but
  `manifest.json` `customjs_classes` list must not drop `ProjectDashboard`
  silently — verify with `sauce update --force` on the dogfood vault post-build.
- **Icon reuse.** Do NOT vendor new icons — use the set already in
  `project-chrome-bar.js`'s ICON map (project, map, board, task, docs, todo, links).
  If any missing, source from the shared `icons` mechanism, not a one-off SVG.
- **Chrome grammar.** No literal `---` between chrome and dashboard; no `## H2`
  headings inside the card (per `note-chrome.md`). Use `SectionLabel` for
  sub-section labels only.
- **Autoloop convergence.** If autoloop is running the same repo, our worktree
  branch could go BEHIND main between subagent build and PR open. Verify with
  `git merge origin/main` before pushing.
