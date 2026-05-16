# Sauce Pipeline — design

**Date:** 2026-05-15
**Status:** design (approved by user via brainstorming session 2026-05-15)
**Author:** will_fell + Claude

## Why

There is an ongoing project-board at `~/notes/sauce/headspace-sauce/spice/projects/sauce/` (the "Sauce" project in the headspace consumer vault) tracking workstreams + tasks for ongoing Sauce platform work. Today, each task on the board becomes a Sauce cycle by the user manually starting a fresh chat session, copy-pasting a brainstorm or handoff prompt, and running it through brainstorm → design → plan → implement → tag → close.

Goal: an **endless, self-pacing loop** that automates the connective tissue between rounds. Each round picks one card off the board, runs it through a full Sauce cycle, ships a tagged workshop release, updates the board, and writes a handoff so the next round can pick up cleanly. The user retains a hard control point at the START of each round — they pick which card to work on. Everything else is autonomous.

## Goals

- **One slash command, one loop:** `/loop /sauce-pipeline` is the only invocation needed.
- **Human-in-the-loop pick at round start:** the user always chooses which card to work on; the loop never picks autonomously.
- **One card per round, end-to-end:** each round = one full Sauce cycle (brainstorm → design → plan → stages → tag → close).
- **Two-repo discipline:** workshop work happens in `~/projects/repos/sauce/`; board state lives in `~/notes/sauce/headspace-sauce/spice/projects/sauce/`. Each piece of state has exactly one source of truth.
- **Self-pacing wake-up:** at round end, the loop schedules its own next wake-up via `ScheduleWakeup` and exits. The loop survives across sessions.
- **Graceful exit on empty Planning, user-skip, or blocker:** the loop stops scheduling wake-ups in those cases — no infinite no-op churn.

## Non-goals

- Autonomous card-picking (deliberately rejected — the user picks every round).
- A separate "pipeline status" dashboard note (the existing project board + git log + `Docs/cycle-history.md` cover this).
- Editing the project root note (`Sauce.md`) body during the loop (frontmatter `status:` may auto-tick; body untouched).
- Defending against concurrent vault edits on another device (out of scope; user pauses loop while hand-editing).
- A lightweight cycle variant — Phase C runs the FULL existing Sauce discipline (per-stage commits + tag + push). Cards that don't deserve that scope should be sub-divided manually before being picked.

## Section 1 — Trigger and loop wiring

**Single invocation:**

```
/loop /sauce-pipeline
```

`/loop` (no interval) self-paces — it sleeps after each round and wakes up to fire `/sauce-pipeline` again. The user stops the loop with `/loop stop` or by closing the chat. The user can interrupt mid-round at any time.

