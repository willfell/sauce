# Landmines — traps we already hit

Read this before any new platform work. Every entry is a real failure we recovered from. Reintroducing one of these costs hours.

## CustomJS / Dataview integration (5 landmines)

### 1. Bare `customJS.X.Y(dv)` callsites cause cold-load `ReferenceError`

On cold vault load, Dataview/Templater render dataviewjs blocks before the CustomJS plugin populates `window.customJS`. Every bare callsite throws a red error flash before resolving.

**Fix:** never use the bare pattern. Always go through the customjs-guard view:
```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
```

### 2. `typeof customJS === 'undefined'` does NOT guard against the error

CustomJS declares its global with `let customJS = …`, putting the name in the **temporal dead zone** until the plugin initializes. TDZ is the one case where `typeof` itself throws a `ReferenceError`.

**Fix:** use `window.customJS?.X` — property access on `window` cannot hit TDZ.

### 3. Helper view file MUST NOT live in the CustomJS scan folder

The CustomJS plugin scans its `jsFolder` and tries to parse every `.js` file as a CustomJS class. A Dataview view file uses different syntax (top-level body, not a class). CustomJS hits a parse error and **aborts class registration entirely** — every customJS class in the vault goes dark.

**Fix:** view files live OUTSIDE the CustomJS scan folder. Canonical: `Docs/Meta/Views/`. ERO has a CLAUDE.md non-negotiable banning the legacy `Extras/Scripts/...` location for the same reason.

### 4. Dataview view files are NOT CommonJS modules

`dv.view` evaluates the script body inline with `dv` and `input` already in scope. A `module.exports = async (dv, input) => {…}` assignment runs without ever being invoked. Result: silent no-op, zero output, zero error.

**Fix:** view scripts are plain top-level statements. NO `module.exports` wrapper.

### 5. `dv.view` resolves a folder, not a single file

In Dataview 0.5.x, the reliable resolution is `dv.view("path/to/folder")` → loads `path/to/folder/view.js`. Single-file resolution (`dv.view("path/to/file")` → `path/to/file.js`) is unreliable.

**Fix:** every Dataview view ships as a folder containing `view.js` (and optional `view.css`).

## Platform installer (3 landmines)

### 6. Templater user scripts cannot reach Obsidian's `parseYaml`

The `obsidian` virtual module is registered for plugin code only. `require("obsidian")` from a Templater user script returns undefined / throws. So `parseYaml` and `stringifyYaml` are unavailable.

**Fix:** all platform metadata is JSON. `JSON.parse` is a built-in, no dependencies. Files affected: `platform-config.json`, `platform-subscription.json`, `platform-installed.json`, `platform/manifest.json`, each mechanism's `manifest.json`, `rules/_global.json`.

### 7. Templater requires a manual reload to pick up new user scripts

After the installer copies `validate.js` / `hook-validate.js` / `audit-walker.js` into the consumer's Templater scripts folder, Templater doesn't see them until "User Script Functions → reload" runs.

**Fix:** every install ends with a Notice instructing the user to reload. Built into the validator's manifest as a `post_install: { type: notice }` step.

### 8. Cross-vault filesystem reads need `require("fs")`, desktop only

The installer reads the workshop's manifest from outside its own vault. We use `require("fs").promises.readFile(absPath, "utf8")` — Node API available in desktop Templater. Obsidian mobile sandboxes the renderer differently and `fs` is unavailable.

**Fix:** the platform is desktop-first. Mobile is a future consideration; would require Obsidian Sync to deliver the workshop's files into each consumer's vault first (as a vendored copy), then the installer reads from `app.vault.adapter` instead of `fs`.

### 9. Installer substitution variables come ONLY from `platform-config.json:variables`

`substituteStrict` (paths) and `substituteLenient` (body content) in `install.js` both read from `paths.variables`, populated solely from each consumer's `platform-config.json:variables` map. They do NOT consume `variants.json`, the top-level `vault_identity` config field, or any other source. Placeholders like `{{vault_identity_tag}}` declared in a blueprint's content files will land literal in the materialized output unless that exact key is also in `variables`.

**Fix:** if a blueprint's content needs vault-specific tokenization (`vault_identity_tag`, etc.), either (a) drop the placeholder if location-scoping is sufficient (see project blueprint v0.2.0's kanban template — the file lives at `boards/To-Do-Board.md`, already vault-scoped), or (b) add the matching key to every consumer's `platform-config.json:variables` map. Future option (c): teach `install.js` to merge each blueprint's resolved variant from `variants.json` into the substitution variables — separate design pass.

Surfaced during v0.1.1 S3 quality review of `kanban-board.md`. See `Docs/plans/execution-logs/2026-05-03-registry-driven-nav-buttons/T3.1-T3.4-project-blueprint-v0.2.0.md` for the post-mortem.

### 11. Module-directory invariant under `beacon/` namespace — every blueprint owns ONE directory at `beacon/<module>/`

Every blueprint declares ONE directory at `beacon/<module_directory>/` in the consumer vault that it exclusively owns. All files the blueprint materializes (at install time via `files[]`, OR at runtime via templates / commands / nav-button actions creating notes) land under that directory. Cross-module data flows via wikilinks only — no module writes into another module's directory.

