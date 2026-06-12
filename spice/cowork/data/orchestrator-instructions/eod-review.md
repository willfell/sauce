---
schema_version: "1.0.0"
purpose: |
  Canonical step-list for the cowork:eod-review orchestrator. Single source
  of truth — retrospective tone, what shipped + what's carrying forward.
cadence: eod-review
warm_path_steps: 10
cold_path_skips: []
---

{{shared.anti_delegation_clause}}

{{shared.prelude_block}}

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

0b. Emit verbal commitment Notice (v0.91.1 + v0.91.2):

   ```
   cowork:eod-review committing to:
     VOICE: apply user-preferences.personality.notes verbatim AND personality.{vibe, formality, length, pep_talk}
     MICROSCOPES: for each kind in prefs.priorities with a microscope at spice/cowork/prompts/per-mcp/<kind>/microscope.md, follow ## Output shape verbatim
   ```

   Two-purpose commitment: (1) commit voice so personality + voice contract
   land in body composition; (2) commit microscope adherence so each kind's
   callout follows its microscope's `## Output shape`. Deterministic backstops
   via the v0.96.0 Rail W writer + JSON-schema sidecar validation
   (path/frontmatter/dvjs/body-shape are enforced by `write-atomic-note-helper.js`
   against `data/schemas/eod-review@1.0.0.json`, so PATH + TYPE bullets
   retired). The v0.91.x–v0.92.0 write-guards remain as belt-and-suspenders.

   {{shared.connectivity_authority_clause}}

   {{shared.microscope_clause}}

   {{shared.voice_clause}}

0c. **Resolve engagement.** Look up `engagement` in vault-config; read engagement-type
    manifest at `spice/cowork/context/engagement-types/<engagement.type>.json`; capture
    `render_aspects`. On miss, exit silently / emit Notice.

0d. READ date-context SKILL.md. Capture `context` (today, tomorrow, daily_path,
    tomorrow_daily_path, tomorrow_weekday).

### Step 1: Memory (today's ticks + today's day-tier synthesis)

3a. **Read recent memory.** Invoke sub-skill `cowork:read-memory` with
    `{ engagement_id: {{$engagement_id}}, tier: "tick", window: "today" }`. Capture
    `output_today`.

1b. Invoke sub-skill `cowork:read-memory` with
    `{ engagement_id: {{$engagement_id}}, tier: "day", window: "today" }`. Capture
    `output_day` for the day-synthesis callout. (Step number 3a is the legacy alias
    for the 1a sub-step; v0.97.0 numbers it 1a in the re-flow.)

   Both invocations are PURE (no MCP calls, no writes).

### Step 2: Gather priority loop + per-aspect EOD gathers

> **MANDATORY:** When `plan.dispatch_mode == "prefs"`, execute the priority loop for
> EVERY entry in `plan.dispatch_plan`. Memory ticks are SUPPLEMENTARY context only;
> they DO NOT replace live MCP gather output. Failing to fire the priority loop
> means the dispatch contract's "Known people in scope" wikilink instruction never
> reaches the LLM, and inner-circle names render as plaintext instead of
> `**[[Name]]**` wikilinks. {{shared.microscope_clause}}

> **MANDATORY (v0.91.3): load deferred MCP tools UPFRONT** via ToolSearch.

PREFS UNAVAILABLE fallback (legacy mode): if `plan.dispatch_mode == "legacy"`, emit
Obsidian Notice `cowork:eod-review -- PREFS UNAVAILABLE (<plan.prefs_status>);
falling back to legacy mode. Chat and any custom kinds will NOT fire in legacy mode;
inner-circle wikilink emission will NOT occur. Investigate user-preferences.md if
this is unexpected.`

2a. **Plan dispatch.** Capture `reachable_namespaces` + `tools_by_namespace`. READ
    plan-dispatch SKILL.md with
    `{ engagement_id, cadence: "eod", reachable_namespaces, tools_by_namespace, vault_root }`.
    Capture the 14-key `plan`.

2b. **Priority loop.** Same shape as morning-briefing Step 2b — warn /
    gather_canonical / gather_from_served_by dispatch. Each gather_from_served_by call
    passes `siblings: plan.siblings[entry.kind_name] || []` AND
    `callout_type: prefs.mcps[entry.kind_name].callout_type`. Push results into
    `ordered_blocks[]`. `range = { start: context.today, end: context.today }` for
    served-by gathers.

