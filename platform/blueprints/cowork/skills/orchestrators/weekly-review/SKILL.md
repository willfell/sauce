---
name: cowork:weekly-review
description: Engagement-aware weekly review. Writes one atomic note at spice/cowork/weekly/YYYY/YYYY-Www/weekly-review.md per scheduled invocation; frontmatter `type: cowork-weekly-review`. Body composed from week-summary gather outputs (finance, calendar, gmail, imessage, projects, threads, optional invoice-prep or fte-status) interpolated through the user's prompt body at spice/cowork/prompts/weekly-review.md. Phrasings = "weekly review for <engagement>", "<engagement> weekly", "weekly summary for <engagement>".
schedule: Cron-driven per enabled (engagement, weekly) pair (typically Sundays for personal; Fridays for w2-fte / consulting)
scope: shared
tags: [cowork, orchestrator, weekly, engagement-aware]
---

# cowork:weekly-review

End-of-week deep pass for one engagement. Writes ONE atomic note at `spice/cowork/weekly/YYYY/YYYY-Www/weekly-review.md` (deterministic path per `(orchestrator, week)`; overwrite-last-write-wins idempotency). Body shape follows the user's prompt body at `spice/cowork/prompts/weekly-review.md`; when the prompt body is empty, emits a no-op note with `warning: empty_prompt`. Refreshes `active-threads.md` + `weekly-snapshot.md` for this engagement's slice as a side effect.

This orchestrator NEVER patches the daily note's callouts, edits the daily-note template, writes "link callouts", or writes to legacy paths like `spice/cowork/summaries/`. The v0.65.0 atomic-note write contract is the only output surface.

## Inputs

```
{
  engagement_id: string
}
```

## Pre-flight

1. READ `.claude/skills/cowork/skills/check-vault-routing/SKILL.md` in full and follow
   its `## Steps` section with `{ required: ["obsidian"] }`. If not `"ready"`, emit Notice `cowork:weekly-review aborted -- <status>` and exit.
2. **Resolve engagement.** Read vault-config.md; look up engagement by id; load type manifest; capture `engagement` + `render_aspects`.
3. READ `.claude/skills/cowork/skills/date-context/SKILL.md` in full and follow
   its `## Steps` section with `{}`. Capture `context` (today, dddd, week_of, week_range, week_start, week_end, daily_path, iso_week_label).
4. READ `.claude/skills/cowork/skills/ensure-daily-note/SKILL.md` in full and follow
   its `## Steps` section with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

5. If `render_aspects.finance_block == "include"`: READ `.claude/skills/cowork/skills/gather-finance-yesterday/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_yesterday: context.today, mode: "full-week", week_range: { start: context.week_start, end: context.week_end } }`.
6. If `render_aspects.finance_block == "include"`: READ `.claude/skills/cowork/skills/gather-cc-debt-snapshot/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_today: context.today, mode: "weekly", append_to_tracker: true, week_range: { start: context.week_start, end: context.week_end } }`.
7. READ `.claude/skills/cowork/skills/gather-calendar/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_today: context.today, horizon: "next-week", range_start: context.next_week_start, range_end: context.next_week_end, timezone: "America/Denver" }`.
8. READ `.claude/skills/cowork/skills/gather-gmail/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, window: "newer_than:7d" }`.
9. READ `.claude/skills/cowork/skills/gather-imessage/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, window_days: 7, scope: "inner-circle" }` (gated: skipped when engagement.type != "personal").
10. READ `.claude/skills/cowork/skills/gather-projects/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, filter: "weekly", week_range: { start: context.week_start, end: context.week_end } }`.
11. READ `.claude/skills/cowork/skills/gather-threads/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, date_today: context.today, mode: "weekly-audit", week_range: { start: context.week_start, end: context.week_end } }`.
12. If `render_aspects.invoice_prep == "include"`: READ `.claude/skills/cowork/skills/write-summary-invoice-prep/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement, date_today: context.today, mode: "weekly" }` IF `engagement.invoice_cadence` indicates weekly invoicing. Capture `invoice_block` (markdown). Else `invoice_block = ""`.
13. If `render_aspects.invoice_prep == "skip"` AND `engagement.type == "w2-fte"`: READ `.claude/skills/cowork/skills/write-summary-fte-status/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement, date_today: context.today, mode: "weekly" }`. Capture `fte_status_block`. Else `fte_status_block = ""`.

## Write

14. **Read prompt body** via `mcp__obsidian__get_file_contents` at `spice/cowork/prompts/weekly-review.md`. Strip frontmatter; capture body as `prompt_body` (or empty when missing).
15. **Compose run-note body** per `prompt_body` instructions interpolating week-summary gather outputs. When `prompt_body` is empty, do NOT freelance content — compose a skeleton-compliant STUB body:
    - `SpaceNavButtons` dataviewjs block (verbatim).
    - `> [!info]- This week at a glance\n> (Prompt body empty — edit spice/cowork/prompts/weekly-review.md to customize what this run emits.)`
    - `> [!example]+ 📋 Status\n> No prompt body to drive content; this run is a placeholder.`
    - `> [!tip] ✏️ Next action\n> Edit \`spice/cowork/prompts/weekly-review.md\` to define what this scheduled job should emit when it fires.`
    Set `warning = "empty_prompt"` and pass `summary = "Stub run — weekly-review prompt body at spice/cowork/prompts/weekly-review.md is empty."` to write-run-note via its `summary` arg. The write-run-note self-check passes (5 markers + summary + title all present).
    When `prompt_body` is non-empty, set `warning = null` and compose the body per the prompt's instructions, respecting the adaptive body skeleton in write-run-note-weekly-review's `## Adaptive body skeleton` section.
16. READ `.claude/skills/cowork/skills/write-run-note-weekly-review/SKILL.md` in full —
    paying particular attention to its `## Title composition`, `## Adaptive body
    skeleton`, and `## Pre-write self-check` sections — then apply those contracts
    before performing the write described in its `## Steps` section with `{ engagement, week: context.iso_week, year: context.year, body: run_body, prompt_source: "spice/cowork/prompts/weekly-review.md", warning }`. Capture `status`. If `status` starts with `"failed:contract-violation:"`, emit Notice `cowork:weekly-review aborted -- contract violation: <field>` (where `<field>` is the part after `failed:contract-violation:`). Do not run state-update steps. Exit non-zero.
    Else if `status` starts with `"failed:"` (e.g. `failed:filesystem:permission`, `failed:write-undersized:285`), emit Notice `cowork:weekly-review aborted -- write failed: <status>` and exit. Do not run state-update steps after a failed write.

## State

17. READ `.claude/skills/cowork/skills/update-active-threads/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, phase: "weekly-refresh", date_today: context.today, writer: "cowork:weekly-review", changes: { archive_resolved_older_than_days: 14, stale_recommendations: <step 11.stale_over_7d>, snoozed_to_open: <step 11.snoozed_to_open>, financial_state_refresh: <step 5 and 6 condensed or null> } }`.
18. READ `.claude/skills/cowork/skills/update-weekly-snapshot/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, phase: "weekly-close", date_today: context.today, writer: "cowork:weekly-review", snapshot_data: { week_of: context.week_of, archive_to_previous: true, totals: { ...condensed metrics... } } }`.

## Done
