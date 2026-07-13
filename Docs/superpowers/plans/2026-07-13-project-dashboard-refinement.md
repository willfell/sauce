# Project Dashboard refinement — implementation plan

**Spec:** `Docs/superpowers/specs/2026-07-13-project-dashboard-refinement-design.md`
**Branch:** `feat/project-dashboard-refinement` (spec committed).
**Worktree root:** `/Users/willfellhoelter/projects/repos/sauce/.claude/worktrees/bridge-cse_01RJWtc6BkoabPpDrrm8pGMz`

**Goal:** Refine the shipped `ProjectDashboard` — fix Docs/Map tile targets by
delegating to `ProjectChromeBar.navTarget`, add a 6th "Helpful Links" tile,
lay the 6 tiles in a centered 3×2 grid on a subtle (transparent + hairline)
card with gently-raised tiles, add an Open Tasks card + three grouped Recent
cards (Docs/Meetings/Tasks) below the grid using `SectionLabel` headings, and
harden the install heal to sweep lingering `ProjectActivityPanel` /
`ProjectMeetingsPanel` blocks from partially-migrated notes.

**Non-negotiables (from spec):** no manifest `version`/`customjs_classes` edit;
no new class/mechanism/icons; `project-dashboard.js` stays ONE bare class
expression; `ProjectLinksPanel` + `Links Hub.md` untouched; heal only touches
`type: project` notes; every path try/caught with a hardcoded fallback.

**Files touched:**
- `platform/blueprints/project/helpers/project-dashboard.js`
- `platform/test/run-project-dashboard.js`
- `platform/install.js` (heal fn only)
- `platform/test/run-project-dashboard-heal.js` (+ seed fixture)
- `platform/test/visual/project-dashboard.html` (new)

---

## Task 1 — Tile targets via navTarget + 6th tile + 3×2 grid + subtle bg

**File:** `project-dashboard.js`, harness `run-project-dashboard.js`.

**TDD steps:**

1. In `run-project-dashboard.js`, add stubs (near the other `customJS` stubs):
   ```javascript
   global.customJS = global.customJS || {};
   global.customJS.ProjectChromeBar = {
     detectContext: (path) => ({ projectDir: "spice/projects/foo", projectSlug: "foo", context: "project-hub" }),
     navTarget: (dv, ctx, key) => ({
       docs:  `${ctx.projectDir}/docs/Docs.md`,
       board: `${ctx.projectDir}/${ctx.projectSlug}-board.md`,
       todo:  `${ctx.projectDir}/Foo To-Do.md`,
       map:   `${ctx.projectDir}/Foo - Map.md`,
       links: `${ctx.projectDir}/Links Hub.md`,
     }[key] || null),
   };
   global.customJS.SectionLabel = { render: (dv, o) => { const c = dv.container || dv; const e = c.createEl("div"); e.__isSectionLabel = true; e.textContent = String(o && o.text || ""); }, divider: (dv) => (dv.container||dv).createEl("hr") };
   ```
2. Add failing tests **PROJDASH-10..14** (Docs→docs/Docs.md, Map→navTarget map,
   6 tiles + labels `Docs|Board|To-Do|Map|Meetings|Helpful Links`, Links tile
   has no `.__count` chip, Links→Links Hub.md, and fallback when ChromeBar
   absent → Docs still `…/docs/Docs.md`). Update **PROJDASH-9b** expectation 5→6.
   Tile `__descendants` helper already exists in the harness.
3. Implement in `project-dashboard.js`:
   - `render()`: after `currentPath`, resolve `bar` + `barCtx` (guarded), add to
     `ctx`. Change card root cssText to
     `background:transparent; border:1px solid var(--background-modifier-border); border-radius:10px; padding:12px; max-width:720px; margin:4px 0;`.
   - Add `_tileTarget(dv, ctx, key, fallback)` (spec §1).
   - `_renderTiles`: container →
     `display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px; margin-top:0;`.
     Tiles array gains 6th `{ key:"links", label:"Helpful Links", icon:ICON.links, noCount:true }`.
     For each tile: `target = this._tileTarget(dv, ctx, t.key, t.fallback)` where
     the fallback table is spec §1 (Meetings keeps hardcoded
     `spice/meetings/Meetings.md`, key `null`/skip navTarget). Tile cssText drop
     `flex:1 0 30%; max-width:180px`, add `min-width:0;`, set
     `background:var(--background-secondary)`. Skip the count chip when
     `t.noCount` (still set `tile.__label`; do not set `tile.__count`).
