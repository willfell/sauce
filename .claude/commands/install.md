---
description: Re-run sauce installer against current subscription
allowed-tools: Bash, Read
---

<!-- @claude-surface:version 0.1.0 -->

# /install

Re-runs `sauce update` for the current vault against `ranch/platform-subscription.json`. Use this after:
- Pulling a workshop update (`cd ~/sauce && git pull`)
- Editing `ranch/platform-subscription.json` (subscription drift)
- Manually placing files under `.claude/commands.local/` or `.claude/skills.local/` (re-apply shadow shim)

The skill at `.claude/skills/platform/install/SKILL.md` shells out to `sauce update --vault $(pwd)` and renders the install ledger delta.

## Auto-bumping subscription pins (v0.75.0+)

After `brew upgrade sauce` picks up a new workshop release, run `sauce update --bump-pins` from inside each consumer vault to auto-update `ranch/platform-subscription.json`'s top-level `workshop_version` field and per-blueprint / per-mechanism pinned versions to match the brew-installed workshop. Preserves opt-in subscriptions (new-in-workshop items are NOT auto-subscribed).

```
sauce update --bump-pins              # default: canonical version
sauce update --bump-pins --dry-run    # show diff without writing
sauce update --bump-pins --keep-comparators  # preserve ^X.Y.Z form
```

Replaces the previous manual `vim ranch/platform-subscription.json` step in the deploy procedure (was felt across 4 vaults during v0.74.0 deploy).
