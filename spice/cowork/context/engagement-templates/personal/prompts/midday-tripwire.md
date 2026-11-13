---
type: cowork-engagement-default-prompt
engagement_type: personal
prompt_for: cowork:midday-tripwire
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# Midday tripwire — personal (NOT typically enabled)

> [!note]
> The personal engagement type ships with no tripwire aspects
> (`tripwire_aspects: []`) and does NOT enable midday-tripwire by default
> (`default_cadences.midday: false`). With no aspects, the orchestrator
> exits silently for personal engagements. To use it, name an aspect in
> the engagement's `overrides.tripwire_aspects` (e.g., `calendar_drift`)
> and enable the midday cadence; this default body is the placeholder for
> that case.

Customize for your use case. Suggested shape:

## Midday check-in

One paragraph from the gather outputs — what changed since the morning briefing?

## Flagged items

Bulleted list of items needing attention before EOD. Each bullet: item · why-flagged · suggested action.

---

If you don't want midday-tripwire for this engagement, leave it disabled in the onboard wizard.

**Gather-skipped handling:** If any section's gather skill emitted `gather-skipped: <reason>` (calendar / gmail / imessage MCP unavailable), render that section as a single `> [!warning] <Section name> unavailable` admonition naming the reason — do NOT omit the section silently. Continue composing the rest of the briefing normally.
