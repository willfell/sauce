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
> (`default_cadences.midday: false`) and the engagement-type's `render_aspects.finance_block` is `skip`, so the standard
> personal-finance tripwire logic doesn't apply here. The orchestrator
> will early-exit silently for w2-fte engagements. This default body exists
> only as a placeholder if you customize the engagement to enable midday
> for a non-finance purpose (e.g., a mid-day stakeholder pulse-check).

Customize for your use case. Suggested shape:

## 📍 Midday check-in

One paragraph from the gather outputs — what's the state of the work-day so far?

## 🚦 Flagged items

Bulleted list of items needing attention before EOD. Each bullet: item · why-flagged · suggested action.

---

If you don't want midday-tripwire for this engagement, leave it disabled in the onboard wizard.
