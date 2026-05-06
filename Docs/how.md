# How the platform works

## Vault topology

```
~/notes/                              parent dir, identical layout per machine
  workshop/poc-vault/                 canonical platform host (this vault)
  accuris/                            consumer
  headspace/                          consumer
  ero/                                consumer
  workshop/tmp-acc-vault/             test mirror of accuris (sandbox for onboarding)
```

All five vaults are independent Obsidian Sync targets. The workshop is **always** at a known relative path from the consumers (`../workshop/poc-vault`) so the installer can find it via filesystem.

Per-machine path differences (e.g., `/Users/willfell/Documents/obsidian/sync/...` vs `/Users/willfellhoelter/notes/...`) only affect absolute references. The relative layout is identical.

## Three concepts

### Mechanism
Cross-cutting code shared by every consumer. Examples:
- `customjs-guard` — Dataview view + CSS snippet that prevents cold-load `ReferenceError` flashes.
- `validator` — rule engine + Templater hook handler.
- `audit` — vault walker that reports violations + platform drift.

A mechanism lives at `platform/mechanisms/<name>/` with:
- One or more JS / CSS / config files (the actual code).
- A `manifest.json` declaring its version, the files it ships, where they go in the consumer (with `{{template_variables}}`), and any approval-gated post-install steps.

### Blueprint
A bundle defining a *note type*. Examples (planned, none shipped yet):
- `project` — atlas + structure + card notes under `Boards/planning/<slug>/`. Maps to "side-quest" in headspace via variant aliasing.
- `daily` — daily notes with the right tags, frontmatter, and nav blocks.
- `invoice` — ERO-only.

A blueprint lives at `platform/blueprints/<name>/` with:
- `rule.json` — what makes a note of this type "correct".
- `templates/` — the Templater templates that produce notes of this type.
- `helpers/` — CustomJS classes specific to this blueprint.
- `commands/` — slash commands related to this blueprint.
- `variants.json` — declares aliases (e.g., headspace renames `project` → `side-quest`).
- `manifest.json` — version + install steps.

### Module directory under `beacon/` namespace (blueprint-only invariant)

Every **blueprint** owns ONE directory at `beacon/<module_directory>/` in the consumer vault. All files the blueprint materializes — at install time via `files[]`, OR at runtime via templates / commands / nav-button click actions — land under that one directory. Cross-module data flows via wikilinks only; no blueprint writes into another's directory.

The `beacon/` parent namespace demarcates platform-managed content from the consumer's personal content. Consumers keep any other top-level structure they want (e.g., `Timestamps/`, `Resources/`) — `beacon/` is the contract boundary.

Each blueprint manifest declares `module_directory: "<name>"` (required, enforced by installer). The installer derives the full materialization root as `<vault_root>/beacon/<module_directory>/`. Examples: `beacon/boards/` for the boards blueprint (v0.2.0), `beacon/to-do/` / `beacon/projects/` / `beacon/trips/` / `beacon/finance/` for future blueprints.

**Why:**
- Install / update / uninstall a blueprint = touch one directory at `beacon/<module>/`. Predictable.
- Cross-module name collisions become impossible by construction.
- Platform-managed content is cleanly demarcated from consumer-personal content via the `beacon/` namespace.
- New blueprints get a clean recipe — pick a directory name under `beacon/`, own it.

**Mechanisms are exempt.** Mechanisms (`customjs-guard`, `validator`, `audit`, `nav-buttons`) are shared infrastructure landing under `Docs/Meta/Scripts/`, `Docs/Meta/Views/`, `Docs/Meta/Templater/` — not module-scoped, not under `beacon/`.

Codified as landmine #11 + a CLAUDE.md non-negotiable. Decision rationale and shape at `Docs/plans/2026-05-03-boards-blueprint-design.md`. Refined 2026-05-04 to add the `beacon/` namespace prefix.