4. Run `node platform/test/run-project-dashboard.js` → PROJDASH-* green.
5. Commit: `feat(project): dashboard tiles delegate to navTarget + 6th Helpful Links tile + 3x2 grid + subtle card`.

## Task 2 — Open Tasks card

**File:** `project-dashboard.js`, harness.

1. Failing test **PROJDASH-15**: fixture board `## Todo\n- [ ] a\n- [ ] b\n## Completed\n- [ ] done-hidden\n`
   + To-Do `- [ ] t1\n- [x] t2\n` → `dash._openTasks(ctx)` resolves 3 items
   (`a`,`b`,`t1`), Completed item excluded; assert `_renderOpenTasks` on a
   container yields a SectionLabel "Open Tasks" + 3 `__isOpenTaskRow` rows; empty
   input → container untouched. Reuse `makeApp`/`_stubList` helpers already in
   the harness.
2. Implement `_openTasks(ctx)` (async, spec §4 — reuse the board/To-Do parse
   already in `_counts`, but collect `{title,path,source}`, cap 6) and
   `_renderOpenTasks(container, ctx, tasks)` (empty→return; else
   `customJS.SectionLabel.render({container},{text:"Open Tasks"})` + fancy card;
   rows: todo icon + ellipsized title + muted source tag; click →
   `openLinkText(path, currentPath, false)`).
3. Wire into `render()` after tiles: `const tasks = await this._openTasks(ctx); this._renderOpenTasks(dv.container, ctx, tasks);`
   (renders into `dv.container`, a sibling of the top card — NOT inside it).
4. Green + commit: `feat(project): dashboard Open Tasks card (board + To-Do open items, cap 6)`.

## Task 3 — Grouped Recent cards (replaces flat Recent)

**File:** `project-dashboard.js`, harness.

1. Failing test **PROJDASH-16**: dv stub returns 2 doc-notes + 1 meeting + 0
   task-notes → `_renderRecentGroups(dv.container, ctx)` renders SectionLabels
   `Recent Docs` (2 rows) + `Recent Meetings` (1 row), NO `Recent Tasks` block;
   each group capped at 4; rows are `__isRecentRow`.
2. Implement `_recentByKind(dv, ctx)` → `{ docs:[], meetings:[], tasks:[] }`
   (each newest-first, cap 4) and `_renderRecentGroups(container, ctx)` that
   renders one SectionLabel + fancy card per non-empty group (spec §5). Remove
   the old `_recent` + `_renderRecent`.
3. In `render()`, replace the `_recent`/`_renderRecent` calls with
   `this._renderRecentGroups(dv.container, ctx);` (after Open Tasks). Update
   **PROJDASH-9c** (was "2 recent rows") to assert the grouped shape instead.
4. Green + commit: `feat(project): dashboard grouped Recent cards (Docs/Meetings/Tasks, cap 4 each)`.

## Task 4 — Harden install heal

**File:** `platform/install.js` (`applyProjectDashboardConformanceHeal`),
`platform/test/run-project-dashboard-heal.js` + seed fixture.

1. Add a seed fixture (partial migration): a `type: project` note with BOTH a
   `ProjectDashboard` block AND a `ProjectMeetingsPanel` block. Add failing test:
   heal strips the legacy block, leaves exactly ONE `ProjectDashboard` block,
   writes `.sauce-backup`, idempotent on 2nd run. Keep existing legacy + modern
   fixtures green.
