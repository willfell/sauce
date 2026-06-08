---
name: cowork:morning-briefing
description: Engagement-aware morning briefing. Writes one atomic note at spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/morning-briefing.md per scheduled invocation; frontmatter `type: cowork-morning-briefing`. Body composed from gather outputs (calendar/email/messages/finance/projects/threads) interpolated through the user's prompt body at spice/cowork/prompts/morning-briefing.md. Phrasings = "morning briefing for <engagement>", "give me today's morning for <engagement>", "<engagement> morning briefing".
schedule: Cron-driven per enabled (engagement, morning) pair (paste-blocks emitted by cowork:bootstrap-vault step 22)
scope: shared
tags: [cowork, orchestrator, morning, engagement-aware]
---

# cowork:morning-briefing

> [!warning]+ CRITICAL: output path (v0.90.2)
> This orchestrator writes ONE atomic note to:
>
> `spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/morning-briefing.md`
>
> DO NOT write to `spice/daily/<YYYY>/<MM-Month>/<weekday>-<YYYY-MM-DD>.md` — that's the daily-note blueprint (a separate surface for hand-edited daily notes), NOT this orchestrator's output. The consumer vault's CLAUDE.md may list `spice/daily/` under the "Daily" topic in its resolver table; THAT IS NOT WHERE COWORK ATOMIC NOTES GO. The cowork atomic-note path is fundamentally different from the daily-blueprint path.
>
> The write happens via sub-skill `cowork:write-run-note-morning-briefing` (READ its SKILL.md before invoking; the step that delegates to it is later in this file). NEVER write the atomic note directly via the `Write` tool, the `Edit` tool, or `mcp__obsidian__obsidian_put_content` from this orchestrator body — ALWAYS delegate to the write sub-skill which enforces the path + frontmatter + structural-marker contracts.

Composes a morning briefing for one engagement (calendar + email + optional Finance + optional Messages + Open Threads) and writes ONE atomic note at `spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/morning-briefing.md` (deterministic path per `(orchestrator, day)`; overwrite-last-write-wins idempotency). Body shape follows the user's prompt body at `spice/cowork/prompts/morning-briefing.md`; when the prompt body is empty, emits a no-op note with `warning: empty_prompt` frontmatter.

This orchestrator NEVER patches the daily note's callouts, edits the daily-note template, or writes to legacy paths like `Timestamps/Summary/...`. The v0.65.0 atomic-note write contract is the only output surface. Aborts cleanly on MCP unavailability — never partially writes.

## Inputs

```
{
  engagement_id: string   // required — id of the engagement to brief; must match an entry in vault-config.md engagements[]
}
```

## Pre-flight

1. READ `.claude/skills/cowork/skills/check-vault-routing/SKILL.md` in full and follow
   its `## Steps` section with `{ required: ["obsidian"] }`. If the return is not `"ready"`, emit Notice `cowork:morning-briefing aborted -- <status>` and exit. Do not write.
1b. **Verbal commitment (v0.91.1 + v0.91.2).** Before any other action, emit Obsidian Notice and treat it as a binding commitment for this run:

   ```
   cowork:morning-briefing committing to:
     PATH: spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/morning-briefing.md (NOT spice/daily/<weekday>-<YYYY-MM-DD>.md)
     TYPE: cowork-morning-briefing (canonical frontmatter type — NOT cowork-run-note)
     VOICE: apply user-preferences.personality.notes verbatim AND personality.{vibe, formality, length, pep_talk} to every narrative sentence
     MICROSCOPES: for each kind in prefs.priorities with a microscope at spice/cowork/prompts/per-mcp/<kind>/microscope.md, follow that microscope's ## Output shape directives verbatim for the kind's callout
   ```

   Four-purpose commitment: (1) commit path so the v0.91.1 path write-guard never fires; (2) commit type so the v0.91.2 frontmatter write-guard never fires; (3) commit voice so personality + voice contract land in body composition; (4) commit microscope adherence so each kind's callout follows its microscope's `## Output shape`. The Notice creates an audit trail if any commitment is violated. Deterministic backstops in write-run-note: path write-guard (v0.91.1) + frontmatter write-guard (v0.91.2) + body-shape write-guard (v0.92.0). Voice + microscope are prose-imperative; cowork:compose-body's canonical shape re-read reinforces.

2. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md` via `mcp__obsidian__get_frontmatter`. Look up `engagements[]` entry where `id == engagement_id`. If not found, emit Notice `cowork:morning-briefing aborted -- engagement '<id>' not found in vault-config.md` and exit. Capture `engagement` (the full record) and read the matching engagement-type manifest via the Read tool at `spice/cowork/context/engagement-types/<engagement.type>.json` (expected values: `personal`, `w2-fte`, `consulting`). Parse as JSON; capture `type_manifest.render_aspects`. If the file is missing or fails to parse, emit Notice `cowork:morning-briefing aborted -- engagement-type manifest unavailable at spice/cowork/context/engagement-types/<engagement.type>.json` and exit. The render-aspects map drives which gather + write steps fire (e.g. `finance_block: include` enables the Finance callout; `inner_circle_imessage: include` enables Messages).
3. READ `.claude/skills/cowork/skills/date-context/SKILL.md` in full and follow
   its `## Steps` section with `{}`. Capture the returned `context` object. If `context.error` exists, emit Notice and exit.
3a. **Read recent memory.** (REFACTORED v0.85.0; output byte-identical to v0.84.0.)

   3a.i Invoke sub-skill `cowork:read-memory` with input `{ engagement_id, tier: "day", window: "yesterday" }`. Capture `output_yesterday`. The sub-skill returns null-data when no memory file exists — preserve as `output_yesterday = null` for the body-composition step.

   3a.ii Invoke sub-skill `cowork:read-memory` with input `{ engagement_id, tier: "tick", window: "today", limit_ticks: 6 }`. Capture `output_overnight`. Same null-data preservation.

   Both invocations are PURE (no MCP calls, no writes). New in v0.85.0 (refactor of v0.84.0's inline file-read).
3a.5. **Gather semantic echoes.** (Renamed v0.95.0 from prior step 3b — sub-step of memory phase. PURE — no MCP calls. Other cadences opt in via `engagement.overrides.render_aspects.semantic_related: "include"`.)

   Compose `anchor_text` from `plan.dispatch_plan` kind-name summary + today's `calendar_summary` + `email_summary` (≤500 chars total; join with " · " separator). When all three are empty, skip this step and set `output_echoes = null`.

   Invoke sub-skill `cowork:gather-semantic-memory` with input `{ engagement_id, anchor_text, top_k: 2, exclude_window: "last-30d", min_similarity: 0.45 }`. Capture `output_echoes`.

   The sub-skill returns null-data when corpus is thin OR sc-bridge unavailable OR SC index missing — preserve as `output_echoes = null` (or the returned null-data object) for the body-composition step.
3b. **Plan dispatch.** (Replaces v0.94.x's separate `3b read-prefs + 3c dispatch + 3d microscopes + 3e inner-circle` steps with a single sub-skill READ.)

   Capture `reachable_namespaces` from the agent's tool list (walk every `mcp__<ns>__<tool>` name; add `<ns>` to the set).

   READ `.claude/skills/cowork/skills/plan-dispatch/SKILL.md` in full and follow its `## Steps` section with `{ engagement_id, cadence: "morning", reachable_namespaces, vault_root: <vault-root-from-routing> }`. Capture the 11-key result as `plan`.

   If `plan.dispatch_mode == "legacy"`, emit Obsidian Notice: `cowork:morning-briefing -- PREFS UNAVAILABLE (<plan.prefs_status>); falling back to legacy mode. Chat and any custom kinds will NOT fire in legacy mode; inner-circle wikilink emission will NOT occur. Investigate user-preferences.md if this is unexpected.` The legacy gather sequence (steps 5-12 below) fires unchanged.

   When `plan.dispatch_mode == "prefs"`, Gather + Write consume `plan.dispatch_plan`, `plan.voice_contract`, `plan.microscopes`, `plan.siblings`, `plan.allowlist`, `plan.render_aspects`, `plan.cadence_order`, `plan.kind_titles`, and `plan.effective_hard_rules` directly — no inline dispatch-plan composition lives in this orchestrator.
4. READ `.claude/skills/cowork/skills/ensure-daily-note/SKILL.md` in full and follow
   its `## Steps` section with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

> **MANDATORY:** When `plan.dispatch_mode == "prefs"`, execute the priority loop for EVERY entry in `plan.dispatch_plan`. Do NOT skip the loop in favor of memory-tick synthesis. Memory ticks are SUPPLEMENTARY context for the `[!info]- Today at a glance` synopsis section; they DO NOT replace live MCP gather output. When a kind's `action == "warn"`, emit the warning callout in-position via `composeWarningCallout`; do NOT silently drop it. Failing to fire the priority loop means the dispatch contract's "Known people in scope" wikilink instruction never reaches the LLM, and inner-circle names render as plaintext instead of `**[[Name]]**` wikilinks.

> **MANDATORY (v0.91.3): load deferred MCP tools UPFRONT.** Before the priority loop, for each kind in `plan.dispatch_plan` with `action == "gather_from_served_by"` or `action == "gather_canonical"`, load the required deferred tools from the kind's `served_by` namespace via Tool Search / Load. M365 (UUID `45224a84-...`): `chat_message_search`, `outlook_calendar_search`, `outlook_email_search`. ADO (UUID like `1151913a-...`): `list_workitems`, `search_workitems`. github: `search_pull_requests`, `search_issues`. If a tool isn't loaded when its gather sub-skill needs it, the sub-skill cannot execute and you silently fall back to a warning callout — the deterministic fix for today's "MCP tools require loading" failure.

When `plan.dispatch_mode == "legacy"`, execute the v0.77.0 legacy gather sequence in steps 5-12 below verbatim. `ordered_blocks[]` stays empty; gather outputs flow through their existing composition slots per cowork:compose-body's canonical shape.

When `plan.dispatch_mode == "prefs"`, skip steps 5-12 below; instead execute the priority-loop:

```
ordered_blocks = []
for entry in plan.dispatch_plan:
  if entry.action == "warn":
    md = composeWarningCallout({ kind_name, kind_title, reason, mcps_entry })
    ordered_blocks.push({ kind_name, markdown: md, kind: "warning" })
  elif entry.action == "gather_canonical":
    READ `.claude/skills/cowork/skills/<entry.gather_skill-after-cowork-prefix>/SKILL.md` in full
    and follow its `## Steps` section with the kind's canonical input shape
    (engagement_id, date_today, horizon, timezone for calendar; engagement_id,
    window for email; etc. — see legacy steps 6-7 for argument shapes).
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
      range:                { start: context.today, end: context.today + 2 days },
      timezone:             engagement.timezone || "America/Denver"
    }
    # When entry.baseline_notes is set (microscope-routed kind), treat it as secondary
    # "baseline preferences" context behind the microscope contract.
    if result.status == "ready":
      ordered_blocks.push({ kind_name, markdown: result.markdown, kind: "example" })
    else:
      md = composeWarningCallout({ kind_name, kind_title, reason: result.status, mcps_entry })
      ordered_blocks.push({ kind_name, markdown: md, kind: "warning" })

# After the priority loop, run engagement-type-aspect gathers (semantic, finance)
# per plan.render_aspects gates from legacy step 12b and step 15.
# These remain APPENDED AFTER ordered_blocks in the composed body.
```

Legacy-mode gather steps (executed only when `plan.dispatch_mode == "legacy"`):

Each gather call passes `engagement_id`. The sub-skill reads per-engagement MCP-scoped fields (gmail_label / calendar_id) from vault-config.md and may type-gate (e.g. `gather-imessage` early-exits for non-personal engagements). Renderable steps skip silently when their `plan.render_aspects` flag is `skip`.

5. READ `.claude/skills/cowork/skills/gather-weather/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, city: engagement.home_city, days_ahead: 3 }` (personal only — skipped when `plan.render_aspects.weather` is not present in engagement type).
6. READ `.claude/skills/cowork/skills/gather-calendar/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_today: context.today, horizon: "today+next-2-days", timezone: "America/Denver" }`.
7. READ `.claude/skills/cowork/skills/gather-gmail/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, window: "newer_than:1d" }`.
8. READ `.claude/skills/cowork/skills/gather-imessage/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, window_days: 3, scope: "inner-circle-and-groups", inner_circle: plan.allowlist.phone_filter_list.join(",") }` (gated: early-exit if engagement.type != "personal"). The `phone_filter_list` is composed inside `cowork:plan-dispatch` step 12 via `composeInnerCircleAllowlist`; empty string when no inner-circle is configured.
9. If `plan.render_aspects.finance_block == "include"`: READ `.claude/skills/cowork/skills/gather-finance-yesterday/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_yesterday: context.yesterday, mode: "daily" }`.
10. If `plan.render_aspects.finance_block == "include"`: READ `.claude/skills/cowork/skills/gather-cc-debt-snapshot/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, date_today: context.today, mode: "daily" }`.
11. READ `.claude/skills/cowork/skills/gather-projects/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, filter: "active", today: context.today, carry_over_from: context.yesterday_daily_path }`.
12. READ `.claude/skills/cowork/skills/gather-threads/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, date_today: context.today, mode: "morning-surface" }`.
12b. **Semantic related.** If `plan.render_aspects.semantic_related == "include"` AND `calendar_signal.events.length > 0`:
     For each event in `calendar_signal.events` (capped at first 5 to bound cost):
       READ `.claude/skills/cowork/skills/gather-semantic-related/SKILL.md` in full and follow its `## Steps` section with `{
         mode: "semantic-search",
         query: "<event.title> <event.attendees joined> <event.description first-200-chars>",
         top_k: 3,
         callout_title: "Related to: <event.title>"
       }`
     Collect responses as `related_signals[]`. Capture `related_signals[0].index_age_minutes` as `semantic_index_age` (all calls share an age; first is canonical).

## Write

13. **Read prompt body** with fallback chain (v0.90.2):
    - Read `spice/cowork/prompts/morning-briefing.md` via `mcp__obsidian__get_file_contents`. Strip leading frontmatter block. Capture body trimmed of leading/trailing whitespace as `user_prompt_body`. If the file is missing, treat as `user_prompt_body = ""`.
    - **v0.4.0 installer-default sentinel detection (v0.90.2):** if `user_prompt_body` consists ONLY of the v0.4.0 installer-default content — recognizable by ALL of: (a) every non-blank line in the body starts with `> ` (one blockquote), (b) the first non-blank line starts with `> Vault-editable prompt for `, (c) the body contains the substring `Empty body is a no-op stub for now` — treat as if EMPTY and set `user_prompt_body = ""`. The sentinel means the user has never customized the prompt, functionally equivalent to empty.
    - If `user_prompt_body` is empty, read `spice/cowork/context/engagement-templates/<engagement.type>/prompts/morning-briefing.md` via `mcp__obsidian__get_file_contents` (substitute `<engagement.type>` from the resolved engagement; expected values: `personal`, `w2-fte`, `consulting`). Strip frontmatter; capture as `template_prompt_body` (or empty when missing).
    - Set `prompt_body = user_prompt_body || template_prompt_body` (use user prompt when populated; else fall back to engagement-template prompt; else empty).
    - Set `prompt_source` accordingly: if `user_prompt_body` non-empty, `prompt_source = "spice/cowork/prompts/morning-briefing.md"`; else if `template_prompt_body` non-empty, `prompt_source = "spice/cowork/context/engagement-templates/<engagement.type>/prompts/morning-briefing.md"`; else `prompt_source = "spice/cowork/prompts/morning-briefing.md"` (the user-prompt path is still the canonical pointer when both empty — the stub references it).
13b. **Voice contract.** If `plan.dispatch_mode == "prefs"` AND `plan.voice_contract != ""`, prepend it to `prompt_body`:
   `prompt_body = plan.voice_contract + prompt_body`. The combined string is the input to the body-composition step. If `plan.voice_contract == ""`, prompt_body passes through unchanged.
14. **Compose run-note body via cowork:compose-body.**

  14a. **Prep synopsis_md.** Compose the `> [!info]- Today at a glance` callout per `prompt_body` instructions (voice-shaped one-paragraph synopsis distilled from gather outputs). When `semantic_index_age` is non-null, append `> Semantic index age: <semantic_index_age>m` as the last `> ` line inside the synopsis callout BEFORE passing to composeBody.
       - Empty-prompt stub case (when `warning == "empty_prompt"`): synopsis_md = `"> [!info]- Today at a glance\n> (Prompt body empty — edit spice/cowork/prompts/morning-briefing.md to customize what this run emits.)"`.

  14b. **Prep closing_md.** Compose the `> [!tip] Today's focus` callout per `prompt_body` instructions (2-3 sentence focus paragraph + concrete first action).
       - Empty-prompt stub case: closing_md = `"> [!tip] Today's focus\n> Edit \`spice/cowork/prompts/morning-briefing.md\` to define what this scheduled job should emit when it fires."`.

  14c. **Prep memory_callouts struct.** Use existing helpers:
       - `yesterday_md` ← `composeMemoryCallouts(output_yesterday, output_overnight).yesterdayCalloutMd`
       - `overnight_md` ← `composeMemoryCallouts(...).overnightCalloutMd`
       - `echoes_md` ← `composeSemanticEchoesCallout(output_echoes)`
       - `backlink_md` ← inline-composed per v0.85.0 § 2.1.3 spec: `"> [!quote]- Memory log\n> Today's memory: [[spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<YYYY-MM-DD>/memory.md|Memory log — <YYYY-MM-DD>]]"` (tick-count parenthetical omitted when unknown).

  14d. **Prep ordered_blocks[].** Iterate gather-pipeline `ordered_blocks[]` (from steps 5-12b priority loop). Each entry already carries `{ kind, callout_type, markdown }`. Add `title` from `plan.kind_titles[entry.kind_name]` (v0.95.0: data file `spice/cowork/data/kind-titles.json` is canonical; per-kind microscope `## Output shape` directives may override per-engagement). Translate to composeBody shape: `{ kind, callout_type, title, body_md: markdown }`.

  14e. **Prep engagement_type_blocks[].** For each `related_signal` in `related_signals[]` with `status == "ready"`: push `{ kind: "semantic", callout_type: "example", title: "Related to: <event.title>", body_md: <related_signal.markdown> }`. When `semantic_index_unavailable == true`: push ONCE `{ kind: "semantic-unavailable", callout_type: "warning", title: "Semantic index not available", body_md: "Smart Connections index absent or anchor not indexed — semantic gather skipped." }`. Finance does NOT flow through here — it's written by Step 15's separate sub-skill.

  14f. **Invoke composeBody.** READ `.claude/skills/cowork/skills/compose-body/SKILL.md` in full and follow its `## Compose` section with `{ cadence: "morning-briefing", nav_buttons_block: "<canonical block>", synopsis_md, memory_callouts: { yesterday_md, overnight_md, echoes_md, backlink_md }, ordered_blocks, engagement_type_blocks, closing_md, excluded_themes: plan.excluded_themes, voice_contract: plan.voice_contract }`. The `excluded_themes` field is the v0.95.1 Knob-1 13th plan-dispatch contract key — when `render_aspects.anti_echo == "include"` it carries yesterday's carry-forward bullets verbatim; otherwise `[]`. composeBody gates the anti-echo callout injection internally on cadence eligibility + non-empty excluded_themes. Capture `{ body_md, body_assertions, status }`.

  14g. **Compose failure handling.** If `status` starts with `"failed:"`, emit Notice `cowork:morning-briefing aborted -- compose-body failure: <status>` and exit non-zero. Do NOT call write-run-note. Do NOT run state-update steps.
