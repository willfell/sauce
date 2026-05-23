---
name: cowork:eod-review
description: Engagement-aware end-of-day review. Writes one atomic note at spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/eod-review.md per scheduled invocation; frontmatter `type: cowork-eod-review`. Body composed from gather outputs (todo status, morning follow-up, tomorrow preview, late emails, threads) interpolated through the user's prompt body at spice/cowork/prompts/eod-review.md. Phrasings = "eod for <engagement>", "<engagement> eod review", "give me today's eod for <engagement>".
schedule: Cron-driven per enabled (engagement, eod) pair
scope: shared
tags: [cowork, orchestrator, eod, engagement-aware]
---

# cowork:eod-review

Closes the day for one engagement. Compiles completed/incomplete tasks, compares against the morning briefing's flagged items, previews tomorrow's calendar, surfaces late emails, and updates the active-threads ledger. Writes ONE atomic note at `spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/eod-review.md` (deterministic path per `(orchestrator, day)`; overwrite-last-write-wins idempotency). Body shape follows the user's prompt body at `spice/cowork/prompts/eod-review.md`; when the prompt body is empty, emits a no-op note with `warning: empty_prompt`.

This orchestrator NEVER patches the daily note's callouts, edits the daily-note template, or writes to legacy paths. The v0.65.0 atomic-note write contract is the only output surface.

## Inputs

```
{
  engagement_id: string
}
```

## Pre-flight

1. READ `.claude/skills/cowork/skills/check-vault-routing/SKILL.md` in full and follow
   its `## Steps` section with `{ required: ["obsidian"] }`. If not `"ready"`, emit Notice `cowork:eod-review aborted -- <status>` and exit.
2. **Resolve engagement.** Read vault-config.md; look up engagement by id; load type manifest; capture `engagement` + `render_aspects`.
3. READ `.claude/skills/cowork/skills/date-context/SKILL.md` in full and follow
   its `## Steps` section with `{}`. Capture `context` (today, tomorrow, daily_path, tomorrow_daily_path, tomorrow_weekday).
4. READ `.claude/skills/cowork/skills/ensure-daily-note/SKILL.md` in full and follow
   its `## Steps` section with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

5. READ `.claude/skills/cowork/skills/gather-projects/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, filter: "today-status", today: context.today }`. Capture completed / incomplete / kanban buckets.
6. READ `.claude/skills/cowork/skills/gather-calendar/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_today: context.tomorrow, horizon: "today", timezone: "America/Denver" }`.
7. READ `.claude/skills/cowork/skills/gather-gmail/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, window: "newer_than:12h" }`. Compute `late_emails` = emails arrived after morning-briefing run time.
8. READ `.claude/skills/cowork/skills/gather-threads/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_today: context.today, mode: "eod-reconcile" }`.
9. Compose `morning_followup` summary by reading the matching `## Morning — <engagement.label>` block in today's daily note: `{ flagged_transactions, unanswered_messages, threads: { resolved, snoozed, still_open } }`.
9b. **Semantic related.** If `render_aspects.semantic_related == "include"`:
    READ `.claude/skills/cowork/skills/gather-semantic-related/SKILL.md` in full and follow its `## Steps` section with `{
      mode: "find-related",
      anchor: context.daily_path,
      top_k: 5,
      callout_title: "Notes thematically close to today"
    }`
    Capture as `related_signal`. `semantic_index_age = related_signal.index_age_minutes`.

## Write

10. **Read prompt body** with fallback chain:
    - Read `spice/cowork/prompts/eod-review.md` via `mcp__obsidian__get_file_contents`. Strip frontmatter; capture body as `user_prompt_body` (or empty when missing).
    - If `user_prompt_body` is empty, read `spice/cowork/context/engagement-templates/<engagement.type>/prompts/eod-review.md` (substitute `<engagement.type>` from the resolved engagement; expected values: `personal`, `w2-fte`, `consulting`). Strip frontmatter; capture as `template_prompt_body` (or empty when missing).
    - Set `prompt_body = user_prompt_body || template_prompt_body` (use user prompt when populated; else fall back to engagement-template prompt; else empty).
    - Set `prompt_source` accordingly: if `user_prompt_body` non-empty, `prompt_source = "spice/cowork/prompts/eod-review.md"`; else if `template_prompt_body` non-empty, `prompt_source = "spice/cowork/context/engagement-templates/<engagement.type>/prompts/eod-review.md"`; else `prompt_source = "spice/cowork/prompts/eod-review.md"` (the user-prompt path is still the canonical pointer when both empty — the stub references it).
