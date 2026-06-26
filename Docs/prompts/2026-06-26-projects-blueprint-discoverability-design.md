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
  (class `ProjectActivityPanel`). A new thin helper over `BeaconCards`, NOT a
  reuse of the existing `activity-feed` mechanism — that mechanism is
  time-windowed (today/week/month), queries the whole vault, and keys off
  `created_at`, which is the wrong axis for "the project's last N touches by
  mtime regardless of age." (Evaluated and rejected; do not relitigate.)
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
per-project). A new idempotent install migration **`applyProjectActivityPanelsHeal`**
injects both blocks into existing project hub notes. Full design — anchor
strategy, variant handling, pipeline order, and the real before/after — lives in
the **Migration & rollout** section below (it is the load-bearing part of this
cycle).

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

## Migration & rollout

This is the load-bearing part of the cycle: every existing project note across
the consumer vaults must end up with the two new panels in the right place,
without disturbing the rest of the note. The plan below is grounded in the
**actual** current state of the three day-to-day vaults (inspected 2026-06-26).

### Live before-state (what we're migrating)

| Vault | `type: project` hubs | have `ProjectStatusWidget` | have `ProjectMeetingsPanel` | notable variants |
| --- | --- | --- | --- | --- |
| accuris-sauce | 20 | 20 | 20 | 7 lack `ProjectWorkstreamManager`; some carry extra `BacklinkPanel` / `ProjectNotesCards` / `ProjectReferencedByCards` blocks |
| ero-sauce | 1 | 0 | 1 | the single hub has **no** Status widget and no Breadcrumb |
| headspace-sauce | 5 | 2 | 5 | `claude-cowork/Project.md` is sparse — its **only** dataviewjs block is `ProjectMeetingsPanel` |
| workshop (dogfood) | 0 | — | — | `spice/projects/` holds only `Projects.md` (the hub-of-hubs); no project instances to heal |

**The one invariant: every hub in every vault has a `ProjectMeetingsPanel`
block.** Status, Breadcrumb, and nav are NOT universal. So the heal anchors on
the Meetings block, not the Status widget.

### Anchor strategy

Insert the combined `ProjectActivityPanel` + `ProjectOpenTasks` blocks
**immediately before the opening fence of the `ProjectMeetingsPanel` block.**
This yields the desired order (`… → Activity → OpenTasks → Meetings → …`) on
every real variant, including the Status-less ones.

Fallback chain for future/legacy notes that lack a Meetings block (none exist
today, but be defensive — mirror the meetings-heal posture):

1. **before** `class: "ProjectMeetingsPanel"` block (primary — 100% coverage today)
2. after the closing fence of `class: "ProjectStatusWidget"`
3. after the closing fence of `class: "ProjectNavButtons"`
4. after the closing fence of the first `dataviewjs` block
5. no `dataviewjs` block at all → emit a `no_anchor_found` warning, write nothing

### Heal function `applyProjectActivityPanelsHeal`

Mirror `applyProjectMeetingsPanelHeal` (`platform/install.js:2418`) exactly:

- walk `spice/projects/<slug>/`; identify the hub as the `.md` directly in the
  project dir whose frontmatter `type` is **exactly** `project`
  (`_noteChromeFrontmatterType(body) === "project"`) — so `project-todo`,
  `projects-hub`, `map`, `kanban`, and `doc-note` notes are never touched;
- **idempotency proxy:** skip when the body already contains
  `class: "ProjectActivityPanel"` (both blocks are always inserted together, so
  one substring check is sufficient — matches the meetings-heal precedent);
- insert BOTH blocks as a single combined string at the resolved anchor, with a
  blank line separating each block and the following Meetings block;
- `.sauce-backup/<ts>/<path>` snapshot of the pre-state before every write;
- per-project `try/catch`; emit `healed` / `skipped_already_healed` /
  `no_anchor_found` / `warning` history events; **never throws**; emits a final
  vault-level `healed N; skipped M; W warning(s)` summary event;
- export on `module.exports` for the harness (mirror line 14228).

**Pipeline order matters.** Call `applyProjectActivityPanelsHeal` in the install
sequence **immediately after** `applyProjectMeetingsPanelHeal` (install.js
~line 1154). That ordering guarantees any hub that *just* had a Meetings block
injected this same install pass presents the primary anchor to our heal.

### New projects

Add the two `dv.view` blocks to `platform/blueprints/project/templates/Project.md`
between `ProjectStatusWidget` and `ProjectMeetingsPanel`, so projects created via
the new-project skill are born with the full, correctly-ordered panel set and
never need the heal.

### Concrete before → after (real notes)

`accuris-sauce/spice/projects/ems/EMS.md` (has Status):

```
before:  … ProjectNavButtons → ProjectStatusWidget → ProjectMeetingsPanel → ProjectWorkstreamManager → …
after:   … ProjectNavButtons → ProjectStatusWidget → ProjectActivityPanel → ProjectOpenTasks → ProjectMeetingsPanel → ProjectWorkstreamManager → …
```

