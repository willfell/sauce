---
name: cowork:midday-tripwire
description: Engagement-aware midday CC tripwire. Writes one atomic note at spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/midday-tripwire.md per scheduled invocation when severity == yellow or red; frontmatter `type: cowork-midday-tripwire` + `severity:`. Silent (no note written) when severity == green. Engagement-aware — fires when engagement.tripwire_aspects is non-empty (personal=cc, w2-fte=calendar/queue, consulting=all). Severity = warn|alert. Body composed from gather outputs interpolated through the user's prompt body at spice/cowork/prompts/midday-tripwire.md. Phrasings = "midday tripwire for <engagement>", "<engagement> midday check", "midday cc check".
schedule: Cron-driven per enabled (engagement, midday) pair (typically only personal-type engagements enable midday)
scope: shared
tags: [cowork, orchestrator, midday, engagement-aware, tripwire-aspects]
---

# cowork:midday-tripwire

> [!warning]+ CRITICAL: output path (v0.90.2)
> This orchestrator writes ONE atomic note to:
>
> `spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/midday-tripwire.md`
>
> DO NOT write to `spice/daily/<YYYY>/<MM-Month>/<weekday>-<YYYY-MM-DD>.md` — that's the daily-note blueprint (a separate surface for hand-edited daily notes), NOT this orchestrator's output. The consumer vault's CLAUDE.md may list `spice/daily/` under the "Daily" topic in its resolver table; THAT IS NOT WHERE COWORK ATOMIC NOTES GO. The cowork atomic-note path is fundamentally different from the daily-blueprint path.
>
> The write happens via sub-skill `cowork:write-run-note-midday-tripwire` (READ its SKILL.md before invoking; the step that delegates to it is later in this file). NEVER write the atomic note directly via the `Write` tool, the `Edit` tool, or `mcp__obsidian__obsidian_put_content` from this orchestrator body — ALWAYS delegate to the write sub-skill which enforces the path + frontmatter + structural-marker contracts.

Real-time mid-day check for credit-card charges that violate the active payoff plan, scoped to a single engagement. Pulls today's CC transactions for the engagement's finance scope, classifies each as RED (locked-card charge), YELLOW (active-card discretionary >= threshold), or GREEN. Writes ONLY when at least one RED or YELLOW exists — when severity is green, NO atomic note is written (presence of a tripwire note = something to flag). When a write fires, the note lands at `spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/midday-tripwire.md` (deterministic path per `(orchestrator, day)`; re-run replaces).

Skipped (early-exit silently) for engagements whose `tripwire_aspects` is empty (field absent or `[]`).

This orchestrator NEVER patches the daily note's callouts, edits the daily-note template, or writes to legacy paths. The v0.65.0 atomic-note write contract is the only output surface.

## Inputs

```
{
  engagement_id: string   // required
}
```

## Pre-flight

1. READ `.claude/skills/cowork/skills/check-vault-routing/SKILL.md` in full and follow
   its `## Steps` section with `{ required: ["obsidian"] }`. If not `"ready"`, exit silently.
1b. **Verbal commitment (v0.91.1 + v0.91.2).** Before any other action, emit Obsidian Notice as a binding commitment:

   ```
   cowork:midday-tripwire committing to:
     PATH: spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/midday-tripwire.md (NOT spice/daily/...)
     TYPE: cowork-midday-tripwire (canonical frontmatter type)
     VOICE: apply user-preferences.personality.notes verbatim AND personality.{vibe, formality, length, pep_talk}
     MICROSCOPES: follow ## Output shape from each per-mcp/<kind>/microscope.md verbatim
   ```

   Deterministic backstops in write-run-note: path write-guard (v0.91.1) + frontmatter write-guard (v0.91.2). Voice + microscope are prose-imperative.

2. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md`; look up `engagement` by id. If not found, exit silently. Read the engagement-type manifest via the Read tool at `spice/cowork/context/engagement-types/<engagement.type>.json` (substitute `<engagement.type>` from the resolved engagement; expected values: `personal`, `w2-fte`, `consulting`). Parse as JSON; capture `render_aspects` AND `tripwire_aspects` (defaults to `[]` when field absent). If the file is missing or fails to parse, emit Notice `cowork:midday-tripwire aborted -- engagement-type manifest unavailable at spice/cowork/context/engagement-types/<engagement.type>.json` and exit. If `tripwire_aspects.length == 0`, exit silently (engagement has no tripwire signals — tripwire is a no-op).
3. READ `.claude/skills/cowork/skills/date-context/SKILL.md` in full and follow
   its `## Steps` section with `{}`. If `context.error`, exit silently.
3a. **Read recent memory.** (NEW v0.86.0; mirrors morning-briefing's step 3a refactor.)

   Invoke sub-skill `cowork:read-memory` with input `{ engagement_id, tier: "tick", window: "today", limit_ticks: 4 }`. Capture `output_today`. The sub-skill returns null-data when no memory file exists — preserve as `output_today = null` for the body-composition step.

   This step is PURE (no MCP calls, no writes). NEW in v0.86.0.
3b. **Plan dispatch.** (Replaces v0.94.x's separate `3b read-prefs + 3c dispatch + 3d inner-circle` steps with a single sub-skill READ.)

   Capture `reachable_namespaces` from the agent's tool list (walk every `mcp__<ns>__<tool>` name; add `<ns>` to the set).

   READ `.claude/skills/cowork/skills/plan-dispatch/SKILL.md` in full and follow its `## Steps` section with `{ engagement_id, cadence: "midday", reachable_namespaces, vault_root: <vault-root-from-routing> }`. Capture the 12-key result as `plan`.

   If `plan.dispatch_mode == "legacy"`, emit Obsidian Notice: `cowork:midday-tripwire -- PREFS UNAVAILABLE (<plan.prefs_status>); falling back to legacy mode. Chat and any custom kinds will NOT fire in legacy mode; inner-circle wikilink emission will NOT occur. Investigate user-preferences.md if this is unexpected.` The legacy per-aspect gather sequence (steps 5-7 below) fires unchanged.

   When `plan.dispatch_mode == "prefs"`, Gather + Decide + Write consume `plan.dispatch_plan`, `plan.voice_contract`, `plan.microscopes`, `plan.siblings`, `plan.allowlist`, `plan.render_aspects`, `plan.cadence_order`, `plan.tripwire_aspects`, `plan.kind_titles`, and `plan.effective_hard_rules` directly — no inline dispatch-plan composition lives in this orchestrator.
4. READ `.claude/skills/cowork/skills/ensure-daily-note/SKILL.md` in full and follow
   its `## Steps` section with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

> **MANDATORY:** When `plan.dispatch_mode == "prefs"`, execute the priority loop for EVERY entry in `plan.dispatch_plan`. Memory ticks are SUPPLEMENTARY context for the `[!info]- Today at a glance` synopsis section; they DO NOT replace live MCP gather output. When a kind's `action == "warn"`, emit the warning callout in-position via `composeWarningCallout`. Failing to fire the priority loop means the dispatch contract's "Known people in scope" wikilink instruction never reaches the LLM.

> **MANDATORY (v0.91.3): load deferred MCP tools UPFRONT.** Before the priority loop, for each kind in `plan.dispatch_plan` with `action == "gather_from_served_by"` or `action == "gather_canonical"`, load the required deferred tools from the kind's `served_by` namespace via Tool Search / Load.

When `plan.dispatch_mode == "legacy"`, execute the v0.77.0 legacy per-aspect gather sequence below verbatim. `ordered_blocks[]` stays empty.

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
      what_matters:         entry.what_matters,
      question_set_answers: entry.question_set_answers,
      hard_rules:           plan.effective_hard_rules,
      siblings:             plan.siblings[entry.kind_name] || [],
      callout_type:         entry.mcps_entry.callout_type,
      inner_circle_resolved: plan.allowlist.resolved,
      engagement_id:        engagement_id,
      today:                context.today,
      range:                { start: context.today, end: context.today },
      timezone:             engagement.timezone || "America/Denver"
    }
    if result.status == "ready":
      ordered_blocks.push({ kind_name, markdown: result.markdown, kind: "example" })
    else:
      md = composeWarningCallout({ kind_name, kind_title, reason: result.status, mcps_entry })
      ordered_blocks.push({ kind_name, markdown: md, kind: "warning" })

# After the priority loop, run per-aspect tripwire gathers (steps 5/6/7 below)
# per plan.tripwire_aspects. These remain APPENDED AFTER ordered_blocks in the composed body.
```

Each gather call passes `engagement_id`. The orchestrator branches per-aspect from `plan.tripwire_aspects` (FINAL composed: bundle ⨁ overrides REPLACES on the array).

5. If `"cc_drift"` in `plan.tripwire_aspects`: READ `.claude/skills/cowork/skills/gather-finance-cc-today/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_today: context.today, lookback_start: "06:00", timezone: "America/Denver", classify: true, cards: { active: engagement.cc_active_cards, locked: engagement.cc_locked_cards, ignore: engagement.cc_ignored_cards } }`. Capture `{ markdown, charges, top_merchant_today_total, mtd_discretionary, days_since_splurge_pre }` as `cc_signal`. When CC cards are not configured, treat as `cc_signal = null`.
6. If `"calendar_drift"` in `plan.tripwire_aspects`: READ `.claude/skills/cowork/skills/gather-calendar/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, mode: "drift-check", horizon: "today+4h", timezone: "America/Denver" }`. Capture `{ markdown, drift_minutes, drifted_events }` as `calendar_signal`. On `gather-skipped`, `calendar_signal = null` and append `calendar_unavailable` to the warnings array passed to write.
7. If `"queue_growth"` in `plan.tripwire_aspects`: READ `.claude/skills/cowork/skills/gather-projects/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, mode: "tripwire-delta", since: <yesterday EOD ISO> }`. Capture `{ markdown, new_count, items }` as `queue_signal`.

## Decide

8. **Compute severity** from collected signals:
   (Vocab: `RED`/`YELLOW` below refer to per-charge classifications returned by `gather-finance-cc-today`; `alert`/`warn`/`green` are the orchestrator-level severity values written to the atomic note's `severity:` frontmatter.)
   - `alert` if any of: cc_signal contains a RED-class charge, calendar_signal.drift_minutes >= 60, queue_signal.new_count >= 10
   - `warn`  if any of: cc_signal contains only YELLOW-class charges, calendar_signal.drift_minutes in [30, 59], queue_signal.new_count in [3, 9]
   - `green` if none of the above
   If `green` → exit silently. Do NOT write a "nothing flagged" run-note (atomic-note absence = green; presence = something to flag).

## Write

9. **Read prompt body** with fallback chain (v0.90.2):
    - Read `spice/cowork/prompts/midday-tripwire.md` via `mcp__obsidian__get_file_contents`. Strip frontmatter; capture body as `user_prompt_body` (or empty when missing).
    - **v0.4.0 installer-default sentinel detection (v0.90.2):** if `user_prompt_body` consists ONLY of the v0.4.0 installer-default content — recognizable by ALL of: (a) every non-blank line in the body starts with `> ` (one blockquote), (b) the first non-blank line starts with `> Vault-editable prompt for `, (c) the body contains the substring `Empty body is a no-op stub for now` — treat as if EMPTY and set `user_prompt_body = ""`.
    - If `user_prompt_body` is empty, read `spice/cowork/context/engagement-templates/<engagement.type>/prompts/midday-tripwire.md` via `mcp__obsidian__get_file_contents`. Strip frontmatter; capture as `template_prompt_body` (or empty when missing).
    - Set `prompt_body = user_prompt_body || template_prompt_body`.
    - Set `prompt_source` accordingly: if `user_prompt_body` non-empty, `prompt_source = "spice/cowork/prompts/midday-tripwire.md"`; else if `template_prompt_body` non-empty, `prompt_source = "spice/cowork/context/engagement-templates/<engagement.type>/prompts/midday-tripwire.md"`; else `prompt_source = "spice/cowork/prompts/midday-tripwire.md"`.
9b. **Voice contract.** If `plan.dispatch_mode == "prefs"` AND `plan.voice_contract != ""`, prepend it to `prompt_body`:
   `prompt_body = plan.voice_contract + prompt_body`. The combined string is the input to the body-composition step.
10. **Compose run-note body via cowork:compose-body.**

  14a. **Prep synopsis_md.** Compose the `> [!info]- Midday status` callout per `prompt_body` instructions (voice-shaped one-paragraph synopsis distilled from gather outputs — tripwire signal + recalibration framing). When `semantic_index_age` is non-null, append `> Semantic index age: <semantic_index_age>m` as the last `> ` line inside the synopsis callout BEFORE passing to composeBody.
       - Empty-prompt stub case (when `warning == "empty_prompt"`): synopsis_md = `"> [!info]- Midday status\n> (Prompt body empty — edit spice/cowork/prompts/midday-tripwire.md to customize what this run emits.)"`.

  14b. **Prep closing_md.** Compose the `> [!tip] Recalibration` callout per `prompt_body` instructions (2-3 sentence recalibration paragraph + concrete first action).
       - Empty-prompt stub case: closing_md = `"> [!tip] Recalibration\n> Edit \`spice/cowork/prompts/midday-tripwire.md\` to define what this scheduled job should emit when it fires."`.

  14c. **Prep memory_callouts struct.** Use existing helpers:
       - `yesterday_md` ← `""` (midday cadence does not surface yesterday)
       - `overnight_md` ← `composeMidamMemoryCallout(output_today)` (the "Earlier today" callout)
       - `echoes_md` ← `composeSemanticEchoesCallout(output_echoes)` when applicable, else `""`
       - `backlink_md` ← inline-composed per v0.85.0 § 2.1.3 spec: `"> [!quote]- Memory log\n> Today's memory: [[spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<YYYY-MM-DD>/memory.md|Memory log — <YYYY-MM-DD>]]"` (tick-count parenthetical omitted when unknown).

  14d. **Prep ordered_blocks[].** Iterate gather-pipeline `ordered_blocks[]` (from priority loop). Each entry already carries `{ kind, callout_type, markdown }`. Add `title` from `plan.kind_titles[entry.kind_name]` (v0.95.0: data file `spice/cowork/data/kind-titles.json` is canonical; per-kind microscope `## Output shape` directives may override per-engagement). Translate to composeBody shape: `{ kind, callout_type, title, body_md: markdown }`.

  14e. **Prep engagement_type_blocks[].** For each `related_signal` in `related_signals[]` with `status == "ready"`: push `{ kind: "semantic", callout_type: "example", title: "Related to: <event.title>", body_md: <related_signal.markdown> }`. When `semantic_index_unavailable == true`: push ONCE `{ kind: "semantic-unavailable", callout_type: "warning", title: "Semantic index not available", body_md: "Smart Connections index absent or anchor not indexed — semantic gather skipped." }`. Finance does NOT flow through here — it's written by a separate sub-skill when applicable.

  14f. **Invoke composeBody.** READ `.claude/skills/cowork/skills/compose-body/SKILL.md` in full and follow its `## Compose` section with `{ cadence: "midday-tripwire", nav_buttons_block: "<canonical block>", synopsis_md, memory_callouts: { yesterday_md, overnight_md, echoes_md, backlink_md }, ordered_blocks, engagement_type_blocks, closing_md, excluded_themes: plan.excluded_themes, voice_contract: plan.voice_contract }`. The `excluded_themes` field is the v0.95.1 Knob-1 13th plan-dispatch contract key — when `render_aspects.anti_echo == "include"` it carries yesterday's carry-forward bullets verbatim; otherwise `[]`. composeBody gates the anti-echo callout injection internally on cadence eligibility + non-empty excluded_themes. Capture `{ body_md, body_assertions, status }`.

  14g. **Compose failure handling.** If `status` starts with `"failed:"`, emit Notice `cowork:midday-tripwire aborted -- compose-body failure: <status>` and exit non-zero. Do NOT call write-run-note. Do NOT run state-update steps.
