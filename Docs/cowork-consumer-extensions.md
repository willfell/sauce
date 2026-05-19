# Cowork consumer extensions

How to add your own scheduled jobs (e.g. ADO sprint-sync, custom snapshots) on top of the sauce-shipped cowork orchestrators. Follows the same atomic-note contract so ActivityFeed + SpaceDailyDashboard pick up your extensions for free.

## Reference template

The sauce-shipped `cowork:write-run-note-finance` sub-skill is the canonical copy-paste template. Open `<vault>/.claude/skills/cowork/skills/write-run-note-finance/SKILL.md` and use it as the starting point for your extension.

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

Copy `<vault>/.claude/skills/cowork/skills/write-run-note-finance/SKILL.md` to `<vault>/.claude/skills.local/cowork-sprint-sync/SKILL.md`. In the new file, substitute these literals:

- `cowork:write-run-note-finance` → `cowork:sprint-sync` (the orchestrator name)
- `cowork-finance-snapshot` → `cowork-sprint-sync` (the type value)
- `finance.md` → `sprint-sync.md` (the filename slug)

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
