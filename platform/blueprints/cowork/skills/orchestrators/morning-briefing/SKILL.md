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
1b. **Verbal commitment (v0.91.1).** Before any other action, emit Obsidian Notice and treat it as a binding commitment for this run:

   ```
   cowork:morning-briefing committing to canonical write path: spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/morning-briefing.md (NOT spice/daily/<weekday>-<YYYY-MM-DD>.md)
   ```

   This Notice serves two purposes: (1) commit the path to the LLM's working memory at run-start so it stays salient even after long gather + compose steps, (2) create an audit trail in the Obsidian Notice log if a wrong-path write happens despite the commitment. The v0.91.1 write-guard in `cowork:write-run-note-morning-briefing` enforces the canonical path deterministically at write time; this verbal commitment is the prose-side layer.

2. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md` via `mcp__obsidian__get_frontmatter`. Look up `engagements[]` entry where `id == engagement_id`. If not found, emit Notice `cowork:morning-briefing aborted -- engagement '<id>' not found in vault-config.md` and exit. Capture `engagement` (the full record) and read the matching engagement-type manifest via the Read tool at `spice/cowork/context/engagement-types/<engagement.type>.json` (expected values: `personal`, `w2-fte`, `consulting`). Parse as JSON; capture `type_manifest.render_aspects`. If the file is missing or fails to parse, emit Notice `cowork:morning-briefing aborted -- engagement-type manifest unavailable at spice/cowork/context/engagement-types/<engagement.type>.json` and exit. The render-aspects map drives which gather + write steps fire (e.g. `finance_block: include` enables the Finance callout; `inner_circle_imessage: include` enables Messages).
3. READ `.claude/skills/cowork/skills/date-context/SKILL.md` in full and follow
   its `## Steps` section with `{}`. Capture the returned `context` object. If `context.error` exists, emit Notice and exit.
