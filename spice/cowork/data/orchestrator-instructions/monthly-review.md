---
schema_version: "1.0.0"
purpose: |
  Canonical step-list for the cowork:monthly-review orchestrator. Single source
  of truth — month-tier scope, output at spice/cowork/monthly/YYYY/YYYY-MM/.
cadence: monthly-review
warm_path_steps: 10
cold_path_skips: []
---

# cowork:monthly-review — orchestrator-instructions

> [!warning]+ CRITICAL: voice + microscope discipline (v0.96.0)
> Path, frontmatter type, and atomic-note body shape are enforced
> deterministically by `write-atomic-note-helper.js` + JSON-schema validation
> against `data/schemas/monthly-review@1.0.0.json`. They cannot drift.
>
> Voice + microscope adherence ARE prose-level invariants the writer can't
> enforce. Apply `user-preferences.personality.notes` verbatim. For each kind
> with a microscope, follow that microscope's `## Output shape` directives
> verbatim.

First-of-month deep pass for one engagement. Reviews the PREVIOUS month. Tone:
longest-arc view — month's wins/misses, projects landed, next-month board. Writes
ONE atomic note at `spice/cowork/monthly/<YYYY>/<YYYY-MM>/monthly-review.md` per
scheduled invocation. Frontmatter uses `month: "<YYYY-MM>"` instead of `day:`.
Anti-echo NOT eligible per v0.95.1 §3.4. For finance-tracking engagements, this
is the authoritative Credit Debt Payoff reconciliation moment.

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
| `{{$cadence}}` | literal `monthly-review` |
| `{{$frontmatter_type}}` | `cowork-monthly-review` |
| `{{$title_template}}` | `Monthly Review - <month> <year>` |
| `{{$cadence_mode}}` | `warm` (no lens_shift variant) |
| `{{$today_date}}` | fire-time — YYYY-MM-DD of the day the cron fires |
| `{{$today_weekday}}` | fire-time — long weekday name |
| `{{$today_month_name}}` | fire-time — long month name (target month — prev_month_name) |
| `{{$today_day}}` | fire-time — day-of-month integer |
| `{{$today_year}}` | fire-time — 4-digit year |
| `{{$today_dirpath}}` | fire-time — `<YYYY>/<YYYY-MM>` (month-tier directory) |
| `{{$today_ymd_compact}}` | fire-time — `YYYYMMDD` |
| `{{$rating_kind_lines}}` | computed-at-emit — `> - [ ] <Kind Title>` per surfaced kind |
| `{{$pending_confirmation_lines}}` | computed-at-emit — pending-MCP bullet lines |

## Steps

### Step 0: Pre-flight (vault routing, engagement, date context)

0a. READ check-vault-routing SKILL.md with `{ required: ["obsidian"] }`. On not-ready,
    emit Notice `cowork:monthly-review aborted -- <status>` and exit.

0b. Emit verbal commitment Notice (v0.91.1 + v0.91.2):

   ```
   cowork:monthly-review committing to:
     VOICE: apply user-preferences.personality.notes verbatim AND personality.{vibe, formality, length, pep_talk}
     MICROSCOPES: for each kind in prefs.priorities with a microscope at spice/cowork/prompts/per-mcp/<kind>/microscope.md, follow ## Output shape verbatim
   ```

   Two-purpose commitment: (1) commit voice so personality + voice contract
   land in body composition; (2) commit microscope adherence so each kind's
   callout follows its microscope's `## Output shape`. Deterministic backstops
   via the v0.96.0 Rail W writer + JSON-schema sidecar validation
   (path/frontmatter/dvjs/body-shape are enforced by `write-atomic-note-helper.js`
   against `data/schemas/monthly-review@1.0.0.json`, so PATH + TYPE bullets
   retired). The v0.91.x–v0.92.0 write-guards remain as belt-and-suspenders.

   {{shared.connectivity_authority_clause}}

   {{shared.microscope_clause}}

   {{shared.voice_clause}}

