---
name: cowork:sync-scheduled-jobs
description: Emit canonical Cowork scheduled-job wrapper bodies for an engagement, aligned with current sauce + cowork versions + engagement's prefs.mcps state. Paste-ready output the user copies into claude.ai's Cowork UI. Reachable via /cowork sync-scheduled-jobs [<engagement_id>]. User-invoked only; never cron-scheduled.
schedule: User-invoked
scope: shared
inputs:
  engagement_id: string?
outputs:
  output_path: string
  status: string
  warnings: array
tags: [cowork, sync, scheduled-jobs, user-invocable]
---

# cowork:sync-scheduled-jobs

User-invocable orchestrator that emits the canonical Cowork scheduled-job wrapper bodies for an engagement to a paste-ready file.

## What it does

Reads the engagement's current state (vault-config, user-preferences, engagement-types) + the canonical scheduled-job contract for this cowork version, then emits a paste-ready file at `spice/cowork/scheduled-job-wrappers/<engagement.id>.md` containing 5 wrapper bodies (one per cowork cadence). The user copies each fenced block into the matching task in claude.ai's Cowork UI.

The wrapper contract evolves with each cowork v-bump that touches the cron runtime (v0.91.1 added path-guard prose; v0.91.2 added frontmatter-guard prose; v0.91.3 added connectivity + dataviewjs-pattern prose; v0.92.0 added body-shape write-guard mentions). After every cowork blueprint MINOR bump, re-run this skill to get current wrapper text.

## When to invoke

- First-time engagement setup (after `sauce wizard` + `/cowork`).
- After every cowork blueprint MINOR bump — the cron contract may have shifted.
- On user demand if claude.ai cron output starts misbehaving (drift suspicion).

## Inputs

- `engagement_id` (string, OPTIONAL): the engagement to sync. When omitted, auto-resolves via the v0.90.0 discover-people pattern:
  - **default-if-one** — single-engagement vault auto-picks the only engagement.
  - **ask-if-many** — multi-engagement vault prompts the user to choose.

## Pre-flight

1. **Resolve engagement.**
   - Read `spice/cowork/context/vault-config.md` → parse `engagements[]`.
   - If `engagement_id` passed: look up; on miss emit Notice `cowork:sync-scheduled-jobs aborted -- engagement not found: <engagement_id>` (status `failed:engagement:not-found:<id>`) + exit non-zero.
   - If not passed AND `engagements.length === 1`: use the only engagement; emit Notice `cowork:sync-scheduled-jobs: defaulting to engagement <id> (single-engagement vault)`.
   - If not passed AND `engagements.length > 1`: prompt user listing options (id + label) and wait for selection. On cancel emit Notice `cowork:sync-scheduled-jobs aborted -- engagement resolution cancelled` (status `failed:engagement:resolution-cancelled`) + exit non-zero.
   - Capture `engagement` (the full record).

2. **Read user-preferences.** Read `spice/cowork/context/user-preferences.md` → parse frontmatter + body → capture `prefs`. Missing-file → emit Notice + exit non-zero (status `failed:filesystem:missing-required-file:spice/cowork/context/user-preferences.md`).

3. **Read engagement-type data.** Read `spice/cowork/context/engagement-types/<engagement.type>.json` → capture `engagement_type_data`. Missing-file → emit warning + use default `{ scheduled_jobs: { disabled_cadences: [] } }` and continue.

4. **Read platform-installed.** Read `ranch/platform-installed.json` → capture `workshop_version` (= `sauce_version`) + `blueprints[].cowork.version` (= `cowork_version`). Missing-file → emit Notice + exit non-zero (status `failed:filesystem:missing-required-file:ranch/platform-installed.json`).

5. **Read scheduled-job contract.** Read `{{module_directory}}/data/scheduled-job-contract.json` (consumer-side materialized path: `spice/cowork/data/scheduled-job-contract.json`). Missing-file → emit Notice + exit non-zero (status `failed:filesystem:missing-required-file:spice/cowork/data/scheduled-job-contract.json`).

6. **Compute generated_at + generated_by.** `generated_at` = current ISO-8601 timestamp with timezone offset derived from `engagement.timezone` (default `"America/Denver"`). `generated_by` = `"cowork:sync-scheduled-jobs@1.0.0"`.

## Compose

7. **Resolve helper path.** `{{module_directory}}/helpers/compose-scheduled-job-wrappers-helper.js`. Materialized consumer-side path: `spice/cowork/helpers/compose-scheduled-job-wrappers-helper.js`. Require via `const CSJ = require("<resolved-path>");`.

8. **Invoke composeScheduledJobWrappers.** Call `CSJ.composeScheduledJobWrappers({ engagement, prefs, engagement_type_data, contract, sauce_version, cowork_version, generated_at, generated_by })`. Capture `{ file_md, warnings, status }`.

