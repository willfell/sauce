---
type: cowork-engagement-default-prompt
engagement_type: personal
prompt_for: cowork:weekly-review
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# Weekly review — personal

Compose this week's review body using the gather outputs (finance full-week, cc-debt-snapshot weekly, calendar next-week, gmail 7-day, imessage 7-day, projects weekly, threads weekly-audit).

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

**Gather-skipped handling:** If any section's gather skill emitted `gather-skipped: <reason>` (calendar / gmail / imessage MCP unavailable, or finance source unreachable), render that section as a single `> [!warning] <Section name> unavailable` admonition naming the reason — do NOT omit the section silently. Continue composing the rest of the briefing normally.

> [!tip] 🧩 Related context
> When Smart Connections has an up-to-date local index of this vault, a "Related context" block will appear in this run-note's body showing thematically-close notes. The lag-age line in the Synopsis tells you how stale the index is (open Obsidian to refresh).

