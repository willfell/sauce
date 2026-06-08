---
name: cowork:monthly-review
description: Engagement-aware monthly review. Reviews the PREVIOUS month. Writes one atomic note at spice/cowork/monthly/YYYY/YYYY-MM/monthly-review.md per scheduled invocation; frontmatter `type: cowork-monthly-review`. Body composed from month-summary gather outputs (finance, calendar, imessage, projects, threads, forward-stressors, optional invoice-prep or fte-status) interpolated through the user's prompt body at spice/cowork/prompts/monthly-review.md. Phrasings = "monthly review for <engagement>", "<engagement> monthly", "monthly summary for <engagement>".
schedule: Cron-driven per enabled (engagement, monthly) pair (typically 1st of month for personal + consulting)
scope: shared
tags: [cowork, orchestrator, monthly, engagement-aware]
---

# cowork:monthly-review

> [!warning]+ CRITICAL: output path (v0.90.2)
> This orchestrator writes ONE atomic note to:
>
> `spice/cowork/monthly/<YYYY>/<YYYY-MM>/monthly-review.md`
>
> DO NOT write to `spice/daily/<YYYY>/<MM-Month>/<weekday>-<YYYY-MM-DD>.md` or any other path outside `spice/cowork/monthly/` — that's a separate blueprint surface, NOT this orchestrator's output. The consumer vault's CLAUDE.md may list `spice/daily/` under the "Daily" topic and `spice/cowork/monthly/` may also appear in other resolvers; THE COWORK MONTHLY ATOMIC NOTE LIVES UNDER `spice/cowork/monthly/`, NEVER under `spice/daily/`.
>
> The write happens via sub-skill `cowork:write-run-note-monthly-review` (READ its SKILL.md before invoking; the step that delegates to it is later in this file). NEVER write the atomic note directly via the `Write` tool, the `Edit` tool, or `mcp__obsidian__obsidian_put_content` from this orchestrator body — ALWAYS delegate to the write sub-skill which enforces the path + frontmatter + structural-marker contracts.

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
1b. **Verbal commitment (v0.91.1 + v0.91.2).** Before any other action, emit Obsidian Notice as a binding commitment:

   ```
   cowork:monthly-review committing to:
     PATH: spice/cowork/monthly/<YYYY>/<YYYY-MM>/monthly-review.md (NOT spice/daily/)
     TYPE: cowork-monthly-review (canonical frontmatter type)
     VOICE: apply user-preferences.personality.notes verbatim AND personality.{vibe, formality, length, pep_talk}
     MICROSCOPES: follow ## Output shape from each per-mcp/<kind>/microscope.md verbatim
   ```

   Deterministic backstops in write-run-note: path write-guard (v0.91.1) + frontmatter write-guard (v0.91.2). Voice + microscope are prose-imperative.

2. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md`; look up engagement by id. If not found, exit silently. Read the engagement-type manifest via the Read tool at `spice/cowork/context/engagement-types/<engagement.type>.json` (expected values: `personal`, `w2-fte`, `consulting`). Parse as JSON; capture `engagement` + `render_aspects`. If the file is missing or fails to parse, emit Notice `cowork:monthly-review aborted -- engagement-type manifest unavailable at spice/cowork/context/engagement-types/<engagement.type>.json` and exit.
3. READ `.claude/skills/cowork/skills/date-context/SKILL.md` in full and follow
   its `## Steps` section with `{}`. Capture `context` — critically `prev_month_start`, `prev_month_end`, `prev_month_label`, `prev_month_yyyymm`, plus today's `daily_path`. Also capture `month_start` / `month_end` (first / last day of `context.today`'s month, used as the prefs-driven dispatch range below).
