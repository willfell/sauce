# CLAUDE.md — Beacon (workshop vault)

This is the **workshop vault** for the **Beacon** platform — the canonical home for the vault platform. It ships mechanisms (cross-cutting code) and blueprints (note-type bundles) that consumer vaults (accuris, headspace, ero) subscribe to. **No personal content lives here.**

## Project identity

- **Project name:** `beacon`
- **GitHub remote:** `git@github-personal:willfell/beacon.git` (HTTPS: `https://github.com/willfell/beacon`) — personal account `willfellhoelter@gmail.com`
- **Local path:** `/Users/willfell/Documents/obsidian/sync/workshop/poc-vault`
- **Distribution model (post-v0.1.2):** consumers `git pull` the workshop repo + run install via the thin stub bootstrap. The remote is the source of truth across machines.
- **Consumer-side namespace:** every blueprint materializes content under `beacon/<module_directory>/...` in the consumer vault (NOT at vault root). This keeps platform-managed content cleanly demarcated from the consumer's personal content.

## Vault identity check

Before any write, run `ls /Users/willfell/Documents/obsidian/sync/workshop/poc-vault` (or the equivalent path on your machine). Expected top-level: `CLAUDE.md`, `platform/`, `commands/`, `Docs/`, `.obsidian/`. If you see `Boards/`, `Timestamps/`, `Finance/`, `Resources/` at root, you're in a CONSUMER vault, NOT the workshop. STOP.

## Where to read for context

| If you're … | Read |
|---|---|
| Starting any session | `Docs/Index.md` first |
| Onboarding a new consumer | `Docs/use.md` (section "Onboarding a new consumer vault") + `Docs/landmines.md` |
| Adding a new mechanism or blueprint | `Docs/how.md` + `Docs/landmines.md` + `Docs/plans/2026-05-02-vault-platform-design.md` |
| Working on v0.2.0 boards blueprint | `Docs/plans/2026-05-03-boards-blueprint-design.md` (full design + module-directory invariant rationale) |
| Debugging a failed install | `Docs/landmines.md` first, then `Docs/how.md` (installer section) |
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
- **Module-directory invariant under `beacon/` namespace (decided 2026-05-03, refined 2026-05-04; codifies in v0.2.0).** Every blueprint owns ONE directory at `beacon/<module_directory>/` in the consumer vault. All files the blueprint materializes — at install time OR at runtime via templates / commands / nav-button actions — live under that one directory. Cross-module data flows via wikilinks only. No module writes into another module's directory. Each blueprint's manifest declares `module_directory: "<name>"` (NEW required field, enforced by installer in v0.2.0). Examples: `beacon/boards/` for the boards blueprint (v0.2.0 target), `beacon/to-do/` for a future to-do blueprint, `beacon/trips/` / `beacon/finance/` / `beacon/projects/` for future blueprints. The `beacon/` parent namespace cleanly demarcates platform-managed content from consumer personal content; consumers can have any other top-level structure they want without collision risk. Mechanisms are exempt — they're shared infrastructure, not modules; mechanisms continue to install under `Docs/Meta/...` per existing conventions. See `Docs/landmines.md` #11 + `Docs/plans/2026-05-03-boards-blueprint-design.md`.

## Git workflow

Beacon is a real published repo at `git@github-personal:willfell/beacon.git`. Commits and pushes to `main` are part of the active development flow — Claude commits at agreed checkpoints (typically per-stage close, occasionally per-task during implementer dispatches) and pushes to `origin/main` after each commit. **Single-branch workflow for now** — direct push to `main`, no feature branches, no pull-request review.

- **Commit at every stage close.** Bundle stage work into a single commit with a conventional-commits style message (e.g., `feat(installer,validator): v0.1.x patch S1 — ...`). Use HEREDOC for multiline messages.
- **Push to `origin/main` after each commit.** No staging, no PR. `git push origin main` is the canonical publish step.
- **Don't sign as Claude.** No `Co-authored-by: Claude` trailer; no AI-attribution. Author is the user.
- **Don't skip hooks** (`--no-verify`) unless the user explicitly requests it. If a pre-commit hook fails, fix the underlying issue and create a NEW commit.
- **Force-pushing + history rewrite** still require explicit approval (see "Ask before acting" below).
- **PR-based workflow returns** when collaborators or CI gates land. For now (single-developer single-machine), direct push is the workflow.

