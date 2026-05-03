# CLAUDE.md — Workshop POC

This is the **workshop vault** — the canonical home for vault-platform mechanisms and blueprints. It contains NO personal content.

## Vault identity check

Before any write, run `ls /Users/willfell/Documents/obsidian/sync/workshop/poc-vault` (or `/Users/willfellhoelter/notes/workshop/poc-vault` on the other machine). Expected top-level: `CLAUDE.md`, `platform/`, `commands/`, `Docs/`. If you see `Boards/`, `Timestamps/`, `Finance/`, `Resources/`, you are in a CONSUMER vault, NOT the workshop. STOP.

## Purpose

- Author + iterate mechanisms (cross-cutting code: customjs-guard, validator, audit, installer).
- Author + iterate blueprints (note-type bundles: project, daily, invoice, todo-card).
- Tag versions in `platform/manifest.yml`.
- Consumer vaults pull from here via `tp.user.platformInstall()` on demand.

## Non-negotiables

- No personal content. If you find yourself writing a daily note here, you're in the wrong vault.
- All mechanisms are versioned in `platform/manifest.yml`. Bump the version on any change.
- All file paths in mechanism code use `{{template_variables}}`, not hardcoded paths. The installer substitutes per-vault.
- The five customjs-guard landmines from `accuris/Docs/plans/2026-05-02-customjs-guard-rollout.md` apply to every Dataview view written in this workshop.

## Directory map

- `platform/manifest.yml` — version catalogue.
- `platform/install.js` — the installer (Templater user-script).
- `platform/mechanisms/<name>/` — cross-cutting code.
- `platform/blueprints/<name>/` — note-type bundles.
- `platform/rule-schemas/` — JSON Schema for rule files.
- `commands/` — master copy of slash commands.
- `Docs/plans/` — design + implementation docs.

## Reference

- Design: see `accuris/Docs/plans/2026-05-02-vault-platform-design.md`.
- Implementation plan: see `accuris/Docs/plans/2026-05-02-vault-platform-implementation.md`.