9. **Compose failure handling.** If `status` does NOT equal `"ok"` (i.e. starts with `"failed:"`): emit Notice `cowork:sync-scheduled-jobs aborted -- compose failure: <status>` + exit non-zero. Do NOT write any output file.

## Write

10. **Compute output path.** `output_path = "spice/cowork/scheduled-job-wrappers/<engagement.id>.md"`. This is the canonical, unambiguous destination — no resolver disambiguation needed.

11. **Ensure parent directory.** Run Bash `mkdir -p "spice/cowork/scheduled-job-wrappers"` (defensive on first invocation; idempotent).

12. **Backup-on-edit.** If `output_path` already exists on disk: copy its current content to `<output_path>.sauce-backup` (single-deep, overwrite-on-edit, matches landmine #12 mechanic #2). Backup-write failure → emit Notice + exit non-zero. Brand-new files skip this step.

13. **Write file.** Use the Write tool with `file_path: <output_path>` (absolute or vault-relative as the runtime expects) and `content: file_md`. Write failure → emit Notice `cowork:sync-scheduled-jobs aborted -- write failure: <reason>` (status `failed:filesystem:write-permission`) + exit non-zero.

14. **Verify written file.** Re-read the file via the Read tool. Assert byte count ≥ 500 (typical output is ~360-510 lines per design §6.5). Assert frontmatter parses (`---\n...\n---` block at top). Verify failure → emit Notice `cowork:sync-scheduled-jobs verify failed -- <reason>` (status `failed:verify:undersized:<bytes>` or `failed:verify:frontmatter-parse`) + exit non-zero. The file landed on disk in either case; user can inspect.

## Done

15. **Emit success Notice.** `cowork:sync-scheduled-jobs complete -- <engagement.label> @ sauce <sauce_version> / cowork <cowork_version> / contract <contract_version>. Output: <output_path>. Warnings: <warnings.length>.`

16. **Surface warnings.** If `warnings.length > 0`: emit a second Notice listing each warning token on its own line so the user sees the full taxonomy (e.g. `no_connected_mcps_in_prefs`, `engagement_label_fallback_used`, `contract_version_mismatch:<a>:<b>`).

17. **Print next-step guidance.** `Open <output_path>, then paste each fenced block into the matching Cowork task in claude.ai. Do not change the schedule. Re-run /cowork sync-scheduled-jobs <engagement.id> after the next cowork MINOR bump.` (If the Apply step below pushed updates via the scheduled-tasks MCP, the next-step note also reports the task-update summary instead.)

## Apply

(NEW in v0.93.1 — FLN-v93-9.) The Write step (10-14) emits a paste-ready markdown file as an audit artifact + fallback. The Apply step below auto-pushes the same wrapper bodies into claude.ai's scheduled tasks via the Cowork scheduled-tasks MCP when reachable in this session — eliminating the manual paste workflow on every re-run.

18. **Detect the scheduled-tasks MCP.** Check the available tools for an `update_scheduled_task({ taskId, prompt })` callable (typical namespaces: `mcp__claude_ai_Cowork__update_scheduled_task` or whatever surface claude.ai exposes in this session — discover via tool-search). Also look for `list_scheduled_tasks` / equivalent read-side. If neither is reachable, append warning `mcp-unreachable` to `warnings`, skip steps 19-22, and surface paste-fallback guidance per step 17 unchanged.

19. **Parse the wrapper file into per-cadence fenced blocks.** Re-read `output_path` (or use the in-memory `file_md` from the Compose step). For each cadence in `contract.cadence_order`, extract the substituted text inside the 4-backtick fenced code block under its `## N — cowork-<cadence>-<engagement_id> (...)` heading. This is the canonical `computed_prompt` for that cadence.

20. **List + diff current tasks.** Call `list_scheduled_tasks` (or equivalent). For each cadence in `contract.cadence_order`:
   - Derive `taskId = "cowork-<cadence>-<engagement_id>"` (e.g. `cowork-morning-briefing-headspace`).
   - Find the matching task in the list. If absent: append warning `mcp-task-absent:<taskId>` and skip — the user must create the task manually in claude.ai's Cowork UI first (cycle close note: v0.93.1 does NOT auto-create; v0.93.2+ may).
   - Fetch current task's `prompt` field. Compare to `computed_prompt` exactly. If equal: this task is current; report `unchanged`. If different: proceed to step 21.

21. **Idempotent update.** For each cadence whose current prompt differs from `computed_prompt`: call `update_scheduled_task({ taskId, prompt: computed_prompt })`. On failure: append warning `mcp-update-failed:<taskId>:<reason>` and continue with the remaining cadences (don't abort the whole sync on a single task's failure). On success: report `updated`.

22. **Strict rules.** Hard non-negotiables for the MCP push:
   - **NEVER touch `cron`/`schedule`/`description` fields.** Only `prompt`. The contract's `schedule_hint` is documentation of the canonical pattern, NOT ground truth. The user's live schedule on the task IS the ground truth — they may have deliberately tuned crons (e.g. morning 06:30 instead of contract hint 08:00, weekly Friday 04:00 instead of 17:30). Preserve verbatim.
   - **NEVER touch tasks outside the 5 canonical cadences.** If `list_scheduled_tasks` returns tasks like `cowork-debt-scoreboard-<engagement>`, `cowork-capture-tick-<engagement>`, `cowork-synthesize-day-<engagement>`, `cowork-synthesize-week-<engagement>`, etc. — those are out-of-scope for this contract. Skip silently. Append informational warning `mcp-listed-out-of-scope-task:<taskId>` per task seen (helps user spot orphaned tasks).
   - **Idempotent on re-run.** A second invocation finds all 5 tasks already matching `computed_prompt` and reports `5 unchanged / 0 updated / 0 absent` — zero side effects.

23. **Final Notice (replaces step 17 when Apply ran).** Emit `cowork:sync-scheduled-jobs complete -- <engagement.label> @ sauce <sauce_version>. MCP push: <N> updated / <M> unchanged / <Z> absent. Audit file: <output_path>. <X> out-of-scope tasks left untouched.` If any `mcp-update-failed:*` warning surfaced, append `Re-run when you've checked the failing tasks in claude.ai's Cowork UI` as a follow-up line.

## Failure modes

Helper-side (per `compose-scheduled-job-wrappers-helper.js`):

- `failed:input:<field>:missing` — required input field absent.
- `failed:input:<field>:wrong-type:<got>` — required input wrong type.
- `failed:contract:invalid-shape:<which>` — contract.json missing required top-level key.
- `failed:contract:cadence-order-mismatch` — `cadence_order` references a cadence missing from `cadences`.
- `failed:contract:substitution-token-undeclared:$<name>:cadence-<cadence>` — template uses an undeclared `{{$varname}}` token (landmine #20 Mode 1).
- `failed:contract:unknown-shared-key:<key>:cadence-<cadence>` — template references unknown `{{shared.<key>}}` (Mode 2).
- `failed:contract:invalid-substitution-format:<token-text>:cadence-<cadence>` — token shape violation (Mode 3 — guards against `{{template_variables}}` leakage).
- `failed:contract:unrendered-token-after-substitution:cadence-<cadence>` — `{{` survived to output (Mode 4).

Orchestrator-side:

- `failed:engagement:not-found:<id>` — `engagement_id` doesn't resolve in `vault-config.md`.
- `failed:engagement:resolution-cancelled` — user cancelled the multi-engagement prompt.
- `failed:filesystem:missing-required-file:<path>` — required input file absent (vault-config / user-preferences / platform-installed / contract).
- `failed:filesystem:write-permission` — output write or backup write failed.
- `failed:verify:undersized:<bytes>` — written file is < 500 bytes (compose miscarriage).
- `failed:verify:frontmatter-parse` — written file's frontmatter block doesn't parse.

Apply-step warnings (NEW v0.93.1 — FLN-v93-9 MCP push; all non-fatal — file write succeeded so paste workflow remains as fallback):

- `mcp-unreachable` — scheduled-tasks MCP not present in this session's tool surface; Apply step skipped entirely.
- `mcp-task-absent:<taskId>` — a canonical-cadence task ID (e.g. `cowork-morning-briefing-headspace`) isn't in `list_scheduled_tasks` output; user must create the task in claude.ai's Cowork UI first (v0.93.1 does NOT auto-create).
- `mcp-update-failed:<taskId>:<reason>` — `update_scheduled_task` call failed for a specific cadence; remaining cadences still attempted.
- `mcp-listed-out-of-scope-task:<taskId>` — informational; the user has scheduled tasks outside the 5-cadence contract (e.g. `cowork-debt-scoreboard-headspace`); skipped silently but surfaced so user can spot orphans.

## Harness testing

Fixtures: 12 cases at `platform/blueprints/cowork/helpers/fixtures/compose-scheduled-job-wrappers/case-*/` (8 byte-identical + 4 validator-failure). HC sub-asserts at `HC-V0930-COMPOSE-SHAPE-*` / `HC-V0930-VALIDATOR-*` / `HC-V0930-SUB-HELPER-*` / `HC-V0930-CONTRACT-*` / `HC-V0930-SKILL-*` in `platform/test/run-helper-cases.js`. Consumer-side production agents invoke the helper directly via `require()`; this SKILL.md prose is the orchestration scaffold + failure-mode contract, not the runtime byte-shape (the helper owns that). Re-runs are idempotent given identical inputs — the helper is pure (no I/O, no clock, no randomness; caller supplies `generated_at`).