11. READ `.claude/skills/cowork/skills/write-run-note-midday-tripwire/SKILL.md` in full —
    paying particular attention to its `## Title composition`,
    `## Adaptive body skeleton`, and `## Pre-write self-check` sections — then apply those contracts
    before performing the write described in its `## Steps` section with `{ engagement, date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], severity, signals: { cc: cc_signal, calendar: calendar_signal, queue: queue_signal }, body: body_md, body_assertions, prompt_source: "spice/cowork/prompts/midday-tripwire.md", warning, warnings: warnings_array }`. The `signals` arg is an opaque structured handoff write-run-note uses to compose the summary line; `warnings_array` is the optional list of `<aspect>_unavailable` strings from gather-skipped returns. Capture `status`. If `status` starts with `"failed:contract-violation:"`, emit Notice `cowork:midday-tripwire aborted -- contract violation: <field>` and exit non-zero. Else if `status` starts with `"failed:"`, emit Notice `cowork:midday-tripwire aborted -- write failed: <status>` and exit. Do not run state-update steps after a failed write.

## Verify

12. **Re-read + structural verify.** After `write-run-note-midday-tripwire` returns a non-`"failed:"` status:

   a. Read the just-written file via the Read tool at `spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/midday-tripwire.md` (substituting the values from `context`).
   b. Parse leading frontmatter (YAML between `---` markers) as `parsed_frontmatter`; capture the remainder as `body`.
   c. Assert required frontmatter fields exist and are non-empty strings:
      - `title:`
      - `summary:`
      - `type:` (must equal `cowork-midday-tripwire`)
      - `severity:` (must match `/^(warn|alert)$/`)
      - `warning:` only when the orchestrator passed a non-null `warning` to write-run-note (otherwise the field is allowed to be absent or `null`).
   d. Regex-scan `body` for required structural markers:
      - SpaceNavButtons block (v0.91.3 canonical pattern — REJECTS hallucinated `const { SpaceNavButtons } = customJS` shape): `/```dataviewjs\s*\n\s*await\s+dv\.view\(\s*["']ranch\/views\/customjs-guard["']\s*,\s*\{\s*class:\s*["']SpaceNavButtons["']\s*\}\s*\)/`
      - At least one Synopsis callout: `/^> \[!info\]- /m`
      - At least one example callout: `/^> \[!example\]\+ /m`
      - Closing tip callout: `/^> \[!tip\] /m`
      - Severity-specific marker: at least one `> [!warning] ` callout OR `> [!example]+ 🚨` callout (regex: `/^> \[!warning\] |^> \[!example\]\+ 🚨/m`).
   e. On ANY frontmatter-field miss or marker miss:
      - Use Bash to delete the file: `rm -f spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/midday-tripwire.md`
      - Emit Obsidian Notice: `cowork:midday-tripwire aborted -- contract-violation: <missing-field-or-marker-name>` (when the miss is the severity-specific marker, reference it explicitly as `severity-marker`)
      - Exit non-zero. Do NOT run subsequent steps.
   f. On all-pass: continue to Done per the existing flow.

## Done

## Harness testing

This orchestrator conforms to `Docs/agent-guides/cowork-orchestrator-template.md` (v1.0.0). Cohesion regression is caught by HC-V0950-COHESION-A1..A5.

A helper at `platform/blueprints/cowork/helpers/dispatch-plan-helper.js` exports `planDispatch`, `decideDispatchMode`, `composeVoiceContract`, `composeWarningCallout`, and the v0.95.0 additive trio `composeFinalPreferences`, `readEngagement`, `loadKindTitles`. The cowork:plan-dispatch sub-skill body composes these helpers into the 12-key result tree this orchestrator consumes — no inline dispatch-plan pseudocode remains.
