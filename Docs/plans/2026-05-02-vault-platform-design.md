---
created: 2026-05-02
tags:
  - accuris
  - plan
  - 2026/05/02
status: design-approved
---

# Vault Platform — Design

> [!abstract] Goal
> Make the four vaults (workshop, accuris, headspace, ero) **structurally mirrored** and **mechanism-coherent**, so that introducing a new pattern (like customjs-guard) becomes a one-vault iteration + per-consumer opt-in install — never another 3-phase rollout dance.

> [!success] Headline
> A canonical **workshop vault** holds shared mechanisms and blueprints. Each consumer vault subscribes to what it wants, declares its variants, and pulls updates on the user's schedule. Audit reports drift; nothing pushes silently.

---

## Non-goals

- **Not** a content sync. Notes stay vault-private. The workshop never holds your daily notes, projects, or invoices.
- **Not** a real Obsidian community plugin (yet). Everything runs through Templater + Dataview + a small installer script. Plugin-ization is a future option.
- **Not** automatic propagation. The workshop is "dev"; consumers promote on demand via `tp.user.platformInstall()`.

---

## Concepts

### Mechanism
Cross-cutting code shared by every vault. Examples: `customjs-guard` (the Dataview view + CSS snippet), `validator` (the rule-engine), `audit-walker` (drift detection). One canonical copy in the workshop; each consumer materializes a copy via the installer.

### Blueprint
A bundle defining a *note type*. Examples: `project`, `daily`, `invoice`, `todo-card`, `summary`. A blueprint contains: the rule file, the Templater template(s), any helper CustomJS classes, any related slash commands, and a `variants.yml` that lets each vault rename it without forking (e.g., `project` → `side-quest` in headspace).

### Subscription
Per-vault `Docs/Meta/platform-subscription.yml` declaring which mechanisms and blueprints this vault adopts, and at which version. Source of truth for the installer.

### Variant
Per-vault customization on top of a blueprint without forking. Declared in subscription via `alias:` (rename) and/or `customizations:` (path to vault-local override file).

---

## Architecture — four vaults on Obsidian Sync

```
~/notes/                          (parent dir on every machine)
  workshop/                       Canonical platform vault
  accuris/                        Consumer vault
  headspace/                      Consumer vault
  ero/                            Consumer vault
```

All four sync independently via Obsidian Sync. Cross-vault filesystem access is by relative path: a consumer's installer reads from `../workshop/`. Per-machine absolute path differs (`/Users/willfell/...` vs `/Users/willfellhoelter/...`); the *relative* layout is identical.

### Workshop vault layout

```
workshop/
  CLAUDE.md                       Identifies this as the workshop. No personal content.
  platform/
    manifest.yml                  Version catalogue of every mechanism + blueprint.
    install.js                    The installer (Templater user-script).
    mechanisms/
      customjs-guard/
        view.js                   Dataview view (top-level body, no module.exports).
        loader.css                The spinner/loader CSS snippet.
        rule.yml                  Rule fragment merged into _global.yml on install.
        manifest.yml              Mechanism metadata (version, files, install steps).
      validator/
        validate.js               tp.user.validate(file, moduleId?).
        hook.js                   tp.hooks.on_all_templates_executed handler.
        manifest.yml
      audit/
        audit-walker.js           Used by the /audit slash command.
        manifest.yml
    blueprints/
      project/
        rule.yml
        templates/
          atlas.md
          structure.md
          card.md
        helpers/
          ProjectNavButtons.js    CustomJS class shipped with this blueprint.
          ProjectWorkstreams.js
          ProjectWorkstreamManager.js
        commands/
          project.md              Slash command shipped with this blueprint.
        variants.yml              Maps blueprint name to per-vault aliases.
        manifest.yml
      daily/
      invoice/
      todo-card/
      summary/
    rule-schemas/
      _global.schema.json
      project.schema.json
      …
  commands/                       Master copy of cross-cutting slash commands (audit, etc.).
  Docs/plans/                     Design docs (this file lives here once workshop exists).
```

### Canonical consumer-vault layout

Every consumer adopts the same structure post-migration:

