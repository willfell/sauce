# CLAUDE.md — Workshop POC

This is the **workshop vault** — the canonical home for the vault platform. It ships mechanisms (cross-cutting code) and blueprints (note-type bundles) that consumer vaults (accuris, headspace, ero) subscribe to. **No personal content lives here.**

## Vault identity check

Before any write, run `ls /Users/willfell/Documents/obsidian/sync/workshop/poc-vault` (or the equivalent path on your machine). Expected top-level: `CLAUDE.md`, `platform/`, `commands/`, `Docs/`, `.obsidian/`. If you see `Boards/`, `Timestamps/`, `Finance/`, `Resources/` at root, you're in a CONSUMER vault, NOT the workshop. STOP.

## Where to read for context

| If you're … | Read |
|---|---|
| Starting any session | `Docs/Index.md` first |
| Onboarding a new consumer | `Docs/use.md` (section "Onboarding a new consumer vault") + `Docs/landmines.md` |
| Adding a new mechanism or blueprint | `Docs/how.md` + `Docs/landmines.md` + `Docs/plans/2026-05-02-vault-platform-design.md` |
| Debugging a failed install | `Docs/landmines.md` first, then `Docs/how.md` (installer section) |
| Catching up on history | `Docs/plans/` in chronological order |
| Running a one-shot agent task | `Docs/prompts/` — each is copy-paste-ready for a fresh session |

## Non-negotiables

These are the **platform** non-negotiables. The five customjs-guard landmines + three platform landmines in `Docs/landmines.md` are derived rules; they apply to all platform code.

- **No personal content.** If you find yourself writing a daily note here, you're in the wrong vault.
- **All mechanisms are versioned in `platform/manifest.json`.** Bump the version on any change to a mechanism's source files.
- **All file paths in mechanism code use `{{template_variables}}`**, never hardcoded paths. The installer substitutes per-vault from each consumer's `platform-config.json`.
- **All platform metadata is JSON, not YAML.** Reason: Templater user scripts can't reach Obsidian's `parseYaml`. Files affected: `platform/manifest.json`, every `mechanisms/*/manifest.json`, every consumer's `platform-config.json` / `platform-subscription.json` / `platform-installed.json`, every `rules/*.json`.
- **The five customjs-guard landmines apply to every Dataview view** written in this workshop. See `Docs/landmines.md`.
- **The workshop dogfoods every release.** Before promoting a new mechanism version to consumers, the workshop's own self-install must succeed. If workshop self-test fails, do not push the update.

## Ask before acting

Stop and ask the user before any of:

- Modifying anything inside `.obsidian/` of any vault (plugin configs, workspace, hotkeys).
- Creating a new top-level directory in any vault.
- Bumping `workshop_version` in `platform/manifest.json` (it's the global release marker).
- Editing or removing files inside `platform/mechanisms/*/` after a version has been promoted to a consumer.
- Editing a consumer's `platform-installed.json` by hand (it's auto-managed by the installer).

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

## Status snapshot (2026-05-02)

- Phases 0-6 of the implementation plan are complete (workshop self-installs successfully).
- Phase 7 (first external consumer) is in progress — see `Docs/prompts/2026-05-02-onboard-tmp-acc-vault.md`.
- Three mechanisms shipped at v1.0.0 / v0.1.0 / v0.1.0.
- Zero blueprints shipped — the first blueprint is the next major workstream.
