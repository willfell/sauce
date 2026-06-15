---
name: cowork:reconcile-cowork
description: Nightly cowork reconciler. Walks atomic notes + sidecars via Obsidian MCP; parses rating callouts; updates learned_weights frontmatter; runs check-heartbeat; backfills missing sidecars. Reads data/orchestrator-instructions/reconcile-cowork.md for the canonical step-list (v0.97.0 single-source architecture; v0.97.1 cadence migration).
schedule: Cron-driven nightly 03:00 local per enabled engagement (paste-blocks emitted by cowork:sync-scheduled-jobs).
scope: shared
tags: [cowork, orchestrator, reconciler, shim]
---

# cowork:reconcile-cowork

> [!info]+ v0.97.1 cadence shim
> Migrated from local launchd (v0.97.0 Rail R) to claude.ai scheduled job (v0.97.1). The canonical step-list lives at `<vault>/.claude/skills/cowork/data/orchestrator-instructions/reconcile-cowork.md`. Shim for LOCAL Claude Code CLI invocation only.

## Inputs

`{ engagement_id: string }`

## Steps

1. Read `<vault>/.claude/skills/cowork/data/orchestrator-instructions/reconcile-cowork.md` IN FULL via Read tool.
2. Follow every step. Substitute `{{$engagement_id}}` with input. Resolve `{{$today_*}}` + `{{$yesterday_*}}` from current date in engagement's timezone.
