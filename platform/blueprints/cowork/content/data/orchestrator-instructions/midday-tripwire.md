---
schema_version: "1.0.0"
purpose: |
  Canonical step-list for the cowork:midday-tripwire orchestrator. Single source
  of truth — short + punchy, fires only when tripwire_aspects trip (otherwise
  produces an "all clear" no-op).
cadence: midday-tripwire
warm_path_steps: 10
cold_path_skips: []
---

# cowork:midday-tripwire — orchestrator-instructions

> [!warning]+ CRITICAL: voice discipline (v0.96.0)
> Path, frontmatter type, and atomic-note body shape are enforced
> deterministically by `write-atomic-note-helper.js` + JSON-schema validation
> against `data/schemas/midday-tripwire@1.0.0.json`. They cannot drift.
>
> Voice IS a prose-level invariant the writer can't enforce. Apply
> `user-preferences.personality.notes` verbatim to every narrative sentence.
> Tripwire severity is unchanged: silent on green (no note written), writes
> only when at least one signal lands at warn or alert.

Real-time mid-day check for credit-card charges / calendar drift / queue growth
that violate the active payoff plan or stress signal, scoped to a single
engagement. Tone is short + punchy — only fires when tripwire_aspects trip
(otherwise produces a brief "all clear" no-op). Writes ONLY when severity is
`warn` or `alert`; on `green`, NO atomic note is written.

## Substitution tokens

| Token | Value |
| --- | --- |
| `{{$engagement_id}}` | required input — id of the engagement to check |
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
| `{{$cadence}}` | literal `midday-tripwire` |
| `{{$frontmatter_type}}` | `cowork-midday-tripwire` |
| `{{$title_template}}` | `Midday Tripwire - <weekday>, <month> <day>, <year>` |
| `{{$cadence_mode}}` | `warm` (no lens_shift variant for midday) |
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

### Step 0: Pre-flight (vault routing, engagement, tripwire_aspects gate)

0a. READ `<vault>/.claude/skills/cowork/skills/check-vault-routing/SKILL.md` in full and
    follow its `## Steps` section with `{ required: ["obsidian"] }`. If not `"ready"`,
    exit silently.

0b. Emit verbal commitment Notice:

   ```
   cowork:midday-tripwire committing to:
     VOICE: apply user-preferences.personality.notes verbatim AND personality.{vibe, formality, length, pep_talk}
   ```

   {{shared.connectivity_authority_clause}}

   {{shared.voice_clause}}

0c. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md`; look up
    `engagement` by `id == {{$engagement_id}}`. If not found, exit silently. Read
    engagement-type manifest at `spice/cowork/context/engagement-types/<engagement.type>.json`.
    Capture `render_aspects` AND `tripwire_aspects` (defaults to `[]` when field absent).
    If `tripwire_aspects.length == 0`, exit silently — tripwire is a no-op for this
    engagement.

0d. READ `<vault>/.claude/skills/cowork/skills/date-context/SKILL.md` in full and follow
    its `## Steps` section with `{}`. If `context.error`, exit silently.

### Step 1: Memory (today's ticks only)

1a. Invoke sub-skill `cowork:read-memory` with input
    `{ engagement_id: {{$engagement_id}}, tier: "tick", window: "today", limit_ticks: 4 }`.
    Capture `output_today`. Null-data preservation: `output_today = null` when no memory.

   Midday cadence does NOT surface yesterday (different cadence from morning briefing —
   short + punchy, focused on right-now tripwires).

### Step 2: Gather priority loop + per-aspect tripwire gathers

> **MANDATORY:** execute the priority loop for EVERY entry in `plan.dispatch_plan`.
> Memory ticks are SUPPLEMENTARY context for the synopsis section ONLY. When a kind's
> `action == "warn"`, emit the warning callout in-position via `composeWarningCallout`.

> **MANDATORY (v0.91.3): load deferred MCP tools UPFRONT** via ToolSearch before the
> priority loop.

2a. **Plan dispatch.** Capture `reachable_namespaces` + `tools_by_namespace`. READ
    `<vault>/.claude/skills/cowork/skills/plan-dispatch/SKILL.md` in full and follow its
    `## Steps` section with
    `{ engagement_id: {{$engagement_id}}, cadence: "midday", reachable_namespaces, tools_by_namespace, vault_root }`.
    Capture the 14-key `plan` result (including `plan.tripwire_aspects`).

2b. **Priority loop.** For each `entry` in `plan.dispatch_plan`, dispatch warn /
    gather_canonical / gather_from_served_by exactly as morning-briefing Step 2b. Push
    results into `ordered_blocks[]`.

2c. **Per-aspect tripwire gathers** (gated by `plan.tripwire_aspects`):
    - If `"cc_drift"` in `plan.tripwire_aspects`: READ
      `<vault>/.claude/skills/cowork/skills/gather-finance-cc-today/SKILL.md` with
      `{ engagement_id: {{$engagement_id}}, date_today: {{$today_date}}, lookback_start: "06:00", timezone: {{$timezone}}, classify: true, cards: { active, locked, ignore } }`.
      Capture `cc_signal`.
    - If `"calendar_drift"` in `plan.tripwire_aspects`: READ
      `<vault>/.claude/skills/cowork/skills/gather-calendar/SKILL.md` with
      `{ engagement_id: {{$engagement_id}}, mode: "drift-check", horizon: "today+4h", timezone: {{$timezone}} }`.
      Capture `calendar_signal`.
    - If `"queue_growth"` in `plan.tripwire_aspects`: READ
      `<vault>/.claude/skills/cowork/skills/gather-projects/SKILL.md` with
      `{ engagement_id: {{$engagement_id}}, mode: "tripwire-delta", since: <yesterday EOD ISO> }`.
      Capture `queue_signal`.

   NOTE: midday-tripwire does NOT run microscopes (short + punchy; no microscopes
   apply) and does NOT run semantic-related gather.

