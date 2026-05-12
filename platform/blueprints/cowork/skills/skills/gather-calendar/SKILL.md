---
name: cowork:gather-calendar
description: Fetch one engagement's Google Calendar events (scoped by engagement.calendar_id when set) for the given horizon and emit a paste-ready calendar callout block.
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

Pulls every event scheduled for `date` from Google Calendar via the Anthropic-managed Google Calendar MCP and emits a normalized `[!example]+` callout. The orchestrator pastes the result directly under the Morning Briefing's Schedule sub-block.

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
4. Call `mcp__claude_ai_Google_Calendar__list_events` with arguments:
   - `calendar_id`: `{{calendar_id from step 2}}`
   - `time_min`: ISO-8601 string with timezone offset
   - `time_max`: ISO-8601 string with timezone offset
   - `single_events`: `true` (expand recurring)
   - `order_by`: `startTime`
3. For each returned event extract: `start.dateTime` (or `start.date` for all-day), `summary`, `location`, `attendees[].email`.
4. Convert each `start.dateTime` to `HH:MM` in `timezone` (24h). All-day events render as `all-day`.
5. For attendees, drop the user's own email; render the remaining as a comma-separated list (max 3, then `+N more`). If no attendees, render `solo`.
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

## Errors

- **Google Calendar MCP unavailable / not authenticated / API error:** return:
  ```markdown
  > [!warning]+ Calendar unavailable
  > Google Calendar MCP not connected. Re-authenticate via the Anthropic connectors UI.
  ```
- **Missing `date_today` or `timezone`:** return:
  ```markdown
  > [!warning]+ Calendar unavailable
  > Missing `date_today` or `timezone` input - orchestrator must call cowork:date-context first.
  ```
- Never throw. Always return a paste-ready string.
