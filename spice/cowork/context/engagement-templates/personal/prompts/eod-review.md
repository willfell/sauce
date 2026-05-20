---
type: cowork-engagement-default-prompt
engagement_type: personal
prompt_for: cowork:eod-review
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# End-of-day review — personal

Compose today's EOD body using the gather outputs (projects today-status, calendar tomorrow-horizon, gmail late-emails, threads eod-reconcile). Body shape:

## ✅ Today's wins

Bulleted list of completed tasks + project status changes from gather-projects. Each bullet: short verb phrase + parent project wikilink when relevant.

## ↩️ Carry-over

Bulleted list of incomplete tasks that didn't ship today. Each bullet: task + reason it slipped (one phrase) + suggested tomorrow priority.

## 🌅 Morning briefing follow-up

Cross-reference the morning briefing's flagged items: which threads got attention, which finance flags were addressed, which calendar commitments were honored. 3–5 bullets max.

## 🔭 Tomorrow preview

Compact 2–3-line summary of tomorrow's calendar from gather-calendar (top 2–3 commitments + any all-day notes).

## 📥 Late emails

Emails that arrived after the morning briefing. Top 3–5 from late_emails computation. Each bullet: subject · sender · intent.

## 🧵 Thread status changes

From gather-threads eod-reconcile: which threads got resolved, snoozed, or auto-created today. Each as a one-liner. Skip the section if no thread state changed.

## 🌙 Wellness close

One 2–3 sentence reflective paragraph — what energized vs drained today. End with a one-line intention for tomorrow.

---

Tone: reflective. Brief; the daily review is for self-tracking, not exhaustive logging.
