---
name: cowork:sync-scheduled-jobs
description: Compose + push cowork scheduled-task wrapper bodies for all (cadence × engagement) pairs. Uses scheduled-task MCP tools (claude.ai Cowork UI native) to push wrapper changes programmatically — no manual paste. Schedule preservation invariant: the cron field NEVER set on update.
required_tools:
  - list_scheduled_tasks
  - update_scheduled_task
  - create_scheduled_task
  - obsidian_get_file_contents
  - obsidian_put_content
schedule: User-invoked (typically after cycle close or sauce update).
scope: shared
tags: [cowork, orchestrator, sync, rail-a]
---

# cowork:sync-scheduled-jobs

> [!info]+ Execution environment
> Runs in claude.ai Cowork UI ONLY. Requires scheduled-task MCP tools (`list_scheduled_tasks`, `update_scheduled_task`, `create_scheduled_task`). If invoked from Claude Code CLI, aborts cleanly with: "This skill requires claude.ai Cowork UI. Run `/cowork sync-scheduled-jobs` from your claude.ai Cowork chat to use the scheduled-task MCP."

## Inputs

```
{
  engagement_id: string,   // optional — filter to one engagement (--engagement <id>)
  dry_run: boolean         // optional — compute diff but don't push (--dry-run; default: false)
}
```

## Substitution Protocol

The compose step substitutes these tokens in `orchestrator-instructions/<cadence>.md`:

**Static (sync time):**
- `{{$engagement_id}}` → engagement.id
- `{{$engagement_label}}` → engagement.label OR engagement.id
- `{{$timezone}}` → engagement.timezone OR "America/Denver"
- `{{$voice_notes}}` → prefs.personality.notes OR prefs.personality.vibe_notes (verbatim)
- `{{$voice_summary}}` → `vibe: <v>, formality: <f>, length: <l>, pep_talk: <p>`
- `{{$priorities}}` → prefs.priorities joined by ", "
- `{{$mcp_dispatch_lines}}` → per-kind served-by lines (e.g. `calendar served-by 45224a...; email served-by gmail`)
- `{{$inner_circle}}` → engagement.inner_circle_people joined by ", "
- `{{$workshop_version}}`, `{{$cowork_version}}`, `{{$contract_version}}` → from contract
- `{{$cadence}}` → cadence name
- `{{$cadence_mode}}` → "warm" (default) or "lens_shift" (cold variant)
- `{{$frontmatter_type}}` → per cadence from contract
- `{{$title_template}}` → per cadence

**Shared:** `{{shared.<key>}}` → block from `data/orchestrator-instructions/_shared-clauses.md`

**Fire-time (literal — NOT substituted at sync):**
- `{{$today_date}}`, `{{$today_weekday}}`, `{{$today_month_name}}`, `{{$today_day}}`, `{{$today_year}}`, `{{$today_dirpath}}`, `{{$today_ymd_compact}}`

**Computed-at-emit:** `{{$rating_kind_lines}}`, `{{$pending_confirmation_lines}}`

**Validation:** after substitution, no `{{$<token>}}` or `{{shared.<key>}}` may remain EXCEPT the fire-time + computed-at-emit ones above.

## Steps

### 1. Verify execution environment

Confirm scheduled-task MCP tools loaded. If any of `list_scheduled_tasks`, `update_scheduled_task`, `create_scheduled_task` are unavailable, emit:

```
cowork:sync-scheduled-jobs requires claude.ai Cowork UI environment.
Run /cowork sync-scheduled-jobs from your claude.ai Cowork chat to use
the scheduled-task MCP tools.
```

Exit cleanly. The cron field NEVER set on update; this is the schedule preservation invariant.

### 2. Read vault context

Read via Obsidian MCP:
- `spice/cowork/context/vault-config.md` → engagements[] (filter by --engagement input if provided)
- `spice/cowork/context/user-preferences.md` → priorities + personality + mcps
- For each engagement: per-engagement context files
- `.claude/skills/cowork/data/scheduled-job-contract.json` → cadence list + wrapper_template_source pointers
- `.claude/skills/cowork/data/orchestrator-instructions/<cadence>.md` per cadence
- `.claude/skills/cowork/data/orchestrator-instructions/_shared-clauses.md`

### 3. Compose wrapper bodies per (cadence × engagement)

For each engagement × each enabled cadence (per engagement.cadences):
1. Load `orchestrator-instructions/<cadence>.md`
2. Resolve `{{#if cadence_mode == "lens_shift"}}...{{else}}...{{/if}}` conditional per cadence_mode
3. Substitute `{{shared.<key>}}` from `_shared-clauses.md`
4. Substitute static `{{$tokens}}` per Substitution Protocol
5. Wrap with PRELUDE + DONE blocks
6. Result: composed wrapper text (~200-400 lines)

### 4. Read live state

Invoke `list_scheduled_tasks`. Build map by task name → `{ task_id, prompt, cron, enabled }`. Names follow pattern `cowork-<cadence>-<engagement_id>`.

### 5. Compute the diff

Invoke `diffWrappersAgainstLive(composed, live)` from `helpers/cowork-sync-mcp-helper.js`. Returns:
- `changed[]`: existing tasks needing update_scheduled_task
- `new[]`: missing tasks needing create_scheduled_task
- `orphan[]`: live tasks with cowork-*-* pattern but no composed entry — warn-not-delete
- `noop[]`: byte-identical, no push

Schedule preservation: cron field of every live task is NEVER touched. The cron field NEVER set on update — only `prompt` is passed to update_scheduled_task.

### 6. Execute (skip if --dry-run)

For each `changed` task: invoke `update_scheduled_task({ task_id, prompt: <composed> })`. ONLY task_id + prompt — never set cron or enabled.

For each `new` task: invoke `create_scheduled_task({ name, cron: <default_cron from contract>, prompt: <composed>, enabled: true })`.

For each `orphan`: emit warning line; no destructive action.

### 7. Update audit file

Write `spice/cowork/scheduled-jobs.md` via `obsidian_put_content` with frontmatter:

```yaml
---
type: cowork-scheduled-jobs
schema_version: "1.1.0"
sauce_version: "<workshop>"
cowork_version: "<cowork>"
contract_version: "<contract>"
last_synced_at: "<NOW ISO>"
last_sync_engagement: "<input filter OR 'all'>"
---
```

Body: markdown table with columns Engagement | Cadence | Task ID | Task name | Cron | Status.

### 8. Report

Print summary: N updated / N created / N orphan-warned / N noop / N schedule-preserved / audit file path.

## Failure modes

- `list_scheduled_tasks` returns error → abort cleanly
- One `update_scheduled_task` error → log per task, continue
- Missing context file → skip that pair, warn, continue
- Compose produces invalid output (orphan tokens) → skip, warn, continue
- Audit file write failure → non-fatal

## Idempotency

Re-runs are byte-comparison diff'd. Same composition as live → 0 pushes. Safe to invoke at any time.

## Harness testing

HC-V0970-A-1..12 cover this skill. Helper `cowork-sync-mcp-helper.js` implements `diffWrappersAgainstLive` invoked by Step 5.
