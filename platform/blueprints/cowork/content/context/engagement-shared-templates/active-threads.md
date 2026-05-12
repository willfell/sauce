---
type: cowork-threads
updated: {{bootstrap_date}}
updated_by: cowork:bootstrap-vault
---

# Active Threads

Open items, blockers, and follow-ups that need cross-day tracking. Updated by the relevant morning orchestrator (Last Surfaced), the EOD orchestrator (resolve/create/snooze), and the weekly orchestrator (archive after 14 days in Resolved).

> [!info] Shared template
> This template is scope-agnostic. The `cowork:bootstrap-vault` skill copies it to `spice/cowork/context/active-threads.md` when neither the life-scope nor ero-scope variants are explicitly selected.

---

## Thread Format

Each thread is an H3 under its section. Fields:

- **Type:** {{example_thread_types}} -- consumer-defined; common values are `task`, `commitment`, `financial`, `trip-prep`, `project-blocked`, `stale-card`, `action-item`, `invoice-deadline`.
- **Created:** YYYY-MM-DD
- **Target:** YYYY-MM-DD (optional)
- **Status:** `open` | `snoozed` | `resolved`
- **Last Surfaced:** YYYY-MM-DD (updated by morning job)
- **Context:** free-text, 1-3 lines

---

## Open

(No open threads at bootstrap.)

## Snoozed

(No snoozed threads.)

## Resolved (last 14 days)

(No resolved threads. The weekly orchestrator archives entries >14 days from this section.)
