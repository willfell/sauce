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
3b. READ `.claude/skills/cowork/skills/read-user-preferences/SKILL.md` in full and follow
   its `## Steps` section with `{}`. Capture as `prefs_result = { prefs, status, reason }`. Capture `prefs = prefs_result.prefs` (may be null when `status != "ok"`). Do NOT abort on `status != "ok"`; continue with legacy fallback (see step 3c).
3c. **Plan dispatch.** Determine dispatch mode and build the priority-ordered dispatch plan.

   Compute `dispatch_mode`:

   ```
   dispatch_mode = (prefs_result.status === "ok") ? "prefs" : "legacy"
   ```

   When `dispatch_mode == "legacy"`:
   - Emit Obsidian Notice: `cowork:weekly-review -- user-preferences <status> (<reason>); using engagement-template defaults`.
   - Skip the remainder of step 3c. The legacy gather sequence fires unchanged.

   When `dispatch_mode == "prefs"`:

   1. From `check-vault-routing`'s prior result (pre-flight step 1), capture `reachable_namespaces` as the set of MCP namespace segments the agent has tools for in this session. Extract by walking your tool list: for every `mcp__<ns>__<tool>` name, add `<ns>` to the set.

   2. Read `mcp-skill-map.json` from `spice/cowork/context/mcp-skill-map.json` via the Read tool. Capture as `mcp_skill_map`. (The map is materialized into every consumer vault as a `files[]` entry.)

   3. Build `dispatch_plan[]` as an ordered array. For each `kind_name` in `prefs.priorities` (in order):

      ```
      mcps_entry = prefs.mcps[kind_name]    # may be undefined

      # Compute kind_title
      if kind_name in {calendar, email, chat, finance}:
          kind_title = canonical lookup ("Calendar", "Email", "Chat", "Finance")
      else:
          kind_title = title-case of kind_name (whitespace/underscore-split; "ado" -> "Ado", "github" -> "Github", "monitoring" -> "Monitoring")

      # Determine action
      if mcps_entry is undefined:
          push { kind_name, action: "warn", reason: "not_classified", kind_title, mcps_entry: null }
          continue
      if mcps_entry.connected == false:
          push { kind_name, action: "warn", reason: "not_connected", kind_title, mcps_entry }
          continue
      if mcps_entry.served_by is set and not in reachable_namespaces:
          push { kind_name, action: "warn", reason: "served_by_unreachable", kind_title, mcps_entry }
          continue
      if mcps_entry.custom_kind == true OR mcps_entry.override_classified == true:
          bookkeeping = {served_by, what_matters, connected, captured_at, custom_kind, override_classified}
          question_set_answers = {k: v for k, v in mcps_entry if k not in bookkeeping}
          push {
            kind_name,
            action: "gather_from_served_by",
            served_by: mcps_entry.served_by,
            what_matters: mcps_entry.what_matters or "",
            question_set_answers: mcps_entry.custom_kind ? null : (question_set_answers if non-empty else null),
            kind_title,
            mcps_entry,
          }
          continue
      # Default: known canonical-vendor kind (kind_name in mcp_skill_map.kinds[].kind)
      if any entry in mcp_skill_map.kinds has .kind == kind_name:
          push {
            kind_name,
            action: "gather_canonical",
            gather_skill: <that entry>.gather_skill,
            kind_title,
            mcps_entry,
          }
      else:
          # Rare: kind name not recognized and not flagged custom — treat as gather_from_served_by
          push { kind_name, action: "gather_from_served_by", served_by, what_matters, question_set_answers: null, kind_title, mcps_entry }
      ```

   4. Capture `voice_contract` from `prefs.personality`: if every field (`vibe`, `formality`, `pep_talk`, `length`, `notes`) is null/undefined, `voice_contract = ""`. Otherwise compose:

      ```
      Voice contract (from spice/cowork/context/user-preferences.md):
      - Vibe: <prefs.personality.vibe or "default">
      - Formality: <prefs.personality.formality or "default">
      - Pep talk: <"yes" if prefs.personality.pep_talk else "no">
      - Length: <prefs.personality.length or "default">
      - Notes: <prefs.personality.notes verbatim, collapsed to single line>

      Apply this voice ONLY to narrative sections (frontmatter summary, [!info]- synopsis, [!tip] closing). Do NOT apply to tabular [!example]+ blocks (their content comes from gather sub-skills and is contractually shaped).

      ---

      ```

   This step is PURE — no MCP calls, no file writes. It builds in-memory state used by the gather phase.
