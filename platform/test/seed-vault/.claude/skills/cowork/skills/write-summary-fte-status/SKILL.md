---
name: cowork:write-summary-fte-status
description: W2-FTE-type-only status block author. Composes a weekly or monthly status block summarizing accomplishments + open initiatives + manager-visibility signals for embedding in weekly / monthly summaries. NEW in v0.31.0.
inputs:
  engagement: object
  date_today: string
  mode: string
  week_range: object
  month_range: object
outputs:
  markdown: string
tags: [cowork, write-summary, w2-fte, engagement-aware]
---

# cowork:write-summary-fte-status

W2-FTE-engagement-only sub-skill. NEW in v0.31.0. Gated: caller MUST verify `engagement.type == "w2-fte"` before invocation; this skill early-exits with Notice if invoked against a different type.

Composes a deterministic status block summarizing the period's accomplishments, in-flight initiatives, and signals worth surfacing to the manager (open blockers, scope changes, anticipated impacts). Embedded by `cowork:write-summary-weekly` (mode=`weekly`) or `cowork:write-summary-monthly` (mode=`monthly`). No MCP writes; this is composition-only.

## Inputs

- `engagement` (object, required) — must have `type == "w2-fte"`. Uses `engagement.role`, `engagement.employer`, `engagement.manager`, `engagement.stakeholders[]`.
- `date_today` (string, required).
- `mode` (string, required) — `"weekly"` | `"monthly"`.
- `week_range` / `month_range` (object, optional) — period bounds; one is required depending on `mode`.

## Outputs

- `markdown` (string) — status block.

## Steps

1. Gate: if `engagement.type != "w2-fte"`, return `{ markdown: "" }` + Notice.
2. Compose the status block:

   ```markdown
   > [!abstract]+ Status — {{engagement.employer}} ({{period_label}})
   >
   > **Role:** {{engagement.role}} • **Manager:** {{engagement.manager}}
   >
   > **Shipped this {{period}}**
   > - [aggregated from gather-projects + kanban completed cards in the period]
   >
   > **In flight**
   > - [in-progress cards + scope notes]
   >
   > **Blockers / open asks**
   > - [items needing manager / cross-functional action]
   >
   > **Notable meetings**
   > - [decisions made, open action items owed]
   >
   > **Heads-up for next {{period}}**
   > - [anticipated impacts, planned PTO, upcoming deadlines]
   ```

3. `period_label` = `week_range.start..week_range.end` or `prev_month_label`. `period` = `week` or `month`.
4. The caller (weekly / monthly orchestrator) provides the gathered payload upstream; this skill structures the narrative.
5. Return `{ markdown }`.

## Errors

- `engagement.role` / `engagement.employer` missing: hard-fail; these are required w2-fte fields.
- `engagement.manager` missing: render `> **Manager:** (unset — update vault-config.md)` and continue.
- `mode` neither `weekly` nor `monthly`: hard-fail.
