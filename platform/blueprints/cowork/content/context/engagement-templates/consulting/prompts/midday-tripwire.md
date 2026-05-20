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
> (`default_cadences.midday: false`). Although consulting has `render_aspects.finance_block: include`,
> consulting finance is invoice-driven (not daily-CC-tracked the way personal
> is), so the personal-finance midday tripwire logic isn't directly useful.
> This default body exists only as a placeholder if you customize the
> engagement for something specific (e.g., a billable-hours threshold check
> or expense-report alert).

Customize for your use case. Suggested shape:

## 📍 Midday consulting check-in

One paragraph from the gather outputs — billable-hours so far, client-communication tempo, or whatever you're tracking.

## 🚦 Flagged items

Bulleted list of items needing attention before EOD. Each bullet: item · why-flagged · suggested action.

---

If you don't want midday-tripwire for this engagement, leave it disabled in the onboard wizard.
