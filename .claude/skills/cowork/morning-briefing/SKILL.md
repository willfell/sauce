---
name: cowork:morning-briefing
description: Engagement-aware morning briefing. Writes one atomic note at spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/morning-briefing.md per scheduled invocation; frontmatter `type: cowork-morning-briefing`. Body composed from gather outputs (calendar/email/messages/finance/projects/threads) interpolated through the user's prompt body at spice/cowork/prompts/morning-briefing.md. Phrasings = "morning briefing for <engagement>", "give me today's morning for <engagement>", "<engagement> morning briefing".
schedule: Cron-driven per enabled (engagement, morning) pair (paste-blocks emitted by cowork:bootstrap-vault step 22)
scope: shared
tags: [cowork, orchestrator, morning, engagement-aware]
---

# cowork:morning-briefing

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
2. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md` via `mcp__obsidian__get_frontmatter`. Look up `engagements[]` entry where `id == engagement_id`. If not found, emit Notice `cowork:morning-briefing aborted -- engagement '<id>' not found in vault-config.md` and exit. Capture `engagement` (the full record) and load the matching engagement-type manifest from the registry; capture `type_manifest.render_aspects`. The render-aspects map drives which gather + write steps fire (e.g. `finance_block: include` enables the Finance callout; `inner_circle_imessage: include` enables Messages).
3. READ `.claude/skills/cowork/skills/date-context/SKILL.md` in full and follow
   its `## Steps` section with `{}`. Capture the returned `context` object. If `context.error` exists, emit Notice and exit.
4. READ `.claude/skills/cowork/skills/ensure-daily-note/SKILL.md` in full and follow
   its `## Steps` section with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

Each gather call passes `engagement_id`. The sub-skill reads per-engagement MCP-scoped fields (gmail_label / calendar_id) from vault-config.md and may type-gate (e.g. `gather-imessage` early-exits for non-personal engagements). Renderable steps skip silently when their `render_aspects` flag is `skip`.

5. READ `.claude/skills/cowork/skills/gather-weather/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, city: engagement.home_city, days_ahead: 3 }` (personal only — skipped when `render_aspects.weather` is not present in engagement type).
6. READ `.claude/skills/cowork/skills/gather-calendar/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, date_today: context.today, horizon: "today+next-2-days", timezone: "America/Denver" }`.
7. READ `.claude/skills/cowork/skills/gather-gmail/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, window: "newer_than:1d" }`.
8. READ `.claude/skills/cowork/skills/gather-imessage/SKILL.md` in full and follow
   its `## Steps` section with `{ engagement_id, window_days: 3, scope: "inner-circle-and-groups" }` (gated: early-exit if engagement.type != "personal").
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

13. **Read prompt body** via `mcp__obsidian__get_file_contents` at `spice/cowork/prompts/morning-briefing.md`. Strip leading frontmatter block. Capture body trimmed of leading/trailing whitespace as `prompt_body`. If file is missing, treat as `prompt_body = ""`.
14. **Compose run-note body** from the gather outputs (steps 5–12b), interpolating per `prompt_body` instructions. When `prompt_body` is empty, do NOT freelance content — compose a skeleton-compliant STUB body:
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
