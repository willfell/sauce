---
description: Audit the sauce platform installation for claude_surface drift
allowed-tools: Bash, Read
---

<!-- @claude-surface:version 0.2.0 -->

# /audit

Walks `ranch/claude-surface-registry.json` against the filesystem and surfaces drift in the deployed `.claude/commands/`, `.claude/skills/`, and CLAUDE.md resolver pointers. Four severity levels:

- **dead_path** — registry says it should exist; it does not.
- **orphan** — disk has it; registry never mentioned it.
- **stale_but_valid** — body's `@claude-surface:version` comment disagrees with the registry version.
- **consumer_edit_at_risk** — deployed body differs from the workshop source and no `.local/` shadow protects it.

`sauce audit --engine` is the engine install pass: `engine_dir_missing` / `engine_surface_missing` (HIGH), `engine_surface_stale` / `engine_version_drift` / `engine_ledger_unparsable` (MEDIUM), `engine_worktree_orphan` (LOW). Run it after `sauce update` to prove `/sauce` and `sauce run` are wired.

Detection-only. Nothing on disk is rewritten. The skill at `.claude/skills/audit/drift/SKILL.md` shells out to `sauce audit --claude-surface --vault "$(pwd)"` and renders the findings as severity-grouped callouts.
