# Landmines — traps we already hit

Read this before any new platform work. Every entry is a real failure we recovered from. Reintroducing one of these costs hours.

## CustomJS / Dataview integration (5 landmines)

### 1. Bare `customJS.X.Y(dv)` callsites cause cold-load `ReferenceError`

On cold vault load, Dataview/Templater render dataviewjs blocks before the CustomJS plugin populates `window.customJS`. Every bare callsite throws a red error flash before resolving.

**Fix:** never use the bare pattern. Always go through the customjs-guard view:
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

### 2. `typeof customJS === 'undefined'` does NOT guard against the error

CustomJS declares its global with `let customJS = …`, putting the name in the **temporal dead zone** until the plugin initializes. TDZ is the one case where `typeof` itself throws a `ReferenceError`.

**Fix:** use `window.customJS?.X` — property access on `window` cannot hit TDZ.

### 3. Helper view file MUST NOT live in the CustomJS scan folder

The CustomJS plugin scans its `jsFolder` and tries to parse every `.js` file as a CustomJS class. A Dataview view file uses different syntax (top-level body, not a class). CustomJS hits a parse error and **aborts class registration entirely** — every customJS class in the vault goes dark.

**Fix:** view files live OUTSIDE the CustomJS scan folder. Canonical: `ranch/views/`. ERO has a CLAUDE.md non-negotiable banning the legacy `Extras/Scripts/...` location for the same reason.

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

### 8. Cross-vault filesystem reads need `require("fs")`, desktop only — `install.js` is filesystem-only; `bootstrap.js` (v0.21.0+) is the network gateway

The installer reads the workshop's manifest from outside its own vault. We use `require("fs").promises.readFile(absPath, "utf8")` — Node API available in desktop Templater. Obsidian mobile sandboxes the renderer differently and `fs` is unavailable.

**Fix:** the platform is desktop-first. Mobile is a future consideration; would require Obsidian Sync to deliver the workshop's files into each consumer's vault first (as a vendored copy), then the installer reads from `app.vault.adapter` instead of `fs`.

**v0.21.0 amendment:** `install.js` is desktop-only AND filesystem-only — never makes network calls. `bootstrap.js` is the platform's network gateway and may make HTTPS calls to GitHub releases (community-plugins index + per-plugin manifest/main.js/styles.css). Bootstrap's network posture is governed by landmine #17.

### 9. Installer substitution variables come ONLY from `platform-config.json:variables`

`substituteStrict` (paths) and `substituteLenient` (body content) in `install.js` both read from `paths.variables`, populated solely from each consumer's `platform-config.json:variables` map. They do NOT consume `variants.json`, the top-level `vault_identity` config field, or any other source. Placeholders like `{{vault_identity_tag}}` declared in a blueprint's content files will land literal in the materialized output unless that exact key is also in `variables`.

**Fix:** if a blueprint's content needs vault-specific tokenization (`vault_identity_tag`, etc.), either (a) drop the placeholder if location-scoping is sufficient (see project blueprint v0.2.0's kanban template — the file lives at `boards/To-Do-Board.md`, already vault-scoped), or (b) add the matching key to every consumer's `platform-config.json:variables` map. Future option (c): teach `install.js` to merge each blueprint's resolved variant from `variants.json` into the substitution variables — separate design pass.

Surfaced during v0.1.1 S3 quality review of `kanban-board.md`. See `Docs/plans/execution-logs/2026-05-03-registry-driven-nav-buttons/T3.1-T3.4-project-blueprint-v0.2.0.md` for the post-mortem.

### 11. Module-directory invariant under `spice/` namespace — every blueprint owns ONE directory at `spice/<module>/`

Every blueprint declares ONE directory at `spice/<module_directory>/` in the consumer vault that it exclusively owns. All files the blueprint materializes (at install time via `files[]`, OR at runtime via templates / commands / nav-button actions creating notes) land under that directory. Cross-module data flows via wikilinks only — no module writes into another module's directory.

The `spice/` parent namespace demarcates platform-managed content from the consumer's personal content. Consumers can keep any other top-level structure (e.g., accuris's `Timestamps/`, `Resources/`) without collision risk.

Each blueprint manifest declares `module_directory: "<name>"` (required field, enforced by installer in v0.2.0+). Examples: `spice/boards/` for the boards blueprint, `spice/to-do/` for a future to-do blueprint, `spice/projects/` / `spice/trips/` / `spice/finance/` for future blueprints.

