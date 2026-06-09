---
name: cowork:weekly-review
description: Engagement-aware weekly review. Reads data/orchestrator-instructions/weekly-review.md for the canonical step-list (v0.97.0 single-source architecture).
schedule: Cron-driven per enabled (engagement, weekly-review) pair (paste-blocks emitted by cowork:sync-scheduled-jobs).
scope: shared
tags: [cowork, orchestrator, weekly, engagement-aware, shim]
---

# cowork:weekly-review

> [!info]+ v0.97.0 shim
> This SKILL.md is a thin shim. The canonical orchestrator step-list lives at `<vault>/.claude/skills/cowork/data/orchestrator-instructions/weekly-review.md`. Cron invocations don't reach this file — claude.ai's Cowork UI runs the wrapper template directly (composed by `cowork:sync-scheduled-jobs`). This shim exists for LOCAL Claude Code CLI invocation only.

## Inputs

```
{
  engagement_id: string   // required
}
```

## Steps

1. Use the Read tool to read `<vault>/.claude/skills/cowork/data/orchestrator-instructions/weekly-review.md` IN FULL.
2. Follow every step in that file exactly. Substitute `{{$engagement_id}}` with the input value.
3. Other `{{$static_tokens}}` (voice_notes, priorities, mcp_dispatch_lines, etc.) are resolved by reading engagement + user-preferences context per the orchestrator-instructions file's Step 0.
4. `{{$today_*}}` tokens resolved by computing the current date in the engagement's timezone.
