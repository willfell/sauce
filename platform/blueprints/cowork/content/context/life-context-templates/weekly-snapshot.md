---
type: scheduled-context
week-of: {{week_of}}
updated: {{week_of}}
updated_by: cowork:weekly-review
---

# Weekly Snapshot

> Rolling 1-week summary used by morning briefings + the next weekly review for trend awareness. Reset each Sunday by `cowork:weekly-review`.

---

## Spending Summary

{{week_spending_summary}}

Week-to-date totals filled in by the weekly job. Empty between weekly runs.

## Vault Activity

{{week_vault_activity}}

Daily-note count, journal entry count, EOD review count for the week. Refreshed by the weekly job.

## Mood and Energy Signals

{{week_mood_signals}}

One paragraph synthesizing the week's emotional + energy posture from journal entries + EOD reviews.

## Goal Progress

- {{week_goal_progress_1}}
- {{week_goal_progress_2}}
- {{week_goal_progress_3}}

One bullet per active goal in `finance-goals.md`. Quantify movement vs. the prior week.

## Key Events This Period

- {{week_key_events}}

Major events that occurred during the week.

## Relationship Pulse

- {{week_relationship_pulse}}

One bullet per inner-circle person, summarizing contact frequency + warmth.

## Threads Resolved This Period

{{week_threads_resolved}}

List of threads moved to Resolved during the week.

## Stale Thread Watch (carrying into next week)

- {{week_stale_threads}}

Threads >7 days open with no movement, carrying into the next week's morning briefings.

---

## Previous Weeks

(Older week-of entries are kept here as H3 subsections for trend reference. The weekly job rolls the current snapshot into this section before resetting.)
