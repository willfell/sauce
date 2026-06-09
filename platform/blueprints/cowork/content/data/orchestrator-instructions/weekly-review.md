---
schema_version: "1.0.0"
purpose: |
  Canonical step-list for the cowork:weekly-review orchestrator. Single source
  of truth — week-tier scope, output at spice/cowork/weekly/YYYY/YYYY-Www/.
cadence: weekly-review
warm_path_steps: 10
cold_path_skips: []
---

# cowork:weekly-review — orchestrator-instructions

> [!warning]+ CRITICAL: voice + microscope discipline (v0.96.0)
> Path, frontmatter type, and atomic-note body shape are enforced
> deterministically by `write-atomic-note-helper.js` + JSON-schema validation
> against `data/schemas/weekly-review@1.0.0.json`. They cannot drift.
>
> Voice + microscope adherence ARE prose-level invariants the writer can't
> enforce. Apply `user-preferences.personality.notes` verbatim. For each kind
> with a microscope, follow that microscope's `## Output shape` directives
> verbatim.

End-of-week deep pass for one engagement. Memory read at week-tier (v0.85.0
Tier 2). Output path: `spice/cowork/weekly/<YYYY>/<YYYY-Www>/weekly-review.md`.
Frontmatter uses `week: "<YYYY-Www>"` instead of `day:`. Anti-echo NOT eligible
per v0.95.1 §3.4. Rating callout still applies if `learning_enabled`.

## Substitution tokens

| Token | Value |
| --- | --- |
| `{{$engagement_id}}` | required input — id of the engagement to review |
| `{{$engagement_label}}` | friendly label for the engagement |
| `{{$timezone}}` | engagement's IANA timezone |
| `{{$voice_notes}}` | user-preferences.personality.notes verbatim |
| `{{$voice_summary}}` | one-line condensed restatement of voice contract |
| `{{$priorities}}` | per-engagement priorities array |
| `{{$mcp_dispatch_lines}}` | per-kind dispatch lines composed from plan |
| `{{$inner_circle}}` | resolved inner-circle allowlist |
| `{{$workshop_version}}` | sauce workshop semver |
| `{{$cowork_version}}` | cowork blueprint semver |
| `{{$contract_version}}` | scheduled-job-contract.json contract_version |
| `{{$cadence}}` | literal `weekly-review` |
| `{{$frontmatter_type}}` | `cowork-weekly-review` |
| `{{$title_template}}` | `Weekly Review - Week <Www>, <year>` |
| `{{$cadence_mode}}` | `warm` (no lens_shift variant) |
| `{{$today_date}}` | fire-time — YYYY-MM-DD of the day the cron fires |
| `{{$today_weekday}}` | fire-time — long weekday name |
| `{{$today_month_name}}` | fire-time — long month name |
| `{{$today_day}}` | fire-time — day-of-month integer |
| `{{$today_year}}` | fire-time — 4-digit year |
| `{{$today_dirpath}}` | fire-time — `<YYYY>/<YYYY-Www>` (week-tier directory) |
| `{{$today_ymd_compact}}` | fire-time — `YYYYMMDD` |
| `{{$rating_kind_lines}}` | computed-at-emit — `> - [ ] <Kind Title>` per surfaced kind |
| `{{$pending_confirmation_lines}}` | computed-at-emit — pending-MCP bullet lines |

## Steps

### Step 0: Pre-flight (vault routing, engagement, date context)

0a. READ check-vault-routing SKILL.md with `{ required: ["obsidian"] }`. On not-ready,
    emit Notice `cowork:weekly-review aborted -- <status>` and exit.

0b. Emit verbal commitment Notice:

   ```
   cowork:weekly-review committing to:
     VOICE: apply user-preferences.personality.notes verbatim AND personality.{vibe, formality, length, pep_talk}
     MICROSCOPES: for each kind in prefs.priorities with a microscope at spice/cowork/prompts/per-mcp/<kind>/microscope.md, follow ## Output shape verbatim
   ```

   {{shared.connectivity_authority_clause}}

   {{shared.microscope_clause}}

   {{shared.voice_clause}}

