# Home command center — glance counts + one-gesture task capture

- **Date:** 2026-07-02
- **Status:** Design approved (brainstorm) → RECONCILED with shipped Home command center
- **Blueprint/mechanism:** `home` blueprint (`SpaceHome`), `daily` blueprint (`SpaceDailyDashboard` static API), `task-entity` mechanism (`TaskDialog`)
- **Branch/worktree:** `feature/daily-homepage-command-center` @ `.worktrees/daily-homepage-command-center`

## Reconciliation note (why this design changed mid-flight)

The original brainstorm assumed the homepage *was* the daily note and proposed a new `SpaceDailyHeader`. While that spec was being written, PRs **#275** (`feat(home): Home command center — Homepage opens a reading-mode Home.md dashboard on startup`) and **#278** (`fix(home): drop hard deps on meetings + scratch`) shipped a real Home command center: `spice/home/Home.md`, rendered by the `SpaceHome` CustomJS class, is now the startup homepage. It already has:

- a **greeting + human date** header (`SpaceHome._greeting(hour)` + `SpaceHome._humanDate`), and
- a **quick-capture band of 4 buttons** — `＋ To-Do` (opens the full `TaskDialog`), `＋ Meeting`, `＋ Scratch`, `Open today's daily` — then the embedded `SpaceDailyDashboard` (via the `asOf: today` DRY seam).

So the two approved improvements already exist, but in the exact forms the user *rejected or wanted improved*:
1. **At-a-glance header** → greeting exists, but there is **no rolled-up counts line** (counts live only in the Tasks-section pills below). ← genuine gap.
2. **Quick-capture** → exists as a **button that opens the full dialog** — i.e. "Approach 3", the button→dialog the user explicitly rejected in favor of one-gesture inline capture. ← needs replacing.

This design therefore **enhances `SpaceHome`** rather than building anything new on the daily note.

## Goals

1. **Glance counts** — add a rolled-up, cross-panel count line to the `SpaceHome` greeting: `N today · M overdue · K meetings · J done`. Zeros hidden; empty day → `Clear day — nothing scheduled`.
2. **One-gesture task capture** — replace the `＋ To-Do` button with an **inline jot input + Add** that creates a task-note scheduled today directly (no modal), which appears in the Tasks panel immediately.
3. Keep `＋ Meeting`, `＋ Scratch`, `Open today's daily`, the greeting, and the embedded dashboard otherwise unchanged.

## Non-goals (explicit YAGNI)

- **No weather.** **No greeting name.** **No finance / project / horizon portal strips.** (All deferred to "future".)
- No template/marker changes, no install heal, no migration — `SpaceHome` renders live on every Home.md open, so enhancing its render ships everywhere instantly.
- No new blueprint or mechanism; no version bumps by hand (the release pipeline owns versions).

## Design

### E1 — Glance counts in the greeting

`SpaceHome.render` already computes `today`. Add, between the greeting date and the capture band, a `.sauce-home-glance` row of count chips.

