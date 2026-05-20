---
type: scheduled-context
week-of: {{week_of}}
updated: {{week_of}}
updated_by: cowork:bootstrap-vault
---

# Weekly Snapshot

Rolling 1-week summary used by morning + weekly orchestrators for trend awareness. Reset each week by the weekly orchestrator.

> [!info] Shared template
> This template is scope-agnostic. The `cowork:bootstrap-vault` skill copies it to `spice/cowork/context/weekly-snapshot.md` when neither the life-scope nor ero-scope variants are explicitly selected.

---

## Spending / Hours Summary

{{week_summary_paragraph}}

Filled in by the weekly orchestrator. May be spending totals (life scope), hours billed (ero scope), or both (mixed scope).

## Project / Vault Activity

{{week_activity_paragraph}}

One paragraph synthesizing what moved this week.

## Threads

- **Opened:** {{week_threads_opened_count}}
- **Resolved:** {{week_threads_resolved_count}}
- **Still open:** {{week_threads_open_count}}

## Next Week Highlights

- {{week_next_highlight_1}}
- {{week_next_highlight_2}}
- {{week_next_highlight_3}}

Top items the owner should focus on next week.
