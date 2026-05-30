---
name: cowork:midday-tripwire
description: Engagement-aware midday CC tripwire. Writes one atomic note at spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/midday-tripwire.md per scheduled invocation when severity == yellow or red; frontmatter `type: cowork-midday-tripwire` + `severity:`. Silent (no note written) when severity == green. Engagement-aware — fires when engagement.tripwire_aspects is non-empty (personal=cc, w2-fte=calendar/queue, consulting=all). Severity = warn|alert. Body composed from gather outputs interpolated through the user's prompt body at spice/cowork/prompts/midday-tripwire.md. Phrasings = "midday tripwire for <engagement>", "<engagement> midday check", "midday cc check".
schedule: Cron-driven per enabled (engagement, midday) pair (typically only personal-type engagements enable midday)
scope: shared
tags: [cowork, orchestrator, midday, engagement-aware, tripwire-aspects]
---

# cowork:midday-tripwire

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
2. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md`; look up `engagement` by id. If not found, exit silently. Load engagement-type manifest; capture `render_aspects` AND `tripwire_aspects` (defaults to `[]` when field absent). If `tripwire_aspects.length == 0`, exit silently (engagement has no tripwire signals — tripwire is a no-op).
3. READ `.claude/skills/cowork/skills/date-context/SKILL.md` in full and follow
   its `## Steps` section with `{}`. If `context.error`, exit silently.
3b. READ `.claude/skills/cowork/skills/read-user-preferences/SKILL.md` in full and follow
   its `## Steps` section with `{}`. Capture as `prefs_result = { prefs, status, reason }`. Capture `prefs = prefs_result.prefs` (may be null when `status != "ok"`). Do NOT abort on `status != "ok"`; continue with legacy fallback (see step 3c).
3c. **Plan dispatch.** Determine dispatch mode and build the priority-ordered dispatch plan.

   Compute `dispatch_mode`:

   ```
   dispatch_mode = (prefs_result.status === "ok") ? "prefs" : "legacy"
   ```

   When `dispatch_mode == "legacy"`:
   - Emit Obsidian Notice: `cowork:midday-tripwire -- user-preferences <status> (<reason>); using engagement-template defaults`.
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

Each gather call passes `engagement_id`. The orchestrator branches per-aspect from `engagement.tripwire_aspects`.

