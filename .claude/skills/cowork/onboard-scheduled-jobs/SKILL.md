---
name: cowork:onboard-scheduled-jobs
description: Single conversational entry-point for cowork setup post-`brew upgrade sauce`. Walks the consumer through bootstrap (auto-delegating to cowork:bootstrap-vault when not-bootstrapped) → engagement resolution → cadence enable/cadence questions per orchestrator with brief natural-language preambles → bulk-defaults question ("Apply engagement-type defaults to ALL prompts now?") with 4 options (overwrite stubs+defaults / overwrite custom too / per-orch walk / skip prompts) → prompt-file ops via filesystem Read+Write with byte-count assertion + customization-aware overwrite guard → schedule registration via scheduled-tasks MCP (direct mode) or paste-mode fallback → write spice/cowork/scheduled-jobs.md. Re-runnable: on subsequent invocations detects existing state and offers skip/update/reconfigure per section. Phrasings = "set up cowork scheduled jobs", "onboard cowork scheduling", "configure my morning briefing", "set up cowork", "cowork setup".
schedule: User-invoked (interactive — not cron-driven)
scope: shared
tags: [cowork, orchestrator, onboarding, scheduled-tasks-mcp]
---

# cowork:onboard-scheduled-jobs

Single conversational entry-point for cowork setup post-`brew upgrade sauce`. Auto-delegates to `cowork:bootstrap-vault` when the vault isn't bootstrapped; otherwise walks the user through cadence enablement, prompt-body defaults, and schedule registration with brief natural-language preambles. Re-runnable.

## Inputs

```
{
  engagement_id: string   // optional — when omitted, skill prompts the user to pick from vault-config.md engagements[]
  mode_hint: "auto" | "direct" | "paste"   // optional (default "auto"): auto detects scheduled-tasks MCP availability and picks direct or paste
}
```

## Step 0 — Welcome

Print:
```
Setting up cowork scheduled jobs in this vault. I'll walk you through which
cadences to enable (morning / midday / EOD / weekly / monthly), apply
engagement-type prompt defaults, and register the cron schedules. You can
re-run me later to change anything. Let's start.
```

## Step 1 — Pre-flight

READ `.claude/skills/cowork/skills/check-vault-routing/SKILL.md` in full and follow
its `## Steps` section with `{ required: ["filesystem"], bootstrapped_required: true }`.

- If status is `"not-bootstrapped"`: print preamble:
  ```
  It looks like cowork hasn't been set up in this vault yet — it needs an
  'engagement' record (your work context: personal life, your job, a
  consulting client) before scheduling. I'll run the bootstrap interview
  now, then come back to scheduling. Continue? (y/n)
  ```
  - On `y`: READ `.claude/skills/cowork/bootstrap-vault/SKILL.md` in full and execute
    it interactively. On its successful completion, resume at Step 2.
  - On `n`: print pointer `"Run cowork:bootstrap-vault when ready, then re-run cowork:onboard-scheduled-jobs."` Exit.
- If status is `"not-vault-root"` or `"read-only"`: emit Notice `cowork:onboard-scheduled-jobs aborted -- vault not writable from cwd` and exit.
- If status is `"ready"`: proceed to Step 2.

## Step 2 — Resolve engagement

Read `spice/cowork/context/vault-config.md` via the Read tool. Parse the YAML frontmatter (look for the `engagements:` list). Build the `engagements[]` array.

- If `engagement_id` was passed as input: locate the matching entry. If absent → emit Notice and exit.
- Else if exactly one engagement is configured: use it. Print preamble:
  ```
  Found one engagement: <label> (<type>). Using it.
  ```
- Else (multiple engagements): present a numbered list:
  ```
  Which engagement do you want to set up scheduling for?
    1. <label-1> (<type-1>)
    2. <label-2> (<type-2>)
    ...
  ```
  Wait for user's number; capture `engagement`.

After capturing `engagement`, resolve the engagement-type manifest:

1. Compose `materialized_manifest_path` = `"spice/cowork/context/engagement-types/" + engagement.type + ".json"`.
2. Read `materialized_manifest_path` via the Read tool; parse JSON. Capture as `type_manifest`.
3. Capture from `type_manifest`: `default_cadences`, `supported_cadences`, `tripwire_aspects`, `render_aspects`.

If `materialized_manifest_path` does not exist or fails to parse, emit Notice `cowork:onboard-scheduled-jobs aborted -- engagement-type manifest unavailable at <materialized_manifest_path>; ensure sauce update --bump-pins ran against v0.83.0+ workshop` and exit.

## Step 3 — Detect scheduled-tasks MCP availability

Print preamble: `Checking whether Claude can register the schedules automatically...`

When `mode_hint == "paste"`, skip detection; set `mode = "paste"`; `existing_tasks = []`.

Otherwise probe via `mcp__scheduled-tasks__list { }`:
- Success → `mode = "direct"`; capture `existing_tasks`. Print: `Found <N> existing scheduled tasks for this vault; I'll update those + add new ones as needed.`
- Failure → `mode = "paste"`; `existing_tasks = []`. Print: `Scheduled-tasks MCP not available — I'll print paste-ready cron blocks at the end.`