0c. **Resolve engagement.** Look up `engagement` in vault-config; read engagement-type
    manifest; capture `render_aspects`. On miss, exit silently / emit Notice.

0d. READ date-context SKILL.md. Capture `context` — critically `today`, `dddd`,
    `week_of`, `week_range`, `week_start`, `week_end`, `daily_path`, `iso_week_label`,
    `iso_week`, `year`, `next_week_start`, `next_week_end`.

### Step 1: Memory (week-tier — this week's synthesis)

1a. Invoke sub-skill `cowork:read-memory` with
    `{ engagement_id: {{$engagement_id}}, tier: "week", window: "this-week" }`. Capture
    `output_week`. Null-data preservation: `output_week = null` when no week-synthesis
    file exists.

   This step is PURE (no MCP calls, no writes).

### Step 2: Gather priority loop + week-summary gathers

> **MANDATORY:** execute the priority loop for EVERY entry in `plan.dispatch_plan`.
> {{shared.microscope_clause}}

> **MANDATORY (v0.91.3): load deferred MCP tools UPFRONT** via ToolSearch.

2a. **Plan dispatch.** Capture `reachable_namespaces` + `tools_by_namespace`. READ
    plan-dispatch SKILL.md with
    `{ engagement_id, cadence: "weekly", reachable_namespaces, tools_by_namespace, vault_root }`.

2b. **Priority loop.** Same shape as morning-briefing Step 2b — but
    `range = { start: context.week_start, end: context.week_end }` for served-by gathers
    (week-tier scope, not day).

2c. **Semantic related (per-day find-related, rolled up).** When
    `plan.render_aspects.semantic_related == "include"`: build `daily_anchors[]` for
    each day in `context.week_start..context.week_end` where the daily note exists. For
    each anchor: READ gather-semantic-related SKILL.md with
    `{ mode: "find-related", anchor, top_k: 5 }`. Collect responses as
    `week_related_signals[]`. Dedupe hits across signals by `path`; compute
    `aggregated_similarity` + `coverage`; re-rank by `(coverage desc, aggregated_similarity desc)`;
    cap to top 10. Compose the rolled-up `> [!example]+ 🧩 Emergent themes this week`
    callout. When zero aggregated, mark `week_related_status = "skipped:no-hits"`.

2d. **Invoice prep / FTE status** (engagement-type-gated). When
    `plan.render_aspects.invoice_prep == "include"` AND `engagement.invoice_cadence`
    indicates weekly invoicing: READ write-summary-invoice-prep SKILL.md with
    `{ engagement, date_today: context.today, mode: "weekly" }`. Capture `invoice_block`.
    When `plan.render_aspects.invoice_prep == "skip"` AND `engagement.type == "w2-fte"`:
    READ write-summary-fte-status SKILL.md; capture `fte_status_block`.

### Step 3: Compose body (week-tier synopsis → week-pattern → per-kind → next-week setup)

{{shared.voice_clause}}

3a. **Prep synopsis_md.** Compose `> [!info]- Week in review` callout per `prompt_body`
    (voice-shaped one-paragraph synopsis distilled from week-summary gather outputs).
    When `semantic_index_age` is non-null, append `> Semantic index age: <age>m`.

3b. **Prep closing_md.** Compose `> [!tip] Next week's setup` callout (2-3 sentence
    next-week setup paragraph + concrete first action).

3c. **Prep memory_callouts struct.**
    - `yesterday_md` ← `composeWeeklyMemoryCallout(output_week)` ("This week so far"); `""`
      when `output_week.found === false`.
    - `overnight_md` ← `""` (weekly cadence does not surface overnight)
    - `echoes_md` ← `composeSemanticEchoesCallout(output_echoes)` when applicable.
    - `backlink_md` ← weekly-memory path:
      `"> [!quote]- Memory log\n> This week's memory: [[spice/cowork/memory/<engagement_id>/weekly/<YYYY>/<YYYY-Www>/memory.md|Memory log — <YYYY-Www>]]"`.

