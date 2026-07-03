# Home Command Center — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Work in the worktree `.worktrees/home-command-center` (branch `feat/home-command-center`). NEVER hand-edit version fields of EXISTING components or version snapshots — the release pipeline bumps them from conventional commits. The one exception: the NEW `home` component gets an initial `0.1.0` hand-declared (mirrors the wiki introduction, commit `e244d33c`).

**Goal:** Ship a persistent `Home.md` command center (new `home` blueprint) that Homepage opens on launch in Reading view — greeting + one-tap capture + the reused daily dashboard (live "today") + an animation layer — while the dated daily stays a focused log, driven by one shared dashboard renderer.

**Architecture:** Add one optional `asOf` injection seam to the existing `SpaceDailyDashboard.render(dv, params)` (no params ⇒ byte-for-byte current behavior). A new thin `SpaceHome` composer renders greeting + capture band + `SpaceDailyDashboard(asOf=today)`; the Go-to launcher comes from the top nav strip. Convenience flips the homepage to `kind:File → spice/home/Home.md`, `openOnStartup:true`; daily `autorun:false`. An ungated, backup-first, never-throw `applyHomeScaffoldHeal` materializes + heals `spice/home/Home.md`.

**Tech Stack:** Obsidian, CustomJS, Dataview, the Homepage community plugin, Node test harnesses, the Sauce auto-release pipeline (Homebrew).

**Reference:** Design doc `Docs/plans/2026-07-02-home-command-center-design.md`.

---

## File map

| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `platform/blueprints/home/manifest.json` | Create | `home@0.1.0` declaration: depends_on, files[], customjs_classes:[`SpaceHome`], snippets, nav_buttons, claude_surface |
| `platform/blueprints/home/helpers/space-home.js` | Create | `SpaceHome` composer + pure helpers (`_greeting`, `_humanDate`, capture spec) |
| `platform/blueprints/home/helpers/sauce-home.css` | Create | Home-scoped layout + animation layer |
| `platform/blueprints/home/content/home-template.md` | Create | Source for the scaffolded `spice/home/Home.md` |
| `platform/blueprints/home/seed/seed.js` | Create | Seed-vault fixture (scaffold Home.md) |
| `platform/blueprints/home/commands/home.md` | Create | `/home` slash command (claude_surface) |
| `platform/blueprints/home/skills/open-home/SKILL.md` | Create | native skill (claude_surface) |
| `platform/blueprints/daily/helpers/space-daily-dashboard.js:177,192-194,401-404` | Modify | Accept optional `params.asOf`/`live` (the DRY seam) |
| `platform/manifest.json` (blueprints[]) | Modify | Register `home@0.1.0` |
| `ranch/platform-subscription.json` | Modify | Workshop dogfood subscription: add `home@0.1.0` |
| `platform/mechanisms/convenience/manifest.json` (homepage settings) | Modify | `kind:File`, `value:spice/home/Home.md`, `openOnStartup:true`, `commands:[refresh]` |
| `platform/blueprints/daily/manifest.json` (core_plugin_settings) | Modify | `autorun: false` |
| `platform/install.js` (~line 1250 region) | Modify | `applyHomeScaffoldHeal(tp, history, git)` + registration |
| `platform/test/run-home.js` | Create | Behavioral harness for the seam + SpaceHome |
| `package.json` (release:preflight chain) | Modify | Add `node platform/test/run-home.js` |

---

## Task 0: Blueprint skeleton + new-component registration

**Files:**
- Create: `platform/blueprints/home/manifest.json`
- Modify: `platform/manifest.json` (blueprints[]), `ranch/platform-subscription.json`

- [ ] **Step 1: Read the two closest precedents** — `platform/blueprints/wiki/manifest.json` (a recent new blueprint) and `platform/blueprints/daily/manifest.json` (nav_buttons/snippets/customjs shape). Read the `platform/manifest.json` `blueprints[]` array and the `ranch/platform-subscription.json` shape.

