---
type: cowork-engagement-default-prompt
engagement_type: personal
prompt_for: cowork:weekly-review
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# Weekly review — personal

Compose this week's review body using the gather outputs (finance full-week, cc-debt-snapshot weekly, calendar next-week, gmail newer_than:7d, imessage 7-day, projects weekly, threads weekly-audit). Body shape:

## 📆 Week in review

One paragraph naming the week's tone — wins, frustrations, big moves. 4–6 sentences.

## 💰 Finance week

Week-to-date spend total (USD). Top 3 merchants. CC payoff progress: current balance vs target (delta in dollars + a one-sentence trajectory call). If `debt_weekly_target_usd` is configured, compare actual paydown vs target.

## 📅 Calendar next week

3–5 bullets naming next week's biggest commitments (gather-calendar horizon=next-week). Flag any overcommitted days.

## 💬 Communication week summary

Top recurring email + iMessage threads from the last 7 days. 3–5 bullets each section — who you stayed in touch with, who you owe a reply to.

## 📊 Project status

From gather-projects (weekly filter): completed work · in-progress · stalled. Each as one bullet with project wikilink.

## 🧵 Threads weekly audit

From gather-threads weekly-audit: stale-over-7d threads, snoozed-back-to-open, resolved this week. 4–6 bullets max.

## ⏭️ Next week setup

One 2–3 sentence paragraph naming the next week's main objective. End with a concrete Monday-morning starting point.

---

Tone: zoomed-out and honest. Numbers matter (spend + payoff progress); the rest can be qualitative.
