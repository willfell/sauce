# Home fixes + nav — design

Date: 2026-07-08

## Problem

Five small, independent defects/gaps surfaced from daily use of the `home` blueprint and adjacent surfaces:

1. The "+ New Task" button on the daily to-do page (`spice/to-do/ToDo-<date>.md`) creates a task that never shows up in the daily's Today list — unlike Home's own inline "Jot a task…" capture, which works.
2. Pressing Enter in Home's inline "Jot a task…" quick-capture input doesn't submit the task (clicking "Add" is the only way in today).
3. Opening Home takes ~3s with a visible content flash + the pane widening, rather than a clean single render.
4. `Cmd+[` opens the daily note (core `daily-notes` command); it should open Home instead.
5. Home has no way to jump to the previous day's actual daily note.

## Root causes (confirmed by reading code, not guessed)

**#1 — surface mismatch.** `platform/blueprints/to-do/helpers/todo-chrome-bar.js`'s "New Task" dispatch on the daily to-do page calls:

```js
window.customJS.TaskDialog.open({ surface: "today", scheduled: window.moment().format("YYYY-MM-DD") });
```

`TaskDialog.defaultsForSurface()` (`platform/mechanisms/task-entity/task-dialog.js`) only recognizes `surface: "daily"` — `"today"` falls through to the `default` branch, which returns `{ source: "manual" }` and nothing else. `TaskDialog._render()` builds its `state.scheduled` from `defaults.scheduled` only (the top-level `opts.scheduled` the caller passed is never read), so the created task gets `scheduled: ""` and `source: "manual"`. `TaskEntity.queryToday`/the Today band filter on `scheduled === today` (or `source === "daily"` for personal-task inclusion), so the task is silently excluded. Home's inline capture calls `TaskDialog.createQuick({ ..., source: "daily" })`, which is a different, already-correct code path — that's why Home works and the to-do page doesn't.

Fix: change the ONE call site to pass `surface: "daily"` instead of `"today"`. `defaultsForSurface('daily')` already produces exactly `{ scheduled: today, source: 'daily' }` — no new surface case needed.

**#2 — Enter-key submit.** The wiring in `platform/blueprints/home/helpers/space-home.js` looks correct in isolation (`keydown` listener on the input calls `submitCapture()` on Enter, guarding `isComposing`). Since a static read doesn't explain a real, reported failure, this will be reproduced live (via the `/run` skill against a real Obsidian instance) before touching the code, per `systematic-debugging`. Likely candidates once repro'd: an event-bubble interaction with the outside-click/Escape `keydown` listener installed on `document` while the menu is open, or a race between `setMenu(false)` and the async `createQuick` + re-render replacing the input mid-keystroke.

**#3 — flash + widen on load.** Two independent, largely Obsidian-level causes, to be confirmed live before fixing:
- Dataview's own index-catch-up re-render: a freshly-opened dataviewjs block can re-execute once the metadata index for that file catches up (matches the user's ~3s to ~2.5s Dataview refresh cadence already noted in `task-dialog.js`'s existing comments).
- `Home.md`'s `cssclasses: [wide]` frontmatter (which drives pane width via the theme's `--file-line-width` CSS var) may apply after first paint, since it depends on frontmatter parsing completing — visible as the pane "growing."