```
<consumer>/
  CLAUDE.md                       Vault navigator. References Docs/Meta/rules/ for non-negotiables.
  Docs/
    Meta/
      Scripts/                    CustomJS classes (scanned by CustomJS plugin).
      Views/                      Dataview view scripts (NOT scanned).
      Templates/                  Templater templates (consumer-owned + workshop-installed).
      QuickAdd/                   QuickAdd scripts.
      Templater/                  tp.user.* user scripts.
      rules/                      Machine-readable rule registry.
        _global.yml
        project.yml               (or side-quest.yml after alias)
        daily.yml
        …
      platform-config.yml         Per-vault path conventions (mostly canonical now).
      platform-subscription.yml   What this vault subscribes to.
      platform-installed.yml      What's currently installed (installer writes; audit reads).
    plans/                        Design docs and rollout plans.
  Boards/
    To-Do/
      cards/<YYYY>/<MM-Month>/    Standard to-do cards.
    planning/
      <slug>/
        atlas.md, structure.md, board.md, tasks/
  Timestamps/
    <YYYY>/<MM-Month>/            Daily notes.
    Audits/                       /audit reports.
    Summaries/<YYYY-MM-DD>/
    Journal/                      (where applicable)
    ToDo/                         Daily todo notes.
  Cowork/
    context/
    prompts/
  Resources/
    People/
    Reference/
  Finance/                        (ero + headspace only)
  .obsidian/
    snippets/                     CSS snippets including customjs-loader.css.
    plugins/customjs/data.json    jsFolder: "Docs/Meta/Scripts" (canonical).
```

