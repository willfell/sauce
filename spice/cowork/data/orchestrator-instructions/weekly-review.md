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

End-of-week deep pass for one engagement. Writes ONE atomic note at
`spice/cowork/weekly/<YYYY>/<YYYY-Www>/weekly-review.md` per scheduled invocation.
Memory read at week-tier (v0.85.0 Tier 2). Frontmatter uses `week: "<YYYY-Www>"`
instead of `day:`. Anti-echo NOT eligible per v0.95.1 §3.4. Rating callout still
applies if `learning_enabled`.

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

0b. Emit verbal commitment Notice (v0.91.1 + v0.91.2):

   ```
   cowork:weekly-review committing to:
     VOICE: apply user-preferences.personality.notes verbatim AND personality.{vibe, formality, length, pep_talk}
     MICROSCOPES: for each kind in prefs.priorities with a microscope at spice/cowork/prompts/per-mcp/<kind>/microscope.md, follow ## Output shape verbatim
   ```

   Two-purpose commitment: (1) commit voice so personality + voice contract
   land in body composition; (2) commit microscope adherence so each kind's
   callout follows its microscope's `## Output shape`. Deterministic backstops
   via the v0.96.0 Rail W writer + JSON-schema sidecar validation
   (path/frontmatter/dvjs/body-shape are enforced by `write-atomic-note-helper.js`
   against `data/schemas/weekly-review@1.0.0.json`, so PATH + TYPE bullets
   retired). The v0.91.x–v0.92.0 write-guards remain as belt-and-suspenders.

   {{shared.connectivity_authority_clause}}

   {{shared.microscope_clause}}

   {{shared.voice_clause}}

0c. **Resolve engagement.** Look up `engagement` in vault-config; read engagement-type
    manifest at `spice/cowork/context/engagement-types/<engagement.type>.json`; capture
    `render_aspects`. On miss, exit silently / emit Notice.

0d. READ date-context SKILL.md. Capture `context` — critically `today`, `dddd`,
    `week_of`, `week_range`, `week_start`, `week_end`, `daily_path`, `iso_week_label`,
    `iso_week`, `year`, `next_week_start`, `next_week_end`.

### Step 1: Memory (week-tier — this week's synthesis)

3a. **Read recent memory.** Invoke sub-skill `cowork:read-memory` with
    `{ engagement_id: {{$engagement_id}}, tier: "week", window: "this-week" }`. Capture
    `output_week`. Null-data preservation: `output_week = null` when no week-synthesis
    file exists. (Step number 3a is the legacy alias; v0.97.0 numbers it 1a in the
    re-flow.)

   This step is PURE (no MCP calls, no writes).

### Step 2: Gather priority loop + week-summary gathers

> **MANDATORY:** When `plan.dispatch_mode == "prefs"`, execute the priority loop for
> EVERY entry in `plan.dispatch_plan`. Memory ticks are SUPPLEMENTARY context only;
> they DO NOT replace live MCP gather output. Failing to fire the priority loop
> means the dispatch contract's "Known people in scope" wikilink instruction never
> reaches the LLM, and inner-circle names render as plaintext instead of
> `**[[Name]]**` wikilinks. {{shared.microscope_clause}}

> **MANDATORY (v0.91.3): load deferred MCP tools UPFRONT** via ToolSearch.

PREFS UNAVAILABLE fallback (legacy mode): if `plan.dispatch_mode == "legacy"`, emit
Obsidian Notice `cowork:weekly-review -- PREFS UNAVAILABLE (<plan.prefs_status>);
falling back to legacy mode. Chat and any custom kinds will NOT fire in legacy mode;
inner-circle wikilink emission will NOT occur. Investigate user-preferences.md if
this is unexpected.`

2a. **Plan dispatch.** Capture `reachable_namespaces` + `tools_by_namespace`. READ
    plan-dispatch SKILL.md with
    `{ engagement_id, cadence: "weekly", reachable_namespaces, tools_by_namespace, vault_root }`.

2b. **Priority loop.** Same shape as morning-briefing Step 2b — but
    `range = { start: context.week_start, end: context.week_end }` for served-by gathers
    (week-tier scope, not day). Each gather_from_served_by call passes
    `siblings: plan.siblings[entry.kind_name] || []` AND
    `callout_type: prefs.mcps[entry.kind_name].callout_type`.

2c. **Semantic related (per-day find-related, rolled up).** (Legacy step alias:
    `11b. **Semantic related.**`.) When
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