Plan: reproduce via `/run`, using DevTools/console timing + a temporary render-count log in `SpaceHome.render`, to confirm which of the two (or something else — e.g. the vault's `new-tab-default-page` plugin's open/view-mode sequencing) is actually responsible, then apply the narrowest fix (e.g. skip the block's own re-render when nothing changed, or ensure the DOM is fully torn down/rebuilt in one pass instead of two). This section of the plan is deliberately open-ended pending the live repro — no code is speculatively bundled that a static read can't justify.

**#4 — Cmd+[ hotkey.** `.obsidian/hotkeys.json` currently binds `daily-notes` to `Mod+[`, seeded by `platform/blueprints/daily/manifest.json`'s `hotkeys[]` declaration (`{ command_id: "daily-notes", modifiers: ["Mod"], key: "[" }`), applied via the installer's `applyHotkeys()` (`platform/install.js`). That function is **add-if-absent only** — it never overwrites an existing command_id's bindings and it does not exist to *reassign* a key from one command to another. So repointing `Mod+[` needs two pieces:

- A new command to open Home: `HomeCommandsInit` (customJS class, mirrors the existing `ProjectCommandsInit` pattern in `platform/blueprints/project/helpers/project-commands-init.js`), registering `sauce-home:open` → `app.workspace.openLinkText("spice/home/Home.md", "", false)`. Wired into the `home` blueprint's manifest `customjs_classes[]` + `customjs_startup_scripts[]` (same wiring `ProjectCommandsInit` uses off `project`'s manifest).
- The `daily` blueprint's manifest `hotkeys[]` entry for `daily-notes`/`Mod+[` is removed (so a *brand-new* vault never seeds that binding in the first place), and the `home` blueprint's manifest gains a `hotkeys[]` entry for `sauce-home:open`/`Mod+[` (so a brand-new vault gets the right binding for free via the existing `applyHotkeys()` add-if-absent path).
- For the 4 **already-installed** vaults (workshop dogfood + accuris + ero + headspace), a new idempotent install heal, `applyHomeHotkeyRemapHeal(tp, history, git)`, living in `platform/install.js` next to the other heals (`applyHomeScaffoldHeal` et al.): if `hotkeys.json`'s `daily-notes` entry contains exactly `{modifiers:["Mod"], key:"["}` and `sauce-home:open` has no binding yet, remove that one entry from `daily-notes`'s array and add it to `sauce-home:open`. Backup-first (mirrors `applyHotkeys`'s `.sauce-backup` convention), never throws, no-ops on a second run.

**#5 — Previous-day nav.** No prev/next-day nav exists anywhere in the codebase today (checked `SpaceNavButtons` and the raw daily template) — this is new, not a regression. Design: a small "‹" icon-button in `SpaceHome`'s header row (next to the date), computing yesterday's daily-note path the same way `todo-chrome-bar.js`'s `todayPath` does (via `.obsidian/daily-notes.json`'s `folder`/`format`, one day back), and opening it via `app.workspace.openLinkText` if the file exists. If it doesn't exist (e.g. very first day of vault use), show a `Notice` ("No daily note for <date> yet") instead of creating a blank stub — Home never writes files on the user's behalf for navigation.

## Components touched

| File | Change |
| --- | --- |
| `platform/blueprints/to-do/helpers/todo-chrome-bar.js` | `surface: "today"` → `surface: "daily"` (1-line) |
| `platform/blueprints/home/helpers/space-home.js` | Enter-key fix (post-repro), refresh/flash fix (post-repro), "‹ Yesterday" button |
| `platform/blueprints/home/helpers/sauce-home.css` (or the vault-scoped equivalent) | styling for the new "‹" button, sized/positioned to match existing header controls |
| `platform/blueprints/home/helpers/home-commands-init.js` (NEW) | `HomeCommandsInit` — registers `sauce-home:open` |
| `platform/blueprints/home/manifest.json` | add `HomeCommandsInit` to `customjs_classes[]` + `customjs_startup_scripts[]`; add `hotkeys[]` entry for `sauce-home:open`/`Mod+[` |
| `platform/blueprints/daily/manifest.json` | remove the `daily-notes`/`Mod+[` `hotkeys[]` entry |
| `platform/install.js` | new `applyHomeHotkeyRemapHeal()`, wired into the install pipeline near the other home-blueprint heals |

Every ranch-mirrored file (`ranch/scripts/...`) is generated by the installer from the `platform/` source during workshop self-install/dogfood — not hand-edited independently, per existing convention.

## Testing

- Extend `platform/test/run-task-entity.js` (or `run-home.js`, whichever already covers `defaultsForSurface`) with a case asserting `surface: "daily"` from the to-do chrome bar's dispatch produces `{scheduled: today, source: "daily"}` — regression net for #1.
- `platform/test/run-home.js` / `run-home-render-guards.js`: Enter-key submit path (dispatch a synthetic `keydown` on the DOM-stub input, assert `createQuick` was called), and the new "‹ Yesterday" button's path-computation + click dispatch, as pure/DOM-stub cases matching the file's existing style.
- New Node-testable pure statics for `applyHomeHotkeyRemapHeal`'s decision logic (given a hotkeys.json shape, does it act or skip?), and for the previous-day path computation (pure date math, mirroring `SpaceHome._ymd`/`_dayNumber` already in the file).
- `#3` gets its regression coverage decided once the live root cause is confirmed (could be a render-idempotency assertion, or nothing testable if it's purely an Obsidian/Dataview-internal timing quirk with no code-level fix).
- Full `npm run release:preflight` must stay green.

## Out of scope

- No changes to `TaskDialog.defaultsForSurface`'s cases beyond the fix above (no new `"today"` case — `"daily"` already means what the caller needs).
- No new Homepage-style community plugin dependency — the Cmd+[ retarget is self-contained via a first-party customJS command, matching how every other cross-cutting command in this codebase is shipped.
- No changes to `daily-notes:goto-today` (`Mod+T`) — untouched, out of scope.