### Subscription
Per-consumer-vault `Docs/Meta/platform-subscription.json` declaring which mechanisms + blueprints this vault adopts and at which versions:

```json
{
  "workshop_version": "0.2.0",
  "mechanisms": [
    { "name": "customjs-guard", "version": "1.0.0" },
    { "name": "validator", "version": "0.1.0" },
    { "name": "audit", "version": "0.1.0" }
  ],
  "blueprints": []
}
```

The installer reads the subscription, compares against the workshop's `platform/manifest.json`, and only installs the explicitly-subscribed items at the explicitly-pinned versions.

## Workshop layout

```
workshop/poc-vault/
├── CLAUDE.md                                  Workshop identity + agent navigation.
├── Docs/
│   ├── Index.md                               Documentation entry point.
│   ├── why.md, how.md, use.md, landmines.md   Conceptual docs.
│   ├── plans/                                 Design + implementation plans.
│   ├── prompts/                               Copy-paste-ready agent prompts.
│   ├── Meta/
│   │   ├── platform-config.json               Workshop's self-install path map.
│   │   ├── platform-subscription.json         Workshop's self-subscription.
│   │   ├── platform-installed.json            Auto-managed: what's currently installed.
│   │   ├── Templater/                         Materialized user scripts (incl. platformInstall.js).
│   │   ├── Views/                             Materialized Dataview view files.
│   │   ├── Scripts/                           CustomJS classes (none in workshop).
│   │   ├── Templates/                         Templater templates.
│   │   └── rules/                             Rule registry (_global.json + per-blueprint rules).
└── platform/
    ├── manifest.json                          Version catalogue.
    ├── install.js                             The installer (canonical source).
    ├── mechanisms/<name>/                     Cross-cutting code.
    └── blueprints/<name>/                     Note-type bundles.
```

## Consumer layout (target shape)

A consumer vault has the same `Docs/Meta/` shape as the workshop. The platform installs into:
- `Docs/Meta/Templater/` — receives `platformInstall.js`, `validate.js`, `hook-validate.js`, `audit-walker.js`.
- `Docs/Meta/Views/` — receives `customjs-guard/view.js`.
- `.obsidian/snippets/` — receives `customjs-loader.css`.
- `.obsidian/appearance.json` — gets `customjs-loader` added to `enabledCssSnippets`.
- `Docs/Meta/rules/` — receives any rule fragments (currently customjs-guard contributes a `_global.json` fragment).

If a consumer's existing paths differ from canonical (e.g., accuris currently has the customjs-guard view at `Extras/Scripts/customjs-guard/view.js` from the original rollout), the consumer's `platform-config.json` reflects that, and the installer materializes to the existing path. A canonical-path migration is a separate, deferred plan.

## Installer flow

The installer is invoked via the consumer's `_install-platform.md` Templater template. The consumer's `Docs/Meta/Templater/platformInstall.js` is a ~12-line content-static thin stub (post-v0.1.2 S2) that reads `Docs/Meta/platform-config.json`, resolves `<workshop>/platform/install.js`, clears Node's `require.cache` for that path, and dispatches via `require()`. The canonical `install.js` runs the full install loop on the consumer's vault.

Steps the canonical installer performs:

