---
type: cowork-hub
tags: [cowork-hub]
---

# Cowork

```dataviewjs
const vaultConfig = app.vault.getAbstractFileByPath("spice/cowork/context/vault-config.md");
let bootstrapped = false;
if (vaultConfig) {
  const cache = app.metadataCache.getFileCache(vaultConfig);
  const engagements = cache?.frontmatter?.engagements;
  bootstrapped = Array.isArray(engagements) && engagements.length > 0;
}
if (!bootstrapped) {
  dv.paragraph("> [!warning]+ This vault has not been bootstrapped yet\n> Run `cowork:bootstrap-vault` to interview yourself and materialize per-engagement context files + the nav-button table below.\n> Until bootstrap runs, the orchestrators in the table below have nothing to dispatch against.");
}
```

> [!abstract] What is cowork?
> The cowork blueprint is the automation layer that lets Claude run scheduled jobs against your vault using your connected MCP servers. Each orchestrator is a native Claude Code skill materialized to `<vault>/.claude/skills/cowork/` at install time. A cron schedule fires Claude with a one-line invocation (e.g. `cowork:morning-briefing --engagement_id accuris`); Claude loads the orchestrator's SKILL.md, resolves the engagement from `vault-config.md`, delegates to sub-skills for gathering + writing, and patches your daily note, weekly summary, or context state.
>
> Cowork is **engagement-aware**. A vault may host one or more engagements (`personal`, `w2-fte`, `consulting`) — each is a named slice with its own MCP scoping (gmail label, calendar id), render-aspects (which sections to compose), and cadence enablement. Every orchestrator takes `engagement_id` as input; outputs flow into per-engagement H2 sections within the daily note's `<!-- COWORK_CALLOUTS -->` block.

---

## Engagements + cadences

<!-- BOOTSTRAP_ENGAGEMENT_TABLE_BEGIN -->

The nav-button table below is rendered by `cowork:bootstrap-vault` at first run (and refreshed by every re-bootstrap pass). Rows = engagements; columns = supported cadences. Each cell is a nav-button that invokes the matching orchestrator with `engagement_id` already bound.

Before bootstrap runs, this section is empty — the warning callout above prompts you to run `cowork:bootstrap-vault`.

<!-- BOOTSTRAP_ENGAGEMENT_TABLE_END -->

