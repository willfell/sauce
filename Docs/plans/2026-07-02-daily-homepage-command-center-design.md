# Daily homepage — command-center header + quick-capture

- **Date:** 2026-07-02
- **Status:** Design approved (brainstorm), pending spec review → plan
- **Blueprint/mechanism:** `daily` blueprint (`SpaceDailyDashboard`), new sibling `SpaceDailyHeader`
- **Branch/worktree:** `feature/daily-homepage-command-center` @ `.worktrees/daily-homepage-command-center`

## Context

The vault's homepage (via the Homepage community plugin) opens today's daily note in Reading view. That note renders `SpaceNavButtons` → `---` → `SpaceDailyDashboard` (three panels: Tasks, Meetings, Activity) → `---` → free-write.

The dashboard is already a strong "today" surface, but the page opens straight into the Tasks panel — you have to *read* the panels to know how your day looks, and there is no way to capture a thought without navigating away. The goal is to add a **command-center orientation layer** on top without removing any current daily functionality.

The Homepage plugin is a container/launcher, not a widget engine: everything visible on the homepage is rendered by the daily note's CustomJS surfaces. So this work is entirely within `SpaceDailyDashboard` + a new sibling render module — no Homepage-plugin config change.

## Goals

1. **At-a-glance header** at the very top of the dashboard: a time-aware greeting + the note's date + a rolled-up, cross-panel count line. Turns *scanning* into *glancing*.
2. **Quick-capture**: an always-visible jot box that creates a task-note scheduled for today (reusing `TaskEntity`), which appears in the Tasks panel instantly. The command-center "do, not just view" piece.
3. Keep the three existing panels (Tasks, Meetings, Activity) **exactly as-is**.
4. Ship on **every** daily note the moment it lands — no template change, no migration heal.

## Non-goals (explicit YAGNI)

- **No weather.** (Considered and cut — no network dependency.)
- **No greeting name.** Greeting is nameless: `Good morning · <date>`. No owner/display-name config field.
- **No finance snapshot, no project-health strip, no this-week horizon.** These were considered as portal expansions and deferred; the homepage stays a sharp today-command-center, not a portal-of-everything.
- No changes to `SpaceNavButtons`, the free-write region, or the daily template body.

## Design

### Architecture

**New module:** `ranch/scripts/daily/space-daily-header.js` → class `SpaceDailyHeader`, a sibling of `space-daily-dashboard.js` (CustomJS auto-loads it from the same folder). It is a **pure render module** — it owns no Dataview queries. Interface:

- `SpaceDailyHeader.greeting(hour)` → `"Good morning" | "Good afternoon" | "Good evening"`. Pure; takes the hour as an argument (testable). Bands: `hour < 12` → morning; `12–16` → afternoon; `hour >= 17` → evening.
- `SpaceDailyHeader.render({ dv, page, counts, onCapture })` → builds the header DOM (three rows: orientation, roll-up, capture) into `dv.container`. `onCapture(text)` is an async callback supplied by the dashboard that performs the task-note write + re-render.

**Orchestration change in `SpaceDailyDashboard.render`:** hoist the count computation so it runs **once**, then feed both the header and the panels:

```
render():
  const counts = computeCounts()      // selectTasks() + meetings scan — computed ONCE
  SpaceDailyHeader.render({ counts, onCapture })   // NEW — renders first, on top
  renderTasksPanel(counts.tasks)       // reuses the same data (no re-query)
  renderMeetingsPanel(counts.meetings)
  renderActivityPanel()
```

`computeCounts()` returns `{ tasks: { open: [...today], overdueCount, doneCount }, meetings: { count } }` — reusing the existing `SpaceDailyDashboard.selectTasks()` and the existing meetings scan. No new queries are introduced; the header is free data.

This also starts relieving the 1,289-line `space-daily-dashboard.js` by extracting the header render into its own focused module.

### Component boundaries

| Unit | What it does | Interface | Depends on |
| --- | --- | --- | --- |
| `SpaceDailyHeader.greeting(hour)` | Maps an hour to a greeting string | `(number) → string` | nothing (pure) |
| `SpaceDailyHeader.render(ctx)` | Renders the 3-row header DOM | `({dv, page, counts, onCapture}) → void` | DOM only; `page.day_label`; pill CSS classes |
| `SpaceDailyDashboard.computeCounts()` | Single source of counts for header + panels | `() → {tasks, meetings}` | `selectTasks`, `TaskEntity.queryToday`, meetings scan |
| `SpaceDailyDashboard` capture handler | Writes a task-note, re-renders Tasks panel + roll-up | `(text) → Promise<void>` | `TaskEntity` create path |

