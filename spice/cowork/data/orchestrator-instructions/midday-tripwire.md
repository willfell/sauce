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

{{shared.anti_delegation_clause}}

{{shared.prelude_block}}

# cowork:midday-tripwire — orchestrator-instructions

> [!warning]+ CRITICAL: voice + microscope discipline (v0.96.0)
> Path, frontmatter type, and atomic-note body shape are enforced
> deterministically by `write-atomic-note-helper.js` + JSON-schema validation
> against `data/schemas/midday-tripwire@1.0.0.json`. They cannot drift.
>
> Voice + microscope adherence ARE prose-level invariants the writer can't
> enforce. Apply `user-preferences.personality.notes` verbatim to every
> narrative sentence. For each kind in `priorities` with a microscope at
> `spice/cowork/prompts/per-mcp/<kind>/microscope.md`, follow that
> microscope's `## Output shape` directives verbatim. Tripwire severity is
> unchanged: silent on green (no note written), writes only when at least
> one signal lands at warn or alert.

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
| `{{$rating_kind_lines}}` | computed-at-emit — legacy name; feeds the v=4 kind-checklist lines per surfaced kind |
| `{{$pending_confirmation_lines}}` | computed-at-emit — pending-MCP bullet lines |

## Steps

### Step 0: Pre-flight (vault routing, engagement, tripwire_aspects gate)

0a. READ `<vault>/.claude/skills/cowork/skills/check-vault-routing/SKILL.md` in full and
    follow its `## Steps` section with `{ required: ["obsidian"] }`. If not `"ready"`,
    exit silently.

0b. Emit verbal commitment Notice (v0.91.1 + v0.91.2):

   ```
   cowork:midday-tripwire committing to:
     VOICE: apply user-preferences.personality.notes verbatim AND personality.{vibe, formality, length, pep_talk}
     MICROSCOPES: for each kind in priorities with a microscope at spice/cowork/prompts/per-mcp/<kind>/microscope.md, follow ## Output shape verbatim
   ```

   Two-purpose commitment: (1) commit voice so personality + voice contract
   land in body composition; (2) commit microscope adherence so each kind's
   callout follows its microscope's `## Output shape`. Deterministic backstops
   via the v0.96.0 Rail W writer + JSON-schema sidecar validation
   (path/frontmatter/dvjs/body-shape are enforced by `write-atomic-note-helper.js`
   against `data/schemas/midday-tripwire@1.0.0.json`, so PATH + TYPE bullets
   retired). The v0.91.x–v0.92.0 write-guards remain as belt-and-suspenders.

   {{shared.connectivity_authority_clause}}

   {{shared.microscope_clause}}

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

3a. **Read recent memory.** Invoke sub-skill `cowork:read-memory` with input
    `{ engagement_id: {{$engagement_id}}, tier: "tick", window: "today", limit_ticks: 4 }`.
    Capture `output_today`. Null-data preservation: `output_today = null` when no memory.
    (Step number 3a is the legacy alias for this sub-step; v0.97.0 numbers it 1a in the
    re-flow.)

   Midday cadence does NOT surface yesterday (different cadence from morning briefing —
   short + punchy, focused on right-now tripwires).

### Step 2: Gather priority loop + per-aspect tripwire gathers

> **MANDATORY:** execute the priority loop for EVERY entry in `plan.dispatch_plan`.
> Memory ticks are SUPPLEMENTARY context for the synopsis section ONLY. When a kind's
> `action == "warn"`, emit the warning callout in-position via `composeWarningCallout`.
> Failing to fire the priority loop means the dispatch contract's "Known people in
> scope" wikilink instruction never reaches the LLM, and inner-circle names render
> as plaintext instead of `**[[Name]]**` wikilinks.

> **MANDATORY (v0.91.3): load deferred MCP tools UPFRONT** via ToolSearch before the
> priority loop.

PREFS UNAVAILABLE fallback (legacy mode): if `plan.dispatch_mode == "legacy"`, emit
Obsidian Notice `cowork:midday-tripwire -- PREFS UNAVAILABLE (<plan.prefs_status>);
falling back to legacy mode. Chat and any custom kinds will NOT fire in legacy mode;
inner-circle wikilink emission will NOT occur. Investigate user-preferences.md if
this is unexpected.`