1. Read `Docs/Meta/platform-config.json` → vault path map + variables.
2. Read `Docs/Meta/platform-subscription.json` → what this vault wants.
3. Read `Docs/Meta/platform-installed.json` → what's currently installed (or empty).
4. Resolve workshop absolute path via `app.vault.adapter.basePath` + `config.workshop_relative_path`.
5. Read `<workshop>/platform/manifest.json`.
5a. **Validate `module_directory` on every subscribed blueprint manifest** (added v0.2.0). Missing or empty → record `error / module_directory_missing`, skip that blueprint. Two blueprints declaring the same value → record `warning / module_directory_collision`, first-wins by topo order (skip the second). Mechanisms exempt.
5b. **Build per-blueprint substitution overlay** (added v0.2.0). For each blueprint, set `{{module_directory}}` → `beacon/<bare-name>` in a shallow-copy variables overlay; mechanisms continue to receive the unmutated base variables.
6. For each subscribed mechanism / non-skipped blueprint:
   a. Look up in workshop manifest. Skip if version mismatch with subscription.
   b. Compare with installed; skip if already at this version.
   c. Read item's `manifest.json` from workshop.
   d. **Run `pre_install[]` steps** (added v0.2.0): for `type: "delete"`, back up the target to `<path>.pre_install_bak` and remove the original; record `delete / pre_install_delete` history. Absent target → `info / pre_install_delete_skip`. Directory target → `warning / pre_install_delete_skip`. Unknown type → `warning / pre_install_unknown_type`.
   e. For each file in the item: read source, substitute `{{vars}}`, **compare bytes against the current dest content** (added v0.2.0 Option B). Identical → skip write. Differs and prior is non-empty → write `<dest>.bak` + overwrite + record `replace / file_overwrite` with `prior_sha + new_sha`. Absent or 0-byte prior → fresh write, no event. Approval-gate any file with `"approval": "required"`.
   f. Run `post_install` steps: `enable_snippet` (with optional approval), `notice` (informational popup).
   g. Apply `nav_buttons[]` declarations to the registry (if any). Action types: `openLink { target }`, `createFromTemplate { target, template_source }`, and (added v0.4.0) `runTemplaterTemplate { template_source, folder, filename }` — folder + filename are moment.format strings the renderer resolves at click-time before invoking `templater.create_new_note_from_template`.
   h. Apply `external_plugins[]` warnings (warn-only — surfaces missing community-plugin deps).
   i. Apply `templater_hotkeys[]` registrations to `.obsidian/plugins/templater-obsidian/data.json` (additive merge, backup-on-edit; see landmine #12).
   j. Apply `slash_commander_bindings[]` registrations to `.obsidian/plugins/slash-commander/data.json` (additive merge, backup-on-edit; see landmine #12).
   k. Apply `templater_folder_templates[]` registrations to `.obsidian/plugins/templater-obsidian/data.json:folder_templates[]` (added v0.4.0; additive merge by `folder` field, first-wins idempotency, user-override preserved on template mismatch, empty-default placeholder replaced on first-write; backup-on-edit; see landmine #12).
   l. Apply `core_plugin_settings[]` registrations to `.obsidian/<id>.json` (added v0.3.0; additive shallow merge, backup-on-edit; see landmine #12).
   m. Append to `installed` + `history`.
7. Write `Docs/Meta/platform-installed.json`.
8. Show "platformInstall: complete." Notice.

> [!info] Optional manifest fields (additive across versions)
> - `templater_hotkeys[]` (added v0.1.3) — list of `{ template: "<basename>.md" }` entries the installer registers in Templater's Template Hotkeys, populating `.obsidian/plugins/templater-obsidian/data.json:enabled_templates_hotkeys[]` so per-template `Insert <name>` commands surface in the palette.
> - `slash_commander_bindings[]` (added v0.1.3) — list of `{ name, template }` entries the installer registers in Slash Commander, populating `.obsidian/plugins/slash-commander/data.json:bindings[]`. The `name` is the slash trigger (user types `/<name>`); installer derives the full SC binding shape (`name`, `id`, `action`, `icon: "templater-icon"`, `mode: "any"`, `triggerMode: "anywhere"`) and computes `id = action = "templater-obsidian:" + <full-template-path>` from the basename + `variables.templates_path`.
> - Both fields cross-validate against the manifest's `files[]` (or each other) — a binding referencing a template the manifest doesn't ship surfaces a warning + skip.
> - `module_directory` (added v0.2.0; **REQUIRED on every blueprint**, mechanisms exempt) — bare directory name (e.g., `"boards"`). Installer derives the full namespaced path `beacon/<bare-name>` for the per-blueprint `{{module_directory}}` substitution variable. Two blueprints declaring the same value collide and the second is skipped (first-wins). See landmine #11.
> - `pre_install[]` (added v0.2.0) — list of pre-files-loop actions to run for stale-file cleanup or migration. Currently one action type: `{ type: "delete", path: "<dest-relative-with-substitution>", reason: "<why>" }`. Path goes through `substituteStrict`. Existing target file is read, sha256-hashed, backed up to `<path>.pre_install_bak`, then removed via `adapter.remove`. Absent target is a no-op (idempotent). Directory target surfaces a warning and skips. Unknown action types surface a warning and skip. One-shot per blueprint version per consumer (gated by the existing version-skip mechanic in step 6.b).
> - `core_plugin_settings[]` (added v0.3.0) — list of `{ id, settings }` entries the installer additive-shallow-merges into Obsidian core-plugin data files at `.obsidian/<id>.json`. Top-level keys in `settings` overwrite existing top-level keys; nested objects are replaced wholesale; pre-existing keys not declared by the manifest are preserved. Settings string values pass through `substituteLenient` using the per-item variables overlay (so blueprints get `{{module_directory}}` resolved). Idempotent skip-write when merged === existing; backup-on-edit to `<target>.beacon-backup` only when there is pre-existing content to back up. Honors landmine #12's four safety mechanics. First use: daily blueprint v0.1.0 writes `.obsidian/daily-notes.json` (`folder` / `format` / `template`).
> - `templater_folder_templates[]` (added v0.4.0) — list of `{ folder, template }` entries the installer additive-merges into `.obsidian/plugins/templater-obsidian/data.json:folder_templates[]`. Files manually created in the listed folders auto-apply the listed template via Templater's "Folder Templates" feature — backstop for the canonical `runTemplaterTemplate` nav-button creation path so the blueprint's module directory always produces template-shaped files regardless of how the file was created. Both `folder` and `template` string values pass through `substituteLenient` (resolves `{{module_directory}}` / `{{templates_path}}`). Match-by-`folder`; first-wins idempotency: if `folder` already exists with the same `template`, the entry is skipped (`info, action: "skipped_existing"`); if `folder` matches but `template` differs, the user override is preserved (`warning`). Empty-default Templater placeholder `{folder:"", template:""}` is replaced on first-write rather than appended-alongside. Honors landmine #12's four safety mechanics; writes to the same allowlisted templater data.json as `templater_hotkeys[]` (no allowlist expansion in v0.4.0).
> - `nav_buttons[].action.type: "runTemplaterTemplate"` (added v0.4.0; **schema rewritten v0.4.2**) — declarative date-routed runtime-creation surface with literal/moment-format separation. Action shape: `{ type, template_source, folder_prefix (required), folder_date_pattern, filename_prefix, filename_date_pattern, filename_suffix }`. Renderer composes the click-time target as `folder = folder_prefix + (folder_date_pattern ? "/" + moment().format(folder_date_pattern) : "")` and `filename = filename_prefix + (filename_date_pattern ? moment().format(filename_date_pattern) : "") + filename_suffix`. Literal fields (`folder_prefix`, `filename_prefix`, `filename_suffix`) accept `{{...}}` placeholders resolved via `substituteLenient` at install time and NEVER reach `moment.format()` — bracket-escape gap is architecturally impossible by construction. Date-pattern fields accept moment.js format strings verbatim. `validateAndResolve` rewrites `template_source` to `{{templates_path}}/<basename>` at install time and rejects entries missing `folder_prefix` (warning history + skip). v0.4.2 BREAKING: legacy single `folder` / `filename` fields silently ignored; manifests must migrate.
>
>   **Migration cheatsheet (v0.4.0 → v0.4.2):** old `folder: "{{module_directory}}/YYYY/MM-MMMM"` + `filename: "YYYY-MM-DD-[ToDo]"` → new `folder_prefix: "{{module_directory}}"` + `folder_date_pattern: "YYYY/MM-MMMM"` + `filename_date_pattern: "YYYY-MM-DD"` + `filename_suffix: "-ToDo"`. Old `folder: "{{module_directory}}/[hubs]"` + `filename: "YYYY-MM-DD-[Meetings]"` → new `folder_prefix: "{{module_directory}}/hubs"` + `folder_date_pattern: ""` + `filename_date_pattern: "YYYY-MM-DD"` + `filename_suffix: "-Meetings"`. Empty `folder_date_pattern` skips the date-route segment entirely (renderer collapses to bare `folder_prefix`); useful for hub-style fixed-folder collations.

Cross-vault file reads use `require("fs").promises` (Node API available in Templater desktop). Mobile would need a different path; not supported yet.

## Why JSON, not YAML

`Docs/Meta/platform-config.json`, `platform-subscription.json`, `platform-installed.json`, and `platform/manifest.json` are all JSON. Same for each mechanism's `manifest.json` and the `rules/_global.json`.

Reason: Templater user scripts can't reach Obsidian's `parseYaml` (the `obsidian` virtual module isn't registered for non-plugin contexts). `JSON.parse` is a built-in, universally available. We tried `require("obsidian").parseYaml` first; it returned undefined.

Trade-off: JSON is less human-readable than YAML but every reader needs zero dependencies. Acceptable for machine-managed files. If we ever need true YAML for human-edited rule files, the path forward is a small inline parser; no one needs to wait for it.

## Versioning

- `platform/manifest.json:workshop_version` — the workshop's overall release. Bump on any platform-wide change.
- Each mechanism / blueprint has its own `version` field. Bump on any change to that mechanism.
- Subscriptions pin to specific versions. The installer refuses to install a mismatch.
- `platform-installed.json` records the installed version + install timestamp + history events.

Drift detection (in `audit-walker.js`):
- For each subscribed mechanism, compare `installed[i].version` to `subscription[i].version`. Mismatch = drift.
- For each subscribed mechanism, also compare against `manifest.mechanisms[i].version`. If subscription is behind manifest, the consumer can update by bumping the subscription and re-running `platformInstall`.

### Distribution model (post-v0.1.2)

Each consumer's `Docs/Meta/Templater/platformInstall.js` is a ~12-line content-static thin stub. It reads the consumer's `platform-config.json` to resolve the workshop path, clears Node's require cache for the canonical installer, and dispatches to `<workshop>/platform/install.js`. The canonical installer is the single source of truth at runtime; it lives in the workshop git repo and is updated via normal git workflow (`git pull` in the workshop, then re-run the install in each consumer).

The stub itself never changes after v0.1.2 S2 deployment. Edits to canonical `install.js` propagate to all consumers automatically on the next install run, with no per-consumer file changes.

---

## Gotchas / Lessons learned (v0.11.0–v0.19.0)

Load-bearing operational lessons not yet codified elsewhere. Most surfaced across v0.11.0–v0.19.0; entry #4 originated in v0.4.2 and has reinforced through every renderer cycle since. Per-cycle detail in result writeups under `Docs/plans/` (filename pattern: `<date>-<cycle>-result.md`); CLAUDE.md status snapshot is the running summary across all cycles; `Docs/landmines.md` is the rule registry.

1. **In-cycle re-process bump rule** — when revising in-cycle staged work, bump the item version (PATCH for fixes). See landmine #16 for the full mechanic. Surfaced: v0.6.0 / v0.17.0 / v0.18.0 / v0.18.1 / v0.19.0.

2. **API-contract quoting** — when authoring a new mechanism API or invoking an existing shared API in a design doc, QUOTE the literal call shape. Inferring from a sibling fails (TripsHubCards inferred BeaconCards' API → CF-1; design described "field-function API matching ProjectsHubCards precedent" but didn't quote the call shape). Surfaced: v0.6.0.

3. **dv-shim composition discipline** — when a hub renderer hands a sub-container to another customJS class, the shim MUST proxy every dv method the sub-class calls (`pages` + `current` + `el` minimum). A `{container: sub}`-only shim breaks any sub-renderer that calls `dv.pages(...)`. Surfaced: v0.17.0 CF-1 (latent v0.16.0 bug).

4. **Mobile-aware visual design** — every CustomJS class designed for desktop AND mobile from the start. Installer is desktop-only (landmine #8); renderers are not. Surfaced: v0.4.2 gotcha 7.

5. **Embed dedup via `closest(".markdown-embed")`** — when a note is embedded via `![[X]]`, its dataviewjs blocks should suppress duplicated nav-buttons / widgets at the top of the embedded block via `if (dv.container.closest(".markdown-embed")) return;`. Surfaced: v0.16.0.

6. **YAML date auto-parsing + frontmatter parser variance** — frontmatter values matching `YYYY-MM-DD` or `YYYY-MM` auto-parse to Date|Luxon objects; quote on write (`"${month}"`) + tolerant `_toMoment(val)` on read (accepts Luxon/Date/string). Inline-flow booleans may parse as strings; centralize coercion via `isPaid()`-style helpers. Surfaced: v0.16.0.

7. **NBSP gotcha — widgets are the canonical fix** — manual frontmatter editing introduces U+00A0 NBSPs through chat / markdown copy-paste, corrupting inline-flow YAML arrays. Editor widgets (e.g., BudgetCategoriesEditor / PaycheckExpensesEditor / InvoiceTimeLogEditor) bypass every YAML edge case at the source by mutating frontmatter via `app.fileManager.processFrontMatter`. Surfaced: v0.16.0 → fixed in v0.17.0.

8. **Two backup-suffix conventions** — `.bak` for file-content overwrite (vendored themes; v0.2.0 boards Option B precedent), `.beacon-backup` for plugin-data additive merge. Mixing them is confusing; codified in landmine #12 mechanic #2. Surfaced: v0.19.0.

9. **Helpers that materialize new state need explicit prereq gates** — `applyExternalPlugins` only emits warnings; helpers that mkdir + fresh-write must short-circuit at the top via `_externalPluginsSatisfied(tp, manifest)` or equivalent prereq check. Pattern reusable for any future helper whose missing-prereq state isn't recoverable post-hoc. Surfaced: v0.19.0 CF-1.

10. **Bounded cohesion — BeaconCards = hubs only / bullet lists for tasks; outline-accent buttons go through BeaconButton** — BeaconCards for hub-style listings (real files with title/subtitle/meta worth surfacing visually); plain `<ul>` for compact at-a-glance task panels (v0.12.0 daily blueprint S3.4.1 inline-CF). Outline-accent action buttons go through `customJS.BeaconButton.render(...)` — no inline cssText + hover handlers (v0.18.0 BeaconButton mechanism promotion).


---

## Consumer bootstrap (v0.21.0+)

Beacon vault platform ships an interactive Node-based bootstrap orchestrator at `platform/bootstrap.js`. A fresh consumer goes from `git clone` to fully-loaded with one shell command.

### Quick start

```bash
# One-time workshop setup
cd <workshop-path>           # e.g., /Users/willfell/Documents/obsidian/sync/workshop/beacon
npm install

# Consumer-side, from inside any consumer vault
cd <consumer-vault>
node <workshop-path>/platform/bootstrap.js
```

The wizard handles config + subscription generation on first run, then plugin fetch, then runs the existing Node installer. After it completes, open the vault in Obsidian + Cmd+R.

### What bootstrap does

1. **Detects existing config.** If `Docs/Meta/platform-config.json` + `platform-subscription.json` exist, opens the re-run menu (install / edit subscription / edit config / force-redownload / quit). If absent, opens the first-run wizard.
2. **First-run wizard** (5 prompts via `@inquirer/prompts`):
   - Workshop relative path (validates `<vault>/<rel>/platform/manifest.json` exists)
   - Vault display name (defaults to vault dirname)
   - Mechanisms checkbox (defaults: customjs-guard, nav-buttons, cards, beacon-button, styling)
   - Blueprints checkbox (defaults: none — opt-in)
   - Confirm summary
3. **Writes config files** atomically (`.tmp` + rename) with canonical 6 path variables (`views_path`, `templater_scripts_path`, `scripts_path`, `rules_path`, `templates_path`, `commands_path`) merged into `variables` alongside `workshop` (display name) + `vault_identity_tag` (lowercase).
4. **Vendors the v0.1.2 thin-stub** at `Docs/Meta/Templater/platformInstall.js` if missing (landmine #13 content-static; never re-edits an existing one).
5. **Fetches the upstream community-plugins index** (`raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json`) for id → repo lookup. Cached for the run.
6. **Per plugin in (foundational ∪ subscribed `external_plugins[]`):** skip-if-present unless force-redownload selected. Otherwise HTTPS GET `manifest.json` + `main.js` + (optional) `styles.css` from `https://github.com/<repo>/releases/latest/download/<asset>` (follows 302 redirects to GitHub's CDN). Vendors into `<vault>/.obsidian/plugins/<id>/`.
7. **Merges plugin ids into `community-plugins.json`** (additive; sorted; deduped; `.beacon-backup` of prior).
8. **Invokes `runInstall(vaultPath)`** — the existing Node installer — which materializes themes, appearance, style-settings, blueprints, nav-buttons, etc.
9. **Prints a condensed summary** (Notice lines + Verdict + section counts; ~30-80 lines). Full output tee'd to `Docs/Meta/bootstrap-last-install.log` for inspection.

### Schema additions in v0.21.0

`platform/manifest.json`:

```jsonc
{
  "workshop_version": "0.21.0",
  "foundational_plugins": [           // NEW — workshop-level plugins required by every consumer
    { "id": "templater-obsidian" },
    { "id": "customjs" },
    { "id": "dataview" }
  ],
  "mechanisms": [...],
  "blueprints": [...]
}
```

The bootstrap reads `foundational_plugins[]` PLUS each subscribed mechanism/blueprint's existing `external_plugins[].id` to compute the union plugin set.

### Failure modes

| Scenario | Behavior |
|---|---|
| Network offline (index fetch) | Fail-loud "Cannot reach raw.githubusercontent.com…", exit 1 |
| Network offline (mid-plugin) | Per-plugin failed entry; partial state OK; skip-if-present resumes |
| GitHub 404 on manifest.json or main.js | Per-plugin failed entry; other plugins succeed |
| GitHub 404 on styles.css | Tolerated silently (many plugins ship without styles.css) |
| GitHub rate limit | Fail-loud with hint to set `GITHUB_TOKEN` |
| Workshop missing `node_modules` | Print "Run cd <workshop> && npm install first", exit 1 |
| Plugin id not in upstream index | Per-plugin failed entry; other plugins succeed |

### Honored env vars

- `GITHUB_TOKEN` — when set, bootstrap sends `Authorization: Bearer <token>` on every HTTPS GET. Useful for high-quota sessions (5000/hr authenticated vs 60/hr unauth).

---

## Convenience mechanism (v0.21.1+)

The `convenience@0.1.0` mechanism ships a pair of "fresh-vault → ready-to-use" defaults:

- **Global hotkeys** — `Cmd+-` (workspace:copy-full-path) and `Cmd+=` (workspace:copy-path), the macOS-native equivalent of "copy this note's absolute path" / "copy its vault-relative path". (The Cmd+= literal physical key for what users typically *call* "Cmd++" on a US keyboard.)
- **Dataview JS enable** — sets `enableDataviewJs:true` + `enableInlineDataviewJs:true` on `.obsidian/plugins/dataview/data.json` (gated on Dataview being enabled in `.obsidian/community-plugins.json`).

Daily blueprint v0.2.2 ships its own additions in lockstep:

- **Daily-notes autorun** — `autorun:true` on the existing `core_plugin_settings.daily-notes` entry, so today's daily note auto-opens on Obsidian startup.
- **Cmd+[** — bound to the core `daily-notes` command (the Cmd+[ key invokes "Open today's daily note" via the new shared `hotkeys[]` manifest field).

### NEW manifest fields (mechanism + blueprint)

```json
"hotkeys": [
  { "command_id": "workspace:copy-full-path", "modifiers": ["Mod"], "key": "-" }
]
```
Flat shape; one binding per entry. `Mod` is Obsidian's portable modifier (Cmd on macOS, Ctrl on Windows/Linux). For two bindings on a single command, declare two entries — the helper's first-wins logic lets the second overwrite become a `skipped_existing`. Validation rejects entries with empty `command_id` / non-array `modifiers` / empty `key` (skipped + warning history; siblings still applied).

```json
"community_plugin_settings": [
  { "id": "dataview", "settings": { "enableDataviewJs": true, "enableInlineDataviewJs": true } }
]
```
Mirror of `core_plugin_settings[]` exactly except target is `.obsidian/plugins/${id}/data.json`. `id` is path-traversal-validated (no `/` `\` `..` allowed). Substitution via `substituteLenient` round-trip on `JSON.stringify(settings)`. Plugin-dir absent → skip + history `info/skipped_plugin_dir_absent`. Pair with `external_plugins:[{id}]` so the broadened prereq gate in `applyCommunityPluginData` short-circuits when the plugin isn't enabled.

### NEW installer helpers

| Helper | Target | Posture |
|---|---|---|
| `applyCommunityPluginData` | `.obsidian/plugins/${id}/data.json` | additive shallow merge; substituted (manifest) wins; `.beacon-backup` on edit; idempotent skip on structural equality; broadened prereq gate (any external_plugins[] id absent → skip whole helper); plugin-dir absent → skip per entry; path-traversal validator on `id` |
| `applyHotkeys` | `.obsidian/hotkeys.json` | additive per-`command_id`; FIRST-WINS (existing user binding always preserved); `.beacon-backup` on edit; malformed-JSON guard; `info/applied` or `info/skipped_existing` history per entry |

Both wired into `installItem` after `applyCorePluginSettings` (CommunityPluginData, line 616) and after `applyStyleSettings` (Hotkeys, line 620). Helper count is now **9** (allowlist-touching helpers; 10 if you also count `applyExternalPlugins` and 11 if you count `applyNavButtons`).

### Lessons / gotchas

- **Broadened prereq gate vs styling helpers' `required:true` interpretation.** `_externalPluginsSatisfied` only flags entries with `required:true` as missing. The styling helpers (v0.19.0) honor that semantic. `applyCommunityPluginData` (v0.21.1) broadens it: ANY declared `external_plugins[]` id missing from `.obsidian/community-plugins.json` short-circuits the whole helper. Justification: writing `enableDataviewJs:true` to a plugin that isn't enabled is a wasted write that drifts on the next consumer reload. Future helpers should pick the semantic that fits their failure mode; the divergence is intentional.
- **First-wins on hotkeys is non-negotiable.** The convenience mechanism declares 2 hotkeys; the daily blueprint declares 1. If a consumer has already bound `daily-notes` to Cmd+\\, the daily blueprint's Cmd+[ becomes a `skipped_existing`. This is correct: the platform never modifies a user's hotkey. Authors who want to FORCE a binding need to explicitly tell the user to delete the prior binding first; there's no override knob.
- **`Mod` modifier portability.** Obsidian normalizes `Mod` to Cmd on macOS, Ctrl on Windows/Linux. Production accuris uses `Mod` throughout — verified working at v0.21.1 ship.
- **Allowlist 11 is the soft cap.** Adding a 12th path requires explicit user approval per CLAUDE.md non-negotiables + landmine #12. Bias toward extending an existing helper before proposing a new path.
