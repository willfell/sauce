# Cloud Cowork skill — align-scheduled-jobs

> [!info]+ What this file is
> The CANONICAL copy of the `align-scheduled-jobs` custom skill for **Cloud
> Cowork** (claude.ai Cowork chat). Cloud Cowork lets the user register custom
> skills as slash commands; this one is registered ONCE at the claude.ai
> account level and works against ANY sauce consumer vault — it discovers the
> connected vault, reads the vault's INSTALLED platform version, and aligns
> the cloud scheduled jobs to it. It is the cloud-side companion of the
> shipped `cowork:sync-scheduled-jobs` skill (and corrects that skill's known
> stale data paths — see v0.98.0 carry-forward "shim path mismatch").
>
> To (re-)register: copy everything between the SKILL BODY markers below into
> Cloud Cowork's "add your own skill" UI. Registration is account-level, so
> one registration serves every machine logged into the same claude.ai
> account. Update this file first if the skill needs to change; the pasted
> copy in claude.ai is derived, this file is source.

status: authored 2026-06-11 (post-v0.98.2 ship); current against contract_version 0.35.1
related: platform/blueprints/cowork/skills (sync-scheduled-jobs SKILL.md), Docs/cowork-ecosystem.md § 3.1, Docs/landmines.md

<!-- SKILL BODY BEGIN — copy from here -->
---
name: align-scheduled-jobs
description: Align ALL cowork scheduled jobs (cloud cron tasks) with the sauce/cowork version currently installed in the connected Obsidian vault. Onboards missing jobs, refreshes stale wrapper bodies, never touches schedules, and treats every user-authored context file as read-only at all costs.
---

# align-scheduled-jobs

Recompose every cowork scheduled-job wrapper from the connected vault's
CURRENT on-disk orchestrator-instructions and push the diff to the cloud
scheduled tasks. Because composition reads the vault's installed files, the
jobs are ALWAYS aligned to whatever sauce/cowork version that vault is on —
no version arguments needed. Works identically in every sauce consumer vault.

## HARD PROTECTION CONTRACT (read first, non-negotiable)

User-authored content is protected AT ALL COSTS. You operate under an
explicit write allowlist; everything else in the vault is READ-ONLY.

**You may write exactly ONE vault file:**
- `spice/cowork/scheduled-jobs.md` — the generated audit table
  (frontmatter `type: cowork-scheduled-jobs`; regenerated every run).

**You must NEVER write, edit, rename, or delete (read-only, no exceptions):**
- `spice/cowork/context/**` — vault-config.md, user-preferences.md
  (personality, priorities, mcps, learned_weights), every per-engagement
  context dir, active-threads.md, weekly-snapshot.md, reconciler-log.md
- `spice/cowork/prompts/**` — cadence prompts AND per-mcp microscopes
- `spice/cowork/memory/**`, `spice/cowork/daily/**`, `spice/cowork/weekly/**`,
  `spice/cowork/monthly/**`, `spice/cowork/snapshots/**`, `spice/cowork/summaries/**`
- `spice/cowork/data/**` (orchestrator-instructions, schemas, contract) and
  `ranch/**` — platform-managed; the installer owns them, not you
- Anything else in the vault not named in the allowlist

**Scheduled-task side constraints:**
- `update_scheduled_task`: pass `task_id` + `prompt` ONLY. NEVER set `cron`,
  `enabled`, or `name` on an existing task (schedule preservation invariant).
- `create_scheduled_task`: only for missing (cadence × engagement) pairs,
  using the contract's `default_cron` for that cadence.
- NEVER delete or disable any task. Orphans get a warning line, nothing more.

If any step appears to require violating this contract, STOP immediately and
report what you were about to do instead of doing it. User customizations
(personality, voice, microscopes, preferences) are PRESERVED by design: they
flow INTO the composed wrappers as substitution inputs on every run, and are
never written back.

## Step 0 — Environment + vault discovery

1. Confirm the scheduled-task tools are available: `list_scheduled_tasks`,
   `update_scheduled_task`, `create_scheduled_task`. If not, abort: "This
   skill requires Cloud Cowork's scheduled-task tools."
2. Discover the connected Obsidian MCP namespace (e.g.
   `mcp__headspace-obsidian__*`, `mcp__accuris-obsidian__*`). If MORE than
   one vault MCP is connected, ASK the user which vault to align before
   touching anything. All vault reads/writes go through that namespace.
3. Read the vault's installed versions:
   - `ranch/platform-installed.json` → `workshop_version`
   - `spice/cowork/data/scheduled-job-contract.json` → `contract_version`,
     `cadence_order`, `cadences` (default_cron + per-cadence metadata)
   These define "the version it's on." Report them up front.

## Step 1 — Read vault context (read-only)

- `spice/cowork/context/vault-config.md` frontmatter → `engagements[]`
  (id, label, timezone, cadences map, inner_circle_people)
