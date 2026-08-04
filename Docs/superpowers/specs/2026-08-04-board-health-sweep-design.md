# Board-health sweep — design

**Date:** 2026-08-04 · **Status:** approved (design) · **Component:** coordinator

## Problem

Two failures on the `ero-egnyte-mcp` board shared one cause, and neither was
noticed by the system that owns the board.

**The freeze (fixed in v0.281.1).** Every projection threw and the throw was
swallowed into each record's `projection_error`. The board sat wrong for days.
It was *detectable the whole time* — `commandStatus` already collects records
carrying `projection_error`, runs `projectionMetadataProblem`, and runs
`projectionBoardDrift` per record, which reports `canonical epic projection is
unreadable: <err>` explicitly. Nothing pushed any of it at a human, and the one
surface that does push — Loop Station — repaints only on a lifecycle
transition, which was exactly what was failing. **The alarm rode the broken
wire.**

**The untracked slices.** `EM-4`, `EM-5` and `EM-6` were completed in one
hand-made PR (`#126`, branch `ero-loop-full-retirement`, 29 files) instead of
the per-slice rail that `EM-1/2/3` used. No claim, no per-card branch, no ledger
record. `deriveEpicProjection`'s untracked branch demotes a `completed` note to
`in_progress` unconditionally, so the epic can never roll up to done — and no
check anywhere reports why.

### The shared root cause

**Every existing check is record-driven.** All fifteen `Object.values(state.cards)`
iterations in `codex-coordinator.js` start from the ledger. A board member with
no ledger record is not *missed* by these checks — it is **unreachable** by them.
And because the ledger is local-per-clone, "no record here" is a routine state,
not an exotic one.

## Goal

Detect and report divergence between what the board shows and what the ledger
knows — including for cards the ledger has never heard of. **Report only.** The
loop never blocks, never auto-heals, and completion semantics do not change.

## Design

### One inversion

Every check starts from the **board**, not the ledger. That single inversion is
what closes the blind spot, and it is the property every test must defend.

### Five checks

| # | Check | Reuses | Needs ledger? |
| --- | --- | --- | --- |
| 1 | Board member with no ledger record | *(new — set difference)* | no |
| 2 | Epic whose `canonicalEpicProjection` throws | `canonicalEpicProjection` | no |
| 3 | Binding drift + orphan sub-board lines | `planEpicBindingHeal` | no |
| 4 | Derived state vs painted lane | `projectionBoardDrift` | yes |
| 5 | Records carrying `projection_error` | existing status logic | yes |

Checks 1–3 need no ledger at all, so the sweep survives the failure it exists to
catch. Only check 1 is new logic.

**Degradation is explicit, not implicit.** With a missing or empty ledger, checks
1–3 run normally and checks 4–5 contribute **zero findings** — they are skipped,
not failed. The receipt records this as `"ledger": "empty"` (or `"absent"`)
alongside `checked.records: 0`, so a clean result from a ledgerless run can never
be mistaken for a fully-checked board. `no_op: true` remains reachable in that
state; the `ledger` field is what distinguishes "clean, fully checked" from
"clean, partially checked".

### Verb

`board-health --json` (read-only) and `board-health --write-note --json`
(adds the vault note). **Read-only is the default** so an accidental invocation
cannot touch a vault; only the scheduled job passes `--write-note`.

Scope is one board per invocation. `BOARD`/`CARDS_ROOT` resolve from the repo's
`.loop/config.json` through the existing env seam, exactly like every other
coordinator verb — no new registry, no machine-specific path scanning.

It cannot live inside `status`: `status` loads the ledger first and iterates from
it, which is the shape this design has to invert.

### Receipt

Envelope per `cli-kit`; every finding carries its own remedy, mirroring
`legacyCompletionFinding`'s existing `reconcile:` field.

```json
{
  "action": "board-health", "ok": true, "no_op": false,
  "project": "ero-egnyte-mcp",
  "ledger": "present",
  "checked": { "epics": 63, "slices": 210, "records": 53 },
  "findings": {
    "untracked_members": [
      { "epic": "Retire ero_loop onto the shared loop plugin",
        "card": "EM-4 Retire ero_loop execution path…",
        "note_status": "completed",
        "issue": "board member has no ledger record; a completed note is never counted done",
        "remedy": "investigate: work completed outside the rail" }
    ],
    "unprojectable_epics": [],
    "binding_drift": { "atlases": 0, "slices": 0, "orphan_lines": 0,
                       "remedy": "heal-epic-bindings --dry-run --json" },
    "lane_divergence": [
      { "epic": "Retire ero_loop…", "derived": "active",
        "painted": "In Progress", "agrees": true }
    ],
    "projection_errors": []
  }
}
```

`no_op: true` when every class is empty.

**`lane_divergence` reports agreement as well as disagreement.** The
`Retire ero_loop` case looked broken but was correct; a checker that reported
only disagreement would leave the same confusion. Showing `derived` beside
`painted` answers "is this wrong, or is it telling me something?" directly.

**`untracked_members` carries no mechanical remedy.** Deliberate. It names the
divergence and stops. Fabricating ledger records is exactly the drift the
reconciler exists to flag.

