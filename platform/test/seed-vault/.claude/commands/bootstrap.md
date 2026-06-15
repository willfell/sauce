---
description: Re-bootstrap the vault (change subscriptions, re-scaffold plugins)
allowed-tools: Bash, Read, Edit
---

<!-- @claude-surface:version 0.1.0 -->

# /bootstrap

**Re-bootstrap an existing vault** — change which blueprints are subscribed, re-scaffold plugins, or re-run the first-run wizard against a different vault layout. This is NOT the first-touch incantation for a brand-new vault.

True first-touch is always the raw `sauce bootstrap` CLI from a terminal in the new vault directory — slash commands don't exist until bootstrap has run at least once. If you find yourself wanting `/bootstrap` on a vault that has never had a sauce install, you are looking for the CLI.

The skill at `.claude/skills/platform/bootstrap/SKILL.md` shells out to `sauce bootstrap --vault $(pwd)`. When run inside an already-bootstrapped vault, the CLI auto-detects the existing `ranch/platform-config.json` and surfaces its re-run wizard menu (edit subscription, edit config, force-redownload, quit) — no extra flag required.
