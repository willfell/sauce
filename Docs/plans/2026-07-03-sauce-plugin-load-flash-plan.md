# Sauce native plugin (L8) — Implementation Plan

> **For agentic workers:** subagent-driven where noted; the installer step + gate-wiring are author-directly (risky). TDD; frequent commits; sync ranch dogfood copies. Design: `Docs/plans/2026-07-03-sauce-plugin-load-flash-design.md`.

**Goal:** Ship a minimal first-party Obsidian plugin (mechanism `sauce-plugin`) that populates `window.customJS` at `onload()`, vendored into each vault's `.obsidian/plugins/sauce/` by the installer, killing the cold-load flash — with CustomJS retained as fallback (cannot regress).

**Guardrails:** never-throw; CustomJS stays enabled; seed-vault NOT subscribed (no rebaseline); every gate green before push; no hardcoded version literals in tests.

---

## Task 0 — recon (confirm before building)
- [ ] `grep -rn "class Plugin\|require(\"obsidian\")\|module.exports" platform/test/run-customjs-loadable.js platform/test/run-customjs-contract.js` — find how those scanners enumerate files; confirm they DON'T recurse into a `mechanisms/*/plugin/` subdir (or note the exclusion needed).
- [ ] Read the mechanism-manifest schema (`platform/rule-schemas/` or `schemas-index.json`) to find where to add optional `bundled_plugin`.
- [ ] Read the POC harness `git show poc/sauce-plugin:apps/sauce-plugin/test/plugin-runtime.headless.mjs` + `main.js` class-loader (`loadCustomJsClasses`, `registerAll`, `instantiateClass`, `firstRealToken`, `isClassFile`) to port verbatim.
- [ ] Confirm `installItem`'s per-item context: `mech` is the item manifest; `workshopPath` + `adapter` are in scope at install.js:1256.

## Task 1 — the plugin files (subagent OK; port from POC)
**Files:** `platform/mechanisms/sauce-plugin/plugin/manifest.json`, `platform/mechanisms/sauce-plugin/plugin/main.js`
- [ ] `manifest.json`: `{ "id":"sauce","name":"Sauce","version":"0.1.0","minAppVersion":"1.4.0","description":"Sauce runtime loader — registers customJS renderer classes at onload so views render on first paint (no cold-load flash). CustomJS remains the fallback.","author":"willfell","isDesktopOnly":false }`.
- [ ] `main.js`: CommonJS `module.exports` a `class SaucePlugin extends require("obsidian").Plugin` with `async onload()` that runs the ported `loadCustomJsClasses(this.app)` (walk `ranch/scripts`, eval class-files, assign `window.customJS[name]=new Def()`), never throwing, logging `Sauce: registered N classes (M failures)`. Port `firstRealToken`/`isClassFile`/`instantiateClass`/`registerAll` verbatim from the POC. Do NOT run startup inits.
- [ ] Commit `feat(sauce-plugin): bundled Obsidian plugin — onload customJS class loader (kills cold-load flash; CustomJS stays fallback)`.

## Task 2 — the mechanism manifest + schema (author-directly)
**Files:** `platform/mechanisms/sauce-plugin/manifest.json`, mechanism-manifest schema
- [ ] `manifest.json`: `{ "name":"sauce-plugin","version":"0.1.0","description":"…","files":[],"bundled_plugin":{"id":"sauce","source_dir":"plugin","files":["manifest.json","main.js"]} }`.
- [ ] Extend the mechanism-manifest schema to allow optional `bundled_plugin:{id,source_dir,files[]}` (additive; keep other constraints).
- [ ] `node scripts/lint-schemas.js` green; `node platform/test/run-registry.js` green (new mechanism registers). If empty `files:[]` trips a gate, adjust (e.g. omit `files` if the schema requires ≥1, or add a schema allowance).
- [ ] Commit `feat(sauce-plugin): mechanism manifest + bundled_plugin schema`.

## Task 3 — exclude the plugin from customjs class scanners (author-directly)
**Files:** whichever of `run-customjs-loadable.js` / `run-customjs-contract.js` / `run-*-render-guards.js` / `lint-cold-load.js` enumerate mechanism `.js`
- [ ] Add a path exclusion for `mechanisms/*/plugin/**` (the plugin `main.js` is an Obsidian plugin, not a customJS class — evaling it as a class would `require("obsidian")` and fail).
- [ ] `node platform/test/run-customjs-loadable.js` + `run-customjs-contract.js` green.
- [ ] Commit `test(sauce-plugin): exclude bundled-plugin dir from customJS class scanners`.

## Task 4 — `applyBundledPlugin` installer step (author-directly; TDD)
**Files:** `platform/install.js` (new fn + call at ~1257), `platform/test/run-sauce-plugin.js` (new)
- [ ] **RED:** write `run-sauce-plugin.js` vendoring cases against a stub adapter (`exists`/`read`/`write`/`mkdir` over an in-memory map) + a stub `fs` for the source read:
  - BP-1 files written to `.obsidian/plugins/sauce/manifest.json` + `main.js` (content matches source).
  - BP-2 `"sauce"` appended to community-plugins.json; other ids preserved; idempotent (2nd run: no dup, still 1 write-or-noop).
  - BP-3 community-plugins.json absent → files still written, warning recorded, no throw.
  - BP-4 malformed community-plugins.json → files written, enable skipped, warning, no throw.
  - BP-5 no `bundled_plugin` on manifest → no-op.
