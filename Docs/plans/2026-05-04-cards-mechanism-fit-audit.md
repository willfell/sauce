---
date: 2026-05-04
phase: audit
status: closed
target_cycle: v0.11.0
audit_subject: cards-mechanism-fit
related:
  - 2026-05-04-v0.11.0-cards-mechanism-design.md
  - 2026-05-04-v0.11.0-cards-mechanism-result.md
---

# v0.11.0 Cards Mechanism Fit Audit

> [!abstract] Goal
> Audit pre-existing card-style classes against the new shared `BeaconCards` API to size v0.5.x.y migration cycles. v0.11.0 shipped `cards@0.1.1` and dogfooded it via the project blueprint; this doc grades fit for the two remaining card-rendering classes (`MeetingsHubCards`, `SpaceDailyDashboard`) so the next implementer can pick the right mechanic-vs-extension shape.

---

## BeaconCards API recap (v0.1.1)

Source: `platform/mechanisms/cards/beacon-cards.js` (197 LOC).

| Option | Type | Default | Purpose |
|---|---|---|---|
| `pages` | array | required | Dataview pages or hand-rolled objects |
| `title` | `(p) => string` | `p.file.name` | Plain-text card title |
| `subtitle` | `(p) => string\|null` | `null` | Secondary line under title |
| `icon` | `(p) => svg-html` | `""` | Inline SVG left of title |
| `meta` | `(p) => html` | `""` | Right-side row content (layout=row only) |
| `badges` | `(p) => [{label,tone}]` | `[]` | Tones: accent / warn / error / muted |
| `progress` | `(p) => {done,total}` | `null` | Renders bar + count |
| `target` | `(p) => path` | `p.file.path` | Click destination |
| `sort` | `(a,b) => n` | mtime desc | Pre-render sort |
| `group` | `(p) => string` | `null` | Heading-grouped sections |
| `empty` | string | `"Nothing here yet."` | Empty-state copy |
| `columns` | number / `"auto"` | `"auto"` | Grid columns; mobile collapses to 1 |
| `layout` | `"stacked"\|"row"` | `"stacked"` | Row puts meta right of title |
| `onClick` | `(p,ev) => void` | open link | Custom click handler |

Mobile-aware (`app.isMobile`), sets hover transforms, escapes title, group-headings rendered inline.

---

## Subject 1: MeetingsHubCards

> [!info]- File + identity
> - Class: `MeetingsHubCards`
> - Path: `platform/blueprints/meetings/helpers/meetings-hub-cards.js`
> - LOC: 159

**Current behavior.** Queries `"beacon/meetings/notes"`, filters by current-hub date suffix, sorts by `p.date`'s HH:mm. For each meeting it reads file content via `app.vault.read`, parses `## Attendees` wikilinks + open/done task counts (`- [ ]` / `- [x]` regex) + `## Notes` non-empty check, then renders a stacked card with title + time (top-right), attendees row, summary line, and three optional badges (Notes / N open / N done).

**Card data shape.**

| Field | Source | Maps to BeaconCards |
|---|---|---|
| title | `p.file.name` minus `-YYYY-MM-DD` | `title` |
| time (top-right) | `p.date` HH:mm formatted | `meta` (with `layout: "row"`) |
| attendees row | regex over `## Attendees` | `subtitle` (joined text) |
| summary (italic) | `p.summary` truncated 80 | `subtitle` (concat) OR custom |
| badges (Notes / open / done) | content regex counts | `badges` (3 chips) |

**BeaconCards API mapping.**

- `pages` — `dv.pages('"beacon/meetings/notes"').where(...)` array.
- `layout: "row"`, `columns: 1` — single-column with right-aligned time.
- `title: p => p.file.name.replace(/-\d{4}-\d{2}-\d{2}$/, "")`.
- `meta: p => clockSvg + formattedTime` — right side of row.
- `subtitle: p => attendeesString || summary` (or two-line via combined text).
- `badges: p => [hasNotes && {label:"Notes",tone:"accent"}, openTasks && {label:`${openTasks} open`,tone:"error"}, doneTasks && {label:`${doneTasks} done`,tone:"accent"}].filter(Boolean)`.
- `target: p => p.file.path` (default behavior already correct).
- `empty: "No meetings scheduled for today"`.

> [!warning]- API gaps
> 1. **Async per-card data fetch.** Current class does `await app.vault.read(file)` inside the loop and parses content for attendees / task counts / notes presence. BeaconCards' getter functions are sync — the caller must pre-fetch async data into a normalized object array before invoking `render`. Workaround: build a `Promise.all`-resolved array of `{file, attendees, openTasks, doneTasks, hasNotes, summary, time}` objects, pass that as `pages`, and have all getters read synthetic fields.
> 2. **Two-line subtitle (attendees + summary).** Current class renders attendees and summary on separate rows. BeaconCards' `subtitle` is a single string. Workarounds: concat with separator (`attendees · summary`); accept a small visual regression; or extend the API later. Not a blocker.
> 3. **Multi-icon badges (each badge has its own SVG).** BeaconCards badges are plain-text labels with tone-based color only. Acceptable visual regression for v0.5.x.y (text labels still distinguishable); a future `badges[].icon` extension is non-blocking.

**Migration LOC estimate.** 159 LOC → ~70 LOC (data prep + thin BeaconCards call). ~55% reduction.

> [!success] Verdict — `READY`
> Pre-fetch wrapper pattern is the standard adapter shape for content-derived fields; no API extension required. Visual regressions (single-line subtitle, text-only badges) are acceptable for the consistency win.

---

## Subject 2: SpaceDailyDashboard

