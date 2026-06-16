# Obsidian Vault Guide (sauce-shape)

> [!info] Source of truth
> This file is the canonical path map for every cowork orchestrator + sub-skill operating against a sauce-shape vault. Cron-fired Claude reads it first to orient. Any disagreement between a skill body and this file should be resolved in favor of this file (and the skill body patched).

---

## MCP routing (mandatory)

Every scheduled job that loads this guide MUST route Obsidian operations through the vault-specific MCP for `{{vault_id}}`.

- All vault reads + writes use `mcp__{{vault_id}}-obsidian__*` tools (`obsidian_get_file_contents`, `obsidian_list_files_in_dir`, `obsidian_put_content`, `obsidian_patch_content`, `obsidian_simple_search`, etc.).
- Do NOT cross vaults. Multiple sauce-shape vaults share the same top-level structure (`spice/`, `ranch/`, `pantry/`), so writing to the wrong one corrupts the wrong vault.
- If a referenced file is missing in this vault, treat it as a hard error and report it. Do not substitute from another vault.
- The `cowork:skills/check-vault-routing` sub-skill is the first call in every orchestrator -- it verifies the MCP target matches `{{vault_id}}` before anything else runs.

---

## Top-level layout

The sauce platform sanctions five top-level directories. Anything else at vault root is consumer-owned and out of scope for cowork skills.