```dataviewjs
// Renders a "Last run" stamp column per (engagement, cadence) pair by scanning
// recent daily notes for the matching ## <Cadence> — <Engagement.label> H2 blocks.
// Pre-bootstrap: silent no-op.
const vaultConfig = app.vault.getAbstractFileByPath("spice/cowork/context/vault-config.md");
if (vaultConfig) {
  const cache = app.metadataCache.getFileCache(vaultConfig);
  const engagements = cache?.frontmatter?.engagements;
  if (Array.isArray(engagements) && engagements.length > 0) {
    // Walk last 14 days of daily notes under spice/daily/*/MM-Month/<date>.md;
    // find H2 lines of the form `## <Cadence> — <engagement.label>`; capture the
    // most recent date per (engagement.id, cadence). Render as a table.
    // Implementation lives in the materialized hub; this is a placeholder
    // comment for the dataviewjs body that bootstrap-vault writes during step 20.
    dv.paragraph("_(Last-run table renders here when bootstrap completes.)_");
  }
}
```

---

## Skills

### Orchestrators (5)

These are the entry points fired by cron — each takes `engagement_id` and dispatches against one engagement.

| Skill                       | Cadences supported per engagement type                                |
|:----------------------------|:----------------------------------------------------------------------|
| `cowork:morning-briefing`   | personal, w2-fte, consulting                                          |
| `cowork:midday-tripwire`    | personal (finance-tracking engagements only)                          |
| `cowork:eod-review`         | personal, w2-fte, consulting                                          |
| `cowork:weekly-review`      | personal, w2-fte, consulting                                          |
| `cowork:monthly-review`     | personal, consulting (skipped by default for w2-fte)                  |

Plus the one-time entry point:

| Skill                       | When                                                                  |
|:----------------------------|:----------------------------------------------------------------------|
| `cowork:bootstrap-vault`    | User-invoked. First-run interview + per-engagement context materialization + nav-button table rendering + audit-receipt embed. |

### Sub-skills (27)

Sub-skills are composable building blocks. Orchestrators call them in sequence; they never schedule themselves.

| Skill                                       | Tier            | One-line purpose                                                       |
|:--------------------------------------------|:----------------|:-----------------------------------------------------------------------|
| `cowork:skills/check-vault-routing`         | Routing         | Verifies the active Obsidian MCP points at the correct vault.          |
| `cowork:skills/date-context`                | Routing         | Resolves today/yesterday/week-of dates + daily-note path.              |
| `cowork:skills/ensure-daily-note`           | Routing         | Creates the daily note if missing, returns its path.                   |
| `cowork:skills/gather-weather`              | Gather          | Personal-engagement-only weather pull from wttr.in.                    |
| `cowork:skills/gather-calendar`             | Gather          | Pulls events from `engagement.calendar_id` (or primary).               |
| `cowork:skills/gather-gmail`                | Gather          | Pulls threads scoped by `engagement.gmail_label`.                      |
| `cowork:skills/gather-imessage`             | Gather          | Personal-engagement-only iMessage pull.                                |
| `cowork:skills/gather-finance-yesterday`    | Gather          | Pulls yesterday's transactions; gated by `render_aspects.finance_block`. |
| `cowork:skills/gather-finance-cc-today`     | Gather          | Pulls today's new CC charges + locked-card alerts.                     |
| `cowork:skills/gather-cc-debt-snapshot`     | Gather          | Pulls CC balances + utilization + APR per account.                     |
| `cowork:skills/gather-projects`             | Gather          | Scans `spice/projects/*/` kanban; filters by `engagement_id` tag.      |
| `cowork:skills/gather-threads`              | Gather          | Reads `active-threads.md`; filters by `engagement_id` tag.             |
| `cowork:skills/write-callout-morning-briefing` | Write-callout | Engagement-aware morning callout; type-branches the section layout.    |
| `cowork:skills/write-callout-finance`               | Write-callout | Renders the Finance callout (personal + consulting).             |
| `cowork:skills/write-callout-tripwire-red`          | Write-callout | Renders a red (action-required) midday tripwire callout.         |
| `cowork:skills/write-callout-tripwire-yellow`       | Write-callout | Renders a yellow (watch-list) midday tripwire callout.           |
| `cowork:skills/write-callout-eod-review`            | Write-callout | Engagement-aware EOD callout; type-branches the layout.          |
| `cowork:skills/write-summary-weekly`                | Write-summary | Engagement-aware weekly summary at `summaries/weekly/<engagement.id>/`. |
| `cowork:skills/write-summary-monthly`               | Write-summary | Engagement-aware monthly summary at `summaries/monthly/<engagement.id>/`. |
| `cowork:skills/write-summary-invoice-prep`          | Write-summary | Consulting-only invoice prep (RENAMED from invoice-prep@0.30.0). |
| `cowork:skills/write-summary-fte-status`            | Write-summary | NEW: w2-fte weekly + monthly status block.                       |
| `cowork:skills/update-active-threads`               | State         | Patches `active-threads.md` (open/resolve/snooze + engagement_id tag). |
| `cowork:skills/update-active-projects`              | State         | (legacy — orphaned in v0.31.0; deprecation TBD)                  |
| `cowork:skills/update-weekly-snapshot`              | State         | Refreshes the rolling `weekly-snapshot.md` per-engagement section. |
| `cowork:skills/patch-daily-callouts`                | Helper        | Idempotent insert-or-replace under `## <Cadence> — <engagement.label>` H2. |
| `cowork:skills/run-audit-receipt`                   | Helper        | Runs `sauce audit --only cowork` and returns formatted receipt for bootstrap report. |

---

## Context

Per-engagement context lives under `spice/cowork/context/<engagement.id>/`. Vault-wide context (`vault-config.md`, `active-threads.md`, `weekly-snapshot.md`) lives at `spice/cowork/context/`. Sub-skills + orchestrators read these files for engagement record lookup, MCP routing, brand voice, and thread state.

> [!tip] Open the context
> - [[context/README]] — index of all files in this directory.
> - [[context/vault-config]] — canonical engagement record (frontmatter `engagements[]` is the source of truth).
> - [[context/obsidian-vault-guide]] — canonical path map for the sauce-shape vault.
> - [[context/active-threads]] — vault-wide open threads, engagement-id-tagged.
> - [[context/weekly-snapshot]] — rolling 1-week trend file refreshed by the weekly job.

Per-engagement files (e.g. `spice/cowork/context/<engagement.id>/about.md`, `working-style.md`, `mcp-integrations.md`) are materialized by `cowork:bootstrap-vault` and survive `sauce update`. Platform-managed files (README, obsidian-vault-guide) overwrite on update with a `.sauce-backup` of the previous version.

---

## Getting started

> [!todo] First-time setup
> 1. Install or update the cowork blueprint: `sauce update` from the workshop, or accept the new blueprint at the next sync.
> 2. Run `cowork:bootstrap-vault` to interview yourself (one question at a time): pick engagement types, fill in required fields per type, enable cadences, choose cron drop mode.
> 3. Bootstrap writes `vault-config.md` + per-engagement context dirs + this hub's engagement nav-button table + an audit-receipt report.
> 4. Verify your MCP servers are connected (Obsidian + at least one of Gmail / Google Calendar / Copilot Money / iMessage depending on engagement types). See each engagement's `mcp-integrations.md`.
> 5. Paste the bootstrap-emitted cron blocks into your cron infrastructure for whichever `(engagement, cadence)` pairs you enabled. Re-run bootstrap any time to add / drop engagements or change cadence enablement.