## Step 4 — Bulk-defaults question

Print preamble:
```
Each cadence has a prompt body that shapes what the atomic note emits when
the job fires. The platform ships sensible defaults per engagement type
(<engagement.type>) — these are a good starting point for first-time setup,
and you can edit any prompt later in spice/cowork/prompts/<orch>.md.
```

**Detect current prompt state.** For each of the 5 cadences (`morning-briefing`, `midday-tripwire`, `eod-review`, `weekly-review`, `monthly-review`):
- Use Read tool to read `spice/cowork/prompts/<orch>.md` (best-effort; if file missing, treat as `body_length = 0`).
- Strip frontmatter; compute `body_length` in chars.
- Read the engagement-template source: `spice/cowork/context/engagement-templates/<engagement.type>/prompts/<orch>.md`. Compute `template_body_length`.
- Classify:
  - `"stub"` if `body_length <= 200` chars
  - `"default"` if `body_length` is within ±10% of `template_body_length`
  - `"custom"` otherwise

Print state summary: `Found 5 prompts: <stub-count> stub, <default-count> default, <custom-count> custom.`

Ask:
```
Apply engagement-type defaults to ALL prompts now?

  (a) Yes — overwrite any stubs + defaults with fresh <engagement.type> templates
      [skip customized prompts]   (recommended for first-time setup)
  (b) Yes, and overwrite my customized prompts too
      [destructive — confirms before each overwrite]
  (c) No — walk through each cadence individually (per-orch (a)/(b)/(c) walk)
  (d) No — leave all prompts as-is; just register schedules
```

**Path (a) — bulk overwrite stubs + defaults; skip customs.** For each of the 5 cadences:
- If classification is `"stub"` or `"default"`:
  - Source: `spice/cowork/context/engagement-templates/<engagement.type>/prompts/<orch>.md`
  - Dest: `spice/cowork/prompts/<orch>.md`
  - If source is missing: emit hard error `cowork:onboard-scheduled-jobs aborted -- engagement template not found at <source>; vault may be incomplete. Run sauce update.` Exit.
  - Read source via Read tool; capture body.
  - Write dest via Write tool (overwrite); confirm via Bash `wc -c <dest>` matches the expected byte count (source size ±5%).
  - Print: `Wrote <orch>.md (<bytes> bytes from <engagement.type> template).`
- If classification is `"custom"`: skip with Notice: `Kept your customized <orch>.md (<body_length> chars).`

**Path (b) — bulk overwrite + confirm per-custom.** Same as path (a) but for each `"custom"`-classified prompt, ask: `Overwrite your customized <orch>.md (<body_length> chars) with the <engagement.type> default? (y/N)`. Default `n`. On `y`, perform the same Read+Write copy as path (a). On `n`, skip with Notice.

**Path (c) — per-cadence walk.** Skip the bulk copy; proceed to Step 5 with the per-orch (a)/(b)/(c) prompt-body question (preserving the v0.71.0 behavior with added preambles).

**Path (d) — skip prompts entirely.** Proceed directly to Step 5 cadence questions and Step 6 registration; do not touch any prompt files.

## Step 5 — Per-cadence cadence + enablement walk

For each of the 5 orchestrators (in order: `morning-briefing`, `midday-tripwire`, `eod-review`, `weekly-review`, `monthly-review`):

Print the per-orchestrator preamble:

- **morning-briefing**:
  ```
  Morning briefings fire at 07:05 Mon-Fri by default. They pull today's
  calendar, recent email, project status, and open threads into a single
  atomic note you can read with coffee.
  ```
- **midday-tripwire**:
  ```
  Midday tripwire fires at 12:30 Mon-Fri. It surfaces things that grew
  during the morning — for <engagement.type>, that means
  <friendly list from tripwire_aspects>. Only writes a note when there's
  something to flag (green = silent).
  ```
  (Friendly aspect names: `cc_drift` → "CC overspend"; `calendar_drift` → "calendar drift"; `queue_growth` → "approval queue growth".)
- **eod-review**:
  ```
  EOD review fires at 17:05 Mon-Fri. Wraps the day: wins, misses, what
  carries to tomorrow, optional wellness prompts.
  ```
- **weekly-review**:
  ```
  Weekly review fires Friday 04:00. Snapshots the week's headline outcome
  + open threads going into the weekend.
  ```
- **monthly-review**:
  ```
  Monthly review fires the 1st of the month at 04:00. Captures the
  month's headline + any rolling commitments.
  ```

Ask: `Enable cowork:<orch> for engagement <engagement.id>? (default: <default>)` where `<default>` reads `engagement.type_manifest.default_cadences[<cadence>]`.

If enabled AND `<cadence>` is NOT in `supported_cadences`, surface a Notice:
```
<orch> isn't typically used for engagement-type <type>, but you can enable
it — proceed? (y/n)
```
On `y`: continue; on `n`: skip this orchestrator.

