---
name: cowork:onboard-scheduled-jobs
description: Interactive setup. Walks the consumer through enable/cadence/prompt questions per orchestrator, writes prompt-body customizations to spice/cowork/prompts/*.md, registers jobs via the scheduled-tasks MCP when available (or paste-mode fallback), persists config to spice/cowork/scheduled-jobs.md. Re-runnable on day 90 to change cadences or update prompt bodies. Phrasings = "set up cowork scheduled jobs", "onboard cowork scheduling", "configure my morning briefing".
schedule: User-invoked (interactive — not cron-driven)
scope: shared
tags: [cowork, orchestrator, onboarding, scheduled-tasks-mcp]
---

# cowork:onboard-scheduled-jobs

Interactive setup walker. The zero-friction door for connecting a sauce-installed vault to Claude Cowork's scheduled-tasks MCP. Asks the right questions, writes user-dictated prompt bodies, registers jobs, persists a vault-resident config note.

## Inputs

```
{
  engagement_id: string   // optional — when omitted, skill prompts the user to pick from vault-config.md engagements[]
  mode_hint: "auto" | "direct" | "paste"   // optional (default "auto"): auto detects scheduled-tasks MCP availability and picks direct or paste
}
```

## Pre-flight

1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian"], bootstrapped_required: true }`. If status is `"not-bootstrapped"`, emit Notice `cowork:onboard-scheduled-jobs aborted -- run cowork:bootstrap-vault first` and exit. If routing not ready for obsidian, same abort pattern.
2. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md` via `mcp__obsidian__get_frontmatter`. Resolve `engagements[]`. If `engagement_id` was passed, locate that entry; if not, present the user with a numbered list and ask which to onboard. Capture `engagement` (full record) + load engagement-type manifest from registry to get `default_cadences` + `supported_cadences`.
3. **Detect scheduled-tasks MCP availability.** When `mode_hint` is `"auto"` (default) or `"direct"`, probe via `mcp__scheduled-tasks__list { }`. On success, capture `existing_tasks` (list returned by MCP) and set `mode = "direct"`. On failure or when `mode_hint == "paste"`, set `mode = "paste"`; `existing_tasks = []`.

## Walk

For each of the 5 orchestrators (in order: `morning-briefing`, `midday-tripwire`, `eod-review`, `weekly-review`, `monthly-review`):

4. **Enable?** Default = `engagement.type_manifest.default_cadences[<cadence>]` boolean (e.g. for personal, all 5 default true; for w2-fte, midday may default false). Ask: "Enable cowork:<orch> on engagement <engagement.id>? (default: <default>)". Accept yes/no.
5. If enabled, **Cadence?** Default = the canonical cadence row for this orchestrator:
   - morning-briefing: Mon-Fri 07:05
   - midday-tripwire: Mon-Fri 12:30
   - eod-review: Mon-Fri 17:05
   - weekly-review: Fri 04:00
   - monthly-review: 1st of month 04:00
   - TZ from engagement (or vault-config-level TZ; fall back to system local if neither specified)
   Ask: "Cadence for cowork:<orch>? (default: <default-cadence-string>)". Accept the user's cron-friendly natural-language answer; resolve to cron expression.
6. If enabled, **Prompt body?** Read current body of `spice/cowork/prompts/<orch>.md` (strip frontmatter; capture trim length). Ask: "Prompt body for cowork:<orch>? Options: (a) use the platform-shipped default for engagement-type <engagement.type>, (b) leave empty stub (orchestrator emits warning: empty_prompt), (c) tell me what this should emit (interactive Q&A — describe desired content)."
   - **(a)** Look up the platform-shipped engagement-type-default prompt template at `spice/cowork/context/engagement-templates/<engagement.type>/prompts/<orch>.md`. If present, copy its body into the user's `spice/cowork/prompts/<orch>.md`. If absent, fall back to a one-line literal stating "(no engagement-type default available — falling back to empty stub)".
   - **(b)** Leave the file as-is. Skill emits `warning: empty_prompt` annotation in the planned-jobs summary.
   - **(c)** Interactive Q&A. Ask: "What should cowork:<orch> emit when it fires? Describe the content + structure you want." User responds. Draft a prompt body matching their description. Show drafted body to user. Ask: "Looks good? (yes / edit / restart)". On yes, write the drafted body to `spice/cowork/prompts/<orch>.md`. On edit, accept their revision and write. On restart, re-ask step 6.

## Register

7. **Direct mode (`mode == "direct"`).** For each enabled orchestrator from steps 4–6:
   - Compose task spec:
     ```
     name: cowork-<orch>-<engagement.id>
     cron: <resolved cron expression>
     prompt: "Use skill cowork:<orch> with { engagement_id: \"<engagement.id>\" }"
     ```
   - Check `existing_tasks` (from pre-flight step 3) for a task with matching `name`.
     - If found: call `mcp__scheduled-tasks__update` with `{ task_id: <existing.id>, cron, prompt }`. Capture `task_id`.
     - If not: call `mcp__scheduled-tasks__create` with `{ name, cron, prompt }`. Capture `task_id`.
   - Append to `register_results[]`: `{ orch, status: "created"|"updated", task_id, cron, prompt }`.
   - For disabled orchestrators that have an existing task in `existing_tasks`: ask user "cowork:<orch>-<engagement.id> already exists as a scheduled task but you set it to disabled. Delete it? (yes/no)". If yes, call `mcp__scheduled-tasks__delete`.
8. **Paste mode (`mode == "paste"`).** For each enabled orchestrator, compose a paste-ready block:
   ```
   ━━━ Add to Claude Cowork → Scheduled Jobs ━━━
   Job:        <orch>-<engagement.id>
   Schedule:   <cadence string>
   Cron:       <cron expression>
   Prompt:     Use skill cowork:<orch> with { engagement_id: "<engagement.id>" }
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```
   Print all blocks to the chat. Append to `register_results[]`: `{ orch, status: "paste-needed", task_id: null, cron, prompt }`.

## Persist

9. **Write `spice/cowork/scheduled-jobs.md`** via `mcp__obsidian__create_note` (overwrite). Compose with frontmatter:
   ```yaml
   ---
   type: cowork-scheduled-jobs
   created_at: "<ISO+TZ>"
   updated_at: "<ISO+TZ>"
   engagement_id: "<engagement.id>"
   mcp_backend: "scheduled-tasks"   # or "paste" when mode == "paste"
   ---
   ```
   Body: a Markdown table with columns `Orchestrator | Schedule (TZ) | Cron | Prompt invocation | Task ID | Status` — one row per `register_results[]` entry.

## Done

10. Emit Obsidian Notice `cowork:onboard-scheduled-jobs complete -- <N> jobs configured for <engagement.label> (<mode>)`. Print pointer: "Open `/cowork` (Cowork.md) to verify the readiness panel shows the new configured jobs."

## Returns

`{ engagement_id, mode, register_results: [...], scheduled_jobs_path: "spice/cowork/scheduled-jobs.md" }`.
