# Cowork consumer extensions

How to add your own scheduled jobs (e.g. ADO sprint-sync, custom snapshots) on top of the sauce-shipped cowork orchestrators. Follows the same atomic-note contract so ActivityFeed + SpaceDailyDashboard pick up your extensions for free.

## Reference template

The skill skeleton in Step 2 below is the copy-paste template. The sauce-shipped `cowork:write-run-note-*` sub-skills are not: each one writes through `writeAtomicNote`, which requires a sidecar validated against that cadence's JSON Schema.

## Worked example — sprint-sync against ADO

A consumer running on a W2-FTE engagement wants `cowork:sprint-sync` to fire Mon–Fri 07:08 (just after the morning briefing) and pull team-board activity from Azure DevOps into a daily atomic note.

### Step 1 — Define a consumer-local type

Add `cowork-sprint-sync` to a consumer-local rule_fragment. Use the `.local/` override seam (landmine #22 — survives reinstalls):

```text
<vault>/.claude/rules.local/cowork-sprint-sync.json
```

```json
{
  "scope": "spice/cowork/daily/**/*/sprint-sync.md",
  "extends": "_canonical-vocab",
  "required_frontmatter": {
    "type":           { "required": true, "type": "string", "equals": "cowork-sprint-sync" },
    "engagement_id":  { "required": true, "type": "string" },
    "day":            { "required": true, "type": "string", "matches": "^\\d{4}-\\d{2}-\\d{2}$" },
    "generator":      { "required": true, "type": "string" }
  },
  "naming_pattern": "^sprint-sync\\.md$"
}
```

### Step 2 — Author a consumer-local skill

Create `<vault>/.claude/skills.local/cowork-sprint-sync/SKILL.md`. Three literals vary per extension: the orchestrator name (`cowork:sprint-sync`), the type value (`cowork-sprint-sync`), and the filename slug (`sprint-sync.md`).

````markdown
---
name: cowork:sprint-sync
description: Write today's sprint-sync run as an atomic note to spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/sprint-sync.md (type cowork-sprint-sync). Overwrites the prior same-day run.
inputs:
  engagement: object
  date: string
  weekday: string
  month_name: string
  body: string
outputs:
  path: string
  status: string
---

# cowork:sprint-sync

1. Compose the path `spice/cowork/daily/<YYYY>/<MM>-<MonthName>/<YYYY-MM-DD>/sprint-sync.md` from `date` and `month_name` (take `date` from `cowork:date-context`, never the local clock).
2. Compose the frontmatter:
   ```yaml
   ---
   type: cowork-sprint-sync
   title: "Sprint Sync — <weekday>, <month_name> <D>, <YYYY>"
   summary: "<1-2 sentences>"
   created_at: "<ISO-8601 with offset>"
   engagement_id: "<engagement.id>"
   day: "<date>"
   generator: "cowork:sprint-sync@1.0.0"
   ---
   ```
3. Write frontmatter + one blank line + `body`: `mkdir -p` the parent directory, then write the file (overwrite is the contract: last write wins).
4. Return `{ path, status: "written" }`, or `{ path, status: "failed:<reason>" }` on any failure.
````

Add gather steps for ADO ahead of the write step (use whatever ADO MCP you have configured — `azuredevops` or similar).

### Step 3 — Register the scheduled job in Claude Cowork app

```text
Task: sprint-sync
Schedule: Mon–Fri 07:08
Vault: <your-vault-name>
Invocation: Use skill cowork:sprint-sync with { engagement_id: "accuris" }
```

### Step 4 — (Optional) surface in ActivityFeed

ActivityFeed renders the new run-notes by default (it queries any `type:` matching its `_DEFAULT_BLUEPRINTS` list). To explicitly include `cowork-sprint-sync` in the default list, override the vault's activity-feed config or pass `blueprints: [..., "cowork-sprint-sync"]` to the hub embed of your choice.

### Step 5 — Verify

Open `Cowork.md`. The readiness panel does not have a built-in row for consumer-extension orchestrators (it tracks the sauce-shipped 5), but the run-notes appear in ActivityFeed sections of Daily Hub, the cowork Today.md, and SpaceDailyDashboard's cowork panel.

## Naming conventions

- Type prefix: always `cowork-<your-job>` for run-notes that should flow through cowork's UI surfaces.
- Path: `spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/<slug>.md` (atomic-note shape).
- Orchestrator name: `cowork:<your-job>` for symmetry with sauce-shipped orchestrators.

## Why `.local/`

The `.local/` override seam (landmine #22) lets you add files that survive reinstalls. Directly editing canonical sauce-shipped files (in `.claude/skills/cowork/...` without `.local/`) gets reverted on the next `sauce install`. The `/audit` slash command surfaces direct-canonical edits as `consumer_edit_at_risk` warnings before they're lost.