If enabled, ask cadence: `Cadence for cowork:<orch>? (default: <default-cadence-string>)`. Defaults:
- morning-briefing: `Mon-Fri 07:05`
- midday-tripwire: `Mon-Fri 12:30`
- eod-review: `Mon-Fri 17:05`
- weekly-review: `Fri 04:00`
- monthly-review: `1st of month 04:00`
- TZ from engagement (or vault-config-level TZ; fall back to system local).
Resolve user's natural-language answer to a cron expression.

If Step 4's path was `(c)` (per-cadence walk), also ask the prompt-body question per-orch with the v0.71.0 (a)/(b)/(c) options + the v0.71.0 contract-guard scan (legacy callout-patching detection) intact. Otherwise (paths a/b/d), skip the per-orch prompt-body question.

## Phase: ensure user-preferences captured

Probe `spice/cowork/context/user-preferences.md`:

- Use Read against `spice/cowork/context/user-preferences.md`.
- If the file does NOT exist: the vault wasn't previously installed by v0.76.0+. Proceed to delegate.
- If it exists, parse frontmatter and check the `updated_by:` field:
  - `updated_by: install.js` (or absent) → seed template; preferences have not been captured. Proceed to delegate.
  - `updated_by: cowork:context-builder` → preferences captured. Ask via AskUserQuestion:
    > Preferences captured on {{updated:}}. Update them now?
    >   - Yes — re-run context-builder
    >   - No — keep current preferences and continue
    On Yes, delegate. On No, skip the delegation step.

If delegation should happen, READ `.claude/skills/cowork/context-builder/SKILL.md` in full and follow its `## Steps` section with `{}`. (Live invocation — no `dry_run_answers`.)

After `cowork:context-builder` returns, continue to the cron-registration phase below.

## Step 6 — Register tasks

**Direct mode (`mode == "direct"`).** For each enabled orchestrator from Step 5:
- Compose task spec:
  ```
  name:   cowork-<orch>-<engagement.id>
  cron:   <resolved cron expression>
  prompt: Use skill cowork:<orch> with { engagement_id: "<engagement.id>" }. When the orchestrator instructs you to use a sub-skill (cowork:write-run-note-*, cowork:gather-*, etc.), READ that sub-skill's SKILL.md from .claude/skills/cowork/skills/<name>/ and strictly follow its sections including any "## Pre-write self-check" checklist before proceeding with the action described in "## Steps". Return failed:contract-violation:<field> on any miss.
  ```
- Check `existing_tasks` (from Step 3) for a task with matching `name`:
  - If found: call `mcp__scheduled-tasks__update` with `{ task_id, cron, prompt }`. Capture `task_id`.
  - If not: call `mcp__scheduled-tasks__create` with `{ name, cron, prompt }`. Capture `task_id`.
- Append `{ orch, status: "created"|"updated", task_id, cron, prompt }` to `register_results[]`.

For disabled orchestrators that have an existing task in `existing_tasks`: ask:
```
Found existing task cowork-<orch>-<engagement.id> but you set it disabled.
Delete it? (y/n)
```
On `y`: call `mcp__scheduled-tasks__delete`; append `{ orch, status: "deleted", task_id }`.

**Paste mode (`mode == "paste"`).** For each enabled orchestrator, compose a paste-ready block:
```
━━━ Add to Claude Cowork → Scheduled Jobs ━━━
Job:        <orch>-<engagement.id>
Schedule:   <cadence string>
Cron:       <cron expression>
Prompt:     Use skill cowork:<orch> with { engagement_id: "<engagement.id>" }. When the orchestrator instructs you to use a sub-skill (cowork:write-run-note-*, cowork:gather-*, etc.), READ that sub-skill's SKILL.md from .claude/skills/cowork/skills/<name>/ and strictly follow its sections including any "## Pre-write self-check" checklist before proceeding with the action described in "## Steps". Return failed:contract-violation:<field> on any miss.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
Print all blocks to chat. Append to `register_results[]`: `{ orch, status: "paste-needed", task_id: null, cron, prompt }`.

## Step 7 — Persist scheduled-jobs config

Compose `spice/cowork/scheduled-jobs.md` content with frontmatter:
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

Write via the Write tool to `spice/cowork/scheduled-jobs.md` (overwrites).

## Step 8 — Done

Print final summary:
```
✅ Set up <N> scheduled jobs for <engagement.label>:
   • <orchestrator> | <cron> | next fire: <ISO timestamp>
   ...
   Next fire: <earliest of all next-fire times>

   To customize any prompt body, edit spice/cowork/prompts/<orch>.md
   To re-configure cadences or change prompts, re-run me anytime.
```

Emit Obsidian Notice `cowork:onboard-scheduled-jobs complete -- <N> jobs configured for <engagement.label> (<mode>)`.

## Returns

`{ engagement_id, mode, register_results: [...], scheduled_jobs_path: "spice/cowork/scheduled-jobs.md", bulk_defaults_path: "a" | "b" | "c" | "d" | null }`.
