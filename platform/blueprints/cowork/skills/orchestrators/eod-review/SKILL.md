---
name: cowork:eod-review
description: Engagement-aware end-of-day review. Writes one atomic note at spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/eod-review.md per scheduled invocation; frontmatter `type: cowork-eod-review`. Body composed from gather outputs (todo status, morning follow-up, tomorrow preview, late emails, threads) interpolated through the user's prompt body at spice/cowork/prompts/eod-review.md. Phrasings = "eod for <engagement>", "<engagement> eod review", "give me today's eod for <engagement>".
schedule: Cron-driven per enabled (engagement, eod) pair
scope: shared
tags: [cowork, orchestrator, eod, engagement-aware]
---

# cowork:eod-review

Closes the day for one engagement. Compiles completed/incomplete tasks, compares against the morning briefing's flagged items, previews tomorrow's calendar, surfaces late emails, and updates the active-threads ledger. Writes ONE atomic note at `spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/eod-review.md` (deterministic path per `(orchestrator, day)`; overwrite-last-write-wins idempotency). Body shape follows the user's prompt body at `spice/cowork/prompts/eod-review.md`; when the prompt body is empty, emits a no-op note with `warning: empty_prompt`.

This orchestrator NEVER patches the daily note's callouts, edits the daily-note template, or writes to legacy paths. The v0.65.0 atomic-note write contract is the only output surface.

## Inputs

```
{
  engagement_id: string
}
```

## Pre-flight

1. READ `.claude/skills/cowork/skills/check-vault-routing/SKILL.md` in full and follow
   its `## Steps` section with `{ required: ["obsidian"] }`. If not `"ready"`, emit Notice `cowork:eod-review aborted -- <status>` and exit.
2. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md`; look up engagement by id. If not found, exit silently. Read the engagement-type manifest via the Read tool at `spice/cowork/context/engagement-types/<engagement.type>.json` (expected values: `personal`, `w2-fte`, `consulting`). Parse as JSON; capture `engagement` + `render_aspects`. If the file is missing or fails to parse, emit Notice `cowork:eod-review aborted -- engagement-type manifest unavailable at spice/cowork/context/engagement-types/<engagement.type>.json` and exit.
3. READ `.claude/skills/cowork/skills/date-context/SKILL.md` in full and follow
   its `## Steps` section with `{}`. Capture `context` (today, tomorrow, daily_path, tomorrow_daily_path, tomorrow_weekday).
