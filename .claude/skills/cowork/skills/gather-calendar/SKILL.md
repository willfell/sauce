---
name: cowork:gather-calendar
description: Fetch one engagement's calendar events (scoped by engagement.calendar_id when set) for the given horizon and emit a paste-ready calendar callout block. Uses whichever calendar MCP is available at runtime per the ## MCP routing section.
inputs:
  engagement_id: string
  date_today: string
  horizon: string
  range_start: string
  range_end: string
  timezone: string
  calendar_id_override: string
outputs:
  markdown: string
  today_events: list[object]
  week_ahead_events: list[object]
  next_week_events: list[object]
  next_month_events: list[object]
  ai_committee_status: string
tags: [cowork, gather, engagement-aware]
---

# cowork:gather-calendar

Pulls every event scheduled for `date` from whichever calendar MCP is available at runtime (per the `## MCP routing` section below) and emits a normalized `[!example]+` callout. The orchestrator pastes the result directly under the Morning Briefing's Schedule sub-block.

## Inputs

- `engagement_id` (string, required): id of the engagement this gather runs for. Resolves to per-engagement calendar scope.
- `date_today` (string, required): anchor day in `YYYY-MM-DD` form.
- `horizon` (string, optional, default `"today"`): one of `"today"` | `"today+next-2-days"` | `"next-week"` | `"next-month"`. Drives the default range when `range_start` / `range_end` are absent. `today` = `[date_today, date_today]`. `today+next-2-days` = `[date_today, date_today + 2 days]`. `next-week` and `next-month` use the supplied `range_start` / `range_end`.
- `range_start` (string, optional): explicit `YYYY-MM-DD` lower bound. Overrides `horizon`-derived start.
- `range_end` (string, optional): explicit `YYYY-MM-DD` upper bound. Overrides `horizon`-derived end.
- `timezone` (string, optional, default `"America/Denver"`): IANA timezone used to bound the day window and format event times.
- `calendar_id_override` (string, optional): explicit calendar id override. When absent, uses `engagement.calendar_id` from vault-config.md; falls back to `"primary"` if neither is set.

## Outputs

- `markdown` (string): a single `> [!example]+` callout, paste-ready. Title varies by horizon.
- `today_events` (list[object]): structured today's events when `horizon` includes today.
- `week_ahead_events` (list[object]): structured next-week events when horizon = `next-week` or `today+next-2-days`.
- `next_week_events` (list[object]): same shape, populated only when `horizon = "next-week"`.
- `next_month_events` (list[object]): populated only when `horizon = "next-month"`.
- `ai_committee_status` (string, w2-fte / consulting only): short literal describing AI Committee meeting status this week (e.g., `"AI Committee Tue 14:00 -- on calendar"`). Empty string when not applicable or when `engagement.type == "personal"`.

## Steps

1. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md` via `mcp__obsidian__get_frontmatter`; look up `engagements[]` entry where `id == engagement_id`. Capture `engagement`. If not found, return the calendar-unavailable callout + Notice.
2. Determine effective calendar id: `calendar_id = calendar_id_override || engagement.calendar_id || "primary"`.
3. Resolve the query window:
   - If `range_start` and `range_end` are both provided, use them.
   - Else derive from `horizon`: `today` → `[date_today, date_today]`; `today+next-2-days` → `[date_today, date_today + 2d]`; `next-week` and `next-month` REQUIRE explicit `range_start` / `range_end` from the caller.
   Then compute `time_min = <range_start>T00:00:00` and `time_max = <range_end>T23:59:59` in `timezone`.
4. Resolve which calendar MCP to use via the `## MCP routing` section below. Call its `list_events`-equivalent tool with arguments:
   - `calendar_id`: `{{calendar_id from step 2}}`
   - `time_min`: ISO-8601 string with timezone offset
   - `time_max`: ISO-8601 string with timezone offset
   - `single_events`: `true` (expand recurring)
   - `order_by`: `startTime`

   If no calendar MCP is available, follow the skip path in `## MCP routing` (emit `gather-skipped: no calendar MCP available in this Claude Code runtime` and pass `warning: calendar_unavailable` up to the orchestrator) and exit.
3. For each returned event extract: `start.dateTime` (or `start.date` for all-day), `summary`, `location`, `attendees[].email`.
4. Convert each `start.dateTime` to `HH:MM` in `timezone` (24h). All-day events render as `all-day`.
5. **Resolve attendees + render list.** For each event:
   - Drop the user's own email from the attendees list.
   - For each remaining attendee email, call `cowork:resolve-person` with `input: <attendee_email>`, `prefer_type: "email"`, `engagement_id: <engagement_id>`.
   - **On resolve hit:** render `[[<person_basename>]]`.
   - **On resolve miss:** render `<localpart>@…` truncated (current plaintext behavior preserved).

   Compose the comma-separated list (max 3, then `+N more` for overflow). If no attendees, render `solo`.
