---
title: Projects blueprint — discoverability overhaul (hub recent-strip + project-page panels)
date: 2026-06-26
status: design-approved
rc: sauce-enhance-1
blueprint: project
---

# Projects blueprint — discoverability overhaul

## Problem

Finding the project you want, and finding what you were working on inside a
project, both take too many clicks today.

**All-Projects hub (`spice/projects/Projects.md` → `ProjectsHubCards`).** The hub
*already* sorts by "last edited" (max folder mtime, descending) as its primary
sort, but the **default `Group by: status`** chops that recency order into status
buckets. The single most-recently-touched project gets buried inside the
"in-progress" group, so the recency sort never *feels* like it works. The hub
also stacks a lot of filter chrome (text+tag search, status chips, team chips,
product chips, group-by dropdown) above the cards.

**Per-project page (`<Name>.md` → `Template, Project.md`).** The landing page
shows, top to bottom: Breadcrumb → space nav → project nav → Status chip →
Meetings (top 3) → Workstreams. **There is no docs surface on the landing page
at all.** To reach a doc you click `Docs` → `Docs.md` → a Section card → then the
doc. Navigation is always section-first; there is no flat "recent docs" list
anywhere in the blueprint.

## Goals

1. Surface the most-recently-active projects on the hub without removing the
   status-grouped view people are used to.
2. Put "where was I / what's next" on the project landing page so the common
   case never requires drilling through Docs → Section → doc.
3. Stay inside the established project-blueprint-UI conventions (one helper per
   surface, `SectionLabel` + `BeaconCards`, empty-renders-nothing). No new
   frontmatter / schema surface.

## Non-goals (out of scope)

- **Quick / pinned links.** Deferred — will ship later as its own self-contained
  unit that gets baked in. Do not design for it here.
- Any change to the project To-Do note.
- A sort/group-by selector overhaul on the hub. The recent-strip solves the
  recency-discoverability problem without it.

---

## Surface A — Hub "Recently active" strip

A horizontal chip row pinned at the **top of the hub grid**, above the existing
status / team / product chips and the grouped card grid.

- **Content:** the **top 4** most-recently-touched projects, each chip = project
  display name + relative time (e.g. `Denali · 2h`). Click a chip → open that
  project note.
- **Source set:** the **same filtered set** the grid renders (search + status +
  team + product filters all apply), but **always sorted by recency** and capped
  at 4. With no filter active (the default), this is simply "your 4 most recent
  projects" — the cross-status view the default status-grouping otherwise hides.