2a. **Plan dispatch.** Capture `reachable_namespaces` + `tools_by_namespace`. READ
    `<vault>/.claude/skills/cowork/skills/plan-dispatch/SKILL.md` in full and follow its
    `## Steps` section with
    `{ engagement_id: {{$engagement_id}}, cadence: "midday", reachable_namespaces, tools_by_namespace, vault_root }`.
    Capture the 14-key `plan` result (including `plan.tripwire_aspects`).

2b. **Priority loop.** For each `entry` in `plan.dispatch_plan`, dispatch warn /
    gather_canonical / gather_from_served_by exactly as morning-briefing Step 2b. Each
    gather_from_served_by invocation passes
    `siblings: plan.siblings[entry.kind_name] || []` AND
    `callout_type: prefs.mcps[entry.kind_name].callout_type`. Push results into
    `ordered_blocks[]`.

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

### Step 3: Compose run-note body via cowork:compose-body (decide severity → synopsis → per-kind → recalibration)

{{shared.voice_clause}}

3a. **Compute severity** from collected signals:
    - `alert` if any of: cc_signal contains a RED-class charge OR
      calendar_signal.drift_minutes >= 60 OR queue_signal.new_count >= 10.
    - `warn` if any of: cc_signal contains only YELLOW-class charges OR
      calendar_signal.drift_minutes in [30, 59] OR queue_signal.new_count in [3, 9].
    - `green` if none of the above → **EXIT SILENTLY**. Do NOT write a "nothing flagged"
      note (atomic-note absence = green; presence = something to flag).

3b. **Prep synopsis_md.** Compose `> [!info]+ What changed since morning` callout per
    `prompt_body` instructions AND the § Synopsis composition rules below (voice-shaped
    one-paragraph synopsis distilled from gather outputs; ≤80 words;
    first-sentence-concrete; empty-day "Quiet day" fallback) — tripwire signal +
    recalibration framing.

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

### Step 4: Feedback-capture callout (Rail L — v0.101.0 prose-first shape)

4a. Compute `output_path = "spice/cowork/daily/{{$today_dirpath}}/midday-tripwire.md"`.
    If the file already exists on disk (same-day re-fire), READ it and pass the
    raw content as `prior_md` to composeBody. `composeFeedbackCapture` preserves
    prior state for ANY vintage: a v=4 prior (tap + prose + kind ticks), and an
    UPGRADE-DAY legacy `cowork:rating-block` prior (kind ticks carried into the
    new checklist via `parseRatingCallout` — nothing is lost on upgrade day).
    Else `prior_md = null`.

4b. Compute `surfaced_kinds_for_rating` from `ordered_blocks[]` per the same rule as
    morning-briefing Step 4b.

4c. composeBody emits the feedback callout per `{{shared.feedback_capture_template}}`
    when `learning_enabled !== false` AND `surfaced_kinds_for_rating.length > 0`.
    Behind the scenes composeBody dispatches `composeFeedbackCapture` in
    kind-checklist mode for this cadence: one-tap `Useful` line + free-text
    typing box on top, ONE collapsed `[!summary]- Kinds — quick ticks`
    sub-callout below (a checkbox per surfaced kind). The sentinel
    `<!-- cowork:feedback-capture v=4 -->` is the reconciler's parse target.
    The legacy `cowork:rating-block` shape is NO LONGER emitted (v0.101.0);
    its parser remains in the reconciler for the historical corpus.

### Step 5: Detection callout (Rail D — new-MCP surface)

5a. composeBody emits the detection callout per `{{shared.detection_callout_template}}`
    when `plan.pending_confirmations.length > 0` AND
    `plan.render_aspects.new_mcp_notice == "include"`.

### Step 6: Anti-echo callout — NOT eligible for midday-tripwire

(midday-tripwire is intentionally excluded from `ANTI_ECHO_ELIGIBLE_CADENCES` per
v0.95.1 §3.4. composeBody internally gates the anti-echo callout on cadence
eligibility; this step is a no-op for midday and exists in the step-list for
parity with other cadence files.)

### Step 7: Write .md via obsidian_put_content (INLINE CONTRACT — do not delegate)

7a. **Compute the EXACT output path** (no improvisation, no daily-note pattern):
    `spice/cowork/daily/{{$today_dirpath}}/{{$cadence}}.md`
    Example for 2026-06-10 midday-tripwire: `spice/cowork/daily/2026/06-June/2026-06-10/midday-tripwire.md`.
    DO NOT write to `spice/cowork/daily/2026/06-June/Tuesday-2026-06-10.md` or any other shape.