15. **If `plan.render_aspects.finance_block == "include"`:** READ `.claude/skills/cowork/skills/write-run-note-finance/SKILL.md` in full —
    paying particular attention to its `## Title composition`,
    `## Adaptive body skeleton`, and `## Pre-write self-check` sections — then apply those contracts
    before performing the write described in its `## Steps` section with `{ engagement, date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], body: <step 9.markdown + step 10.markdown>, prompt_source: null, warning: null }`. Best-effort: log status but do not abort if status starts with `"failed:"`.
16. READ `.claude/skills/cowork/skills/write-run-note-morning-briefing/SKILL.md` in full —
    paying particular attention to its `## Title composition`,
    `## Adaptive body skeleton`, and `## Pre-write self-check` sections — then apply those contracts
    before performing the write described in its `## Steps` section with `{ engagement, date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], body: body_md, body_assertions, prompt_source: "spice/cowork/prompts/morning-briefing.md", warning }`. Capture `status`. If `status` starts with `"failed:contract-violation:"`, emit Notice `cowork:morning-briefing aborted -- contract violation: <field>` (where `<field>` is the part after `failed:contract-violation:`). Do not run state-update steps. Exit non-zero.
    Else if `status` starts with `"failed:"` (e.g. `failed:filesystem:permission`, `failed:write-undersized:285`), emit Notice `cowork:morning-briefing aborted -- write failed: <status>` and exit. Do not run state-update steps after a failed write.

