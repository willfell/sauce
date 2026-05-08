# CLAUDE.md — Sauce (workshop vault)

This is the **workshop vault** for the **Sauce** platform — the canonical home for the vault platform. It ships mechanisms (cross-cutting code) and blueprints (note-type bundles) that consumer vaults (accuris, headspace, ero) subscribe to. **No personal content lives here.**

## Project identity

- **Project name:** `sauce` (rebranded from `beacon` in v0.23.0)
- **GitHub remote:** `git@github-personal:willfell/sauce.git` (HTTPS: `https://github.com/willfell/sauce`) — personal account `willfellhoelter@gmail.com`
- **Local path:** `/Users/willfell/Documents/obsidian/sync/workshop/beacon` (renamed from `poc-vault` 2026-05-05; sibling consumer vaults: `barebones-beacon-poc` + `accuris-beacon-poc`).
- **Distribution model (post-v0.1.2 S2):** each consumer's `Docs/Meta/Templater/platformInstall.js` is a ~12-line content-static thin stub that dispatches at runtime to canonical `<workshop>/platform/install.js` via `require()`. Bootstrap-copy × 3 resync ritual retired (last stage was v0.1.2 S1). Updates reach consumers via `git pull` of the workshop repo + a fresh install run; the stub itself never changes (landmine #13).
- **Consumer-side namespace:** every blueprint materializes content under `beacon/<module_directory>/...` in the consumer vault (NOT at vault root). This keeps platform-managed content cleanly demarcated from the consumer's personal content.

## Vault identity check

Before any write, run `ls /Users/willfell/Documents/obsidian/sync/workshop/beacon` (or the equivalent path on your machine). Expected top-level: `CLAUDE.md`, `platform/`, `commands/`, `Docs/`, `.obsidian/`. If you see `Boards/`, `Timestamps/`, `Finance/`, `Resources/` at root, you're in a CONSUMER vault, NOT the workshop. STOP.

## Where to read for context

| If you're … | Read |
|---|---|
| Starting a fresh session | `Docs/prompts/SESSION-START.md` (canonical session-start recipe) |
| Starting any session | `Docs/Index.md` first |
| Onboarding a new consumer | `Docs/use.md` (section "Onboarding a new consumer vault") + `Docs/landmines.md` |
| Adding a new mechanism or blueprint | `Docs/how.md` + `Docs/landmines.md` + `Docs/plans/2026-05-02-vault-platform-design.md` |
| Working on v0.2.0 boards blueprint | `Docs/plans/2026-05-03-boards-blueprint-design.md` (full design + module-directory invariant rationale) |
| Debugging a failed install | `Docs/landmines.md` first, then `Docs/how.md` (installer section) |
| Catching up on closed cycles | `Docs/cycle-history.md` (archived per-cycle status snapshots) |
| Catching up on history | `Docs/plans/` in chronological order |
| Running a one-shot agent task | `Docs/prompts/` — each is copy-paste-ready for a fresh session |

## Non-negotiables

These are the **platform** non-negotiables. Eleven landmines in `Docs/landmines.md` (five customjs-guard + six platform) are derived rules; they apply to all platform code.