2c. **Semantic related (semantic_related render-aspect gated).** (Legacy step
    alias: `9b. **Semantic related.**`.) When
    `plan.render_aspects.semantic_related == "include"`: READ gather-semantic-related
    SKILL.md with
    `{ mode: "find-related", anchor: context.daily_path, top_k: 5, callout_title: "Notes thematically close to today" }`.
    Capture `related_signal`. `semantic_index_age = related_signal.index_age_minutes`.

2d. **Morning followup.** Compose `morning_followup` summary by reading the matching
    `## Morning — <engagement.label>` block in today's daily note:
    `{ flagged_transactions, unanswered_messages, threads: { resolved, snoozed, still_open } }`.

### Step 3: Compose run-note body via cowork:compose-body (retrospective synopsis → day-pattern → per-kind → carry-forward)

{{shared.voice_clause}}

3a. **Prep synopsis_md.** Compose `> [!info]+ What landed today` callout per `prompt_body`
    instructions AND the § Synopsis composition rules below (voice-shaped one-paragraph
    synopsis distilled from gather outputs; ≤80 words; first-sentence-concrete;
    empty-day "Quiet day" fallback). When `semantic_index_age` is non-null, append
    `> Semantic index age: <age>m`.

3c. **Prep memory_callouts struct.**
    - `yesterday_md` ← `composeEodMemoryCallout(output_today, output_day).tickLogCalloutMd`
    - `overnight_md` ← `composeEodMemoryCallout(...).dayPatternCalloutMd` (the day-synthesis
      callout — MANDATORY memory tick at the body bottom per cadence tone)
    - `echoes_md` ← `composeSemanticEchoesCallout(output_echoes)` when applicable, else `""`
    - `backlink_md` ← inline-composed per v0.85.0 § 2.1.3 spec.

3d. **Prep ordered_blocks[]** and **engagement_type_blocks[]** — same shape as
    morning-briefing 3e/3f. For each `related_signal` in `related_signals[]` with
    `status == "ready"`: push `{ kind: "semantic", callout_type: "example", title: "Related to: <event.title>", body_md: <related_signal.markdown> }`.
    When `semantic_index_unavailable == true`: push ONCE
    `{ kind: "semantic-unavailable", callout_type: "warning", title: "Semantic index not available", body_md: "Smart Connections index absent or anchor not indexed — semantic gather skipped." }`.
    Step 2c sets `semantic_index_unavailable = true` when gather-semantic-related
    returns skipped-no-index for the day's anchors.

