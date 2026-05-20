---
type: cowork-engagement-default-prompt
engagement_type: consulting
prompt_for: cowork:monthly-review
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# Monthly review — consulting (PREVIOUS month)

Reviewing the PREVIOUS month for the consulting engagement using the gather outputs (finance full-month, cc-debt-snapshot monthly-close, calendar next-month, projects monthly, threads monthly-audit, forward-stressors) + invoice block from `write-summary-invoice-prep` when `invoice_cadence == "monthly"`. Body shape:

## 🗓️ Month in review

One 4–6 sentence paragraph naming the month's arc with this client — what shipped, decisions made, scope changes.

## 💳 Finance month-close

This is the authoritative month-close reconciliation for the engagement. Summarize: total billable activity, expenses tracked via Brex (when enabled), CC balance trajectory, and any client-related financial flags.

## 📊 Project status month

From gather-projects (monthly filter): projects closed this month, opened, in-progress longstanding. Each bullet with wikilink.

## 🤝 Client relationship retrospective

Highlights of stakeholder + `ap_email` interactions this month. Note any scope tension, kudos, or strategy shifts.

## 🧾 Invoice prep (monthly)

If `invoice_cadence == "monthly"`: include the full block from `cowork:write-summary-invoice-prep` (monthly mode) — itemized deliverables + hours + total. Skip otherwise.

## 📆 Calendar next month

3–5 bullets naming next month's client commitments. Flag travel, multi-day workshops, or quarterly business reviews.

## 🧵 Threads monthly audit

From gather-threads monthly-audit: full audit of open threads (older than 30 days), still-active, auto-archive candidates.

## 🌅 Forward stressors

Inline forward-look — annual contract renewals, quarterly business cycles, planned client travel. Specific items with rough dates.

## ⏭️ Next month focus

One 3–5 sentence paragraph naming the next month's main objective for this client. End with a concrete Day-1 starting point.

---

Tone: long-view client-aware. This is the most retrospective of the four cadences for consulting; write it as if briefing yourself ahead of a quarterly business review.