- **Empty state:** render nothing when the filtered set is empty (consistent
  with the blueprint's empty-renders-nothing rule).
- **Implementation:** a **modification to the existing `ProjectsHubCards`
  helper**, not a new helper. It reuses the `latestMtime` value already computed
  per project in `_renderInner` (no second filesystem pass). The strip renders
  inside `_renderInner` (into the DocSearch `resultsContainer` proxy), before the
  status/team/product chip bars, so it re-renders correctly on every
  filter/chip/group-by change.
- **Distribution:** ships automatically with the updated helper file on install.
  **No per-note migration** — the hub note references the helper by class via
  `dv.view`, and the helper file is replaced on install.

### Strip detail decisions (defaults; reorderable later)

- Cap = 4 chips.
- Chip label format follows the card meta-line convention: lowercase, ` · `
  separator, no emoji (`Denali · 2h`).
- Strip reflects the active filter set (consistent with the grid) rather than a
  global override.

---

## Surface B — Project page "Recent activity" panel

A **new helper `ProjectActivityPanel`** rendered on the project landing page.

- `SectionLabel: "Recent activity"`, then up to **5 rows**, newest first, merged
  across three entity types scoped to the current project:
  - **docs** — `type: doc-note` under `spice/projects/<slug>/docs/` (recurses
    sections).
  - **meetings** — `type: meeting` under `spice/meetings/notes` whose `project:`
    field references this project (reuse the `_projectMatches` shape used by
    `ProjectMeetingsPanel` / `ProjectDocsIndex`).
  - **task notes** — `type: task-note` under `spice/projects/<slug>/tasks/`.
- **Ordering:** merge all three lists, sort by `file.mtime` descending, take the
  top 5.
- **Row:** a small type tag `[doc] / [mtg] / [task]` + title + relative time;
  click → open the note (`target: file.path`). Title truncation follows the
  blueprint card conventions.
- **Empty state:** render nothing if the project has no docs, linked meetings, or
  task notes.
- This panel folds in the originally-requested "last 3 docs made/updated" — docs
  are the dominant type — while adding momentum signal from meetings and tasks.
  (Per the design conversation: one merged panel, not two.)

---

## Surface C — Project page "Open tasks" panel

A **new helper `ProjectOpenTasks`** rendered on the project landing page.

- `SectionLabel: "Open tasks"`, then the **top 3–5 unchecked tasks** read from
  the project's Kanban board `spice/projects/<slug>/<slug>-board.md` — the same
  board `ProjectsHubCards` already parses for progress.
- **Parse rule (mirror the hub's existing board parse):** `## ` lines set the
  current lane; `- [ ] ` lines are tasks. Show **unchecked tasks that are NOT in
  the `Completed` lane**, in board order (top of board first — board lines carry
  no per-line timestamp, so document order is the only stable ordering).
  Each row: task text + its lane label; click → open the board
  (`<slug>-board.md`).
- **Empty state:** render nothing if there is no board file, or no open tasks.
- **Source note (confirm-later, not now):** tasks live in two places — the
  Kanban board *and* a project To-Do note. This sources from the **board**.
  Switching to the To-Do note later is a contained change.

---

## Project page order

`Template, Project.md` block order after this change:

```
Breadcrumb
SpaceNavButtons
ProjectNavButtons
ProjectStatusWidget        (Status chip)
ProjectActivityPanel       ← NEW (Surface B)
ProjectOpenTasks           ← NEW (Surface C)
ProjectMeetingsPanel       (Meetings — unchanged)
ProjectWorkstreamManager   (Workstreams — unchanged)
```

Recent-activity and open-tasks sit directly under the Status chip so the landing
page answers "where was I / what's next" before any scrolling. Meetings stays
below — its cards are richer (attendees + Notes/open-task badges) than the
activity row, and the slight meeting overlap is acceptable.

Spacing/labels follow `project-blueprint-ui.md`: each new panel emits its own
`SectionLabel` (which carries its own hairline divider); **no `---` rules and no
`## H2` headings** in the template.

---

## How it ships

### New / modified source

- **New helper** `platform/blueprints/project/helpers/project-activity-panel.js`
  (class `ProjectActivityPanel`).
- **New helper** `platform/blueprints/project/helpers/project-open-tasks.js`
  (class `ProjectOpenTasks`).
- **Modified helper** `platform/blueprints/project/helpers/projects-hub-cards.js`
  (Surface A strip).
- Both new helpers follow the blueprint conventions: `SectionLabel` +
  `BeaconCards`, the `_makeProxyDv` shim only if they render into a
  `DocSearch.resultsContainer` (they do **not** — they render directly into
  `dv.container`, so no proxy needed), empty-renders-nothing, card meta-line
  format (lowercase, ` · `, no emoji), one purpose each.

### Wiring

- **Manifest** `platform/blueprints/project/manifest.json` `files[]` gains the
  two new helpers, each installed to `{{scripts_path}}/project/<kebab>.js`.
- **`platform/blueprints/project/templates/Project.md`** gains two `dv.view`
  blocks (`ProjectActivityPanel`, `ProjectOpenTasks`) in the order above.

### Install heal (for existing project notes)

Existing `type: project` hub notes in consumer vaults won't get the two new
`dv.view` blocks from the template alone (the hub note is materialized
per-project). An **idempotent install migration** injects the two blocks into
existing project hub notes, mirroring the `applyDocsHubButtonRepair` /
`applyDocNoteBreadcrumbMarkerCleanup` reference patterns in `platform/install.js`:

- per-project `try/catch`; fails loud (history event + `Notice`/log) but never
  throws;
- idempotency proxy = presence of the `class: "ProjectActivityPanel"` /
  `class: "ProjectOpenTasks"` invocation substring (no visible HTML-comment
  markers, per `project-blueprint-ui.md` §5);
- inserts the blocks at the correct position relative to the Status widget block
  (after `ProjectStatusWidget`, before `ProjectMeetingsPanel`).

### Schema

**No schema changes.** All three surfaces are pure read/render — no new
frontmatter fields, sidecars, contracts, or learned state. (Dropping pinned
links is what keeps this cycle schema-free; confirm against
`Docs/agent-guides/schemas.md` during planning, but nothing is expected.)

### Versioning / release

Per repo policy: do **not** hand-version, tag, or sweep pins. New helpers + a
modified helper = a `project` blueprint bump; the auto-release pipeline computes
per-component + umbrella semver. Conventional commits only.

---

## Testing & verification

- **Preflight** (`npm` preflight / build-test-verify) must stay green.
- **Migration-regression net:** the install heal needs seed-vault coverage —
  a project hub note that *lacks* the two new blocks (pre-state) plus a behavioral
  harness asserting the blocks are present and correctly ordered after install,
  and that a second install run is a no-op (idempotency). Follow
  `Docs/agent-guides/migration-regression-net.md` (per-cycle authoring loop,
  portable-sentinel pattern).
- **Empty-state checks:** a fresh project (no docs/meetings/tasks, no board)
  renders neither new panel and shows no placeholder text.
- **Hub strip:** renders ≤4 chips, respects active filters, hidden when the
  filtered set is empty.
- **Dogfood:** verify rendering in the workshop vault, then the standard
  per-vault sync.

## Open questions (resolved in design conversation)

- Hub default view → **Recent strip + grouped** (keep status grouping, add the
  recency strip on top). ✓
- Project-page additions → **Recent activity (merged docs+meetings+tasks)** +
  **Open tasks**; pinned links **dropped**. ✓
- Recent docs vs activity → **one merged panel**. ✓
- Open-tasks source → **Kanban board** (To-Do swap deferred). ✓