### Step 3: Compose body (decide severity → synopsis → per-kind → recalibration)

{{shared.voice_clause}}

3a. **Compute severity** from collected signals:
    - `alert` if any of: cc_signal contains a RED-class charge OR
      calendar_signal.drift_minutes >= 60 OR queue_signal.new_count >= 10.
    - `warn` if any of: cc_signal contains only YELLOW-class charges OR
      calendar_signal.drift_minutes in [30, 59] OR queue_signal.new_count in [3, 9].
    - `green` if none of the above → **EXIT SILENTLY**. Do NOT write a "nothing flagged"
      note (atomic-note absence = green; presence = something to flag).

3b. **Prep synopsis_md.** Compose `> [!info]- Midday status` callout per `prompt_body`
    (voice-shaped one-paragraph synopsis — tripwire signal + recalibration framing).

3c. **Prep closing_md.** Compose `> [!tip] Recalibration` callout (2-3 sentence
    recalibration paragraph + concrete first action).

3d. **Prep memory_callouts struct.**
    - `yesterday_md` ← `""` (midday does not surface yesterday)
    - `overnight_md` ← `composeMidamMemoryCallout(output_today)` ("Earlier today")
    - `echoes_md` ← `""`
    - `backlink_md` ← inline-composed per v0.85.0 § 2.1.3 spec.

3e. **Prep ordered_blocks[]** and **engagement_type_blocks[]** as morning-briefing 3e/3f.
    NOTE: midday-tripwire is NOT anti-echo-eligible (per v0.95.1 §3.4) so the
    anti-echo callout will not be emitted by composeBody regardless of
    `plan.excluded_themes`.

3f. **Invoke composeBody.** READ `<vault>/.claude/skills/cowork/skills/compose-body/SKILL.md`
    in full and follow its `## Compose` section with the full payload (cadence:
    `midday-tripwire`; frontmatter includes `severity: warn | alert`). Capture
    `{ body_md, sidecar_json, status }`. On `failed:*`, emit Notice and exit non-zero.

### Step 4: Rating callout (Rail L — idempotent re-fire)

4a. Compute `output_path = "spice/cowork/daily/{{$today_dirpath}}/midday-tripwire.md"`.
    If exists, parse prior `cowork:rating-block` sentinel via
    `parseRatingCallout(prior_md)`; preserve per-kind `[x]` state in
    `prior_rating_state`.

4b. Compute `surfaced_kinds_for_rating` from `ordered_blocks[]` per the same rule as
    morning-briefing Step 4b.

4c. composeBody emits the rating callout per `{{shared.rating_callout_template}}` when
    `learning_enabled !== false` AND `surfaced_kinds_for_rating.length > 0`.

### Step 5: Detection callout (Rail D — new-MCP surface)

5a. composeBody emits the detection callout per `{{shared.detection_callout_template}}`
    when `plan.pending_confirmations.length > 0` AND
    `plan.render_aspects.new_mcp_notice == "include"`.

### Step 6: Anti-echo callout — NOT eligible for midday-tripwire

(midday-tripwire is intentionally excluded from `ANTI_ECHO_ELIGIBLE_CADENCES` per
v0.95.1 §3.4. composeBody internally gates the anti-echo callout on cadence
eligibility; this step is a no-op for midday and exists in the step-list for
parity with other cadence files.)

### Step 7: Write .md via obsidian_put_content

7a. Apply `{{shared.frontmatter_base}}` substitution. Frontmatter requires the additional
    `severity: warn | alert` field for this cadence.

7b. {{shared.dataviewjs_block}} renders SpaceNavButtons block.

7c. READ `<vault>/.claude/skills/cowork/skills/write-run-note-midday-tripwire/SKILL.md`
    in full — paying particular attention to `## Title composition`,
    `## Adaptive body skeleton`, `## Pre-write self-check` — then perform the write
    described in its `## Steps` section with
    `{ engagement, date: {{$today_date}}, weekday: {{$today_weekday}}, month_name: {{$today_month_name}}, severity, signals: { cc: cc_signal, calendar: calendar_signal, queue: queue_signal }, body: body_md, sidecar_json, prompt_source: "spice/cowork/prompts/midday-tripwire.md", warning, warnings: warnings_array }`.
    Capture `status`. On `failed:contract-violation:<field>`, emit Notice and exit.

### Step 8: Write .cowork.json sidecar via obsidian_put_content (Rail S sidecar emit)

8a. Apply `{{shared.sidecar_schema_template}}` substitution. The sidecar mirrors `.md`
    frontmatter (including `severity:`) under `frontmatter:`.

8b. Write the sidecar to `spice/cowork/daily/{{$today_dirpath}}/midday-tripwire.cowork.json`
    via `mcp__obsidian__obsidian_put_content`. The `writeAtomicNote` helper invokes
    `validateSidecar` against `data/schemas/midday-tripwire@1.0.0.json` BEFORE
    committing either file. On `failed:contract-violation:sidecar-schema`, no files are
    written.

### Step 9: State updates

(midday-tripwire does NOT update active-threads or weekly-snapshot — those are
morning-pass and eod-pass concerns. Skip silently.)

### Step 10: Done notice

Emit Obsidian Notice `cowork:midday-tripwire complete -- {{$engagement_label}} {{$today_date}} (severity: <severity>)`.

## Harness testing

This orchestrator conforms to `Docs/agent-guides/cowork-orchestrator-template.md` (v1.0.0).
Cohesion regression caught by HC-V0950-COHESION-A1..A5. Single-source-of-truth regression
caught by HC-V0970-O-1..12.