6. If the result list is empty, return the empty-day callout from Returns.
7. Otherwise compose the bullet-list callout per Returns and return it.

## Returns

Non-empty case:

```markdown
> [!example]+ Today's calendar
> - **HH:MM** - [Event title] - [attendees or "solo"][, location: [location]]
> - **HH:MM** - [Event title] - [attendees]
> - **all-day** - [Event title] - [attendees]
```

Empty case:

```markdown
> [!example]+ Today's calendar
> No events scheduled.
```

### Structured items (NEW v0.96.0)

In addition to `markdown`, return `items[]` with one entry per surfaced calendar event. Use the `deriveItemId` helper exported from `gather-from-served-by-helper.js` to construct stable IDs (same-day re-fires return byte-identical ids):

```json
{
  "items": [
    {
      "item_id": "<deriveItemId({ kind: 'calendar', engagement_id, day, stable_key: event.uid || sha256(event.start + event.summary) })>",
      "kind": "calendar",
      "callout_type": "example",
      "title": "<event.summary>",
      "features": {
        "time_of_day_bucket": "morning|midday|afternoon|evening",
        "sender_or_organizer_inner_circle": <bool — true if event.organizer.email matches inner_circle resolver>,
        "recency_bucket": "today|tomorrow|day-after",
        "subject_recurring": <bool — true if event.recurrenceId present>,
        "is_warning": false
      }
    }
  ]
}
```

`item_id` MUST be stable across same-day re-fires. Prefer the calendar API's UID; fall back to `sha256(start + summary).slice(0,16)` via `deriveItemId` when UID absent.

## Errors

- **Calendar MCP unavailable / not authenticated / API error:** return:
  ```markdown
  > [!warning]+ Calendar unavailable
  > No calendar MCP connected in this runtime. See the `## MCP routing` section for which MCPs this skill can use.
  ```
  Also emit `gather-skipped: no calendar MCP available in this Claude Code runtime` and pass `warning: calendar_unavailable` to the orchestrator.
- **Missing `date_today` or `timezone`:** return:
  ```markdown
  > [!warning]+ Calendar unavailable
  > Missing `date_today` or `timezone` input - orchestrator must call cowork:date-context first.
  ```
- Never throw. Always return a paste-ready string.

## Modes

When the caller passes `mode: "drift-check"`, scope the gather to the `horizon` window (e.g. `"today+4h"`) and return a delta-shaped object instead of the default daily snapshot:

```
{
  markdown: <one-paragraph drift summary>,
  drift_minutes: <integer; minutes of drift detected in the horizon window>,
  drifted_events: [{ event_id, original_start, current_start, drift_minutes, reason }]
}
```

Drift sources to detect when available: events moved to a different start time since the morning briefing snapshot; events cancelled; events running long (current_end > scheduled_end by ≥15 min). If no calendar MCP is available, emit `gather-skipped: no calendar MCP available in this Claude Code runtime` per the MCP routing pattern below.

When drift-check completes successfully but no drift is detected in the horizon window, return `{ markdown: "", drift_minutes: 0, drifted_events: [] }` (not null). The orchestrator distinguishes this empty-success from `gather-skipped` via the latter's structured warning payload — only `gather-skipped` produces a null `calendar_signal` upstream.

When `mode` is unset (default), behavior is unchanged — return the daily calendar snapshot as today.

## MCP routing

This skill can pull calendar data from any of the following MCPs, in priority order:

1. **Google Calendar** — `mcp__claude_ai_Google_Calendar__list_events` (Anthropic-managed; available in headspace-style personal vault setups).
2. **Outlook** — `mcp__claude_ai_Outlook__*` (when wired by the user; common in w2-fte employer-managed runtimes).
3. **Apple Calendar** — `mcp__claude_ai_Apple_Calendar__*` (when wired by the user).

At runtime: introspect on the available tool list. Pick the first MCP whose primary `list_events`-equivalent tool is available. If none are available, do **NOT** attempt the call. Instead emit a single line:

  gather-skipped: no calendar MCP available in this Claude Code runtime

Also pass `warning: calendar_unavailable` up to the orchestrator so the atomic note's frontmatter `warnings:` array records the skip and the body's calendar section renders as a `> [!warning] Calendar unavailable` admonition (per the write-run-note body-shape contract).

When a higher-priority MCP IS available but its call returns empty (no events on the requested day), that is NOT a skip — emit the gather output normally with an empty events list. Skip is reserved for MCP unavailability, not empty data.
