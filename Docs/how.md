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

`tp.user.platformInstall(tp)` runs as a Templater user script. Steps:

1. Read `Docs/Meta/platform-config.json` → vault path map + variables.
2. Read `Docs/Meta/platform-subscription.json` → what this vault wants.
3. Read `Docs/Meta/platform-installed.json` → what's currently installed (or empty).
4. Resolve workshop absolute path via `app.vault.adapter.basePath` + `config.workshop_relative_path`.
5. Read `<workshop>/platform/manifest.json`.
6. For each subscribed mechanism:
   a. Look up in workshop manifest. Skip if version mismatch with subscription.
   b. Compare with installed; skip if already at this version.
   c. Read mechanism's `manifest.json` from workshop.
   d. For each file in the mechanism: read source, substitute `{{vars}}`, write to dest. Approval-gate any file with `"approval": "required"`.
   e. Run `post_install` steps: `enable_snippet` (with optional approval), `notice` (informational popup).
   f. Append to `installed` + `history`.
7. Write `Docs/Meta/platform-installed.json`.
8. Show "platformInstall: complete." Notice.

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
