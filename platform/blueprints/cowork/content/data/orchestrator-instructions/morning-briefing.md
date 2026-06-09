---
schema_version: "1.0.0"
purpose: |
  Canonical step-list for the cowork:morning-briefing orchestrator. Read by the
  SKILL.md shim (local CLI) AND by the wrapper template that claude.ai's Cowork
  UI runs (composed by cowork:sync-scheduled-jobs). Single source of truth for
  the morning-briefing cadence.
cadence: morning-briefing
warm_path_steps: 10
cold_path_skips: [step_1_memory, step_2c_semantic_gather]
---

# cowork:morning-briefing — orchestrator-instructions

> [!warning]+ CRITICAL: voice + microscope discipline (v0.96.0)
> Path, frontmatter type, and atomic-note body shape are enforced
> deterministically by `write-atomic-note-helper.js` + JSON-schema
> validation against `data/schemas/morning-briefing@1.0.0.json`. They cannot drift.
>
> Voice + microscope adherence ARE prose-level invariants the writer can't
> enforce. Apply `user-preferences.personality.notes` verbatim to every
> narrative sentence. For each kind in `priorities` with a microscope at
> `spice/cowork/prompts/per-mcp/<kind>/microscope.md`, follow that
> microscope's `## Output shape` directives verbatim.

Composes a morning briefing for one engagement (calendar + email + optional
Finance + optional Messages + Open Threads) and writes ONE atomic note at
`spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/morning-briefing.md`
(deterministic path per `(orchestrator, day)`; overwrite-last-write-wins
idempotency). Body shape follows `spice/cowork/prompts/morning-briefing.md`;
when the prompt body is empty, emits a no-op note with `warning: empty_prompt`.

## Substitution tokens

| Token | Value |
| --- | --- |
| `{{$engagement_id}}` | required input — id of the engagement to brief |
| `{{$engagement_label}}` | friendly label for the engagement (from vault-config) |
| `{{$timezone}}` | engagement's IANA timezone (default `America/Denver`) |
| `{{$voice_notes}}` | user-preferences.personality.notes verbatim |
| `{{$voice_summary}}` | one-line condensed restatement of voice contract |
| `{{$priorities}}` | per-engagement priorities array (drives plan dispatch) |
| `{{$mcp_dispatch_lines}}` | per-kind dispatch lines composed from plan |
| `{{$inner_circle}}` | resolved inner-circle allowlist (names + handles) |
| `{{$workshop_version}}` | sauce workshop semver at compose time |
| `{{$cowork_version}}` | cowork blueprint semver at compose time |
| `{{$contract_version}}` | scheduled-job-contract.json contract_version |
| `{{$cadence}}` | literal `morning-briefing` |
| `{{$cadence_mode}}` | `warm` (default) or `lens_shift` (cold variant) |
| `{{$frontmatter_type}}` | `cowork-morning-briefing` (warm) or `cowork-morning-briefing-cold` (lens_shift) |
| `{{$title_template}}` | `Morning Briefing - <weekday>, <month> <day>, <year>` |
| `{{$today_date}}` | fire-time — current date in engagement tz as YYYY-MM-DD |
| `{{$today_weekday}}` | fire-time — long weekday name (Friday) |
| `{{$today_month_name}}` | fire-time — long month name (June) |
| `{{$today_day}}` | fire-time — day-of-month integer (9) |
| `{{$today_year}}` | fire-time — 4-digit year (2026) |
| `{{$today_dirpath}}` | fire-time — `<YYYY>/<MM-MMMM>/<YYYY-MM-DD>` directory path |
| `{{$today_ymd_compact}}` | fire-time — `YYYYMMDD` compact form |
| `{{$rating_kind_lines}}` | computed-at-emit — `> - [ ] <Kind Title>` lines per surfaced kind |
| `{{$pending_confirmation_lines}}` | computed-at-emit — pending-MCP detection bullet lines |

## Steps

### Step 0: Pre-flight (vault routing, user-prefs, inner-circle aliases)

