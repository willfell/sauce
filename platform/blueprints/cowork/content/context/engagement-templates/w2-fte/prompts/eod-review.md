---
type: cowork-engagement-default-prompt
engagement_type: w2-fte
prompt_for: cowork:eod-review
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# End-of-day review — w2-fte

Compose today's EOD for the w2 engagement using the gather outputs (projects today-status, calendar tomorrow-horizon, gmail late-emails, threads eod-reconcile). Body shape:

## ✅ Today's wins

Bulleted list of completed work items + project status changes. Each bullet: short verb phrase + parent project wikilink when relevant. Highlight stakeholder-visible wins separately.

## ↩️ Carry-over

Bulleted list of incomplete tasks. Each bullet: task · reason it slipped · suggested tomorrow priority.

## 🌅 Morning briefing follow-up

Cross-reference the morning briefing's flagged items — which got attention, which didn't.

## 🔭 Tomorrow preview

Compact 2–3-line summary of tomorrow's calendar (top 2–3 work commitments).

## 📥 Late emails (work scope)

Emails that arrived after morning briefing in the engagement's `gmail_label`. Top 3–5. Each bullet: subject · sender · intent. Flag any from `stakeholders[]` or `manager`.

## 🧵 Thread status changes

From gather-threads eod-reconcile: which work-threads got resolved, snoozed, or surfaced today.

## 🤝 Stakeholder updates

If any communication with `stakeholders[]` or `manager` happened today, summarize the gist (1–3 bullets). Useful for the weekly status block.

---

Tone: status-report concise. The w2 EOD feeds into the weekly review's FTE status block.
