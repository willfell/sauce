---
name: cowork:gather-projects
description: Scan spice/projects/ kanban boards + card notes; return normalized per-project state for callout writers.
inputs:
  engagement_id: string
  filter: string
  today: string
  week_range: object
  month_range: object
  carry_over_from: string
  thresholds: object
outputs:
  projects: list[object]
  thread_triggers: list[object]
  carried_over: list[object]
  in_progress: list[object]
  todo: list[object]
  blocked: list[object]
  people_nudges: list[object]
  completed: list[object]
  incomplete: list[object]
  kanban_in_progress: list[object]
  kanban_to_do: list[object]
  kanban_blocked: list[object]
  daily_count: number
  journal_count: number
  todo_count: number
  task_velocity: object
tags: [cowork, gather, projects, engagement-aware]
---

# cowork:gather-projects

Reads every project under `spice/projects/<slug>/`, parses its kanban board, walks In Progress + Blocked card notes, and synthesizes the data the morning/eod/weekly callout writers need. FAT: orchestrator never parses kanban markdown; this sub-skill emits a fully normalized list.

## Inputs
- `engagement_id` (string, required): id of the engagement this gather runs for. Projects in `spice/projects/<slug>/` may be tagged with `engagement_id` frontmatter; this gather filters to projects matching the given engagement (untagged projects are treated as vault-wide and included for all engagements). For personal engagements, also walks side-quests + carried-over todos from yesterday's daily note.
- `filter` (string, optional, default `"active"`): one of `"active"` | `"today-status"` | `"weekly"` | `"monthly"`.
  - `"active"` - morning-briefing usage. Returns currently active projects + in-progress + blocked + people-nudge candidates + carried-over todos from `carry_over_from`.
  - `"today-status"` - eod-review usage. Returns `completed` (today's `- [x]`), `incomplete` (today's `- [ ]`), `kanban_in_progress`, `kanban_to_do`, `kanban_blocked`.
  - `"weekly"` - weekly-review usage. Returns daily/journal/todo counts + kanban completed-this-week / stuck-this-week + side-quest movement + task_velocity (created vs completed vs carried).
  - `"monthly"` - monthly-review usage. Returns month-window equivalents of the weekly fields plus task_completion_rate.
- `today` (string, optional): `YYYY-MM-DD`. Required for `today-status` and `active` filters.
- `week_range` (object, optional): `{ start, end }`. Required for `weekly` filter.
- `month_range` (object, optional): `{ start, end }`. Required for `monthly` filter.
- `carry_over_from` (string, optional): vault-relative path to yesterday's daily note. When provided, `active` filter populates `carried_over` from yesterday's `- [ ]` items.
- `thresholds` (object, optional, default `{ blocked_age_days: 3, stale_card_days: 5 }`): work-scope thread-trigger thresholds.

## Outputs
- `projects` (list[object]): one entry per project with In Progress or Blocked tasks (work-scope). Planning-only and completed-only projects are filtered out.
- `thread_triggers` (list[object]): cards that crossed thread thresholds during this scan, ready for `cowork:update-active-threads`.
- `carried_over` (list[object], life + active): yesterday's `- [ ]` items.
- `in_progress` (list[object], life + active): in-progress kanban items.
- `todo` (list[object], life + active): today's todo backlog.
- `blocked` (list[object], life + active): blocked kanban items.
- `people_nudges` (list[object], life + active): wikilinked people candidates whose threads have ages crossing nudge thresholds.
- `completed` (list[object], today-status): today's completed tasks.
- `incomplete` (list[object], today-status): today's still-open tasks (carry-over candidates).
- `kanban_in_progress`, `kanban_to_do`, `kanban_blocked` (list[object], today-status): current column states.
- `daily_count`, `journal_count`, `todo_count` (number, weekly + monthly): note counts in the window.
- `task_velocity` (object, weekly + monthly): `{ created, completed, carried }`.

## Steps

Branching is driven by the `filter` input. Steps 1-7 below describe the `"active"` and `"today-status"` paths; sections 8 and 9 describe the `"weekly"` and `"monthly"` paths (which add daily-note / journal / to-do / meetings traversal on top of the project scan).

### Filter: `"active"` and `"today-status"` (project scan)

1. List `spice/projects/` via `mcp__obsidian__list_directory`. For each child directory, treat the name as the project `slug` (kebab-case).
2. For each `slug`, read the kanban board at `spice/projects/<slug>/<slug>-board.md` via `mcp__obsidian__read_note`. If missing, skip that project (record nothing - boards are required for cowork visibility). Parse lanes by Markdown heading: `## In Progress`, `## Blocked`, `## In Planning`, `## Completed`. Within each lane, every line beginning with `- [[` is a card. Extract the wikilink target as the card name.
3. For each card in In Progress + Blocked lanes, read the card note. The card's note path is whichever resolves first via `mcp__obsidian__read_note`:
   - `spice/projects/<slug>/tasks/<Card Name>.md`
   - `spice/projects/<slug>/<Card Name>.md`
   If neither resolves, record the card with an empty body and a `note_missing: true` flag. Extract from the body:
   - Summary section content (the first paragraph after `## Summary` or the first paragraph if no summary heading).
   - Open checkboxes (lines matching `- [ ]` - these are next steps).
   - "Awaiting" / "blocked on" language (case-insensitive substring scan; capture the surrounding sentence).
   - Wikilinked person names (any `[[...]]` inside the body that resolves to a note under `spice/people/`).
   - Last-modified timestamp via `mcp__obsidian__get_notes_info` for staleness detection.