> [!info]- File + identity
> - Class: `SpaceDailyDashboard`
> - Path: `platform/blueprints/daily/helpers/space-daily-dashboard.js`
> - LOC: 127

**Current behavior.** Multi-panel container (rounded card with two sections inside): a meetings panel (bulleted `<ul>` of links + summary spans) and a tasks panel (bulleted `<ul>` of un-completed task texts from to-do pages). Both are flat text lists, NOT card grids. Container short-circuits if both panels are empty (`!hasContent` early return). Has a double-execution guard (`querySelector(".space-daily-dashboard")` + `.remove()`).

This class is a **panel host**, not a cards renderer. Each panel's items are bare `<li>` rows, not interactive card tiles. Migration to BeaconCards would change the visual shape from "compact list inside a hero panel" to "card grid" — a deliberate redesign decision, not a drop-in swap.

### Sub-subject 2a: Tasks panel

**Card data shape (if migrated).**

| Field | Source | Maps to BeaconCards |
|---|---|---|
| title | `task.text` | `title` |
| target | parent page path | `target` (or open-line via `onClick`) |

> [!warning]- API gaps
> 1. **Tasks are not file-pages.** They're `page.file.tasks.where(t => !t.completed)` items — line-anchored within a parent file. BeaconCards assumes page-shaped objects with `file.path`. Workaround: pass synthetic `{file: {name, path}, line, text}` shaped objects and use a custom `onClick` to call `app.workspace.openLinkText(path + "#L" + line, "")` (or similar). Not blocking, but worth codifying as a "synthetic page" pattern in the cards mechanism docs.
> 2. **Bulleted `<ul>` is intentionally compact.** Card grid for tasks would be visually heavier than the current at-a-glance list. Migration may be a regression unless we deliberately reshape the daily dashboard around cards.

### Sub-subject 2b: Meetings panel

**Card data shape (if migrated).** Title = filename minus date prefix; subtitle = `meeting.summary`; target = `meeting.path`. Trivial fit — meetings are real pages.

But: this overlaps with `MeetingsHubCards` (Subject 1), which already renders today's meetings as cards in the meetings hub. The daily dashboard's meetings panel is a *thumbnail of the same data*. Migration choice: (a) keep both, with daily as compact list and hub as cards (current shape); (b) make daily reference the hub via embed/link only; (c) replace daily's panel with BeaconCards too.

### Sub-subject 2c: Container/panel-host wrapper

The outer rounded container + per-section headers (`Today's Meetings`, `Today's Tasks` with calendar/check-square SVG icons) is **not** a BeaconCards concern — it's host chrome that wraps panels. BeaconCards renders into `dv.container`, not into a sub-element with sibling sections. Migration would either keep the wrapper around two BeaconCards `render` calls (each into a sub-container) or rebuild as one BeaconCards call with `group` headings ("Today's Meetings" / "Today's Tasks") — but the latter forces meetings-as-pages and tasks-as-synthetic-pages into the same render, which is awkward.

**Migration LOC estimate.** 127 LOC → ~80 LOC if wrapper kept and each panel becomes a BeaconCards call. Smaller savings than Subject 1; the win is consistency, not LOC.

> [!warning] Verdict — `EXTEND` (mild)
> Tasks panel needs a documented "synthetic page" pattern (line-anchored objects with custom `onClick`); tasks-as-pages isn't currently codified as supported usage in BeaconCards' jsdoc. Non-blocking — the API already supports it via `onClick` + arbitrary `pages` shape — but the cards mechanism's docstring should explicitly call out the synthetic-page pattern before the migration lands. Meetings panel alone is `READY`.

---

## Verdicts summary

| Subject | Verdict | Migration cycle target |
|---|:---:|---|
| MeetingsHubCards | `READY` | v0.5.x.y |
| SpaceDailyDashboard tasks panel | `EXTEND` (doc-only — synthetic-page pattern) | v0.5.x.y |
| SpaceDailyDashboard meetings panel | `READY` | v0.5.x.y |
| SpaceDailyDashboard container/panel wrapper | n/a (out of scope for cards mechanism) | — |

---

## Migration sequencing recommendation

Migrations land in v0.5.x.y cycles BEFORE any v0.6.0 next-blueprint cycle starts.

- **v0.5.x.y-1 (READY, pure-additive):** Migrate `MeetingsHubCards` to call `BeaconCards.render` with the pre-fetch async adapter pattern. No cards mechanism bump required. Bump meetings blueprint MINOR (e.g., `meetings@0.2.0`); workshop_version PATCH bump. Accept visual regressions (single-line subtitle merging attendees+summary; tone-only badges without per-badge icons). Smoke: today's meetings render at expected count with time on right, badges intact, click opens the meeting note.
- **v0.5.x.y-2 (EXTEND, docs-only mechanic):** First commit — bump `cards@0.1.1 → 0.2.0` MINOR with a docstring extension codifying the "synthetic page" pattern (line-anchored task objects + custom `onClick`); no code changes to `beacon-cards.js`. Second commit — migrate `SpaceDailyDashboard`'s two panels to two BeaconCards calls inside the existing wrapper container, keeping the panel-host chrome and double-execution guard. Bump daily blueprint MINOR (e.g., `daily@0.2.0`). Smoke: meetings panel + tasks panel both render; empty-content short-circuit still works; click on task opens parent file (line-anchor optional for v1).
- **No `BLOCKED` items.** No design pass needed.

The two sequential sub-cycles are deliberately small and additive; neither requires bumping the cards mechanism for code (only the docstring bump in -2). After both close, every card-style surface in the workshop renders through the same mechanism — exit criterion for the consolidation thread.