- `spice/cowork/context/user-preferences.md` frontmatter → `priorities`,
  `personality` (verbatim — including notes/vibe_notes/framing/hard_rules),
  `mcps` (served_by per kind)
- Per engagement: `spice/cowork/context/<id>/` files as referenced by the
  substitution protocol (people-aliases etc.) — read what exists, skip what
  doesn't, never create.
- `spice/cowork/data/orchestrator-instructions/<cadence>.md` for every
  cadence in the contract's `cadence_order` (including `reconcile-cowork`)
  and `spice/cowork/data/orchestrator-instructions/_shared-clauses.md`.
  NOTE: these paths under `spice/cowork/data/` are the REAL runtime paths.
  (The vault-installed sync-scheduled-jobs SKILL.md references a
  `.claude/skills/cowork/data/` path that does not exist — ignore it.)

## Step 2 — Compose wrapper bodies per (cadence × engagement)

For each engagement × each enabled cadence (per `engagement.cadences`, plus
`reconcile-cowork` which runs for every engagement):

1. Load the cadence's orchestrator-instructions file.
2. Resolve any `{{#if cadence_mode == "lens_shift"}}…{{else}}…{{/if}}`
   conditionals (default mode "warm").
3. Substitute `{{shared.<key>}}` blocks from `_shared-clauses.md`.
4. Substitute static tokens: `{{$engagement_id}}`, `{{$engagement_label}}`,
   `{{$timezone}}` (engagement.timezone or "America/Denver"),
   `{{$voice_notes}}` (personality.notes or vibe_notes, VERBATIM),
   `{{$voice_summary}}` (`vibe: <v>, formality: <f>, length: <l>, pep_talk: <p>`),
   `{{$priorities}}`, `{{$mcp_dispatch_lines}}`, `{{$inner_circle}}`,
   `{{$workshop_version}}`, `{{$cowork_version}}`, `{{$contract_version}}`,
   `{{$cadence}}`, `{{$cadence_mode}}`, `{{$frontmatter_type}}`,
   `{{$title_template}}`.
5. Validate: after substitution, the ONLY tokens allowed to remain literal
   are fire-time tokens (`{{$today_*}}`, `{{$yesterday_*}}`) and
   computed-at-emit tokens (`{{$rating_kind_lines}}`,
   `{{$pending_confirmation_lines}}`, `{{$title_template_resolved}}`,
   `{{$feedback_capture_per_kind_blocks}}`,
   `{{$feedback_capture_free_text_or_placeholder}}`,
   `{{$voice_proposals_count}}`, `{{$voice_proposal_lines}}`). Any OTHER
   residual `{{$token}}` or `{{shared.*}}` = composition failure for that
   pair: warn, skip the pair, never push a broken wrapper.

## Step 3 — Read live state + diff

1. `list_scheduled_tasks`. Task names follow `cowork-<cadence>-<engagement_id>`.
2. Classify each composed (cadence × engagement) pair:
   - **changed** — live task exists, prompt differs → update
   - **new** — no live task → create (this is the onboarding path)
   - **noop** — byte-identical prompt → skip
   - **orphan** — live `cowork-*-*` task with no composed counterpart →
     warn only (it may belong to another vault's engagements — NEVER touch)

## Step 4 — Execute

- changed → `update_scheduled_task({ task_id, prompt })` — nothing else.
- new → `create_scheduled_task({ name: "cowork-<cadence>-<engagement_id>",
  cron: <contract default_cron for the cadence>, prompt, enabled: true })`.
- orphan → warning line in the report. No call.

## Step 5 — Audit file

Overwrite `spice/cowork/scheduled-jobs.md` (the ONE allowed vault write):

```yaml
---
type: cowork-scheduled-jobs
schema_version: "1.1.0"
sauce_version: "<workshop_version from Step 0>"
cowork_version: "<cowork pin from ranch/platform-installed.json>"
contract_version: "<contract_version>"
last_synced_at: "<NOW ISO>"
last_sync_engagement: "all"
---
```

Body: table `Engagement | Cadence | Task ID | Task name | Cron | Status`.

## Step 6 — Report

- Versions aligned to: workshop X / cowork Y / contract Z
- N updated / N created (onboarded) / N noop / N orphan-warned
- "Schedules preserved: yes — cron untouched on every existing task"
- "User context untouched: yes — zero writes outside spice/cowork/scheduled-jobs.md"
- Any skipped pairs with their validation warnings

## Failure modes

- A context file is unreadable → skip that pair, warn, continue. Never
  create or repair vault files.
- `list_scheduled_tasks` errors → abort cleanly, nothing pushed.
- One update/create errors → log it, continue with the rest.
- Ambiguous vault (multiple Obsidian MCPs) → ask, don't guess.

## Idempotency

Pure diff-push: re-running immediately after a successful run yields 0
updates / 0 creates. Safe to invoke any time — after every `sauce update`
is the intended moment.
<!-- SKILL BODY END -->