3a. **Read recent memory.** (REFACTORED v0.85.0; output byte-identical to v0.84.0.)

   3a.i Invoke sub-skill `cowork:read-memory` with input `{ engagement_id, tier: "day", window: "yesterday" }`. Capture `output_yesterday`. The sub-skill returns null-data when no memory file exists — preserve as `output_yesterday = null` for the body-composition step.

   3a.ii Invoke sub-skill `cowork:read-memory` with input `{ engagement_id, tier: "tick", window: "today", limit_ticks: 6 }`. Capture `output_overnight`. Same null-data preservation.

   Both invocations are PURE (no MCP calls, no writes). New in v0.85.0 (refactor of v0.84.0's inline file-read).
3b. **Gather semantic echoes.** (NEW v0.87.0; PURE — no MCP calls.)

   Compose `anchor_text` from `dispatch_plan_summary` + today's `calendar_summary` + `email_summary` (≤500 chars total; join with " · " separator). When all three are empty, skip this step and set `output_echoes = null`.

   Invoke sub-skill `cowork:gather-semantic-memory` with input `{ engagement_id, anchor_text, top_k: 2, exclude_window: "last-30d", min_similarity: 0.45 }`. Capture `output_echoes`.

   The sub-skill returns null-data when corpus is thin OR sc-bridge unavailable OR SC index missing — preserve as `output_echoes = null` (or the returned null-data object) for the body-composition step.
3c. READ `.claude/skills/cowork/skills/read-user-preferences/SKILL.md` in full and follow
   its `## Steps` section with `{}`. Capture as `prefs_result = { prefs, status, reason }`. Capture `prefs = prefs_result.prefs` (may be null when `status != "ok"`). Do NOT abort on `status != "ok"`; continue with legacy fallback (see step 3d).
3d. **Plan dispatch.** Determine dispatch mode and build the priority-ordered dispatch plan.

   Compute `dispatch_mode`:

   ```
   dispatch_mode = (prefs_result.status === "ok") ? "prefs" : "legacy"
   ```

   When `dispatch_mode == "legacy"`:
   - Emit Obsidian Notice: `cowork:morning-briefing -- PREFS UNAVAILABLE (<status>: <reason>); falling back to legacy mode. Chat and any custom kinds will NOT fire in legacy mode; inner-circle wikilink emission will NOT occur. Investigate user-preferences.md if this is unexpected.` (where `<status>` and `<reason>` come from `prefs_result`).
   - Skip the remainder of step 3d. The legacy gather sequence (steps 5-12) fires unchanged.

   When `dispatch_mode == "prefs"`:

   1. From `check-vault-routing`'s prior result (pre-flight step 1), capture `reachable_namespaces` as the set of MCP namespace segments the agent has tools for in this session. Extract by walking your tool list: for every `mcp__<ns>__<tool>` name, add `<ns>` to the set.

   2. Read `mcp-skill-map.json` from `spice/cowork/context/mcp-skill-map.json` via the Read tool. Capture as `mcp_skill_map`. (The map is materialized into every consumer vault as a `files[]` entry.)

   2b. **Read per-kind microscope contracts.** For each `kind_name` in `prefs.priorities`, check whether `spice/cowork/prompts/per-mcp/<kind_name>/microscope.md` exists (via `mcp__obsidian__get_file_contents`; treat a not-found error as absent). When present, strip any leading frontmatter and capture the body as `microscopes[kind_name]`. Build the `microscopes` map (kind_name → body string). Kinds without a file are simply absent from the map.

   2c. **Read per-kind sibling files.** For each `kind_name` in `prefs.priorities`, list the contents of `spice/cowork/prompts/per-mcp/<kind_name>/` via `mcp__obsidian__list_files_in_dir` (treat dir-not-found as empty). Filter the result to files matching the `per-mcp/<kind_name>/*.md` glob, then exclude `microscope.md` and any filename matching `^_.*\.md$` (underscore-prefix files are user drafts — never injected). For each remaining file, read its body via `mcp__obsidian__get_file_contents`, strip any leading frontmatter, and append `{ name: <filename>, body: <stripped body> }` to `siblings[kind_name]`. Kinds without a per-mcp dir, or with only `microscope.md` + `_*.md` files, get `siblings[kind_name] = []`. This step is PURE — no MCP gather calls, no writes.

   3. Build `dispatch_plan[]` as an ordered array. For each `kind_name` in `prefs.priorities` (in order):

      ```
      mcps_entry = prefs.mcps[kind_name]    # may be undefined

      # Compute kind_title
      if kind_name in {calendar, email, chat, finance}:
          kind_title = canonical lookup ("Calendar", "Email", "Chat", "Finance")
      else:
          kind_title = title-case of kind_name (whitespace/underscore-split; "ado" -> "Ado", "github" -> "Github", "monitoring" -> "Monitoring")

      # Determine action
      if mcps_entry is undefined:
          push { kind_name, action: "warn", reason: "not_classified", kind_title, mcps_entry: null }
          continue
      if mcps_entry.connected == false:
          push { kind_name, action: "warn", reason: "not_connected", kind_title, mcps_entry }
          continue
      if mcps_entry.served_by is set and not in reachable_namespaces:
          push { kind_name, action: "warn", reason: "served_by_unreachable", kind_title, mcps_entry }
          continue
      # v0.79.0: a per-kind microscope contract forces served-by routing with the
      # microscope body as the deep what_matters (notes preserved as baseline_notes)
      if microscopes[kind_name] is present and non-empty:
          push {
            kind_name,
            action: "gather_from_served_by",
            served_by: mcps_entry.served_by,
            what_matters: microscopes[kind_name],
            baseline_notes: mcps_entry.what_matters or "",
            question_set_answers: null,
            kind_title,
            microscope: true,
            mcps_entry,
          }
          continue
      if mcps_entry.custom_kind == true OR mcps_entry.override_classified == true:
          bookkeeping = {served_by, what_matters, connected, captured_at, custom_kind, override_classified}
          question_set_answers = {k: v for k, v in mcps_entry if k not in bookkeeping}
          push {
            kind_name,
            action: "gather_from_served_by",
            served_by: mcps_entry.served_by,
            what_matters: mcps_entry.what_matters or "",
            question_set_answers: mcps_entry.custom_kind ? null : (question_set_answers if non-empty else null),
            kind_title,
            mcps_entry,
          }
          continue
      # Default: known canonical-vendor kind (kind_name in mcp_skill_map.kinds[].kind)
      if any entry in mcp_skill_map.kinds has .kind == kind_name:
          push {
            kind_name,
            action: "gather_canonical",
            gather_skill: <that entry>.gather_skill,
            kind_title,
            mcps_entry,
          }
      else:
          # Rare: kind name not recognized and not flagged custom — treat as gather_from_served_by
          push { kind_name, action: "gather_from_served_by", served_by, what_matters, question_set_answers: null, kind_title, mcps_entry }
      ```

   4. Capture `voice_contract` from `prefs.personality` and `prefs.effective_hard_rules`: if every personality field (`vibe`, `formality`, `pep_talk`, `length`, `notes`) is null/undefined AND `prefs.effective_hard_rules` is empty, `voice_contract = ""`. Otherwise compose:

      ```
      Voice contract (from spice/cowork/context/user-preferences.md):
      - Vibe: <prefs.personality.vibe or "default">
      - Formality: <prefs.personality.formality or "default">
      - Pep talk: <"yes" if prefs.personality.pep_talk else "no">
      - Length: <prefs.personality.length or "default">
      - Notes: <prefs.personality.notes verbatim, collapsed to single line>

      Apply this voice ONLY to narrative sections (frontmatter summary, [!info]- synopsis, [!tip] closing). Do NOT apply to tabular [!example]+ blocks (their content comes from gather sub-skills and is contractually shaped).

      Hard rules (non-negotiable, apply verbatim to ALL output — narrative AND callout titles/bodies):
      - <each entry of prefs.effective_hard_rules on its own line; omit this whole block when the list is empty>

      ---

      ```

   This step is PURE — no MCP calls, no file writes. It builds in-memory state used by the gather phase.
3e. **Pre-resolve inner-circle people.** Read `engagement.inner_circle_people: string[]` (when present; skip step on empty). When `engagement.inner_circle_people` is empty / absent, set `allowlist = { resolved: [], unresolved: [], phone_filter_list: [] }` as the default for downstream pseudocode.

   For each name in the array, call `cowork:resolve-person { input: <name>, prefer_type: "name", engagement_id: <engagement_id> }`. Thread the original name as `_input` on each output so the helper can surface unresolved names verbatim.

   Accumulate the resolver outputs into an array. Invoke the helper:

   ```js
   const { composeInnerCircleAllowlist } = require("<workshop>/platform/blueprints/cowork/helpers/resolve-inner-circle-helper.js");
   const allowlist = composeInnerCircleAllowlist(resolverOutputs);
   // allowlist = { resolved: [{name, person_link, person_basename, aliases_by_type, matched_via, collision_warning}],
   //               unresolved: ["<name>", ...],
   //               phone_filter_list: ["+E.164...", ...] }
   ```

   Pass `allowlist.resolved` as `inner_circle_resolved` AND `engagement_id` to every `gather-from-served-by` invocation in the kind loop.

   Pass `allowlist.phone_filter_list.join(",")` as `gather-imessage`'s existing `inner_circle` input (E.164 phones, comma-separated) — preserves the v0.89.0 contract.

   For each name in `allowlist.unresolved[]`, emit Notice `cowork: inner-circle name "<name>" unresolved` AND append `inner_circle_unresolved:<name>` to the atomic note's `warnings:` array (v0.85.0 plumbing).

   This step is PURE on the helper side; the per-name `cowork:resolve-person` calls are MCP-bound.
4. READ `.claude/skills/cowork/skills/ensure-daily-note/SKILL.md` in full and follow
   its `## Steps` section with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

> **MANDATORY:** When `dispatch_mode == "prefs"`, execute the priority loop for EVERY entry in `dispatch_plan`. Do NOT skip the loop in favor of memory-tick synthesis. Memory ticks are SUPPLEMENTARY context for the `[!info]- Today at a glance` synopsis section; they DO NOT replace live MCP gather output. When a kind's `action == "warn"`, emit the warning callout in-position via `composeWarningCallout`; do NOT silently drop it. Failing to fire the priority loop means the dispatch contract's "Known people in scope" wikilink instruction never reaches the LLM, and inner-circle names render as plaintext instead of `**[[Name]]**` wikilinks.

When `dispatch_mode == "legacy"`, execute the v0.77.0 legacy gather sequence in steps 5-12 below verbatim. `ordered_blocks[]` stays empty; gather outputs flow through their existing composition slots in step 14.

When `dispatch_mode == "prefs"`, skip steps 5-12 below; instead execute the priority-loop:

```
ordered_blocks = []
for entry in dispatch_plan:
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
      hard_rules:           prefs.effective_hard_rules,
      siblings:             siblings[entry.kind_name] || [],
      callout_type:         prefs.mcps[entry.kind_name].callout_type,
      inner_circle_resolved: allowlist.resolved,
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
# per the existing render_aspects gates from legacy step 12b and step 15.
# These remain APPENDED AFTER ordered_blocks in the composed body.
```

Legacy-mode gather steps (executed only when `dispatch_mode == "legacy"`):

Each gather call passes `engagement_id`. The sub-skill reads per-engagement MCP-scoped fields (gmail_label / calendar_id) from vault-config.md and may type-gate (e.g. `gather-imessage` early-exits for non-personal engagements). Renderable steps skip silently when their `render_aspects` flag is `skip`.

5. READ `.claude/skills/cowork/skills/gather-weather/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, city: engagement.home_city, days_ahead: 3 }` (personal only — skipped when `render_aspects.weather` is not present in engagement type).
6. READ `.claude/skills/cowork/skills/gather-calendar/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_today: context.today, horizon: "today+next-2-days", timezone: "America/Denver" }`.
7. READ `.claude/skills/cowork/skills/gather-gmail/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, window: "newer_than:1d" }`.
8. READ `.claude/skills/cowork/skills/gather-imessage/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, window_days: 3, scope: "inner-circle-and-groups", inner_circle: allowlist.phone_filter_list.join(",") }` (gated: early-exit if engagement.type != "personal"). The `phone_filter_list` comes from Step 3e's `composeInnerCircleAllowlist` invocation; empty string when no inner-circle is configured.
9. If `render_aspects.finance_block == "include"`: READ `.claude/skills/cowork/skills/gather-finance-yesterday/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_yesterday: context.yesterday, mode: "daily" }`.
10. If `render_aspects.finance_block == "include"`: READ `.claude/skills/cowork/skills/gather-cc-debt-snapshot/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, date_today: context.today, mode: "daily" }`.
11. READ `.claude/skills/cowork/skills/gather-projects/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, filter: "active", today: context.today, carry_over_from: context.yesterday_daily_path }`.
12. READ `.claude/skills/cowork/skills/gather-threads/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, date_today: context.today, mode: "morning-surface" }`.
12b. **Semantic related.** If `render_aspects.semantic_related == "include"` AND `calendar_signal.events.length > 0`:
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
13b. **Voice contract.** If `dispatch_mode == "prefs"` AND `voice_contract != ""`, prepend it to `prompt_body`:
   `prompt_body = voice_contract + prompt_body`. The combined string is the input to step 14 composition. If `voice_contract == ""`, prompt_body passes through unchanged.
14. **Compose run-note body** from the gather outputs (steps 5–12b), interpolating per `prompt_body` instructions.

   When `dispatch_mode == "prefs"`, compose the body as: SpaceNavButtons → `[!info]- Today at a glance` synopsis → NEW memory callouts (gated; see below) → `ordered_blocks[]` (priority order, in array order) → engagement-type-aspect blocks (semantic_related, finance from render_aspects) → `[!tip] Today's focus` closing. ordered_blocks entries with `kind: "warning"` render as `[!warning]` callouts in-position (priority preserved). When `dispatch_mode == "legacy"`, use the v0.77.0 composition order verbatim (existing step 14 body).

    - **NEW (v0.85.0): Memory callouts (REFACTORED).** Invoke pure helper `composeMemoryCallouts(output_yesterday, output_overnight)` from `helpers/compose-memory-callouts.js` → `{ yesterdayCalloutMd, overnightCalloutMd }`. When `yesterdayCalloutMd` is non-empty, append immediately after the synopsis callout. When `overnightCalloutMd` is non-empty, append immediately after the Yesterday callout (or after the synopsis if Yesterday was empty). Both empty strings = omit cleanly (matches v0.84.0 null-data backward-compat). Output is byte-identical to v0.84.0's hand-composed prose given the same memory.md input; golden-fixture asserted by HC-V0850-C3..C5.

    - **NEW (v0.87.0): Echoes from your record.** Invoke pure helper `composeSemanticEchoesCallout(output_echoes)` from `helpers/compose-semantic-echoes-callout.js`. When non-empty, append immediately after the Overnight callout (or after the synopsis if Overnight + Yesterday were both empty). Empty string = omit cleanly (null-data backward-compat for vaults with thin corpus or no sc-bridge installed).

   When `prompt_body` is empty, do NOT freelance content — compose a skeleton-compliant STUB body:
    - `SpaceNavButtons` dataviewjs block (verbatim).
    - `> [!info]- Today at a glance\n> (Prompt body empty — edit spice/cowork/prompts/morning-briefing.md to customize what this run emits.)`
    - `> [!example]+ 📋 Status\n> No prompt body to drive content; this run is a placeholder.`
    - `> [!tip] ✏️ Next action\n> Edit \`spice/cowork/prompts/morning-briefing.md\` to define what this scheduled job should emit when it fires.`
    Set `warning = "empty_prompt"` and pass `summary = "Stub run — prompt body at spice/cowork/prompts/morning-briefing.md is empty."` to write-run-note via its `summary` arg. The write-run-note self-check passes (5 markers + summary + title all present).
    When `prompt_body` is non-empty, set `warning = null` and compose the body per the prompt's instructions, respecting the adaptive body skeleton in write-run-note-morning-briefing's `## Adaptive body skeleton` section.
    **Semantic interpolation** (applies when `prompt_body` is non-empty and step 12b ran):
    - If `semantic_index_age` is non-null, append `> Semantic index age: <semantic_index_age>m` as the last line inside the `> [!info]- Synopsis` callout (before its closing blank line).
    - For each `related_signal` in `related_signals[]` where `related_signal.status == "ready"`, append the markdown block returned by gather-semantic-related as a `> [!example]+ 🧩 Related to: <event.title>` callout immediately after the calendar-event line that matches `event.title`.
    - **ONLY IF step 12b ran** (i.e., `calendar_signal.events.length > 0`) AND any `related_signal.status` starts with `skipped:no-index` OR `skipped:anchor-not-indexed`: set `semantic_index_unavailable = true` and append ONE `> [!warning]- Semantic index not available\n> Smart Connections index absent or anchor not indexed — semantic gather skipped.` callout after the Synopsis admonition. Text matches the canonical contract in `cowork:gather-semantic-related`'s `## Orchestrator integration contract` section — do not paraphrase; copy exactly (note the em-dash, not two hyphens). Idempotent: never emit more than one such warning callout per run regardless of how many per-event calls skipped.
    - **When step 12b did NOT run** (calendar empty, or `render_aspects.semantic_related != "include"`): leave `semantic_index_unavailable = false` (default) and **NO warning callout is emitted**. The atomic-note body remains structurally clean — the absence of a semantic gather is not itself a contract violation.
    - **NEW (v0.85.0): Memory log backlink.** Append a final `[!quote]-` callout (collapsed by default) at the very end of the atomic note body:

      ```
      > [!quote]- Memory log
      > Today's memory: [[spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<YYYY-MM-DD>/memory.md|Memory log — <YYYY-MM-DD> (<tick_count_if_known> ticks)]]
      ```

      Substitute `<engagement_id>`, `<YYYY>`, `<MM-Month>`, `<YYYY-MM-DD>` from `date-context.today`. When `tick_count` is unknown (today's memory.md not yet read), omit the `(<N> ticks)` parenthetical. The wikilink target may not resolve when no tick has fired yet — Obsidian renders it dimmed (acceptable per v0.85.0 design § 2.1.3). Collapsed callout (`-` suffix) keeps the atomic note visually clean.
15. **If `render_aspects.finance_block == "include"`:** READ `.claude/skills/cowork/skills/write-run-note-finance/SKILL.md` in full —
    paying particular attention to its `## Title composition`,
    `## Adaptive body skeleton`, and `## Pre-write self-check` sections — then apply those contracts
    before performing the write described in its `## Steps` section with `{ engagement, date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], body: <step 9.markdown + step 10.markdown>, prompt_source: null, warning: null }`. Best-effort: log status but do not abort if status starts with `"failed:"`.
16. READ `.claude/skills/cowork/skills/write-run-note-morning-briefing/SKILL.md` in full —
    paying particular attention to its `## Title composition`,
    `## Adaptive body skeleton`, and `## Pre-write self-check` sections — then apply those contracts
    before performing the write described in its `## Steps` section with `{ engagement, date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], body: run_body, prompt_source: "spice/cowork/prompts/morning-briefing.md", warning }`. Capture `status`. If `status` starts with `"failed:contract-violation:"`, emit Notice `cowork:morning-briefing aborted -- contract violation: <field>` (where `<field>` is the part after `failed:contract-violation:`). Do not run state-update steps. Exit non-zero.
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
      - SpaceNavButtons block: `/```dataviewjs\n[\s\S]*?SpaceNavButtons[\s\S]*?```/`
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

A helper at `platform/blueprints/cowork/helpers/dispatch-plan-helper.js` exports `planDispatch`, `decideDispatchMode`, `composeVoiceContract`, `composeWarningCallout` for the HC-V0780-C* / D* harness cases. Production agents in consumer vaults execute step 3d's algorithm directly — they do NOT depend on the helper file existing.