### Step 3: Compose run-note body via cowork:compose-body (week-tier synopsis → week-pattern → per-kind → next-week setup)

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
    when `week_related_status != "skipped:no-hits"`. When any entry in
    `week_related_signals[]` has `status == "skipped:no-index"`, push ONCE
    `{ kind: "semantic-unavailable", callout_type: "warning", title: "Semantic index not available", body_md: "Smart Connections index absent or anchor not indexed — semantic gather skipped." }`
    (the `semantic-unavailable` block ONCE when index unavailable; gated on
    `week_related_signals` status, not a flag).

3e. **Invoke composeBody.** READ `<vault>/.claude/skills/cowork/skills/compose-body/SKILL.md`
    in full with the full payload (cadence: `weekly-review`; frontmatter
    `type: cowork-weekly-review` AND `week: context.iso_week`). Capture
    `{ body_md, sidecar_json, status }`. On `failed:*`, emit Notice and exit
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
    `{ engagement, week: context.iso_week, year: context.year, body: body_md, sidecar_json: sidecar_json, prompt_source, warning }`.
    Capture `status`. On `failed:contract-violation:<field>`, emit Notice and exit.

### Step 8: Write .cowork.json sidecar via obsidian_put_content (Rail S sidecar emit)

8a. Apply `{{shared.sidecar_schema_template}}` substitution. Frontmatter mirror includes
    `week:` instead of `day:`.

8b. Write the sidecar to
    `spice/cowork/weekly/{{$today_dirpath}}/weekly-review.cowork.json` via
    `mcp__obsidian__obsidian_put_content`. `writeAtomicNote` invokes `validateSidecar`
    against `data/schemas/weekly-review@1.0.0.json` BEFORE committing either file. On
    `failed:contract-violation:sidecar-schema`, no files are written.

### Step 8.5: Verify (sidecar schema validation backstop)

**Sidecar schema validation.** The write step's `writeAtomicNote` helper invokes
`validateSidecar` against the cadence schema BEFORE committing either file. If
the helper returned `failed:contract-violation:sidecar-schema`, no files were
written — emit Notice
`cowork:weekly-review aborted -- contract-violation: <field>` and exit
non-zero. Do not run subsequent state-update steps.

The regex re-read pass from v0.91.3+v0.92.0 is RETIRED. Sidecar JSON-schema
validation subsumes it. v0.91.x–v0.92.0 path/frontmatter/dvjs write-guards
INSIDE write-run-note still fire as belt-and-suspenders before the
writeAtomicNote call.

### Step 9: State updates (active-threads, weekly-snapshot)

9a. READ update-active-threads SKILL.md with
    `{ engagement_id, phase: "weekly-refresh", date_today: context.today, writer: "cowork:weekly-review", changes: { archive_resolved_older_than_days: 14, stale_recommendations, snoozed_to_open, financial_state_refresh } }`.

9b. READ update-weekly-snapshot SKILL.md with
    `{ engagement_id, phase: "weekly-close", date_today: context.today, writer: "cowork:weekly-review", snapshot_data: { week_of: context.week_of, archive_to_previous: true, totals } }`.

### Step 10: Done notice

Emit Obsidian Notice `cowork:weekly-review complete -- {{$engagement_label}} <iso_week_label>`.

## Prompt body fallback (v0.4.0 installer-default sentinel detection)

When reading `spice/cowork/prompts/weekly-review.md` to populate `prompt_body`,
apply the v0.4.0 installer-default sentinel detection (v0.90.2):

- **v0.4.0 installer-default sentinel detection.** If `user_prompt_body`
  consists ONLY of the v0.4.0 installer-default content — recognizable by ALL
  of: (a) every non-blank line in the body starts with `> ` (one blockquote),
  (b) the first non-blank line starts with `> Vault-editable prompt for `,
  (c) the body contains the substring `Empty body is a no-op stub for now` —
  treat as if EMPTY and set `user_prompt_body = ""`. The sentinel means the
  user has never customized the prompt, functionally equivalent to empty.
- If `user_prompt_body` is empty, fall back to the engagement-template prompt at
  `spice/cowork/context/engagement-templates/<engagement.type>/prompts/weekly-review.md`.

## Harness testing

This orchestrator conforms to `Docs/agent-guides/cowork-orchestrator-template.md` (v1.0.0).
Cohesion regression caught by HC-V0950-COHESION-A1..A5. Single-source-of-truth regression
caught by HC-V0970-O-1..12.