4. Detect thread triggers per `thresholds`:
   - Card in Blocked lane with `last_modified` older than `blocked_age_days` days from today → emit `{ type: "project-blocked", card: "<Card Name>", slug: "<slug>", age_days: N }`.
   - Card in In Progress with `last_modified` older than `stale_card_days` days → emit `{ type: "stale-card", card: "<Card Name>", slug: "<slug>", age_days: N }`.
   - Use today's date as supplied via `cowork:date-context` upstream; do NOT call any system clock here.
5. Read each project's atlas note at `spice/projects/<slug>/<slug>.md` (or `spice/projects/<slug>/Project.md` per project@1.3.8 schema, whichever exists) for the project display name, phase, and status. If both exist, prefer `<slug>.md` for legacy compatibility, falling back to `Project.md`.
6. Build the per-project object:
   ```json
   {
     "slug": "egnyte-connector-rollout",
     "name": "Egnyte Connector Rollout",
     "status": "Active -- Pilot",
     "phase": "Pilot -- Phase 1 stabilization",
     "in_progress_count": 2,
     "blocked_count": 1,
     "in_progress_cards": [
       { "name": "Card Name", "wikilink": "[[Card Name]]", "summary": "...", "next_steps": ["..."], "people": ["[[Sean]]"], "last_modified": "2026-05-04", "age_days": 4 }
     ],
     "blocked_cards": [ ... same shape ... ],
     "next_step": "Specific next action synthesized from the cards above. Be concrete: 'Email Sean re: API credentials' not 'follow up on error'."
   }
   ```
7. Filter the output: include a project ONLY if `in_progress_count + blocked_count > 0`. Planning-only and completed-only projects are dropped. The `thread_triggers` list is independent of this filter.

