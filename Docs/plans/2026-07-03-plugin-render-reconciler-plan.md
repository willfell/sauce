# Sauce plugin render reconciler — implementation plan

Design: `2026-07-03-plugin-render-reconciler-design.md`. Single-file change (the bundled plugin `main.js`) + tests. Ships via the already-subscribed `sauce-plugin` mechanism.

## Tasks
1. **`SaucePlugin.shouldReconcile(changedPath, activePath)`** (pure static) — `!!changedPath && changedPath !== activePath`. Test RC-1.
2. **Reconciler methods** on `SaucePlugin`:
   - `_installReconciler()` — `this.registerEvent(app.metadataCache.on('changed', …))` + `vault.on('rename'/'delete', …)`; guarded on `registerEvent`/`on` existing.
   - `_onVaultChange(path)` — resolve `workspace.getActiveFile()?.path`; if `shouldReconcile` → `_scheduleReconcile()`. Never-throw.
   - `_scheduleReconcile()` — debounce via injectable `_setTimeoutFn`/`_clearTimeoutFn` (default globals) + `_reconcileDelayMs` (500); reset the timer each call (coalesce).
   - `_fireReconcile()` — `app.commands.executeCommandById('dataview:dataview-force-refresh-views')` in try/catch (no-op if absent).
   - `onload()` calls `_installReconciler()` after class loading, wrapped so it never throws.
   Tests RC-2 (coalesce + fire), RC-3 (active-file skip), RC-4 (absent command no-throw), RC-5 (onload wiring).
3. **Export** `shouldReconcile` for the harness.
4. No ranch/seed sync (the plugin vendors to `.obsidian/plugins/sauce/` at install, not `ranch/scripts`). `main.js` stays non-class (customjs scanners skip it — PL-3).
5. Gates: `run-sauce-plugin` green; full `release:preflight` green; `release:preflight-bumped` PASS.

## Ship
PR (`feat(sauce-plugin): …`) → CI → merge → release → tap → `deploy.js run` (re-vendors the updated plugin via the bumped `sauce-plugin` pin) → verify `.obsidian/plugins/sauce/main.js` on each vault carries the reconciler. **User must fully RESTART Obsidian** to load it.
