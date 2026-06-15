---
name: cowork:update-weekly-snapshot
description: Mutate weekly-snapshot.md preserving scheduled-context schema; read, parse, mutate, validate, write.
inputs:
  engagement_id: string
  phase: string
  date_today: string
  writer: string
  snapshot_data: object
  vault_path: string
outputs:
  status: string
tags: [cowork, state]
---

# cowork:update-weekly-snapshot

Deterministic state mutator for the rolling weekly-snapshot context file. Read → parse → mutate → schema-validate → write. The snapshot is reset weekly by `cowork:weekly-review` / `cowork:ero-weekly`; lighter touches (frontmatter bump, single-section update) come from morning/eod orchestrators.

## Inputs

- `engagement_id` (string, required): id of the engagement this snapshot update targets. The weekly-snapshot.md file is vault-wide; per-engagement metrics are namespaced under `## <Engagement Label>` sub-sections within the snapshot body. Section sequence (which metrics appear) is selected by the resolved engagement's `render_aspects`.
- `phase` (string, required): one of `"morning"` | `"eod"` | `"weekly-close"` | `"monthly-reset"` | `"weekly-reset"` | `"archive-and-reset"` | `"section-update"`. Aliases:
  - `"morning"` / `"eod"` → light section-update + frontmatter bump.
  - `"weekly-close"` → archive prior week and reseed baselines for the new week.
  - `"monthly-reset"` → archive the closed month's snapshot and reseed for the new month.
  - `"weekly-reset"` / `"archive-and-reset"` / `"section-update"` preserved for back-compat.
- `date_today` (string, required): today as `YYYY-MM-DD`. Used to populate `fm.updated`.
- `writer` (string, required): caller skill id (e.g., `"cowork:weekly-review"`, `"cowork:ero-weekly"`). Used to populate `fm.updated_by`.
- `snapshot_data` (object, required for non-trivial phases):
  - For `weekly-close` / `weekly-reset` / `archive-and-reset`: `{ week_of: "YYYY-MM-DD", totals?, hours?, project_movement?, threads?, meetings?, mood_signals?, goal_progress?, key_events?, relationship_pulse?, threads_resolved?, stale_thread_watch?, archive_to_previous?: boolean }`.
  - For `monthly-reset`: `{ archive_previous_month: true, prev_month_yyyymm: "YYYY-MM" }`.
  - For `morning` / `eod`: lightweight `{ section?, body? }` plus optional running counters (`wtd_spend`, `cc_total`, `journaled_today`, `completed_count`, `carryover_count`, `threads_resolved_today`).
  - For `section-update`: `{ section: string, body: string }`.
- `vault_path` (string, optional): absolute vault root override.

For back-compat, legacy `mutation` / `caller` / `today` / `week_of` keys are accepted as aliases for `phase` / `writer` / equivalent fields under `snapshot_data`.

## Outputs

- `status` (string): `"ok"` on success, or `"schema-error:<reason>"` on failed validation.

## Steps

1. Compute `path = <vault_path>/spice/cowork/context/weekly-snapshot.md`.
2. Read the file. If missing, return `{ status: "schema-error:file-missing" }`.
3. Parse frontmatter into `fm`. Validate inbound: `fm.type === "scheduled-context"`, `fm.updated` present, `fm.updated_by` present. If any fails, return `{ status: "schema-error:inbound-<key>" }` without writing.
4. Apply mutation:
   - `weekly-reset`: rewrite the body using the canonical section sequence (see Returns). New `fm.week-of = snapshot_data.week_of`. Drop any "Previous Weeks" archive content (life-side variant only retains the most recent prior week under `## Previous Weeks`).
   - `archive-and-reset`: capture the current body's data sections under a `### Week of <prior week-of>` block appended under `## Previous Weeks`, then rewrite the top with the fresh `snapshot_data` payload.
   - `section-update`: locate `## <section>` heading; replace the body between that heading and the next `##` (or EOF) with `snapshot_data.body`. Frontmatter `updated` + `updated_by` bump.
5. Always bump `fm.updated = <today YYYY-MM-DD>` and `fm.updated_by = <caller>`.
6. Re-render the file: frontmatter fence + `# Weekly Snapshot` H1 + canonical section sequence.
7. Re-validate post-mutation: `fm.type === "scheduled-context"`, `fm.updated` parses as `YYYY-MM-DD`, `fm.updated_by` non-empty, `fm.week-of` parses as `YYYY-MM-DD` for reset variants.
8. If post-mutation validation fails, return `{ status: "schema-error:post-<reason>" }` and DO NOT WRITE.
9. Write the file (full replace via Write tool).
10. Return `{ status: "ok" }`.

## Returns

Canonical section sequence (life variant):

```markdown
## Spending Summary
## Vault Activity
## Mood and Energy Signals
## Goal Progress
## Key Events This Period
## Relationship Pulse
## Threads Resolved This Period
## Stale Thread Watch
## Previous Weeks
```

Canonical section sequence (ERO variant):

```markdown
## Hours
## Project Movement
## Threads
## Meetings
## Next Week Highlights
```

The skill resolves the engagement record from `engagement_id` and derives the section sequence from `engagement.type` + `render_aspects` (consulting / w2-fte engagements get a leaner section list; personal engagements get the full sequence including spending/debt rows).

```
{ "status": "ok" | "schema-error:<reason>" }
```

## Errors

- Never partial-write. Post-mutation schema check is the gate.
- Never silently drop a section. Sections present in the canonical sequence must be rendered (with "Nothing notable" body if data missing).
- Sauce-shape path only (`spice/cowork/context/weekly-snapshot.md`).
