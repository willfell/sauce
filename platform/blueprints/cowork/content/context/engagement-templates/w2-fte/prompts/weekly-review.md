---
type: cowork-engagement-default-prompt
engagement_type: w2-fte
prompt_for: cowork:weekly-review
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# Weekly review — w2-fte

Compose this week's review for the w2 engagement using the gather outputs (calendar next-week, gmail 7-day, projects weekly, threads weekly-audit) + FTE status block from `write-summary-fte-status`. Body shape:

## 📆 Week status

One 4–6 sentence paragraph — what shipped this week, what slipped, tone of the engagement.

## 📊 Project deliverables

From gather-projects (weekly filter): completed work, in-progress, blocked, stalled. Each as one bullet with project wikilink + state.

## 🤝 Stakeholder check

Communication touchpoints with `stakeholders[]` + `manager` this week. 3–5 bullets — who you talked to, what's outstanding.

## 📅 Calendar next week

3–5 bullets naming next week's biggest work commitments. Flag any 1:1s, deep-work blocks, or stakeholder meetings.

## 📝 FTE status block

This is the standardized status block from `cowork:write-summary-fte-status`. Include the block content verbatim — covers manager-visible accomplishments, blockers, next-week plan.

## 🧵 Threads weekly audit

From gather-threads weekly-audit: stale-over-7d, snoozed-back-to-open, resolved this week.

## ⏭️ Next week setup

One 2–3 sentence paragraph naming next week's main objective. End with a concrete Monday-morning starting point.

---

Tone: status-report tone. This often gets read by your manager — keep wins concrete and blockers actionable.