**Why it exists:**
1. Without the per-blueprint invariant, two blueprints could collide on directory names (e.g., the v0.1.1 project blueprint placed content under `boards/planning/<slug>/`, claiming a sub-tree of `boards/`, which conflicted with the future boards blueprint's territory).
2. Without the `spice/` namespace, platform-managed content is interleaved with consumer-personal content at vault root — making install/update/uninstall surface harder to reason about, and risking accidental clobber of personal content.

Install / update / uninstall a blueprint = touch one directory at `spice/<module>/`; predictable; cross-module collisions impossible by construction.

**Fix:** every blueprint manifest must declare `module_directory`. Installer derives the materialization root as `<vault_root>/spice/<module_directory>/`. Refuses to install a blueprint manifest that lacks `module_directory` (failure-loud). Two blueprints declaring the same `module_directory` → installer Notice + skips the second (first-wins by install order); recorded as `warning, step: module_directory_collision`.

**Mechanisms exempt.** Mechanisms (cross-cutting code: `customjs-guard`, `validator`, `audit`, `nav-buttons`) are shared infrastructure that continues to land under `ranch/scripts/`, `ranch/views/`, `ranch/templater/`, etc. — not module-scoped, not under `spice/`.

**Historical violations (resolved):**
- project blueprint @ v0.2.0 placed content under `boards/planning/<slug>/` (top-level `boards/`), mis-located on TWO axes: wrong namespace (no `beacon/` prefix at the time) AND wrong module dir (under `boards/` instead of its own `projects/`). RESOLVED in v0.5.0 (project port to `beacon/projects/<slug>/`) and renamed to `spice/projects/<slug>/` in v0.25.0. Retained here for historical context.
- v0.1.1's `boards/To-Do-Board.md` materialized at top-level `boards/`. v0.2.0's boards blueprint materialized the new Kanban-plugin board at `beacon/boards/To-Do-Board.md` (now `spice/boards/To-Do-Board.md` post-v0.25.0); legacy top-level file cleaned up via `pre_install` delete in v0.2.0 stage 4. RESOLVED.

Surfaced during v0.1.1 S4 manual smokes (project's "Board" button being the wrong primitive); refined 2026-05-04 with the namespace decision (originally `beacon/<module>/`); namespace renamed to `spice/<module>/` in v0.25.0 as part of the Sauce rebrand sequence. The invariant itself was unchanged across the rename — each blueprint owns ONE directory under the namespace; cross-module data flows via wikilinks only. Only the namespace dir name changed (`beacon/` → `spice/`).

Design + history: `Docs/plans/2026-05-03-boards-blueprint-design.md` (origin), `Docs/plans/2026-05-07-v0.25.0-tree2-namespace-rename-design.md` (rename cycle).

> [!success] v0.25.0 — Tree 2 rename shipped
> `beacon/<module>/` → `spice/<module>/` end-to-end across `install.js:250` (the single source-of-truth prefix line), all blueprint helpers, all templates, all docs. Final of three multi-cycle Sauce rebrand renames (Tree 1 = `Beacon/` → `pantry/` in v0.23.0; Tree 3 = `Docs/Meta/` → `ranch/` in v0.24.0). The `pantry/` + `ranch/` + `spice/` namespace tripod is now COMPLETE. Bundled `.beacon-backup` → `.sauce-backup` suffix rename under fresh-start posture (no legacy consumer state to preserve).

### 10. Forcing the installer to re-process a manifest needs a triple version bump

`install.js:223` short-circuits per-item install when `installedEntry.version === node.sub.version` (see landmine #16 for the literal call-site quote). Tests that need to exercise behavior INSIDE `installItem()` (e.g., `applyNavButtons`, `applyRuleFragment`, file-write paths) cannot just edit the workshop manifest in place — the installer skips it.

**Fix (test mechanic):** to force re-processing of a single item under test, transiently bump THREE coordinated versions, run, then restore all three:
1. The item's own manifest (`platform/<kind>/<name>/manifest.json:version`).
2. The workshop manifest's entry for that item (`platform/manifest.json:<kind>[].<name>.version`).
3. The consumer subscription's entry (`<consumer>/ranch/platform-subscription.json:<kind>[].<name>.version`).

Restore-discipline is critical — partial restore leaves the workshop dogfood gate red. Verify each of the three is back to the canonical value AND re-run the workshop self-install harness AND re-run the consumer install harness before declaring the test complete. Surfaced in v0.1.1 S4 T4.8 (malformed nav_buttons entry negative test). See `Docs/plans/execution-logs/2026-05-03-registry-driven-nav-buttons/T4.0-T4.9-S4-harness-and-barebones-regression.md`.

**Fix (long-term, deferred):** consider adding `--force-reinstall <name>` to `install.js` for v0.1.2+ so test mechanics can skip the version-skip guard for a named item without touching three files. Not blocking; not free.

### 12. `.obsidian/plugin-data` ban-lift allowlist + `.claude/skills/` skill-materialization carve-out + `.claude/commands/` slash-command carve-out + `.claude/{commands,skills}.local/` override-shadow carve-outs + `ranch/claude-surface-registry.json` + `CLAUDE.md` marker-region carve-out — 17 paths + CLAUDE.md marker regions, only via the installer/bootstrap, only with the four safety mechanics

The `.obsidian/` ask-before-acting gate is lifted for exactly thirteen paths, PLUS five peer top-level / out-of-`.obsidian/` zones (`.claude/skills/<subtree>` added in v0.30.0; `.claude/commands/<x>.md` added in v0.31.0 S6.8; `.claude/commands.local/<x>.md` + `.claude/skills.local/<bp>/<skill>/SKILL.md` + `ranch/claude-surface-registry.json` added in v0.32.0; see end of this entry), PLUS marker-region writes inside `CLAUDE.md` (v0.32.0; renderer rewrites only the spans between `<!-- @claude-surface:<table> BEGIN -->` ... `<!-- @claude-surface:<table> END -->` markers — outside-marker content preserved bit-for-bit):
- `.obsidian/plugins/templater-obsidian/data.json`
- `.obsidian/plugins/slash-commander/data.json`
- `.obsidian/daily-notes.json` (added in v0.3.0)
- `.obsidian/themes/<Name>/` (added in v0.19.0 — vendored theme dir; overwrite-with-backup posture, NOT additive merge)
- `.obsidian/appearance.json` (added in v0.19.0 — `cssTheme` always overridden; `enabledCssSnippets[]` additive union)
- `.obsidian/plugins/obsidian-style-settings/data.json` (added in v0.19.0 — additive per-key first-wins; user values preserved over canonical defaults)
- `.obsidian/plugins/<id>/main.js` (added in v0.21.0 — bootstrap-fetched plugin entry-point; overwrite-with-backup `.sauce-backup` only when force-redownload selected)
- `.obsidian/plugins/<id>/manifest.json` (added in v0.21.0 — bootstrap-fetched plugin manifest; same posture)
- `.obsidian/plugins/<id>/styles.css` (added in v0.21.0 — bootstrap-fetched plugin styles; same posture; 404-tolerated)
- `.obsidian/plugins/dataview/data.json` (added in v0.21.1 — Dataview JS enable; additive shallow merge per `applyCommunityPluginData`; broadened prereq gate via `external_plugins[{id:"dataview"}]`)
- `.obsidian/hotkeys.json` (added in v0.21.1 — global Obsidian hotkeys; additive per-`command_id` first-wins; never modifies pre-existing user binding)
- `.obsidian/plugins/customjs/data.json` (added in v0.24.0 CF-3 — CustomJS `jsFolder` setting must match consumer's `scripts_path`; surgical migration of legacy `Docs/Meta/Scripts` value to current `scripts_path`; preserves user-customized `jsFolder` if set to anything else)
- `.obsidian/app.json` (added in v0.26.1 — core Obsidian app settings; **additive shallow merge with platform-as-overrider posture for declared keys**; non-declared keys preserved verbatim. Diverges from `applyHotkeys` first-wins because platform DECLARES `alwaysOpenInNewTab: true` as a vault baseline, not as a user-override-protectable hint.)

All thirteen touched **only** by the installer, only via `applyTemplaterHotkeys` / `applySlashCommanderBindings` / `applyTemplaterFolderTemplates` / `applyCorePluginSettings` / `applyVendoredThemes` / `applyAppearance` / `applyStyleSettings` / `applyCommunityPluginData` / `applyHotkeys` / `applyCustomJsSettings` / `applyAppSettings`, and only under all four of:

1. **Additive merge.** Never strip, modify, or reorder pre-existing entries; only append new entries the manifest declares. **Exception (v0.19.0 vendored themes only):** `.obsidian/themes/<Name>/` files use sha256-compare overwrite-with-backup (`.bak` suffix; non-empty prior content backed up before write). Theme files are platform-canonical content; consumers customize via Style Settings JSON or `.obsidian/snippets/`.
2. **Backup on edit.** Write `<target>.sauce-backup` (or `<file>.bak` for the vendored-themes path) before any modification (one-deep, overwrite-on-edit, single backup per target).
3. **Malformed-JSON guard (C4 parity).** If the file is unreadable, unparseable, or has unexpected top-level shape (e.g., `enabled_templates_hotkeys` not an array, `bindings` not an array, parsed-but-not-an-object), the installer logs an error history entry + surfaces a Notice + returns. NEVER overwrites a malformed file.
4. **Failure-loud history.** Every applied / skipped / warning / error path writes a history entry under `step: templater_hotkeys`, `step: slash_commander_bindings`, `step: core_plugin_settings`, `step: theme_overwrite`, `step: appearance`, `step: style_settings`, `step: community_plugin_data`, `step: hotkeys`, `step: customjs_settings`, or `step: app_settings` with full context (manifest name, binding name / plugin id / command_id, template path / settings keys, theme name / dest, message, attempted_at).

**Why the allowlist exists.** Templater's per-template `Insert <name>` commands are only registered when `enabled_templates_hotkeys[]` is populated; Slash Commander's slash bindings are persisted in its `data.json:bindings[]`; the core Daily Notes plugin reads `folder` / `format` / `template` / `autorun` from `.obsidian/daily-notes.json`; the Baseline community theme is canonical platform content materialized at `.obsidian/themes/Baseline/`; the active theme + enabled CSS snippets are persisted in `.obsidian/appearance.json`; the canonical Style Settings JSON (rose-pine-light + melange-dark + 38 keys) is persisted in `.obsidian/plugins/obsidian-style-settings/data.json`; Dataview's `enableDataviewJs` / `enableInlineDataviewJs` toggles live in `.obsidian/plugins/dataview/data.json`; global Obsidian hotkeys live in `.obsidian/hotkeys.json`. All eleven must be populated by the installer, OR the user has to do manual configuration the platform can otherwise fully automate. The eleven paths are the entire surface needed to deliver `/validate /audit /new-project` automatically + ship the daily blueprint with its path convention pre-wired + ship the canonical Sauce look-and-feel out of the box + auto-enable Dataview JS + bind the consumer-convenience hotkeys (Cmd+- / Cmd+= / Cmd+[).

**Why nothing else.** Editing other `.obsidian/` files (workspace.json, other plugins' data.json) cuts across user-customizable territory the platform has no claim on. The allowlist is exhaustive: any future cycle proposing a fourteenth path requires (a) the same four safety mechanics, (b) updating CLAUDE.md + this landmine, (c) explicit user approval. (`.obsidian/app.json` joined the allowlist in v0.26.1 — see history below.)

**Recovery.** If a `.sauce-backup` (additive-merge paths) or `.bak` (vendored-themes path) file diverges from the live target in a way the user wants to revert, copy the backup over the live file + reload Obsidian. Backups are not auto-rotated; manual cleanup is the consumer's call.

Surfaced 2026-05-04 during v0.1.x close (T2.1-discovery §8 + T2.6 deferral); codified in v0.1.3. Allowlist expanded from 2 → 3 paths in v0.3.0 to add `.obsidian/daily-notes.json` for the daily blueprint. Allowlist UNCHANGED in v0.4.0 (still 3 paths); helper count grew 3 → 4 with `applyTemplaterFolderTemplates` (writes to the same templater data.json as `applyTemplaterHotkeys`, just to a new top-level field `folder_templates[]`). Allowlist expanded from 3 → 6 paths in v0.19.0 to add `.obsidian/themes/<Name>/`, `.obsidian/appearance.json`, and `.obsidian/plugins/obsidian-style-settings/data.json` for the styling mechanism; helper count grew 4 → 7 with `applyVendoredThemes` (sha256-compare overwrite-with-backup; new `.bak` suffix exception to mechanic #1) + `applyAppearance` (cssTheme always overridden; enabledCssSnippets additive union) + `applyStyleSettings` (per-key first-wins merge — user values preserved over canonical defaults). All three v0.19.0 helpers gate on `manifest.external_plugins[].required` IDs being present in `.obsidian/community-plugins.json`; absent prereq → `info/{theme_overwrite,appearance,style_settings}` + `action: "skipped_missing_prereq"` + zero writes. Allowlist expanded from 6 → 9 paths in v0.21.0 to add `.obsidian/plugins/<id>/{main.js,manifest.json,styles.css}` for the bootstrap-fetched plugin entry-point/manifest/styles; bootstrap is the platform's only network gateway, install.js stays filesystem-only (landmine #17). Allowlist expanded from 11 → 12 paths in v0.24.0 (CF-3 of Tree 3 rename) to add `.obsidian/plugins/customjs/data.json` for the new `applyCustomJsSettings` helper (helper count 9 → 10) — runs ONCE per install run (not per-item) since CustomJS jsFolder is platform-wide, not per-mechanism. Surgical migration: writes `jsFolder = variables.scripts_path` ONLY when current value is absent OR the legacy v0.23.x string `"Docs/Meta/Scripts"`; any other user-customized value is preserved + skipped via `info/skipped_user_customized` history. Backup-on-edit `.sauce-backup` per mechanic #2. Plugin-dir-absent → `info/skipped_missing_prereq`. Allowlist expanded from 9 → 11 paths in v0.21.1 to add `.obsidian/plugins/dataview/data.json` and `.obsidian/hotkeys.json` for the convenience@0.1.0 mechanism; helper count grew 7 → 9 with `applyCommunityPluginData` (additive shallow merge; substituteLenient round-trip; path-traversal validator on `id`; plugin-dir-absent skip; broadened prereq gate that short-circuits on ANY declared `external_plugins[]` id absent from `.obsidian/community-plugins.json` regardless of `required:true` flag — divergent from the v0.19.0 styling helpers' interpretation, justified because materializing settings into a missing plugin's data.json would be a wasted write and risks silent drift on next consumer reload) + `applyHotkeys` (additive per-`command_id` first-wins; FIRST-WINS protects pre-existing user bindings — never modifies any binding the consumer has already set). Allowlist UNCHANGED at 12 in v0.25.0; backup-suffix renamed `.beacon-backup` → `.sauce-backup` as part of the Sauce rebrand (Tree 2 cycle). v0.23.0 + v0.24.0's "preserve `.beacon-backup` across rename" lessons retired under fresh-start posture (no legacy consumer state to preserve). Allowlist expanded from 12 → 13 paths in v0.26.1 to add `.obsidian/app.json` for the new `applyAppSettings` helper (helper count 11 → 12) — workshop-level helper (NOT per-item; mirrors v0.24.0 `applyCustomJsSettings` posture). Schema field is workshop-manifest-level `app_settings: { alwaysOpenInNewTab: true }` (NOT per-blueprint). Posture diverges from the additive-merge first-wins helpers: declared keys are platform-as-overrider (always overwritten by the manifest value); non-declared keys preserved verbatim. Justified because `alwaysOpenInNewTab` is a vault baseline the platform commits to, not a user-override-protectable hint. Backup-on-edit `.sauce-backup` per mechanic #2; atomic tmp+rename write; malformed-JSON guard surfaces Notice + zero writes; backup-failure aborts modification. Allowlist UNCHANGED at 13 paths in v0.27.0 — purely additive cycle (NEW `people-rendering@0.1.0` mechanism + NEW `people@0.1.0` blueprint + cards@0.2.4 subtitle-callback PATCH + nav-buttons@2.5.3 people-icon PATCH + meetings@0.3.0 chip-rendering pilot — none touch `.obsidian/`); helper count UNCHANGED at 12; mechanism count 8 → 9; blueprint count 8 → 9; landmines list UNCHANGED at 19 entries.

**v0.31.0 S6.8 — fifteenth sanctioned write zone: `.claude/commands/<name>.md`.** The cowork blueprint adds a `commands/` source subtree + a files[] entry shipping `commands/cowork.md` → `.claude/commands/cowork.md` so Claude Code's slash-command surface auto-includes `/cowork` after install (no hand-copy). Scope: per-blueprint, dest path `.claude/commands/<name>.md` (vault-root-relative). The materialization uses the existing files[] loop in `installItem` — NO new helper (zero helper-count change). Safety mechanics inherit the files[] posture: Option B overwrite + `.bak` on edit, identical-content idempotent skip, failure-loud history (`step: file_overwrite`). The carve-out is conceptual cohesion with the v0.30.0 `.claude/skills/<subtree>` carve-out — both write outside the user's authored content into the Claude Code surface. Future blueprints can ship slash commands the same way without re-litigating the allowlist. cowork@0.2.0 → 0.2.1 PATCH (additive). Allowlist 14 → 15 sanctioned write zones; helper count UNCHANGED at 13.

**v0.32.0 — four new sanctioned write zones + CLAUDE.md marker carve-out (sauce claude cohesion cycle).** Allowlist expands `15 → 17 paths + CLAUDE.md marker regions` with FOUR additions plus the marker-write carve-out:

1. `.claude/commands.local/**` — consumer override shadow for slash commands. Files placed here OVERWRITE the canonical `.claude/commands/<x>.md` after each install (post-install step 6f scans `.commands.local/` and copies each entry over the canonical). Preserved across installs indefinitely.
2. `.claude/skills.local/**` — consumer override shadow for SKILL.md bodies. Same posture as `.commands.local/` (post-install step 6f copies each `.skills.local/<bp>/<skill>/SKILL.md` over the canonical `.claude/skills/<bp>/<skill>/SKILL.md`).
3. `ranch/claude-surface-registry.json` — generated registry written by install.js step 6g; lists every materialized command + skill with its blueprint + dest path + checksum. Read by `/audit` (and by external surfaces that need to discover the materialized claude_surface). Failure-loud + atomic-write per the existing registry-write convention.
4. `.claude/commands/**` and `.claude/skills/**` (BOTH already in the allowlist via v0.31.0 S6.8 + v0.30.0 respectively) — clarified here as the canonical write zones materialized by `claude_surface[]` (the v0.32.0 platform-claude mechanism) from blueprint source.

**CLAUDE.md marker-write carve-out.** The claude_surface renderer rewrites only the spans BETWEEN marker pairs in CLAUDE.md (vault root). Three tables: `directory-map`, `resolvers`, `skills-index`. Markers are `<!-- @claude-surface:<table> BEGIN -->` ... `<!-- @claude-surface:<table> END -->`. **Outside-marker content is preserved bit-for-bit** — the renderer reads the file, replaces ONLY the region between matched markers, writes the file back. Missing markers → renderer logs `step: claude_surface_marker_missing` + skips that table (never invents a marker pair from nothing; consumer adds the marker pair manually if they want the table). Malformed marker (BEGIN without END or vice versa) → same `marker_missing` history + zero-write. The marker carve-out is a SEVENTH variant of the safety mechanics (different from JSON additive merge, different from theme overwrite-with-backup, different from `.bak` markdown overwrite, different from registry atomic-write): regex-bounded inner-region rewrite, leaves the host file otherwise untouched.

**Override seam contract (cross-reference to NEW landmine #22).** `.claude/commands.local/` and `.claude/skills.local/` are the ONLY supported consumer-customization paths for slash-command + skill content. Direct edits to the canonical `.claude/commands/<x>.md` / `.claude/skills/<bp>/**/SKILL.md` paths are REVERTED on next install. `/audit` surfaces direct-canonical edits as severity `consumer_edit_at_risk`. See landmine #22 for the full seam-design rationale + recovery flow.

Helper count UNCHANGED at 13 in v0.32.0 — the new writes are handled by extensions of existing helpers (the claude_surface renderer + post-install step 6f) rather than new helpers. Allowlist 15 → 17 paths + CLAUDE.md marker regions.

**v0.30.0 — fourteenth sanctioned write zone: `.claude/skills/<subtree>`.** The cowork blueprint introduces `manifest.skills[]` + `skills_dir` + a new `materializeSkills` helper (helper count 12 → 13) that writes native Claude Code skill bodies to `<vault>/.claude/skills/<subtree>/<id>/SKILL.md`. The dest is a **peer top-level dir to `.obsidian/`**, not nested under it — so the carve-out is conceptual cohesion (installer writes outside the user's authored content) rather than a literal expansion of the `.obsidian/` block-list. Scope is **broad** (`.claude/skills/<subtree>`, any blueprint, any future blueprint) by deliberate choice: matches the per-id wildcard precedent set by `.obsidian/plugins/<id>/{main.js,manifest.json,styles.css}` and avoids re-litigating the allowlist for every future skills-shipping blueprint (threads@0.1.0 forecast in v0.31.0, etc.). `materializeSkills` applies an analog of safety mechanics #1-#4: **Option B overwrite + `.bak` on edit** (matches the files[] loop in installItem; skill bodies are markdown, not JSON, so JSON-merge mechanics #1 + #3 don't apply directly; the `.bak` body is the equivalent recovery affordance), identical-content idempotent skip, failure-loud history (`step: materialize_skill_overwrite` / `materialize_skill_invalid_entry` / `materialize_skill_source_missing` / `materialize_skill_substitution`). Invalid entries (missing `source` or `dest`) record a warning + skip rather than abort the whole blueprint, because skills arrays grow to 30+ rows and one bad entry shouldn't block the rest (divergence from files[] loop posture, which aborts on bad rows because the list is hand-curated and small). **No code-level path validator was added in v0.30.0** — the entire allowlist (originally 13, now 14 sanctioned write zones) has always been enforced by helper-target hardcoding + code review, not by a runtime guard. Future cycles MAY add a runtime guard if a regression motivates it; until then, the policy boundary stays at the review surface. Allowlist 13 → 14 sanctioned write zones. Helper count 12 → 13.

**v0.41.0 — eighteenth sanctioned write zone: `.obsidian/snippets/sauce-*.css`.** The convenience@0.2.0 mechanism ships `sauce-tasks-icons.css` (Tasks plugin emoji → Lucide icons; vendored under `platform/mechanisms/convenience/assets/snippets/`) via the NEW `applySnippets` installer helper (helper count 13 → 14). Mirrors `applyVendoredThemes` posture: sha256-compare overwrite-with-backup with `.sauce-backup` suffix on overwrite of non-empty prior content; failure-loud history (`step: snippets`, actions `applied` / `overwrote` / `skipped_identical`); never-throws on per-entry failure. `entry.name` validated against `/^sauce-[A-Za-z0-9._-]+$/` regex — the `sauce-` prefix narrows mechanic point #2 of landmine #12 so user-authored snippets at every other filename remain user-owned + never touched by the installer. Registration in `.obsidian/appearance.json`'s `enabledCssSnippets[]` piggybacks on the existing `applyAppearance` helper (since v0.19.0, additive union) — no separate registration helper needed. Allowlist 17 → 18 sanctioned write zones; helper count 13 → 14.

### 13. Bootstrap stub is content-static; never re-edit (per-consumer drift forbidden)

Each consumer's `ranch/templater/platformInstall.js` is a ~12-line dispatcher first set during v0.1.2 S2. It MUST be byte-identical across all consumers at any given platform version (`diff` between any two stubs returns empty). The stub never re-syncs with `platform/install.js` — that file is now canonical-only and reached at runtime via `require()`.

**Stub body history.** The stub body has changed exactly ONCE in its history:
- **v0.1.2 → v0.23.0:** historical md5 invariant `a39257da1dd49ae4481e5cd0a42bdac4`. Stub read `Docs/Meta/platform-config.json` at runtime.
- **v0.24.0+ (current):** new md5 invariant `ea23aa812503bfca66359d3b2b239ba8`. Tree 3 rename moved the runtime plumbing dir; stub line 11 now reads `ranch/platform-config.json`.

Going forward, the stub body changes ONLY on Tree N rename cycles (rare — these are the multi-cycle rebrand renames that move the runtime plumbing tree, e.g., `Docs/Meta/` → `ranch/`). Any other proposed stub change requires a distribution-model bump documented in CLAUDE.md.

**Per-consumer drift is still forbidden.** Within a given platform version, the stub MUST be byte-identical across every consumer. The "changed once at v0.24.0" exception is a global lockstep transition — every consumer flips to the new md5 in the same release window — not a per-consumer customization knob.

**Why:** the stub IS the distribution mechanism. Drift in the stub breaks consumers silently — they'd dispatch to a different install.js path, or skip the require-cache clear, or read a different config. The stub's content-static invariant is the load-bearing replacement for the old md5-verified bootstrap-copy ritual.

**Canonical source:** `platform/installer-stub.js` — single source of truth for the stub body. Every consumer's bootstrap copy must match it byte-for-byte at the current platform version's md5 invariant.

**Recovery from drift:** copy `platform/installer-stub.js` over the divergent consumer's bootstrap path; re-run harness; commit only the canonical source if its body changed. v0.24.0 install runs auto-overwrite any stub still at the old `a39257da...` md5 with the new canonical body (`ea23aa81...`).

Codified in v0.1.2; amended in v0.24.0 (Tree 3 rename — first stub-body change).

### 14. `gitState()` is best-effort; must never throw

The `gitState()` helper at the top of `platform/install.js` records workshop git revision into installed.json history. It wraps every `execSync` in try/catch and returns `{commit:null, tag:null, dirty:null}` on any failure. Install proceeds regardless of git state — even on a non-git workshop, even on a missing `git` binary.

**Why:** install correctness must NOT depend on git correctness. The lean v0.1.2 model is "stub dispatches; install runs; we record what we can about workshop state." Coupling install success to git availability would block desktop-no-git scenarios and break workshop dogfood if anyone wiped `.git/`.

**What this means for callers:** code that READS `installed.history[].git_commit` etc. must tolerate `null` for entries written before v0.5.0 OR by a non-git install. Drift-detection (future cycle) treats `null` as "unknown," not "in sync" or "out of sync."

Codified in v0.1.2.

### 15. Vendored theme is mechanism-owned; never hand-edit `.obsidian/themes/<Name>/` in any vault

The styling mechanism (`platform/mechanisms/styling/`) vendors the Baseline theme as canonical platform content. The installer's `applyVendoredThemes` helper (v0.19.0) treats the consumer's `.obsidian/themes/<Name>/` as REPLACEABLE — every install run sha256-compares each file against the workshop source; mismatches get the consumer's prior content backed up to `<file>.bak` (single-deep, overwrite-on-edit) and overwritten.

**Symptom.** A user manually edits `.obsidian/themes/Baseline/theme.css` to tweak a color or font; on the next install the edit is silently clobbered (recoverable from `theme.css.bak` but not signaled visually). Multiple successive edits without intervening installs would lose the prior `.bak` at the next overwrite (`.bak` is single-deep — no rotation).

**Why this matters.** `.obsidian/themes/<Name>/` is the only `.obsidian/` allowlist path with overwrite-with-backup posture (the other five are additive-merge under various rules). All theme-level customization MUST route through:
1. **Style Settings JSON** (the whole point of the plugin — UI toggles for color schemes, fonts, sizes, blockquote style, etc.) — landed at `.obsidian/plugins/obsidian-style-settings/data.json`, additive-per-key first-wins so user values win over canonical defaults on every install.
2. **User-owned snippets** at `.obsidian/snippets/<x>.css` EXCEPT files matching `sauce-*.css` (user-managed; never touched by the installer; surfaces in Obsidian's Settings → Appearance → CSS snippets UI). Platform-vendored `.obsidian/snippets/sauce-*.css` files ARE allowlisted (v0.41.0; mechanic mirrors `.obsidian/themes/<Name>/` vendored-theme posture: sha256-compare overwrite-with-backup, `.sauce-backup` suffix on overwrite, failure-loud history). The `sauce-` prefix carve-out preserves user authorship of every non-sauce snippet filename.

**Rule.** No vault edits to `.obsidian/themes/<Name>/` ever. If you need a custom rule that Style Settings doesn't expose, either (a) add a snippet, or (b) extend the canonical Style Settings JSON in the workshop and ship a styling@0.1.x bump (mechanism is additive-per-key, so new canonical keys reach existing consumers without clobbering their overrides).

**Recovery.** If the installer overwrites a theme file you wanted to keep, copy `<file>.bak` over the live file. If `.bak` was already overwritten by a prior install cycle, the change is lost — reconstruct from the workshop source + your snippet file, OR fork the theme upstream.

Codified in v0.19.0.

### 16. In-cycle re-process bump rule — when reusing in-cycle staged work, in-cycle revisions MUST bump the version

The installer's per-item install loop short-circuits when `installedEntry.version === node.sub.version`. Any in-cycle CF that revises content WITHOUT bumping the item's version reaches barebones (or any other consumer) as the *previous* content because the version-equal short-circuit fires before the new content is read.

**Quoted call site (`platform/install.js:223`):**
```javascript
      if (installedEntry && installedEntry.version === node.sub.version) continue;
```

**Five-data-point precedent:**
- **v0.6.0** trips 0.1.0 → 0.1.1 → 0.1.2 → 0.1.3 → 0.1.4 (4 in-cycle bumps for hub/atlas/sections/Trip Board CFs).
- **v0.17.0** finance 0.1.4 → 0.2.0 → 0.2.1 → 0.2.2 → 0.2.3 → 0.2.4 → 0.2.5 → 0.2.6 (6 in-cycle bumps across CF-1..CF-5).
- **v0.18.0** finance 0.2.6 → 0.2.7 → 0.2.8 → 0.2.9 (3-bump stack for CF-1 InvoiceControls Save fix).
- **v0.18.1** to-do 0.1.2 → 0.1.3 → 0.1.4 (CF-1 trailing-space trim forced re-process).
- **v0.19.0** styling 0.1.0 → 0.1.1 (CF-1 prereq gate). Mechanism cycles extend lockstep to **4 files** (workshop manifest + mechanism manifest + workshop subscription + barebones subscription) per v0.19.0 CF-1 reinforcement.

**Rule.** Any in-cycle revision after first install MUST bump the item version (PATCH for fixes, MINOR for additive). Lockstep edits to:
1. blueprint or mechanism manifest (`platform/<kind>/<name>/manifest.json:version`)
2. workshop catalogue line (`platform/manifest.json:<kind>[].<name>.version`)
3. workshop subscription (mechanisms only — workshop self-subscription dogfoods mechanisms)
4. barebones subscription (`../barebones-beacon-poc/ranch/platform-subscription.json:<kind>[].<name>.version`)

**Recovery if a CF lands without a version bump.** Bump the item version + re-run install. The barebones drift is silent — `installed.json` still records the prior content's SHA in history.

**Long-term fix candidate (deferred).** A `--force-reinstall <name>` flag for `install.js` so test mechanics + in-cycle CFs can skip the version-equal short-circuit without touching files. Same fix candidate as landmine #10. Not blocking; not free.

Codified in v0.20.0.

### 17. Bootstrap network posture — failure-loud + idempotent + skip-if-present + GitHub-only

The `platform/bootstrap.js` orchestrator (v0.21.0+) is the only platform layer that makes network calls. Its posture:

1. **Single network host:** `raw.githubusercontent.com` (for the upstream community-plugins index) and `github.com` (for plugin release-asset redirects → CDN). No other domains. No telemetry. No analytics.
2. **Failure-loud:** every fetch failure throws with a descriptive message ("Cannot reach raw.githubusercontent.com…", "HTTPS … returned 404", "GitHub rate-limited"). Per-plugin failures are caught at the orchestrator level + recorded as `failed: [{id, reason}]` in the run report. Network-down at index-fetch is fatal (no plugins can be processed without id → repo lookup).
3. **Idempotent skip-if-present:** `fetchPlugin` returns `{status: "skipped"}` when `<vault>/.obsidian/plugins/<id>/manifest.json` exists and force-redownload was not requested. Subsequent bootstrap runs are zero-network for fully-installed vaults (modulo the index fetch which is cached for the run's lifetime).
4. **No mid-fetch cleanup:** if a plugin fetch throws partway through writing files, the partial state remains on disk. Skip-if-present resumes correctly on retry (manifest.json may or may not have been written; if not, next run re-fetches the whole plugin).
5. **`.sauce-backup` on overwrite:** force-redownload writes `<file>.sauce-backup` for each overwritten asset BEFORE writing the new content. Backup-copy failure is fatal (mirrors `applyTemplaterHotkeys` posture from v0.1.3+).
6. **Path traversal validator:** plugin id must match `/^[a-z0-9][a-z0-9._-]*$/i` AND `path.relative(pluginsRoot, pluginDir)` must not escape with `..`. Defense against hostile upstream entries or attacker-controlled `--reinstall` arguments.
7. **`process.env.GITHUB_TOKEN` honored:** if set, every HTTPS GET sends `Authorization: Bearer <token>`. Token never appears in logs or thrown error messages.
8. **Redirect-following:** `_https.getText` follows up to 5 redirect hops. GitHub release-asset URLs respond 302 to a CDN URL — without redirect-following, every plugin fetch fails with "returned 302".

**Why this is its own landmine.** Bootstrap is an installer-adjacent layer that intentionally crosses landmine #8 (desktop-only-filesystem). The network exposure is small + well-bounded but adds new failure modes the in-vault installer doesn't have. Future cycles that touch bootstrap or add new helpers that fetch from the network must preserve all eight postures. New network hosts (e.g., a plugin's mirror, a CDN other than GitHub's) require explicit user approval + a #17 update.

Codified in v0.21.0 after Phase A surfaced 302-redirect failures (CF-1) at first real GitHub fetch.

### 18. Inside-vault `pantry/` is git-managed — never hand-edit

Consumer vaults bootstrapped via `curl ... | bash` get the workshop cloned into `<vault>/pantry/` (lowercase, post-v0.23.0; renamed from the v0.22.x `Beacon/` to resolve the macOS APFS case-collision with the lowercase `spice/<module>/` namespace — see install.md "Upgrading from v0.22.x"). That directory is git-managed — `sauce update` fetches origin/main and `git reset --hard origin/main`-s. Hand-edits are wiped on the next update. If you need to customize:

- Mechanism / blueprint subscriptions: `sauce wizard` (writes `ranch/platform-subscription.json`)
- Config: `sauce wizard` → "Edit config" (writes `ranch/platform-config.json`)
- Plugin behavior: edit `.obsidian/` per landmine #12 mechanics

**Symptom.** A user opens `<vault>/pantry/platform/install.js` in their editor to "tweak something" and saves it. On the next `sauce update` the edit is silently discarded by `git reset --hard origin/main`. With `--force` the working tree is reset even when dirty — surfacing as "my fix to install.js disappeared."

**Why this matters.** `pantry/` is the only git-managed top-level platform dir in any consumer vault. It is the v0.22.0 analogue of v0.19.0's vendored theme (landmine #15) — canonical platform content vended into the consumer vault, replaceable on every update, never hand-modified. Customizations route through:

1. **`sauce wizard`** for subscription / config edits (writes `ranch/platform-*.json`, NOT inside `pantry/`).
2. **Mechanism / blueprint manifests upstream** for behavior changes (open a PR or fork; `git pull` + `sauce update`).
3. **`.obsidian/` allowlist paths** for plugin-data tweaks per landmine #12 mechanics.

**Recovery.** If you hand-edited a file inside `pantry/` and want to keep your change while still updating:
1. Copy the edit out of `pantry/` (e.g., to `~/scratch/my-edit.js`).
2. `sauce update --force` to discard the dirty state and pull origin/main.
3. Re-apply the edit upstream (via PR or local fork) so the change survives future updates.

If you DIDN'T mean to hand-edit and just want a clean state: `sauce update --force` is the canonical reset.

Mirrors landmine #15 (vendored theme is mechanism-owned). Codified 2026-05-06 with v0.22.0; clone dir renamed `Beacon/` → `pantry/` in v0.23.0 to resolve the macOS APFS case-collision.

### 19. Platform-managed directory names are lowercase

All directories materialized by sauce installer logic under `pantry/`, `ranch/`, `spice/` MUST be lowercase. Mixed-case or TitleCase directory names cause macOS APFS case-collision risk + path-canonicalization drift across case-sensitive / case-insensitive filesystems.

**EXCEPTIONS (do not "fix" these):**

- **`MM-MMMM/`** date-routed folders (e.g., `05-May/`) — moment.format default; user-facing date display, NOT a directory-naming choice.
- **`assets/themes/<ThemeName>/`** — vendored theme directory (currently `Baseline/`); preserve the vendor's chosen case verbatim.
- **User-facing NOTE FILENAMES** — `Projects.md`, `Trips.md`, `Finance.md`, `Meetings-<date>.md`, `Thursday-<date>.md`, `Journal-<date>.md`, etc. — file naming, not directory naming.
- **Historical doc paths** in `Docs/plans/` and `Docs/prompts/` — preserve cycle-time accuracy (path-migration-2026-05-05 precedent).
- **`pantry/`** — already correctly cased per v0.23.0.
- **`spice/`** — already lowercase per v0.25.0.
- **`.claude/skills/`** — sanctioned platform-managed top-level zone (added in v0.30.0); installer materializes native Claude Code skill bodies here via `materializeSkills`. Already lowercase. Sibling to `.obsidian/`, not nested. Same posture as `spice/` (lowercase-only; per-blueprint subtree under `.claude/skills/<blueprint>/`); see landmine #12 for the safety mechanics around writes.

**Recovery from violation.** Rename via the macOS APFS case-insensitive workaround:

```bash
git mv ranch/Templater ranch/templater_tmp && git mv ranch/templater_tmp ranch/templater
# ... repeat per uppercase dir
```

Then sed-sweep across all source files (template bodies, CustomJS class string literals, manifest path strings, harness-setup paths, current-state docs) + harness baseline updates. Single atomic commit per the v0.24.0 / v0.25.0 / v0.26.0 mass-rename pattern.

**Codified in v0.26.0** — the cycle that did the canonical lowercase sweep of `ranch/Templater|Scripts|Templates|Views`. Future blueprints / mechanisms authoring under `pantry/`, `ranch/`, or `spice/` MUST use lowercase directory names from the start. **Extended in v0.30.0** to add `.claude/skills/` as a fourth sanctioned platform-managed top-level zone for skill body materialization; same lowercase-only posture; per-blueprint subtree pattern `.claude/skills/<blueprint>/`.

### 20. Source vault is read-only during `sauce migrate`

`sauce migrate` (v0.28.0) reads its `--from <source>` argument; it MUST NEVER write to that path. The migration tool's contract is "transform source → target", with target = the sauce-managed cwd vault. If a future migrator's `migrate(planEntry, srcAbsPath, tgtRoot, ctx)` ever calls `fs.writeFileSync(srcAbsPath, ...)` or otherwise mutates a path under `fromAbs`, that's a critical bug — the user has no way to recover the original source content if migration corrupts it.

**Codified in v0.28.0 design Section 4 + commit.js phase 0/1/2/3/4 contracts.** The `_carryVerbatim` and `_rewriteBlueprints` loops both pass `srcAbsPath` only to `fs.readFileSync` / `fs.copyFileSync(src, dst)`; never as a destination argument. The `_assertTargetWithinRoot(vaultPath, entry.tgt)` belt-and-suspenders check at the orchestrator level catches any planEntry tgt that escapes the vault root, but doesn't catch source mutations. **Any new migrator code must ALWAYS pair `srcAbsPath` with read-only fs calls.** Code review must reject any PR that uses `srcAbsPath` as a write destination.

**Why this matters.** The user expects to be able to roll back a migration by deleting the target + restoring the sibling backup. If the source is also corrupted, that recovery is impossible — the source IS the user's only intact copy of the content (the prior backup is the pre-migration dest snapshot, NOT the source). A bug here is permanent data loss.

**Surface this every time.** When reviewing any migrator code change (boards.js, project.js, trips.js, etc.), grep the diff for `writeFileSync` / `appendFileSync` / `truncateSync` / `unlinkSync` / `renameSync` / `rmSync` and verify every call uses a `tgtRoot`-rooted path, never a `srcAbsPath`-rooted path.

### 21. `sauce audit` is read-only against the audited vault

`sauce audit` (v0.29.0) walks `<vault>/spice/<bp>/**/*.md`, reads `<vault>/ranch/rules/<bp>.json`, applies rule_fragments[], and emits a markdown report — but MUST NEVER write to anywhere under `<vault>`. The audit pipeline (`platform/cli/cmd-audit.js` + `platform/audit/{walker,rule-runner,report,sanctioned-dirs}.js`) is read-only by contract. The single carve-out is `--output-file <path>`: when that path falls inside the audited vault, the user has explicitly requested the write. That's the ONLY exception.

**Codified in v0.29.0 design Section 4 + cmd-audit.js:54 (single fs.writeFileSync call, gated by `--output-file` flag).** Walker, rule-runner, report, sanctioned-dirs all do reads only — no `fs.writeFileSync` / `fs.appendFileSync` / `fs.mkdirSync` / `fs.rmSync` / `fs.unlinkSync` / `fs.renameSync` against the audited vault path. The S2.10 quality reviewer verified this via grep at S2 close.

**Why this matters.** Audit is meant for inspection. Mutating the audited vault from inside the audit pipeline would couple detection to fix logic and create surprise side effects (e.g., a bug in rule-runner could inadvertently rewrite a violating file's frontmatter). v0.29.0 is detection-only by design; auto-fix tooling is a separate feature surface that gets its own design + cycle once we know what real-world violations actually surface. Mirrors landmine #20 posture for `sauce migrate` source vaults — generalized here.

**Surface this every time.** When reviewing any code change under `platform/audit/`, grep the diff for `writeFileSync` / `appendFileSync` / `truncateSync` / `unlinkSync` / `renameSync` / `rmSync` / `mkdirSync` and verify the only hit (if any) is `cmd-audit.js`'s `--output-file` write at line 54-ish. Reject PRs that introduce other writes against the audited vault.

### 22. `.local/` is the only consumer override seam

`.claude/commands.local/<x>.md` and `.claude/skills.local/<bp>/<skill>/SKILL.md` are the ONLY supported consumer-customization paths.

**Direct edits to canonical files** (`.claude/commands/<x>.md` or `.claude/skills/<bp>/<skill>/SKILL.md`) are REVERTED on next install. The installer materializes canonical content from blueprint source in step 6c, then post-install step 6f scans `.commands.local/` + `.skills.local/` and copies each file OVERWRITING the canonical. Removing a `.local/` file restores the canonical on next install.

`/audit` surfaces direct-canonical edits as severity `consumer_edit_at_risk` BEFORE the user loses work. The path forward when an edit is flagged:
1. Move the customization to `.claude/commands.local/<same path>.md` (or `.claude/skills.local/<same path>/SKILL.md`).
2. Re-run `/install` to apply the shadow.
3. Future installs preserve the .local/ shadow indefinitely.

This is the seam by design — blueprint authors own the canonical body, consumers own .local/ shadows, drift between them is visible at audit time.

**Reason:** lockstep upgrades require the canonical source to be authoritative. Hand-tuned canonicals cause silent install regressions; an explicit override seam (with audit visibility) keeps both concerns clean.

**How to apply:** never edit `.claude/commands/<x>.md` or `.claude/skills/<bp>/**/SKILL.md` directly in a consumer vault. Always use `.claude/commands.local/` or `.claude/skills.local/`. If the canonical needs a permanent change, edit the blueprint source at `platform/blueprints/<bp>/{commands,skills}/...` in the workshop and re-deploy via `/upgrade`.

Codified in v0.32.0 alongside the landmine #12 allowlist expansion for `.claude/commands.local/**` + `.claude/skills.local/**`.

## Operational gotchas

### CustomJS scan folder is per-vault and configured in `.obsidian/plugins/customjs/data.json`

When canonically migrating a consumer to `ranch/scripts/`, also update CustomJS's `jsFolder` setting. Editing that file is a `.obsidian/` change and needs explicit user approval (per each vault's CLAUDE.md "ask before acting" rule).

### Approval gates use Templater's `tp.system.suggester`

The suggester's "Esc" key returns null, which the installer treats as a skip (not an error). Files declined by the user are silently skipped; the mechanism continues with whatever else it can do. The `platform-installed.json` entry records the version even on partial installs — that's a known limitation. Resolution: treat partial installs as "good enough" for now; a future installer version can track per-file install state.

### Workshop content vault plugins emit warnings on workshop boot

Workshop has no daily notes, no kanban boards, no projects. If you leave Calendar / Big Calendar / Kanban / Daily Notes core plugin enabled, they fire warnings every time you open the workshop. Disable them in the workshop specifically (community plugins are per-vault, not synced via Obsidian Sync).

### Don't carry a bug across vaults

Every mechanism update goes through the workshop first, dogfoods on the workshop's own self-install, THEN promotes to consumers. If the workshop self-test fails, do not push the update into consumers. The workshop's "production" status validates the mechanism end-to-end.