## Verify

17. **Re-read + structural verify.** After `write-run-note-morning-briefing` returns a non-`"failed:"` status:

   a. Read the just-written file via the Read tool at `spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/morning-briefing.md` (substituting the values from `context`).
   b. Parse leading frontmatter (YAML between `---` markers) as `parsed_frontmatter`; capture the remainder as `body`.
   c. Assert required frontmatter fields exist and are non-empty strings:
      - `title:`
      - `summary:`
      - `type:` (must equal `cowork-morning-briefing`)
      - `warning:` only when the orchestrator passed a non-null `warning` to write-run-note (otherwise the field is allowed to be absent or `null`).
   d. Regex-scan `body` for required structural markers:
      - SpaceNavButtons block (v0.91.3 canonical pattern — REJECTS hallucinated `const { SpaceNavButtons } = customJS` shape): `/```dataviewjs\s*\n\s*await\s+dv\.view\(\s*["']ranch\/views\/customjs-guard["']\s*,\s*\{\s*class:\s*["']SpaceNavButtons["']\s*\}\s*\)/`
      - At least one Synopsis callout: `/^> \[!info\]- /m`
      - At least one example callout: `/^> \[!example\]\+ /m`
      - Closing tip callout: `/^> \[!tip\] /m`
   e. On ANY frontmatter-field miss or marker miss:
      - Use Bash to delete the file: `rm -f spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/morning-briefing.md`
      - Emit Obsidian Notice: `cowork:morning-briefing aborted -- contract-violation: <missing-field-or-marker-name>`
      - Exit non-zero. Do NOT run subsequent state-update steps.
   f. On all-pass: continue to the State section per the existing flow.

## State

18. READ `.claude/skills/cowork/skills/update-active-threads/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, phase: "morning-pass", date_today: context.today, writer: "cowork:morning-briefing", changes: { new_threads: <step 12.new_threads>, snoozed_to_open: <step 12.snoozed_to_open>, surface_open: true } }`.
19. READ `.claude/skills/cowork/skills/update-weekly-snapshot/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, phase: "morning", date_today: context.today, writer: "cowork:morning-briefing", snapshot_data: { week_of: context.week_of, wtd_spend: <step 9.total_usd or null>, cc_total: <step 10.total_usd or null>, journaled_today: false } }`.

## Done

Emit Obsidian Notice `cowork:morning-briefing complete -- <engagement.label> <context.today>`.

## Harness testing

This orchestrator conforms to `Docs/agent-guides/cowork-orchestrator-template.md` (v1.0.0). Cohesion regression is caught by HC-V0950-COHESION-A1..A5.

A helper at `platform/blueprints/cowork/helpers/dispatch-plan-helper.js` exports `planDispatch`, `decideDispatchMode`, `composeVoiceContract`, `composeWarningCallout`, and the v0.95.0 additive trio `composeFinalPreferences`, `readEngagement`, `loadKindTitles` for the HC-V0780-* / HC-V0950-* harness cases. The cowork:plan-dispatch sub-skill body composes these helpers into the 11-key result tree this orchestrator consumes — orchestrators no longer carry inline dispatch-plan pseudocode.