11. **Compose run-note body** per `prompt_body` instructions interpolating gather outputs. When `prompt_body` is empty, do NOT freelance content — compose a skeleton-compliant STUB body:
    - `SpaceNavButtons` dataviewjs block (verbatim).
    - `> [!info]- Today at a glance\n> (Prompt body empty — edit spice/cowork/prompts/eod-review.md to customize what this run emits.)`
    - `> [!example]+ 📋 Status\n> No prompt body to drive content; this run is a placeholder.`
    - `> [!tip] ✏️ Next action\n> Edit \`spice/cowork/prompts/eod-review.md\` to define what this scheduled job should emit when it fires.`
    Set `warning = "empty_prompt"` and pass `summary = "Stub run — prompt body at spice/cowork/prompts/eod-review.md is empty."` to write-run-note via its `summary` arg. The write-run-note self-check passes (5 markers + summary + title all present).
    When `prompt_body` is non-empty, set `warning = null` and compose the body per the prompt's instructions, respecting the adaptive body skeleton in write-run-note-eod-review's `## Adaptive body skeleton` section.
    **Semantic interpolation** (applies when `prompt_body` is non-empty and step 9b ran):
    - If `semantic_index_age` is non-null, append `> Semantic index age: <semantic_index_age>m` as the last line inside the `> [!info]- Synopsis` callout (before its closing blank line).
    - If `related_signal.status == "ready"`, append the markdown block returned by gather-semantic-related as a `> [!example]+ 🧩 Notes thematically close to today` callout, placed after the last primary example block and before the closing `> [!tip]`.
    - **ONLY IF step 9b ran** (i.e., `render_aspects.semantic_related == "include"`) AND `related_signal.status` starts with `skipped:no-index` OR `skipped:anchor-not-indexed`, append ONE `> [!warning]- Semantic index not available\n> Smart Connections index absent or anchor not indexed — semantic gather skipped.` callout after the Synopsis admonition. Text matches the canonical contract in `cowork:gather-semantic-related`'s `## Orchestrator integration contract` section — do not paraphrase; copy exactly (note the em-dash, not two hyphens). Idempotent: never emit more than one such warning callout per run.
    - **When step 9b did NOT run** (`render_aspects.semantic_related != "include"`): NO warning callout is emitted. The atomic-note body remains structurally clean.
12. READ `.claude/skills/cowork/skills/write-run-note-eod-review/SKILL.md` in full —
    paying particular attention to its `## Title composition`,
    `## Adaptive body skeleton`, and `## Pre-write self-check` sections — then apply those contracts
    before performing the write described in its `## Steps` section with `{ engagement, date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], body: run_body, prompt_source: prompt_source, warning }`. Capture `status`. If `status` starts with `"failed:contract-violation:"`, emit Notice `cowork:eod-review aborted -- contract violation: <field>` (where `<field>` is the part after `failed:contract-violation:`). Do not run state-update steps. Exit non-zero.
    Else if `status` starts with `"failed:"` (e.g. `failed:filesystem:permission`, `failed:write-undersized:285`), emit Notice `cowork:eod-review aborted -- write failed: <status>` and exit. Do not run state-update steps after a failed write.

## Verify

13. **Re-read + structural verify.** After `write-run-note-eod-review` returns a non-`"failed:"` status:

   a. Read the just-written file via the Read tool at `spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/eod-review.md` (substituting the values from `context`).
   b. Parse leading frontmatter (YAML between `---` markers) as `parsed_frontmatter`; capture the remainder as `body`.
   c. Assert required frontmatter fields exist and are non-empty strings:
      - `title:`
      - `summary:`
      - `type:` (must equal `cowork-eod-review`)
      - `warning:` only when the orchestrator passed a non-null `warning` to write-run-note (otherwise the field is allowed to be absent or `null`).
   d. Regex-scan `body` for required structural markers:
      - SpaceNavButtons block: `/```dataviewjs\n[\s\S]*?SpaceNavButtons[\s\S]*?```/`
      - At least one Synopsis callout: `/^> \[!info\]- /m`
      - At least one example callout: `/^> \[!example\]\+ /m`
      - Closing tip callout: `/^> \[!tip\] /m`
   e. On ANY frontmatter-field miss or marker miss:
      - Use Bash to delete the file: `rm -f spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/eod-review.md`
      - Emit Obsidian Notice: `cowork:eod-review aborted -- contract-violation: <missing-field-or-marker-name>`
      - Exit non-zero. Do NOT run subsequent state-update steps.
   f. On all-pass: continue to the State section per the existing flow.

## State

14. READ `.claude/skills/cowork/skills/update-active-threads/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, phase: "eod-pass", date_today: context.today, writer: "cowork:eod-review", changes: { resolved: <step 8.resolved_today>, snoozed_to_open: <step 8.snoozed_today>, new_threads: <step 8.auto_created_eod> } }`.
15. READ `.claude/skills/cowork/skills/update-weekly-snapshot/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, phase: "eod", date_today: context.today, writer: "cowork:eod-review", snapshot_data: { completed_count: <step 5.completed.length>, carryover_count: <step 5.incomplete.length>, threads_resolved_today: <step 8.resolved_today.length> } }`.

## Done
