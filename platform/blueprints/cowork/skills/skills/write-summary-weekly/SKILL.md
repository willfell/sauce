---
name: cowork:write-summary-weekly
description: Engagement-aware weekly summary author. Writes a standalone weekly review note at spice/cowork/summaries/weekly/<engagement.id>/<YYYY-Www>.md. Internal branch on engagement.type selects the section layout (personal vs w2-fte vs consulting).
inputs:
  engagement: object
  render_aspects: object
  date: string
  week_start: string
  week_end: string
  finance: object
  cc_debt: object
  calendar: object
  email_metrics: object
  people_pulse: object
  projects: object
  threads: object
  invoice_block: string
  fte_status_block: string
outputs:
  summary_path: string
  markdown: string
tags: [cowork, write-summary, engagement-aware]
---

# cowork:write-summary-weekly

Authors a standalone weekly review note for one engagement. Dispatched by `cowork:weekly-review`. Section layout is type-branched: personal-type emphasizes spending + habits + people-pulse; consulting-type emphasizes hours + invoice + project-movement + meetings; w2-fte-type emphasizes projects + meetings + week-over-week + next-week.

Cron-fired runs must produce identical section structure week-over-week for a given engagement so the user knows where to look.

## Inputs

- `engagement` (object, required) — engagement record from vault-config.md.
- `render_aspects` (object, required) — engagement-type render-aspects map.
- `date` (string, required) — today's date `YYYY-MM-DD`. Used as the `created` frontmatter stamp + tag composition.
- `week_start` / `week_end` (string, required) — ISO Monday / Sunday of reviewed week.
- `finance` / `cc_debt` (object, optional) — from `gather-finance-yesterday` (weekly mode) + `gather-cc-debt-snapshot` (weekly). Populated only when `render_aspects.finance_block == "include"`.
- `calendar` / `email_metrics` / `people_pulse` / `projects` / `threads` (object, optional) — gather-skill payloads (type-gating means some are null for some types).
- `invoice_block` / `fte_status_block` (string, optional) — pre-rendered markdown from `write-summary-invoice-prep` (consulting) or `write-summary-fte-status` (w2-fte). Empty string when type-gated away.

## Outputs

- `summary_path` (string) — absolute path written.
- `markdown` (string) — full note body.

## Steps

1. Compute `summary_path`: `<vault>/spice/cowork/summaries/weekly/<engagement.id>/<YYYY>-W<ww>.md` where `<YYYY>-W<ww>` is the ISO-week label for `week_start`.
2. Compose frontmatter:
   ```yaml
   ---
   type: cowork-weekly-summary
   engagement_id: <engagement.id>
   week_start: <week_start>
   week_end: <week_end>
   created: <date>
   updated: <date>
   updated_by: cowork:write-summary-weekly
   tags: [cowork, weekly, <engagement.id>]
   ---
   ```
3. Compose body per type-branch (`engagement.type`):
   - **`personal`** sections: TL;DR (one paragraph) → Spending this week (table + WoW delta) → Debt paydown trajectory → Side quests + habit cadence → Threads health → People pulse → Next-week preview → Honest take.
   - **`w2-fte`** sections: TL;DR → Project movement (delta vs prior week) → Meeting digest (with outcomes + open action items) → Threads health → Week-over-week activity counts → Next-week preview → Honest take.
   - **`consulting`** sections: TL;DR → **Hours** (`total_hours_week`, daily breakdown, gap-days) → **Invoice posture** (embed `invoice_block` or "Submitted on YYYY-MM-DD" stamp) → Project movement → Meeting digest → Threads health → Next-week preview → Honest take.
4. Write to `summary_path` via `mcp__obsidian__write_note` (overwrite — weekly summaries are deterministic so re-runs are idempotent).
5. Return `{ summary_path, markdown }`.

## Errors

- `engagement` or `render_aspects` missing: hard-fail.
- `engagement.type` unknown: hard-fail.
- `week_start` / `week_end` missing or non-ISO: hard-fail.
- Write failure: emit Notice `cowork:write-summary-weekly — write failed at <summary_path>: <error>`. Return `{ summary_path: null, markdown: <composed body> }` so caller can decide whether to retry.

## Engagement-id directory note

The per-engagement subdir `spice/cowork/summaries/weekly/<engagement.id>/` is created lazily on first write. For a vault with multiple engagements, each gets its own subdir so summaries don't collide across engagements running the same cadence.