3e. **Invoke composeBody.** READ `<vault>/.claude/skills/cowork/skills/compose-body/SKILL.md`
    in full with full payload (cadence: `eod-review`; frontmatter type
    `cowork-eod-review`). Capture `{ body_md, sidecar_json, status }`. On
    `failed:*`, emit Notice and exit non-zero.

    **items[] contract (EOD only).** For each surfaced per-kind block in
    `ordered_blocks`, include an `items[]` array of `{id, label, text}` objects where:
    - `id` is the canonical identifier (channel:thread for chat, repo#PR for github, etc.)
    - `label` is the user-visible string for the Rail L wikilink target
    - `text` is the rendered line text (typically same as label)

    compose-body's per-kind callout assembly will append `^item-<kind>-<7hex>` block-ID
    anchors to each item line when `items[]` is present (deterministic SHA-1 hash of
    `<kind>:<id>` — see `compose-feedback-capture-helper.js`). Also compute
    `surfaced_items_by_kind` (a map of kind → items[]) and pass it alongside
    `ordered_blocks` in the composeBody payload — this is what drives the EOD Rail L
    feedback-capture dispatch in Step 4.

### Step 4: Feedback-capture callout (Rail L — v0.99.0 prose-first shape)

4a. Compute `output_path = "spice/cowork/daily/{{$today_dirpath}}/eod-review.md"`.
    Parse prior cowork:feedback-capture sentinel (v=1, v=2, or v=3) via `parseFeedbackCapture(prior_md)`
    when file exists; build `prior_feedback_state` map (per-item ticks, knob positions,
    free-text). If only the legacy `cowork:rating-block` sentinel exists (pre-v0.98.1
    EOD), start fresh — no migration of kind-level ticks to per-item ticks.

4b. Compute `surfaced_items_by_kind` (richer than `surfaced_kinds_for_rating` — per-kind
    list of items with their canonical identifiers for `^item-<kind>-<sha>` block-ID
    hashing). Passed as `input.surfaced_items_by_kind` to composeBody alongside the
    existing fields.

4c. composeBody emits the feedback-capture callout per `{{shared.feedback_capture_template}}`
    when cadence is `eod-review` AND `surfaced_items_by_kind` is non-empty. Behind the
    scenes: composeBody dispatches to `composeFeedbackCapture` (new helper) for EOD;
    the other 4 cadences continue using `composeRatingCallout` unchanged.

4d. v0.98.2 — the rail's per-kind sub-callouts carry TWO checklists sharing
    the same `^item-<kind>-<7hex>` IDs: `Mattered:` (this helped) and
    `Didn't like:` (surface less of this). composeFeedbackCapture emits the
    composeFeedbackCapture emits the `<!-- cowork:feedback-capture v=3 -->` sentinel; prior v=1 files parse
    with ticks preserved into Mattered and a fresh Didn't-like row. An item
    ticked in BOTH lists is contradictory: preserved in the UI, flagged in
    sidecar `feedback_capture.ambiguous_items[]`, ignored by the reconciler.
    v=3 renders the one-tap Useful line + the free-text fence ABOVE the per-kind blocks — prose is the primary channel; ticks are optional garnish.

### Step 5: Detection callout (Rail D — new-MCP surface)

5a. composeBody emits the detection callout per `{{shared.detection_callout_template}}`
    when `plan.pending_confirmations.length > 0` AND
    `plan.render_aspects.new_mcp_notice == "include"`.

### Step 6: Anti-echo callout (v0.95.1 Knob 1 — eligible for eod-review)

6a. composeBody emits the anti-echo callout per `{{shared.anti_echo_callout_template}}`
    when cadence `eod-review` is in `ANTI_ECHO_ELIGIBLE_CADENCES` AND
    `plan.excluded_themes.length > 0`.

### Step 7: Write .md via obsidian_put_content (INLINE CONTRACT — do not delegate)

7a. **Compute the EXACT output path** (no improvisation, no daily-note pattern):
    `spice/cowork/daily/{{$today_dirpath}}/{{$cadence}}.md`
    Example for 2026-06-10 eod-review: `spice/cowork/daily/2026/06-June/2026-06-10/eod-review.md`.
    DO NOT write to `spice/cowork/daily/2026/06-June/Tuesday-2026-06-10.md` or any other shape.

7b. **Emit the frontmatter as a literal YAML block** (this exact shape, no extra keys, no missing keys):

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

8a. Apply `{{shared.sidecar_schema_template}}` substitution.

8b. Write the sidecar to `spice/cowork/daily/{{$today_dirpath}}/eod-review.cowork.json`
    via `mcp__obsidian__obsidian_put_content`. `writeAtomicNote` invokes
    `validateSidecar` against `data/schemas/eod-review@1.0.0.json` BEFORE
    committing either file. On `failed:contract-violation:sidecar-schema`, no
    files are written.

8c. v0.98.2 — the sidecar `feedback_capture` field (schema 1.3.0) carries the
    identity registry `items[]: [{item_id, kind, identifier, label}]` from
    composeFeedbackCapture's `sidecar_observability`, plus
    `ambiguous_items[]`. This is the reconciler's per-item identity source —
    do NOT omit it.

### Step 8.5: Verify (sidecar schema validation backstop)

**Sidecar schema validation.** The write step's `writeAtomicNote` helper invokes
`validateSidecar` against the cadence schema BEFORE committing either file. If
the helper returned `failed:contract-violation:sidecar-schema`, no files were
written — emit Notice
`cowork:eod-review aborted -- contract-violation: <field>` and exit non-zero.
Do not run subsequent state-update steps.

The regex re-read pass from v0.91.3+v0.92.0 is RETIRED. Sidecar JSON-schema
validation subsumes it. v0.91.x–v0.92.0 path/frontmatter/dvjs write-guards
INSIDE write-run-note still fire as belt-and-suspenders before the
writeAtomicNote call.

**v0.97.4 prose-invariant write-guards.** Pass `surfaced_kinds_for_rating`
(from Step 4 rating-callout compute) + `learning_enabled` (engagement field) +
`expected_kinds` (= `plan.dispatch_plan.map(e => e.kind_name)`) into
`writeAtomicNote`. Guards fire deterministically:
`failed:contract-violation:missing-rating-callout` when body lacks the
`<!-- cowork:rating-block schema=` sentinel and rating gate is open;
`failed:contract-violation:missing-anti-echo-callout` when sidecar's
`render_aspects_applied` includes `anti_echo:include` but body lacks
`Outside yesterday's frame`. The coverage-gap injection (expected vs surfaced
kinds) is non-failing — visible warning callout + sidecar `coverage_gap`
field so reconcile-cowork can monitor cross-day.

### Step 9: State updates (active-threads, weekly-snapshot)

9a. READ update-active-threads SKILL.md with
    `{ engagement_id, phase: "eod-pass", date_today: {{$today_date}}, writer: "cowork:eod-review", changes: { resolved, snoozed_to_open, new_threads } }`.

9b. READ update-weekly-snapshot SKILL.md with
    `{ engagement_id, phase: "eod", date_today: {{$today_date}}, writer: "cowork:eod-review", snapshot_data: { completed_count, carryover_count, threads_resolved_today } }`.

### Step 10: Done notice

Emit Obsidian Notice `cowork:eod-review complete -- {{$engagement_label}} {{$today_date}}`.

## Prompt body fallback (v0.4.0 installer-default sentinel detection)

When reading `spice/cowork/prompts/eod-review.md` to populate `prompt_body`,
apply the v0.4.0 installer-default sentinel detection (v0.90.2):

- **v0.4.0 installer-default sentinel detection.** If `user_prompt_body`
  consists ONLY of the v0.4.0 installer-default content — recognizable by ALL
  of: (a) every non-blank line in the body starts with `> ` (one blockquote),
  (b) the first non-blank line starts with `> Vault-editable prompt for `,
  (c) the body contains the substring `Empty body is a no-op stub for now` —
  treat as if EMPTY and set `user_prompt_body = ""`. The sentinel means the
  user has never customized the prompt, functionally equivalent to empty.
- If `user_prompt_body` is empty, fall back to the engagement-template prompt at
  `spice/cowork/context/engagement-templates/<engagement.type>/prompts/eod-review.md`.

## Write phase (Memory log backlink contract)

The Write phase emits the atomic note + `.cowork.json` sidecar. The body composed
in Step 3 carries a Memory log backlink callout:

```
> [!quote]- Memory log
> Today's memory: [[spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<YYYY-MM-DD>/memory.md|Memory log — <YYYY-MM-DD>]]
```

## Harness testing

This orchestrator conforms to `Docs/agent-guides/cowork-orchestrator-template.md` (v1.0.0).
Cohesion regression caught by HC-V0950-COHESION-A1..A5. Single-source-of-truth regression
caught by HC-V0970-O-1..12.

{{shared.done_block}}

## Synopsis composition rules (v0.98.0 contract)

The synopsis is a single paragraph rendered inside a `> [!info]+ <cadence-title>` callout. The callout is OPEN by default; it is the reader's first stop and is expected to carry the load of the brief on its own.

Compose the paragraph per the following rules. Voice contract (vibe, personality, hard_rules) still applies on top of these rules; structural rules WIN on conflict.

  1. Length: ≤ 80 words. Hard cap. Prefer 50-60.
  2. First sentence names the highest-blocking action concretely — a PR number, a person + decision, an inbound + ask. Never opens with "Today is...", "You have...", "There are N...".
  3. Thread cross-kind dependencies as connective tissue when present (e.g. "...which gates today's 10am with Stefan..."). Don't enumerate per-kind ("first chat, then calendar, then..."); the reader can drill into each `[!info]-` / `[!tip]-` / `[!example]-` per-kind callout.
  4. Beyond the lead action, name at most 3 distinct must-knows. Order by blocking-effect, not by kind.
  5. If the day is genuinely quiet (no actionable items, no inbox debt, no blocking calendar conflicts), say so PLAINLY: "Quiet day — standup + Stefan 1:1, nothing else needs attention." Do not pad.
  6. Predict the next user action; do not describe the last LLM gather.

### Per-kind callout default-expand

Every per-kind callout (chat, calendar, email, github, ado, finance, any custom kind) renders with the `-` collapse sigil, NOT `+`. The `callout_type` field from user-preferences.md (one of `[!info]`, `[!tip]`, `[!quote]`, `[!note]`, `[!example]`, `[!warning]`) is followed by `-` (e.g. `> [!info]- Chat (Teams)`). The lead synopsis callout uses `+` (open by default — see § Synopsis composition rules above). The Memory log callout stays `-` (already collapsed). The `[!quote]` callout (Memory log) stays `-`. All per-kind callouts use `-`. No `+` per-kind callouts.
