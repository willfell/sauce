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
11b. **Semantic related — per-day find-related.** If `render_aspects.semantic_related == "include"`:
     Build `daily_anchors[]` = list of vault-relative daily-note paths for each day in `context.week_start..context.week_end` where the daily note exists on disk (Bash `test -f`). For each anchor:
       READ `.claude/skills/cowork/skills/gather-semantic-related/SKILL.md` in full and follow its `## Steps` section with `{ mode: "find-related", anchor: anchor, top_k: 5 }`
     Collect responses as `week_related_signals[]`. Capture `week_related_signals[0].index_age_minutes` as `semantic_index_age`.
11c. **Aggregate.** Dedupe `hits[]` across `week_related_signals[]` by `path`. For each unique path:
       `aggregated_similarity = sum(similarity across signals where path appears)`
       `coverage = count of days the path surfaced in`
     Re-rank by `(coverage desc, aggregated_similarity desc)`. Cap to top 10.
11d. **Compose rolled-up callout.** Build:
       ```
       > [!example]+ 🧩 Emergent themes this week
       > - [[<title>]] — surfaced <coverage> days (sim sum <agg:.2f>) — <snippet>
       > - ...
       ```
     If `aggregated.length == 0`, mark `week_related_status = "skipped:no-hits"`.
12. If `render_aspects.invoice_prep == "include"`: READ `.claude/skills/cowork/skills/write-summary-invoice-prep/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement, date_today: context.today, mode: "weekly" }` IF `engagement.invoice_cadence` indicates weekly invoicing. Capture `invoice_block` (markdown). Else `invoice_block = ""`.
13. If `render_aspects.invoice_prep == "skip"` AND `engagement.type == "w2-fte"`: READ `.claude/skills/cowork/skills/write-summary-fte-status/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement, date_today: context.today, mode: "weekly" }`. Capture `fte_status_block`. Else `fte_status_block = ""`.

## Write

14. **Read prompt body** with fallback chain:
    - Read `spice/cowork/prompts/weekly-review.md` via `mcp__obsidian__get_file_contents`. Strip frontmatter; capture body as `user_prompt_body` (or empty when missing).
    - If `user_prompt_body` is empty, read `spice/cowork/context/engagement-templates/<engagement.type>/prompts/weekly-review.md`. Strip frontmatter; capture as `template_prompt_body` (or empty when missing).
    - Set `prompt_body = user_prompt_body || template_prompt_body`.
    - Set `prompt_source = (user_prompt_body ? "spice/cowork/prompts/weekly-review.md" : (template_prompt_body ? "spice/cowork/context/engagement-templates/<engagement.type>/prompts/weekly-review.md" : "spice/cowork/prompts/weekly-review.md"))`.
15. **Compose run-note body** per `prompt_body` instructions interpolating week-summary gather outputs. When `prompt_body` is empty, do NOT freelance content — compose a skeleton-compliant STUB body:
    - `SpaceNavButtons` dataviewjs block (verbatim).
    - `> [!info]- This week at a glance\n> (Prompt body empty — edit spice/cowork/prompts/weekly-review.md to customize what this run emits.)`
    - `> [!example]+ 📋 Status\n> No prompt body to drive content; this run is a placeholder.`
    - `> [!tip] ✏️ Next action\n> Edit \`spice/cowork/prompts/weekly-review.md\` to define what this scheduled job should emit when it fires.`
    Set `warning = "empty_prompt"` and pass `summary = "Stub run — weekly-review prompt body at spice/cowork/prompts/weekly-review.md is empty."` to write-run-note via its `summary` arg. The write-run-note self-check passes (5 markers + summary + title all present).
    When `prompt_body` is non-empty, set `warning = null` and compose the body per the prompt's instructions, respecting the adaptive body skeleton in write-run-note-weekly-review's `## Adaptive body skeleton` section.
    **Semantic interpolation** (applies when `prompt_body` is non-empty and steps 11b–11d ran):
    - If `semantic_index_age` is non-null, append `> Semantic index age: <semantic_index_age>m` as the last line inside the `> [!info]- Synopsis` callout (before its closing blank line).
    - If `week_related_status != "skipped:no-hits"`, append the rolled-up `> [!example]+ 🧩 Emergent themes this week` callout composed in step 11d, placed after the last primary example block and before the closing `> [!tip]`.
    - **ONLY IF step 11b ran** (i.e., `render_aspects.semantic_related == "include"`) AND any `week_related_signals[].status` starts with `skipped:no-index` OR `skipped:anchor-not-indexed`, append ONE `> [!warning]- Semantic index not available\n> Smart Connections index absent or anchor not indexed — semantic gather skipped.` callout after the Synopsis admonition. Text matches the canonical contract in `cowork:gather-semantic-related`'s `## Orchestrator integration contract` section — do not paraphrase; copy exactly (note the em-dash, not two hyphens). Idempotent: never emit more than one such warning callout per run regardless of how many per-day calls skipped.
    - **When step 11b did NOT run** (`render_aspects.semantic_related != "include"`): NO warning callout is emitted.
