# Seamless task actions + Home day-refresh — design

**Date:** 2026-07-03
**Status:** Design (→ writing-plans → subagent execution → ship to vaults)
**Scope:** ONE worktree, ONE PR ("seamless"). Phase 1 of a larger seamlessness effort; the
native-plugin bet (L8) stays deferred to its own project.

> Provenance: a 10-agent research fleet (7 researchers → synthesis → 9 adversarially-verified
> levers) produced the root-cause map. This design then went DEEPER against the real code +
> the installed Dataview plugin source to reach first-go confidence (see §5). Corrections vs
> the fleet are marked ⚠.

---

## 1. Problem & confirmed root causes

Four fixes. Three are the "seamless task actions" trio + the add-reconcile; the fourth is the
Home "Friday" staleness bug the user reported.

| # | Pain | Confirmed root cause | Fix |
|---|------|----------------------|-----|
| 1 | Pages load with a `loading…` flash | Cold-start race: Dataview renders before CustomJS registers `window.customJS`; `customjs-guard` polls ~2s. | **OUT** (needs L8 native plugin) |
| 2 | Finishing a task has a "second pause" | Write rewrites the file; UI only reconciles on Dataview's next refresh. **Confirmed in plugin source:** the refresh re-renders only when `lastReload != index.revision && container.isShown()` — i.e. after an index bump. | **L2** optimistic removal |
| 2b | Adding a task has a "second pause" | Same: the new row appears only after Dataview re-indexes the created file + refreshes. | **L4** metadataCache-gated force-refresh |
| 3 | After a write the note reloads + scroll jumps to top | Dataview re-render tears down the block (container cleared → height collapse); Reading view (`defaultViewMode:"preview"`) re-lays-out → scroll resets. Plus a self-reopen (`openFile`) on create/edit. | **L3** scroll capture+restore, **L10** no self-reopen |
| 4 | Home page "only shows info on Friday" | ⚠ NOT a date-math bug — `_humanDate`/`_dayNumber` proven correct across a week + on all 3 live vaults. It's **staleness**: the Home date + `asOf:today` dashboard are captured at render; the refresh gate (`lastReload != revision && isShown()`) means a quiet vault never re-renders the Home when you return on a new day → it's frozen at its last render day. | **L-HOME** day-watcher re-render |

**Decisions (user):** ONE PR • optimistic UI with auto-revert • keep Reading mode (fix scroll
in place) • testing is a first-class deliverable, must work on the first go.

### Seamless target (acceptance)
- **Finish/delete:** row vanishes instantly on click (before the write confirms); re-appears with a Notice on failure.
- **Add:** new row appears within a few hundred ms, not ~2.5s.
- **Scroll:** viewport holds across any task write + its re-render; no self-reopen jump.
- **Home:** returning to the Home on a new day shows *that* day (date + dashboard), not a stale snapshot.

---

## 2. Where the code lives (source of truth)

Author in `platform/mechanisms/**` + `platform/blueprints/**`; mirror to the `ranch/scripts/**`
dogfood copies (this repo self-installs). Module-directory invariant: edit source, sync copies.

| Lever | Source-of-truth file | Symbol |
|-------|---------------------|--------|
| **L2** optimistic removal | `platform/mechanisms/task-entity/task-today-list.js` (~L270–285) | `renderTaskRow` checkbox `change` handler |
| **L3** capture | `platform/mechanisms/render-safe/render-safe.js` (new) | `RenderSafe.captureScroll()` — called by L2 handler + add path before write |
| **L3** restore | `platform/mechanisms/render-safe/render-safe.js` (new) | `RenderSafe.restoreScroll(dv)` — called from one trailing guard block per note |
| **L4** add-reconcile | `platform/mechanisms/task-entity/task-dialog.js` | new `_reconcileAfterCreate(app, path)` called at tail of `_create` (covers `createQuick`) |
| **L10** no self-reopen | `platform/blueprints/to-do/helpers/todo-create-task.js` | `_submit` (~L579+) / `_submitEdit` (L558) — guard `leaf.openFile`+`forceLeafPreview` |
| **L-HOME** day-refresh | `platform/blueprints/home/helpers/space-home.js` `render()` | store render-day + install (once, deduped) an `active-leaf-change` day-watcher |

