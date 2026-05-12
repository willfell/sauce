---
name: cowork:write-summary-monthly
description: Engagement-aware monthly summary author. Writes a standalone monthly review note at spice/cowork/summaries/monthly/<engagement.id>/<YYYYMM>.md for the previous month. Internal branch on engagement.type selects the section layout.
inputs:
  engagement: object
  render_aspects: object
  today: string
  prev_month_label: string
  prev_month_yyyymm: string
  finance: object
  cc_debt: object
  next_month_calendar: object
  people_pulse: object
  projects: object
  threads: object
  forward_look_stressors: object
  invoice_block: string
  fte_status_block: string
outputs:
  summary_path: string
  markdown: string
tags: [cowork, write-summary, engagement-aware]
---

# cowork:write-summary-monthly

Authors a standalone monthly review note for one engagement, reviewing the PREVIOUS month. Dispatched by `cowork:monthly-review`. Section layout is type-branched. Personal-type emphasizes spending recap + budget adherence + debt reconciliation + habits. Consulting-type emphasizes hours-total + invoice-close + project-velocity + business-pulse. W2-fte-type emphasizes project-velocity + meetings + performance-signal + next-month-stressors.

## Inputs

- `engagement` (object, required) — engagement record.
- `render_aspects` (object, required) — render-aspects map.
- `today` (string, required) — today's date `YYYY-MM-DD`.
- `prev_month_label` (string, required) — full label like `April 2026`.
- `prev_month_yyyymm` (string, required) — `YYYY-MM` (e.g., `2026-04`).
- `finance` / `cc_debt` (object, optional) — from gather-finance / gather-cc-debt monthly mode. Null when render_aspects.finance_block == skip.
- `next_month_calendar` / `people_pulse` / `projects` / `threads` (object, optional).
- `forward_look_stressors` (object, optional) — assembled from inline scan in the orchestrator (trips, annual bills, planned purchases).
- `invoice_block` / `fte_status_block` (string, optional) — pre-rendered markdown from upstream sub-skills.

## Outputs

- `summary_path` (string).
- `markdown` (string).

## Steps

1. Compute `summary_path`: `<vault>/spice/cowork/summaries/monthly/<engagement.id>/<prev_month_yyyymm>.md`.
2. Compose frontmatter:
   ```yaml
   ---
   type: cowork-monthly-summary
   engagement_id: <engagement.id>
   month: <prev_month_yyyymm>
   created: <today>
   updated: <today>
   updated_by: cowork:write-summary-monthly
   tags: [cowork, monthly, <engagement.id>]
   ---
   ```
3. Compose body per type-branch:
   - **`personal`** sections: TL;DR (paragraph) → Spending recap (per-category vs prior month + MoM delta) → Budget adherence (compare to `spice/finance/budgets/Budget, <prev_month_yyyymm>.md` if present) → Debt reconciliation (per-card paydown + interest paid + on-track call) → Habits + journal cadence → Threads health → People pulse → Forward look (next-month stressors) → Honest take.
   - **`w2-fte`** sections: TL;DR → Project velocity (delivered vs slipped) → Meetings (key decisions + open action items) → Performance signals (manager feedback if tracked) → Threads health → Forward look (next-month milestones, planned PTO) → Honest take.
   - **`consulting`** sections: TL;DR → **Hours total + invoice close** (embed `invoice_block`) → Project velocity → Meeting digest → Business pulse (new leads, expiring engagements) → Threads health → Forward look → Honest take.
4. Write to `summary_path` via `mcp__obsidian__write_note`.
5. Return `{ summary_path, markdown }`.

## Errors

- `engagement` / `render_aspects` / `today` / `prev_month_label` / `prev_month_yyyymm` missing: hard-fail.
- `engagement.type` unknown: hard-fail.
- Write failure: emit Notice; return `{ summary_path: null, markdown }`.
