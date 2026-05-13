---
description: Interactively upgrade a blueprint or mechanism to a new version
allowed-tools: Bash, Read, Edit
---

<!-- @claude-surface:version 0.1.0 -->

# /upgrade

Interactive upgrade flow:
1. Read `ranch/platform-subscription.json` + the workshop catalogue.
2. Surface blueprints/mechanisms with available updates (subscription version < catalogue version).
3. Prompt for which to upgrade and to what target version.
4. Update `ranch/platform-subscription.json`.
5. Invoke `sauce update` (via the `/install` skill) to apply.

The skill at `.claude/skills/platform/upgrade/SKILL.md` orchestrates the interaction.