**The slash command lives in the workshop repo** at `.claude/commands/sauce-pipeline.md`. It is a thin spec file whose body tells Claude what one round looks like (the round shape is in Section 2). Lives in the workshop because:
- The workshop is where the cycle work happens.
- `.claude/commands/` is already a managed surface in Sauce (landmine #22 — direct edits get reverted on next install; the canonical body lives here).

**Why a single command rather than several** (e.g. `/sauce-pick`, `/sauce-work`, `/sauce-close`):
- Each round is a self-contained unit (the user chose "complete one card end-to-end") so no round-internal sub-commands are needed.
- Idempotent invocation — same string every time, no drift.
- Self-documenting — anyone (including future-self) can read the command file to see what a round does.
- `/loop` consumes it cleanly.

## Section 2 — Round behavior

A round is 5 phases. Phase B is interactive (user picks). The rest are autonomous until close.

### Phase A — Orient (Claude alone, ~30s)

- Read the most recent handoff matching `~/projects/repos/sauce/Docs/prompts/sauce-pipeline-*-handoff.md` (latest by filename date).
- Read the project board at `~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md` and each workstream sub-board at `spice/projects/sauce/tasks/<W>/board/<W>-board.md`.
- Read the project frontmatter at `Sauce.md` for current `status:` and workstream list.

### Phase B — Present options + pick (interactive)

- Show:

> Last round closed `[card name]` as `[workshop_version]`. Planning column: `[A, B, C, …]`. Recommended next: `[X]` (reason: handoff says X / X is unblocked / X depends only on shipped work). Pick one or `skip` to end the loop.

- The user picks. Claude moves the picked card on the board:
  - Top-level project board (`sauce-board.md`): card moves Planning → In Progress.
  - Workstream sub-board (`<W>-board.md`): card moves Planning → In Progress.
  - Card frontmatter (`<Card>.md`): set `status: in_progress`, `status_changed_at: <now>`.
- Vault writes are file-level only (no commit; vault is not a git repo).

**Sanity-check sub-step:** if the picked card looks too big for one round (multi-cycle work like "Frontmatter Audit and Alignment"), Claude flags this BEFORE moving the card to In Progress and asks the user whether to (a) proceed anyway, (b) scope-narrow to a sub-task added as a new card, or (c) pick something smaller.

### Phase C — Run the Sauce cycle (Claude alone, hours)

- Invoke `superpowers:brainstorming` on the card → write design at `Docs/plans/YYYY-MM-DD-<topic>-design.md`.
- Invoke `superpowers:writing-plans` → write plan at `Docs/plans/YYYY-MM-DD-vNN.NN.NN-<topic>-plan.md`.
- Execute the plan stage-by-stage (controller-direct or `superpowers:subagent-driven-development` per Sauce convention).
- Bump `workshop_version` in `platform/manifest.json`, commit per-stage (existing Sauce discipline), tag `vNN.NN.NN`, push to `origin/main` (commits + tag).

### Phase D — Close the card (Claude alone, ~1 min)

- Move card on top-level project board AND workstream sub-board: In Progress → Completed.
- Set card frontmatter: `status: completed`, `status_changed_at: <now>`, `completed_in_version: vNN.NN.NN`.
- Append a 2-line summary block to the card body:

```
---
**Completed:** YYYY-MM-DD in `vNN.NN.NN`
**Result:** `~/projects/repos/sauce/Docs/plans/YYYY-MM-DD-vNN.NN.NN-result.md`
```

- Vault writes are file-level only (no commit).

### Phase E — Hand off + sleep (Claude alone, ~30s)

- Write `Docs/prompts/YYYY-MM-DD-sauce-pipeline-vNN-handoff.md` containing:
  - What shipped this round (card name + workshop version + result-doc path).
  - Current board snapshot (Planning / In Progress / Completed lists copied verbatim).
  - Recommended next card with rationale.
  - Any open questions or dependencies the next round should know about.
- Commit + push the workshop (single commit: handoff file).
- `ScheduleWakeup(delaySeconds=270, prompt="/sauce-pipeline", reason="next sauce-pipeline round")`. 270s keeps the prompt cache warm; the loop is paused on the next round's user-pick anyway, so wait length matters less than freshness.

## Section 3 — State and persistence

Each piece of state has exactly one source of truth.

### Workshop repo (`~/projects/repos/sauce/`)

- **Handoff archive:** `Docs/prompts/YYYY-MM-DD-sauce-pipeline-vNN-handoff.md` — one file per round, never overwritten. Latest-by-filename = current handoff.
- **Cycle artifacts (unchanged from existing Sauce convention):** `Docs/plans/<date>-<topic>-design.md`, `<date>-vNN-<topic>-plan.md`, `<date>-vNN-result.md`. The pipeline rides on existing cycle discipline.
- **Audit trail:** `git log` on `origin/main` + `git tag` (one tag per round). No separate "pipeline log" file. Round N+1 reconstructs round N from the handoff or, if missing, from the most recent tag + its commit.

### Consumer vault (`~/notes/sauce/headspace-sauce/`)

- **Project board** (`spice/projects/sauce/sauce-board.md`): column moves only.
- **Workstream sub-boards** (`spice/projects/sauce/tasks/<W>/board/<W>-board.md`): column moves, kept in sync with project board.
- **Task card frontmatter** (`spice/projects/sauce/tasks/<W>/board/<Card>/<Card>.md`):
  - `status: planning|in_progress|completed|blocked`
  - `status_changed_at: <ISO 8601>`
  - `completed_in_version: vNN.NN.NN` (set on close)
  - `blocked_reason: <one line>` (set if Phase C blocks)
- **Task card body:** appended at close — the 2-line summary block from Section 2 / Phase D.

### What we explicitly do NOT do

- No "pipeline status" dashboard note (existing surfaces cover it).
- No editing of `Sauce.md` body. Project frontmatter `status:` may auto-tick `idea → active` on first round and `active → done` if/when the board is fully Completed.
- No state stored in `~/.claude/` or auto-memory. Memory is for cross-conversation user prefs, not pipeline state.

## Section 4 — Cross-repo discipline

The headspace-sauce vault is **not** a git repo (synced via Obsidian Sync / iCloud / similar). Vault writes are file-level, not commit-level.

### Read order at round start (Phase A)

1. `~/projects/repos/sauce/Docs/prompts/sauce-pipeline-*-handoff.md` → pick latest by filename date.
2. `~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md` → top-level board.
3. Each `spice/projects/sauce/tasks/<W>/board/<W>-board.md` → workstream sub-boards.
4. Optionally — task card frontmatter for any card the handoff or board references as in-flight.

### Write phases

| Phase | Vault writes (`headspace-sauce`) | Workshop writes (`sauce`) | Commits? |
|---|---|---|---|
| B (pick) | Move card columns × 2 boards + set card `status: in_progress` + `status_changed_at` | — | Vault: no (file-only). Workshop: no. |
| C (cycle) | — | `Docs/plans/*-design.md`, `*-plan.md`, mechanism/blueprint code, `manifest.json` bumps, etc. Stage commits per Sauce convention. | Workshop: yes, per-stage commits + push, ending with `git tag vNN.NN.NN && git push --tags`. Vault: untouched. |
| D (close) | Move card columns × 2 → Completed + set `status: completed`, `completed_in_version`, append 2-line summary block | — | Vault: no. Workshop: no. |
| E (handoff) | — | Write handoff in `Docs/prompts/`, commit + push (single commit). | Workshop: yes. Vault: untouched. |

### Why this ordering

- All workshop work in Phase C, gated by existing Sauce per-stage commit discipline.
- Vault writes batched into Phase B (one logical edit: "card moves to In Progress") and Phase D (one logical edit: "card moves to Completed"). If Claude crashes mid-round, worst-case partial state is "card is In Progress on the board but no workshop work happened yet" — recoverable by hand.
- Phase E commit is the round's natural seam — the handoff file IS the round's "this shipped" artifact. If a future round can't find a recent handoff, it falls back to git tags.

### Cross-repo references

Card body summary uses an absolute filesystem path to the workshop result doc — `~/projects/repos/sauce/Docs/plans/...`. Not an Obsidian wikilink (workshop is not part of the vault). Not clickable in Obsidian, but greppable + copy-pasteable.

### Assumptions about vault sync

- The headspace-sauce vault syncs reliably across devices via the user's chosen mechanism.
- Concurrent edits by the user on another device while the loop is running could conflict with loop's vault writes. The loop has no defense — pause the loop when hand-editing the vault.

## Section 5 — Edge cases & failure modes

Six cases. Everything else falls back to existing Sauce discipline (per-stage commits, fix-and-retry, etc).

### 1. First-ever round, no handoff file

Phase A finds nothing in `Docs/prompts/sauce-pipeline-*-handoff.md`. Skip the "last round closed X" framing. Phase B presents Planning column with no recommendation, just options. The round's own handoff seeds the archive going forward.

### 2. Nothing in Planning

Board has zero cards in Planning (all Completed or empty). Claude reports the state, suggests "add cards to the project board and re-start the loop", **does not schedule a wake-up**. Loop dies clean.

### 3. User picks `skip` at Phase B

Same as case 2. No wake-up scheduled. User restarts with `/loop /sauce-pipeline` when ready.

### 4. Card scope obviously too big for one round

Phase B sanity-check (described in Section 2). Claude asks user to (a) proceed anyway, (b) scope-narrow to a sub-task added as a new card, or (c) pick something smaller. Avoids the "card sat in In Progress for 2 days" trap.

### 5. Mid-cycle blocker (Phase C can't finish)

Claude can't proceed without input it can't extract from the user (external dep down, design fork needing user call, test red with unclear root cause). Behavior:
- Move card on both boards: In Progress → **Blocked** column.
- Set card frontmatter: `status: blocked`, `blocked_reason: <one line>`.
- Commit any partial workshop work to `origin/main` (no tag).
- Write a *blocked-state* handoff in `Docs/prompts/` documenting where things stopped + what's needed to unblock.
- **Do NOT schedule a wake-up.** Loop pauses. User unblocks manually + restarts loop.

### 6. Push fails / network down

Workshop commit succeeds locally, push fails. Retry once. Still failing → treat as case 5 (blocked), reason = "unpushed commits, network down". Vault writes still proceed.

### Not handled (deliberately)

- Concurrent vault edits while the loop runs (already flagged in Section 4).
- Context compaction quality degradation mid-Phase C (system auto-compresses; loop trusts this; if quality drops on long cards, scope-narrow at Phase B going forward).

## Open questions

None at design close. All questions raised during brainstorm were resolved.

## Next steps

1. User reviews this design doc.
2. On approval, invoke `superpowers:writing-plans` to produce the implementation plan covering:
   - Author the `.claude/commands/sauce-pipeline.md` slash command body.
   - Decide whether the slash command body needs any companion helper script (or stays pure-prompt).
   - First-run smoke: trigger `/loop /sauce-pipeline` with the current Sauce project board (10 cards in Planning) and confirm Round 1 produces a clean handoff + ships some card.
   - Document the loop's invocation + expected behavior in `Docs/use.md` (or equivalent operational doc).