0a. READ `<vault>/.claude/skills/cowork/skills/check-vault-routing/SKILL.md` in full and
    follow its `## Steps` section with `{ required: ["obsidian"] }`. If the return is not
    `"ready"`, emit Notice `cowork:morning-briefing aborted -- <status>` and exit.

0b. Emit verbal commitment Notice (v0.91.1 + v0.91.2):

   ```
   cowork:morning-briefing committing to:
     VOICE: apply user-preferences.personality.notes verbatim AND personality.{vibe, formality, length, pep_talk}
     MICROSCOPES: for each kind in prefs.priorities with a microscope at spice/cowork/prompts/per-mcp/<kind>/microscope.md, follow ## Output shape verbatim
   ```

   Two-purpose commitment: (1) commit voice so personality + voice contract
   land in body composition; (2) commit microscope adherence so each kind's
   callout follows its microscope's `## Output shape`. Deterministic backstops
   via the v0.96.0 Rail W writer + JSON-schema sidecar validation
   (path/frontmatter/dvjs/body-shape are enforced by `write-atomic-note-helper.js`
   against `data/schemas/morning-briefing@1.0.0.json`, so PATH + TYPE bullets
   retired). The v0.91.x–v0.92.0 write-guards remain as belt-and-suspenders.

   {{shared.connectivity_authority_clause}}

   {{shared.microscope_clause}}

   {{shared.voice_clause}}

0c. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md` via
    `mcp__obsidian__get_frontmatter`. Look up `engagements[]` entry where `id == {{$engagement_id}}`.
    If not found, emit Notice and exit. Capture `engagement` (full record); read engagement-type
    manifest at `spice/cowork/context/engagement-types/<engagement.type>.json` (expected:
    `personal` | `w2-fte` | `consulting`). Parse JSON; capture `type_manifest.render_aspects`.

0d. READ `<vault>/.claude/skills/cowork/skills/date-context/SKILL.md` in full and follow its
    `## Steps` section with `{}`. Capture the returned `context` object. If `context.error`
    exists, emit Notice and exit. Tokens `{{$today_date}}` / `{{$today_weekday}}` /
    `{{$today_month_name}}` / `{{$today_day}}` / `{{$today_year}}` resolve from `context`.

### Step 1: Memory (yesterday + overnight ticks + drift_warning)

