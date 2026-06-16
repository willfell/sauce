---
type: cowork-engagement-default-prompt
engagement_type: consulting
prompt_for: cowork:weekly-review
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# Weekly review — consulting

Compose this week's review for the consulting engagement using the gather outputs (finance full-week, cc-debt-snapshot weekly, calendar next-week, gmail 7-day, projects weekly, threads weekly-audit) + invoice block from `write-summary-invoice-prep` when `invoice_cadence == "weekly"`.

## Week in review

One 4–6 sentence paragraph naming the week's tone for this client — wins, frustrations, scope discussions.

## Finance week

Week-to-date billable activity. If `cc-debt-snapshot` is non-empty, summarize. Specifically call out any client-related expenses tracked via Brex (when `brex_enabled: true`).

## Project deliverables

From gather-projects (weekly filter): completed work, in-progress, blocked, stalled. Each bullet with project wikilink + state.

## Client communication week

Email + meeting touchpoints with `stakeholders[]` + `ap_email`. 3–5 bullets — who you talked to, what's outstanding.

## Calendar next week

3–5 bullets naming next week's client commitments. Flag any kickoffs, decision meetings, or stakeholder syncs.

## Invoice prep

If `invoice_cadence == "weekly"` AND today is at/near `billing_anchor_day`: include the full block from `cowork:write-summary-invoice-prep` (weekly mode). Otherwise note "No weekly invoice cadence" and skip.

## Threads weekly audit

From gather-threads weekly-audit: stale-over-7d, snoozed-back-to-open, resolved this week.

## ⏭ Next week setup

One 2–3 sentence paragraph naming next week's main client objective. End with a concrete Monday-morning starting point.

---

Tone: client-aware status. This often informs invoice prep, so be specific about deliverables shipped.

**Gather-skipped handling:** If any section's gather skill emitted `gather-skipped: <reason>` (calendar or email MCP unavailable, or any consulting-specific source unreachable), render that section as a single `> [!warning] <Section name> unavailable` admonition naming the reason — do NOT omit the section silently. Continue composing the rest of the briefing normally.

> [!tip] Related context
> When Smart Connections has an up-to-date local index of this vault, a "Related context" block will appear in this run-note's body showing thematically-close notes. The lag-age line in the Synopsis tells you how stale the index is (open Obsidian to refresh).

