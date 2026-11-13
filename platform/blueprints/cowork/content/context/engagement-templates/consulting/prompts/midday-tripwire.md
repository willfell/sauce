---
type: cowork-engagement-default-prompt
engagement_type: consulting
prompt_for: cowork:midday-tripwire
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# Midday tripwire — consulting (NOT typically enabled)

> [!note]
> The consulting engagement type does NOT enable midday-tripwire by default
> (`default_cadences.midday: false`). When you enable it, the orchestrator
> checks the engagement's `tripwire_aspects` (`calendar_drift`,
> `queue_growth`) and writes a note only when one trips. This default body
> exists as a placeholder if you customize the engagement for something
> more specific (e.g., a billable-hours threshold check).

Customize for your use case. Suggested shape:

## Midday consulting check-in

One paragraph from the gather outputs — billable-hours so far, client-communication tempo, or whatever you're tracking.

## Flagged items

Bulleted list of items needing attention before EOD. Each bullet: item · why-flagged · suggested action.

---

If you don't want midday-tripwire for this engagement, leave it disabled in the onboard wizard.

**Gather-skipped handling:** If any section's gather skill emitted `gather-skipped: <reason>` (calendar or email MCP unavailable, or any consulting-specific source unreachable), render that section as a single `> [!warning] <Section name> unavailable` admonition naming the reason — do NOT omit the section silently. Continue composing the rest of the briefing normally.