7b. **Emit the frontmatter as a literal YAML block** (this exact shape, no extra keys, no missing keys; this cadence ALSO requires `severity`):

    ```yaml
    ---
    type: {{$frontmatter_type}}
    engagement_id: {{$engagement_id}}
    day: "{{$today_date}}"
    generator: cowork:{{$cadence}}@2.0.0
    prompt_source: spice/cowork/prompts/{{$cadence}}.md
    title: {{$title_template_resolved}}
    summary: <1-2 sentence headline distilled from the body>
    severity: <warn | alert>
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

8a. Apply `{{shared.sidecar_schema_template}}` substitution. The sidecar mirrors `.md`
    frontmatter (including `severity:`) under `frontmatter:`.

8b. Write the sidecar to `spice/cowork/daily/{{$today_dirpath}}/midday-tripwire.cowork.json`
    via `mcp__obsidian__obsidian_put_content`. The `writeAtomicNote` helper invokes
    `validateSidecar` against `data/schemas/midday-tripwire@1.0.0.json` BEFORE
    committing either file. On `failed:contract-violation:sidecar-schema`, no files are
    written.

8c. v0.101.0 — composeBody supplies the slim sidecar field
    feedback_capture: { sentinel_version: "v=4", kinds_listed: [<surfaced kinds>] }.
    Do NOT omit it when the feedback callout rendered.

### Step 8.5: Verify (sidecar schema validation backstop)

**Sidecar schema validation.** The write step's `writeAtomicNote` helper invokes
`validateSidecar` against the cadence schema BEFORE committing either file. If
the helper returned `failed:contract-violation:sidecar-schema`, no files were
written — emit Notice
`cowork:midday-tripwire aborted -- contract-violation: <field>` and exit
non-zero. Do not run subsequent state-update steps.

The regex re-read pass from v0.91.3+v0.92.0 is RETIRED. Sidecar JSON-schema
validation subsumes it. v0.91.x–v0.92.0 path/frontmatter/dvjs write-guards
INSIDE write-run-note still fire as belt-and-suspenders before the
writeAtomicNote call.

**v0.97.4 prose-invariant write-guards.** Pass `surfaced_kinds_for_rating`
(from Step 4 rating-callout compute) + `learning_enabled` (engagement field) +
`expected_kinds` (= `plan.dispatch_plan.map(e => e.kind_name)`) into
`writeAtomicNote`. Guards fire deterministically:
`failed:contract-violation:missing-rating-callout` when the body lacks BOTH
the `<!-- cowork:feedback-capture v= -->` marker AND the legacy
`<!-- cowork:rating-block schema= -->` marker while the rating gate is open;
`failed:contract-violation:missing-anti-echo-callout` when sidecar's
`render_aspects_applied` includes `anti_echo:include` but body lacks
`Outside yesterday's frame`. The coverage-gap injection (expected vs surfaced
kinds) is non-failing — visible warning callout + sidecar `coverage_gap`
field so reconcile-cowork can monitor cross-day.

### Step 9: State updates

(midday-tripwire does NOT update active-threads or weekly-snapshot — those are
morning-pass and eod-pass concerns. Skip silently.)

### Step 10: Done notice

Emit Obsidian Notice `cowork:midday-tripwire complete -- {{$engagement_label}} {{$today_date}} (severity: <severity>)`.

## Prompt body fallback (v0.4.0 installer-default sentinel detection)

When reading `spice/cowork/prompts/midday-tripwire.md` to populate `prompt_body`,
apply the v0.4.0 installer-default sentinel detection (v0.90.2):

- **v0.4.0 installer-default sentinel detection.** If `user_prompt_body`
  consists ONLY of the v0.4.0 installer-default content — recognizable by ALL
  of: (a) every non-blank line in the body starts with `> ` (one blockquote),
  (b) the first non-blank line starts with `> Vault-editable prompt for `,
  (c) the body contains the substring `Empty body is a no-op stub for now` —
  treat as if EMPTY and set `user_prompt_body = ""`. The sentinel means the
  user has never customized the prompt, functionally equivalent to empty.
- On empty `user_prompt_body`, fall back to the engagement-template prompt at
  `spice/cowork/context/engagement-templates/<engagement.type>/prompts/midday-tripwire.md`.

## Write phase (Memory log backlink contract)

The Write phase emits the atomic note + `.cowork.json` sidecar when severity is
`warn` or `alert` (silent on `green`). The body composed in Step 3 carries a
Memory log backlink callout:

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
