---
type: cowork-hub
tags: [cowork-hub]
---

# Cowork

> [!abstract] What is cowork?
> The cowork blueprint is the automation layer that lets Claude run scheduled jobs against your vault using your connected MCP servers. Each orchestrator is a native Claude Code skill materialized to `<vault>/.claude/skills/cowork/` at install time. A cron schedule fires Claude with a one-line invocation (e.g. `cowork:morning-briefing`); Claude loads the orchestrator's SKILL.md, delegates to sub-skills for gathering + writing, and patches your daily note, weekly summary, or context state.
>
> Everything that lands in this vault from cron-fired Claude flows through these skills. No personal content, MCP credentials, or schedule logic lives in this hub note -- those live in your per-vault context files under `spice/cowork/context/` and your `.claude/cron/` configuration.

---

## Skills

### Orchestrators (9)

These are the entry points fired by cron. Each one composes a sequence of sub-skills to produce a deliverable.

| Skill                       | Schedule (typical)   | Scope |
|:----------------------------|:---------------------|:------|
| `cowork:morning-briefing`   | weekdays 06:30 local | life  |
| `cowork:midday-tripwire`    | weekdays 12:00 local | life  |
| `cowork:eod-review`         | weekdays 21:00 local | life  |
| `cowork:weekly-review`      | Sun 19:00 local      | life  |
| `cowork:monthly-review`     | 1st of month 19:00   | life  |
| `cowork:ero-morning`        | weekdays 07:00 local | ero   |
| `cowork:ero-eod`            | weekdays 18:00 local | ero   |
| `cowork:ero-weekly`         | Fri 17:00 local      | ero   |
| `cowork:ero-monthly`        | 1st of month 09:00   | ero   |

### Sub-skills (29)

Sub-skills are composable building blocks. Orchestrators call them in sequence; they never schedule themselves.

| Skill                                       | Tier            | One-line purpose                                                       |
|:--------------------------------------------|:----------------|:-----------------------------------------------------------------------|
| `cowork:skills/check-vault-routing`         | Routing         | Verifies the active Obsidian MCP points at the correct vault.          |
| `cowork:skills/date-context`                | Routing         | Resolves today/yesterday/week-of dates + daily-note path.              |
| `cowork:skills/ensure-daily-note`           | Routing         | Creates the daily note if missing, returns its path.                   |
| `cowork:skills/gather-weather`              | Gather          | Pulls today's forecast for the owner's location.                       |
| `cowork:skills/gather-calendar`             | Gather          | Pulls today + next-N-days events from Google Calendar.                 |
| `cowork:skills/gather-gmail`                | Gather          | Pulls unread + recent threads filtered to inner-circle senders.        |
| `cowork:skills/gather-imessage`             | Gather          | Pulls recent iMessage threads + unanswered inner-circle messages.      |
| `cowork:skills/gather-finance-yesterday`    | Gather          | Pulls yesterday's transactions via Copilot Money MCP.                  |
| `cowork:skills/gather-finance-cc-today`     | Gather          | Pulls today's new CC charges + locked-card alerts.                     |
| `cowork:skills/gather-cc-debt-snapshot`     | Gather          | Pulls CC balances + utilization + APR per account.                     |
| `cowork:skills/gather-projects`             | Gather          | Scans `spice/projects/*/` kanban boards for active workstreams.        |
| `cowork:skills/gather-threads`              | Gather          | Reads `spice/cowork/context/active-threads.md` open + snoozed items.   |
| `cowork:skills/write-callout-morning-briefing-life` | Write-callout | Renders the life Morning Briefing callout into the daily note.   |
| `cowork:skills/write-callout-morning-briefing-ero`  | Write-callout | Renders the ero Morning Briefing callout into the daily note.    |
| `cowork:skills/write-callout-finance`               | Write-callout | Renders the Finance callout into the daily note.                 |
| `cowork:skills/write-callout-tripwire-red`          | Write-callout | Renders a red (action-required) midday tripwire callout.         |
| `cowork:skills/write-callout-tripwire-yellow`       | Write-callout | Renders a yellow (watch-list) midday tripwire callout.           |
| `cowork:skills/write-callout-eod-life`              | Write-callout | Renders the life EOD Review callout into the daily note.         |
| `cowork:skills/write-callout-eod-ero`               | Write-callout | Renders the ero EOD Review callout into the daily note.          |
| `cowork:skills/write-summary-weekly-life`           | Write-summary | Writes the weekly summary file under `spice/cowork/summaries/weekly/`. |
| `cowork:skills/write-summary-weekly-ero`            | Write-summary | Writes the ero weekly summary file.                              |
| `cowork:skills/write-summary-monthly-life`          | Write-summary | Writes the monthly review file under `spice/cowork/summaries/monthly/`. |
| `cowork:skills/write-summary-monthly-ero`           | Write-summary | Writes the ero monthly review file.                              |
| `cowork:skills/update-active-threads`               | State         | Patches `active-threads.md` (open/resolve/snooze + Last Surfaced).     |
| `cowork:skills/update-active-projects`              | Helper        | Refreshes the `## Current Projects` table in `active-projects.md`.     |
| `cowork:skills/update-weekly-snapshot`              | State         | Refreshes the rolling `weekly-snapshot.md` between weekly jobs.        |
| `cowork:skills/patch-daily-callouts`                | Helper        | Idempotent insert-or-replace of a callout block in the daily note.     |
| `cowork:skills/invoice-prep`                        | State         | Aggregates session-end hours into the current-month ero invoice.       |

---

## Context

Per-vault user-managed config lives under `spice/cowork/context/`. Sub-skills + orchestrators read these files for owner identity, MCP routing, brand voice, and thread state.

> [!tip] Open the context
> - [[context/README]] -- index of all files in this directory.
> - [[context/obsidian-vault-guide]] -- canonical path map for the sauce-shape vault.
> - [[context/active-threads]] -- open threads carried day-to-day (rule_fragment-validated).
> - [[context/weekly-snapshot]] -- rolling 1-week trend file refreshed by the weekly job.
> - [[context/about-me]] (life) or [[context/about-will]] (ero) -- owner identity skeleton.

User-managed files (about-me, finance-goals, weekly-snapshot, active-threads, active-projects, people, mcp-integrations, etc.) survive `sauce update`. Platform-managed files (README, obsidian-vault-guide) are overwritten on update with a `.sauce-backup` of the previous version.

---

## Getting started

> [!todo] First-time setup
> 1. Install or update the cowork blueprint: `sauce update` from the workshop, or accept the new blueprint at the next sync.
> 2. Run `cowork:bootstrap-vault` to materialize per-vault context files from the scope templates and stub your `.claude/cron/` entries.
> 3. Fill in `about-me.md` (life) or `about-will.md` (ero) -- the rest of the context files reference values from there.
> 4. Verify your MCP servers are connected (Obsidian, Gmail, Google Calendar, Copilot Money, iMessage). See `context/mcp-integrations.md`.
> 5. Enable the cron schedule entries for the orchestrators you want fired. Disable any you don't.