### The header UI (three stacked rows, full-width, mobile-first)

1. **Orientation:** `Good morning · Wednesday, July 2, 2026`. Greeting from `greeting(new Date().getHours())` (display-only wall-clock read — not date math, so it does not conflict with the deterministic `_humanDate` Hinnant rule). Date is read verbatim from the note's existing `day_label` frontmatter — no computation.
2. **Roll-up chips** that *span* the panels (not a repeat of the Tasks-panel pills): `3 tasks today · 1 overdue · 2 meetings · 5 done`. Reuses existing pill styling for cohesion; overdue stays red via `.sauce-section-overdue-pill`. **Any zero count is hidden** (same rule the panel pills follow). If nothing is scheduled today, the row shows a friendly `Clear day — nothing scheduled` instead of a line of zeros.
3. **Quick-capture:** a full-width text input + an "Add" button (button matters for thumbs on mobile; Enter also submits).

### Quick-capture behavior

On submit (Enter or Add), with non-empty trimmed text:

1. Call the **existing `TaskEntity` create path** directly (the same one `TaskDialog` uses) — **not** the dialog. Seeds a well-formed task-note: `type: task`, `status: open`, `scheduled: <today>`, `source: daily`, `links: []`. Title = the trimmed text. Filename dedup is already handled by `TaskEntity`.
2. Writes **exactly one file** into `spice/tasks/` → respects the note-per-task invariant, structurally immune to the mobile whole-note wipe.
3. **Instant feedback:** re-run `selectTasks`, then re-render the Tasks panel + the header roll-up count in place. Single source of truth (re-query) — the new task appears and the "N today" chip ticks up. Clear the input, leave it ready for the next jot.

**Deliberate mobile behaviors:**
- **No autofocus** — the homepage opens on every launch; autofocus would pop the keyboard each time. Capture is tap-to-start (matches the CREATE-only-autofocus rule from the dialog work).
- Empty/whitespace input → no-op (no blank tasks).

### Final layout

```
SpaceNavButtons
---
[ SpaceDailyDashboard ]
    Header:  greeting · date
             roll-up chips (tasks · overdue · meetings · done)
             quick-capture box
    Tasks panel      (unchanged)
    Meetings panel   (unchanged)
    Activity panel   (unchanged)
---
free-write (unchanged)
```

## Testing

Following existing harness patterns (SELTASK-1 / RIL-2 DOM-stub tests, `run-task-entity`, seed-vault regression):

1. **`greeting(hour)`** — pure table test across band boundaries (`11→morning`, `12→afternoon`, `16→afternoon`, `17→evening`, `0/23` edges).
2. **Header render** — DOM-stub test: feed representative `counts`, assert the correct chips render, zero counts are hidden, and the `Clear day` empty state fires when everything is zero.
3. **Quick-capture** — Node test running the **real** `TaskEntity` create path against a `dv`/`app` stub, asserting the written note's frontmatter (`type: task`, `status: open`, `scheduled == today`, `source: daily`). Proves capture yields a queryable task, not a hand-built replica.
4. **Count roll-up** — assert `computeCounts()` aggregates today's tasks + overdue + done + meeting count correctly (extends the SELTASK-1 fixtures).
5. **Seed-vault regression** — confirm the daily seed note renders the header section (portable sentinel if one is needed).

## Edge cases

- **Empty day** → `Clear day — nothing scheduled` (no zero chips).
- **Cold cache / Dataview Luxon dates** → counts route through the same `selectTasks`/`TaskEntity` coercion already in place; header adds no new date parsing.
- **Whitespace-only jot** → ignored.
- **Filename collision on capture** → handled by existing `TaskEntity` dedup.
- **Historical daily notes** → header renders on them too (live dashboard re-render), showing that day's counts; capture always targets *today* (not the note's date) — acceptable for v1; a future refinement could target the note's `day`.

## Out of scope / future

- Weather row (wttr.in or OpenWeather in a dataviewjs block).
- Reusing `SpaceDailyHeader` on weekly/monthly hubs (the module is written pure enough to allow it later).
- Portal signals: finance envelope snapshot, project-health strip, this-week horizon.
- Homepage "run command on open" chaining to auto-refresh data on launch.