- **No personal content.** If you find yourself writing a daily note here, you're in the wrong vault.
- **All mechanisms and blueprints are versioned in `platform/manifest.json`.** Bump the version on any change to source files.
- **All file paths in mechanism / blueprint code use `{{template_variables}}`**, never hardcoded paths. The installer substitutes per-vault from each consumer's `platform-config.json`.
- **All platform metadata is JSON, not YAML.** Reason: Templater user scripts can't reach Obsidian's `parseYaml`. Files affected: `platform/manifest.json`, every `mechanisms/*/manifest.json`, every `blueprints/*/manifest.json`, every consumer's `platform-config.json` / `platform-subscription.json` / `platform-installed.json`, every `rules/*.json`.
- **The five customjs-guard landmines apply to every Dataview view** written in this workshop. See `Docs/landmines.md`.
- **The workshop dogfoods every release.** Before promoting a new mechanism / blueprint version to consumers, the workshop's own self-install must succeed. If workshop self-test fails, do not push the update.
- **Module-directory invariant under `spice/` namespace (decided 2026-05-03 originally as `beacon/`; refined 2026-05-04; codifies in v0.2.0; namespace renamed to `spice/` in v0.25.0).** Every blueprint owns ONE directory at `spice/<module_directory>/` in the consumer vault. All files the blueprint materializes — at install time OR at runtime via templates / commands / nav-button actions — live under that one directory. Cross-module data flows via wikilinks only. No module writes into another module's directory. Each blueprint's manifest declares `module_directory: "<name>"` (NEW required field, enforced by installer in v0.2.0). Examples: `spice/boards/`, `spice/to-do/`, `spice/trips/`, `spice/finance/`, `spice/projects/`, `spice/daily/`, `spice/journal/`, `spice/meetings/`. The `spice/` parent namespace cleanly demarcates platform-managed content from consumer personal content; consumers can have any other top-level structure they want without collision risk. Mechanisms are exempt — they're shared infrastructure, not modules; mechanisms continue to install under `ranch/...` per existing conventions. See `Docs/landmines.md` #11 + `Docs/plans/2026-05-03-boards-blueprint-design.md`. **v0.25.0 status:** Tree 2 rename `beacon/<module>/` → `spice/<module>/` SHIPPED; the invariant itself was unchanged across the rename. The single source-of-truth prefix lives at `install.js:250`.

## Git workflow

Sauce is a real published repo at `git@github-personal:willfell/sauce.git`. Commits and pushes to `main` are part of the active development flow — Claude commits at agreed checkpoints (typically per-stage close, occasionally per-task during implementer dispatches) and pushes to `origin/main` after each commit. **Single-branch workflow for now** — direct push to `main`, no feature branches, no pull-request review.

- **Commit at every stage close.** Bundle stage work into a single commit with a conventional-commits style message (e.g., `feat(installer,validator): v0.1.x patch S1 — ...`). Use HEREDOC for multiline messages.
- **Push to `origin/main` after each commit.** No staging, no PR. `git push origin main` is the canonical publish step.
- **Don't sign as Claude.** No `Co-authored-by: Claude` trailer; no AI-attribution. Author is the user.
- **Don't skip hooks** (`--no-verify`) unless the user explicitly requests it. If a pre-commit hook fails, fix the underlying issue and create a NEW commit.
- **Force-pushing + history rewrite** still require explicit approval (see "Ask before acting" below).
- **PR-based workflow returns** when collaborators or CI gates land. For now (single-developer single-machine), direct push is the workflow.

## Ask before acting

Stop and ask the user before any of:

- Modifying anything inside `.obsidian/` of any vault EXCEPT for the three installer-managed paths allowlisted in landmine #12:
  - `.obsidian/plugins/templater-obsidian/data.json`
  - `.obsidian/plugins/slash-commander/data.json`
  - `.obsidian/daily-notes.json` (added in v0.3.0)
  Edits to these three paths must follow landmine #12's safety mechanics (additive-merge-only, backup-on-edit, malformed-JSON guard, failure-loud history).
