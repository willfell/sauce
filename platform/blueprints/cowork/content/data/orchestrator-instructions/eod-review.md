---
schema_version: "1.0.0"
purpose: |
  Canonical step-list for the cowork:eod-review orchestrator. Single source
  of truth — retrospective tone, what shipped + what's carrying forward.
cadence: eod-review
warm_path_steps: 10
cold_path_skips: []
---

# cowork:eod-review — orchestrator-instructions

> [!warning]+ CRITICAL: voice + microscope discipline (v0.96.0)
> Path, frontmatter type, and atomic-note body shape are enforced
> deterministically by `write-atomic-note-helper.js` + JSON-schema validation
> against `data/schemas/eod-review@1.0.0.json`. They cannot drift.
>
> Voice + microscope adherence ARE prose-level invariants the writer can't
> enforce. Apply `user-preferences.personality.notes` verbatim. For each kind
> with a microscope, follow that microscope's `## Output shape` directives
> verbatim. Memory tick at the bottom is mandatory.

Closes the day for one engagement. Tone: retrospective; what shipped, what's
carrying forward, what tomorrow looks like. Memory tick at the bottom is
mandatory. Compiles completed/incomplete tasks, compares against the morning
briefing's flagged items, previews tomorrow's calendar, surfaces late emails,
updates the active-threads ledger. Writes ONE atomic note at
`spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/eod-review.md` (overwrite-last-write-wins
idempotency).

## Substitution tokens

| Token | Value |
| --- | --- |
| `{{$engagement_id}}` | required input — id of the engagement to close |
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
| `{{$cadence}}` | literal `eod-review` |
| `{{$frontmatter_type}}` | `cowork-eod-review` |
| `{{$title_template}}` | `EOD Review - <weekday>, <month> <day>, <year>` |
| `{{$cadence_mode}}` | `warm` (no lens_shift variant) |
| `{{$today_date}}` | fire-time — YYYY-MM-DD |
| `{{$today_weekday}}` | fire-time — long weekday name |
| `{{$today_month_name}}` | fire-time — long month name |
| `{{$today_day}}` | fire-time — day-of-month integer |
| `{{$today_year}}` | fire-time — 4-digit year |
| `{{$today_dirpath}}` | fire-time — `<YYYY>/<MM-MMMM>/<YYYY-MM-DD>` |
| `{{$today_ymd_compact}}` | fire-time — `YYYYMMDD` |
| `{{$rating_kind_lines}}` | computed-at-emit — `> - [ ] <Kind Title>` per surfaced kind |
| `{{$pending_confirmation_lines}}` | computed-at-emit — pending-MCP bullet lines |

## Steps

### Step 0: Pre-flight (vault routing, engagement, date context)

0a. READ `<vault>/.claude/skills/cowork/skills/check-vault-routing/SKILL.md` in full and
    follow with `{ required: ["obsidian"] }`. If not `"ready"`, emit Notice
    `cowork:eod-review aborted -- <status>` and exit.

0b. Emit verbal commitment Notice:

   ```
   cowork:eod-review committing to:
     VOICE: apply user-preferences.personality.notes verbatim AND personality.{vibe, formality, length, pep_talk}
     MICROSCOPES: for each kind in prefs.priorities with a microscope at spice/cowork/prompts/per-mcp/<kind>/microscope.md, follow ## Output shape verbatim
   ```

   {{shared.connectivity_authority_clause}}

   {{shared.microscope_clause}}

   {{shared.voice_clause}}

0c. **Resolve engagement.** Look up `engagement` in vault-config; read engagement-type
    manifest; capture `render_aspects`. On miss, exit silently / emit Notice.

0d. READ date-context SKILL.md. Capture `context` (today, tomorrow, daily_path,
    tomorrow_daily_path, tomorrow_weekday).

### Step 1: Memory (today's ticks + today's day-tier synthesis)

1a. Invoke sub-skill `cowork:read-memory` with
    `{ engagement_id: {{$engagement_id}}, tier: "tick", window: "today" }`. Capture
    `output_today`.

1b. Invoke sub-skill `cowork:read-memory` with
    `{ engagement_id: {{$engagement_id}}, tier: "day", window: "today" }`. Capture
    `output_day` for the day-synthesis callout.

   Both invocations are PURE (no MCP calls, no writes).

### Step 2: Gather priority loop + per-aspect EOD gathers

> **MANDATORY:** execute the priority loop for EVERY entry in `plan.dispatch_plan`.
> {{shared.microscope_clause}}

> **MANDATORY (v0.91.3): load deferred MCP tools UPFRONT** via ToolSearch.

2a. **Plan dispatch.** Capture `reachable_namespaces` + `tools_by_namespace`. READ
    plan-dispatch SKILL.md with
    `{ engagement_id, cadence: "eod", reachable_namespaces, tools_by_namespace, vault_root }`.
    Capture the 14-key `plan`.

2b. **Priority loop.** Same shape as morning-briefing Step 2b — warn /
    gather_canonical / gather_from_served_by dispatch. Push results into
    `ordered_blocks[]`. `range = { start: context.today, end: context.today }` for
    served-by gathers.