### Vault note

`spice/projects/<slug>/Board Health.md` — beside the board and beside
`Loop Station.md`.

**Separate note, not a Loop Station section** — a correctness argument, not a
layout preference. Loop Station is written by projection on lifecycle
transitions; Board Health is written by the sweep on a timer and must work when
projection is dead. One writer per note means no contention and no shared
failure mode.

Payload is schema-registered `sauce.board-health.v1` in
`platform/schemas-index.json`, alongside `sauce.loop-station.v1`. Lists capped at
20 with per-list overflow counts.

Write discipline, inherited verbatim from Loop Station because it is already
proven:

1. Note absent → scaffold once with a stock `BoardHealth` customjs-guard block.
2. Thereafter **frontmatter only**; body preserved byte-for-byte.
3. Unchanged findings → complete note preserved byte-for-byte, **zero writes**.
4. An existing body-only note **fails closed** rather than being rewritten.
5. Runs under the selector lock.

**Rule 3 is what makes a scheduled vault writer acceptable.** A healthy board
means the job touches nothing — no mtime change, no sync churn, no race surface.
It writes only when findings actually differ from what the note already holds.

Consequence: the note's mtime means "when board health last *changed*", not
"when the sweep last ran". A `checked_at` field would answer the latter but would
write on every run and defeat rule 3, so it is **deliberately excluded**;
last-run time is answered by the launchd job's log.

Rule 4 is stricter than this note strictly needs — for Loop Station failing
closed protects load-bearing state, whereas a user who deletes Board Health's
frontmatter probably just wants it regenerated. Kept for consistency with the
precedent; revisit if it proves annoying.

### Scheduling

One launchd entry per loop-bound repo, installed via the existing
`platform/mechanisms/cowork-reconciler/launchd-installer.js` pattern rather than
a new mechanism. Each entry runs the installed coordinator with that repo as cwd.

**Hourly.** The failure class is slow — the freeze persisted for days — and rule
3 makes a healthy run cost zero writes.

### Failure handling

The sweep's own failures must never look like health.

- **Per-epic isolation.** One epic that throws is a finding, not an abort. A
  malformed atlas in epic 7 cannot hide epics 8–63 — that containment is exactly
  what was missing when one bad binding froze a whole board.
- **Sweep-level failure is loud.** An unreadable board or a refusing
  `physicalProjectPrefix` returns `ok: false` with a stable code, never
  `no_op: true`. Silence must mean "checked and clean", never "couldn't check".
- **Note-write failure does not discard findings.** The receipt returns the full
  findings with a visible `note_error`, mirroring how transition receipts carry
  `loop_station` failures today.
- **Lock contention is a finding, not a crash.** A held selector lock yields a
  "skipped, board busy" receipt and a clean exit; a live loop session must not
  produce a spurious alarm, and hourly means the next check is soon.

## Tests

New cases in `platform/test/run-codex-autoloop.js`, each driven red → green.

| Case | Asserts |
| --- | --- |
| `BH-UNTRACKED` | Board member with no ledger record is reported — fixture is literally `EM-4/5/6`: three completed notes, zero records |
| `BH-LEDGERLESS` | Full sweep runs against an empty `state.json`: checks 1–3 report, 4–5 contribute nothing, receipt carries `ledger: "empty"` |
| `BH-UNPROJECTABLE` | Absolute-atlas epic reported without aborting; siblings still checked |
| `BH-LANE` | `derived` vs `painted` reported, including the agreeing case |
| `BH-NOOP` | Healthy board → `no_op: true`, note byte-identical |
| `BH-SCAFFOLD` | Absent note scaffolds once; same findings twice writes nothing |
| `BH-BODY` | Frontmatter patched, body byte-preserved; body-only note fails closed |
| `BH-CONTAINMENT` | One throwing epic among many → all others still reported |
| `BH-LOCKED` | Held selector lock → clean skip receipt, no write |
| `BH-READONLY` | Without `--write-note`, no vault file is touched |

`BH-UNTRACKED` and `BH-LEDGERLESS` encode the actual blind spot, so a future
refactor that reintroduces ledger-first iteration fails immediately.

## Deferred (explicitly not in scope)

Each is a real idea; none is needed to make divergence visible, and bundling any
of them would turn a reporting feature into a semantics change.

- **Auto-healing.** The sweep reports; `heal-epic-bindings` and `reconcile`
  remain the explicit remedies.
- **Sanctioned out-of-band completion.** A verb recording completion with
  provenance (PR number, merge SHA, reason) so a batch PR like `#126` is a
  legitimate move rather than drift. Changes completion semantics.
- **Shared or durable ledger.** Local-per-clone state is a structural weakness
  underlying the untracked-member class. Large, separate.
- **Cross-process write guard.** The selector lock does not cover a live Codex
  session or Obsidian Sync — the hazard hit during the v0.281.1 heal.
- **Single source of truth for canonical paths.** Intake now *mirrors* the
  coordinator's `physicalProjectPrefix`; a shared module would eliminate the
  drift class rather than duplicating it.
- **PR-title bump gate.** A CI check recomputing the release bump from the PR
  title, which would have caught the v0.281.1 patch-vs-minor mistake.
