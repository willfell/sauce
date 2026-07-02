# Nav launcher — collapse blueprint nav into a "Go to…" menu

**Date:** 2026-07-01
**Mechanism:** `nav-buttons` (currently 2.8.0)
**Branch:** `feat/nav-launcher`
**Status:** Design approved (brainstorm), pre-implementation

## Problem

`SpaceNavButtons` renders global chrome embedded in **36 templates** (every daily
note, meeting, project, wiki, docs hub, etc.). On mobile it force-splits all
blueprint buttons into **3 equal rows**, and every button is `flex: 1`. With
12–14 blueprints installed (headspace has 12), each button collapses to ~70px and
the label truncates to 2–3 characters (`Da…`, `Co…`, `Pe…`, `Bo…`). The result:

- An icon + a 2-char stub is **unreadable** — the nav no longer communicates.
- The grid eats **~⅓ of the vertical space of every note** on a phone.
- Even on desktop (where it isn't truncated) 12–14 always-on buttons are a lot of
  surface to scan to "find what you want."

Two problems are stacked: **too much is shown at once**, and **what's shown is
rendered badly** (forced equal-width stretch → truncation).

## Decision

Replace the always-visible multi-row button grid with a **single "Go to…"
launcher** that is **collapsed by default on every platform**. Tapping it opens
a **native Obsidian `Menu`** listing all blueprints with full icon + label.

Decisions locked during brainstorm:

1. **Hidden by default everywhere** (not always-visible) — one consistent behavior,
   maximum screen reclaimed, one tap to navigate anywhere.
2. **Native Obsidian `Menu`** as the reveal mechanism — automatic bottom-sheet on
   mobile, dropdown on desktop, native dismiss, near-zero custom CSS risk.
3. **Merge the launcher pill into the existing daily-arrow row** — all chrome on
   one line.

## Design

### Layout: 4 rows → 1 line

The multi-row grid is removed. In its place a compact **"Go to…" pill** sits
**centered in the existing daily prev/next arrow row**:

```
BEFORE (mobile, ~4 rows, truncated):        AFTER (1 line):
‹ Tue, Jun 30              — ›               ‹ Tue Jun 30   ⊞ Go to…   Jul 2 ›
┌────┐┌────┐┌────┐┌────┐                     [ note content starts here ]
│▣Da…││▤Co…││▨Pe…││▦Bo…│
└────┘└────┘└────┘└────┘
┌────┐┌────┐┌────┐┌────┐  (+2 more rows)
```

- When the daily blueprint is **not** installed (no arrows), the pill centers on
  its own thin row.
- **Auto-degrade:** the chrome row uses `flex-wrap`; on the narrowest screens the
  pill drops to its own line rather than colliding with the date labels.
- The daily prev/next arrow logic is **unchanged** — only the button grid below
  it is replaced.

### Reveal: native `Menu`

Tapping "Go to…" builds and shows a `new Menu()`:

```
 MOBILE (bottom sheet):              DESKTOP (dropdown at button):
 ╭──────────────────────╮           ⊞ Go to… ▾
 │ ▣  Daily             │           ╭──────────────╮
 │ ☑  To Do             │           │ ▣ Daily      │
 │ ▨  Meetings          │           │ ☑ To Do      │
 │ ▣  Projects          │           │ ▨ Meetings   │
 │ ▤  Cowork            │           │ … full list  │
 │ … full list …        │           ╰──────────────╯
 ╰──────────────────────╯
```

- Items are built from the **same registry entries**, in the **same sort order**
  (`order → source → id`) used today.
- Each `menu.addItem` gets **icon + full label** (a menu row is as wide as needed,
  so truncation is structurally impossible).
- `onClick` calls the **existing `_dispatchAction(btn, dv)` unchanged** — so
  `openLink`, `createFromTemplate`, `runTemplaterTemplate`, and `invoke_command`
  all keep working exactly as they do now (read-mode forcing included).
- Menu closes itself on selection; nav always starts collapsed (no persisted
  open state).

### Icon strategy inside the menu

Obsidian's `MenuItem.setIcon()` expects a registered (Lucide) icon id, but nav
icons come from the vendored `icons` mechanism (custom SVG). Resolution order per
item:

1. If the nav icon key maps to a known Lucide id → `item.setIcon(lucideId)`.
2. Else inject the vendored SVG (`customJS.Icons.resolve(key)`) into the item's
   DOM node (`item.iconEl` / `item.dom` query).
3. Else no icon (label only). Never throw.

The pill itself needs a launcher glyph (`grid` / `layout-grid` / `menu`). If that
key is absent from the `icons` vocabulary, add it as an **additive** `icons` bump.

## Scope

- **Only file changed:** `platform/mechanisms/nav-buttons/space-nav-buttons.js` —
  replace the multi-row flex-grid block in `render()` (roughly lines 181–246) with
  the launcher pill + a `_buildMenu(entries, dv)` helper. Everything above (registry
  read, flatten/sort, daily-arrow row) stays.
- **Possibly** one additive icon in the `icons` mechanism (launcher glyph).
- **Untouched:** the registry format/schema, the action schema, installer
  aggregation, and all **14 blueprints' `nav_buttons[]` declarations**. No consumer
  changes — this is a pure renderer swap. That is the primary source of low risk.
- **Versioning:** this is a `feat` → the release pipeline computes the semver bump.
  Do **not** hand-version, tag, or edit manifests (per CLAUDE.md release policy).

## Edge cases & the one real technical risk

- **Empty registry / not installed** → render nothing (unchanged behavior).
- **`Menu` constructor reachability (the risk to verify first):** must confirm the
  `Menu` class is obtainable inside the eval'd CustomJS context — likely via
  `require('obsidian').Menu` or a global. **If it is not reachable**, fall back to
  an **inline accordion panel** (custom DOM list that expands below the pill and
  re-collapses on selection). Same launcher UX, same one-line default; only the
  reveal container differs. Either way the collapse-by-default win holds. This
  fallback must be decided in the first implementation task via a spike.
- **Cold-load / customjs-guard safety:** all `customJS.*` calls stay
  optional-chained; the file stays a **bare single class expression** with **no
  trailing statements** (CJS-LOAD preflight — landmine: trailing `if`/`module.exports`
  breaks `eval("(" + file + ")")`).
- **Dataview double-execution:** keep the existing `.vault-nav` removal guard so a
  re-render doesn't stack two launchers.

## Testing

- **Node-testable (add):** given a registry fixture, the ordered entry list feeding
  the menu is correct (label / icon key / action per entry). Extract the class via
  the `new Function(src + "\nreturn SpaceNavButtons;")` pattern (statics only; no
  DOM). The existing flatten/sort is already covered by `run-registry.js`.
- **Preflight:** `run-customjs-loadable.js` (CJS-LOAD + CJS-REF) and
  `lint-cold-load.js` must stay green.
- **Dogfood (browser-only):** Playwright against a live vault at 360/390px —
  confirm the one-line chrome row, the pill opens the native bottom sheet on
  mobile emulation, items navigate/create correctly, and the sheet dismisses.
  (Same verification pattern as the task-entity cycles.)

## Out of scope (YAGNI)

- Type-to-filter / search palette (considered; native menu of ≤14 items scans fast).
- Pinning / most-recently-used ordering.
- Grouping separators inside the menu (could add later via `menu.addSeparator()`
  if the list grows; not needed at current counts).
- Any change to desktop's always-on posture beyond adopting the same launcher.