The `beacon/` parent namespace demarcates platform-managed content from the consumer's personal content. Consumers can keep any other top-level structure (e.g., accuris's `Timestamps/`, `Resources/`) without collision risk.

Each blueprint manifest declares `module_directory: "<name>"` (required field, enforced by installer in v0.2.0+). Examples: `beacon/boards/` for the boards blueprint, `beacon/to-do/` for a future to-do blueprint, `beacon/projects/` / `beacon/trips/` / `beacon/finance/` for future blueprints.

**Why it exists:**
1. Without the per-blueprint invariant, two blueprints could collide on directory names (e.g., the v0.1.1 project blueprint placed content under `boards/planning/<slug>/`, claiming a sub-tree of `boards/`, which conflicted with the future boards blueprint's territory).
2. Without the `beacon/` namespace, platform-managed content is interleaved with consumer-personal content at vault root — making install/update/uninstall surface harder to reason about, and risking accidental clobber of personal content.

Install / update / uninstall a blueprint = touch one directory at `beacon/<module>/`; predictable; cross-module collisions impossible by construction.

**Fix:** every blueprint manifest must declare `module_directory`. Installer derives the materialization root as `<vault_root>/beacon/<module_directory>/`. Refuses to install a blueprint manifest that lacks `module_directory` (failure-loud). Two blueprints declaring the same `module_directory` → installer Notice + skips the second (first-wins by install order); recorded as `warning, step: module_directory_collision`.

**Mechanisms exempt.** Mechanisms (cross-cutting code: `customjs-guard`, `validator`, `audit`, `nav-buttons`) are shared infrastructure that continues to land under `Docs/Meta/Scripts/`, `Docs/Meta/Views/`, `Docs/Meta/Templater/`, etc. — not module-scoped, not under `beacon/`.

**Known violations (legacy, awaiting future cycles):**
- project blueprint @ v0.2.0 places content under `boards/planning/<slug>/` (top-level `boards/`), mis-located on TWO axes: wrong namespace (no `beacon/` prefix) AND wrong module dir (lives under `boards/` instead of its own `projects/`). Resolved in a future cycle by migrating project to `beacon/projects/<slug>/`.
- v0.1.1's `boards/To-Do-Board.md` materialized at top-level `boards/`. v0.2.0's boards blueprint will materialize the new Kanban-plugin board at `beacon/boards/To-Do-Board.md` — the legacy file may need cleanup or coexist briefly during transition. Plan as part of v0.2.0 stage 4.

Surfaced during v0.1.1 S4 manual smokes (project's "Board" button being the wrong primitive); refined 2026-05-04 with the `beacon/` namespace decision; design at `Docs/plans/2026-05-03-boards-blueprint-design.md`.

### 10. Forcing the installer to re-process a manifest needs a triple version bump

`install.js:111` short-circuits per-item install when `subscribed.version === installed.version`. Tests that need to exercise behavior INSIDE `installItem()` (e.g., `applyNavButtons`, `applyRuleFragment`, file-write paths) cannot just edit the workshop manifest in place — the installer skips it.

**Fix (test mechanic):** to force re-processing of a single item under test, transiently bump THREE coordinated versions, run, then restore all three:
1. The item's own manifest (`platform/<kind>/<name>/manifest.json:version`).
2. The workshop manifest's entry for that item (`platform/manifest.json:<kind>[].<name>.version`).
3. The consumer subscription's entry (`<consumer>/Docs/Meta/platform-subscription.json:<kind>[].<name>.version`).

Restore-discipline is critical — partial restore leaves the workshop dogfood gate red. Verify each of the three is back to the canonical value AND re-run the workshop self-install harness AND re-run the consumer install harness before declaring the test complete. Surfaced in v0.1.1 S4 T4.8 (malformed nav_buttons entry negative test). See `Docs/plans/execution-logs/2026-05-03-registry-driven-nav-buttons/T4.0-T4.9-S4-harness-and-barebones-regression.md`.

**Fix (long-term, deferred):** consider adding `--force-reinstall <name>` to `install.js` for v0.1.2+ so test mechanics can skip the version-skip guard for a named item without touching three files. Not blocking; not free.

### 12. `.obsidian/plugin-data` ban-lift allowlist — only three paths, only via the installer, only with the four safety mechanics

The `.obsidian/` ask-before-acting gate is lifted for exactly three files:
- `.obsidian/plugins/templater-obsidian/data.json`
- `.obsidian/plugins/slash-commander/data.json`
- `.obsidian/daily-notes.json` (added in v0.3.0)

All three touched **only** by the installer, only via `applyTemplaterHotkeys` / `applySlashCommanderBindings` / `applyCorePluginSettings`, and only under all four of:

1. **Additive merge.** Never strip, modify, or reorder pre-existing entries; only append new entries the manifest declares.
2. **Backup on edit.** Write `<target>.beacon-backup` before any modification (one-deep, overwrite-on-edit, single backup per target).
3. **Malformed-JSON guard (C4 parity).** If the file is unreadable, unparseable, or has unexpected top-level shape (e.g., `enabled_templates_hotkeys` not an array, `bindings` not an array), the installer logs a warning history entry + surfaces a Notice + returns. NEVER overwrites a malformed file.
4. **Failure-loud history.** Every applied / skipped / warning / error path writes a history entry under `step: templater_hotkeys`, `step: slash_commander_bindings`, or `step: core_plugin_settings` with full context (manifest name, binding name / plugin id, template path / settings keys, message, attempted_at).

**Why the allowlist exists.** Templater's per-template `Insert <name>` commands are only registered when `enabled_templates_hotkeys[]` is populated; Slash Commander's slash bindings are persisted in its `data.json:bindings[]`; the core Daily Notes plugin reads `folder` / `format` / `template` from `.obsidian/daily-notes.json`. All three must be populated by the installer, OR the user has to do manual configuration the platform can otherwise fully automate. The three paths are the entire surface needed to deliver `/validate /audit /new-project` automatically AND ship the daily blueprint with its path convention pre-wired.

**Why nothing else.** Editing other `.obsidian/` files (workspace.json, hotkeys.json, other plugins' data.json) cuts across user-customizable territory the platform has no claim on. The allowlist is exhaustive: any future cycle proposing a fourth path requires (a) the same four safety mechanics, (b) updating CLAUDE.md + this landmine, (c) explicit user approval.

**Recovery.** If a `.beacon-backup` file diverges from the live data.json in a way the user wants to revert, copy the backup over the live file + reload Obsidian. Backups are not auto-rotated; manual cleanup is the consumer's call.

Surfaced 2026-05-04 during v0.1.x close (T2.1-discovery §8 + T2.6 deferral); codified in v0.1.3. Allowlist expanded from 2 → 3 paths in v0.3.0 to add `.obsidian/daily-notes.json` for the daily blueprint.

### 13. Bootstrap stub is content-static; never re-edit

Each consumer's `Docs/Meta/Templater/platformInstall.js` is a ~12-line dispatcher set once during v0.1.2 S2. It MUST be byte-identical across all consumers (`diff` between any two stubs returns empty). The stub never re-syncs with `platform/install.js` — that file is now canonical-only and reached at runtime via `require()`. If a future cycle wants to change the stub's contract (config-file path, error telemetry, etc.), every consumer's stub must be updated in lockstep AND the change documented as a distribution-model bump.

**Why:** the stub IS the new distribution mechanism. Drift in the stub breaks consumers silently — they'd dispatch to a different install.js path, or skip the require-cache clear, or read a different config. The stub's content-static invariant is the load-bearing replacement for the old md5-verified bootstrap-copy ritual.

**Canonical source:** `platform/installer-stub.js` — single source of truth for the stub body. Every consumer's bootstrap copy must match it byte-for-byte.

**Recovery from drift:** copy `platform/installer-stub.js` over the divergent consumer's bootstrap path; re-run harness; commit only the canonical source if its body changed.

Codified in v0.1.2.

### 14. `gitState()` is best-effort; must never throw

The `gitState()` helper at the top of `platform/install.js` records workshop git revision into installed.json history. It wraps every `execSync` in try/catch and returns `{commit:null, tag:null, dirty:null}` on any failure. Install proceeds regardless of git state — even on a non-git workshop, even on a missing `git` binary.

**Why:** install correctness must NOT depend on git correctness. The lean v0.1.2 model is "stub dispatches; install runs; we record what we can about workshop state." Coupling install success to git availability would block desktop-no-git scenarios and break workshop dogfood if anyone wiped `.git/`.

**What this means for callers:** code that READS `installed.history[].git_commit` etc. must tolerate `null` for entries written before v0.5.0 OR by a non-git install. Drift-detection (future cycle) treats `null` as "unknown," not "in sync" or "out of sync."

Codified in v0.1.2.

## Operational gotchas

### CustomJS scan folder is per-vault and configured in `.obsidian/plugins/customjs/data.json`

When canonically migrating a consumer to `Docs/Meta/Scripts/`, also update CustomJS's `jsFolder` setting. Editing that file is a `.obsidian/` change and needs explicit user approval (per each vault's CLAUDE.md "ask before acting" rule).

### Approval gates use Templater's `tp.system.suggester`

The suggester's "Esc" key returns null, which the installer treats as a skip (not an error). Files declined by the user are silently skipped; the mechanism continues with whatever else it can do. The `platform-installed.json` entry records the version even on partial installs — that's a known limitation. Resolution: treat partial installs as "good enough" for now; a future installer version can track per-file install state.

### Workshop content vault plugins emit warnings on workshop boot

Workshop has no daily notes, no kanban boards, no projects. If you leave Calendar / Big Calendar / Kanban / Daily Notes core plugin enabled, they fire warnings every time you open the workshop. Disable them in the workshop specifically (community plugins are per-vault, not synced via Obsidian Sync).

### Don't carry a bug across vaults

Every mechanism update goes through the workshop first, dogfoods on the workshop's own self-install, THEN promotes to consumers. If the workshop self-test fails, do not push the update into consumers. The workshop's "production" status validates the mechanism end-to-end.