2. Change the guard (spec §7): compute
   `hasDash = before.includes('class: "ProjectDashboard"')` and
   `hasLegacy = LEGACY_CLASSES.some(c => before.includes(`class: "${c}"`))`.
   Skip only when `hasDash && !hasLegacy`. Otherwise strip legacy blocks, then
   insert a `ProjectDashboard` block after the ChromeBar block ONLY if `!hasDash`
   (dedupe — never add a second). `LEGACY_CLASSES` =
   `["ProjectStatusWidget","ProjectActivityPanel","ProjectOpenTasks","ProjectMeetingsPanel","ProjectLinksPanel"]`.
   Preserve the existing `.sauce-backup` + never-throw + `type==="project"`
   filter.
3. Run `node platform/test/run-project-dashboard-heal.js` → all green (incl. the
   original PROJDASH-loadable + activity-panels-heal runners if adjacent).
4. Commit: `fix(project): heal sweeps legacy panels from partially-migrated notes`.

## Task 5 — Playwright visual verify

**File:** `platform/test/visual/project-dashboard.html` (new).

1. Build a faithful standalone HTML replica: dark-theme `:root` CSS vars
   (background-primary/secondary, modifier-border/-hover, interactive-accent,
   text-muted/-faint/-on-accent, color-blue/green/red/orange/purple), a
   transparent hairline card with status pill + 3×2 grid of raised tiles (Links
   tile no count) + inline Links chips + Open Tasks card + Recent Docs/Meetings
   cards with SectionLabel hairlines.
2. `python3 -m http.server 8765 --directory platform/test/visual` (background),
   Playwright: navigate → resize 390×900 → screenshot `dash-390.png` → resize
   720×900 → screenshot `dash-720.png`.
3. Verify visually: 3×2 grid both widths; card is a subtle inset (not a gray
   slab); tiles gently raised; Open Tasks + Recent cards have visible
   hairline-bordered "fancy" styling + decent spacing; SectionLabel hairlines
   legible on dark. Fix any regression in `project-dashboard.js`, re-shoot.
4. Commit: `test(project): Playwright visual harness for refined dashboard`.

## Task 6 — Preflight + PR + CI-green merge

1. `npm run status`; then
   `node platform/test/run-project-dashboard.js`,
   `node platform/test/run-project-dashboard-heal.js`,
   `node platform/test/run-customjs-loadable.js`,
   `node platform/test/run-project-render-guards.js`,
   `node platform/test/run-project-chrome-bar-heal.js` — all green.
2. `git fetch origin && git merge origin/main --no-edit` (resolve autoloop
   drift). `git push -u origin feat/project-dashboard-refinement`.
3. `gh pr create` (title `feat(project): refine ProjectDashboard — link fixes, Helpful Links tile, subtle 3x2 grid, Open Tasks + grouped Recent, heal sweep`; body: summary + spec/plan links + test plan). `gh pr checks --watch`.
4. On green: `gh pr merge --squash --delete-branch` (use `--admin` only if CI is
   green but the branch fell BEHIND via autoloop).

## Task 7 — Release → tap → brew → deploy

1. **Do NOT hand-merge the release PR** — it auto-merges on green. Poll
   `gh pr list --state open` until the `chore(release)` PR merges + tags.
2. Tap PR on `will-fell/homebrew-sauce`: poll `gh -R will-fell/homebrew-sauce pr
   list --state open`. It normally auto-merges; per the user's explicit
   instruction, if it is still open after its CI is green, `gh -R
   will-fell/homebrew-sauce pr merge <n> --squash`.
3. `brew update && brew upgrade sauce && sauce --version`.
4. Deploy to each consumer (paths per `Docs/agent-guides/vault-paths.md`):
   `bash -c 'cd <vault> && sauce update --force'` for accuris, headspace, ero.
   Expect `allOk` per vault (if a pin mismatch → `lesson_redeploy_version_bump_needs_pin_bump`).
5. Verify per vault: at least one project note now has exactly one
   `class: "ProjectDashboard"` and zero `ProjectActivityPanel` /
   `ProjectMeetingsPanel`. Report shipped version + per-vault deploy result +
   heal migrated/skipped counts + Cmd+R reminder.