{{#if cadence_mode == "lens_shift"}}
LENS_SHIFT COLD MODE: skip Step 1 entirely. Set `output_yesterday = null` and
`output_overnight = null` so downstream composition treats this as
"no memory available". The cold variant emits NO `[!example]+ Yesterday at a glance`
callout and NO drift_warning injection.
{{else}}
1a. Invoke sub-skill `cowork:read-memory` with input
    `{ engagement_id: {{$engagement_id}}, tier: "day", window: "yesterday" }`. Capture
    `output_yesterday`. The sub-skill returns null-data when no memory file exists —
    preserve as `output_yesterday = null`.

1b. Invoke sub-skill `cowork:read-memory` with input
    `{ engagement_id: {{$engagement_id}}, tier: "tick", window: "today", limit_ticks: 6 }`.
    Capture `output_overnight`. Same null-data preservation.

   Both invocations are PURE (no MCP calls, no writes). Drift warning surfaces via the
   v0.95.1 read-memory extension: when non-null, inject the
   `[!warning]- Frame may be stuck` callout body into the Yesterday-at-a-glance prose
   at compose time (see Step 3).
{{/if}}

### Step 2: Gather priority loop (per-kind MCP calls, microscope adherence)

> **MANDATORY:** When `plan.dispatch_mode == "prefs"`, execute the priority loop for
> EVERY entry in `plan.dispatch_plan`. Do NOT skip the loop in favor of memory-tick
> synthesis. Memory ticks are SUPPLEMENTARY context for the `[!info]- Today at a glance`
> synopsis section; they DO NOT replace live MCP gather output. When a kind's
> `action == "warn"`, emit the warning callout in-position via `composeWarningCallout`.
> Failing to fire the priority loop means the dispatch contract's "Known people in
> scope" wikilink instruction never reaches the LLM, and inner-circle names render
> as plaintext instead of `**[[Name]]**` wikilinks. {{shared.microscope_clause}}

PREFS UNAVAILABLE fallback (legacy mode): if `plan.dispatch_mode == "legacy"`, emit
Obsidian Notice `cowork:morning-briefing -- PREFS UNAVAILABLE (<plan.prefs_status>);
falling back to legacy mode. Chat and any custom kinds will NOT fire in legacy mode;
inner-circle wikilink emission will NOT occur. Investigate user-preferences.md if
this is unexpected.` The legacy gather sequence still fires; `ordered_blocks[]` stays
empty.

> **MANDATORY (v0.91.3): load deferred MCP tools UPFRONT.** Before the priority loop,
> for each kind in `plan.dispatch_plan` with `action == "gather_from_served_by"` or
> `action == "gather_canonical"`, load the required deferred tools from the kind's
> `served_by` namespace via ToolSearch.

2a. **Plan dispatch.** Capture `reachable_namespaces` + `tools_by_namespace` from the
    agent's tool list. READ `<vault>/.claude/skills/cowork/skills/plan-dispatch/SKILL.md`
    in full and follow its `## Steps` section with
    `{ engagement_id: {{$engagement_id}}, cadence: "morning", reachable_namespaces, tools_by_namespace, vault_root }`.
    Capture the 14-key result as `plan` (v0.96.0 adds `pending_confirmations[]` as the
    14th key, surfaced from Rail D's kind classifier).

2b. **Priority loop.** For each `entry` in `plan.dispatch_plan`:

    - `entry.action == "warn"` → push `composeWarningCallout({...})` into `ordered_blocks[]`
      with `kind: "warning"`.
    - `entry.action == "gather_canonical"` → READ the kind's canonical gather sub-skill at
      `<vault>/.claude/skills/cowork/skills/<entry.gather_skill-after-cowork-prefix>/SKILL.md`
      with the kind's canonical input shape (calendar / email / messages / threads /
      projects / finance).
    - `entry.action == "gather_from_served_by"` → READ
      `<vault>/.claude/skills/cowork/skills/gather-from-served-by/SKILL.md` with
      `{ kind_name, kind_title, served_by, what_matters, question_set_answers, hard_rules: plan.effective_hard_rules, siblings: plan.siblings[entry.kind_name] || [], callout_type: prefs.mcps[entry.kind_name].callout_type, inner_circle_resolved: plan.allowlist.resolved, engagement_id: {{$engagement_id}}, today: {{$today_date}}, range: { start, end }, timezone: {{$timezone}} }`.

{{#if cadence_mode == "lens_shift"}}
2c. SKIP semantic-related gather in lens_shift cold mode. Set `output_echoes = null`.
{{else}}
2c. **Semantic related (semantic_related render-aspect gated).** (Legacy step
    aliases: `3a.5. **Gather semantic echoes.**` and `12b. **Semantic related.**`.)
    Compose `anchor_text` from `plan.dispatch_plan` kind-name summary + today's
    `calendar_summary` + `email_summary` (≤500 chars; " · " separator). When all
    empty, skip and set `output_echoes = null`. Else invoke sub-skill
    `cowork:gather-semantic-memory` with
    `{ engagement_id: {{$engagement_id}}, anchor_text, top_k: 2, exclude_window: "last-30d", min_similarity: 0.45 }`.
    Capture `output_echoes`. When `plan.render_aspects.semantic_related == "include"`
    AND calendar events present, also fan out per-event `gather-semantic-related` calls
    (capped at 5 events; first 5 events only) to collect `related_signals[]`.
{{/if}}

### Step 3: Compose run-note body via cowork:compose-body (synopsis → yesterday-at-a-glance → per-kind → engagement-type → closing tip)

{{shared.voice_clause}}

3a. **Prep synopsis_md.** Compose the `> [!info]- Today at a glance` callout per
    `prompt_body` instructions (voice-shaped one-paragraph synopsis distilled from gather
    outputs). When `semantic_index_age` is non-null, append `> Semantic index age: <age>m`
    as the last `> ` line inside the synopsis callout. Empty-prompt stub case:
    `synopsis_md = "> [!info]- Today at a glance\n> (Prompt body empty — edit spice/cowork/prompts/morning-briefing.md to customize what this run emits.)"`.

3b. **Prep closing_md.** Compose the `> [!tip] Today's focus` callout per `prompt_body`
    instructions (2-3 sentence focus paragraph + concrete first action). Empty-prompt
    stub: `closing_md = "> [!tip] Today's focus\n> Edit \`spice/cowork/prompts/morning-briefing.md\` to define what this scheduled job should emit when it fires."`.

3c. **Prep memory_callouts struct.** Use existing helpers:
    - `yesterday_md` ← `composeMemoryCallouts(output_yesterday, output_overnight).yesterdayCalloutMd`
    - `overnight_md` ← `composeMemoryCallouts(...).overnightCalloutMd`
    - `echoes_md` ← `composeSemanticEchoesCallout(output_echoes)`
    - `backlink_md` ← inline-composed per v0.85.0 § 2.1.3 spec:
      `"> [!quote]- Memory log\n> Today's memory: [[spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<YYYY-MM-DD>/memory.md|Memory log — <YYYY-MM-DD>]]"`
      (tick-count parenthetical omitted when unknown).

3d. **v0.95.1 Knob-2 — inject `drift_warning` into Yesterday-at-a-glance.** When
    `output_yesterday.day_synthesis.drift_warning` is non-null AND `yesterday_md != ""`,
    append `> **Drift flag from yesterday:** <drift_warning text>` just before the
    trailing blank line. Apply voice contract from `plan.voice_contract`.

3e. **Prep ordered_blocks[]** for composeBody — iterate gather-pipeline outputs from
    Step 2b. Each carries `{ kind, callout_type, markdown }`. Add `title` from
    `plan.kind_titles[entry.kind_name]`. Translate to composeBody shape:
    `{ kind, callout_type, title, body_md: markdown }`.

3f. **Prep engagement_type_blocks[]** — push `{ kind: "semantic", callout_type: "example", title: "Related to: <event.title>", body_md: <related_signal.markdown> }`
    per ready signal. When `semantic_index_unavailable == true`: push ONCE
    `{ kind: "semantic-unavailable", callout_type: "warning", title: "Semantic index not available", body_md: "Smart Connections index absent or anchor not indexed — semantic gather skipped." }`.
    Step 2c sets `semantic_index_unavailable = true` when gather-semantic-related returns
    skipped-no-index (first 5 events only — semantic fan-out capped). Finance does NOT
    flow through here — it's written by Step 15's separate sub-skill.

3g. **Invoke composeBody.** READ `<vault>/.claude/skills/cowork/skills/compose-body/SKILL.md`
    in full and follow its `## Compose` section with the full payload (frontmatter +
    nav_buttons_block + synopsis_md + memory_callouts + ordered_blocks +
    engagement_type_blocks + closing_md + excluded_themes + pending_confirmations +
    render_aspects + voice_contract + render_aspects_applied + memory_used + plan_dispatch +
    learning_enabled + surfaced_kinds_for_rating + prior_rating_state + day). Capture
    `{ body_md, sidecar_json, status }`.

3h. **Compose failure handling.** If `status` starts with `"failed:"`, emit Notice
    `cowork:morning-briefing aborted -- compose-body failure: <status>` and exit non-zero.

### Step 4: Rating callout (Rail L — idempotent re-fire)

4a. Compute `output_path = "spice/cowork/daily/{{$today_dirpath}}/morning-briefing.md"`.
    If the file already exists on disk (same-day re-fire), READ it via the Read tool and
    invoke `parseRatingCallout(prior_md)` from
    `platform/blueprints/cowork/helpers/learn-from-checks-helper.js`. Build
    `prior_rating_state = { <kind>: <ticked-bool>, ... }` from `observations`. Else
    `prior_rating_state = null`.

4b. Compute `surfaced_kinds_for_rating` from `ordered_blocks[]` — array of kind names
    (lowercase) for entries with non-empty `markdown` AND `kind not in ("semantic", "semantic-unavailable")`.
    Preserve `ordered_blocks[]` order so the rendered checklist matches the body's
    surfaced order.

4c. composeBody (Step 3g) emits the rating callout per `{{shared.rating_callout_template}}`
    when `learning_enabled !== false` AND `surfaced_kinds_for_rating.length > 0`. The
    sentinel `cowork:rating-block` line encodes `schema_version=1.0.0`, `cadence`, `day`
    for round-trip parsing on the next fire.

### Step 5: Detection callout (Rail D — new-MCP surface)

5a. composeBody (Step 3g) emits the detection callout per `{{shared.detection_callout_template}}`
    when `plan.pending_confirmations.length > 0` AND
    `plan.render_aspects.new_mcp_notice == "include"`. The callout invites the user to
    edit `spice/cowork/context/user-preferences.md` or re-run `/cowork context-builder`.

### Step 6: Anti-echo callout (v0.95.1 Knob 1 — eligible for morning-briefing)

6a. composeBody (Step 3g) emits the anti-echo callout per `{{shared.anti_echo_callout_template}}`
    when cadence `morning-briefing` is in `ANTI_ECHO_ELIGIBLE_CADENCES` AND
    `plan.excluded_themes.length > 0`. It names ONE thing from today's gather that
    yesterday's carry-forward did NOT name; falls back to the explicit-null sentence
    when nothing qualifies.

### Step 7: Write .md via obsidian_put_content

7a. Apply `{{shared.frontmatter_base}}` substitution (token: `{{$frontmatter_type}}` =
    `cowork-morning-briefing` warm OR `cowork-morning-briefing-cold` lens_shift; slug
    `morning-briefing.md` warm OR `morning-briefing-cold-{{$engagement_id}}.md` lens_shift).

7b. {{shared.dataviewjs_block}} renders the SpaceNavButtons block at the top of the body
    via the customjs-guard view (write-atomic-note-helper.js prepends this block before
    persisting).

7c. READ `<vault>/.claude/skills/cowork/skills/write-run-note-morning-briefing/SKILL.md`
    in full — paying particular attention to its `## Title composition`,
    `## Adaptive body skeleton`, and `## Pre-write self-check` sections — then apply
    those contracts before performing the write described in its `## Steps` section with
    `{ engagement, date: {{$today_date}}, weekday: {{$today_weekday}}, month_name: {{$today_month_name}}, body: body_md, sidecar_json: sidecar_json, prompt_source: "spice/cowork/prompts/morning-briefing.md", warning }`.
    Capture `status`. On `failed:contract-violation:<field>`, emit Notice and exit
    non-zero. On other `failed:*`, emit Notice and exit. Do not run state-update steps
    after a failed write.

### Step 8: Write .cowork.json sidecar via obsidian_put_content (Rail S sidecar emit)

8a. Apply `{{shared.sidecar_schema_template}}` substitution. The sidecar JSON mirrors the
    `.md` frontmatter exactly under `frontmatter:`, lists every surfaced kind under
    `surfaced_kinds[]`, and emits per-item `{ item_id, kind, callout_type, title, features }`
    rows under `surfaced_items[]`. `item_id` is `<kind>-{{$engagement_id}}-<sha256(stable_key).slice(0,16)>`.

8b. Write the sidecar to `spice/cowork/daily/{{$today_dirpath}}/morning-briefing.cowork.json`
    via `mcp__obsidian__obsidian_put_content` (Step 8 is the canonical sidecar emit
    position — `check-heartbeat` detects this fire via sidecar presence). The
    `writeAtomicNote` helper invokes `validateSidecar` against
    `data/schemas/morning-briefing@1.0.0.json` BEFORE committing either file. On
    `failed:contract-violation:sidecar-schema`, no files are written — emit Notice
    `cowork:morning-briefing aborted -- contract-violation: <field>` and exit non-zero.

### Step 8.5: Verify (sidecar schema validation backstop)

**Sidecar schema validation.** The write step's `writeAtomicNote` helper invokes
`validateSidecar` against the cadence schema BEFORE committing either file. If
the helper returned `failed:contract-violation:sidecar-schema`, no files were
written — emit Notice
`cowork:morning-briefing aborted -- contract-violation: <field>` (where
`<field>` is the JSON-Schema validator's first reported error) and exit
non-zero. Do not run subsequent state-update steps.

The regex re-read pass from v0.91.3+v0.92.0 is RETIRED. Sidecar JSON-schema
validation subsumes it. v0.91.x–v0.92.0 path/frontmatter/dvjs write-guards
INSIDE write-run-note still fire as belt-and-suspenders before the
writeAtomicNote call.

### Step 9: State updates (active-threads, weekly-snapshot)

9a. READ `<vault>/.claude/skills/cowork/skills/update-active-threads/SKILL.md` in full
    and follow its `## Steps` section with
    `{ engagement_id: {{$engagement_id}}, phase: "morning-pass", date_today: {{$today_date}}, writer: "cowork:morning-briefing", changes: { new_threads, snoozed_to_open, surface_open: true } }`.

9b. READ `<vault>/.claude/skills/cowork/skills/update-weekly-snapshot/SKILL.md` in full
    and follow its `## Steps` section with
    `{ engagement_id: {{$engagement_id}}, phase: "morning", date_today: {{$today_date}}, writer: "cowork:morning-briefing", snapshot_data: { week_of, wtd_spend, cc_total, journaled_today: false } }`.

### Step 10: Done notice

Emit Obsidian Notice `cowork:morning-briefing complete -- {{$engagement_label}} {{$today_date}}`.

## Prompt body fallback (v0.4.0 installer-default sentinel detection)

Steps 3 (compose body) and 7 (write .md) operate on `prompt_body`. When reading
`spice/cowork/prompts/morning-briefing.md` to populate it, apply the v0.4.0
installer-default sentinel detection (v0.90.2):

- **v0.4.0 installer-default sentinel detection.** If `user_prompt_body`
  consists ONLY of the v0.4.0 installer-default content — recognizable by ALL
  of: (a) every non-blank line in the body starts with `> ` (one blockquote),
  (b) the first non-blank line starts with `> Vault-editable prompt for `,
  (c) the body contains the substring `Empty body is a no-op stub for now` —
  treat as if EMPTY and set `user_prompt_body = ""`. The sentinel means the
  user has never customized the prompt, functionally equivalent to empty.
- On empty `user_prompt_body`, fall back to the engagement-template prompt at
  `spice/cowork/context/engagement-templates/<engagement.type>/prompts/morning-briefing.md`.
- Set `prompt_body = user_prompt_body || template_prompt_body`. When both are
  empty, emit the no-op stub note with `warning: empty_prompt`.

## Write phase (Memory log backlink contract)

The Write phase (Steps 7-8 above) emits the atomic note + `.cowork.json` sidecar.
The body composed in Step 3 carries a Memory log backlink callout (composed by
Step 3c's `backlink_md`):

```
> [!quote]- Memory log
> Today's memory: [[spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<YYYY-MM-DD>/memory.md|Memory log — <YYYY-MM-DD>]]
```

This backlink anchors the atomic note to the day's memory file so downstream
synthesis (cowork:synthesize-day) can roll up tick-state into a per-day memory.

## Harness testing

This orchestrator conforms to `Docs/agent-guides/cowork-orchestrator-template.md` (v1.0.0).
Cohesion regression is caught by HC-V0950-COHESION-A1..A5. Single-source-of-truth
regression is caught by HC-V0970-O-1..12.
