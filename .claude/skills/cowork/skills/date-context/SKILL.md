---
name: cowork:date-context
description: Compute the canonical date strings the orchestrators use for paths, headers, and ranges.
inputs:
  reference: string
outputs:
  context: object
tags: [cowork, date]
---

# cowork:date-context

Returns the canonical bundle of date strings every orchestrator needs: today's ISO date, weekday name, month folder, week-of marker, and the resolved daily-note path. Timezone is fixed to America/Denver (Mountain Time) - every orchestrator runs from the user's local cron and the schedule reflects MT.

## Inputs
- `reference`: optional ISO date `YYYY-MM-DD` to anchor the computation. If omitted or empty, use the current date in America/Denver.

## Outputs
- `context`: object with keys (all strings unless noted):
  - `today` - `YYYY-MM-DD` (e.g., `2026-05-10`)
  - `yesterday` - `YYYY-MM-DD` (today minus one day)
  - `tomorrow` - `YYYY-MM-DD` (today plus one day)
  - `tomorrow_weekday` - full weekday name title-case for `tomorrow` (e.g., `Monday`)
  - `dddd` - full weekday name title-case for today (e.g., `Sunday`)
  - `dddd_lower` - full weekday name lowercase (e.g., `sunday`) for filename slugs
  - `MM-Month` - month folder name (e.g., `05-May`)
  - `YYYY` - 4-digit year
  - `YYYY-MM` - year-month for monthly folders
  - `week_of` - Monday of the current ISO week as `YYYY-MM-DD` (alias of `week_start`)
  - `week_start` - Monday of the current ISO week as `YYYY-MM-DD`
  - `week_end` - Sunday of the current ISO week as `YYYY-MM-DD`
  - `week_range` - `YYYY-MM-DD..YYYY-MM-DD` (Mon..Sun of current week)
  - `iso_week_label` - `YYYY-Www` zero-padded (e.g., `2026-W19`); the year prefix is the ISO week-year (which may differ from `YYYY` for the last few days of December / first few days of January)
  - `next_week_start` - `week_start + 7 days` as `YYYY-MM-DD`
  - `next_week_end` - `week_end + 7 days` as `YYYY-MM-DD`
  - `month_start` - first day of current month `YYYY-MM-DD`
  - `month_end` - last day of current month `YYYY-MM-DD`
  - `next_month_start` - first day of next month `YYYY-MM-DD`
  - `next_month_end` - last day of next month `YYYY-MM-DD`
  - `prev_month_start` - first day of previous month `YYYY-MM-DD`
  - `prev_month_end` - last day of previous month `YYYY-MM-DD`
  - `prev_month_label` - previous month name + year (e.g., `April 2026`)
  - `prev_month_yyyymm` - previous month as `YYYY-MM`
  - `prev_month_num` - previous month as `MM` zero-padded (e.g., `04`)
  - `prev_month_name` - previous month full English name (e.g., `April`)
  - `prev_month_year` - previous month 4-digit year (e.g., `2026`)
  - `daily_path` - `spice/daily/YYYY/MM-Month/dddd-YYYY-MM-DD.md` (canonical per daily blueprint v0.2.5+ - `format: "YYYY/MM-MMMM/dddd-YYYY-MM-DD"`)
  - `yesterday_daily_path` - same shape for yesterday
  - `tomorrow_daily_path` - same shape for tomorrow

## Steps
1. Resolve the reference date. If `reference` is empty, take the current instant in America/Denver and extract the calendar date there (NOT UTC).
2. Compute every output key using America/Denver-local arithmetic. Use ISO 8601 weeks (Monday = day 1, Sunday = day 7).
3. Week bounds: `week_start` is the Monday of the current ISO week (today's date minus `(ISO weekday - 1)` days). `week_end = week_start + 6 days` (Sunday). `week_of` is an alias of `week_start` retained for backwards compatibility. `week_range = "<week_start>..<week_end>"`.
4. ISO week label: compute the ISO week number (1-53) and the ISO week-year (the year that owns the Thursday of the current week). Render as `"<iso-year>-W<NN>"` with the week number zero-padded to two digits. Examples: `"2026-W19"`, `"2025-W01"`.
5. Next-week bounds: `next_week_start = week_start + 7 days`, `next_week_end = week_end + 7 days`. Both as `YYYY-MM-DD`.
6. Month bounds: `month_start` is the 1st of today's month. `month_end` is the last day of today's month (28 / 29 / 30 / 31 by calendar). `next_month_start` is the 1st of the month following today; `next_month_end` is the last day of that month. Handles December → January year rollover.
7. Previous month: compute `prev = today.firstOfMonth().minus({ months: 1 })`. Emit `prev_month_start` (first), `prev_month_end` (last), `prev_month_num` (zero-padded `MM`), `prev_month_name` (full English name, e.g., `April`), `prev_month_year` (4-digit year), `prev_month_yyyymm` (`YYYY-MM`), `prev_month_label` (`<prev_month_name> <prev_month_year>`).
8. `tomorrow_weekday` is the full English weekday name (title-case) of `today + 1 day`.
9. Compose the daily-note paths using the sauce-shape canonical layout: `spice/daily/<YYYY>/<MM-Month>/<dddd>-<YYYY-MM-DD>.md`. Title-case weekday in the filename. This matches the daily blueprint's `format: "YYYY/MM-MMMM/dddd-YYYY-MM-DD"` exactly.
10. Return the assembled object.

## Returns
JSON object with all keys listed in `## Outputs`. Example for reference `2026-05-10`:

```json
{
  "today": "2026-05-10",
  "yesterday": "2026-05-09",
  "tomorrow": "2026-05-11",
  "tomorrow_weekday": "Monday",
  "dddd": "Sunday",
  "dddd_lower": "sunday",
  "MM-Month": "05-May",
  "YYYY": "2026",
  "YYYY-MM": "2026-05",
  "week_of": "2026-05-04",
  "week_start": "2026-05-04",
  "week_end": "2026-05-10",
  "week_range": "2026-05-04..2026-05-10",
  "iso_week_label": "2026-W19",
  "next_week_start": "2026-05-11",
  "next_week_end": "2026-05-17",
  "month_start": "2026-05-01",
  "month_end": "2026-05-31",
  "next_month_start": "2026-06-01",
  "next_month_end": "2026-06-30",
  "prev_month_start": "2026-04-01",
  "prev_month_end": "2026-04-30",
  "prev_month_label": "April 2026",
  "prev_month_yyyymm": "2026-04",
  "prev_month_num": "04",
  "prev_month_name": "April",
  "prev_month_year": "2026",
  "daily_path": "spice/daily/2026/05-May/Sunday-2026-05-10.md",
  "yesterday_daily_path": "spice/daily/2026/05-May/Saturday-2026-05-09.md",
  "tomorrow_daily_path": "spice/daily/2026/05-May/Monday-2026-05-11.md"
}
```

## Errors
- Malformed `reference` (not `YYYY-MM-DD` shape): return `{ "error": "invalid reference: <value>" }`. Orchestrators MUST check for an `error` key and abort.
- Timezone resolution failure (extremely unlikely): return `{ "error": "tz lookup failed" }`.
- Never raise. Orchestrators always receive a JSON object.
