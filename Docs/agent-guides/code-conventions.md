---
purpose: Platform-level coding rules for the Sauce workshop. The five non-negotiables, customjs-guard, JSON-not-YAML, template-variables, module-directory invariant.
load_when: Writing or editing any mechanism / blueprint / installer code.
---

# Code conventions

> Authoritative source: `Docs/landmines.md` (22 entries; canonical traps and their rationale). This guide summarizes the rules; `Docs/landmines.md` carries the precedents.

## The five platform non-negotiables

1. **No personal content in the workshop.** Daily notes / personal data live in consumer vaults only.
2. **All mechanisms and blueprints are versioned in `platform/manifest.json`.** Bump on any change to source files. The `check-version-sync.js` gate enforces lockstep between `manifest.json`, `package.json`, and consumer `platform-subscription.json` pins.
3. **All file paths in mechanism / blueprint code use `{{template_variables}}`** — never hardcoded paths. The installer substitutes per-vault from each consumer's `platform-config.json`. Common variables: `{{module_directory}}`, `{{templates_path}}`, `{{scripts_path}}`, `{{views_path}}`.
4. **All platform metadata is JSON, not YAML.** Templater user scripts cannot reach Obsidian's `parseYaml`. Files affected: `platform/manifest.json`, every `mechanisms/*/manifest.json`, every `blueprints/*/manifest.json`, every consumer's `platform-config.json` / `platform-subscription.json` / `platform-installed.json`, every `rules/*.json`. Frontmatter on rendered notes can still be YAML — only platform metadata is locked to JSON.
5. **The five customjs-guard landmines apply to every Dataview view written in this workshop.** See `Docs/landmines.md` #1–#5. Cold-load TDZ ordering is the most common failure mode.
6. **Workshop dogfoods every release.** Workshop self-install must succeed before any consumer push. See [build-test-verify.md](build-test-verify.md).

## Module-directory invariant (BLUEPRINTS ONLY)

Every blueprint owns ONE directory at `spice/<module_directory>/` in the consumer vault. **All files** the blueprint materializes — at install time OR runtime via templates / commands / nav-button actions — live under that one directory. Cross-module data flows via wikilinks only; no module writes into another module's directory.

Each blueprint's manifest declares `module_directory: "<name>"` (required since v0.2.0). Enforced by the installer.

Examples: `spice/boards/`, `spice/to-do/`, `spice/trips/`, `spice/finance/`, `spice/projects/`, `spice/daily/`, `spice/journal/`, `spice/meetings/`.

Mechanisms are exempt — they install under `ranch/...`. See landmine #11 + `Docs/plans/2026-05-03-boards-blueprint-design.md`. The single source-of-truth prefix lives at `install.js:250`.

## CustomJS gotchas

- **`customJS.X` is a singleton instance, not a class constructor.** The customjs plugin auto-instantiates each registered class. Calling `new customJS.X()` fails with `customJS.X is not a constructor`. Use `customJS.X.method()` directly. (Caused FLN-todo-13 in v0.63.0.)
- **Startup-script registration vector matters.** Templater `startup_templates[]` may not fire reliably at consumer boot; customjs `startupScriptNames[]` (`customjs_startup_scripts[]` in manifest) is the L2 fix. v0.48.0 → v0.49.0 cycle history documents the swap.
- **Dataview returns `DataArray`, not `Array`.** Use `.where()` / `.array()` rather than assuming Array methods like `.filter()`. Codebase precedent: `getTasks()` + `cowork-readiness.js`. Bit us in v0.67.x (FLN-v67-2).

## Skill / command override seam

Direct edits to canonical `.claude/commands/<x>.md` or `.claude/skills/<bp>/**/SKILL.md` in any consumer vault are **REVERTED on next install** per landmine #22. Use `.claude/commands.local/` or `.claude/skills.local/` as the override seam instead. `/audit` surfaces direct-canonical edits as `consumer_edit_at_risk` before work is lost.

## CLAUDE.md marker-bounded regions

The `claude_surface` renderer (in `mechanisms/platform-claude`) rewrites ONLY content between `<!-- @claude-surface:<table> BEGIN/END -->` marker pairs in `CLAUDE.md` (currently three pairs: `resolvers`, `directory-map`, `skills-index`). Outside-marker prose is hand-authored and preserved bit-for-bit.

Touching content inside a marker block without going through the mechanism = your edit gets clobbered on next install. See landmine #12.

## File-path safety

- Never hand-edit consumer `platform-installed.json` (auto-managed; landmine guidance).
- Never hand-edit `pantry/` content in any vault (git-managed snapshot of workshop; landmine #18).
- `.obsidian/` writes are scoped to 18 allowlisted paths (full list in `Docs/landmines.md` #12) — Templater / Slash-Commander / Daily-Notes / Customjs / Dataview / Hotkeys data.json + sauce-namespaced snippets + claude_surface markers. Edits MUST follow landmine #12's safety mechanics: additive-merge-only, backup-on-edit, malformed-JSON guard, failure-loud history.
- Anything outside the allowlist requires user approval before edit. See [asking-before-acting.md](asking-before-acting.md).

## Naming + style

- Conventional-commits format for commit messages (`feat(scope): summary`, `fix(scope):`, `chore(scope):`, etc.).
- Single underscore (`_privateField`), not double, on private class members. The platform uses `_cache` not `__cache` (FLN-b from v0.47.0; renamed in v0.48.0).
- Manifest field ordering: align with existing manifests (project, scratch, to-do) for readability. Drift surfaces as FLN-todo-2 + similar.

## When to read deeper

- All 22 landmines with rationale + history blocks → `Docs/landmines.md`.
- Architecture and installer mechanics → [architecture.md](architecture.md) + `Docs/how.md`.
- Past cycle decisions and platform values → `Docs/cycle-history.md`.