3d. **Prep ordered_blocks[]** — same shape as morning-briefing 3e. **Prep
    engagement_type_blocks[]** — push the rolled-up
    `{ kind: "semantic", callout_type: "example", title: "Emergent themes this week", body_md: <week_related_callout_md> }`
    when `week_related_status != "skipped:no-hits"`. Push the
    `semantic-unavailable` block ONCE when index unavailable.

3e. **Invoke composeBody.** READ compose-body SKILL.md with the full payload (cadence:
    `weekly-review`; frontmatter `type: cowork-weekly-review` AND `week: context.iso_week`).
    Capture `{ body_md, sidecar_json, status }`. On `failed:*`, emit Notice and exit
    non-zero.

### Step 4: Rating callout (Rail L — idempotent re-fire)

4a. Compute `output_path = "spice/cowork/weekly/{{$today_dirpath}}/weekly-review.md"`.
    Parse prior `cowork:rating-block` sentinel via `parseRatingCallout(prior_md)` when
    file exists.

4b. Compute `surfaced_kinds_for_rating` per the same rule as other cadences.

4c. composeBody emits the rating callout per `{{shared.rating_callout_template}}` when
    `learning_enabled !== false` AND `surfaced_kinds_for_rating.length > 0`. (Weekly is
    eligible for rating callouts — only anti-echo is excluded at week-tier.)

### Step 5: Detection callout (Rail D — new-MCP surface)

5a. composeBody emits the detection callout per `{{shared.detection_callout_template}}`
    when `plan.pending_confirmations.length > 0` AND
    `plan.render_aspects.new_mcp_notice == "include"`.

### Step 6: Anti-echo callout — NOT eligible for weekly-review

(weekly-review is intentionally excluded from `ANTI_ECHO_ELIGIBLE_CADENCES` per
v0.95.1 §3.4. composeBody internally gates on cadence eligibility; this step is a
no-op for weekly and exists in the step-list for parity with other cadence files.)

### Step 7: Write .md via obsidian_put_content

7a. Apply `{{shared.frontmatter_base}}` substitution. Weekly cadence frontmatter
    REPLACES `day:` with `week: "<YYYY-Www>"`.

7b. {{shared.dataviewjs_block}} renders SpaceNavButtons block.

7c. READ write-run-note-weekly-review SKILL.md in full — paying particular attention to
    `## Title composition`, `## Adaptive body skeleton`, `## Pre-write self-check` —
    then perform the write described in its `## Steps` section with
    `{ engagement, week: context.iso_week, year: context.year, body: body_md, sidecar_json, prompt_source, warning }`.
    Capture `status`. On `failed:contract-violation:<field>`, emit Notice and exit.

### Step 8: Write .cowork.json sidecar via obsidian_put_content (Rail S sidecar emit)

8a. Apply `{{shared.sidecar_schema_template}}` substitution. Frontmatter mirror includes
    `week:` instead of `day:`.

8b. Write the sidecar to
    `spice/cowork/weekly/{{$today_dirpath}}/weekly-review.cowork.json` via
    `mcp__obsidian__obsidian_put_content`. `writeAtomicNote` invokes `validateSidecar`
    against `data/schemas/weekly-review@1.0.0.json` BEFORE committing either file.

### Step 9: State updates (active-threads, weekly-snapshot)

9a. READ update-active-threads SKILL.md with
    `{ engagement_id, phase: "weekly-refresh", date_today: context.today, writer: "cowork:weekly-review", changes: { archive_resolved_older_than_days: 14, stale_recommendations, snoozed_to_open, financial_state_refresh } }`.

9b. READ update-weekly-snapshot SKILL.md with
    `{ engagement_id, phase: "weekly-close", date_today: context.today, writer: "cowork:weekly-review", snapshot_data: { week_of: context.week_of, archive_to_previous: true, totals } }`.

### Step 10: Done notice

Emit Obsidian Notice `cowork:weekly-review complete -- {{$engagement_label}} <iso_week_label>`.

## Harness testing

This orchestrator conforms to `Docs/agent-guides/cowork-orchestrator-template.md` (v1.0.0).
Cohesion regression caught by HC-V0950-COHESION-A1..A5. Single-source-of-truth regression
caught by HC-V0970-O-1..12.