2c. **Semantic related (semantic_related render-aspect gated).** When
    `plan.render_aspects.semantic_related == "include"`: READ gather-semantic-related
    SKILL.md with
    `{ mode: "find-related", anchor: context.daily_path, top_k: 5, callout_title: "Notes thematically close to today" }`.
    Capture `related_signal`. `semantic_index_age = related_signal.index_age_minutes`.

2d. **Morning followup.** Compose `morning_followup` summary by reading the matching
    `## Morning — <engagement.label>` block in today's daily note:
    `{ flagged_transactions, unanswered_messages, threads: { resolved, snoozed, still_open } }`.

### Step 3: Compose body (retrospective synopsis → day-pattern → per-kind → carry-forward)

{{shared.voice_clause}}

3a. **Prep synopsis_md.** Compose `> [!info]- Today's recap` callout per `prompt_body`
    (voice-shaped one-paragraph synopsis distilled from gather outputs). When
    `semantic_index_age` is non-null, append `> Semantic index age: <age>m`.

3b. **Prep closing_md.** Compose `> [!tip] Carries forward` callout (2-3 sentence
    carry-forward paragraph + concrete first action for tomorrow).

3c. **Prep memory_callouts struct.**
    - `yesterday_md` ← `composeEodMemoryCallout(output_today, output_day).tickLogCalloutMd`
    - `overnight_md` ← `composeEodMemoryCallout(...).dayPatternCalloutMd` (the day-synthesis
      callout — MANDATORY memory tick at the body bottom per cadence tone)
    - `echoes_md` ← `composeSemanticEchoesCallout(output_echoes)` when applicable, else `""`
    - `backlink_md` ← inline-composed per v0.85.0 § 2.1.3 spec.

3d. **Prep ordered_blocks[]** and **engagement_type_blocks[]** — same shape as
    morning-briefing 3e/3f.

3e. **Invoke composeBody.** READ compose-body SKILL.md with full payload
    (cadence: `eod-review`; frontmatter type `cowork-eod-review`). Capture
    `{ body_md, sidecar_json, status }`. On `failed:*`, emit Notice and exit non-zero.

### Step 4: Rating callout (Rail L — idempotent re-fire)

4a. Compute `output_path = "spice/cowork/daily/{{$today_dirpath}}/eod-review.md"`.
    Parse prior `cowork:rating-block` sentinel via `parseRatingCallout(prior_md)` when
    file exists; build `prior_rating_state` map.

4b. Compute `surfaced_kinds_for_rating` per the same rule as other cadences.

4c. composeBody emits the rating callout per `{{shared.rating_callout_template}}` when
    eligible.

### Step 5: Detection callout (Rail D — new-MCP surface)

5a. composeBody emits the detection callout per `{{shared.detection_callout_template}}`
    when `plan.pending_confirmations.length > 0` AND
    `plan.render_aspects.new_mcp_notice == "include"`.

### Step 6: Anti-echo callout (v0.95.1 Knob 1 — eligible for eod-review)

6a. composeBody emits the anti-echo callout per `{{shared.anti_echo_callout_template}}`
    when cadence `eod-review` is in `ANTI_ECHO_ELIGIBLE_CADENCES` AND
    `plan.excluded_themes.length > 0`.

### Step 7: Write .md via obsidian_put_content

7a. Apply `{{shared.frontmatter_base}}` substitution (`{{$frontmatter_type}}` =
    `cowork-eod-review`).

7b. {{shared.dataviewjs_block}} renders SpaceNavButtons block.

7c. READ write-run-note-eod-review SKILL.md in full — paying particular attention to
    `## Title composition`, `## Adaptive body skeleton`, `## Pre-write self-check` —
    then perform the write described in its `## Steps` section with
    `{ engagement, date: {{$today_date}}, weekday: {{$today_weekday}}, month_name: {{$today_month_name}}, body: body_md, sidecar_json, prompt_source, warning }`.
    Capture `status`. On `failed:contract-violation:<field>`, emit Notice and exit.

### Step 8: Write .cowork.json sidecar via obsidian_put_content (Rail S sidecar emit)

8a. Apply `{{shared.sidecar_schema_template}}` substitution.

8b. Write the sidecar to `spice/cowork/daily/{{$today_dirpath}}/eod-review.cowork.json`
    via `mcp__obsidian__obsidian_put_content`. `writeAtomicNote` invokes
    `validateSidecar` against `data/schemas/eod-review@1.0.0.json` BEFORE
    committing either file.

### Step 9: State updates (active-threads, weekly-snapshot)

9a. READ update-active-threads SKILL.md with
    `{ engagement_id, phase: "eod-pass", date_today: {{$today_date}}, writer: "cowork:eod-review", changes: { resolved, snoozed_to_open, new_threads } }`.

9b. READ update-weekly-snapshot SKILL.md with
    `{ engagement_id, phase: "eod", date_today: {{$today_date}}, writer: "cowork:eod-review", snapshot_data: { completed_count, carryover_count, threads_resolved_today } }`.

### Step 10: Done notice

Emit Obsidian Notice `cowork:eod-review complete -- {{$engagement_label}} {{$today_date}}`.

## Harness testing

This orchestrator conforms to `Docs/agent-guides/cowork-orchestrator-template.md` (v1.0.0).
Cohesion regression caught by HC-V0950-COHESION-A1..A5. Single-source-of-truth regression
caught by HC-V0970-O-1..12.