- [ ] **Implement** `async function applyBundledPlugin(tp, mech, vaultPath, workshopPath, history, git)`: gate on `mech.bundled_plugin`; resolve source dir (`__dirname/mechanisms/<name>/<source_dir>` → workshopPath fallback); for each file `fs.readFileSync(src)` → `adapter.mkdir(".obsidian/plugins/<id>")`(ignore-exists) → `adapter.write(".obsidian/plugins/<id>/<file>", content)`; then read/patch community-plugins.json (add id if absent, preserve others, malformed/absent → warn+skip); history + never-throw. Wire the call at install.js:1257 (after `applyExternalPlugins`).
- [ ] **GREEN**; commit `feat(sauce-plugin): applyBundledPlugin installer step (vendor + enable, idempotent, never-throw)`.

## Task 5 — plugin class-loader headless test (subagent OK; port POC harness)
**Files:** `platform/test/run-sauce-plugin.js` (extend)
- [ ] Port the POC `plugin-runtime.headless.mjs`: mock `app.vault.adapter.list/read` over a fake `ranch/scripts` tree (a class file, a non-class file, a throwing file); load the REAL `platform/mechanisms/sauce-plugin/plugin/main.js`; instantiate + `await onload()`; assert:
  - PL-1 `window.customJS.Foo` is an instance for the class file.
  - PL-2 non-class file skipped; PL-3 throwing/bad file recorded, `onload` did not throw.
  - PL-4 `startupScriptNames` NOT read/invoked (no side-effecting init run).
- [ ] Wire `run-sauce-plugin.js` into `release:preflight`. GREEN; commit `test(sauce-plugin): headless class-loader + vendoring harness + preflight wiring`.

## Task 6 — subscribe the workshop dogfood + sync (author-directly)
- [ ] Add `{"name":"sauce-plugin","version":"0.1.0"}` to the workshop `ranch/platform-subscription.json` (NOT the bumper's job — subscription membership is authored; the bumper only bumps the pin).
- [ ] `npm run status` (dogfood install) → vendors into the workshop `.obsidian/plugins/sauce/` + adds `"sauce"` to workshop `.obsidian/community-plugins.json`. Commit those dogfood artifacts.
- [ ] Confirm `run-install.js` tolerates the new `.obsidian/plugins/sauce/` write (workshop subscribes now).
- [ ] Commit `feat(sauce-plugin): subscribe workshop dogfood + vendored artifacts`.

## Task 7 — full gates (author-directly)
- [ ] `npm run release:preflight` fully green (incl. new run-sauce-plugin, registry, schema, loadable, contract, render-guards, run-install, seed — seed unaffected since not subscribed).
- [ ] On a clean tree: `npm run release:preflight-bumped` PASS.
- [ ] No hardcoded version literals added to tests.
- [ ] `git merge origin/main` (autoloop churn); re-run preflight if it moved.

## Task 8 — final review + ship (author-directly)
- [ ] Dispatch a final code-reviewer over the diff (never-throw, community-plugins.json surgery preserves others, no double-init, seed untouched).
- [ ] Push; open PR `feat(sauce-plugin): native plugin registers customJS at onload — kills the cold-load flash`. Body: lever, safety/fallback, headless coverage, the honest "real-Obsidian load confirmed on reload" note, the visible-change=none.
- [ ] CI green (preflight macos+ubuntu) → merge feature PR (squash). Do NOT touch the release PR.
- [ ] Monitor: release PR auto-merges → tag → tap PR auto-merges.
- [ ] **Deploy** (the new-mechanism nuance — [[lesson_new_blueprint_needs_consumer_subscription]]):
  - `deploy.js run` upgrades brew + bumps existing pins on the 3 vaults, but will NOT add the new mechanism. So FIRST add `{"name":"sauce-plugin","version":"<shipped>"}` to each of ero/accuris/headspace `ranch/platform-subscription.json`, then `cd <vault> && sauce update --force` per vault (PATH incl `/opt/homebrew/bin`).
  - Verify each vault has `.obsidian/plugins/sauce/{main.js,manifest.json}` + `"sauce"` in its `.obsidian/community-plugins.json` + is on the shipped version.
- [ ] Report: shipped + vendored to all 3 vaults; user must reload Obsidian (Cmd+R or restart) to load the new plugin; confirm the flash is gone.

## Self-review notes
- Symbols: `bundled_plugin{id,source_dir,files}`, `applyBundledPlugin`, plugin id `sauce`, dir `.obsidian/plugins/sauce/`, mechanism `sauce-plugin`. Consistent across tasks.
- Seed isolation is the key risk-control: seed subscription is NOT touched → run-seed/run-seed-migrations unaffected.
- Fallback (CustomJS enabled) is the key safety: the change cannot regress even if the plugin never loads.
