---
type: scheduled-context
week-of: {{week_of}}
updated: {{week_of}}
updated_by: cowork:ero-weekly
---

# Weekly Snapshot

Rolling 1-week summary used by `cowork:ero-morning` and `cowork:ero-weekly` for trend awareness. Reset each {{ero_weekly_reset_day}} by `cowork:ero-weekly`.

---

## Hours

Last week total ({{previous_week_label}}): {{previous_week_hours}} hrs / {{previous_week_dollars}} confirmed.
Current month-to-date: {{mtd_hours}} hrs / {{mtd_dollars}}.

---

## Project Movement

- {{week_project_movement_1}}
- {{week_project_movement_2}}

One bullet per project that moved a card on its kanban board this week.

---

## Threads

- **Opened:** {{week_threads_opened_count}}
- **Resolved:** {{week_threads_resolved_count}}
- **Still open:** {{week_threads_open_count}}
- **Crossing 14-day archival threshold next week:** {{week_threads_archiving_next}}

---

## Meetings

- {{week_meeting_1_summary}}
- {{week_meeting_2_summary}}

One bullet per meeting this week. Reference `[[spice/meetings/notes/...]]` wikilinks.

---

## Next Week Highlights

- {{week_next_highlight_1}}
- {{week_next_highlight_2}}
- {{week_next_highlight_3}}

Top 3-5 items the owner should focus on next week. Refreshed by the weekly job.