`renderTaskRow` is the **shared** row renderer (TaskTodayList + daily aggregators +
`project-workstreams`). One change covers every surface.

**Confirmed fact:** the Dataview force-refresh command id is **`dataview:dataview-force-refresh-views`**
(command id `dataview-force-refresh-views` under plugin `dataview`; it "touches the index,
incrementing the revision number, causing downstream views to re-render"). Use it, NOT the bare
`dataview:refresh-views` trigger (gated by the revision check → no-ops before re-index).

---

## 3. Design (five levers)

### L2 — optimistic removal (the finish workhorse)
Current handler (`task-today-list.js` L270–285) awaits `markDone`, and only on failure sets
`cb.checked=false` + Notice; a comment says it relies on the block re-rendering. New handler:
1. Resolve `TD`; if unavailable → `cb.checked=false; return` (unchanged cold-load guard).
2. `RenderSafe.captureScroll()` (L3). Capture `parent=row.parentNode`, `next=row.nextSibling`. Remove `row` **immediately**.
3. `await TD.markDone(path)`. On `{ok:false}`/throw → `parent.insertBefore(row,next)`, `cb.checked=false`, Notice (keep the revert — `_done/` rename can collide).
No force-refresh on finish (would race the index and re-add the row). The natural refresh
reconciles authoritatively; L3 makes it invisible.

### L3 — scroll capture + restore (robust, autonomously certifiable)
- **`RenderSafe.captureScroll()`** — find the active Reading-view scroller *robustly* (do NOT
  hardcode one selector): try `.workspace-leaf.mod-active .markdown-reading-view .markdown-preview-view`,
  then `.markdown-preview-view`, then walk ancestors from the active leaf's content for the first
  element with `scrollHeight > clientHeight` + scrollable `overflow-y`. Stash
  `window.__sauceScrollStash = { path: activeFilePath, y: scroller.scrollTop, t: now }`. Never throws.
- **`RenderSafe.restoreScroll(dv)`** — from exactly ONE trailing guard block per note. If stash is
  fresh (`now-t < 6000`) + `path === active file`, re-find the scroller and restore `y` when the
  content has rebuilt: a one-shot `MutationObserver` on the scroller that restores once
  `scrollHeight >= y` (i.e. the block rebuilt past the old offset), a double-`requestAnimationFrame`
  fallback, and a hard timeout that clears the observer. Never throws; a miss = today's behavior (no regression).
- ⚠ Capture must NOT live in `task-interactions._writeBack` — `markDone`/`_create` don't go through it.
  Capture is triggered by the L2 handler + the add path (both have the gesture context).

### L4 — add-reconcile (metadataCache-gated force-refresh; ⚠ no live spike needed)
- New `TaskDialog._reconcileAfterCreate(app, path)` called at the tail of `_create` (so `createQuick`
  inherits it). It:
  1. `RenderSafe.captureScroll()`.
  2. Registers a **one-shot** `app.metadataCache.on('changed', f => …)` that, when `f.path === path`
     (the just-created file is now indexed), fires `app.commands.executeCommandById('dataview:dataview-force-refresh-views')`, then detaches the listener.
  3. A `setTimeout` fallback (~1200ms) fires the force-refresh anyway and detaches, so a missed
     event still reconciles well under the 2.5s default.
  All guarded/try-catch → absent command or API degrades to today's behavior. Gating on the index
  event means force-refresh never runs against a stale index (no missing-row race).

### L10 — no self-reopen (kills the create/edit scroll-to-top)
`ToDoCreateTask._submit`/`_submitEdit` currently `leaf.openFile(file)` + `forceLeafPreview` even
when `file` is the note already open (create-into-today; every edit) → bare `openFile` scrolls to top.
Guard: `const cur = app.workspace.getActiveFile(); if (!cur || cur.path !== file.path) { …openFile… }`.
Same-file → skip → no jump. Different file → unchanged (real navigation preserved).

### L-HOME — Home day-refresh (fixes the "Friday" freeze)
In `SpaceHome.render()`:
1. After computing `today`, set `window.__sauceHomeRenderDay = today`.
2. Install, **once** (guard `if (!window.__sauceHomeDayWatcher)`), an `app.workspace.on('active-leaf-change', …)`
   handler stored so it registers exactly one listener for the app lifetime (no per-render leak).
   The handler: resolve the newly-active leaf's file path; if it's the Home note
   (`spice/home/Home.md`) and `window.__sauceHomeRenderDay !== moment().format('YYYY-MM-DD')`,
   fire `dataview:dataview-force-refresh-views`. That bumps revision → the now-shown Home
   re-renders → reads fresh `today` → updates `__sauceHomeRenderDay`. No loop (deduped listener;
   same-day re-activation is a no-op). All never-throw; missing moment/commands → no-op (no regression).

### Interaction flow — finish a task
tick → `captureScroll` → row removed instantly → `await markDone` (fail → re-insert+Notice) →
natural refresh re-renders block → `restoreScroll` holds the viewport.

---

## 4. Testing strategy (the centerpiece — certifiable WITHOUT a human operating Obsidian)

Rule from prior burns: tests drive the **real** functions against DOM/app stubs, never a hand-built
replica (a fake replica hid the v0.180.1 link-render bug; the RIL-2 stub running the actual code
caught it). Every lever gets a behavioral case exercising the shipped path. The full
`npm run release:preflight` chain (incl. `run-task-entity`, `run-render-safe`, `run-todo-dialog`,
`run-home`, `run-task-entity-render-guards`, `run-customjs-loadable`, `run-customjs-contract`) must be green.

### L2 — `platform/test/run-task-entity.js` (extend RTR-*)
DOM stub gains `parentNode`/`nextSibling`/`insertBefore`/`remove` tracking (RTR-3's stub is the base).
- **RTR-4** success: `markDone`→`{ok:true}` after a tick. Assert the row is removed from its parent
  **before** `markDone` resolves, and stays removed.
- **RTR-5** failure: `{ok:false}` → row re-inserted at original index, `cb.checked===false`, Notice raised.
- **RTR-6** throw → same revert as RTR-5.
- **RTR-7** cold load (`TD` unavailable) → `cb.checked=false`, no removal, no throw.
- **RTR-CAP** the handler calls `RenderSafe.captureScroll` before `markDone` (spy).
- Regression: RTR-1/2/3 stay green.

### L3 — `platform/test/run-render-safe.js` + a Playwright harness
Pure-logic unit cases (stubbed DOM/window):
- **RS-CAP-1** captures scroller `scrollTop` + active path + timestamp into the stash.
- **RS-CAP-2** no scroller / no active file → no throw, no stash.
- **RS-REST-1** fresh + same path + scroller present → restores `y`.
- **RS-REST-2** stale (`t` > 6000ms ago) → no restore. **RS-REST-3** path ≠ active → no restore.
- **RS-REST-4** no stash / no scroller → never throws, no-op.
- **RS-REST-5** teardown→rebuild sim: scroller starts collapsed (`scrollHeight` small) then grows
  past `y`; assert the observer/rAF path restores `y` once height recovers.
- **Scroller-finder** cases: the robust finder picks `.markdown-preview-view`, falls back to the
  overflow ancestor walk.
- **Playwright HTML harness** (`.playwright-mcp`, served via `python3 -m http.server` — file:// is
  blocked): a faithful reading-view scroller with a block that clears + rebuilds after a delay
  (mimicking Dataview). Load the **real** `RenderSafe.captureScroll`/`restoreScroll`; scroll down,
  fire capture, trigger teardown→rebuild, assert `scrollTop` is restored. This certifies the timing
  in a real browser DOM without operating Obsidian.

### L4 — `platform/test/run-task-entity.js` (TaskDialog)
- **TD-REC-1** `_create` success registers a one-shot `metadataCache.on('changed')` and, on the
  matching path event, calls `executeCommandById('dataview:dataview-force-refresh-views')` then detaches (spies).
- **TD-REC-2** if the event never fires, the timeout fallback force-refreshes + detaches (fake timers).
- **TD-REC-3** absent command/API → `_create` still resolves, task still created, no throw.
- **TD-REC-4** finish/delete path does NOT force-refresh (guards the re-add flicker).

### L10 — `platform/test/run-todo-dialog.js`
- **TDLG-REOPEN-1** target == active file → `leaf.openFile` NOT called.
- **TDLG-REOPEN-2** target != active file → `leaf.openFile` IS called (don't break navigation).
Drive the real `_submit`/`_submitEdit` with a fake app whose `getActiveFile` is controllable.

### L-HOME — `platform/test/run-home.js`
- **HOME-DAY-1** pure predicate: "should refresh?" true iff active path is the Home note AND
  `renderDay !== today` (extract the decision into a testable static, e.g. `SpaceHome._shouldDayRefresh(activePath, renderDay, today)`).
- **HOME-DAY-2** render stores `window.__sauceHomeRenderDay = today` and installs exactly ONE watcher
  across repeated renders (dedup; assert `workspace.on` called once over N renders).
- **HOME-DAY-3** watcher fires `executeCommandById('dataview:dataview-force-refresh-views')` when the
  Home becomes active on a new day; no-op same-day; never throws with no moment/commands.
- Regression: HOME-DATE / HOME-GLANCE / HOME-RENDER stay green.

### Gates before merge
- `npm run release:preflight` fully green. `npm run release:preflight-bumped` green on a clean tree
  (guards the bumped-state release wedge). Workshop dogfood green. No version literals hardcoded in tests.

---

## 5. First-go confidence & residual risk
- **Refresh model** — read from the installed Dataview `main.js`: re-render gate is
  `lastReload != index.revision && container.isShown()`; force-refresh command bumps revision. This
  is WHY the Home freezes and WHY force-refresh (not the bare trigger) is the reconcile tool. Certain.
- **L2 / L10** — pure DOM/guard logic; fully unit-certified. Low risk.
- **L3** — the timing piece; certified by unit tests + a real-browser Playwright harness; and
  never-throw + no-op-on-miss guarantees **no regression** even if a rare edge misses. Medium→low.
- **L4** — metadataCache-gated (no stale-index race by construction); strictly additive; worst case
  degrades to today's ~2.5s. Low.
- **L-HOME** — deduped, never-throw event wiring; pure decision unit-tested; worst case = today's
  freeze (no regression). Low.
- **Env risks:** (a) an autoloop `sauce-30m-loop` session is running (PID observed) — it may churn
  `main`/the release PR; mitigate via worktree isolation + `git merge origin/main`/update-branch at
  merge time; do NOT kill it (may be the user's own session). (b) `deploy.js` polls `brew update`
  itself but `git fetch --tags` first is still prudent; `sauce` must be on PATH (`/opt/homebrew/bin`).

---

## 6. Ship pipeline (what actually happens)
1. Merge the **feature PR** to `main` after CI (`preflight macos + ubuntu`) is green — the only manual git step. Handle BEHIND via update-branch.
2. `prepare-release` auto-computes semver, writes all version records, opens + **auto-merges** the release PR. **Do NOT touch it.**
3. `tag-and-ship` tags `v<X.Y.Z>`, patches the tap Formula, **auto-merges the tap PR**. Monitor; intervene only if it stalls.
4. `node scripts/autoloop/deploy.js run` → `brew update`+`upgrade sauce` → per-vault `sauce update --bump-pins` for ero/accuris/headspace; verify each reaches the target version (fail-closed).
5. Confirm all three vaults report the new version; report back.

---

## 7. Out of scope (deferred / rejected)
- **L8 native plugin** (fixes load flash) — GO-verdict POC on branch `poc/sauce-plugin`; its own project.
- **L5** dashboard N+1, **L7** js-engine reactive(), **L9** general query cache, **L11** block-orchestrator rewrite — rejected/deferred by the fleet (efficiency-only, wrong-vehicle, correctness-hazard, or huge blast radius).