3a. **Read recent memory.** (NEW v0.86.0; mirrors morning-briefing's step 3a refactor.)

   3a.i Invoke sub-skill `cowork:read-memory` with input `{ engagement_id, tier: "tick", window: "today" }`. Capture `output_today`. The sub-skill returns null-data when no memory file exists — preserve as `output_today = null` for the body-composition step.

   3a.ii Invoke sub-skill `cowork:read-memory` with input `{ engagement_id, tier: "day", window: "today" }`. Capture `output_day` for the day-synthesis callout. Same null-data preservation as `output_day = null`.

   Both invocations are PURE (no MCP calls, no writes). NEW in v0.86.0.
3b. READ `.claude/skills/cowork/skills/read-user-preferences/SKILL.md` in full and follow
   its `## Steps` section with `{}`. Capture as `prefs_result = { prefs, status, reason }`. Capture `prefs = prefs_result.prefs` (may be null when `status != "ok"`). Do NOT abort on `status != "ok"`; continue with legacy fallback (see step 3c).
3c. **Plan dispatch.** Determine dispatch mode and build the priority-ordered dispatch plan.

   Compute `dispatch_mode`:

   ```
   dispatch_mode = (prefs_result.status === "ok") ? "prefs" : "legacy"
   ```

   When `dispatch_mode == "legacy"`:
   - Emit Obsidian Notice: `cowork:eod-review -- user-preferences <status> (<reason>); using engagement-template defaults`.
   - Skip the remainder of step 3c. The legacy gather sequence fires unchanged.

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
3d. **Pre-resolve inner-circle people.** Read `engagement.inner_circle_people: string[]` (when present; skip step on empty). When `engagement.inner_circle_people` is empty / absent, set `allowlist = { resolved: [], unresolved: [], phone_filter_list: [] }` as the default for downstream pseudocode.

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

   For each name in `allowlist.unresolved[]`, emit Notice `cowork: inner-circle name "<name>" unresolved` AND append `inner_circle_unresolved:<name>` to the atomic note's `warnings:` array (v0.85.0 plumbing).

   (This orchestrator does NOT call `gather-imessage`; `phone_filter_list` is unused here.)
4. READ `.claude/skills/cowork/skills/ensure-daily-note/SKILL.md` in full and follow
   its `## Steps` section with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

When `dispatch_mode == "legacy"`, execute the v0.77.0 legacy gather sequence below verbatim. `ordered_blocks[]` stays empty.

When `dispatch_mode == "prefs"`, skip the legacy steps; execute the priority-loop:

```
ordered_blocks = []
for entry in dispatch_plan:
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
      what_matters:         entry.what_matters,     # microscope body when entry.microscope == true
      question_set_answers: entry.question_set_answers,
      hard_rules:           prefs.effective_hard_rules,
      siblings:             siblings[entry.kind_name] || [],
      callout_type:         prefs.mcps[entry.kind_name].callout_type,
      inner_circle_resolved: allowlist.resolved,
      engagement_id:        engagement_id,
      today:                context.today,
      range:                { start: context.today, end: context.today },
      timezone:             engagement.timezone || "America/Denver"
    }
    # When entry.baseline_notes is set (microscope-routed kind), treat it as secondary
    # "baseline preferences" context behind the microscope contract.
    if result.status == "ready":
      ordered_blocks.push({ kind_name, markdown: result.markdown, kind: "example" })
    else:
      md = composeWarningCallout({ kind_name, kind_title, reason: result.status, mcps_entry })
      ordered_blocks.push({ kind_name, markdown: md, kind: "warning" })

# After the priority loop, run engagement-type-aspect gathers per existing
# render_aspects gates. These remain APPENDED AFTER ordered_blocks in the
# composed body.
```

*(existing legacy-mode gather steps preserved verbatim below — these fire ONLY when `dispatch_mode == "legacy"`)*

5. READ `.claude/skills/cowork/skills/gather-projects/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, filter: "today-status", today: context.today }`. Capture completed / incomplete / kanban buckets.
6. READ `.claude/skills/cowork/skills/gather-calendar/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_today: context.tomorrow, horizon: "today", timezone: "America/Denver" }`.
7. READ `.claude/skills/cowork/skills/gather-gmail/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, window: "newer_than:12h" }`. Compute `late_emails` = emails arrived after morning-briefing run time.
8. READ `.claude/skills/cowork/skills/gather-threads/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_today: context.today, mode: "eod-reconcile" }`.
9. Compose `morning_followup` summary by reading the matching `## Morning — <engagement.label>` block in today's daily note: `{ flagged_transactions, unanswered_messages, threads: { resolved, snoozed, still_open } }`.
9b. **Semantic related.** If `render_aspects.semantic_related == "include"`:
    READ `.claude/skills/cowork/skills/gather-semantic-related/SKILL.md` in full and follow its `## Steps` section with `{
      mode: "find-related",
      anchor: context.daily_path,
      top_k: 5,
      callout_title: "Notes thematically close to today"
    }`
    Capture as `related_signal`. `semantic_index_age = related_signal.index_age_minutes`.

## Write

10. **Read prompt body** with fallback chain:
    - Read `spice/cowork/prompts/eod-review.md` via `mcp__obsidian__get_file_contents`. Strip frontmatter; capture body as `user_prompt_body` (or empty when missing).
    - If `user_prompt_body` is empty, read `spice/cowork/context/engagement-templates/<engagement.type>/prompts/eod-review.md` (substitute `<engagement.type>` from the resolved engagement; expected values: `personal`, `w2-fte`, `consulting`). Strip frontmatter; capture as `template_prompt_body` (or empty when missing).
    - Set `prompt_body = user_prompt_body || template_prompt_body` (use user prompt when populated; else fall back to engagement-template prompt; else empty).
    - Set `prompt_source` accordingly: if `user_prompt_body` non-empty, `prompt_source = "spice/cowork/prompts/eod-review.md"`; else if `template_prompt_body` non-empty, `prompt_source = "spice/cowork/context/engagement-templates/<engagement.type>/prompts/eod-review.md"`; else `prompt_source = "spice/cowork/prompts/eod-review.md"` (the user-prompt path is still the canonical pointer when both empty — the stub references it).
10b. **Voice contract.** If `dispatch_mode == "prefs"` AND `voice_contract != ""`, prepend it to `prompt_body`:
   `prompt_body = voice_contract + prompt_body`. The combined string is the input to the body-composition step.
11. **Compose run-note body** per `prompt_body` instructions interpolating gather outputs.

   When `dispatch_mode == "prefs"`, compose the body as: SpaceNavButtons → `[!info]- Synopsis` paragraph → `ordered_blocks[]` (priority order, in array order) → engagement-type-aspect blocks (semantic_related, finance from render_aspects) → `[!tip]` closing. `ordered_blocks` entries with `kind: "warning"` render as `[!warning]` callouts in-position. When `dispatch_mode == "legacy"`, use the v0.77.0 composition order verbatim (existing body).

   When `prompt_body` is empty, do NOT freelance content — compose a skeleton-compliant STUB body:
    - `SpaceNavButtons` dataviewjs block (verbatim).
    - `> [!info]- Today at a glance\n> (Prompt body empty — edit spice/cowork/prompts/eod-review.md to customize what this run emits.)`
    - `> [!example]+ 📋 Status\n> No prompt body to drive content; this run is a placeholder.`
    - `> [!tip] ✏️ Next action\n> Edit \`spice/cowork/prompts/eod-review.md\` to define what this scheduled job should emit when it fires.`
    Set `warning = "empty_prompt"` and pass `summary = "Stub run — prompt body at spice/cowork/prompts/eod-review.md is empty."` to write-run-note via its `summary` arg. The write-run-note self-check passes (5 markers + summary + title all present).
    When `prompt_body` is non-empty, set `warning = null` and compose the body per the prompt's instructions, respecting the adaptive body skeleton in write-run-note-eod-review's `## Adaptive body skeleton` section.
    **Semantic interpolation** (applies when `prompt_body` is non-empty and step 9b ran):
    - If `semantic_index_age` is non-null, append `> Semantic index age: <semantic_index_age>m` as the last line inside the `> [!info]- Synopsis` callout (before its closing blank line).
    - If `related_signal.status == "ready"`, append the markdown block returned by gather-semantic-related as a `> [!example]+ 🧩 Notes thematically close to today` callout, placed after the last primary example block and before the closing `> [!tip]`.
    - **ONLY IF step 9b ran** (i.e., `render_aspects.semantic_related == "include"`) AND `related_signal.status` starts with `skipped:no-index` OR `skipped:anchor-not-indexed`, append ONE `> [!warning]- Semantic index not available\n> Smart Connections index absent or anchor not indexed — semantic gather skipped.` callout after the Synopsis admonition. Text matches the canonical contract in `cowork:gather-semantic-related`'s `## Orchestrator integration contract` section — do not paraphrase; copy exactly (note the em-dash, not two hyphens). Idempotent: never emit more than one such warning callout per run.
    - **When step 9b did NOT run** (`render_aspects.semantic_related != "include"`): NO warning callout is emitted. The atomic-note body remains structurally clean.
    - **NEW (v0.86.0): Today's memory.** Invoke pure helper `composeEodMemoryCallout(output_today, output_day)` from `helpers/compose-eod-memory-callout.js` → `{ tickLogCalloutMd, dayPatternCalloutMd }`. When `tickLogCalloutMd` is non-empty, append after the synopsis. When `dayPatternCalloutMd` is non-empty, append after the tick log (or after the synopsis if tick log was empty). Both empty = omit cleanly.
    - **NEW (v0.85.0): Memory log backlink.** Append a final `[!quote]-` callout (collapsed by default) at the very end of the atomic note body:

      ```
      > [!quote]- Memory log
      > Today's memory: [[spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<YYYY-MM-DD>/memory.md|Memory log — <YYYY-MM-DD> (<tick_count_if_known> ticks)]]
      ```

      Substitute `<engagement_id>`, `<YYYY>`, `<MM-Month>`, `<YYYY-MM-DD>` from `date-context.today`. When `tick_count` is unknown (today's memory.md not yet read), omit the `(<N> ticks)` parenthetical. The wikilink target may not resolve when no tick has fired yet — Obsidian renders it dimmed (acceptable per v0.85.0 design § 2.1.3). Collapsed callout (`-` suffix) keeps the atomic note visually clean.
12. READ `.claude/skills/cowork/skills/write-run-note-eod-review/SKILL.md` in full —
    paying particular attention to its `## Title composition`,
    `## Adaptive body skeleton`, and `## Pre-write self-check` sections — then apply those contracts
    before performing the write described in its `## Steps` section with `{ engagement, date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], body: run_body, prompt_source: prompt_source, warning }`. Capture `status`. If `status` starts with `"failed:contract-violation:"`, emit Notice `cowork:eod-review aborted -- contract violation: <field>` (where `<field>` is the part after `failed:contract-violation:`). Do not run state-update steps. Exit non-zero.
    Else if `status` starts with `"failed:"` (e.g. `failed:filesystem:permission`, `failed:write-undersized:285`), emit Notice `cowork:eod-review aborted -- write failed: <status>` and exit. Do not run state-update steps after a failed write.

## Verify

13. **Re-read + structural verify.** After `write-run-note-eod-review` returns a non-`"failed:"` status:

   a. Read the just-written file via the Read tool at `spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/eod-review.md` (substituting the values from `context`).
   b. Parse leading frontmatter (YAML between `---` markers) as `parsed_frontmatter`; capture the remainder as `body`.
   c. Assert required frontmatter fields exist and are non-empty strings:
      - `title:`
      - `summary:`
      - `type:` (must equal `cowork-eod-review`)
      - `warning:` only when the orchestrator passed a non-null `warning` to write-run-note (otherwise the field is allowed to be absent or `null`).
   d. Regex-scan `body` for required structural markers:
      - SpaceNavButtons block: `/```dataviewjs\n[\s\S]*?SpaceNavButtons[\s\S]*?```/`
      - At least one Synopsis callout: `/^> \[!info\]- /m`
      - At least one example callout: `/^> \[!example\]\+ /m`
      - Closing tip callout: `/^> \[!tip\] /m`
   e. On ANY frontmatter-field miss or marker miss:
      - Use Bash to delete the file: `rm -f spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/eod-review.md`
      - Emit Obsidian Notice: `cowork:eod-review aborted -- contract-violation: <missing-field-or-marker-name>`
      - Exit non-zero. Do NOT run subsequent state-update steps.
   f. On all-pass: continue to the State section per the existing flow.

## State

14. READ `.claude/skills/cowork/skills/update-active-threads/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, phase: "eod-pass", date_today: context.today, writer: "cowork:eod-review", changes: { resolved: <step 8.resolved_today>, snoozed_to_open: <step 8.snoozed_today>, new_threads: <step 8.auto_created_eod> } }`.
15. READ `.claude/skills/cowork/skills/update-weekly-snapshot/SKILL.md` in full and follow
    its `## Steps` section with `{ engagement_id, phase: "eod", date_today: context.today, writer: "cowork:eod-review", snapshot_data: { completed_count: <step 5.completed.length>, carryover_count: <step 5.incomplete.length>, threads_resolved_today: <step 8.resolved_today.length> } }`.

## Done

## Harness testing

A helper at `platform/blueprints/cowork/helpers/dispatch-plan-helper.js` exports `planDispatch`, `decideDispatchMode`, `composeVoiceContract`, `composeWarningCallout` for the HC-V0780-C* / D* harness cases. Production agents in consumer vaults execute step 3c's algorithm directly — they do NOT depend on the helper file existing.
