---
name: cowork:monthly-review
description: Engagement-aware monthly review. Reviews the PREVIOUS month. Writes one atomic note at spice/cowork/monthly/YYYY/YYYY-MM/monthly-review.md per scheduled invocation; frontmatter `type: cowork-monthly-review`. Body composed from month-summary gather outputs (finance, calendar, imessage, projects, threads, forward-stressors, optional invoice-prep or fte-status) interpolated through the user's prompt body at spice/cowork/prompts/monthly-review.md. Phrasings = "monthly review for <engagement>", "<engagement> monthly", "monthly summary for <engagement>".
schedule: Cron-driven per enabled (engagement, monthly) pair (typically 1st of month for personal + consulting)
scope: shared
tags: [cowork, orchestrator, monthly, engagement-aware]
---

# cowork:monthly-review

First-of-month deep pass for one engagement. Reviews the PREVIOUS month. Writes ONE atomic note at `spice/cowork/monthly/YYYY/YYYY-MM/monthly-review.md` (deterministic path per `(orchestrator, month)`; overwrite-last-write-wins idempotency). Body shape follows the user's prompt body at `spice/cowork/prompts/monthly-review.md`; when the prompt body is empty, emits a no-op note with `warning: empty_prompt`. For finance-tracking engagements, this is the authoritative Credit Debt Payoff reconciliation moment. Refreshes `active-threads.md` + `weekly-snapshot.md` for this engagement's slice as a side effect.

This orchestrator NEVER patches the daily note's callouts, edits the daily-note template, writes "link callouts", or writes to legacy paths like `spice/cowork/summaries/`. The v0.65.0 atomic-note write contract is the only output surface.

## Inputs

```
{
  engagement_id: string
}
```

## Pre-flight

1. READ `.claude/skills/cowork/skills/check-vault-routing/SKILL.md` in full and follow
   its `## Steps` section with `{ required: ["obsidian"] }`. If not `"ready"`, emit Notice `cowork:monthly-review aborted -- <status>` and exit.
2. **Resolve engagement.** Read vault-config.md; look up engagement by id; load type manifest; capture `engagement` + `render_aspects`.
3. READ `.claude/skills/cowork/skills/date-context/SKILL.md` in full and follow
   its `## Steps` section with `{}`. Capture `context` — critically `prev_month_start`, `prev_month_end`, `prev_month_label`, `prev_month_yyyymm`, plus today's `daily_path`.
4. READ `.claude/skills/cowork/skills/ensure-daily-note/SKILL.md` in full and follow
   its `## Steps` section with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

5. If `render_aspects.finance_block == "include"`: READ `.claude/skills/cowork/skills/gather-finance-yesterday/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_yesterday: context.prev_month_end, mode: "full-month", month_range: { start: context.prev_month_start, end: context.prev_month_end } }`.
6. If `render_aspects.finance_block == "include"`: READ `.claude/skills/cowork/skills/gather-cc-debt-snapshot/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_today: context.today, mode: "monthly-close", month_range: { start: context.prev_month_start, end: context.prev_month_end }, append_to_tracker: true }`.
7. READ `.claude/skills/cowork/skills/gather-calendar/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_today: context.today, horizon: "next-month", range_start: context.next_month_start, range_end: context.next_month_end, timezone: "America/Denver" }`.
8. READ `.claude/skills/cowork/skills/gather-imessage/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, window_days: 31, scope: "inner-circle" }` (gated: personal-only).
9. READ `.claude/skills/cowork/skills/gather-projects/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, filter: "monthly", month_range: { start: context.prev_month_start, end: context.prev_month_end } }`.
10. READ `.claude/skills/cowork/skills/gather-threads/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, date_today: context.today, mode: "monthly-audit", month_range: { start: context.prev_month_start, end: context.prev_month_end } }`.
11. Forward-look stressors (inline scan): `spice/trips/` (next 30-45 days), `spice/finance/budgets/` (annual bills next month), explicit "planned purchase" notes. Assemble the Forward look list. (Currently inline; planned `cowork:gather-forward-stressors` sub-skill carry.)
12. If `render_aspects.invoice_prep == "include"` AND `engagement.invoice_cadence == "monthly"`: READ `.claude/skills/cowork/skills/write-summary-invoice-prep/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement, date_today: context.today, mode: "monthly", month_range: { start: context.prev_month_start, end: context.prev_month_end } }`. Capture `invoice_block`.
13. If `render_aspects.invoice_prep == "skip"` AND `engagement.type == "w2-fte"`: READ `.claude/skills/cowork/skills/write-summary-fte-status/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement, date_today: context.today, mode: "monthly" }`. Capture `fte_status_block`.

## Write

14. **Read prompt body** via `mcp__obsidian__get_file_contents` at `spice/cowork/prompts/monthly-review.md`. Strip frontmatter; capture body as `prompt_body` (or empty when missing).
15. **Compose run-note body** per `prompt_body` instructions interpolating month-summary gather outputs. When `prompt_body` is empty, do NOT freelance content — compose a skeleton-compliant STUB body:
    - `SpaceNavButtons` dataviewjs block (verbatim).
    - `> [!info]- This month at a glance\n> (Prompt body empty — edit spice/cowork/prompts/monthly-review.md to customize what this run emits.)`
    - `> [!example]+ 📋 Status\n> No prompt body to drive content; this run is a placeholder.`
    - `> [!tip] ✏️ Next action\n> Edit \`spice/cowork/prompts/monthly-review.md\` to define what this scheduled job should emit when it fires.`
    Set `warning = "empty_prompt"` and pass `summary = "Stub run — monthly-review prompt body at spice/cowork/prompts/monthly-review.md is empty."` to write-run-note via its `summary` arg. The write-run-note self-check passes (5 markers + summary + title all present).
    When `prompt_body` is non-empty, set `warning = null` and compose the body per the prompt's instructions, respecting the adaptive body skeleton in write-run-note-monthly-review's `## Adaptive body skeleton` section.
16. READ `.claude/skills/cowork/skills/write-run-note-monthly-review/SKILL.md` in full —
    paying particular attention to its `## Title composition`, `## Adaptive body
    skeleton`, and `## Pre-write self-check` sections — then apply those contracts
    before performing the write described in its `## Steps` section with `{ engagement, month: context.iso_month, year: context.year, body: run_body, prompt_source: "spice/cowork/prompts/monthly-review.md", warning }`. Capture `status`. If `status` starts with `"failed:contract-violation:"`, emit Notice `cowork:monthly-review aborted -- contract violation: <field>` (where `<field>` is the part after `failed:contract-violation:`). Do not run state-update steps. Exit non-zero.
    Else if `status` starts with `"failed:"` (e.g. `failed:filesystem:permission`, `failed:write-undersized:285`), emit Notice `cowork:monthly-review aborted -- write failed: <status>` and exit. Do not run state-update steps after a failed write.

## State

17. READ `.claude/skills/cowork/skills/update-active-threads/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, phase: "monthly-refresh", date_today: context.today, writer: "cowork:monthly-review", changes: { archive_resolved_older_than_days: 14, audit_full: true, financial_state_refresh: <step 5 and 6 condensed or null> } }`.
18. READ `.claude/skills/cowork/skills/update-weekly-snapshot/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, phase: "monthly-reset", date_today: context.today, writer: "cowork:monthly-review", snapshot_data: { archive_previous_month: true, prev_month_yyyymm: context.prev_month_yyyymm } }`.

## Done