| Top-level dir       | Owner    | Purpose |
|:--------------------|:---------|:--------|
| `spice/`            | platform | Blueprint-managed content (one subdir per blueprint module_directory). |
| `ranch/`            | platform | Runtime plumbing (templates, scripts, views). Lowercase per landmine #19. |
| `pantry/`           | platform | Inside-vault workshop clone (mechanism + blueprint sources for vendoring). |
| `.claude/skills/`   | platform | Installer-materialized native Claude Code skills (incl. `.claude/skills/cowork/`). |
| `.obsidian/`        | platform | Vault config, allowlist-managed (see landmine #12). Hand-edits forbidden outside the allowlist. |

Cowork skills NEVER write outside `spice/cowork/` for their own state, and NEVER write outside `spice/<module>/` for content tied to other blueprints.

---

## Per-blueprint subdirs under `spice/`

Each blueprint owns exactly one directory under `spice/` (landmine #11 module-directory invariant). Cowork skills materialize content at the paths below.

| Blueprint     | Path                  | What lives here |
|:--------------|:----------------------|:----------------|
| `daily`       | `spice/daily/`        | Daily notes routed under `YYYY/MM-Month/` subfolders. |
| `journal`     | `spice/journal/`      | Journal entries, one file per day. |
| `project`     | `spice/projects/`     | Project atlas + map + board + tasks, one folder per slug. |
| `trips`       | `spice/trips/`        | Trip atlas + per-section notes, one folder per slug. |
| `people`      | `spice/people/`       | Person notes, one file per inner-circle person. |
| `meetings`    | `spice/meetings/`     | Meeting hubs + dated meeting notes. |
| `to-do`       | `spice/to-do/`        | To-Do hub + per-card task notes. |
| `boards`      | `spice/boards/`       | Kanban boards (incl. the global To-Do board). |
| `cowork`      | `spice/cowork/`       | Cowork hub + per-vault context + cron-fired summaries. |
| `finance`     | `spice/finance/`      | Invoices, budgets, debt tracking. |

---

## Filename + path conventions

### Daily notes (`daily` blueprint)
- Path: `spice/daily/<YYYY>/<MM-Month>/<dddd-YYYY-MM-DD>.md`
- Example: `spice/daily/2026/05-May/Monday-2026-05-04.md`
- Month folder format: `MM-Month` (`01-January` ... `12-December`). Title-case month name, zero-padded number.
- Day-of-week prefix is title-case.

### Journal entries (`journal` blueprint)
- Path: `spice/journal/<YYYY-MM-DD>.md`
- Example: `spice/journal/2026-05-04.md`

### Meetings (`meetings` blueprint)
- Notes path: `spice/meetings/notes/<YYYY>/<MM-Month>/<topic>-<YYYY-MM-DD>.md`
- Hubs path: `spice/meetings/hubs/<topic>.md`
- Example: `spice/meetings/notes/2026/05-May/AI Subcommittee-2026-05-04.md`

### Projects (`project` blueprint)
- Path: `spice/projects/<slug>/Project.md` (atlas, tagged `#project`)
- Companion: `spice/projects/<slug>/Project Map.md` (workstream hierarchy)
- Board: `spice/projects/<slug>/<slug>-board.md` (4-lane kanban)
- Tasks: `spice/projects/<slug>/tasks/<Task Name>.md` (tagged `#project-card`)
- `<slug>` is kebab-case. Atlas + Map + Board filenames use the literal strings above.

### Trips (`trips` blueprint)
- Atlas: `spice/trips/<slug>/Trip Atlas.md`
- Section notes: `spice/trips/<slug>/Trip <Section>.md` (e.g. `Trip Flights.md`, `Trip Lodging.md`, `Trip Itinerary.md`)
- Hub: `spice/trips/Trips.md`

### People (`people` blueprint)
- Path: `spice/people/<First Last>.md`
- Filenames are Title Case with spaces. The directory `people/` itself is lowercase.
- Example: `spice/people/Autumn Cooper.md`
- Hub: `spice/people/People.md` (excluded from the per-person rule_fragment).

### Cowork summaries
- Weekly: `spice/cowork/summaries/weekly/weekly-summary-<YYYY-MM-DD>.md` (filename date is the Sunday-of-week).
- Monthly: `spice/cowork/summaries/monthly/monthly-review-<YYYY-MM>.md`
- Filenames are kebab-case. Day name suffixes (when used in callout titles) are lowercase in filenames, Title Case inside callout titles.

---

## Wikilink rules

- Link by display title, not path: `[[Project Name]]` -- not `[[spice/projects/foo/Project|Project]]` unless disambiguation is required.
- When a path-rooted wikilink is needed (e.g. two notes share a basename), use `[[full/path/Note|Display Text]]` to keep the rendered text clean.
- People: check `spice/people/<First Last>.md` exists before linking. If not, create the person note using the people blueprint template, then wikilink.
- NEVER prefix wikilinks with a vault-name segment (`Life/`, `ERO/`, etc.) -- paths are vault-root-relative.

---

## Frontmatter expectations

Every blueprint enforces a minimal frontmatter shape via its `rule_fragments[]` in the manifest. Cowork orchestrators MUST respect these when creating new content.

### Daily note
```yaml
---
created: YYYY-MM-DD HH:mm
tags:
  - daily
  - YYYY/MM/DD
cssclasses:
  - wide
---
```
Required tag: `daily`. Required frontmatter: `created`.

### Journal entry
```yaml
---
created: YYYY-MM-DD
tags:
  - journal
  - YYYY/MM/DD
---
```
Required tag: `journal`.

### Meeting note
```yaml
---
type: meeting
created: YYYY-MM-DD
tags:
  - meeting
---
```
Required tag: `meeting`. Required field: `type`.

### Meeting hub
Required tag: `meetings-hub`.

### Project atlas
```yaml
---
type: project
name: "<Project Name>"
tags:
  - project
---
```
Required tag: `project`. Required fields: `type`, `name`.

### Trip atlas
```yaml
---
type: trip
name: "<Trip Name>"
tags:
  - trip
---
```
Required tag: `trip`. Required fields: `type`, `name`.

### Person note
Required frontmatter: `type` (cowork skills should write `type: person`). The Hub note `spice/people/People.md` is excluded.

### Cowork hub
```yaml
---
type: cowork-hub
tags: [cowork-hub]
---
```
Required tag: `cowork-hub`. Required field: `type`.

### Cowork active-threads
```yaml
---
type: cowork-threads
updated: YYYY-MM-DD
updated_by: <orchestrator-id>
---
```
All three fields required. Validated by the cowork `rule_fragments[]` entry for `spice/cowork/context/active-threads.md`.

### Cowork active-projects
```yaml
---
type: cowork-active-projects
updated: YYYY-MM-DD
updated_by: <orchestrator-id>
---
```
All three fields required. Validated by the cowork `rule_fragments[]` entry for `spice/cowork/context/active-projects.md`.

### Cowork weekly-snapshot
```yaml
---
type: scheduled-context
week-of: YYYY-MM-DD
updated: YYYY-MM-DD
updated_by: <orchestrator-id>
---
```
`updated_by` should reference the weekly orchestrator (`cowork:weekly-review` or `cowork:ero-weekly`).

---

## What lives where (cowork orchestrators -> write targets)

| Orchestrator                | Writes to                                                                                       |
|:----------------------------|:------------------------------------------------------------------------------------------------|
| `cowork:morning-briefing`   | Daily-note callouts (Morning Briefing, Finance, Email, Messages) + `active-threads.md` Last Surfaced field. |
| `cowork:midday-tripwire`    | Daily-note callout (Tripwire red/yellow). No state file writes.                                 |
| `cowork:eod-review`         | Daily-note callout (EOD Review) + `active-threads.md` (resolve/create/snooze).                  |
| `cowork:weekly-review`      | New file under `spice/cowork/summaries/weekly/` + `weekly-snapshot.md` reset.                   |
| `cowork:monthly-review`     | New file under `spice/cowork/summaries/monthly/`.                                               |
| `cowork:ero-morning`        | Daily-note callout (ero Morning Briefing) + `active-projects.md` table refresh + `active-threads.md` Last Surfaced. |
| `cowork:ero-eod`            | Daily-note callout (ero EOD) + `active-threads.md` (resolve/create/snooze) + session-end hour log. |
| `cowork:ero-weekly`         | New file under `spice/cowork/summaries/weekly/` + ero `weekly-snapshot.md` reset + 14-day thread archival. |
| `cowork:ero-monthly`        | New file under `spice/cowork/summaries/monthly/` + invoice-prep handoff.                        |

---

## Callout conventions (daily-note inline output)

Daily-note callouts use a fixed type-to-section mapping for visual consistency when collapsed.

| Section                | Callout type        | Notes |
|:-----------------------|:--------------------|:------|
| Morning Briefing       | `[!summary]-`       | Always collapsed by default (suffix `-`). |
| Finance                | `[!tip]-`           | Green. |
| Email                  | `[!info]-`          | Blue. |
| Messages               | `[!example]-`       | Purple. |
| EOD Review             | `[!note]-`          | Gray. |
| Open Threads           | `[!warning]-`       | Orange. Bottom of daily note. |
| Midday Tripwire (red)  | `[!danger]+`        | Always expanded; action required. |
| Midday Tripwire (yellow) | `[!warning]+`     | Always expanded; watch-list. |

Title-line rules:
- Title = section name only. No stat summaries, no numbers piped in the title (except Morning Briefing's date suffix).
- Morning Briefing: `Morning Briefing -- dddd, Month DD`.
- Messages: `Messages -- N unanswered` only if N > 0.
- Empty sections render `> [!type] Section (0)\n> Nothing notable`.

Interior content:
- Tables inside callouts prefix every row with `> `.
- Nested callouts (`> > [!warning]`) used sparingly for warnings inside a section.
- Separate sub-sections with `> ---`.
- One blank line between top-level callout blocks in the daily note.

---

## Style rules

- No emojis. Ever. Use inline Lucide SVG icons only (see `brand-voice.md`).
- No em dashes. Use hyphens or commas.
- 24-hour time format (`09:00`, `14:30`).
- Concise. Facts, not analysis. No filler.
- Lead with what needs attention; context after.
- If a section has nothing to report, say `Nothing notable` and move on.

---

## Auto-creation rules

### Daily note
If the daily note does not exist when a scheduled job runs, the `cowork:skills/ensure-daily-note` sub-skill creates it with the scaffold defined in the `daily` blueprint template. Scheduled jobs MUST NOT create daily notes via hand-written body strings -- always delegate to `ensure-daily-note`, which reads the canonical template from `ranch/templates/`.

### Summary date folder
Weekly + monthly summary folders are created lazily via `mkdir -p` (or the MCP equivalent) if they don't already exist.

---

## File access tools

Cowork skills run inside a Claude Code session with the standard tool palette:

| Operation                | Tool |
|:-------------------------|:-----|
| Read a vault file        | `mcp__{{vault_id}}-obsidian__obsidian_get_file_contents` |
| Create/replace a file    | `mcp__{{vault_id}}-obsidian__obsidian_put_content`       |
| Patch part of a file     | `mcp__{{vault_id}}-obsidian__obsidian_patch_content`     |
| List a directory         | `mcp__{{vault_id}}-obsidian__obsidian_list_files_in_dir` |
| Search content           | `mcp__{{vault_id}}-obsidian__obsidian_simple_search`     |
| Create directories       | `mkdir -p` via Bash (when the MCP cannot create a missing parent dir) |

Always include `.md` extension in file paths. Always use vault-root-relative paths.

---

## Thread system

Threads persist across days in `spice/cowork/context/active-threads.md`. They surface in the Morning Briefing's Open Threads callout and are updated by the EOD job.

### Schema
Each thread is an H3 under `## Open`, `## Snoozed`, or `## Resolved`:

| Field         | Required | Format |
|:--------------|:--------:|:-------|
| Title (H3)    | Yes      | `### [kebab-id] Human Title` |
| Type          | Yes      | `task`, `commitment`, `financial`, `trip-prep`, `project-blocked`, `stale-card`, `action-item`, `invoice-deadline` |
| Created       | Yes      | `YYYY-MM-DD` |
| Target        | No       | `YYYY-MM-DD` -- when to surface, or due date |
| Status        | Yes      | `open`, `snoozed`, `resolved` |
| Last Surfaced | Yes      | `YYYY-MM-DD` (updated by morning job) |
| Context       | Yes      | Free-text, 1-3 lines |

### Lifecycle
1. **Created** by morning job (auto-detects), EOD job (new items), or manually.
2. **Surfaced** in morning briefing when `status=open` and `target<=today`.
3. **Resolved** by EOD job; moved to Resolved section.
4. **Archived** by weekly job after 14 days in Resolved.

---

## Domain references

These domains have dedicated context files. Do not duplicate their schemas here -- read the canonical source.

| Domain                | Canonical context file                         |
|:----------------------|:-----------------------------------------------|
| Finance posture       | `spice/cowork/context/finance-goals.md` (life) or `finance-guide.md` (ero) |
| Active projects       | `spice/cowork/context/active-projects.md`      |
| Active threads        | `spice/cowork/context/active-threads.md`       |
| Weekly snapshot       | `spice/cowork/context/weekly-snapshot.md`      |
| Brand voice           | `spice/cowork/context/brand-voice.md`          |
| MCP integration notes | `spice/cowork/context/mcp-integrations.md`     |
| People                | `spice/cowork/context/people.md` + `spice/people/<Name>.md` |
| Working style         | `spice/cowork/context/working-style.md`        |
| Project management    | `spice/cowork/context/project-management.md`   |
