---
purpose: High-level architecture of the Sauce platform — what mechanisms vs blueprints are, how the installer works, how content reaches consumer vaults.
load_when: Touching mechanisms, blueprints, the installer, the distribution model, or `claude_surface[]`.
---

# Sauce architecture

> Authoritative sources: `Docs/why.md` (purpose and end goal), `Docs/how.md` (concepts and installer mechanics), `Docs/plans/2026-05-02-vault-platform-design.md` (foundational design doc). This guide summarizes for fast orientation; read the source docs for depth.

## What is Sauce

Sauce is a **workshop vault** that ships a platform installed into **consumer vaults** (currently `barebones`, `accuris-sauce`, `ero-sauce`, `headspace-sauce`). The workshop is also its own first consumer — it self-installs as a regression target ("dogfood"). No personal content lives in the workshop.

Distribution: Homebrew tap `willfell/homebrew-sauce` + an `sh` CLI installed via `brew install sauce`. The `sauce` CLI exposes `install`, `audit`, `migrate`, `upgrade`, `bootstrap` against a target vault directory. See `Docs/use.md` § Onboarding for the full lifecycle.

## Two building blocks

| Kind | Role | Lives at | Example |
| --- | --- | --- | --- |
| **Mechanism** | Cross-cutting code, no `module_directory`. Shared infrastructure consumed by ≥1 blueprint. | `platform/mechanisms/<name>/` | `customjs-guard`, `nav-buttons`, `icons`, `entity-create` |
| **Blueprint** | Note-type bundle. Owns one `module_directory` under `spice/<dir>/` in the consumer. | `platform/blueprints/<name>/` | `daily`, `meetings`, `project`, `to-do`, `cowork` |

Every blueprint MUST declare `module_directory` in its manifest. All files it materializes (install-time or runtime via templates/commands/nav-button actions) live under `spice/<module_directory>/`. Cross-module data flows via wikilinks ONLY — no module writes into another module's directory. Mechanisms are exempt (they install under `ranch/...`).

Both kinds are catalogued in `platform/manifest.json`'s `workshop_version` + `mechanisms[]` + `blueprints[]`. Each individual `manifest.json` declares its own version. Bumping a mechanism / blueprint version requires bumping the catalogue entry to match (the `check-version-sync.js` gate enforces this; see [build-test-verify.md](build-test-verify.md)).

## Installer

`platform/install.js` is the single installer. Each consumer's `Docs/Meta/Templater/platformInstall.js` is a **content-static thin stub** (~12 LOC; canonical at `platform/installer-stub.js`; md5 fixed by landmine #13) that `require()`s the workshop's canonical `install.js` at runtime. Updates reach consumers via `git pull` of the workshop + a fresh install run; the stub never changes.

Installer behavior:
- Reads each consumer's `platform-config.json` (path map; sets `{{templates_path}}`, `{{scripts_path}}`, `{{module_directory}}`, etc.).
- Substitutes `{{template_variables}}` lenient-style into every `files[]` source.
- Writes outputs into the consumer's `spice/<module>/` or `ranch/<sub>/`.
- Records each operation in `platform-installed.json` (auto-managed; never hand-edit).
- Applies allowlisted `.obsidian/` edits via helpers (`applyTemplaterHotkeys`, `applySlashCommanderBindings`, `applyCustomJsStartupScripts`, etc.). The allowlist is **18 paths + CLAUDE.md marker regions** per landmine #12.

## Namespace tetrad in consumer vaults

| Top-level dir | Owner | Lifecycle |
| --- | --- | --- |
| `spice/<module>/` | Blueprints | Installed + runtime content. The module-directory invariant lives here. |
| `pantry/` | Workshop clone (inside-vault layout) | Git-managed snapshot, never hand-edit (landmine #18). |
| `ranch/` | Runtime plumbing | Config, scripts, templates, views. Materialized by the installer. |
| `.claude/skills/<bp>/` | Native Claude Code skills | Materialized by `materializeSkills` per blueprint. |

Outside this tetrad, only `README.md` / `LICENSE` / `SECURITY.md` / `CONTRIBUTING.md` are sanctioned at top level. Any other new top-level path requires approval — see [asking-before-acting.md](asking-before-acting.md).

## `claude_surface[]` mechanism

`mechanisms/platform-claude` renders managed regions of consumer `CLAUDE.md` files between marker pairs:

```
<!-- @claude-surface:directory-map BEGIN -->
... rewritten on each install ...
<!-- @claude-surface:directory-map END -->
```

Three markered surfaces exist in the workshop's `CLAUDE.md`: `resolvers`, `directory-map`, `skills-index`. Outside-marker prose is hand-authored and preserved bit-for-bit; only marker-bounded regions are rewritten. Editing inside a marker block without going through the mechanism = your work gets clobbered on next install. See landmine #12.

The platform-claude mechanism also materializes `/install`, `/upgrade`, `/bootstrap`, `/audit` slash commands into each consumer's `.claude/commands/`.

### Orchestrator vs sub-skill dest convention

When a cowork (or any blueprint) `claude_surface[]` entry declares a skill, the dest path depends on whether the skill is an **orchestrator** (top-level workflow with a `/<command>` slash command) or a **sub-skill** (helper invoked from an orchestrator's Steps section):

- **Orchestrators** flatten to `{{skills_dir}}/<name>/SKILL.md`. Example: `morning-briefing/SKILL.md`, `edit-microscope/SKILL.md`.
- **Sub-skills** nest under `{{skills_dir}}/skills/<name>/SKILL.md`. Example: `skills/gather-from-served-by/SKILL.md`, `skills/check-vault-routing/SKILL.md`.

This convention is enforced by the cowork manifest's `claude_surface[]` entries; new skill additions should mirror the existing pattern (re-read a similar entry before writing a new one). Surfaced as FLN-v79-4 during the v0.79.0 cycle when the plan template's default dest used the nested form for an orchestrator.

## Read these next

- New mechanism or blueprint? → `Docs/how.md` § Adding a contribution + `Docs/landmines.md`.
- Operational lifecycle? → `Docs/use.md`.
- Past cycle decisions? → `Docs/cycle-history.md` + chronological `Docs/plans/`.
- Failed install? → `Docs/landmines.md` first, then `Docs/how.md` § Installer mechanics.