7a. `filter: "today-status"` additional derivation: from the per-project kanban parse above, also derive a `followups` list of cards that warrant the eod-review's attention:
   - Cards in the Blocked lane whose `last_modified` is within the last 3 days (recently-blocked, fresh signal).
   - Cards moved to Completed today (heuristic: a `- [[Card Name]] -- <comment>` line under `## Completed` whose card-note's `last_modified` matches `today`). Capture the trailing comment if present.
   - Shape: `followups: [{ slug, card, type: "recently-blocked" | "completed-with-comment", comment, age_days }]`. Empty list is fine.

### Filter: `"weekly"` (project scan + daily / journal / to-do / meetings traversal)

8. Run steps 1-7 above with no input changes (the project scan is identical; only the windowing of completed-this-week / stuck-this-week differs in the per-project object). Then, in addition, perform the following traversals using the input `week_range = { start, end }` (both `YYYY-MM-DD`, inclusive):

   8a. **Daily notes traversal** (drives `hours_data`, `daily_count`, partial `task_velocity`):
   - Enumerate every `YYYY-MM-DD` date between `week_range.start` and `week_range.end` inclusive (typically 7 dates).
   - For each date, compute the expected daily-note path using the daily blueprint canonical layout: `spice/daily/<YYYY>/<MM-Month>/<dddd>-<YYYY-MM-DD>.md`. Use `mcp__obsidian__list_directory` on `spice/daily/<YYYY>/<MM-Month>/` to confirm the file exists (cheaper than 7 sequential reads when listing once); then `mcp__obsidian__get_notes_info` for batch metadata and `mcp__obsidian__read_note` for each found note.
   - For each daily note found, parse:
     - Time Log: locate the `> [!abstract]+ Time Log` callout block (or fallback `## Time Log` heading). Each row inside the callout is a session — extract `start`, `end`, `project`, `notes`, and compute `hours = (end - start)` (decimal hours). Sum daily total.
     - Todo-completions: count lines matching `^>?\s*- \[x\] ` inside the entire note body (covers callout-embedded checkboxes which are the dominant pattern).
   - Aggregate into `hours_data`:
     ```json
     {
       "total_hours_week": 32.5,
       "hours_per_day": [
         { "date": "2026-05-04", "hours": 6.0, "weekday": "Monday" },
         { "date": "2026-05-05", "hours": 7.5, "weekday": "Tuesday" }
       ],
       "sessions": [
         { "date": "2026-05-04", "start": "09:00", "end": "12:00", "project": "egnyte-connector-rollout", "hours": 3.0, "notes": "..." }
       ],
       "gap_days": ["2026-05-07"]
     }
     ```
     - `gap_days` lists ISO dates in `week_range` that had NO daily note (the file was absent).
   - `daily_count` = number of daily notes that existed (not gap days).

   8b. **Meetings traversal** (drives `meetings`):
   - For each `YYYY-MM` covered by `week_range` (usually one, sometimes two if the week straddles a month boundary), list `spice/meetings/notes/<YYYY>/<MM-MonthName>/` via `mcp__obsidian__list_directory`. If the folder is absent, emit a Notice (`cowork:gather-projects - meetings folder missing for <YYYY-MM>`) and treat as empty.
   - For each meeting note found, read frontmatter via `mcp__obsidian__get_frontmatter`. Filter to notes whose `date` (or `created`) falls within `week_range`.
   - For each in-range meeting, capture `{ date, title, attendees, summary }` where `title` is the note basename, `attendees` comes from frontmatter (or wikilinked-people scan of body), and `summary` is the first paragraph of the body or the `## Summary` section if present.
   - `meetings = [ ... ]` (sorted chronologically). Empty list is fine.

   8c. **Journal traversal** (drives `journal_count`):
   - List `spice/journal/` recursively via `mcp__obsidian__list_directory`. For each `.md` file, read frontmatter via `mcp__obsidian__get_frontmatter` and check `created` (or the file's own date prefix). Count files whose `created` falls within `week_range`.
   - `journal_count` = that count.

   8d. **To-do traversal** (drives `todo_count`):
   - List `spice/to-do/` recursively via `mcp__obsidian__list_directory`. For each `.md` file, read frontmatter and count files whose `created` falls within `week_range`.
   - `todo_count` = that count.

   8e. **Task velocity** (drives `task_velocity`):
   - `created` = sum of new tasks across the week (count `- [ ]` lines added to daily notes + new to-do notes — best-effort, derived from daily-note bodies in step 8a).
   - `completed` = total `- [x]` count summed from step 8a's todo-completions tally.
   - `carried` = number of `- [ ]` items that appear in multiple consecutive daily notes within the week (best-effort string match on task text across step 8a's parsed bodies).
   - Shape: `task_velocity = { created: N, completed: N, carried: N }`.

### Filter: `"monthly"` (project scan + month-window traversal)

9. Same shape as `"weekly"` (steps 8 + 8a-8e) but the window is `month_range = { start, end }` instead of `week_range`. Adjust accordingly:
   - Daily-notes traversal enumerates every day in `month_range` (28-31 dates).
   - Meetings traversal iterates the relevant `YYYY-MM` folders (usually one).
   - Journal / to-do traversal uses `month_range` as the window.
   - `hours_data.total_hours_week` is renamed conceptually to `total_hours_month` but the JSON key stays `total_hours_week` for output-shape stability (callers know the window from context); alternatively emit a separate `total_hours_month` key when `filter: "monthly"`. The orchestrator (`monthly-review`, `ero-monthly`) consumes `hours_data.hours_per_day` directly so the per-day shape is the cross-window contract.
   - `task_velocity` additionally exposes `task_completion_rate = completed / (created + carried)` rounded to two decimals (monthly-only field; weekly omits it).

## Returns
```json
{
  "projects": [ { "slug": "...", "name": "...", "status": "...", "phase": "...", "in_progress_count": 0, "blocked_count": 0, "in_progress_cards": [], "blocked_cards": [], "next_step": "..." } ],
  "thread_triggers": [ { "type": "project-blocked", "card": "...", "slug": "...", "age_days": 4 } ]
}
```

## Errors
- Missing `spice/projects/` directory: return `{ projects: [], thread_triggers: [] }` and emit one Notice (`cowork:gather-projects - spice/projects/ not found`).
- Per-project read errors: skip that project, append `{ slug, error: "<short>" }` to a sibling `errors` field if any callers care; otherwise silently skip and continue. Never abort the whole scan because of one bad project.
- Card-note read errors: record `note_missing: true` and continue. The callout writer renders these as `[[Card Name]] -- (note missing)` so the user can see the gap.
- Synthesizing `next_step` is best-effort. If no clear action emerges from card bodies, emit `"Review board state"` rather than fabricating a specific action.
- `filter: "weekly"` / `"monthly"` — missing daily notes for some days in the range: do NOT fail. Record those dates in `hours_data.gap_days` and continue with the days that exist. Empty `gap_days` is the happy path.
- `filter: "weekly"` / `"monthly"` — `spice/meetings/notes/<YYYY>/<MM-MonthName>/` folder absent: do NOT fail. Return `meetings: []` for that month + emit a single Notice (`cowork:gather-projects - meetings folder missing for <YYYY-MM>`).
- `filter: "weekly"` / `"monthly"` — `spice/journal/` or `spice/to-do/` folder absent: do NOT fail. Set the respective count to `0` and continue.
- Time Log parse failures (malformed table row, unparseable time): skip the offending row, do not abort the day. Sum what parses cleanly.
