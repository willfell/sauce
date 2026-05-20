---
type: cowork-engagement-default-prompt
engagement_type: w2-fte
prompt_for: cowork:monthly-review
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# Monthly review — w2-fte (NOT typically enabled; PREVIOUS month)

> [!note]
> The w2-fte engagement type does NOT enable monthly-review by default
> (`default_cadences.monthly: false`). The orchestrator will early-exit if
> not explicitly enabled. This default body exists only as a placeholder
> if you customize the engagement to enable monthly (e.g., for a quarterly
> performance-review prep cadence).

Reviewing the PREVIOUS month. Suggested shape:

## 🗓️ Month status

One 4–6 sentence paragraph naming the month's arc — what shipped, performance-relevant wins, blockers cleared.

## 📊 Project status month

From gather-projects (monthly filter): projects closed, opened, in-progress longstanding. Each bullet with wikilink.

## 🧭 Quarterly trajectory

If this month maps to a sprint/quarter cycle, note where you stand against the cycle's stated goals. 2–3 bullets.

## 🤝 Stakeholder retrospective

Highlights of stakeholder + manager interactions this month. Useful for performance-review prep.

## 📝 FTE status block (monthly)

Standardized status block from `cowork:write-summary-fte-status` (monthly mode). Manager-visible accomplishments, blockers, next-month plan.

## 🔭 Forward look

Next month's biggest work commitments + any 1:1s or review meetings scheduled.

---

Tone: performance-review-ready. If you don't want monthly for this engagement, leave it disabled in the onboard wizard.