- **Count source (DRY):** a new static on the daily dashboard, `SpaceDailyDashboard.computeCounts(dv, todayStr, TE)` → `{ today, overdue, done, meetings }` (all integers). It composes the existing `SpaceDailyDashboard.selectTasks` (→ `{ open[], overdue, done }`) with a newly-extracted `SpaceDailyDashboard.selectMeetings(dv, todayStr)` (the render's `getMeetings` closure, hoisted to a reusable static and called by both `render` and `computeCounts`). Cold-load safe (no TE → zeros), never throws.
- **Chip rendering (pure, Node-testable):** `SpaceHome._glanceChips(counts)` → an ordered array of `{ n, label, cls }` (or the empty-state sentinel) describing which chips to show. `render()` derives counts (impure, via `customJS.SpaceDailyDashboard.computeCounts`, guarded like `_dispatch`) then feeds them to `_glanceChips` and builds the DOM. Mirrors the existing pure/impure split (`_greeting` pure; `render` reads the clock).
- **Chip rules:** show a chip only when its count `> 0`. Order: `today` (accent), `overdue` (`sauce-section-overdue-pill`, red), `meetings`, `done` (green). Label pluralization only where it reads wrong: `meeting`/`meetings`. If every count is 0, render one muted `Clear day — nothing scheduled` line instead of chips.

### E2 — Inline one-gesture To-Do capture

Replace the `todo` **button** with an inline capture row at the top of the capture band: a full-width `<input type="text" placeholder="Jot a task…">` + an `Add` button. `＋ Meeting`, `＋ Scratch`, `Open today's daily` remain as buttons below it.

- **`_captureSpec()`** drops `todo` and returns the 3 remaining button specs (`meeting`, `scratch`, `openDaily`), preserving order + `{key,label,icon}` shape.
- **Submit** (Enter in the input, or the Add button) with non-empty trimmed text calls `customJS.TaskDialog.createQuick({ title, today, source: "daily" })` (guarded, no-op on cold load — same pattern as `_dispatch`).
- **`TaskDialog.createQuick({ title, today, source })`** (new **instance** method on `TaskDialog`, so it's reachable as `customJS.TaskDialog.createQuick`): trims `title`; on blank → no-op; else builds the minimal payload `{ title, scheduled: today, source, links: [] }` and reuses the existing `this._create(app, payload, "")` path (which composes via `TaskEntity` — defaulting `type: task`, `status: open` — dedupes the filename, and does exactly one `app.vault.create`). `app` is grabbed from the runtime global (as `_dispatch` grabs `customJS`/`app`).
- **Refresh:** after `createQuick` resolves, re-invoke `this.render(dv, params)`. `render` is idempotent (it removes any prior `.sauce-home` and the dashboard removes its prior `.space-daily-dashboard`), so the new task appears in the Tasks panel and the `today` glance chip ticks up — single source of truth via re-query. The input is rebuilt empty (clears itself).
- **Mobile discipline:** **no autofocus** (home opens on every launch; autofocus would pop the keyboard every time). Empty/whitespace submit → no-op.

### Component boundaries

| Unit | What it does | Interface | Depends on |
| --- | --- | --- | --- |
| `SpaceDailyDashboard.selectMeetings(dv, today)` | Today's meeting notes (filename-includes-today) | `(dv, string) → page[]` | Dataview pages; pure filter |
| `SpaceDailyDashboard.computeCounts(dv, today, TE)` | Count roll-up for the glance line | `(dv, string, TE) → {today,overdue,done,meetings}` | `selectTasks`, `selectMeetings` |
| `SpaceHome._glanceChips(counts)` | Pure chip descriptor list / empty sentinel | `({today,overdue,done,meetings}) → chip[]` | nothing (pure) |
| `SpaceHome.render` | Greeting → glance → capture(input+3 buttons) → dashboard | `(dv, params) → void` | the above + `TaskDialog.createQuick` |
| `TaskDialog.createQuick({title,today,source})` | Direct one-file task create, no modal | `(opts) → Promise<void>` | `this._create` / `TaskEntity` / `app.vault` |

### DOM order (inside `.sauce-home`)

```
greeting (.sauce-home-greeting: line + date)
glance   (.sauce-home-glance: chips OR "Clear day …")
capture  (.sauce-home-capture: [ jot input | Add ] + ＋Meeting + ＋Scratch + Open today's daily)
─ then the SpaceDailyDashboard mount (appended after .sauce-home, unchanged)
```

## Testing (a lot — following existing harness patterns)

**`run-home.js`:**
- **HOME-GLANCE** (new): `_glanceChips` — all-zero → empty sentinel; single non-zero → one chip; full → 4 chips in order with correct labels/classes; zeros hidden; `meeting` vs `meetings` pluralization.
- **HOME-RENDER** (updated): `.sauce-home` child order greeting → glance → capture; capture band holds **1 input + 3 buttons**; dashboard still mounts once with `args:[{asOf:today,live:true}]`.
- **HOME-CAP** (updated): `_captureSpec()` → 3 entries (`meeting`,`scratch`,`openDaily`); dispatch wiring for those 3 unchanged; **new**: firing the inline input submit (Enter + Add button) calls `customJS.TaskDialog.createQuick({title,today,source:"daily"})` with the typed text; blank input → no createQuick; missing `customJS` → no throw (graceful degrade).
- Existing HOME-GREET / HOME-DATE / HOME-HEAL untouched (still green).

**`run-task-entity.js` (or `run-task-interactions.js`):**
- **createQuick**: with a stubbed `app.vault` (spy `create`, `getAbstractFileByPath`, `createFolder`) + stubbed `customJS.TaskEntity`, `createQuick({title:"call dentist", today:"2026-07-02", source:"daily"})` → exactly one `vault.create` at `spice/tasks/call dentist.md` whose content carries `type: task`, `status: open`, `scheduled: 2026-07-02`, `source: daily`. Blank title → zero creates. Colliding filename → deduped (` 2`).

**`run-helper-cases.js` (daily dashboard area):**
- **computeCounts**: dv-stub + stub TE → returns `{today,overdue,done,meetings}` matching the stub data; cold load (no TE) → tasks zeroed, meetings still counted; never throws.
- **selectMeetings**: filters meeting pages by filename-includes-today (both leading- and trailing-date conventions).
- Re-route (do not preserve) any source-text assertion that keyed on the old `getMeetings` closure body.

**Whole suite:** `npm run release:preflight` green (macos+ubuntu in CI); workshop dogfood green; `npm run release:preflight-bumped` green on a clean tree before merge.

## Edge cases

- **Empty day** → `Clear day — nothing scheduled` (no zero chips).
- **Cold load / not-yet-registered mechanisms** → counts route through `selectTasks`/`selectMeetings` guards (zeros), capture no-ops; render never throws.
- **Dataview Luxon dates** → counts reuse the dashboard's existing `_toDateStr`/`queryToday` coercion; no new date parsing.
- **Whitespace-only jot** → ignored. **Filename collision** → existing `_uniqueName` dedupe.
- **Re-render churn** → `render()` is idempotent; capture re-render can't stack duplicate `.sauce-home` / dashboard nodes.

## Out of scope / future

- Weather row; reusing the glance line on weekly/monthly hubs; finance/project/horizon portal strips; Homepage "run command on open" auto-refresh chaining.