5. If `"cc_drift"` in `tripwire_aspects`: READ `.claude/skills/cowork/skills/gather-finance-cc-today/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_today: context.today, lookback_start: "06:00", timezone: "America/Denver", classify: true, cards: { active: engagement.cc_active_cards, locked: engagement.cc_locked_cards, ignore: engagement.cc_ignored_cards } }`. Capture `{ markdown, charges, top_merchant_today_total, mtd_discretionary, days_since_splurge_pre }` as `cc_signal`. When CC cards are not configured, treat as `cc_signal = null` (engagement opted into cc_drift but isn't wired yet; surface a one-line Notice and continue).
6. If `"calendar_drift"` in `tripwire_aspects`: READ `.claude/skills/cowork/skills/gather-calendar/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, mode: "drift-check", horizon: "today+4h", timezone: "America/Denver" }`. Capture `{ markdown, drift_minutes, drifted_events }` as `calendar_signal`. On `gather-skipped`, `calendar_signal = null` and append `calendar_unavailable` to the warnings array passed to write.
7. If `"queue_growth"` in `tripwire_aspects`: READ `.claude/skills/cowork/skills/gather-projects/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, mode: "tripwire-delta", since: <yesterday EOD ISO> }`. Capture `{ markdown, new_count, items }` as `queue_signal`.

## Decide

8. **Compute severity** from collected signals:
   (Vocab: `RED`/`YELLOW` below refer to per-charge classifications returned by `gather-finance-cc-today`; `alert`/`warn`/`green` are the orchestrator-level severity values written to the atomic note's `severity:` frontmatter.)
   - `alert` if any of: cc_signal contains a RED-class charge, calendar_signal.drift_minutes >= 60, queue_signal.new_count >= 10
   - `warn`  if any of: cc_signal contains only YELLOW-class charges, calendar_signal.drift_minutes in [30, 59], queue_signal.new_count in [3, 9]
   - `green` if none of the above
   If `green` → exit silently. Do NOT write a "nothing flagged" run-note (atomic-note absence = green; presence = something to flag).

## Write

9. **Read prompt body** via `mcp__obsidian__get_file_contents` at `spice/cowork/prompts/midday-tripwire.md`. Strip frontmatter; capture body as `prompt_body` (or empty when missing).
9b. **Voice contract.** If `dispatch_mode == "prefs"` AND `voice_contract != ""`, prepend it to `prompt_body`:
   `prompt_body = voice_contract + prompt_body`. The combined string is the input to the body-composition step.
10. **Compose run-note body** per `prompt_body` + the flagged-event details from the gather steps.

   When `dispatch_mode == "prefs"`, compose the body as: SpaceNavButtons → `[!info]- Synopsis` paragraph → `ordered_blocks[]` (priority order, in array order) → engagement-type-aspect blocks (semantic_related, finance from render_aspects) → `[!tip]` closing. `ordered_blocks` entries with `kind: "warning"` render as `[!warning]` callouts in-position. When `dispatch_mode == "legacy"`, use the v0.77.0 composition order verbatim (existing body).

   When `prompt_body` is empty, do NOT freelance content — compose a skeleton-compliant STUB body:
    - `SpaceNavButtons` dataviewjs block (verbatim).
    - `> [!info]- Today at a glance\n> Tripwire fired (severity: <severity>). Prompt body empty — edit spice/cowork/prompts/midday-tripwire.md to customize what this run emits.`
    - `> [!example]+ 🚨 Tripwire fired\n> Severity: <severity>. <one-line aspect summary>. Prompt body empty — see spice/cowork/prompts/midday-tripwire.md to customize what this run emits.`
    - `> [!tip] ✏️ Next action\n> Edit \`spice/cowork/prompts/midday-tripwire.md\` to define what this tripwire should emit when it fires.`
    Set `warning = "empty_prompt"` and pass `summary = "Stub run — prompt body at spice/cowork/prompts/midday-tripwire.md is empty."` to write-run-note via its `summary` arg. The write-run-note self-check passes (5 markers + summary + title all present).
    When `prompt_body` is non-empty, set `warning = null` and compose the body per the prompt's instructions, respecting the adaptive body skeleton in write-run-note-midday-tripwire's `## Adaptive body skeleton` section.
11. READ `.claude/skills/cowork/skills/write-run-note-midday-tripwire/SKILL.md` in full —
    paying particular attention to its `## Title composition`,
    `## Adaptive body skeleton`, and `## Pre-write self-check` sections — then apply those contracts
    before performing the write described in its `## Steps` section with `{ engagement, date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], severity, signals: { cc: cc_signal, calendar: calendar_signal, queue: queue_signal }, body: run_body, prompt_source: "spice/cowork/prompts/midday-tripwire.md", warning, warnings: warnings_array }`. The `signals` arg is an opaque structured handoff write-run-note uses to compose the summary line; `warnings_array` is the optional list of `<aspect>_unavailable` strings from gather-skipped returns. Capture `status`. If `status` starts with `"failed:contract-violation:"`, emit Notice `cowork:midday-tripwire aborted -- contract violation: <field>` and exit non-zero. Else if `status` starts with `"failed:"`, emit Notice `cowork:midday-tripwire aborted -- write failed: <status>` and exit. Do not run state-update steps after a failed write.

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
      - SpaceNavButtons block: `/```dataviewjs\n[\s\S]*?SpaceNavButtons[\s\S]*?```/`
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

A helper at `platform/blueprints/cowork/helpers/dispatch-plan-helper.js` exports `planDispatch`, `decideDispatchMode`, `composeVoiceContract`, `composeWarningCallout` for the HC-V0780-C* / D* harness cases. Production agents in consumer vaults execute step 3c's algorithm directly — they do NOT depend on the helper file existing.
