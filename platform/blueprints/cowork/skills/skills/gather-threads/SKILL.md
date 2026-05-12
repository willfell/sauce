---
name: cowork:gather-threads
description: Read active-threads.md, classify threads by status, return digest markdown block for orchestrator paste.
inputs:
  engagement_id: string
  date_today: string
  mode: string
  week_range: object
  month_range: object
  auto_create: list[object]
  auto_resolve_hints: list[object]
  vault_path: string
outputs:
  markdown: string
  by_status: object
  total: number
  resolved_today: list[object]
  snoozed_today: list[object]
  still_open: list[object]
  auto_created_eod: list[object]
  open_threads: list[object]
  snoozed_to_open: list[object]
  new_threads: list[object]
  opened_this_week: list[object]
  resolved_this_week: list[object]
  opened_this_month: list[object]
  resolved_this_month: list[object]
  stale_over_7d: list[object]
  longest_running: object
  average_resolution_days: number
tags: [cowork, gather, engagement-aware]
---

# cowork:gather-threads

Read-only digest of the active-threads ledger. Returns a `[!example]+` callout grouping thread titles by status, plus a structured `by_status` map for orchestrators that need to do their own logic. This skill never writes.

## Inputs

- `engagement_id` (string, required): id of the engagement this gather runs for. Threads in `active-threads.md` may be tagged with `engagement_id`; this gather filters to threads matching the given engagement (untagged threads are treated as vault-wide and included for all engagements).
- `date_today` (string, required): today as `YYYY-MM-DD`. Anchors age computations.
- `mode` (string, optional, default `"morning-surface"`): one of `"morning-surface"` | `"eod-reconcile"` | `"weekly-audit"` | `"monthly-audit"`. (Aliases: `"morning"`, `"eod"`, `"weekly"`, `"monthly"` — same semantics.)
- `week_range` (object, optional): `{ start, end }`. Required for `weekly-audit`.
- `month_range` (object, optional): `{ start, end }` or `{ range_start, range_end }`. Required for `monthly-audit`.
- `auto_create` (list[object], optional): thread-trigger candidates supplied by the caller (e.g., from `cowork:gather-projects.thread_triggers`) to be promoted to new threads.
- `auto_resolve_hints` (list[object], optional): EOD-mode signals (e.g., cards moved to Done, replied messages) hinting at implicit thread resolution.
- `vault_path` (string, optional): absolute vault root override. Defaults to the active vault.

## Outputs

- `markdown` (string): single `[!example]+` callout block, paste-ready. No emojis, no em dashes.
- `by_status` (object): `{ active: string[], waiting: string[], dormant: string[], resolved: string[] }`. Each entry is the thread title.
- `total` (number): count of H3 thread sections parsed.
- `resolved_today` (list[object], eod-reconcile only): threads marked resolved today.
- `snoozed_today` (list[object], eod-reconcile only): threads snoozed today.
- `still_open` (list[object], eod-reconcile + weekly + monthly): currently open threads with ages.
- `auto_created_eod` (list[object], eod-reconcile only): threads created from late-email / blocked-card signals.
- `open_threads` (list[object], morning-surface): currently open threads.
- `snoozed_to_open` (list[object], morning-surface + eod-reconcile): threads whose snooze expired and are being promoted to open.
- `new_threads` (list[object], all modes): threads created during this run (from `auto_create`).
- `opened_this_week`, `resolved_this_week` (list[object], weekly-audit).
- `opened_this_month`, `resolved_this_month` (list[object], monthly-audit).
- `stale_over_7d` (list[object], weekly + monthly): open threads with `Last Surfaced > 7d`.
- `longest_running` (object, monthly-audit): the single oldest open thread.
- `average_resolution_days` (number, weekly + monthly): mean resolution time across resolved threads in the window.

## Steps

1. Compute `path = <vault_path>/spice/cowork/context/active-threads.md`.
2. Read the file. If missing, return `{ markdown: "> [!example]+ Active threads\n> File missing.\n", by_status: {}, total: 0 }`.
3. Parse frontmatter. Validate `type === "cowork-threads"`. If validation fails, return a digest with the warning inline (`> Schema warning: <reason>`) so orchestrators surface the breakage rather than silently masking it.
4. Walk H3 blocks. For each:
   - Title = text after `### `.
   - Status = value of the `- **Status:**` bullet, lowercased.
   - Skip threads with no Status field (count them in a `malformed` bucket; surface in a trailing warning line).
5. Group titles by status into `by_status`.
6. Render `markdown`:
   - `> [!example]+ Active threads`
   - `> **Active:** <comma-joined active titles or "-">`
   - `> **Waiting:** <comma-joined waiting titles or "-">`
   - `> **Dormant:** <comma-joined dormant titles or "-">`
   - Resolved threads are NOT included in the digest (the digest is a "what's live" snapshot, not a history view).
   - If `malformed > 0`, append `> **Schema warning:** N thread(s) missing Status field`.
7. Return `{ markdown, by_status, total }`.

## Returns

```
> [!example]+ Active threads
> **Active:** thread1, thread2
> **Waiting:** thread3
> **Dormant:** -
```

```
{
  "markdown": "<callout block>",
  "by_status": { "active": [...], "waiting": [...], "dormant": [...], "resolved": [...] },
  "total": <integer>
}
```

## Errors

- If file missing, return a digest with `File missing.` body - let the orchestrator decide whether that is fatal.
- If schema invalid, return a best-effort digest with a `> **Schema warning:** <reason>` trailer. Never throw; orchestrators rely on this skill being robust.
- Read-only. Never write. Never mutate `active-threads.md` from this skill - that is `cowork:update-active-threads`'s job.
