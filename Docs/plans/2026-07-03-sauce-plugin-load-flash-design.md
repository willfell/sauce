# Sauce native plugin (L8) — kill the cold-load flash — design

**Date:** 2026-07-03
**Status:** Design → plan → subagent execution → ship to vaults (autonomous, no pre-deploy checkpoint per user)
**Scope:** A minimal first-party Obsidian plugin that populates `window.customJS` at `onload()` so the `customjs-guard` poll passes on the first iteration — killing the `loading…` flash on page open. Shipped as a NEW subscribable mechanism `sauce-plugin`. NOT the grand POC (public store / onboarding / absorbing SlashCommander+Templater — out of scope).

---

## 1. Problem & the lever
Every sauce widget dispatches through `ranch/views/customjs-guard/view.js`, which polls `window.customJS[Class]` up to 40×50ms (~2s) on cold vault load because Dataview renders a note before the CustomJS community plugin has registered `window.customJS`. The result is the `loading…` flash. Pure-JS can only *smooth* this (audit #3); it cannot remove it.

**The lever (proven by the POC):** a native plugin can populate `window.customJS[Class] = new Class()` in its own `onload()` — exactly what the CustomJS plugin does — BEFORE Dataview renders. Every existing `dv.view("customjs-guard", {class})` call keeps working with **zero renderer edits**; the guard poll passes on iteration 0.

## 2. Safety story (why this can't regress — critical for a live-vault change)
- **CustomJS stays enabled as a fallback.** Both the sauce plugin and the CustomJS plugin populate `window.customJS` (idempotent — same classes, re-assigned). If the sauce plugin fails to load, errors, or loses the startup race, CustomJS still loads the classes and the guard poll still works. **Worst case = today's behavior.**
- **The plugin ONLY instantiates classes** (`new Class()`), exactly like CustomJS. It does NOT run `startupScriptNames` inits (those stay owned by CustomJS) — so no double-init of the side-effecting startup scripts (ProjectTaskCreateListenerInit, KanbanStatusSyncInit, …). Their side effects live in an `init()` method CustomJS calls, not in the constructor.
- **Per-file eval is caught** — a non-class or bad file is recorded in a failures list, never throws out of `onload`.
- **Honest limit:** whether the plugin actually loads + wins the race in real Obsidian is NOT headlessly verifiable. The headless tests prove the vendoring + the class-loader; the felt flash-fix is confirmed by the user on reload. Because of the fallback, an unverified-but-shipped plugin is safe.

## 3. Architecture — a subscribable mechanism that vendors a bundled plugin

### The plugin (hand-written, no build step — tiny + maintainable)
- `platform/mechanisms/sauce-plugin/plugin/manifest.json` — Obsidian plugin manifest: `{ id:"sauce", name:"Sauce", version, minAppVersion:"1.4.0", description, author:"willfell", isDesktopOnly:false }`.
- `platform/mechanisms/sauce-plugin/plugin/main.js` — a CommonJS Obsidian plugin (`module.exports` a class extending `require("obsidian").Plugin`) whose `onload()`:
  1. `window.customJS = window.customJS || {}`.
  2. Walk `ranch/scripts/**/*.js` via `this.app.vault.adapter.list/read` (the POC's `loadCustomJsClasses`).
  3. For each file whose first real token is `class`, `eval("(" + body + ")")` → `new Def()` → `window.customJS[Def.name] = instance` (the POC's `registerAll`/`instantiateClass`). Per-file try/catch → failures array (never throws).
  Does NOT touch `startupScriptNames`. Logs a one-line summary to console.

### The mechanism manifest (`platform/mechanisms/sauce-plugin/manifest.json`)
- `{ name:"sauce-plugin", version:"0.1.0", description, files:[], bundled_plugin:{ id:"sauce", source_dir:"plugin", files:["manifest.json","main.js"] } }`.
- `files:[]` (empty) — the mechanism materializes NOTHING to `{{scripts_path}}`; its whole job is the `bundled_plugin` vendoring. (Confirm the installer + registry tolerate an empty `files[]`; if not, the mechanism declares no files and the vendoring is driven purely by `bundled_plugin`.)

### The installer step (`applyBundledPlugin`, new)
Called in `installItem` immediately after `applyExternalPluginInstall` (install.js:1256), gated on `mech.bundled_plugin`:
1. Resolve the mechanism's plugin source dir: `path.join(__dirname, "mechanisms", mech.name, bp.source_dir)` (primary) / `path.join(workshopPath, "platform", "mechanisms", mech.name, bp.source_dir)` (fallback) — mirrors the bootstrap-lib resolution at install.js:13993.
2. For each `bp.files[]`, read from the source dir (node `fs`) and write to `.obsidian/plugins/<bp.id>/<file>` via `tp.app.vault.adapter.write` (mkdir the dir first via `adapter.mkdir`, ignore-exists). Overwrite is intended (version bump).
3. Enable: read `.obsidian/community-plugins.json` (JSON array). If absent/malformed → Notice + history warning, skip enabling (files still vendored). Else if `bp.id` not present → push it + write back (preserve all others). Idempotent.
4. Record history (event `bundled_plugin`), never throw (per-file try/catch like the other .obsidian steps).

### Subscription (opt-in; keeps the SEED unaffected)
- Add `{name:"sauce-plugin", version:"0.1.0"}` to the **workshop** `ranch/platform-subscription.json` (dogfood) and to **each of the 3 consumer vaults'** `ranch/platform-subscription.json` (deploy.js `sauce update` re-installs with the vault as CWD).
- Do NOT add it to `platform/test/seed-vault/ranch/platform-subscription.json` → the seed install never vendors the plugin → **no seed rebaseline, no run-seed / run-seed-migrations disruption.**
- Workshop dogfood: install will vendor into the workshop's own `.obsidian/plugins/sauce/` + add `"sauce"` to the workshop `.obsidian/community-plugins.json` — commit those tracked dogfood artifacts.

## 4. Gate interactions to handle (the "works first go" surface)
- **manifest schema** (`lint-schemas` / rule-schemas): add the optional `bundled_plugin` object to the mechanism-manifest schema so validation passes.
- **customjs-loadable / customjs-contract / render-guards**: these scan mechanism/blueprint `.js` for customJS classes and eval them. The plugin's `main.js` is an **Obsidian plugin** (`require("obsidian")`) — it must be **excluded** from those scans (it lives in a `plugin/` subdir; confirm the scanners don't recurse into it, or add an exclusion for `mechanisms/*/plugin/`).
- **registry** (`run-registry`) + **bumper** (`run-release-bumper`): a new mechanism component `sauce-plugin` must register + version cleanly (path-based attribution).
- **check-files-forbidden-paths**: scans manifest `files[].dest`; the plugin files aren't manifest `files[]` (vendored by the custom step) → not flagged. Verify.
- **run-install** (workshop dogfood): now vendors the plugin → assert it tolerates the `.obsidian/plugins/sauce/` write + the community-plugins.json addition.
- **coverage / harness registration**: register the new harness(es) so preflight runs them.

## 5. Testing (headless — the verifiable surface)
- **NEW `run-sauce-plugin.js`** (wired into preflight):
  - **Plugin class-loader** (adapt the POC `apps/sauce-plugin/test/plugin-runtime.headless.mjs`): mock `app.vault.adapter.list/read` over a fake `ranch/scripts` tree with class + non-class files; instantiate the real plugin; assert `window.customJS[Name]` populated for class files, non-class files skipped, a throwing file recorded in failures (never throws), and `startupScriptNames` NOT invoked.
  - **`applyBundledPlugin` vendoring** (temp `.obsidian` via a stub adapter): files written to `.obsidian/plugins/sauce/`, `"sauce"` appended to community-plugins.json, **idempotent** (2nd run no dup), **preserves other ids**, absent community-plugins.json → warn + files still written, malformed → warn + skip enable (no throw).
- Full `npm run release:preflight` green; `release:preflight-bumped` PASS; `npm run status` (dogfood) clean; no version literals hardcoded in tests.

## 6. Ship pipeline (same as prior cycles, autonomous)
worktree → TDD → PR (`feat(sauce-plugin): …`) → CI green → merge → release PR auto-merges → tag → tap PR auto-merges → `deploy.js run` (adds sauce-plugin subscription to the 3 vaults first, or the bumped subscription pins carry it) → verify all 3 vaults vendored `.obsidian/plugins/sauce/` + on the new version → report.

> **Subscription-on-consumers nuance** ([[lesson_new_blueprint_needs_consumer_subscription]]): a NEW mechanism is NOT auto-added to consumer subscriptions by the release. After the release ships, add `{name:"sauce-plugin",version}` to each consumer vault's `ranch/platform-subscription.json` and run `sauce update --force` with the vault as CWD (deploy.js runs `sauce update`; confirm it re-reads the subscription). Verify the plugin dir landed in each vault.

## 7. Out of scope
The grand POC vision (community-store publish, onboarding wizard, absorbing CustomJS/SlashCommander/Templater, native rendering replacing Dataview). This ships ONLY the load-flash lever with CustomJS retained as fallback.