3a. **Read recent memory.** (NEW v0.86.0; mirrors morning-briefing's step 3a refactor.)

   Invoke sub-skill `cowork:read-memory` with input `{ engagement_id, tier: "week", window: { start: context.month_start, end: context.today } }`. Capture `output_month` — aggregated weekly syntheses across the current month. The sub-skill returns null-data when no matching synthesis files exist — preserve as `output_month = null` for the body-composition step.

   This step is PURE (no MCP calls, no writes). NEW in v0.86.0.
3b. **Plan dispatch.** (Replaces v0.94.x's separate `3b read-prefs + 3c dispatch + 3d inner-circle` steps with a single sub-skill READ.)

   Capture `reachable_namespaces` from the agent's tool list (walk every `mcp__<ns>__<tool>` name; add `<ns>` to the set).

   READ `.claude/skills/cowork/skills/plan-dispatch/SKILL.md` in full and follow its `## Steps` section with `{ engagement_id, cadence: "monthly", reachable_namespaces, vault_root: <vault-root-from-routing> }`. Capture the 12-key result as `plan`.

   If `plan.dispatch_mode == "legacy"`, emit Obsidian Notice: `cowork:monthly-review -- PREFS UNAVAILABLE (<plan.prefs_status>); falling back to legacy mode.` The legacy gather sequence fires unchanged.

   When `plan.dispatch_mode == "prefs"`, Gather + Write consume `plan.dispatch_plan`, `plan.voice_contract`, `plan.microscopes`, `plan.siblings`, `plan.allowlist`, `plan.render_aspects`, `plan.cadence_order`, `plan.kind_titles`, and `plan.effective_hard_rules` directly — no inline dispatch-plan composition lives in this orchestrator. Each `gather-from-served-by` invocation passes `range: { start: context.month_start, end: context.month_end }` (date-context emits these pre-computed first/last-day-of-month fields).

The legacy dispatch-plan pseudocode + inner-circle resolver block that lived in this section through v0.94.x is now wrapped inside `cowork:plan-dispatch`. See the sub-skill's `## Steps` for the LLM-followable algorithm.
4. READ `.claude/skills/cowork/skills/ensure-daily-note/SKILL.md` in full and follow
   its `## Steps` section with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

> **MANDATORY:** When `plan.dispatch_mode == "prefs"`, execute the priority loop for EVERY entry in `plan.dispatch_plan`. Memory ticks are SUPPLEMENTARY context for the `[!info]- Today at a glance` synopsis section; they DO NOT replace live MCP gather output. When a kind's `action == "warn"`, emit the warning callout in-position via `composeWarningCallout`. Failing to fire the priority loop means the dispatch contract's "Known people in scope" wikilink instruction never reaches the LLM.

> **MANDATORY (v0.91.3): load deferred MCP tools UPFRONT.** Before the priority loop, for each kind in `plan.dispatch_plan` with `action == "gather_from_served_by"` or `action == "gather_canonical"`, load the required deferred tools from the kind's `served_by` namespace via Tool Search / Load.

When `plan.dispatch_mode == "legacy"`, execute the v0.77.0 legacy gather sequence below verbatim. `ordered_blocks[]` stays empty.

When `plan.dispatch_mode == "prefs"`, skip the legacy steps; execute the priority-loop:

```
ordered_blocks = []
for entry in plan.dispatch_plan:
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
      what_matters:         entry.what_matters,     # microscope body when entry.microscope == true
      question_set_answers: entry.question_set_answers,
      hard_rules:           plan.effective_hard_rules,
      siblings:             plan.siblings[entry.kind_name] || [],
      callout_type:         entry.mcps_entry.callout_type,
      inner_circle_resolved: plan.allowlist.resolved,
      engagement_id:        engagement_id,
      today:                context.today,
      range:                { start: context.month_start, end: context.month_end },
      timezone:             engagement.timezone || "America/Denver"
    }
    # When entry.baseline_notes is set (microscope-routed kind), treat it as secondary
    # "baseline preferences" context behind the microscope contract.
    if result.status == "ready":
      ordered_blocks.push({ kind_name, markdown: result.markdown, kind: "example" })
    else:
      md = composeWarningCallout({ kind_name, kind_title, reason: result.status, mcps_entry })
      ordered_blocks.push({ kind_name, markdown: md, kind: "warning" })

# After the priority loop, run engagement-type-aspect gathers per existing
# render_aspects gates. These remain APPENDED AFTER ordered_blocks in the
# composed body.
```

*(existing legacy-mode gather steps preserved verbatim below — these fire ONLY when `plan.dispatch_mode == "legacy"`)*

5. If `plan.render_aspects.finance_block == "include"`: READ `.claude/skills/cowork/skills/gather-finance-yesterday/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_yesterday: context.prev_month_end, mode: "full-month", month_range: { start: context.prev_month_start, end: context.prev_month_end } }`.
6. If `plan.render_aspects.finance_block == "include"`: READ `.claude/skills/cowork/skills/gather-cc-debt-snapshot/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_today: context.today, mode: "monthly-close", month_range: { start: context.prev_month_start, end: context.prev_month_end }, append_to_tracker: true }`.
7. READ `.claude/skills/cowork/skills/gather-calendar/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_today: context.today, horizon: "next-month", range_start: context.next_month_start, range_end: context.next_month_end, timezone: "America/Denver" }`.
8. READ `.claude/skills/cowork/skills/gather-imessage/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, window_days: 31, scope: "inner-circle", inner_circle: plan.allowlist.phone_filter_list.join(",") }` (gated: personal-only). The `phone_filter_list` is composed inside `cowork:plan-dispatch` via `composeInnerCircleAllowlist`; empty string when no inner-circle is configured.
9. READ `.claude/skills/cowork/skills/gather-projects/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, filter: "monthly", month_range: { start: context.prev_month_start, end: context.prev_month_end } }`.
10. READ `.claude/skills/cowork/skills/gather-threads/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, date_today: context.today, mode: "monthly-audit", month_range: { start: context.prev_month_start, end: context.prev_month_end } }`.
11. Forward-look stressors (inline scan): `spice/trips/` (next 30-45 days), `spice/finance/budgets/` (annual bills next month), explicit "planned purchase" notes. Assemble the Forward look list. (Currently inline; planned `cowork:gather-forward-stressors` sub-skill carry.)
12. If `plan.render_aspects.invoice_prep == "include"` AND `engagement.invoice_cadence == "monthly"`: READ `.claude/skills/cowork/skills/write-summary-invoice-prep/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement, date_today: context.today, mode: "monthly", month_range: { start: context.prev_month_start, end: context.prev_month_end } }`. Capture `invoice_block`.
13. If `plan.render_aspects.invoice_prep == "skip"` AND `engagement.type == "w2-fte"`: READ `.claude/skills/cowork/skills/write-summary-fte-status/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement, date_today: context.today, mode: "monthly" }`. Capture `fte_status_block`.

## Write

14. **Read prompt body** with fallback chain:
    - Read `spice/cowork/prompts/monthly-review.md` via `mcp__obsidian__get_file_contents`. Strip frontmatter; capture body as `user_prompt_body` (or empty when missing).
    - **v0.4.0 installer-default sentinel detection (v0.90.2):** if `user_prompt_body` consists ONLY of the v0.4.0 installer-default content — recognizable by ALL of: (a) every non-blank line in the body starts with `> ` (one blockquote), (b) the first non-blank line starts with `> Vault-editable prompt for `, (c) the body contains the substring `Empty body is a no-op stub for now` — treat as if EMPTY and set `user_prompt_body = ""`.
    - If `user_prompt_body` is empty, read `spice/cowork/context/engagement-templates/<engagement.type>/prompts/monthly-review.md`. Strip frontmatter; capture as `template_prompt_body` (or empty when missing).
    - Set `prompt_body = user_prompt_body || template_prompt_body`.
    - Set `prompt_source = (user_prompt_body ? "spice/cowork/prompts/monthly-review.md" : (template_prompt_body ? "spice/cowork/context/engagement-templates/<engagement.type>/prompts/monthly-review.md" : "spice/cowork/prompts/monthly-review.md"))`.
14b. **Voice contract.** If `plan.dispatch_mode == "prefs"` AND `plan.voice_contract != ""`, prepend it to `prompt_body`:
   `prompt_body = plan.voice_contract + prompt_body`. The combined string is the input to the body-composition step.
15. **Compose run-note body via cowork:compose-body.**

  14a. **Prep synopsis_md.** Compose the `> [!info]- Month in review` callout per `prompt_body` instructions (voice-shaped one-paragraph synopsis distilled from month-summary gather outputs). When `semantic_index_age` is non-null, append `> Semantic index age: <semantic_index_age>m` as the last `> ` line inside the synopsis callout BEFORE passing to composeBody.
       - Empty-prompt stub case (when `warning == "empty_prompt"`): synopsis_md = `"> [!info]- Month in review\n> (Prompt body empty — edit spice/cowork/prompts/monthly-review.md to customize what this run emits.)"`.

  14b. **Prep closing_md.** Compose the `> [!tip] Next month's board` callout per `prompt_body` instructions (2-3 sentence next-month board paragraph + concrete first action).
       - Empty-prompt stub case: closing_md = `"> [!tip] Next month's board\n> Edit \`spice/cowork/prompts/monthly-review.md\` to define what this scheduled job should emit when it fires."`.

  14c. **Prep memory_callouts struct.** Use existing helpers:
       - `yesterday_md` ← `composeMonthlyMemoryCallout(output_month)` (the "This month's pattern" callout — aggregates up to 4 weekly syntheses); `""` when empty
       - `overnight_md` ← `""` (monthly cadence does not surface overnight)
       - `echoes_md` ← `composeSemanticEchoesCallout(output_echoes)` when applicable, else `""`
       - `backlink_md` ← inline-composed per v0.85.0 § 2.1.3 spec, monthly memory path: `"> [!quote]- Memory log\n> This month's memory: [[spice/cowork/memory/<engagement_id>/monthly/<YYYY>/<YYYY-MM>/memory.md|Memory log — <YYYY-MM>]]"`.

  14d. **Prep ordered_blocks[].** Iterate gather-pipeline `ordered_blocks[]` (from priority loop). Each entry already carries `{ kind, callout_type, markdown }`. Add `title` from `plan.kind_titles[entry.kind_name]` (v0.95.0: data file `spice/cowork/data/kind-titles.json` is canonical; per-kind microscope `## Output shape` directives may override per-engagement). Translate to composeBody shape: `{ kind, callout_type, title, body_md: markdown }`.

  14e. **Prep engagement_type_blocks[].** For each `related_signal` in `related_signals[]` with `status == "ready"`: push `{ kind: "semantic", callout_type: "example", title: "Related to: <event.title>", body_md: <related_signal.markdown> }`. When `semantic_index_unavailable == true`: push ONCE `{ kind: "semantic-unavailable", callout_type: "warning", title: "Semantic index not available", body_md: "Smart Connections index absent or anchor not indexed — semantic gather skipped." }`. Finance does NOT flow through here — it's written by a separate sub-skill when applicable.

  14f. **Invoke composeBody.** READ `.claude/skills/cowork/skills/compose-body/SKILL.md` in full and follow its `## Compose` section with `{ cadence: "monthly-review", nav_buttons_block: "<canonical block>", synopsis_md, memory_callouts: { yesterday_md, overnight_md, echoes_md, backlink_md }, ordered_blocks, engagement_type_blocks, closing_md }`. Capture `{ body_md, body_assertions, status }`.

  14g. **Compose failure handling.** If `status` starts with `"failed:"`, emit Notice `cowork:monthly-review aborted -- compose-body failure: <status>` and exit non-zero. Do NOT call write-run-note. Do NOT run state-update steps.
16. READ `.claude/skills/cowork/skills/write-run-note-monthly-review/SKILL.md` in full —
    paying particular attention to its `## Title composition`,
    `## Adaptive body skeleton`, and `## Pre-write self-check` sections — then apply those contracts
    before performing the write described in its `## Steps` section with `{ engagement, month: context.iso_month, year: context.year, body: body_md, body_assertions, prompt_source: prompt_source, warning }`. Capture `status`. If `status` starts with `"failed:contract-violation:"`, emit Notice `cowork:monthly-review aborted -- contract violation: <field>` (where `<field>` is the part after `failed:contract-violation:`). Do not run state-update steps. Exit non-zero.
    Else if `status` starts with `"failed:"` (e.g. `failed:filesystem:permission`, `failed:write-undersized:285`), emit Notice `cowork:monthly-review aborted -- write failed: <status>` and exit. Do not run state-update steps after a failed write.

## Verify

17. **Re-read + structural verify.** After `write-run-note-monthly-review` returns a non-`"failed:"` status:

   a. Read the just-written file via the Read tool at `spice/cowork/monthly/<YYYY>/<YYYY-MM>/monthly-review.md` (substituting the values from `context`).
   b. Parse leading frontmatter (YAML between `---` markers) as `parsed_frontmatter`; capture the remainder as `body`.
   c. Assert required frontmatter fields exist and are non-empty strings:
      - `title:`
      - `summary:`
      - `type:` (must equal `cowork-monthly-review`)
      - `warning:` only when the orchestrator passed a non-null `warning` to write-run-note (otherwise the field is allowed to be absent or `null`).
   d. Regex-scan `body` for required structural markers:
      - SpaceNavButtons block (v0.91.3 canonical pattern — REJECTS hallucinated `const { SpaceNavButtons } = customJS` shape): `/```dataviewjs\s*\n\s*await\s+dv\.view\(\s*["']ranch\/views\/customjs-guard["']\s*,\s*\{\s*class:\s*["']SpaceNavButtons["']\s*\}\s*\)/`
      - At least one Synopsis callout: `/^> \[!info\]- /m`
      - At least one example callout: `/^> \[!example\]\+ /m`
      - Closing tip callout: `/^> \[!tip\] /m`
   e. On ANY frontmatter-field miss or marker miss:
      - Use Bash to delete the file: `rm -f spice/cowork/monthly/<YYYY>/<YYYY-MM>/monthly-review.md`
      - Emit Obsidian Notice: `cowork:monthly-review aborted -- contract-violation: <missing-field-or-marker-name>`
      - Exit non-zero. Do NOT run subsequent state-update steps.
   f. On all-pass: continue to the State section per the existing flow.

## State

18. READ `.claude/skills/cowork/skills/update-active-threads/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, phase: "monthly-refresh", date_today: context.today, writer: "cowork:monthly-review", changes: { archive_resolved_older_than_days: 14, audit_full: true, financial_state_refresh: <step 5 and 6 condensed or null> } }`.
19. READ `.claude/skills/cowork/skills/update-weekly-snapshot/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, phase: "monthly-reset", date_today: context.today, writer: "cowork:monthly-review", snapshot_data: { archive_previous_month: true, prev_month_yyyymm: context.prev_month_yyyymm } }`.

## Done

## Harness testing

This orchestrator conforms to `Docs/agent-guides/cowork-orchestrator-template.md` (v1.0.0). Cohesion regression is caught by HC-V0950-COHESION-A1..A5.

A helper at `platform/blueprints/cowork/helpers/dispatch-plan-helper.js` exports `planDispatch`, `decideDispatchMode`, `composeVoiceContract`, `composeWarningCallout`, and the v0.95.0 additive trio `composeFinalPreferences`, `readEngagement`, `loadKindTitles`. The cowork:plan-dispatch sub-skill body composes these helpers into the 12-key result tree this orchestrator consumes — no inline dispatch-plan pseudocode remains.
