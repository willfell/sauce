---
type: cowork-engagement-default-prompt
engagement_type: w2-fte
prompt_for: cowork:midday-tripwire
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# Midday tripwire — w2-fte (NOT typically enabled)

> [!note]
> The w2-fte engagement type does NOT enable midday-tripwire by default
> (`default_cadences.midday: false`). When you enable it, the orchestrator
> checks the engagement's `tripwire_aspects` (`calendar_drift`,
> `queue_growth`) and writes a note only when one trips. This default body
> exists as a placeholder if you customize the engagement for something
> more specific (e.g., a mid-day stakeholder pulse-check).

Customize for your use case. Suggested shape:

## Midday check-in

One paragraph from the gather outputs — what's the state of the work-day so far?

## Flagged items

Bulleted list of items needing attention before EOD. Each bullet: item · why-flagged · suggested action.

---

If you don't want midday-tripwire for this engagement, leave it disabled in the onboard wizard.

**Gather-skipped handling:** If any section's gather skill emitted `gather-skipped: <reason>` (e.g. the calendar MCP was unavailable in this runtime), render that section as a single `> [!warning] <Section name> unavailable` admonition naming the reason — do NOT omit the section silently. Continue composing the rest of the briefing normally.