## Ask before acting

Stop and ask the user before any of:

- Modifying anything inside `.obsidian/` of any vault (plugin configs, workspace, hotkeys).
- Creating a new top-level directory in any vault (in consumers, prefer `beacon/<module>/` for platform-managed content).
- Bumping `workshop_version` in `platform/manifest.json` (it's the global release marker).
- Editing or removing files inside `platform/mechanisms/*/` after a version has been promoted to a consumer.
- Editing a consumer's `platform-installed.json` by hand (it's auto-managed by the installer).
- **Force-pushing or rewriting history** on `origin/main` of the `beacon` remote (`git push --force`, `git reset --hard origin/...`, `git rebase -i` on already-pushed commits, etc.).

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

## Status snapshot (2026-05-04)

- **GitHub remote configured (2026-05-04):** `git@github-personal:willfell/beacon.git`. Workshop is now a real published repo. v0.1.2's "Phase 4 — push to remote" is no longer deferred; v0.1.2 designs around an actual remote rather than local-only git.
- **Module-directory invariant refined (2026-05-04):** namespace under `beacon/` (e.g., `beacon/boards/`, `beacon/projects/`) rather than top-level. CLAUDE.md non-negotiable + landmine #11 + how.md updated.
- **v0.1.0 closed** — workshop self-installs (4 mechanisms + 1 blueprint).
- **v0.1.1 CLOSED 2026-05-04** — registry-driven nav-buttons + project blueprint v0.2.0. All deliverables green; result writeup at `Docs/plans/2026-05-03-registry-driven-nav-buttons-result.md`.
  - S1 ✅ installer extensions; S2 ✅ nav-buttons v2.0.0 thin renderer; S3 ✅ project blueprint v0.2.0; S4 ✅ harness-coverable smokes + T4.6 manual smoke.
  - **T4.7 DEFERRED** — surfaced four real pre-existing v0.1.0-era bugs: (1) no slash-command UX for `/new-project` or `/audit`, (2) no runner-template UX for validator / audit-walker, (3) `validate.js` `tp.file` resolution broken for current Templater, (4) `validate.js:checkRequiredBlocks` schema mismatch with project rule. v0.1.1 didn't introduce any of these; logged as priorities for the next cycle.
- **v0.1.1 surprise (the v0.2.0 trigger)** — the project blueprint's "Board" button is the **wrong primitive** (Dataview-list view; user expected real Obsidian-Kanban-plugin board with dated card notes, mirroring accuris). Decision: close v0.1.1 honestly, fix in v0.2.0.
- **v0.2.0 designed (2026-05-03), approved** — `boards` blueprint replaces project blueprint's Board contribution. Codifies the module-directory invariant. Design at `Docs/plans/2026-05-03-boards-blueprint-design.md`. Project blueprint bumps to v0.3.0 (drops Board contribution) in the same cycle.
- **v0.1.2 designed, deferred** — git-based pull, thin stub bootstrap (`Docs/plans/2026-05-03-multi-vault-automation-design.md`).
- **v0.1.x patch proposed (NEW)** — fix the four T4.7 findings. Cycle scope decision pending in next session — could ship before v0.1.2 (recommended; validator hook fires on every template execution → user-facing risk), as part of v0.1.2 stage 0, or as v0.2.0 stage 0.
- **Cycle order under discussion:** close v0.1.1 (now) → v0.1.x patch OR v0.1.2 OR v0.2.0 (next-session decision) → other two in some order.
- **Workshop version:** `0.4.0` (held since S1).
- **Mechanisms:** `customjs-guard@1.0.0`, `validator@0.1.0` (with bugs #3 + #4), `audit@0.1.0` (with bug #2), `nav-buttons@2.0.0`.
- **Blueprints:** `project@0.2.0` (workshop subscription DROPPED project — barebones-only dogfood). v0.2.0 will bump to `project@0.3.0` (Board retired) + add `boards@0.1.0`.
- **Two load-bearing harnesses:** `platform/test/run-install.js` + `platform/test/run-renderer.js`. Use these — don't fall back to manual Obsidian-in-the-loop unless a smoke can't be covered.
- **Landmines list:** 11 entries (#11 — module-directory invariant — codified in landmines.md, CLAUDE.md non-negotiables, and `Docs/how.md` "Module directory" concept section).
