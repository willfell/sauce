# task-entity

The **note-per-task core** for the Sauce to-do model. Every to-do task becomes
its own tiny note under `spice/tasks/` carrying `type: task` frontmatter, and
surfaces (the daily note, project hubs, meeting notes) **live-query** those
notes rather than parsing checkbox lines out of a shared markdown file.

Ships `customJS.TaskEntity` — a pure, deterministic, side-effect-free class that
owns the shared task grammar so every consumer produces byte-identical output.

Gesture-time task creation, completion, rescheduling, and confirmed deletion
route through the shared `customJS.RenderSafe.mutate(...)` lifecycle. RenderSafe
is the authority for capture-before-optimism ordering, deferred writes,
failure rollback/Notice behavior, and create/active Dataview reconciliation;
TaskEntity retains only task-specific writes and freshness predicates.
Quick create also claims its canonical logical payload (title, date, source,
parent, and ordered links) synchronously. An identical activation is an explicit
no-op until RenderSafe finishes reconciliation, so it cannot write, notify, or
clear a caller's UI twice; every settlement releases the claim for retry.
Distinct payloads with the same title remain concurrent: the shared `_create`
path synchronously reserves its readable filename against both vault state and
all in-flight TaskDialog creates, then releases that reservation in `finally`.
That class-wide reservation covers modal, Home, and subtask entrypoints even
while vault/Dataview metadata is delayed.
Quick-create claims and path reservations are reload-stable across JavaScript
realms because the exact Obsidian app object owns one non-enumerable,
non-configurable, non-writable symbol-keyed scope. The authority is fail-closed:
Proxy descriptor/definition traps, revoked proxies, accessors, inherited or
foreign descriptors, and non-extensible apps are rejected without invoking
getters, overwriting state, or falling back to realm-local ownership.

## Frontmatter schema

```yaml
type: task
title: Call Shirley Septic
status: open            # open | done | deleted
scheduled: 2026-07-01   # "do-on" date (drives the daily). blank = unscheduled
due: 2026-06-30         # optional
priority: high          # optional: low | medium | high | highest
project: "[[Sauce]]"    # optional wikilink
project_slug: sauce     # optional denormalized slug
source: daily           # daily | project | meeting | manual
source_note: "[[...]]"  # optional backlink
created_at: 2026-07-01T14:22:33-06:00
completed_at:           # set when done
```

Absent `scheduled` / `due` / `completed_at` are written as **empty strings**
(not omitted) so setting a date later is a simple in-place field write.

## API (`customJS.TaskEntity`)

All methods are static (with instance delegators, so cross-class calls via
`window.customJS.TaskEntity.x()` work) and pure:

| Method | Purpose |
| --- | --- |
| `taskFilename(payload, moment)` | Deterministic `task-<YYYYMMDD>-<HHmmss>-<hex4>.md`. `hex4` hashes `title + '|' + HHmmss`, so two tasks in the same second with different titles get different files. |
| `composeNote(payload)` | `{ path, frontmatter, body }` — schema-exact frontmatter in canonical key order, empty body. |
| `parseNote(page)` | Normalize a Dataview page: missing `status` → `"open"`, blank dates → `null`. |
| `queryToday(tasks, todayStr)` | `{ today, overdue }` over **open** tasks only; future + unscheduled excluded. |
| `validatePayload(payload)` | `{ valid, reason }` — `title` required; `scheduled`/`due` must be `YYYY-MM-DD`. |

## Safety guarantees

The note-per-task design exists to make a whole class of data-loss bugs
**structurally impossible**:

- **Wipe impossible.** A task lives in its own file. A bad edit or crash mid-write
  can corrupt at most one task's note — never a whole day's task list. There is
  no single shared markdown file whose accidental truncation destroys everything.
- **One-file writes.** Creating, editing, completing, or deleting a task touches
  exactly one file. No multi-line splice into a shared list, no re-serializing a
  day of checkboxes on every keystroke.
- **Recoverable delete.** Delete is `status: deleted`, not an `unlink`. A deleted
  task's note (and its content) survives; it simply drops out of the live queries.
  Recovery is flipping the status back.
- **Backup-first migration.** Any migration that ingests legacy checkbox lines
  into task notes writes a backup of the source first, so the original day's
  content is always recoverable if the migration misfires.

## Determinism

No `Date.now`, `Math.random`, or `new Date` anywhere — the filename hash is a
tiny non-crypto string hash (`_hash4`) over `title + '|' + HHmmss`. The same
payload + moment always yields the same filename, which keeps the tests
deterministic and satisfies the customJS-load gate's no-wall-clock invariant.

## customJS-load safety

`task-entity.js` is a **bare class with no trailing statements**. The CustomJS
plugin loads each file via `eval("(" + file + ")")` then `new()`, parsing the
whole file as ONE expression — any trailer (`module.exports`, `if`, ...) makes
it a `SyntaxError` and the class never registers. Node-test the statics by
loading the class via `new Function(src + "; return TaskEntity;")()` (see
`platform/test/run-task-entity.js`). The `run-customjs-loadable.js` preflight
gate enforces this.
