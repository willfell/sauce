---
description: Re-run sauce installer against current subscription
allowed-tools: Bash, Read
---

<!-- @claude-surface:version 0.1.0 -->

# /install

Re-runs `sauce install` for the current vault against `ranch/platform-subscription.json`. Use this after:
- Pulling a workshop update (`cd ~/sauce && git pull`)
- Editing `ranch/platform-subscription.json` (subscription drift)
- Manually placing files under `.claude/commands.local/` or `.claude/skills.local/` (re-apply shadow shim)

The skill at `.claude/skills/platform/install/SKILL.md` shells out to `sauce install --vault $(pwd)` and renders the install ledger delta.
