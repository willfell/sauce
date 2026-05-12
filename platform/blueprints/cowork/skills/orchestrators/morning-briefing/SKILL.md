---
name: cowork:morning-briefing
description: Engagement-aware morning briefing. Composes the morning callout block (briefing + finance + email + messages + open threads) for one engagement and patches it into today's daily note. Phrasings = "morning briefing for <engagement>", "give me today's morning for <engagement>", "<engagement> morning briefing".
schedule: Cron-driven per enabled (engagement, morning) pair (paste-blocks emitted by cowork:bootstrap-vault step 22)
scope: shared
tags: [cowork, orchestrator, morning, engagement-aware]
---

# cowork:morning-briefing

Composes a morning callout block for one engagement (Morning Briefing + optional Finance + optional Email + optional Messages) and an Open Threads tail, then patches them into today's daily note. The first four callouts go above the `<!-- COWORK_CALLOUTS -->` marker; Open Threads goes at the bottom after `## Notes`. Aborts cleanly on MCP unavailability — never partially writes. Re-runs are idempotent: the morning H2 block for this `(cadence, engagement_id)` pair is replaced if it already exists for today.

## Inputs

```
{
  engagement_id: string   // required — id of the engagement to brief; must match an entry in vault-config.md engagements[]
}
```

## Pre-flight

1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian"] }`. If the return is not `"ready"`, emit Notice `cowork:morning-briefing aborted -- <status>` and exit. Do not write.
2. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md` via `mcp__obsidian__get_frontmatter`. Look up `engagements[]` entry where `id == engagement_id`. If not found, emit Notice `cowork:morning-briefing aborted -- engagement '<id>' not found in vault-config.md` and exit. Capture `engagement` (the full record) and load the matching engagement-type manifest from the registry; capture `type_manifest.render_aspects`. The render-aspects map drives which gather + write steps fire (e.g. `finance_block: include` enables the Finance callout; `inner_circle_imessage: include` enables Messages).
3. Use Skill `cowork:date-context` with `{}`. Capture the returned `context` object. If `context.error` exists, emit Notice and exit.
4. Use Skill `cowork:ensure-daily-note` with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

Each gather call passes `engagement_id`. The sub-skill reads per-engagement MCP-scoped fields (gmail_label / calendar_id) from vault-config.md and may type-gate (e.g. `gather-imessage` early-exits for non-personal engagements). Renderable steps skip silently when their `render_aspects` flag is `skip`.

5. Use Skill `cowork:gather-weather` with `{ engagement_id, city: engagement.home_city, days_ahead: 3 }` (personal only — skipped when `render_aspects.weather` is not present in engagement type).
6. Use Skill `cowork:gather-calendar` with `{ engagement_id, date_today: context.today, horizon: "today+next-2-days", timezone: "America/Denver" }`.
7. Use Skill `cowork:gather-gmail` with `{ engagement_id, window: "newer_than:1d" }`.
8. Use Skill `cowork:gather-imessage` with `{ engagement_id, window_days: 3, scope: "inner-circle-and-groups" }` (gated: early-exit if engagement.type != "personal").
9. If `render_aspects.finance_block == "include"`: use Skill `cowork:gather-finance-yesterday` with `{ engagement_id, date_yesterday: context.yesterday, mode: "daily" }`.
10. If `render_aspects.finance_block == "include"`: use Skill `cowork:gather-cc-debt-snapshot` with `{ engagement_id, date_today: context.today, mode: "daily" }`.
11. Use Skill `cowork:gather-projects` with `{ engagement_id, filter: "active", today: context.today, carry_over_from: context.yesterday_daily_path }`.
12. Use Skill `cowork:gather-threads` with `{ engagement_id, date_today: context.today, mode: "morning-surface" }`.

## Write

13. If `render_aspects.finance_block == "include"`: use Skill `cowork:write-callout-finance` with `{ engagement, date: context.today, finance_yesterday: <step 9.markdown>, cc_debt_snapshot: <step 10.markdown> }`. Capture `finance_block`. Else `finance_block = ""`.
14. Use Skill `cowork:write-callout-morning-briefing` with `{ engagement, render_aspects: type_manifest.render_aspects, date: context.today, weekday: context.dddd, weather: <step 5.markdown or "">, calendar: <step 6.markdown>, gmail: <step 7.markdown>, imessage: <step 8.markdown or "">, threads_digest: <step 12.markdown>, finance_block, tasks: <step 11 rendered as markdown>, people: <step 11.people_nudges rendered as markdown> }`. Capture `briefing_markdown`. The sub-skill internally branches on `engagement.type` to pick the per-type callout shape.
15. Compose the Open Threads tail callout from step 12; if no open threads, `tail_blocks = []`.
16. Use Skill `cowork:patch-daily-callouts` with `{ engagement_id, daily_path: context.daily_path, callouts: [{ id: "morning-briefing", body: <briefing_markdown> }], tail_blocks: <tail_blocks> }`. The sub-skill writes the morning H2 block under `## Morning — <engagement.label>` within the `<!-- COWORK_CALLOUTS -->` block; idempotent replace by `(cadence, engagement_id)`.

## State

17. Use Skill `cowork:update-active-threads` with `{ engagement_id, phase: "morning-pass", date_today: context.today, writer: "cowork:morning-briefing", changes: { new_threads: <step 12.new_threads>, snoozed_to_open: <step 12.snoozed_to_open>, surface_open: true } }`.
18. Use Skill `cowork:update-weekly-snapshot` with `{ engagement_id, phase: "morning", date_today: context.today, writer: "cowork:morning-briefing", snapshot_data: { week_of: context.week_of, wtd_spend: <step 9.total_usd or null>, cc_total: <step 10.total_usd or null>, journaled_today: false } }`.

## Done

Emit Obsidian Notice `cowork:morning-briefing complete -- <engagement.label> <context.today>`.
