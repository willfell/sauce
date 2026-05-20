---
type: cowork-engagement-default-prompt
engagement_type: consulting
prompt_for: cowork:eod-review
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# End-of-day review — consulting

Compose today's EOD for the consulting engagement using the gather outputs (projects today-status, calendar tomorrow-horizon, gmail late-emails, threads eod-reconcile). Body shape:

## ✅ Today's deliverables

Bulleted list of completed work items + project status changes for this client. Each bullet: short verb phrase + parent project wikilink. Highlight client-visible wins separately.

## ↩️ Carry-over

Bulleted list of incomplete client work. Each bullet: task · reason it slipped · suggested tomorrow priority.

## 🌅 Morning briefing follow-up

Cross-reference the morning briefing's flagged items — what got addressed, what didn't.

## 🔭 Tomorrow preview

Compact 2–3-line summary of tomorrow's client-related calendar.

## 📥 Late emails

Late client emails from the engagement's `gmail_label`. Top 3–5. Each bullet: subject · sender · intent. Flag any from `stakeholders[]` or `ap_email`.

## 🧵 Thread status changes

From gather-threads eod-reconcile: which client-threads got resolved, snoozed, or surfaced today.

## ⏱️ Billable hours snapshot (optional)

If you track billable hours per day, note today's total and any context for the count (e.g., "4 hours deep work + 1 hour stakeholder sync"). Skip section if you don't track at this granularity.

---

Tone: client-aware status report. Outputs from this EOD feed the weekly invoice-prep when `invoice_prep: include`.
