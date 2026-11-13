---
type: cowork-engagement-default-prompt
engagement_type: consulting
prompt_for: cowork:monthly-review
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# Monthly review — consulting (PREVIOUS month)

Reviewing the PREVIOUS month for the consulting engagement using the gather outputs (calendar next-month, projects monthly, threads monthly-audit, forward-stressors).

## Month in review

One 4–6 sentence paragraph naming the month's arc with this client — what shipped, decisions made, scope changes.

## Project status month

From gather-projects (monthly filter): projects closed this month, opened, in-progress longstanding. Each bullet with wikilink.

## Client relationship retrospective

Highlights of stakeholder interactions this month. Note any scope tension, kudos, or strategy shifts.

## Calendar next month

3–5 bullets naming next month's client commitments. Flag travel, multi-day workshops, or quarterly business reviews.

## Threads monthly audit

From gather-threads monthly-audit: full audit of open threads (older than 30 days), still-active, auto-archive candidates.

## Forward stressors

Inline forward-look — annual contract renewals, quarterly business cycles, planned client travel. Specific items with rough dates.

## ⏭ Next month focus

One 3–5 sentence paragraph naming the next month's main objective for this client. End with a concrete Day-1 starting point.

---

Tone: long-view client-aware. This is the most retrospective of the four cadences for consulting; write it as if briefing yourself ahead of a quarterly business review.

**Gather-skipped handling:** If any section's gather skill emitted `gather-skipped: <reason>` (calendar or email MCP unavailable, or any consulting-specific source unreachable), render that section as a single `> [!warning] <Section name> unavailable` admonition naming the reason — do NOT omit the section silently. Continue composing the rest of the briefing normally.