Vault-specific top-level dirs (e.g., ERO's `Projects/` if it stays separate from `Boards/planning/`) are allowed but documented in CLAUDE.md.

---

## Subscription file shape

```yaml
# accuris/Docs/Meta/platform-subscription.yml
workshop_version: 0.1.0           # platform/manifest.yml version this vault is pinned to

mechanisms:
  - { name: customjs-guard, version: 1.0.0 }
  - { name: validator, version: 1.0.0 }
  - { name: audit, version: 1.0.0 }

blueprints:
  - { name: project, version: 0.4.0 }
  - { name: daily, version: 1.2.0 }
  - { name: todo-card, version: 1.0.0 }
  - { name: summary, version: 0.3.0 }
```

```yaml
# headspace/Docs/Meta/platform-subscription.yml
workshop_version: 0.1.0

mechanisms:
  - { name: customjs-guard, version: 1.0.0 }
  - { name: validator, version: 1.0.0 }
  - { name: audit, version: 1.0.0 }

blueprints:
  - { name: project, version: 0.4.0, alias: side-quest, customizations: ./customizations/side-quest.yml }
  - { name: daily, version: 1.2.0, customizations: ./customizations/daily.yml }
  - { name: todo-card, version: 1.0.0 }
```

```yaml
# ero/Docs/Meta/platform-subscription.yml
workshop_version: 0.1.0

mechanisms:
  - { name: customjs-guard, version: 1.0.0 }
  - { name: validator, version: 1.0.0 }
  - { name: audit, version: 1.0.0 }

blueprints:
  - { name: project, version: 0.4.0 }
  - { name: invoice, version: 0.2.0 }
  - { name: todo-card, version: 1.0.0 }
```

---

## Rule registry shape

`_global.yml` applies to all notes. Per-blueprint files apply when a note's `module:` frontmatter matches.

```yaml
# Docs/Meta/rules/_global.yml
required_frontmatter:
  created: { type: datetime, required: true, format: "YYYY-MM-DD HH:mm" }
  tags: { type: array, required: true }

required_tags:
  - { tag: "{{vault_identity_tag}}", position: 0 }   # accuris | life | (none for ero)
  - { tag: "{{date_tag}}", position: -1, pattern: "YYYY/MM/DD", when: dated_note }

forbid_emojis_in:
  - frontmatter
  - headers

forbid_dataviewjs_patterns:
  - { pattern: "await customJS\\.", reason: "use customjs-guard instead" }
```

```yaml
# Docs/Meta/rules/project.yml
module: project
description: Project atlas/structure/card notes under Boards/planning/
applies_to:
  paths:
    - "Boards/planning/*/*.md"
    - "Boards/planning/*/tasks/**/*.md"

required_tags:
  - { tag: project-card, position: 1 }

required_frontmatter:
  workstream: { type: string, required: true, source: atlas_workstreams }
  source_board: { type: string, required: true }

required_blocks:
  - type: dataviewjs
    content: 'await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });'
  - type: dataviewjs
    when: "frontmatter.kind != 'task'"
    content: 'await dv.view("{{views_path}}/customjs-guard", { class: "ProjectNavButtons" });'

naming_pattern: "{Title Case Title}.md"
forbid_sections: ["## Summary", "## Notes", "## Referenced By"]
```

`{{views_path}}` and `{{vault_identity_tag}}` substitute from `platform-config.yml` at install time.

---

## Validator + Templater hook

### `tp.user.validate(file, moduleId?)`
1. If `moduleId` not passed, read `file.frontmatter.module` (or fall back to `_global` only).
2. Load `_global.yml` + `<moduleId>.yml` from `Docs/Meta/rules/`.
3. Apply rules: tags, frontmatter, required blocks, naming, forbidden sections.
4. Return `{ fixes: [], violations: [] }`. Caller decides whether to apply fixes.

### `tp.hooks.on_all_templates_executed`
The hook handler — installed once per vault, lives at `Docs/Meta/Templater/hook-validate.js`. After every template fires:
1. Read frontmatter to find module ID.
2. Call `tp.user.validate`.
3. Apply auto-fixes (tag order, missing date tag, frontmatter-shape gaps).
4. For unfixable violations: surface a `new Notice("Project note missing ProjectNavButtons block")` and write a marker to `Docs/Meta/_lint-queue.yml` for batch review.

### Slash command `/lint`
On-demand single-file lint from the command palette. Same code path; just user-triggered.

---

## Installer — `tp.user.platformInstall()`

Idempotent. Run from any consumer vault. Reads:
1. `../workshop/platform/manifest.yml` — what's available.
2. `Docs/Meta/platform-subscription.yml` — what this vault wants.
3. `Docs/Meta/platform-config.yml` — vault path mapping.
4. `Docs/Meta/platform-installed.yml` — what's currently installed (or empty on first run).

For each subscribed mechanism / blueprint:
1. Compare subscribed version vs. installed version. Skip if equal.
2. For mechanisms: copy files into vault paths declared in `platform-config.yml`, performing variable substitution (`{{views_path}}`, `{{vault_identity_tag}}`, etc.).
3. For blueprints: copy templates, helpers, commands into vault paths. Apply alias + customizations from subscription. Merge rule fragments into `Docs/Meta/rules/<module>.yml` (idempotent — diff-based, never duplicates).
4. For mechanisms that ship CSS or `.obsidian/` changes: pause for user approval, show diff, apply on confirm.
5. After all installs succeed, write `Docs/Meta/platform-installed.yml` with: workshop version, per-mechanism versions, install timestamp, install host (machine).

Failure mode: if any step fails, rollback that mechanism only (delete copied files, leave `platform-installed.yml` showing prior version). Other mechanisms' installs proceed.

---

## Audit — drift detection

Extends the existing `/audit` slash command:

1. Reads `Docs/Meta/platform-installed.yml` and `../workshop/platform/manifest.yml`.
2. For each subscribed mechanism / blueprint, compare versions. Report any vault whose installed version is behind workshop.
3. Walks every `.md` file. For each, runs `tp.user.validate`. Aggregates violations by rule, severity, file.
4. Writes `Timestamps/Audits/YYYY-MM-DD-audit.md` with sections: platform-version-drift, content-violations, manual-review-queue.
5. Severity tiers (matches your existing `/audit` 🔴🟡🟢 convention).

---

## Migration plan

You agreed to full canonical migration with backups. Six phases. Each is its own card / phased rollout (we know the pattern).

### Phase 0 — Backups
- Before any structural change, a tarball / Time Machine snapshot of each vault.
- A `git init` per vault (if not already) and a "pre-migration" commit. Local git, not pushed.

### Phase 1 — Create the workshop vault
- New vault at `~/notes/workshop/`.
- Initial `CLAUDE.md` (workshop identity), `platform/manifest.yml` (empty / 0.0.1), `platform/install.js` skeleton.
- Move customjs-guard mechanism (already proven in accuris) into `workshop/platform/mechanisms/customjs-guard/`. First entry in the manifest. Tag as 1.0.0.
- Configure Obsidian Sync to sync the workshop vault.

### Phase 2 — Build validator + audit mechanisms in the workshop
- Author `validator/validate.js` and `validator/hook.js` against the rule schemas.
- Author `audit/audit-walker.js`.
- Tag each as 1.0.0 in the manifest.

### Phase 3 — Per-vault canonical-path migration
For each consumer vault (accuris first, then ero, then headspace), in order:

1. Move CustomJS classes into `Docs/Meta/Scripts/` (already canonical for accuris/ero; headspace migrates from `Resources/Scripts/`). Update CustomJS plugin's `data.json` accordingly.
2. Create `Docs/Meta/Views/`. Move `customjs-guard/view.js` here from current location (Extras/Scripts/ for accuris, Resources/Views/ if installed in headspace, etc.). Update every callsite's `dv.view(...)` path.
3. Move templates from `Extras/Templates/` (accuris/ero) to `Docs/Meta/Templates/`.
4. Create `Docs/Meta/Templater/` for `tp.user.*` user-scripts.
5. Update `.obsidian/plugins/customjs/data.json` `jsFolder` to canonical (`Docs/Meta/Scripts`).
6. Verify all dataviewjs blocks still render. Run `/audit` to catch missed callsites.
7. Commit the migration.

### Phase 4 — Bootstrap the platform in each consumer
1. Write `Docs/Meta/platform-config.yml` with the canonical paths (mostly identical across vaults now).
2. Write `Docs/Meta/platform-subscription.yml` declaring what this vault wants.
3. Run `tp.user.platformInstall()` for the first time. Validates it works end-to-end.
4. Write `Docs/Meta/platform-installed.yml`.

### Phase 5 — Migrate existing blueprints into the workshop
For each existing note-type (project, daily, invoice, todo-card, summary):
1. Pick the most refined version across the three vaults.
2. Author the blueprint in `workshop/platform/blueprints/<name>/` (rule + templates + helpers + commands + variants).
3. Tag at version 0.x.x.
4. Update each consumer's subscription. Run `tp.user.platformInstall()`. Verify diff against pre-migration content. Reconcile.

### Phase 6 — Retire vestigial pieces
- Delete `claude-sync/` from each consumer (workshop now owns the canonical).
- Drop `Extras/Templates/` and `Resources/Templates/` after templates are in `Docs/Meta/Templates/`.
- Drop `Resources/Scripts/` from headspace (now in `Docs/Meta/Scripts/`).
- Update each CLAUDE.md to point at the new structure and reference the platform.
- Final audit. Confirm clean.

---

## Adding a new mechanism (post-migration)

1. Iterate in workshop. Build it in `workshop/platform/mechanisms/<new-name>/`. Test locally if possible.
2. Tag in `workshop/platform/manifest.yml`. Bump version.
3. In each consumer (when ready), add to `Docs/Meta/platform-subscription.yml`. Run `tp.user.platformInstall()`.
4. Audit confirms install. Done.

No 3-phase rollout cards. No per-vault discovery + audit + implementation. The mechanism is build-once, install-N-times.

---

## Adding a new blueprint (post-migration)

1. In workshop, scaffold `blueprints/<name>/` (rule.yml, templates/, helpers/, commands/, variants.yml, manifest.yml).
2. Iterate in one consumer vault (your choice) by subscribing and running install. Refine until shipped.
3. Tag in workshop manifest.
4. Other consumers subscribe when ready. Each can declare its own alias + customizations.

---

## Open questions

1. **Workshop hosting.** Workshop vault = local Obsidian Sync only, or also pushed to a private GitHub for backup / external collaboration? Affects bootstrap simplicity.
2. **Templater user-script hot-reload.** Templater requires reloading when `tp.user.*` scripts change. After running `tp.user.platformInstall()`, do we need to prompt the user to reload Templater? (Probably yes; document in the install command output.)
3. **`.obsidian/` propagation.** Some plugin configs (CustomJS scan folder, snippet enable list) need to be canonical-aware. Do we manage these via the installer with approval prompts, or hand-edit per vault during Phase 3?
4. **Rollback story.** If `tp.user.platformInstall()` fails halfway, the rollback is per-mechanism. Is that strong enough, or do we want a snapshot-the-vault-first option?
5. **Multi-machine timing.** Obsidian Sync is eventually consistent. If you run install on machine A right after a workshop edit, and machine B hasn't synced the workshop yet, install on B picks up stale state. Do we add a "wait for sync" gate?

---

## Status

- [x] Architecture approved.
- [x] Workshop + four-vault model approved.
- [x] Mechanism + blueprint + subscription concepts approved.
- [x] Full canonical migration approved (with pre-migration backups).
- [ ] Phase 0 — backups + git init each vault.
- [ ] Phase 1 — create workshop vault, seed with customjs-guard.
- [ ] Phase 2 — build validator + audit mechanisms.
- [ ] Phase 3 — canonical-path migration in each consumer (accuris → ero → headspace).
- [ ] Phase 4 — bootstrap platform in each consumer.
- [ ] Phase 5 — migrate blueprints into workshop.
- [ ] Phase 6 — retire vestigial pieces, final audit.
- [ ] Resolve open questions 1-5.
