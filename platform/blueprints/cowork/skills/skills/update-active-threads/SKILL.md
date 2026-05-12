---
name: cowork:update-active-threads
description: Mutate active-threads.md preserving cowork-threads schema; read, parse, mutate, validate, write atomically.
inputs:
  engagement_id: string
  phase: string
  date_today: string
  writer: string
  changes: object
  vault_path: string
outputs:
  status: string
  thread_count: number
tags: [cowork, state]
---

# cowork:update-active-threads

Deterministic state mutator for the active-threads ledger. Read → parse → mutate → schema-validate → write. If schema validation fails after the mutation, abort with `schema-error:<reason>` and DO NOT WRITE. The cowork blueprint manifest declares a rule_fragment that requires `type: cowork-threads`, `updated`, `updated_by` frontmatter on this file.

## Inputs

- `engagement_id` (string, required): id of the engagement whose threads this update targets. New threads written by this call are tagged with `engagement_id` in their thread frontmatter so downstream gather-threads can filter per-engagement. The active-threads.md file is vault-wide; per-engagement scoping is by frontmatter tagging.
- `phase` (string, required): one of `"morning-pass"` | `"eod-pass"` | `"weekly-pass"` | `"monthly-pass"` | `"weekly-refresh"` | `"monthly-refresh"` | `"explicit-update"`. (Aliases preserved for back-compat.)
- `date_today` (string, required): today as `YYYY-MM-DD`. Used to populate `fm.updated`.
- `writer` (string, required): caller skill id (e.g., `"cowork:morning-briefing"`, `"cowork:ero-eod"`, `"ero-morning"`). Used to populate `fm.updated_by`. Bare-name forms (without `cowork:` prefix) are accepted.
- `changes` (object, optional): structured payload for non-explicit phases:
  - `new_threads` (list[object]): threads to append under `## Open` with full body.
  - `snoozed_to_open` (list[string|object]): titles or thread refs whose snooze just expired; promote to open.
  - `resolved` (list[string|object]): titles or refs to mark resolved (move to `## Resolved`).
  - `archived` (list[string|object]): titles to remove entirely.
  - `archive_resolved_older_than_days` (number): on weekly/monthly refresh, archive resolved threads older than this many days.
  - `validate_open_threads` (boolean): on weekly/monthly refresh, validate each open thread's source card/note still exists.
  - `surface_open` (boolean): on morning-pass, set `Last Surfaced: <date_today>` for all open threads.
  - `audit_full` (boolean): on monthly-refresh, deeper sweep.
  - `stale_recommendations` (list[object]): per-thread close/act/snooze recommendations from gather-threads.
  - `financial_state_refresh` (object): condensed finance/cc-debt block for the `## Reference` section (life-side weekly/monthly).
  When `phase = "explicit-update"`, `changes` may instead contain `updates: [{ thread, action: "add"|"update"|"archive", body? }]`.
- `vault_path` (string, optional): absolute vault root override.

For back-compat, the legacy fields `mutation` / `caller` / `surfaced_thread_ids` / `auto_created` / `snooze_promotions` are accepted as aliases for `phase` / `writer` / equivalent fields under `changes`.

## Outputs

- `status` (string): `"ok"` on success, or `"schema-error:<reason>"` on failed validation.
- `thread_count` (number): count of H3 thread sections after the mutation.

## Steps

1. Compute `path = <vault_path>/spice/cowork/context/active-threads.md`.
2. Read the file. If missing, return `{ status: "schema-error:file-missing", thread_count: 0 }`.
3. Parse frontmatter (between `---` fences) into `fm`. Parse body into thread blocks: split on H3 headings (`### `); each block is `{ title, fields: { Status, Last touch, Context, Next action } }`.
4. Validate inbound schema (BEFORE mutation): `fm.type === "cowork-threads"`, `fm.updated` present, `fm.updated_by` present. If any fails, return `{ status: "schema-error:inbound-<key>", thread_count: <parsed-count> }` without writing.
5. Apply mutation per `phase`:
   - `morning-pass`: append `changes.new_threads` under `## Open`; promote `changes.snoozed_to_open` (move from `## Snoozed` to `## Open`); when `changes.surface_open = true`, set `Last Surfaced: <date_today>` on every open thread.
   - `eod-pass`: append `changes.new_threads`; mark `changes.resolved` resolved (move to `## Resolved (last 14 days)`); move `changes.snoozed_to_open` (or fresh snoozes) appropriately.
   - `weekly-pass` / `weekly-refresh`: walk threads. Archive resolved older than `changes.archive_resolved_older_than_days` days (default 14) by dropping the H3. Apply `changes.snoozed_to_open` promotions. When `changes.validate_open_threads = true`, mark broken-source threads with a warning bullet. Refresh `## Reference` from `changes.financial_state_refresh`.
   - `monthly-pass` / `monthly-refresh`: same as weekly-refresh plus `changes.audit_full = true` triggers a deeper open-thread sweep.
   - `explicit-update`: for each entry in `changes.updates[]`:
     - `add`: append a new H3 block `### <thread>` with the four fields from `body`.
     - `update`: locate H3 by title; replace `Status` / `Last touch` / `Context` / `Next action` from `body`. If thread not found, skip and accumulate a warning.
     - `archive`: locate H3 by title; remove the block.
   - Always bump `fm.updated = date_today` and `fm.updated_by = writer`.
6. Re-render the file: frontmatter fence (preserving any non-platform-managed fm keys), `# Active threads` H1, then each H3 block in original (or mutated) order. Each thread block uses the four-bullet schema: `- **Status:**` / `- **Last touch:**` / `- **Context:**` / `- **Next action:**`. No emojis. Absolute dates only (`YYYY-MM-DD`).
7. Re-validate the rendered output against the schema (post-mutation): re-parse frontmatter → assert `type === "cowork-threads"`, `updated` + `updated_by` present. Walk each H3 → assert all four fields present and `Status` is one of `active | waiting | dormant | resolved`.
8. If post-mutation validation fails, return `{ status: "schema-error:post-<reason>", thread_count: <count> }` and DO NOT WRITE the file (preserve the prior on-disk state).
9. Write the file (full replace via Write tool).
10. Return `{ status: "ok", thread_count: <count> }`.

## Returns

```
{ "status": "ok" | "schema-error:<reason>", "thread_count": <integer> }
```

Reasons (non-exhaustive): `file-missing`, `inbound-type`, `inbound-updated`, `inbound-updated_by`, `post-type`, `post-updated`, `post-thread-missing-field:<field>`, `post-thread-bad-status:<value>`.

## Errors

- Never partial-write. The post-mutation schema check is the gate; failure aborts the write.
- Never silently coerce. If `body.status` is not one of the four allowed values, abort with `schema-error:post-thread-bad-status:<value>`.
- Use Sauce-shape paths only (`spice/cowork/context/active-threads.md`). Legacy `Cowork/context/...` MUST NOT appear in this skill.