0c. **Resolve engagement.** Look up `engagement` in vault-config; read engagement-type
    manifest at `spice/cowork/context/engagement-types/<engagement.type>.json`; capture
    `render_aspects`.

0d. READ date-context SKILL.md. Capture `context` — critically `prev_month_start`,
    `prev_month_end`, `prev_month_label`, `prev_month_yyyymm`, `month_start`,
    `month_end`, `iso_month`, `year`, `next_month_start`, `next_month_end`.

### Step 1: Memory (month-tier — aggregated weekly syntheses)

3a. **Read recent memory.** Invoke sub-skill `cowork:read-memory` with
    `{ engagement_id: {{$engagement_id}}, tier: "week", window: { start: context.month_start, end: context.today } }`.
    Capture `output_month` — aggregated weekly syntheses across the current month.
    Null-data preservation: `output_month = null`. (Step number 3a is the legacy
    alias; v0.97.0 numbers it 1a in the re-flow.)

   This step is PURE (no MCP calls, no writes).

### Step 2: Gather priority loop + month-summary gathers

> **MANDATORY:** When `plan.dispatch_mode == "prefs"`, execute the priority loop for
> EVERY entry in `plan.dispatch_plan`. Memory ticks are SUPPLEMENTARY context only;
> they DO NOT replace live MCP gather output. Failing to fire the priority loop
> means the dispatch contract's "Known people in scope" wikilink instruction never
> reaches the LLM, and inner-circle names render as plaintext instead of
> `**[[Name]]**` wikilinks. {{shared.microscope_clause}}

> **MANDATORY (v0.91.3): load deferred MCP tools UPFRONT** via ToolSearch.

PREFS UNAVAILABLE fallback (legacy mode): if `plan.dispatch_mode == "legacy"`, emit
Obsidian Notice `cowork:monthly-review -- PREFS UNAVAILABLE (<plan.prefs_status>);
falling back to legacy mode. Chat and any custom kinds will NOT fire in legacy mode;
inner-circle wikilink emission will NOT occur. Investigate user-preferences.md if
this is unexpected.`

2a. **Plan dispatch.** Capture `reachable_namespaces` + `tools_by_namespace`. READ
    plan-dispatch SKILL.md with
    `{ engagement_id, cadence: "monthly", reachable_namespaces, tools_by_namespace, vault_root }`.
    Each `gather-from-served-by` invocation passes
    `range: { start: context.month_start, end: context.month_end }`.

2b. **Priority loop.** Same shape as morning-briefing Step 2b — warn /
    gather_canonical / gather_from_served_by dispatch. Each gather_from_served_by call
    passes `siblings: plan.siblings[entry.kind_name] || []` AND
    `callout_type: prefs.mcps[entry.kind_name].callout_type`. Push results into
    `ordered_blocks[]`.

2c. **Forward-look stressors (inline scan).** Scan `spice/trips/` (next 30-45 days),
    `spice/finance/budgets/` (annual bills next month), explicit "planned purchase"
    notes. Assemble the Forward look list. (Currently inline; planned
    `cowork:gather-forward-stressors` sub-skill carry.)

2d. **Invoice prep / FTE status** (engagement-type-gated). When
    `plan.render_aspects.invoice_prep == "include"` AND
    `engagement.invoice_cadence == "monthly"`: READ write-summary-invoice-prep SKILL.md
    with `{ engagement, date_today: context.today, mode: "monthly", month_range }`.
    Capture `invoice_block`. When
    `plan.render_aspects.invoice_prep == "skip"` AND `engagement.type == "w2-fte"`:
    READ write-summary-fte-status SKILL.md with mode `"monthly"`; capture
    `fte_status_block`.

### Step 3: Compose run-note body via cowork:compose-body (month-tier synopsis → month-pattern → per-kind → next-month board)

{{shared.voice_clause}}

3a. **Prep synopsis_md.** Compose `> [!info]- Month in review` callout per
    `prompt_body` (voice-shaped one-paragraph synopsis distilled from month-summary
    gather outputs). When `semantic_index_age` is non-null, append
    `> Semantic index age: <age>m`.

