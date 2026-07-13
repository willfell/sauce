# Project Dashboard refinement — design

**Date:** 2026-07-13
**Status:** Approved (design), pre-implementation
**Blueprint touched:** project (helper `project-dashboard.js` + install heal)
**Builds on:** the shipped `ProjectDashboard` (v0.221.x, PR #455). This is a
follow-up refinement, not a new build.

## Problem

The shipped `ProjectDashboard` works but has five rough edges the user hit in
daily use:

1. **Docs tile navigates to the wrong note.** Clicking Docs opens
   `spice/projects/<slug>/Docs.md` — a non-existent path. The real Docs hub is
   `spice/projects/<slug>/docs/Docs.md`.
2. **Map tile navigates to the wrong note.** Clicking Map opens
   `spice/projects/<slug>/Map.md`. The real map note is the scanned
   `*- Map` / `Project Map` note.
3. **Only five tiles.** No one-click route to the project's Links Hub.
4. **Grid + background feel off.** Tiles use a ragged `flex:1 0 30%` wrap that
   doesn't fill the row evenly; the card's `--background-secondary` fill reads
   as a heavy gray slab against the note.
5. **Legacy panels linger in existing note bodies.** Some project notes still
   carry `ProjectActivityPanel` / `ProjectMeetingsPanel` dataviewjs blocks that
   the v0.221 heal skipped (its idempotency guard skips any note already
   containing a `ProjectDashboard` block, so a *partially* migrated note keeps
   its stale panels forever).

Separately, the compact card subsumed the old Open-Tasks list and per-section
activity into a single flat top-5 "Recent". The user wants that detail back —
an **Open Tasks** list and **per-section grouped Recent activity**, rendered as
their own "fancy" cards with canonical `SectionLabel` headings below the tile
grid.

## Goals

- Docs / Map / Board / To-Do / Links tiles navigate to exactly where the
  ChromeBar `Go ▾` launcher goes — by delegating to
  `ProjectChromeBar.navTarget`, so the dashboard can never drift out of sync
  again.
- A 6th "Helpful Links" tile → the project's Links Hub.
- Six tiles fill an even, centered **3×2 grid** (stable on desktop + 390px
  mobile).
- The card reads as a subtle inset (transparent + hairline border), tiles
  gently raised (`--background-secondary`).
- The v0.221 heal is hardened to sweep lingering `ProjectActivityPanel` /
  `ProjectMeetingsPanel` blocks even from notes that already have a
  `ProjectDashboard` block; re-deployed so all three consumer vaults get swept.
- Below the grid: an **Open Tasks** card + three grouped **Recent** cards
  (Docs / Meetings / Tasks), each capped and empty-hiding, each headed by a
  `SectionLabel`.

## Non-goals

- No change to `ProjectChromeBar`, `MenuPopover`, `RenderSafe`, `SectionLabel`,
  or the `Go ▾` launcher.
- No change to any other project surface (Docs hub, Section hub, Board, Map,
  Task note, Links Hub, To-Do note).
- **`ProjectLinksPanel` is NOT removed** — it is the engine of the standalone
  Links Hub note (`Links Hub.md`), which the user did not ask to retire. Only
  `ProjectActivityPanel` / `ProjectMeetingsPanel` blocks are swept from project
  *atlas* note bodies.
- No manifest `version` edit — the release pipeline computes semver from
  conventional commits. No new customJS class (all work lives on the existing
  `ProjectDashboard`), so `customjs_classes` is unchanged too.
- No new mechanism, no new icons (reuse `ProjectDashboard.ICON`, which already
  carries `links`).

## Design

All work is on `platform/blueprints/project/helpers/project-dashboard.js` plus
the heal in `platform/install.js`, the harness
`platform/test/run-project-dashboard.js`, and a Playwright visual harness. The
template `Template, Project.md` and `manifest.json` are untouched.

### 1. Tile targets via `ProjectChromeBar.navTarget` (fixes bugs 1 & 2)

In `render()`, after computing `currentPath`, resolve a ChromeBar context once:

```javascript
let bar = null, barCtx = null;
try {
  bar = (typeof customJS !== "undefined") ? customJS.ProjectChromeBar : null;
  if (bar && bar.detectContext) barCtx = bar.detectContext(currentPath, dv);
} catch (_e) {}
```

Pass `{ bar, barCtx }` into `ctx`. In `_renderTiles`, resolve each tile target
through `bar.navTarget(dv, barCtx, key)` with a hardcoded fallback if it returns
null (cold index / missing note) so the tile stays clickable:

| Tile | navTarget key | Fallback |
| --- | --- | --- |
| Docs | `docs` | `${folder}/docs/Docs.md` |
| Board | `board` | `${folder}/${slug}-board.md` |
| To-Do | `todo` | `${folder}/${projectName} To-Do.md` |
| Map | `map` | `${folder}/Project Map.md` |
| Helpful Links | `links` | `${folder}/Links Hub.md` |
| Meetings | — (vault hub) | `spice/meetings/Meetings.md` (unchanged, no navTarget key) |

Resolution helper on the class:

```javascript
_tileTarget(dv, ctx, key, fallback) {
  try {
    if (ctx.bar && ctx.barCtx && ctx.bar.navTarget) {
      const t = ctx.bar.navTarget(dv, ctx.barCtx, key);
      if (t) return t;
    }
  } catch (_e) {}
  return fallback;
}
```

### 2. Six-tile centered grid (bug 3 + 4)

`_renderTiles` container becomes a fixed 3-column grid — six tiles always lay
out 3×2, evenly filling the row on desktop and staying legible at 390px:

```
display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px;
```

Add the 6th tile `{ key:"links", label:"Helpful Links", icon:ICON.links }`
after Meetings. Tile interior (icon + uppercase label + count chip) is
unchanged for the five metric tiles (Docs / Board / To-Do / Map / Meetings) —
count chip grayed at 0, accent when >0. The **Links tile renders no count chip**
(a Links Hub has no natural "open" count); it shows icon + label only, so it
reads as a pure nav target rather than a metric.

Each tile keeps `min-width:0` (grid cell owns width) — drop the old
`flex:1 0 30%; max-width:180px`.

### 3. Subtle background (bug 4)

- Card root: `background:transparent; border:1px solid
  var(--background-modifier-border); border-radius:10px; padding:12px;
  max-width:720px; margin:4px 0;` (was `--background-secondary` fill).
- Tiles: `background:var(--background-secondary)` (was `--background-primary`)
  so they read as gently raised against the now-flat card; keep their
  `1px solid var(--background-modifier-border)` + hover
  `--background-modifier-hover`.

Net effect: a subtle inset card with softly-raised tiles, instead of a gray
slab with flush tiles.

### 4. Open Tasks card (below the grid)

New `_openTasks(ctx)` (async) gathers open work as `{ title, path, source }`:

- **Board** — read `${folder}/${slug}-board.md`; each `- [ ] <title>` outside
  the `## Completed` lane → `{ title, path:boardPath, source:"board" }`.
- **To-Do** — read `${folder}/${projectName} To-Do.md`; each `- [ ] <title>` →
  `{ title, path:todoPath, source:"todo" }`.

Merge, **cap 6**. New `_renderOpenTasks(container, ctx, tasks)`:

- If empty → render nothing (no label, no card).
- Else: `SectionLabel.render({ container }, { text:"Open Tasks" })` then a
  "fancy" card: `background:var(--background-secondary); border:1px solid
  var(--background-modifier-border); border-radius:8px; padding:6px 10px;
  margin-top:6px;`. Each row: checkbox-glyph (todo icon, muted) + title
  (ellipsized) + a muted source tag (`board` / `to-do`). Row click →
  `openLinkText(path, currentPath, false)` (opens the board / To-Do note).

### 5. Grouped Recent cards (below Open Tasks)

Replace the flat `_renderRecent` with `_renderRecentGroups(container, ctx)`.
Three groups, each its own `SectionLabel` + fancy card, each **capped at 4**,
newest-first by `file.mtime.ts`, **empty groups render nothing**:

| Group | SectionLabel | Query |
| --- | --- | --- |
| Docs | `Recent Docs` | `dv.pages(`"${folder}/docs"`).where(type==="doc-note")` |
| Meetings | `Recent Meetings` | `dv.pages('"spice/meetings/notes"').where(type==="meeting" && _projectMatches(...))` |
| Tasks | `Recent Tasks` | `dv.pages(`"${folder}/tasks"`).where(type==="task-note")` |

Card + row style mirror the Open Tasks card: kind icon (muted) + title
(ellipsized) + relative time (`_relTime`, muted, right-aligned). Row click →
`openLinkText(page.file.path, currentPath, false)`.

The existing `_recent` merged-top-5 method and `_renderRecent` are removed
(superseded). The inline **Links chips** stay inside the top card (quick-launch
pinned frontmatter URLs — distinct from the "Helpful Links" nav tile).

### 6. Ordering

```
┌─ top card (transparent, hairline) ─────────────┐
│  status pill                                    │
│  ┌────┬────┬────┐                               │
│  │Docs│Brd │To-Do│   3×2 grid                   │
│  ├────┼────┼────┤                               │
│  │Map │Meet│Links│                              │
│  └────┴────┴────┘                               │
│  LINKS  <chip> <chip>   (inline, if any)        │
└─────────────────────────────────────────────────┘
[SectionLabel "Open Tasks"]      + fancy card   (if any)
[SectionLabel "Recent Docs"]     + fancy card   (if any)
[SectionLabel "Recent Meetings"] + fancy card   (if any)
[SectionLabel "Recent Tasks"]    + fancy card   (if any)
```

All below-grid blocks render into `dv.container` (siblings of the top card),
NOT inside it — the `SectionLabel` hairline provides the separation, per
`note-chrome.md` divider grammar (helper-owned hairline, never literal `---`).

### 7. Heal hardening (bug 5)

`applyProjectDashboardConformanceHeal` in `install.js`: change the idempotency
guard from "body contains `class: "ProjectDashboard"` → skip" to:

- **Skip only if** the body contains a `ProjectDashboard` block AND contains
  **none** of the legacy classes (`ProjectStatusWidget`, `ProjectActivityPanel`,
  `ProjectOpenTasks`, `ProjectMeetingsPanel`, `ProjectLinksPanel`).
- **Else** (legacy blocks present, with or without a ProjectDashboard block):
  strip every legacy dataviewjs block; ensure exactly one `ProjectDashboard`
  block sits immediately after the `ProjectChromeBar` block (do not add a second
  if one already exists — dedupe). `.sauce-backup` snapshot before write.

This makes the heal converge partially-migrated notes, not just fully-legacy
ones. Never throws; per-note try/catch; logs
`N migrated · M skipped · K errored`.

Note: `ProjectLinksPanel` blocks are stripped from **project atlas** notes
(`type: project`) only — the heal already filters on `type === "project"`, so
`Links Hub.md` (`type: links-hub`) is never touched.

## Data / cold-load safety

Every query is try/caught, defaulting to `[]` / 0. `navTarget` and
`detectContext` are called defensively (may be absent in stub/cold environments)
— failure falls back to the hardcoded path table. `SectionLabel` /
`MenuPopover` / `RenderSafe` accessed via `customJS.*` guards.

## Testing

### Behavioral harness — `platform/test/run-project-dashboard.js`

Extend the existing `PROJDASH-*` group. Add stubs for
`customJS.ProjectChromeBar` (`detectContext` returning a fixed ctx;
`navTarget(dv,ctx,key)` returning the canonical path per key) and
`customJS.SectionLabel` (records rendered labels).

- **PROJDASH-10 Docs tile target** — asserts the Docs tile navigates to
  `…/docs/Docs.md` (not `…/Docs.md`).
- **PROJDASH-11 Map tile target** — asserts Map navigates to the navTarget map
  path (stubbed).
- **PROJDASH-12 six tiles** — asserts 6 tiles, labels
  `Docs|Board|To-Do|Map|Meetings|Helpful Links`, and Links tile has no count
  chip.
- **PROJDASH-13 Links tile target** — navigates to `…/Links Hub.md`.
- **PROJDASH-14 navTarget fallback** — with `customJS.ProjectChromeBar` absent,
  Docs tile still navigates to the fallback `…/docs/Docs.md`.
- **PROJDASH-15 open tasks** — fixture board (2 open + 1 in Completed) + To-Do
  (1 open) → 3 rows, capped at 6; Completed item excluded; empty → nothing.
- **PROJDASH-16 grouped recent** — fixture 2 docs / 1 meeting / 0 tasks →
  `Recent Docs` (2 rows) + `Recent Meetings` (1 row) rendered, `Recent Tasks`
  absent (empty-hide); each capped at 4.
- **PROJDASH-9b updated** — top-card tile count 5 → **6**.

### Heal harness — `platform/test/run-project-dashboard-heal.js`

Add a fixture: a note that ALREADY has a `ProjectDashboard` block **and** a
lingering `ProjectMeetingsPanel` block (partial migration). Assert the hardened
heal strips the legacy block, keeps exactly one `ProjectDashboard` block, writes
a `.sauce-backup`, and is idempotent on a second run. Existing fully-legacy +
fully-modern fixtures keep passing.

### Playwright visual harness

Per `lesson_verify_chrome_visually_with_playwright_harness`: faithful HTML
replica with dark-theme CSS vars, served via `python3 -m http.server`,
screenshot at **390px** and **720px**. Assert: 3×2 grid both viewports; card
reads transparent/inset (no gray slab); tiles gently raised; Open Tasks +
grouped Recent cards have visible hairline-bordered "fancy" styling with decent
spacing; SectionLabel hairlines visible on dark theme.

## Rollout

Standard auto-pipeline: feature PR → CI green → merge → bumper opens release PR
(auto-merges) → tap PR (auto-merges) → `brew upgrade sauce` → `sauce update
--force` in accuris / headspace / ero (heal sweeps each vault's project notes)
→ user Cmd+R. No new component → no consumer-subscription change.

## Landmines

- **navTarget needs a real `app`.** `navTarget`'s `exists()` guard and
  `_resolveProjectNotes` touch `app.vault` — in the Node harness `app` is
  stubbed; the fallback path table covers the stub gap. Verify the real Docs/Map
  targets on the dogfood/consumer vault post-deploy (grep the healed body or
  click-test).
- **Do NOT hand-edit manifest `version` or `customjs_classes`.** Pipeline
  bumps; no class added/removed.
- **Heal must keep `type: links-hub` notes untouched** — the `type === "project"`
  filter already guarantees this; do not broaden it.
- **customJS single-expression load.** `project-dashboard.js` must remain one
  bare class expression — no trailing `module.exports`. Enforced by
  `run-customjs-loadable.js`.
- **Autoloop drift.** `git merge origin/main` before pushing the PR.
