---
purpose: Full list of actions that require user confirmation before proceeding. Derived from landmines + cycle history; canonical.
load_when: About to do anything destructive, hard-to-reverse, cross-vault, or that creates new top-level state.
---

# Ask before acting

Stop and ask the user before any of these. The router's "What not to do" section lists only the headline; this guide carries the full list with rationale.

## `.obsidian/` writes

- **Modifying anything inside `.obsidian/` of any vault** EXCEPT for the **18 installer-managed paths** allowlisted in landmine #12. The current allowlist includes (non-exhaustive):
  - `.obsidian/plugins/templater-obsidian/data.json`
  - `.obsidian/plugins/slash-commander/data.json`
  - `.obsidian/daily-notes.json`
  - `.obsidian/plugins/customjs/data.json`
  - `.obsidian/plugins/dataview/data.json`
  - `.obsidian/hotkeys.json`
  - `.obsidian/app.json` (a subset of keys; e.g. `propertiesInDocument`)
  - Vendored-plugin data.json files for plugins shipped with the platform
  - Sauce-namespaced snippet files
- Edits to allowlisted paths MUST follow landmine #12's safety mechanics: **additive-merge-only**, **backup-on-edit**, **malformed-JSON guard**, **failure-loud history**.
- Full canonical allowlist + safety-mechanic spec in `Docs/landmines.md` #12.

## Distribution stub

- **Modifying the body of `Docs/Meta/Templater/platformInstall.js` in any consumer.** The thin stub is content-static per landmine #13 (md5 `a39257da1dd49ae4481e5cd0a42bdac4`). A lockstep change across all consumers + distribution-model bump would be required.
- **Editing `platform/installer-stub.js`** in the workshop. Changes the canonical stub body; cascades to every consumer in the next deployment.

## Platform internals

- **Bumping `workshop_version` in `platform/manifest.json`.** It is the global release marker; bumping is reserved for cycle close after USER APPROVAL (per `Docs/prompts/SESSION-START.md` § Anti-patterns).
- **Editing or removing files inside `platform/mechanisms/*/`** after a version has been promoted to a consumer.
- **Editing a consumer's `platform-installed.json` by hand.** It is auto-managed by the installer.
- **Editing canonical `.claude/commands/<x>.md` or `.claude/skills/<bp>/**/SKILL.md`** in any consumer vault. These are **REVERTED on next install** per landmine #22. Use `.claude/commands.local/` or `.claude/skills.local/` as the override seam. `/audit` surfaces direct-canonical edits as `consumer_edit_at_risk`.

## CLAUDE.md marker regions

- **Editing CLAUDE.md content inside `<!-- @claude-surface:<table> BEGIN/END -->` marker pairs.** The renderer rewrites only marker-bounded regions (`resolvers` / `directory-map` / `skills-index`); outside-marker prose is hand-authored and preserved bit-for-bit. Inside-marker edits get clobbered on next install.

## Git

- **Force-pushing or rewriting history** on `origin/main` of the `sauce` remote: `git push --force`, `git reset --hard origin/...`, `git rebase -i` on already-pushed commits, etc.
- **Skipping hooks** (`--no-verify`, `--no-gpg-sign`, etc.) without explicit user request. If a pre-commit hook fails, fix the underlying issue and create a NEW commit.
- **Annotated git tags** at HEAD. Cycle-close tags `v<X.Y.Z>` require user approval before pushing.

## New top-level files / directories

The sanctioned set is:

**Top-level dirs:**
- `spice/<module>/` — blueprint content (landmine #11; renamed from `beacon/<module>/` in v0.25.0)
- `pantry/` — workshop clone for inside-vault layout (renamed from `Beacon/` in v0.23.0 for macOS APFS case-collision)
- `ranch/` — runtime plumbing (renamed from `Docs/Meta/` in v0.24.0)
- `.claude/skills/<blueprint>/` — native Claude Code skill bodies (materialized by `materializeSkills` since v0.30.0)

The `pantry/` + `ranch/` + `spice/` + `.claude/skills/` namespace tetrad is the canonical layout post-v0.30.0.

**Top-level files (added 2026-05-18 for public-readiness):**
- `README.md` · `LICENSE` · `SECURITY.md` · `CONTRIBUTING.md`

Companion design at `Docs/plans/2026-05-18-public-readiness-design.md`.

**Any other new top-level path requires user approval.** In consumers, prefer `spice/<module>/` for new platform-managed content.

## What does NOT require asking

For the avoidance of doubt, the following are routine and DO NOT need confirmation:

- Editing files inside `Docs/` (except `Docs/landmines.md` history blocks for in-flight cycles — those get bundled into cycle-close commits).
- Editing or creating files under `Docs/agent-guides/` (this directory).
- Editing or creating files under `Docs/plans/` (cycle artifacts).
- Reading any file anywhere.
- Running preflight harnesses (`npm run release:preflight`, individual `node platform/test/run-*.js`).
- Running `sauce audit` (read-only per landmine #21).
- Stage-level commits + pushes during a cycle (per the established workflow — see [build-test-verify.md](build-test-verify.md) § Release workflow).
- Editing outside-marker prose in any `CLAUDE.md`.

## Why the list exists

The cost of pausing to confirm is low. The cost of an unwanted destructive action is high: lost work, broken installer, force-pushed history, drifted consumer state. Authorization stands for the scope specified; "approved once" does NOT mean "approved generally." When in doubt, ask.