3b. **Prep closing_md.** Compose `> [!tip] Next month's board` callout (2-3 sentence
    next-month board paragraph + concrete first action).

3c. **Prep memory_callouts struct.**
    - `yesterday_md` ← `composeMonthlyMemoryCallout(output_month)` ("This month's
      pattern" — aggregates up to 4 weekly syntheses); `""` when empty.
    - `overnight_md` ← `""` (monthly cadence does not surface overnight)
    - `echoes_md` ← `composeSemanticEchoesCallout(output_echoes)` when applicable.
    - `backlink_md` ← monthly-memory path:
      `"> [!quote]- Memory log\n> This month's memory: [[spice/cowork/memory/<engagement_id>/monthly/<YYYY>/<YYYY-MM>/memory.md|Memory log — <YYYY-MM>]]"`.

3d. **Prep ordered_blocks[]** and **engagement_type_blocks[]** — same shape as
    morning-briefing 3e/3f.

3e. **Invoke composeBody.** READ `<vault>/.claude/skills/cowork/skills/compose-body/SKILL.md`
    in full with the full payload (cadence: `monthly-review`; frontmatter
    `type: cowork-monthly-review` AND `month: context.iso_month`). Capture
    `{ body_md, sidecar_json, status }`. On `failed:*`, emit Notice and exit
    non-zero.

### Step 4: Rating callout (Rail L — idempotent re-fire)

4a. Compute `output_path = "spice/cowork/monthly/{{$today_dirpath}}/monthly-review.md"`.
    Parse prior `cowork:rating-block` sentinel via `parseRatingCallout(prior_md)` when
    file exists.

4b. Compute `surfaced_kinds_for_rating` per the same rule as other cadences.

4c. composeBody emits the rating callout per `{{shared.rating_callout_template}}` when
    eligible. (Monthly is eligible for rating callouts — only anti-echo is excluded
    at month-tier.)

### Step 5: Detection callout (Rail D — new-MCP surface)

5a. composeBody emits the detection callout per `{{shared.detection_callout_template}}`
    when `plan.pending_confirmations.length > 0` AND
    `plan.render_aspects.new_mcp_notice == "include"`.

### Step 6: Anti-echo callout — NOT eligible for monthly-review

(monthly-review is intentionally excluded from `ANTI_ECHO_ELIGIBLE_CADENCES` per
v0.95.1 §3.4. composeBody internally gates on cadence eligibility; this step is a
no-op for monthly and exists in the step-list for parity with other cadence files.)

### Step 7: Write .md via obsidian_put_content (INLINE CONTRACT — do not delegate)

7a. **Compute the EXACT output path** (no improvisation, no daily-note pattern):
    `spice/cowork/daily/{{$today_dirpath}}/{{$cadence}}.md`
    Example for 2026-06-10 monthly-review: `spice/cowork/daily/2026/06-June/2026-06-10/monthly-review.md`.
    DO NOT write to `spice/cowork/daily/2026/06-June/Tuesday-2026-06-10.md` or any other shape.

7b. **Emit the frontmatter as a literal YAML block** (this exact shape, no extra keys, no missing keys; for monthly, `day:` is the month-anchor day and there is NO `month:` key in this writer contract):

    ```yaml
    ---
    type: {{$frontmatter_type}}
    engagement_id: {{$engagement_id}}
    day: "{{$today_date}}"
    generator: cowork:{{$cadence}}@2.0.0
    prompt_source: spice/cowork/prompts/{{$cadence}}.md
    title: {{$title_template_resolved}}
    summary: <1-2 sentence headline distilled from the body>
    created_at: <NOW in {{$timezone}} as ISO 8601 timestamp with offset>
    ---
    ```

    FORBIDDEN frontmatter keys: `cadence`, `date`, `engagement` (NOT engagement_id), `generated_at`, `week`, `month`, `year`, `schema_version`.

7c. **Emit the DataviewJS block** as the literal first body content under the frontmatter:

    ```dataviewjs
    await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
    ```

7d. **Body skeleton** — the body that follows the DataviewJS block MUST be the composed
    `body_md` from Step 3 (composeBody output). Every per-kind block MUST render as a
    Callout (`> [!example]+`, `> [!warning]+`, `> [!info]+`, `> [!quote]+`, `> [!tip]`,
    `> [!todo]+`, `> [!question]+`) — NEVER as plain `## Heading` sections. Plain
    headings indicate delegation occurred; abort the write and emit a Notice.

7e. **Write via Obsidian MCP** — call `mcp__<vault>-obsidian__obsidian_put_content` with
    `{ filepath: <step 7a path>, content: <frontmatter + dataviewjs + body_md> }`. On any
    error from the MCP call, emit Notice
    `cowork:{{$cadence}} aborted -- write failed: <error>` and exit non-zero. Do NOT
    fall back to writing at a different path.

### Step 8: Write .cowork.json sidecar via obsidian_put_content (Rail S sidecar emit)

8a. Apply `{{shared.sidecar_schema_template}}` substitution. Frontmatter mirror includes
    `month:` instead of `day:`.

8b. Write the sidecar to
    `spice/cowork/monthly/{{$today_dirpath}}/monthly-review.cowork.json` via
    `mcp__obsidian__obsidian_put_content`. `writeAtomicNote` invokes `validateSidecar`
    against `data/schemas/monthly-review@1.0.0.json` BEFORE committing either file. On
    `failed:contract-violation:sidecar-schema`, no files are written.

### Step 8.5: Verify (sidecar schema validation backstop)

**Sidecar schema validation.** The write step's `writeAtomicNote` helper invokes
`validateSidecar` against the cadence schema BEFORE committing either file. If
the helper returned `failed:contract-violation:sidecar-schema`, no files were
written — emit Notice
`cowork:monthly-review aborted -- contract-violation: <field>` and exit
non-zero. Do not run subsequent state-update steps.

The regex re-read pass from v0.91.3+v0.92.0 is RETIRED. Sidecar JSON-schema
validation subsumes it. v0.91.x–v0.92.0 path/frontmatter/dvjs write-guards
INSIDE write-run-note still fire as belt-and-suspenders before the
writeAtomicNote call.

### Step 9: State updates (active-threads, weekly-snapshot)

9a. READ update-active-threads SKILL.md with
    `{ engagement_id, phase: "monthly-refresh", date_today: context.today, writer: "cowork:monthly-review", changes: { archive_resolved_older_than_days: 14, audit_full: true, financial_state_refresh } }`.

9b. READ update-weekly-snapshot SKILL.md with
    `{ engagement_id, phase: "monthly-reset", date_today: context.today, writer: "cowork:monthly-review", snapshot_data: { archive_previous_month: true, prev_month_yyyymm: context.prev_month_yyyymm } }`.

### Step 10: Done notice

Emit Obsidian Notice `cowork:monthly-review complete -- {{$engagement_label}} <prev_month_label>`.

## Prompt body fallback (v0.4.0 installer-default sentinel detection)

When reading `spice/cowork/prompts/monthly-review.md` to populate `prompt_body`,
apply the v0.4.0 installer-default sentinel detection (v0.90.2):

- **v0.4.0 installer-default sentinel detection.** If `user_prompt_body`
  consists ONLY of the v0.4.0 installer-default content — recognizable by ALL
  of: (a) every non-blank line in the body starts with `> ` (one blockquote),
  (b) the first non-blank line starts with `> Vault-editable prompt for `,
  (c) the body contains the substring `Empty body is a no-op stub for now` —
  treat as if EMPTY and set `user_prompt_body = ""`. The sentinel means the
  user has never customized the prompt, functionally equivalent to empty.
- If `user_prompt_body` is empty, fall back to the engagement-template prompt at
  `spice/cowork/context/engagement-templates/<engagement.type>/prompts/monthly-review.md`.

## Harness testing

This orchestrator conforms to `Docs/agent-guides/cowork-orchestrator-template.md` (v1.0.0).
Cohesion regression caught by HC-V0950-COHESION-A1..A5. Single-source-of-truth regression
caught by HC-V0970-O-1..12.
