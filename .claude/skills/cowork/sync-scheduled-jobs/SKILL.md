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

5. **Read scheduled-job contract.** Read `spice/cowork/data/scheduled-job-contract.json` (consumer-side materialized path: `spice/cowork/data/scheduled-job-contract.json`). Missing-file → emit Notice + exit non-zero (status `failed:filesystem:missing-required-file:spice/cowork/data/scheduled-job-contract.json`).

6. **Compute generated_at + generated_by.** `generated_at` = current ISO-8601 timestamp with timezone offset derived from `engagement.timezone` (default `"America/Denver"`). `generated_by` = `"cowork:sync-scheduled-jobs@1.0.0"`.

## Compose

7. **Resolve helper path.** `spice/cowork/helpers/compose-scheduled-job-wrappers-helper.js`. Materialized consumer-side path: `spice/cowork/helpers/compose-scheduled-job-wrappers-helper.js`. Require via `const CSJ = require("<resolved-path>");`.

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

17. **Print next-step guidance.** `Open <output_path>, then paste each fenced block into the matching Cowork task in claude.ai. Do not change the schedule. Re-run /cowork sync-scheduled-jobs <engagement.id> after the next cowork MINOR bump.`

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

## Harness testing

Fixtures: 12 cases at `platform/blueprints/cowork/helpers/fixtures/compose-scheduled-job-wrappers/case-*/` (8 byte-identical + 4 validator-failure). HC sub-asserts at `HC-V0930-COMPOSE-SHAPE-*` / `HC-V0930-VALIDATOR-*` / `HC-V0930-SUB-HELPER-*` / `HC-V0930-CONTRACT-*` / `HC-V0930-SKILL-*` in `platform/test/run-helper-cases.js`. Consumer-side production agents invoke the helper directly via `require()`; this SKILL.md prose is the orchestration scaffold + failure-mode contract, not the runtime byte-shape (the helper owns that). Re-runs are idempotent given identical inputs — the helper is pure (no I/O, no clock, no randomness; caller supplies `generated_at`).