16. READ `.claude/skills/cowork/skills/write-run-note-weekly-review/SKILL.md` in full —
    paying particular attention to its `## Title composition`,
    `## Adaptive body skeleton`, and `## Pre-write self-check` sections — then apply those contracts
    before performing the write described in its `## Steps` section with `{ engagement, week: context.iso_week, year: context.year, body: run_body, prompt_source: prompt_source, warning }`. Capture `status`. If `status` starts with `"failed:contract-violation:"`, emit Notice `cowork:weekly-review aborted -- contract violation: <field>` (where `<field>` is the part after `failed:contract-violation:`). Do not run state-update steps. Exit non-zero.
    Else if `status` starts with `"failed:"` (e.g. `failed:filesystem:permission`, `failed:write-undersized:285`), emit Notice `cowork:weekly-review aborted -- write failed: <status>` and exit. Do not run state-update steps after a failed write.

## Verify

17. **Re-read + structural verify.** After `write-run-note-weekly-review` returns a non-`"failed:"` status:

   a. Read the just-written file via the Read tool at `spice/cowork/weekly/<YYYY>/<YYYY-Www>/weekly-review.md` (substituting the values from `context`).
   b. Parse leading frontmatter (YAML between `---` markers) as `parsed_frontmatter`; capture the remainder as `body`.
   c. Assert required frontmatter fields exist and are non-empty strings:
      - `title:`
      - `summary:`
      - `type:` (must equal `cowork-weekly-review`)
      - `warning:` only when the orchestrator passed a non-null `warning` to write-run-note (otherwise the field is allowed to be absent or `null`).
   d. Regex-scan `body` for required structural markers:
      - SpaceNavButtons block: `/```dataviewjs\n[\s\S]*?SpaceNavButtons[\s\S]*?```/`
      - At least one Synopsis callout: `/^> \[!info\]- /m`
      - At least one example callout: `/^> \[!example\]\+ /m`
      - Closing tip callout: `/^> \[!tip\] /m`
   e. On ANY frontmatter-field miss or marker miss:
      - Use Bash to delete the file: `rm -f spice/cowork/weekly/<YYYY>/<YYYY-Www>/weekly-review.md`
      - Emit Obsidian Notice: `cowork:weekly-review aborted -- contract-violation: <missing-field-or-marker-name>`
      - Exit non-zero. Do NOT run subsequent state-update steps.
   f. On all-pass: continue to the State section per the existing flow.

## State

18. READ `.claude/skills/cowork/skills/update-active-threads/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, phase: "weekly-refresh", date_today: context.today, writer: "cowork:weekly-review", changes: { archive_resolved_older_than_days: 14, stale_recommendations: <step 11.stale_over_7d>, snoozed_to_open: <step 11.snoozed_to_open>, financial_state_refresh: <step 5 and 6 condensed or null> } }`.
19. READ `.claude/skills/cowork/skills/update-weekly-snapshot/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, phase: "weekly-close", date_today: context.today, writer: "cowork:weekly-review", snapshot_data: { week_of: context.week_of, archive_to_previous: true, totals: { ...condensed metrics... } } }`.

## Done