`ero-sauce/spice/projects/microsoft-egnyte-connector-rollout/Project.md` (no Status):

```
before:  SpaceNavButtons → ProjectNavButtons → ProjectMeetingsPanel → ProjectWorkstreamManager
after:   SpaceNavButtons → ProjectNavButtons → ProjectActivityPanel → ProjectOpenTasks → ProjectMeetingsPanel → ProjectWorkstreamManager
```

`headspace-sauce/spice/projects/claude-cowork/Project.md` (sparse — Meetings only):

```
before:  ProjectMeetingsPanel
after:   ProjectActivityPanel → ProjectOpenTasks → ProjectMeetingsPanel
```

### Rollout sequence

1. Land the cycle on workshop `main` (auto-release pipeline ships the `project`
   bump to brew).
2. Per consumer vault (`headspace-sauce`, `accuris-sauce`, `ero-sauce`), run
   `sauce update --bump-pins` → the heal injects the blocks; confirm
   `sauce status` → `Drift: none` and the heal's history summary
   (`healed N; skipped 0`).
3. `Cmd+R` in Obsidian on each vault to load the new CustomJS classes.
4. Spot-check one healed hub per vault (incl. ero's Status-less hub and
   headspace's sparse `claude-cowork` hub) renders both panels in order.
5. Re-run `sauce update --bump-pins` on one vault to confirm the second pass is a
   pure no-op (`skipped N; healed 0`).

## Testing & verification

- **Preflight** (`npm run release:preflight`) must stay green. Register the new
  harness by appending it to the `release:preflight` `&&` chain in `package.json`
  (the chain is the runner; there is no separate coverage-matrix wiring for these
  heal harnesses).
- **New behavioral harness** `platform/test/run-vNNN-project-activity-panels-heal.js`
  (NNN = the cycle's workshop version), modelled on
  `run-v0127-project-hub-heal.js` — zero-dep, in-memory adapter stub, requires
  `applyProjectActivityPanelsHeal` off `module.exports`. Cases (HC-VNNN-PAP-*),
  one per real-world variant found above:
  - **A** — hub with Status + Meetings → both blocks inserted; order
    `Status < Activity < OpenTasks < Meetings < Workstream`.
  - **B** — hub WITHOUT Status but with Nav + Meetings (ero / headspace variant)
    → inserted before Meetings; `Nav < Activity < OpenTasks < Meetings`.
  - **C** — sparse hub whose only block is Meetings (claude-cowork variant) →
    `Activity < OpenTasks < Meetings`.
  - **D** — already-healed hub → second pass is a byte-for-byte no-op +
    `skipped_already_healed` history.
  - **E** — hub with Status but NO Meetings (fallback path) → inserted after the
    Status fence; `Status < Activity < OpenTasks`.
  - **F** — hub with no `dataviewjs` blocks → `no_anchor_found` warning, no write.
  - **G** — `type: project-todo` note under `spice/projects/<x>/` → untouched,
    no per-target history.
  - **H** — empty `spice/projects/` → no throw.
- **Helper unit coverage:** add `ProjectActivityPanel` + `ProjectOpenTasks` to
  the existing helper/render-guard harnesses
  (`run-helper-cases.js` / `run-project-render-guards.js`) so the new classes are
  lint- and cold-load-guarded like their siblings.
- **Empty-state checks:** a fresh project (no docs/meetings/tasks, no board)
  renders neither new panel and shows no placeholder text.
- **Hub strip:** renders ≤4 chips, respects active filters, hidden when the
  filtered set is empty (extend `run-v0127-projects-hub-defaults.js`, which
  already covers hub sort/group defaults).
- **Seed-vault note:** the heal harness is self-contained (inline fixtures), so
  no seed-vault hub edits are required; if `run-seed-migrations.js` is extended,
  follow `Docs/agent-guides/migration-regression-net.md` (per-cycle authoring
  loop, portable-sentinel pattern).
- **Dogfood:** verify rendering in the workshop vault (no project instances, so
  the heal is a no-op there), then the per-vault rollout sequence above.

## Open questions (resolved in design conversation)

- Hub default view → **Recent strip + grouped** (keep status grouping, add the
  recency strip on top). ✓
- Project-page additions → **Recent activity (merged docs+meetings+tasks)** +
  **Open tasks**; pinned links **dropped**. ✓
- Recent docs vs activity → **one merged panel**. ✓
- Open-tasks source → **Kanban board** (To-Do swap deferred). ✓
- Migration anchor → **insert before the `ProjectMeetingsPanel` block** (the only
  block universal across all 26 live hubs), with a fallback chain for
  Status-less / sparse notes; heal runs immediately after the meetings-panel
  heal. ✓ (decided after inspecting accuris / ero / headspace on 2026-06-26)