4. READ `.claude/skills/cowork/skills/ensure-daily-note/SKILL.md` in full and follow
   its `## Steps` section with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

When `dispatch_mode == "legacy"`, execute the v0.77.0 legacy gather sequence below verbatim. `ordered_blocks[]` stays empty.

When `dispatch_mode == "prefs"`, skip the legacy steps; execute the priority-loop:

```
ordered_blocks = []
for entry in dispatch_plan:
  if entry.action == "warn":
    md = composeWarningCallout({ kind_name, kind_title, reason, mcps_entry })
    ordered_blocks.push({ kind_name, markdown: md, kind: "warning" })
  elif entry.action == "gather_canonical":
    READ `.claude/skills/cowork/skills/<entry.gather_skill-after-cowork-prefix>/SKILL.md`
    in full and follow its `## Steps` section with the kind's canonical input
    shape (see the existing legacy gather steps for argument shapes).
    Push the gather's markdown into ordered_blocks with kind: "example".
  elif entry.action == "gather_from_served_by":
    READ `.claude/skills/cowork/skills/gather-from-served-by/SKILL.md` in full
    and follow its `## Steps` section with {
      kind_name:            entry.kind_name,
      kind_title:           entry.kind_title,
      served_by:            entry.served_by,
      what_matters:         entry.what_matters,
      question_set_answers: entry.question_set_answers,
      today:                context.today,
      range:                { start: context.week_start, end: context.week_end },
      timezone:             engagement.timezone || "America/Denver"
    }
    if result.status == "ready":
      ordered_blocks.push({ kind_name, markdown: result.markdown, kind: "example" })
    else:
      md = composeWarningCallout({ kind_name, kind_title, reason: result.status, mcps_entry })
      ordered_blocks.push({ kind_name, markdown: md, kind: "warning" })

# After the priority loop, run engagement-type-aspect gathers per existing
# render_aspects gates. These remain APPENDED AFTER ordered_blocks in the
# composed body.
```

*(existing legacy-mode gather steps preserved verbatim below — these fire ONLY when `dispatch_mode == "legacy"`)*

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
14b. **Voice contract.** If `dispatch_mode == "prefs"` AND `voice_contract != ""`, prepend it to `prompt_body`:
   `prompt_body = voice_contract + prompt_body`. The combined string is the input to the body-composition step.
15. **Compose run-note body** per `prompt_body` instructions interpolating week-summary gather outputs.

    When `dispatch_mode == "prefs"`, compose the body as: SpaceNavButtons → `[!info]- This week at a glance` paragraph → `ordered_blocks[]` (priority order, in array order) → engagement-type-aspect blocks (semantic_related, finance from render_aspects) → `[!tip]` closing. `ordered_blocks` entries with `kind: "warning"` render as `[!warning]` callouts in-position. When `dispatch_mode == "legacy"`, use the v0.77.0 composition order verbatim (existing body).

    When `prompt_body` is empty, do NOT freelance content — compose a skeleton-compliant STUB body:
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

## Harness testing

A helper at `platform/blueprints/cowork/helpers/dispatch-plan-helper.js` exports `planDispatch`, `decideDispatchMode`, `composeVoiceContract`, `composeWarningCallout` for the HC-V0780-C* / D* harness cases. Production agents in consumer vaults execute step 3c's algorithm directly — they do NOT depend on the helper file existing.