- [ ] **Step 2: Create `platform/blueprints/home/manifest.json`** with:
  - `name:"home"`, `version:"0.1.0"`, `kind:"blueprint"`, `module_directory:"home"`, `skills_dir:".claude/skills/home"`, a one-line `description` (no hand-written version-changelog log — keep it short).
  - `depends_on`: `nav-buttons >=<current>`, `customjs-guard >=1.0.0`, `convenience >=<current>`, `activity-feed >=<current>`, `task-entity >=<current>`, `entity-create >=<current>`, `meetings >=<current>`, `scratch >=<current>`, `daily >=<current-daily-version-after-seam>`. (Use the versions currently in `platform/manifest.json` for each; for `daily`, use the version it will hold — the pipeline bumps it, so use its CURRENT version as the floor, e.g. `>=0.16.2`.)
  - `customjs_classes: ["SpaceHome"]`
  - `files`: `[{ "source":"helpers/space-home.js", "dest":"{{scripts_path}}/home/space-home.js" }]` (NOTE: do NOT put `content/home-template.md` in files[] with a vault dest — the scaffold/heal owns the vault note so we never clobber user edits; the template is read by the heal from the installed blueprint dir OR embedded — see Task 5).
  - `snippets: [{ "source":"helpers/sauce-home.css", "name":"sauce-home" }]`, `appearance.enabledCssSnippets:["sauce-home"]`
  - `nav_buttons`: `[{ "id":"home-open", "label":"Home", "icon":"home", "order":40, "action":{ "type":"invoke_command", "command_id":"homepage:open-homepage", "read_mode_after":true } }]`
  - `claude_surface`: command + skill + a `claude_md_row` resolver `{ topic:"Home", path:"{{module_directory}}", command:"/home" }` (mirror daily's claude_surface shape).

- [ ] **Step 3: Register in `platform/manifest.json`** — add to `blueprints[]` (keep array alphabetical if it is): `{ "name":"home", "version":"0.1.0", "path":"blueprints/home" }`.

- [ ] **Step 4: Register in `ranch/platform-subscription.json`** — mirror how `wiki` appears there (same `{name,version,path}` or the subscription's shape). Match the file's existing structure exactly.

- [ ] **Step 5: Verify JSON parses.** Run: `node -e "require('./platform/blueprints/home/manifest.json'); require('./platform/manifest.json'); require('./ranch/platform-subscription.json'); console.log('ok')"` — Expected: `ok`.

- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(home): register home blueprint skeleton (home@0.1.0)"`

---

## Task 1: The `asOf` injection seam in SpaceDailyDashboard (TDD)

**Files:**
- Modify: `platform/blueprints/daily/helpers/space-daily-dashboard.js` (`render` at ~line 177; date resolve at 192-194; ActivityFeed `asOf` at 401-404)
- Test: extend the existing daily dashboard harness (find it: `grep -l SpaceDailyDashboard platform/test/run-*.js`) OR add cases in `platform/test/run-home.js` (created Task 9). Prefer the existing daily harness so the regression lock lives with the daily.

- [ ] **Step 1: Write the failing test.** In the daily dashboard harness, add two cases driving the REAL `SpaceDailyDashboard.render`:
  - `render(dvStub, { asOf: "2025-01-15", live: true })` ⇒ the tasks/meetings/activity selection uses `2025-01-15` (assert via a dv-stub spy that `dv.pages(...).where` filtered on `2025-01-15`, and that `ActivityFeed.render` was called with `asOf:"2025-01-15"`).
  - `render(dvStub)` on a note named `.../2026-02-03.md` ⇒ selection uses `2026-02-03` (current behavior; regression lock).
  Use the existing harness's dv-stub + a stub `customJS.ActivityFeed.render` capturing its opts.

- [ ] **Step 2: Run it, expect FAIL.** Run: `node platform/test/run-<daily-harness>.js` — Expected: FAIL (render ignores `params.asOf`).

- [ ] **Step 3: Implement the seam.** Change `async render(dv) {` → `async render(dv, params) {` and the date derivation:
```js
const fileName = this._resolveCurrentFileName(dv);
const dateMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);
const callerAsOf = (params && typeof params.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.asOf)) ? params.asOf : null;
const today = callerAsOf || (dateMatch ? dateMatch[1] : moment().format("YYYY-MM-DD"));
```
  Leave every downstream use of `today` unchanged (tasks selection, meetings filter, `ActivityFeed.render({ asOf: today, ... })`). Do not otherwise alter behavior.

- [ ] **Step 4: Run tests, expect PASS.** Run the daily harness — Expected: both new cases PASS, all pre-existing cases still PASS.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(daily): optional asOf/live inject on SpaceDailyDashboard.render (DRY seam for Home)"`

---

## Task 2: `SpaceHome` composer + pure helpers (TDD)

**Files:**
- Create: `platform/blueprints/home/helpers/space-home.js`
- Test: `platform/test/run-home.js` (scaffold in Task 9 Step 1 first if not present; it's fine to create the harness file early)

- [ ] **Step 1: Scaffold the harness** if absent: `node scripts/scaffold-behavioral-harness.js home home` (produces `platform/test/run-home.js`). Trim it to the cases below.

- [ ] **Step 2: Write failing tests** in `run-home.js` driving REAL code:
  - `SpaceHome._greeting(6)` → `"Good morning"`, `_greeting(13)` → `"Good afternoon"`, `_greeting(19)` → `"Good evening"`, `_greeting(23)`/`_greeting(2)` → `"Good evening"` (define bands: 5–11 morning, 12–16 afternoon, else evening). Pure, hour injected (NO `new Date` in the helper).
  - `SpaceHome._humanDate("2026-07-02", "2026-07-02")` → contains `"Thursday"`, `"Jul 2"`, and `"Today"` (reuse the task-entity `_humanDate` Hinnant day-math; port or require it — check how task-entity exposes it, mirror exactly, no `new Date`).
  - `SpaceHome.render(dvStub, {})` calls the guard/`SpaceDailyDashboard` with `args:[{ asOf:<today>, live:true }]` (assert via a stub capturing `dv.view` calls), and emits, in order: a greeting element, a capture band with 4 buttons, then the dashboard mount. Assert band order + button count + that each button carries a dispatch (dataset or onclick).

- [ ] **Step 3: Run, expect FAIL.** `node platform/test/run-home.js` — Expected: FAIL (SpaceHome undefined).

- [ ] **Step 4: Implement `SpaceHome`.** A CustomJS class mirroring the style of `space-daily-dashboard.js` (same file header comment convention, `class SpaceHome { async render(dv, params) {...} }`). It:
  - resolves `today` (from the daily-notes plugin's format via `moment().format("YYYY-MM-DD")` at render time — the ONLY live-time read; keep `_greeting`/`_humanDate` pure with injected values).
  - builds a `.sauce-home` wrapper `<div>`.
  - renders greeting header (`_greeting(currentHour)` + `_humanDate(today, today)`).
  - renders the capture band (Task 3 wires dispatch).
  - mounts the dashboard: `await dv.view("ranch/views/customjs-guard", { class: "SpaceDailyDashboard", args: [{ asOf: today, live: true }] })` into a child container (respect how the guard mounts — it renders into `dv.container`; if a child mount is needed, follow the daily template's single-block pattern and just call it inline after the greeting/capture so it appends in order).
  - Pure static helpers `_greeting(hour)`, `_humanDate(iso, todayIso)`, `_captureSpec()` (returns the button list for Task 3).

- [ ] **Step 5: Run, expect PASS.** `node platform/test/run-home.js` — Expected: PASS.

- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(home): SpaceHome composer + greeting/human-date helpers"`

---

## Task 3: Quick-capture band dispatch (verify + wire, TDD)

**Files:**
- Modify: `platform/blueprints/home/helpers/space-home.js`
- Test: `platform/test/run-home.js`

- [ ] **Step 1: Verify the To-Do new-task API.** `grep -rn "class TaskDialog\|open(\|newTask\|New Task" platform/mechanisms/task-entity/*.js` — find the exact programmatic entrypoint to open the New Task dialog (e.g. `customJS.TaskDialog.open({ dv })` or `customJS.ToDoLeafActions.newTask(dv)`). Record the exact call. Meeting/Scratch are confirmed: `customJS.EntityCreate.create({ instance:"meeting", dv })` / `{ instance:"scratch", dv }`. Open-daily: `app.commands.executeCommandById("daily-notes")`.

- [ ] **Step 2: Write failing test.** Assert `SpaceHome._captureSpec()` returns exactly 4 entries with `{ key, label, icon }` for `todo`, `meeting`, `scratch`, `openDaily`, in that order; and that `render` attaches a click handler to each button whose action, when invoked with a mocked `customJS`/`app`, calls the right API (spy on `EntityCreate.create`, the task-dialog open, and `executeCommandById("daily-notes")`).

- [ ] **Step 3: Run, expect FAIL.** `node platform/test/run-home.js` — Expected: FAIL.

- [ ] **Step 4: Implement dispatch.** Each capture `<button>` gets an onclick that:
  - `todo` → the verified task-dialog open call, guarded `if (customJS && customJS.<Class>)` else no-op + console.debug.
  - `meeting` → `await customJS.EntityCreate.create({ instance:"meeting", dv })` (guarded).
  - `scratch` → `await customJS.EntityCreate.create({ instance:"scratch", dv })` (guarded).
  - `openDaily` → `app.commands.executeCommandById("daily-notes")` (guarded on `app?.commands`).
  Absent API ⇒ button still renders but no-ops (graceful degrade). Buttons are full-width on mobile (CSS Task 4).

- [ ] **Step 5: Run, expect PASS.** `node platform/test/run-home.js` — Expected: PASS.

- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(home): quick-capture band (todo/meeting/scratch/open-daily)"`

---

## Task 4: `sauce-home.css` — layout + animation layer

**Files:**
- Create: `platform/blueprints/home/helpers/sauce-home.css`

- [ ] **Step 1: Read `platform/blueprints/daily/helpers/sauce-daily-dashboard.css`** to match tokens (`--background-modifier-border`, section radius 8px, mobile `@media (max-width:480px)`, tabular-nums) and class-naming style.

- [ ] **Step 2: Write the CSS**, all selectors scoped under `.sauce-home`:
  - Layout: greeting header (large, muted subtitle); capture band as a responsive grid (`grid-template-columns: repeat(auto-fit, minmax(140px,1fr))` desktop; each button **full-width row on mobile** at `@media (max-width:480px)` → `grid-template-columns:1fr`). Buttons: icon+label, comfortable tap height (≥44px), native Obsidian tokens (`--interactive-normal`, `--text-normal`), rounded.
  - **Animations** (GPU-only, total <300ms):
    - `@keyframes sauceHomeFadeUp { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }`
    - Apply to `.sauce-home > *` with `animation: sauceHomeFadeUp .2s ease-out both;` and stagger via `nth-child(1..n) { animation-delay: 0/.05/.1/.15s }`.
    - `@keyframes sauceHomePillPop { 0%{transform:scale(.85)} 60%{transform:scale(1.06)} 100%{transform:scale(1)} }` on `.sauce-section-overdue-pill` (and any count pill) once.
    - Capture button `:active { transform:scale(.98) }`; desktop `@media (hover:hover){ .sauce-home button:hover{ transform:translateY(-1px); box-shadow:... } }`.
    - Expand ease: a gentle `transition: opacity .18s ease` on an inner content wrapper (do NOT animate raw `<details>` height).
  - **Off-switch:** `@media (prefers-reduced-motion: reduce){ .sauce-home *, .sauce-home > * { animation:none !important; transition:none !important; transform:none !important } }`

- [ ] **Step 3: Sanity-lint** the CSS is well-formed: `node -e "const s=require('fs').readFileSync('platform/blueprints/home/helpers/sauce-home.css','utf8'); if((s.match(/{/g)||[]).length!==(s.match(/}/g)||[]).length) throw 'brace mismatch'; console.log('ok')"` — Expected `ok`.

- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(home): sauce-home.css layout + reduced-motion-safe animation layer"`

---

## Task 5: Home.md template + scaffold/heal (TDD)

**Files:**
- Create: `platform/blueprints/home/content/home-template.md`
- Modify: `platform/install.js` (add `applyHomeScaffoldHeal`; register ungated near the `applyTripsConformanceHeal(tp, history, git)` call ~line 1250)

- [ ] **Step 1: Read the precedents** — `_healWikiChromeBody` (install.js ~5890) for the pure-string idempotent shape, and `applyTripsConformanceHeal` (install.js ~10956) for the async backup-first/never-throw/registration shape. Also read how a singleton hub note is created if missing (grep install.js for `adapter.write(` + `exists(` around trips/boards scaffolds).

- [ ] **Step 2: Write `content/home-template.md`.** Frontmatter `type: home`, `cssclasses: [wide]`. Body:
```
[SpaceNavButtons customjs-guard view block]

---

[SpaceHome customjs-guard view block]

[//]: # (HOME_CHROME_END)
```
  Use the exact dataviewjs `dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" })` and `{ class: "SpaceHome" }` block syntax used by `daily-template.md`. Everything ABOVE the `HOME_CHROME_END` marker is platform chrome; anything the user adds below is preserved by the heal.

- [ ] **Step 3: Write failing test** in `run-home.js`: a pure `applyHomeScaffoldHeal`-body helper (extract the string transform as a pure function `_healHomeChromeBody(body)` like the wiki one) — assert: (a) empty/missing ⇒ returns the full chrome template, (b) running it twice is idempotent (second pass === first pass), (c) user content below `HOME_CHROME_END` is preserved.

- [ ] **Step 4: Run, expect FAIL.** `node platform/test/run-home.js` — Expected FAIL.

- [ ] **Step 5: Implement.** In `install.js`:
  - `_healHomeChromeBody(body)` — pure: if body lacks the chrome (no `class: "SpaceHome"`), rebuild chrome above `HOME_CHROME_END`, preserving any content after the marker; idempotent.
  - `async function applyHomeScaffoldHeal(tp, history, git)` — guard on adapter; compute `spice/home/Home.md`; if missing, write the rendered template (backup nothing — it's new); if present, read → `_healHomeChromeBody` → if changed, backup-first (`.sauce-backup-<ts>`) then write; **never throw** (wrap in try/catch, log). Mirror `applyTripsConformanceHeal` exactly.
  - Register it ungated next to `await applyTripsConformanceHeal(tp, history, git);` (~line 1250): `await applyHomeScaffoldHeal(tp, history, git);`

- [ ] **Step 6: Run, expect PASS.** `node platform/test/run-home.js` — Expected PASS.

- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat(home): Home.md template + scaffold/heal (backup-first, idempotent, never-throw)"`

---

## Task 6: Homepage/startup config flip (convenience + daily)

**Files:**
- Modify: `platform/mechanisms/convenience/manifest.json` (homepage settings block)
- Modify: `platform/blueprints/daily/manifest.json` (`core_plugin_settings.daily-notes.autorun`)

- [ ] **Step 1: Edit the homepage settings** in convenience `community_plugin_settings[]` id `"homepage"` → `homepages["Main Homepage"]`:
  - `kind: "Daily Note"` → `"File"`
  - `value: ""` → `"spice/home/Home.md"`
  - `openOnStartup: false` → `true`
  - `commands: []` → `[{ "id": "dataview:refresh-views", "period": "Both" }]`
  - Leave `view:"Reading view"`, `manualOpenMode`/`openMode:"Replace last note"`, `autoCreate:true`, `refreshDataview:true`, `revertView:true`, `hideReleaseNotes:true` unchanged.
  Do NOT touch the `new-tab-default-page` block (`whatToOpen:"homepage:open-homepage"` already correct). Do NOT edit the convenience `version` field.

- [ ] **Step 2: Edit daily** `core_plugin_settings.daily-notes.settings.autorun: true → false`. Do NOT edit the daily `version` field.

- [ ] **Step 3: Verify JSON parses.** `node -e "require('./platform/mechanisms/convenience/manifest.json'); require('./platform/blueprints/daily/manifest.json'); console.log('ok')"` — Expected `ok`.

- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(convenience): homepage opens Home.md on startup + cold-start dataview refresh; daily autorun off"`
  (Two components in one commit is fine — the bumper attributes per changed path.)

---

## Task 7: claude_surface — /home command + open-home skill

**Files:**
- Create: `platform/blueprints/home/commands/home.md`, `platform/blueprints/home/skills/open-home/SKILL.md`

- [ ] **Step 1: Read** `platform/blueprints/daily/commands/daily.md` + `platform/blueprints/daily/skills/open-today/SKILL.md` for shape/frontmatter.

- [ ] **Step 2: Write `commands/home.md`** — a `/home` command that opens `spice/home/Home.md` (navigate + describe the surface). Mirror daily's structure.

- [ ] **Step 3: Write `skills/open-home/SKILL.md`** — an `open-home` skill (name/description frontmatter) that opens Home. Mirror `open-today`.

- [ ] **Step 4: Confirm** the `claude_surface[]` entries in the home manifest (Task 0 Step 2) point at these exact paths.

- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(home): /home command + open-home skill (claude_surface)"`

---

## Task 8: Seed fixture

**Files:**
- Create: `platform/blueprints/home/seed/seed.js`

- [ ] **Step 1: Read** `platform/blueprints/daily/seed/seed.js` for the `{ schema_version, kind, seed(ctx) }` shape + `ctx.writeNote`/`ctx.helpers.renderTemplate`.

- [ ] **Step 2: Write `seed/seed.js`** — programmatic seed that writes `spice/home/Home.md` once, rendering `content/home-template.md` (fallback to a minimal chrome body on render error, like daily's try/catch). Return `{ notesCreated }`. (Auto-discovered — no index edit.)

- [ ] **Step 3: Verify it loads.** `node -e "const s=require('./platform/blueprints/home/seed/seed.js'); if(typeof s.seed!=='function') throw 'no seed fn'; console.log('ok')"` — Expected `ok`.

- [ ] **Step 4: Commit.** `git add -A && git commit -m "test(home): seed-vault fixture for Home.md"`

---

## Task 9: Harness registration + full preflight

**Files:**
- Modify: `package.json` (release:preflight chain), ensure `platform/test/run-home.js` exists

- [ ] **Step 1: Register the harness** — add `node platform/test/run-home.js` into the `release:preflight` chain in `package.json` (place it near the other blueprint harnesses, e.g. after `run-wiki.js`). If a `test:home` shorthand pattern is used by neighbors, add that too and reference it.

- [ ] **Step 2: Run the home harness alone.** `node platform/test/run-home.js` — Expected: all PASS (verdict block prints 0 failures).

- [ ] **Step 3: Run full preflight.** `npm run release:preflight` — Expected: green. Fix any linter hits (check-version-sync must see `home@0.1.0` in both blueprint manifest + platform/manifest.json; lint-schemas; lint-note-chrome for the new template; lint-cold-load for the new customjs). Iterate until green.

- [ ] **Step 4: Run bumped preflight.** Ensure a clean tree (`git status`), then `npm run release:preflight-bumped` — Expected: green (compute-release regenerates the version snapshot including `home`). If it dirties the tree, `git checkout -- .` after (the pipeline owns those writes) — do NOT commit bumper output.

- [ ] **Step 5: Commit** any harness/registration changes. `git add -A && git commit -m "test(home): register run-home.js in preflight; green preflight + preflight-bumped"`

---

## Task 10: Mobile + reading-mode visual verification (Playwright)

- [ ] **Step 1:** Using a consumer vault copy or a static render harness, load `Home.md` in Reading view at **360px and 390px**, light + dark. (If a live vault render isn't feasible headless, render the `SpaceHome` HTML into a stub page and screenshot — the goal is to SEE the layout + animation end-state + capture band tap targets.)
- [ ] **Step 2:** Confirm: greeting reads well; capture buttons are full-width, ≥44px tall, not clipped; agenda + red overdue pill render; no horizontal scroll; dashboard sections stack. Capture screenshots and self-review.
- [ ] **Step 3:** Note any CSS fixes, apply, re-verify, commit.

---

## Task 11: Ship + deploy (orchestrator-run, not a subagent)

- [ ] Push branch; open PR (`gh pr create`) with a `feat(home):` title summarizing the cycle. Body links the design + plan docs.
- [ ] Wait for CI green. Merge the FEATURE PR (squash). Do NOT merge/tag the release PR — it auto-opens + auto-merges; `gh pr update-branch` it if it stalls behind the autoloop.
- [ ] After the release ships (tag `vX.Y.Z` + homebrew tap merged): `git fetch --tags && brew update && brew upgrade sauce`.
- [ ] `node scripts/autoloop/deploy.js run` — upgrades + verifies ero / accuris / headspace.
- [ ] Verify each vault: `.obsidian/plugins/homepage/data.json` `homepages["Main Homepage"].kind == "File"`, `.value == "spice/home/Home.md"`, `.openOnStartup == true`; daily `autorun == false`; `spice/home/Home.md` exists with chrome. Confirm `deploy.js` reports allOk.
- [ ] Update the headspace project doc (`spice/projects/sauce/docs/daily-notes/`) + auto-memory. Report back (user must `Cmd+R`).

---

## Self-review notes

- **Spec coverage:** greeting+capture+dashboard+launcher (Tasks 2/3, launcher via nav strip Task 0), animations (Task 4), shared date seam preserving past-daily review (Task 1), startup flip (Task 6), scaffold/heal (Task 5), no-finance (omitted by construction), one responsive Home / `separateMobile:false` (Task 6 leaves it false), cold-start refresh (Task 6 commands[]), safe nav button (Task 0, not in PINNED_SOURCES). ✓
- **Version discipline:** only the NEW `home` component hand-declares `0.1.0`; no existing version fields or snapshots hand-edited. ✓
- **Regression lock:** Task 1 Step 1 asserts the no-params path is unchanged. ✓
- **Uncertainty resolved at build:** the To-Do dialog API is grep-verified in Task 3 Step 1 before wiring. ✓