- Modifying the body of `Docs/Meta/Templater/platformInstall.js` in any consumer (the thin stub is content-static per landmine #13; lockstep change across all consumers + distribution-model bump required).
- Editing `platform/installer-stub.js` (changes the canonical stub body; cascades to every consumer in the next deployment).
- Creating a new top-level directory in any vault (in consumers, prefer `beacon/<module>/` for platform-managed content).
- Bumping `workshop_version` in `platform/manifest.json` (it's the global release marker).
- Editing or removing files inside `platform/mechanisms/*/` after a version has been promoted to a consumer.
- Editing a consumer's `platform-installed.json` by hand (it's auto-managed by the installer).
- **Force-pushing or rewriting history** on `origin/main` of the `sauce` remote (`git push --force`, `git reset --hard origin/...`, `git rebase -i` on already-pushed commits, etc.).
- **Sanctioned new top-level vault dirs:** `spice/<module>/` (blueprint content; landmine #11; renamed from `beacon/<module>/` in v0.25.0) AND `pantry/` (workshop clone for inside-vault layout; renamed from `Beacon/` in v0.23.0 to resolve macOS APFS case-collision) AND `ranch/` (runtime plumbing; renamed from `Docs/Meta/` in v0.24.0). Other top-level dirs still require approval. The `pantry/` + `ranch/` + `spice/` namespace tripod is the canonical layout post-v0.25.0.

## Directory map

```
workshop/poc-vault/
├── CLAUDE.md                           This file.
├── Docs/                               All documentation. Start at Index.md.
│   ├── Index.md
│   ├── why.md                          Purpose and end goal.
│   ├── how.md                          Architecture and concepts.
│   ├── use.md                          Operational guide.
│   ├── landmines.md                    Traps to avoid.
│   ├── plans/                          Chronological design / implementation plans.
│   └── prompts/                        Copy-paste-ready agent prompts.
├── platform/                           CANONICAL PLATFORM SOURCE. Edit with care.
│   ├── manifest.json                   Workshop version + mechanism + blueprint catalogue.
│   ├── install.js                      The installer. Source-of-truth.
│   ├── mechanisms/                     Cross-cutting code (customjs-guard, validator, audit).
│   └── blueprints/                     Note-type bundles (none yet).
├── Docs/Meta/                          The workshop's own consumer-side state.
│   ├── platform-config.json            Self-install path map.
│   ├── platform-subscription.json      Self-subscription.
│   ├── platform-installed.json         Auto-managed install ledger.
│   ├── Templater/                      Materialized user scripts (auto-installed).
│   ├── Views/                          Materialized Dataview views (auto-installed).
│   ├── Scripts/                        CustomJS classes (none in workshop).
│   ├── Templates/                      Templater templates (incl. _install-platform).
│   └── rules/                          Rule registry (_global.json + per-blueprint).
├── commands/                           Master copy of cross-cutting slash commands.
└── .obsidian/                          Plugin configs.
```

## Status (live)

For closed-cycle status snapshots (v0.1.0 through the most recent close), see `Docs/cycle-history.md`. Live pointers below summarize the current platform state; the cycle-narrative bullets that previously lived here have been archived.

- **Cycle order:** v0.1.0 ✅ → v0.1.1 ✅ → v0.1.x ✅ → v0.1.3 ✅ → v0.1.2 ✅ → v0.2.0 ✅ → v0.3.0 ✅ → v0.4.0 ✅ → v0.3.2 ✅ → v0.4.2 ✅ → v0.5.0 ✅ → v0.11.0 ✅ → v0.12.0 ✅ → v0.13.0 ✅ → v0.14.0 ✅ → v0.6.0 ✅ → v0.16.0 ✅ → v0.17.0 ✅ → v0.18.0 ✅ → v0.18.1 ✅ → v0.18.2 ✅ → v0.19.0 ✅ → v0.20.0 ✅ → v0.21.0 ✅ → v0.21.1 ✅ → v0.22.0 ✅ → v0.22.1 ✅ → v0.23.0 ✅ → v0.24.0 ✅ → v0.25.0 ✅ → v0.26.0 ✅ → v0.26.1 ✅ → v0.27.0 ✅ → v0.28.0 ✅ → **next TBD (v0.28.1 PATCH = bundle v0.28.0 quality NITs — DRY frontmatter parsing across 5 migrators, per-phase timing in migration.log, `--keep-backups` wiring or removal — PLUS v0.27.0 carries [autocomplete, AS6, tmp-orphan, latent v0.26.0 carries]. OR v0.29.0 journal-migrator + meetings-hub source-shape audit for ero/headspace + full Sauce-shape project ecosystem [Atlas/Map/Board/tasks generation])**.
- **Workshop version:** `0.28.0` (bumped from 0.27.0 in v0.28.0 — NEW `sauce migrate` CLI verb + 8 per-blueprint migrators [people / daily / meetings-note / meetings-hub / to-do / boards / project / trips] + 5-phase atomic --commit orchestrator + cross-blueprint wikilink-rewrite + phase 4.7 post-write verification + phase 4.8 auto-recovery + 12-rule LEGACY_PATH_SUBSTITUTIONS table + new run-migrate.js harness [104 sub-asserts across 9 selectors] + 3 real-vault rollouts [accuris/ero/headspace]. Mechanism count UNCHANGED at 9; blueprint count UNCHANGED at 9; helper count UNCHANGED at 12; allowlist UNCHANGED at 13; landmines `19 → 20` (NEW #20 source vault read-only); stub md5 invariant `ea23aa812503bfca66359d3b2b239ba8` UNCHANGED; tag `v0.28.0` pending USER APPROVAL).
- **Mechanisms:** `customjs-guard@1.0.0`, `validator@0.1.1`, `audit@0.1.1`, `nav-buttons@2.5.3`, `cards@0.2.4`, `accent-button@0.1.0`, `people-rendering@0.1.0` (NEW v0.27.0), `styling@0.1.2`, `convenience@0.1.0`.
- **Blueprints:** `boards@0.1.0`, `daily@0.2.3`, `journal@0.1.2`, `meetings@0.3.0` (MINOR v0.27.0 — pilot integration with people-rendering chip subtitle + ## Attendees template block), `people@0.1.0` (NEW v0.27.0), `project@1.3.6`, `to-do@0.1.4`, `trips@0.1.5`, `finance@0.2.10`.
- **Six load-bearing harnesses:** `platform/test/run-install.js` (legacy harness; superseded by run-helper-cases.js), `platform/test/run-helper-cases.js` (424/0; +0 in v0.28.0), `platform/test/run-renderer.js` (30 cases exit 0; +0 in v0.28.0), `platform/test/run-bootstrap.js` (58/0; +0 in v0.28.0), `platform/test/run-cli.js` (50/0; +8 sub-asserts in v0.28.0 via C23-C28 for cmd-migrate), `platform/test/run-install-sh.js` (14/0; +0 in v0.28.0). **v0.28.0 added `platform/test/run-migrate.js`** (NEW; 104 sub-asserts across 9 selectors — dispatcher / verbatim / people / daily / meetings-note / meetings-hub / to-do / wikilink / commit; CM4-CM6 added in CF-10 +11 sub-asserts for phase 4.7 verification + phase 4.8 recovery + same-folder multi-write regression guard). Whole-suite green preserved across v0.21.0 → v0.28.0.
- **New manifest schema fields (v0.4.2 BREAKING + ADDITIVE):** `nav_buttons[].action` for `runTemplaterTemplate` is REPLACED with the split-field schema (BREAKING; v0.4.0 single-string `folder`/`filename` retired): `folder_prefix` (literal, substituted via substituteLenient; required, validated), `folder_date_pattern` (string passed verbatim to moment.format; empty string allowed = no date in folder), `filename_prefix` (literal), `filename_date_pattern` (string for moment.format), `filename_suffix` (literal). Renderer composes `<prefix><moment.format(date_pattern)><suffix>` for both folder + filename. NEW additive action type `nav_buttons[].action.type: "invoke_command"` (`{ command_id }`) — fires arbitrary Obsidian command via `app.commands.executeCommandById`; command_id preserved verbatim through `validateAndResolve` passthrough; runtime gates (missing command, missing command_id) emit Notice.
- **New installer mechanics (v0.4.2):** (1) S1 `validateAndResolve` rewrite — runTemplaterTemplate branch validates required `folder_prefix` (Notice + history warning + null return on absence); substitutes `folder_prefix` + `filename_prefix` + `filename_suffix` via `substituteLenient`; passes `folder_date_pattern` + `filename_date_pattern` verbatim. `substituteForMomentFormat` helper DELETED. (2) S3 `validateAndResolve` adds invoke_command branch (literal passthrough; command_id NOT substituted).
- **New installer mechanics (v0.5.0):** S2.3 `validateAndResolve` adds `openLink` branch — substitutes `action.target` via `substituteLenient` so `{{module_directory}}/Projects.md` resolves at install time. The renderer (space-nav-buttons.js line 248) had supported `openLink` dispatch since v2.0.0 but install.js never had a substitution branch (literal placeholders reached the registry). Closes the dead-code gap.
- **Landmines list:** **20 entries (v0.28.0 ADDED #20 — source vault is read-only during `sauce migrate`; future migrator code review must reject any `srcAbsPath`-rooted write; allowlist UNCHANGED at 13 paths; helper count UNCHANGED at 12; stub md5 invariant UNCHANGED). 19 entries UNCHANGED in v0.27.0 — purely additive cycle: NEW people-rendering@0.1.0 mechanism + NEW people@0.1.0 blueprint + cards@0.2.4 + nav-buttons@2.5.3 + meetings@0.3.0 pilot; allowlist UNCHANGED at 13 paths; helper count UNCHANGED at 12. v0.26.0 ADDED #19 — platform-managed dir names lowercase + OUT-of-scope exceptions enumerated explicitly: MM-MMMM date-routed folders, assets/themes/<ThemeName>/ vendored, user-facing note filenames, Docs/plans + Docs/prompts historical, pantry/, spice/. Codifies the v0.26.0 lowercase sweep + macOS APFS `git mv X X_tmp && git mv X_tmp x` recovery pattern. Helper count 10 → 11 with NEW `scaffoldFoundationalPluginData`; allowlist #12 UNCHANGED at 12 paths)**. **18 entries UNCHANGED in v0.24.0** (allowlist #12 expanded 11 → 12 paths [USER APPROVED] adding `.obsidian/plugins/customjs/data.json` for new `applyCustomJsSettings` helper; helper count 9 → 10; landmine #13 wording amended capturing new stub md5 `ea23aa812503bfca66359d3b2b239ba8` + Tree N rename history). **18 entries UNCHANGED in v0.23.0** (Sauce rebrand: #11 wording amended to forecast v0.25.0 rename to `spice/<module>/`; #18 amended to reference `pantry/` as the v0.23.0+ workshop clone dir name + Beacon/ as historical alias). v0.22.0 adds #18 — inside-vault `Beacon/` is git-managed, never hand-edit; mirrors #15 vendored-theme posture; recovery via `beacon update --force`. UNCHANGED in v0.21.1 — no new landmines added; landmine #12 expanded 9 → 11 paths [USER APPROVED] adding `.obsidian/plugins/dataview/data.json` + `.obsidian/hotkeys.json` for the convenience@0.1.0 mechanism; helper count 7 → 9 with `applyCommunityPluginData` + `applyHotkeys`). v0.21.0 added #17 — bootstrap network posture: failure-loud + idempotent skip-if-present + path-traversal validator + `.beacon-backup` on overwrite + GITHUB_TOKEN honored + redirect-following + GitHub-only host + no mid-fetch cleanup; codifies the bootstrap layer's network exposure as bounded + reviewable. v0.21.0 also amends #8 — install.js is desktop-only filesystem-only; bootstrap.js is the network gateway. Allowlist #12 expanded 6 → 9 paths [USER APPROVED] adding `.obsidian/plugins/<id>/{main.js,manifest.json,styles.css}` for vendored plugin files. v0.20.0 added #16 — in-cycle re-process bump rule; promotes the gotcha 9 5-data-point precedent across v0.6.0 / v0.17.0 / v0.18.0 / v0.18.1 / v0.19.0 to numbered landmine status; quotes `install.js:223` short-circuit literally; codifies 4-file lockstep edit rule for mechanism cycles. v0.19.0 adds #15 — vendored theme is mechanism-owned; never hand-edit `.obsidian/themes/<Name>/`; codifies the only overwrite-with-backup posture path in the .obsidian/ allowlist; customizations route through Style Settings JSON or .obsidian/snippets/; landmine #12 also expanded 3 → 6 paths + helper count 4 → 7. v0.20.0 also fixed pre-existing landmine #10 line-citation drift — `install.js:111` → `:223` + matched ordering with #16's literal quote). No new landmines in v0.11.0 / v0.12.0 / v0.13.0 / v0.14.0 / v0.6.0 / v0.16.0 / v0.18.0 / v0.18.1 / v0.18.2. v0.16.0 surfaced FIVE new platform values that may graduate to numbered gotchas in future cycles: (a) **YAML date auto-parsing** — frontmatter values matching YYYY-MM-DD or YYYY-MM auto-parse to Date|Luxon objects; quote on creation + tolerant parse on read; (b) **frontmatter parser variance for booleans** — inline-flow YAML `paid: true` may produce string `"true"`; centralize coercion; (c) **NBSP gotcha from manual frontmatter editing** — copy/paste through chat/markdown renderers introduces U+00A0; reinforces "no manual frontmatter" thesis (v0.17.0 widget priority); (d) **renderBadge() pattern** — status pills on entity NOTE pages via dataviewjs block embedded by NewXButton creation helpers; reusable across entity blueprints with status concepts; (e) **embed dedup via `dv.container.closest(".markdown-embed")`** — suppress duplicated nav-buttons when a note is embedded via `![[X]]` inside another note. v0.6.0 lessons preserved + reinforced (gotcha 9 reserved-headroom pattern strengthened to FIVE-data-points: v0.5.0 / v0.11.0 / v0.12.0 / v0.6.0 / v0.16.0 all USED 0.Y.x headroom 4-6 times). v0.6.0 reinforced: gotcha 2 Cmd+R discipline (user's H/I failures were stale class registration; now codified as numbered smoke step for cycles introducing new CustomJS classes); gotcha 9 in-cycle re-process bump rule (FOUR in-cycle CFs trips 0.1.0 → 0.1.4; reserved 0.15.x headroom USED extensively); gotcha 11 dual-source-of-truth lockstep (per-blueprint version bumps need lockstep edits to BOTH blueprint manifest AND workshop catalogue line + barebones sub — held across all 4 CFs); landmine #11 module-directory invariant (per-entity sub-folders like `<slug>/board/` live within the invariant, not as new sub-modules — same as project's `<slug>/tasks/<task>/` pattern). NEW v0.6.0 platform values codified: (a) **API-contract quoting** — existing mechanism API contracts must be QUOTED literally in design docs, not described abstractly (CF-1 root cause: TripsHubCards called `render(dv, items, opts)` but BeaconCards' API is `render(dv, opts)` with field-functions; design described "field-function API matching ProjectsHubCards precedent" but didn't quote the call shape); (b) **first-of-its-kind blueprint cycles draw 3-5 inline CFs** — design phase locks SHAPE, CFs refine FEEL; plan reserved Y.Z.x headroom for entity-ecosystem cycles; (c) **template-changing CFs cause migration friction** — existing entities retain old body content because templates are read at creation time, not retroactively applied; design templates as bare-as-possible from the start; (d) **per-entity sub-folder pattern** — `<slug>/board/<task>/` mirrors project's `<slug>/tasks/<task>/`; both stay within landmine #11's "one module_directory per blueprint" rule; (e) **Templater auto-promote pattern** — Trip Board Card's `tp.file.move` mirrors project Kanban Card; reusable for any future entity blueprint that needs per-task folders. v0.14.0 lessons preserved: helper-extraction-string-not-moment + regex-precedent-reuse + zero-config-default + TDD-first commit pattern.
