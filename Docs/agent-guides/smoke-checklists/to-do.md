---
purpose: Manual in-Obsidian smoke checklist for the to-do blueprint.
load_when: Cycle close that touches to-do's template / dialog / widget surface.
---

# to-do smoke checklist

Run on a deployed consumer vault after `brew upgrade sauce && sauce update --bump-pins && sauce install`.

## Templates
- [ ] Open today's `ToDo-<date>.md` → renders without console errors
- [ ] All dataviewjs blocks resolve (no stuck "Loading..." states)
- [ ] `+ New Task` button present + clickable

## +New Task dialog
- [ ] Both tabs render (Today + Recurring)
- [ ] Today tab: empty title → Create button disabled
- [ ] Today tab: valid title → Create button enables → click → task lands in today's daily
- [ ] Recurring tab: empty/invalid recurrence → Create disabled
- [ ] Recurring tab: valid "every day" → Create enables → click → registry entry appears in `Recurring Tasks.md`
- [ ] Link picker (both tabs): pick a note → `[[Note Name]]` inserted at cursor
- [ ] URL inserter (both tabs): label + URL → `[label](url)` inserted at cursor

## Widgets
- [ ] ToDoDailyRecurring renders today's recurring tasks (no raw `<dataviewjs>` text shown)
- [ ] ToDoDailyCarryover renders carryover tasks
- [ ] ToDoDailyProjectGroups: markdown links in task text render as `<a>` elements (not raw `[label](url)`)  ← bug (c) verification
- [ ] ToDoDailyProjectGroups: wikilinks render as `<a class="internal-link">` (not raw `[[Name]]`)  ← bug (c) verification
- [ ] ToDoDailyUnassignedMeetings: same markdown rendering verification as above
- [ ] Click a meeting-sourced task → opens the source meeting note

## Mid-day-added recurring task (bug b verification)
- [ ] Open today's `ToDo-<date>.md` (sentinel should be set after first render)
- [ ] Edit `spice/to-do/Recurring Tasks.md` → add a new recurring task line
- [ ] Cmd+R the today daily → new task appears in the recurring section  ← would have FAILED pre-v0.7.0
- [ ] Verify the sentinel comment now has the form `<!-- recurring-materialized-<date>: <hashes> -->`

## Sentinel heal migration (one-time, post-install)
- [ ] Before install: `grep -l 'recurring-materialized-2026' spice/to-do/2026/06-June/` finds files with date-only sentinels
- [ ] After `sauce install`: same grep shows date-only sentinels rewritten to `: ` (empty set) form
- [ ] On next Obsidian render, the set populates with current hashes

## Console
- [ ] DevTools console empty of red errors after rendering each surface

## Result-doc note
Paste "Manual smoke: COMPLETED on <vault>" or "N/A — no UI change" into the cycle's result doc.
