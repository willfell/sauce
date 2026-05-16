# Sauce Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author a `/sauce-pipeline` slash command that runs one round of an endless, self-pacing loop over the project board at `~/notes/sauce/headspace-sauce/spice/projects/sauce/`. Each round picks one card (user-driven), runs a full Sauce cycle on it, updates the board, writes a handoff, and schedules its own next wake-up.

**Architecture:** The pipeline is a single workshop-internal slash command at `.claude/commands/sauce-pipeline.md` that lives outside any blueprint's `claude_surface[]` (it will not be distributed to consumer vaults; the installer will not touch it). The body is prose-as-instructions covering 5 phases: A (orient), B (pick — interactive), C (run Sauce cycle), D (close card), E (handoff + ScheduleWakeup). State persists across rounds via dated handoff files in `Docs/prompts/`. No code changes to `install.js`, no mechanism/blueprint manifests touched, no `workshop_version` bump.

**Tech Stack:** Markdown slash command (Claude Code native), Bash for git operations, Read/Write/Edit/Glob for file operations, AskUserQuestion for the Phase B interactive pick, Skill tool for invoking `superpowers:brainstorming` + `superpowers:writing-plans` + `superpowers:subagent-driven-development`, ScheduleWakeup for self-pacing.

**Repo + path facts (load-bearing for every task):**
- Workshop repo: `~/projects/repos/sauce/` (this repo, git-tracked, pushes to `origin/main` at `git@github-personal:willfell/sauce.git`).
- Consumer vault: `~/notes/sauce/headspace-sauce/` (NOT a git repo; synced by Obsidian Sync / iCloud).
- Project root note: `~/notes/sauce/headspace-sauce/spice/projects/sauce/Sauce.md`.
- Project board (top-level kanban): `~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md`.
- Workstream sub-boards: `~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks/<Workstream>/board/<Workstream>-board.md` (7 of them as of 2026-05-16 — Projects Blueprint, To-Do Blueprint, Daily-Hub Blueprint, Convenience Functionality, Blueprint Orchestration, Cowork Brainstorming, Scratch Blueprint).
- Card files: `~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks/<Workstream>/board/<Card>/<Card>.md`.
- Card frontmatter `source_board` field encodes which workstream the card belongs to.
- Handoff archive: `~/projects/repos/sauce/Docs/prompts/sauce-pipeline-*-handoff.md`.

**Reference:**
- Design doc: `Docs/plans/2026-05-15-sauce-pipeline-design.md` (committed in `5edbfb3`).
- Existing slash command examples: `.claude/commands/audit.md`, `.claude/commands/install.md`.
- Sauce per-cycle commit + tag + push discipline: `CLAUDE.md` ("Git workflow" section).
- Installer command-pruning logic: `platform/install.js:6210` (`pruneClaudeSurface`) and `platform/install.js:6343` (`applyLocalShadows`) — both confirmed to leave unmanaged `.claude/commands/sauce-pipeline.md` alone.

**No version bump.** This work adds workshop-internal tooling. It is not a mechanism or blueprint source change. `workshop_version` stays at its current value (`0.49.2` as of 2026-05-16) until the pipeline ships its first real card (which will be its OWN Sauce cycle and bump in the normal way).

**Post-plan-authoring context (v0.47.0 → v0.49.2):** Between the original plan-authoring date (2026-05-15) and now, three project-blueprint cycles shipped that are tangentially relevant:
- **v0.48.0** — adds `ProjectTaskCreateListener` customjs class that fires on new task-board card file creation (path-regex matched). Currently used to launch a workstream-picker dialog inside Obsidian when a user clicks "+ Add a card" on a project kanban board.
- **v0.49.0** — listener registration via customjs `startupScriptNames[]` (L2). Adds `customjs_startup_scripts[]` manifest field + `applyCustomJsStartupScripts` installer helper. Unrelated bundled fixes: BUG-7 (Create Board gate) + BUG-8 (entity-create sentinel relocation).
- **v0.49.2** — `Template, Kanban Card.md` source-board detection via vault-scan (scans all `.md` files for kanban boards linking to the new card's filename).

**Why this matters for the pipeline:** the pipeline interacts with the project blueprint via *direct markdown edits to existing files* (column moves, frontmatter status changes). These do NOT trigger the v0.48.0 listener (which watches for file CREATION, not file edits). The pipeline does NOT use the obsidian-kanban "+ Add a card" UI flow. The only flow that previously *might* have created files programmatically was Phase B Step 6 "Scope-narrow" — refactored in this update to defer card creation to the user via Obsidian's UI, sidestepping the listener interaction entirely. See Task 2.2 Phase B Step 6 below.

---

## Task 1: Add Sauce Pipeline operational doc + smoke procedure to `Docs/use.md`

**TDD framing:** the smoke procedure IS our acceptance test. Writing it first locks in what success looks like for Task 2 (the slash command body).

**Files:**
- Modify: `~/projects/repos/sauce/Docs/use.md` (currently 253 lines; section headers via `grep -n "^## " Docs/use.md`)
- Insertion point: append a new `## Sauce Pipeline` section AFTER the existing `## Recommended GitHub branch protection (one-time UI setup)` section (currently the last section, ending around line 253).

- [ ] **Step 1.1: Verify current state of Docs/use.md**

Run:
```bash
wc -l Docs/use.md && tail -5 Docs/use.md
```

Expected: file is ~253 lines; last section is "Recommended GitHub branch protection (one-time UI setup)".

- [ ] **Step 1.2: Append the Sauce Pipeline section**

Use Edit with `old_string` matching the LAST line of the existing `## Recommended GitHub branch protection` section (whatever it actually ends with after Step 1.1's `tail -5`), and `new_string` = same last line + the new section appended below.

If a clean append-point isn't easy to anchor, use a 2-line `old_string` (last 2 lines of the file) for uniqueness.

The new section to append:

```markdown

## Sauce Pipeline

The **Sauce Pipeline** is an endless self-pacing loop that picks one card off the project board at `~/notes/sauce/headspace-sauce/spice/projects/sauce/`, runs a full Sauce cycle on it, and writes a handoff for the next round. Full design rationale: `Docs/plans/2026-05-15-sauce-pipeline-design.md`. Slash command body: `.claude/commands/sauce-pipeline.md`.

### Start the loop

```
/loop /sauce-pipeline
```

`/loop` (no interval) self-paces — it sleeps after each round and wakes up to fire `/sauce-pipeline` again. The user picks which card to work on at the start of every round; the rest is autonomous through tag + push + handoff.

### Stop the loop

- Type `/loop stop` in the active chat.
- Close the chat.
- Pick `skip (end the loop)` at any round's Phase B pick prompt.
- A blocked card or empty Planning column also halts the loop (no wake-up scheduled).

### What one round does

A round is 5 phases. See `.claude/commands/sauce-pipeline.md` for the operational instructions.

| Phase | What | Interactive? |
|---|---|---|
| A — Orient | Read the latest handoff in `Docs/prompts/`. Read board state from the consumer vault. | No |
| B — Pick | Present the Planning column + a recommendation; user picks. Move card to In Progress. | **Yes** |
| C — Cycle | Run brainstorming → design → plan → stages → tag → push. Existing Sauce discipline. | No (autonomous) |
| D — Close | Move card to Completed on both boards. Set `completed_in_version` frontmatter. Append 2-line summary block to card body. | No |
| E — Handoff | Write `Docs/prompts/YYYY-MM-DD-sauce-pipeline-vNN-handoff.md`. Commit + push. Schedule next wake-up. | No |

### Where state lives

- **Handoff archive:** `Docs/prompts/sauce-pipeline-*-handoff.md` (workshop repo). One file per round; latest by filename = current.
- **Board state:** consumer vault — top-level `sauce-board.md` + workstream sub-boards (file-level writes; vault is not git-tracked).
- **Cycle artifacts:** `Docs/plans/<date>-<topic>-design.md`, `<date>-vNN-<topic>-plan.md`, `<date>-vNN-result.md` (existing Sauce convention).
- **Audit trail:** `git log` + `git tag` on `origin/main`.

### Cautions

- **Do NOT hand-edit the consumer vault while the loop is running.** Concurrent edits could conflict with the loop's writes. Pause first.
- **The loop bumps `workshop_version` per round.** Each card shipped becomes one tagged release.
- **Some cards are too big for one round.** Phase B has a sanity-check that gives you three choices before moving the card to In Progress: proceed anyway, pause for you to add smaller cards via Obsidian, or pick something else. The pipeline never creates cards programmatically — that path goes through the v0.48.0+v0.49.2 listener flow which expects interactive Obsidian context.
- **Mid-cycle blockers move the card to a Blocked column and stop the loop.** You unblock manually + restart.

### First-run smoke procedure

The first time you run `/loop /sauce-pipeline`, verify each phase fires correctly. Do this with a small card to keep the cycle short.

1. **Confirm board state.** Open `~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md` in Obsidian. Confirm at least one card is in the In Planning column. Recommended pick for first smoke: **"Frontmatter Default Doesn't Show"** under the Convenience Functionality workstream — narrow scope, single setting flip.
2. **Open a fresh chat in the workshop repo.** `cd ~/projects/repos/sauce` and start a new Claude Code session.
3. **Type `/loop /sauce-pipeline`.** The loop starts.
4. **Phase A check.** Claude reports: "No prior handoff found (first round). Planning column has: [list of cards]." (For first-ever invocation only.)
5. **Phase B check.** Claude calls `AskUserQuestion` with each Planning card as an option + a recommendation marked. Pick the small card. Claude moves it to In Progress on both the project board AND the workstream sub-board, and sets `status: in_progress` on the card frontmatter.
6. **Phase C check (long).** Claude invokes `superpowers:brainstorming`, then `superpowers:writing-plans`, then executes the plan. This is a full Sauce cycle — could take 30 min to several hours depending on card. Verify per-stage commits land on `origin/main`.
7. **Phase D check.** After the cycle tags (e.g. `v0.47.0`), the card moves Completed on both boards. The 2-line summary block is appended to the card body. The frontmatter has `completed_in_version: v0.47.0`.
8. **Phase E check.** A new handoff exists at `Docs/prompts/YYYY-MM-DD-sauce-pipeline-v0.47.0-handoff.md`, is committed, and pushed.
9. **Wake-up check.** Claude calls `ScheduleWakeup(delaySeconds=270, prompt="/sauce-pipeline", reason=...)` at round end. Within ~5 min, round 2 fires automatically.
10. **Stop the loop.** Type `/loop stop` once smoke is verified. The loop ends without firing further rounds.

### Dry-run smoke (faster — Phases A + B only)

If you want to verify the orient + pick phases without committing to a full cycle:

1. Run `/loop /sauce-pipeline`.
2. Verify Phase A reads board correctly.
3. At the Phase B AskUserQuestion prompt, pick `skip (end the loop)`.
4. Verify the loop writes a "user skipped" handoff and does NOT call ScheduleWakeup.
5. Loop dies clean. Phase A + B verified without running a real cycle.
```

- [ ] **Step 1.3: Verify the section was appended cleanly**

Run:
```bash
grep -n "^## " Docs/use.md | tail -3
wc -l Docs/use.md
```

Expected: last `## ` header is `## Sauce Pipeline`. Line count is ~253 + ~70 = ~325.

- [ ] **Step 1.4: Commit (Task 1 only — Task 2 follows in a separate commit)**

```bash
git add Docs/use.md
git commit -m "docs(use): add Sauce Pipeline operational note + smoke procedure

Documents /loop /sauce-pipeline invocation, what one round does
(5 phases), where state lives (handoff archive + vault board), 
cautions, and a first-run smoke procedure with a short \"dry-run\" 
variant that exits at Phase B without committing to a full cycle."
git push origin main
```

Expected: commit lands on `main`, push succeeds.

---

## Task 2: Author the `/sauce-pipeline` slash command body

**Files:**
- Create: `~/projects/repos/sauce/.claude/commands/sauce-pipeline.md`

**Pattern:** Follow `.claude/commands/audit.md` and `.claude/commands/install.md` for frontmatter shape. Skip the `<!-- @claude-surface:version X.Y.Z -->` marker — sauce-pipeline is unmanaged and unversioned (it's not in any blueprint's `claude_surface[]`).

- [ ] **Step 2.1: Verify the file does not yet exist**

Run:
```bash
ls .claude/commands/sauce-pipeline.md 2>&1
```

Expected: `ls: .claude/commands/sauce-pipeline.md: No such file or directory`.

- [ ] **Step 2.2: Write the slash command body**

Create `.claude/commands/sauce-pipeline.md` with this exact content:

````markdown
---
description: Sauce pipeline — one round of pick-a-card + run-a-cycle + close-and-handoff
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Skill, Agent, ScheduleWakeup, AskUserQuestion
---

# /sauce-pipeline

Run ONE round of the Sauce pipeline. Full design rationale: `Docs/plans/2026-05-15-sauce-pipeline-design.md`. Operational guidance: `Docs/use.md` "Sauce Pipeline" section.

A round is 5 phases. **Always** execute them in order A → B → C → D → E. Never skip; never re-order.

**Repo + path facts:**
- Workshop repo (this repo, git-tracked): `~/projects/repos/sauce/`
- Consumer vault (NOT git-tracked, synced by Obsidian Sync): `~/notes/sauce/headspace-sauce/`
- Project board: `~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md`
- Workstream sub-board: `~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks/<Workstream>/board/<Workstream>-board.md`
- Card file: `~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks/<Workstream>/board/<Card>/<Card>.md`
- Handoff archive: `~/projects/repos/sauce/Docs/prompts/sauce-pipeline-*-handoff.md`

---

## Phase A — Orient (autonomous, ~30s)

1. Find the most recent handoff:
   ```bash
   ls -t ~/projects/repos/sauce/Docs/prompts/sauce-pipeline-*-handoff.md 2>/dev/null | head -1
   ```
   - If empty: this is the first round. No prior handoff exists. Note this; do not error.
   - Otherwise: Read the file. Extract the "Recommended next" card (if present) — that's the proposed pick for Phase B.
2. Read the project board: `~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md`. Parse columns: In Planning, In Progress, Blocked, Completed.
3. Read the project root: `~/notes/sauce/headspace-sauce/spice/projects/sauce/Sauce.md`. Extract `status:` and the `workstreams:` list from frontmatter.
4. If In Progress is non-empty (carry-over from a prior round that did not close cleanly): FLAG to the user — say "the In Progress column is non-empty: [card list]; this usually means a prior round didn't close. Resume that card or move it back to Planning manually before continuing." Then exit without scheduling a wake-up.
5. Otherwise proceed to Phase B.

## Phase B — Present options + pick (interactive)

1. **If In Planning is empty:** there's no work to do. Write a "no work in Planning" handoff (see Phase E format; use `## Recommended next: NONE — Planning column empty` and `## Open questions: add cards to the project board and re-start the loop`). Commit + push it. **Do NOT call `ScheduleWakeup`.** Output a one-line note to the user. Exit.

2. **Compute the recommendation:**
   - If a previous handoff exists with a `## Recommended next` section naming a card still in Planning, that's the recommendation.
   - Otherwise, pick the first card in In Planning order.

3. **Use `AskUserQuestion`** to ask the user:
   - Question: "Which card should this round work on? (Planning column from sauce-board.md)"
   - Header: "Pick card"
   - Options:
     - First option: the recommendation, labeled `<Card name> (Recommended)` with description = recommendation reason.
     - Up to 3 more options: other cards from In Planning. (If In Planning has more than 4 cards total, present 3 + a fourth option labeled `Other from Planning column` with description = "Pick from full list".)
     - LAST option: `skip (end the loop)` with description = "Stops the loop. No wake-up scheduled. Restart with /loop /sauce-pipeline."

4. **If the user picks `skip`:** Write a "user skipped" handoff. Commit + push it. **Do NOT call `ScheduleWakeup`.** Exit.

5. **If the user picks `Other from Planning column`:** Use `AskUserQuestion` again with the remaining cards (or, if the list is too long for the 4-option max, ask for a free-text card name).

6. **Sanity check on picked card scope.** Read the card body. If the card description scopes broadly (multi-cycle work — multi-blueprint audit, redesign-everything, "let's figure out a roadmap for X"), use `AskUserQuestion`:
   - Question: "This card scopes broadly. How should the round handle it?"
   - Header: "Card scope"
   - Options:
     - "Proceed anyway" — description: "Run a full cycle on the card as-is. May be a long round."
     - "Pause for user to add smaller cards via Obsidian" — description: "End the round cleanly. Add smaller cards in Obsidian, then restart the loop."
     - "Pick something smaller" — description: "Re-loop to the pick prompt."
   - On "Pause for user to add smaller cards via Obsidian": **the pipeline does NOT create new cards programmatically.** The supported card-creation path is obsidian-kanban's "+ Add a card" UI, which delegates to Templater + the v0.48.0 `ProjectTaskCreateListener` + the v0.49.2 vault-scan source-board detection — all interactive Obsidian flows. The pipeline bypassing them would either skip the listener wiring (creating out-of-shape cards) or fire the listener with no human at the workstream-picker dialog. Instead:
     a. Write a paused-for-scope handoff at `~/projects/repos/sauce/Docs/prompts/YYYY-MM-DD-sauce-pipeline-paused-for-scope-handoff.md`. Use Phase E's handoff format but with a `## Status: PAUSED FOR SCOPE` block at the top, the originally-picked card name, and the user-described sub-task scopes (captured via `AskUserQuestion` free-form). Footer: "## Next action: add cards via Obsidian, then `/loop /sauce-pipeline`".
     b. Commit + push the handoff (single workshop commit).
     c. Output to the user: "Paused for scope. Open Obsidian, add smaller cards to the project board's In Planning column via '+ Add a card'. v0.49.2's source-board detection will route them correctly under `tasks/<Workstream>/board/`. Restart with `/loop /sauce-pipeline`."
     d. **Do NOT call `ScheduleWakeup`.** Exit.
   - On "Pick something smaller": go back to step 3.
   - **Note:** the picked card has NOT been moved to In Progress yet at this point — Step 7's board writes happen AFTER this sanity check. So no rollback is needed for the pause-for-scope or pick-smaller branches.

7. **Move the picked card on the boards.** Three edits:
   a. Top-level project board: edit `~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md`. Find the line `- [ ] [[<Card name>]]` under `## In Planning` and remove it. Add the line at the END of the `## In Progress` section (before the blank line that precedes `## Blocked`).
   b. Workstream sub-board: read the card frontmatter's `source_board:` field. The path encodes the workstream — e.g. `spice/projects/sauce/tasks/Projects Blueprint/board/Wiki Area.md` → workstream = "Projects Blueprint". Edit the corresponding sub-board file at `~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks/<W>/board/<W>-board.md` — same column move (under that sub-board's `## Planning` → `## In Progress`).
   c. Card frontmatter: edit `~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks/<W>/board/<Card>/<Card>.md`. Set `status: in_progress` and `status_changed_at: <ISO 8601 timestamp now, in user's local timezone, e.g. "2026-05-15 17:30">`.

8. Phase B done. Vault writes are file-level only (vault is not a git repo, so no commit step). Workshop is unchanged.

## Phase C — Run the Sauce cycle (autonomous, hours)

The card body describes WHAT to build. Execute a full Sauce cycle:

1. **Brainstorm.** Invoke the `superpowers:brainstorming` skill on the card. Pass the card name + body as the initial idea. Save the design doc to `Docs/plans/YYYY-MM-DD-<topic>-design.md` (workshop repo). Commit + push the design.

2. **Plan.** Invoke the `superpowers:writing-plans` skill. Save the plan to `Docs/plans/YYYY-MM-DD-vNN.NN.NN-<topic>-plan.md`. Commit + push the plan.

3. **Execute.** Use either controller-direct edits or `superpowers:subagent-driven-development` per existing Sauce cadence (see CLAUDE.md "Status (live)" cycle summaries for the per-cycle pattern). Each stage = one commit per existing discipline. Push after each commit.

4. **Bump versions.** In `platform/manifest.json`, set `workshop_version` to the new tag (e.g. `0.47.0`). In `package.json`, set `version` to the same value (`scripts/check-version-sync.js` enforces lockstep; `npm run release:preflight` will fail if they drift).

5. **Preflight.** Run `npm run release:preflight`. Resolve any failures before tagging.

6. **Commit the version bump.** Single commit, conventional-commits style (e.g. `chore(release): v0.47.0`).

7. **Tag and push.**
   ```bash
   git tag v<NEW_VERSION>
   git push origin main
   git push origin v<NEW_VERSION>
   ```
   The `release.yml` workflow on the tag push triggers the homebrew tap auto-bump (see existing Sauce convention).

**Mid-cycle blocker handling.** If at any step Phase C cannot proceed (external dep down; design fork that needs user input outside Phase B's scope; persistent test red with unclear root cause; conflicting requirements; etc.):

1. Move the card on both boards: In Progress → **Blocked**.
2. Edit the card frontmatter: `status: blocked`, `blocked_reason: <one-line explanation>`.
3. Commit any partial workshop work to `origin/main` (do NOT tag).
4. Write a *blocked-state* handoff (see Phase E format). Add a top-of-file `**STATUS: BLOCKED**` callout. Detail what was attempted, where it stopped, what's needed to unblock.
5. **Do NOT call `ScheduleWakeup`.** Output the blocker summary to the user. Exit.

## Phase D — Close the card (autonomous, ~1 min)

1. **Top-level project board.** Edit `sauce-board.md`. Move the card from In Progress to Completed (line goes at the END of the `## Completed` section).
2. **Workstream sub-board.** Same column move on the workstream's sub-board.
3. **Card frontmatter.** Edit `<Card>.md`:
   - `status: completed`
   - `status_changed_at: <ISO 8601 now>`
   - Add new field: `completed_in_version: v<NEW_VERSION>`
4. **Card body — append a 2-line summary block.** After the existing nav-button dataviewjs blocks (and after any existing card body content), append:
   ```markdown

   ---
   **Completed:** YYYY-MM-DD in `v<NEW_VERSION>`
   **Result:** `~/projects/repos/sauce/Docs/plans/YYYY-MM-DD-v<NEW_VERSION>-result.md`
   ```
5. Phase D done. Vault writes only; no commit (vault is not git-tracked).

## Phase E — Handoff + sleep (autonomous, ~30s)

1. **Build the handoff content.** Use this exact structure:

   ```markdown
   # Sauce Pipeline Round N — handoff for next round

   **Date:** YYYY-MM-DD
   **Workshop version shipped:** v<NEW_VERSION>
   **Card completed:** [[<Card name>]]
   **Result doc:** `~/projects/repos/sauce/Docs/plans/YYYY-MM-DD-v<NEW_VERSION>-result.md`

   ## Board snapshot (after this round)

   ### In Planning
   - <list verbatim from sauce-board.md, one card per line in `- [[Card]]` form>

   ### In Progress
   - <list verbatim, or "(empty)">

   ### Blocked
   - <list verbatim, or "(empty)">

   ### Completed (most recent at top)
   - [[<Card just completed>]] — v<NEW_VERSION> — YYYY-MM-DD
   - <prior completed cards>

   ## Recommended next

   - **Card:** [[<recommended next card>]]
   - **Reason:** <one sentence — unblocked, depends on shipped work, dependency-of-something, user mentioned interest, etc.>

   ## Open questions / dependencies

   - <any callouts; or "none">
   ```

2. **Determine the round number N.** Count existing files matching `Docs/prompts/sauce-pipeline-v*-handoff.md` and add 1. (Round 1 = no prior handoffs.)

3. **Write the handoff to** `~/projects/repos/sauce/Docs/prompts/YYYY-MM-DD-sauce-pipeline-v<NEW_VERSION>-handoff.md`. (YYYY-MM-DD = today's date, ISO format.)

4. **Commit + push the handoff.**
   ```bash
   git add Docs/prompts/YYYY-MM-DD-sauce-pipeline-v<NEW_VERSION>-handoff.md
   git commit -m "docs(prompts): sauce-pipeline round N handoff (v<NEW_VERSION> shipped)"
   git push origin main
   ```

5. **Schedule the next wake-up.**
   ```
   ScheduleWakeup(
     delaySeconds=270,
     prompt="/sauce-pipeline",
     reason="next sauce-pipeline round (cache-warm; user picks at Phase B)"
   )
   ```
   - 270s keeps the prompt cache warm (under 5-min TTL).
   - The next round will pause on user-pick at Phase B anyway, so wait length matters less than freshness.

6. **Output a one-paragraph round summary to the user.** Include: card shipped, version tag, recommended next card, link to handoff file. Suggest typing `/loop stop` if they want to halt the loop before the next wake-up fires.

7. End round.

---

## Failure modes summary (from design doc Section 5)

| Case | Trigger | Behavior |
|---|---|---|
| 1 | First round, no prior handoff | Phase A skips the "last round closed X" framing. Phase B presents Planning with no recommendation. |
| 2 | Planning column empty | Phase B writes "no work" handoff, no `ScheduleWakeup`, exits. |
| 3 | User picks `skip` | Phase B writes "user skipped" handoff, no `ScheduleWakeup`, exits. |
| 4 | Picked card too big | Phase B sanity-check; user chooses proceed / pause-for-Obsidian-add / pick-smaller. On "pause-for-Obsidian-add" pipeline writes a paused-for-scope handoff and exits without `ScheduleWakeup` (pipeline never creates cards programmatically). |
| 5 | Mid-cycle blocker | Phase C moves card to Blocked, commits partial work (no tag), writes blocked handoff, no `ScheduleWakeup`, exits. |
| 6 | Push fails / network down | Retry once. Still failing → Case 5 (blocked, reason = "unpushed commits, network down"). Vault writes still proceed. |

## Explicitly NOT handled

- Concurrent vault edits while the loop runs (out of scope; user pauses loop when hand-editing the vault).
- Context compaction quality degradation mid-Phase C (system auto-compresses; if quality drops on long cards, scope-narrow at Phase B going forward).
````

- [ ] **Step 2.3: Verify the file was created and parses cleanly as a slash command**

Run:
```bash
ls -la .claude/commands/sauce-pipeline.md
head -5 .claude/commands/sauce-pipeline.md
```

Expected:
- File exists.
- First 5 lines show the YAML frontmatter (`---`, `description: ...`, `allowed-tools: ...`, `---`, blank).

Run:
```bash
grep -c "^## Phase" .claude/commands/sauce-pipeline.md
```

Expected: `5` (one heading per phase: A, B, C, D, E).

- [ ] **Step 2.4: Commit (Task 2 only)**

```bash
git add .claude/commands/sauce-pipeline.md
git commit -m "feat(commands): add /sauce-pipeline workshop-internal slash command

Single-command implementation of the Sauce pipeline design from
Docs/plans/2026-05-15-sauce-pipeline-design.md. One round =
5 phases (A orient, B pick interactive, C run cycle, D close
card, E handoff + ScheduleWakeup). Workshop-internal: NOT
registered in any blueprint's claude_surface[], NOT distributed
to consumer vaults, NOT touched by installer prune logic
(verified against platform/install.js:6210 pruneClaudeSurface
and platform/install.js:6343 applyLocalShadows)."
git push origin main
```

Expected: commit lands on `main`, push succeeds.

---

## Task 3: Verify the slash command is discoverable

Sanity check that Claude Code recognizes `/sauce-pipeline` as a valid slash command. (No automated test exists for this in the Sauce harness — this is a one-shot manual verification before Task 4.)

- [ ] **Step 3.1: Confirm command registration**

There is no shell command for this — slash commands are auto-discovered by Claude Code from `.claude/commands/*.md`. The verification is: open a fresh Claude Code session in `~/projects/repos/sauce` and type `/` — `/sauce-pipeline` should appear in the slash command list with description "Sauce pipeline — one round of pick-a-card + run-a-cycle + close-and-handoff".

If it does not appear:
- Check the YAML frontmatter parses (no syntax errors). Run `head -5 .claude/commands/sauce-pipeline.md`.
- Check the file is in `.claude/commands/` (not nested in a sub-directory).
- Check filename is `sauce-pipeline.md` (lowercase, hyphenated, `.md` extension).

- [ ] **Step 3.2: No commit (this is a runtime verification)**

If the command appears, proceed to Task 4. If not, fix in a NEW commit (no `--amend`).

---

## Task 4: Run the dry-run smoke procedure (Phases A + B only)

Verify the loop's orient + pick phases work correctly without committing to a full hours-long Sauce cycle. The user can choose to run the full smoke (Task 5) at their leisure.

This task is MANUAL — it requires a human at the keyboard to interact with the Phase B `AskUserQuestion` prompt.

- [ ] **Step 4.1: Open a fresh Claude Code session**

```bash
cd ~/projects/repos/sauce
```

Open a new chat (do NOT continue the chat that authored the slash command — fresh session = realistic test of cold-start behavior).

- [ ] **Step 4.2: Start the loop**

In the fresh session, type:

```
/loop /sauce-pipeline
```

Expected sequence:
- The loop fires `/sauce-pipeline` immediately (round 1).
- Claude reports Phase A actions: "No prior handoff found (first round). Reading sauce-board.md..." — confirms it's reading the consumer vault.
- Claude reports the Planning column contents — should match the 7 cards currently in Planning on `sauce-board.md` (Projects Blueprint, To-Do Blueprint, Daily-Hub Blueprint, Convenience Functionality, Blueprint Orchestration, Cowork Brainstorming, Scratch Blueprint).
- **Note:** these are the workstream-card-level entries, not the leaf task-board cards. Phase B should ask which workstream-card to work on. (The pipeline operates at the project-board level; per-task work happens during Phase C as part of the cycle.)

Wait — that's an important clarification. Re-read the project board:

```bash
cat ~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md
```

Confirm: the `## In Planning` column lists the 7 workstream-cards (e.g. `[[Projects Blueprint]]`, `[[Scratch Blueprint]]`), not individual task-board cards.

- [ ] **Step 4.3: Verify Phase B presents AskUserQuestion**

Claude should call `AskUserQuestion` with the 7 workstream-cards as options + a recommendation + a `skip` option. (`AskUserQuestion`'s 4-option max means the pipeline should present 3 workstreams + a "show all" / "Other from Planning column" fourth option + skip. Verify the question text is sensible.)

- [ ] **Step 4.4: Pick `skip (end the loop)`**

This exercises Case 3 (user skip) from the failure modes — exits the loop without running a real cycle.

Expected:
- Claude writes `Docs/prompts/2026-05-15-sauce-pipeline-skipped-handoff.md` (or similar) with content noting "user skipped at first round".
- Claude commits + pushes it.
- Claude does NOT call `ScheduleWakeup`.
- Claude outputs a brief "loop ended" note.
- The `/loop` skill confirms the loop has stopped.

- [ ] **Step 4.5: Verify the handoff was committed**

```bash
git log --oneline -3
ls Docs/prompts/sauce-pipeline-*.md
```

Expected:
- Latest commit is the skipped-handoff commit.
- A new file `Docs/prompts/2026-05-15-sauce-pipeline-*-handoff.md` exists.

- [ ] **Step 4.6: Verify no vault writes happened**

Phase A is read-only on the vault. Phase B's writes only happen if a card is picked (not on `skip`). So the vault should be unchanged.

```bash
diff ~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md \
     <(git show HEAD:Docs/plans/2026-05-15-sauce-pipeline-design.md | grep -A1000 "Wiki Area" | head -1)
```

This is awkward to verify (the vault isn't git-tracked), so the realistic check is: open the project board in Obsidian, confirm In Progress column is still empty.

- [ ] **Step 4.7: No commit needed for this verification step**

Proceed to Task 5 OR call the work done. The plan does NOT require running the full smoke (Task 5) before declaring this work complete — the dry-run smoke is sufficient to verify the loop wiring.

---

## Task 5 (OPTIONAL): Run the full smoke — first real round end-to-end

Only do this if you're ready to commit several hours to running an actual Sauce cycle. This task IS the first real round of normal operation, not a separate test.

Recommended pick: the **smallest** card currently in Planning. The Convenience Functionality workstream's "Frontmatter Default Doesn't Show" task-board card (path: `tasks/Convenience Functionality/board/Frontmatter Default Doesn't Show/Frontmatter Default Doesn't Show.md`) is a single setting flip — narrow scope. **However**: this card is a leaf task-board card under a workstream-card. The pipeline picks workstream-cards from the project board, NOT leaf task-cards. So:

- Picking "Convenience Functionality" (the workstream-card) means Phase C will run a cycle that addresses ALL task-board cards under Convenience Functionality (currently just the one — "Frontmatter Default Doesn't Show"). That's effectively a small cycle.
- Picking a workstream with multiple task-board cards (e.g. "Daily-Hub Blueprint" with 2, "To-Do Blueprint" with 2, "Projects Blueprint" with 3) means a longer cycle.

**This is a design clarification surfaced by the dry-run smoke** — the pipeline operates at the workstream-card granularity. If this is wrong (you wanted leaf-task granularity), adjust the design doc + slash command body accordingly before running Task 5.

- [ ] **Step 5.1: Confirm with user that the workstream-card granularity is correct**

If yes → proceed.
If no → STOP. Re-open the design doc, decide on leaf-task vs workstream-card granularity, update the slash command body's Phase A + B + D logic, commit the change, then re-run Task 4 dry-run before attempting Task 5.

- [ ] **Step 5.2: Run `/loop /sauce-pipeline` in a fresh session and pick the smallest workstream**

Recommend "Convenience Functionality" — single task-board card under it.

- [ ] **Step 5.3: Watch through Phase C**

This is a real Sauce cycle. Per-stage commits should land on `origin/main`. The cycle ends with a `vNN.NN.NN` tag pushed (likely `v0.47.0` or `v0.47.x`).

- [ ] **Step 5.4: Verify Phase D moves**

After the tag, check the project board in Obsidian:
- "Convenience Functionality" should be in Completed column.
- The card body should have the 2-line summary block appended.
- Frontmatter should have `status: completed` + `completed_in_version: v0.47.0`.

- [ ] **Step 5.5: Verify Phase E handoff**

```bash
ls -t Docs/prompts/sauce-pipeline-*-handoff.md | head -1
git log --oneline -1
```

Expected: a new handoff file exists; latest commit is the handoff commit; pushed.

- [ ] **Step 5.6: Verify `ScheduleWakeup` fires**

Within ~5 min of the round closing, round 2 should fire automatically. You'll see a new `/sauce-pipeline` invocation start. **Stop the loop** with `/loop stop` once you've verified round 2 starts cleanly (you can pick `skip` again to exit round 2 without running a second real cycle).

- [ ] **Step 5.7: No commit — Phase C and E commits already covered by the cycle itself**

The full smoke is also the first real shipping round; commits + tag + push are part of the cycle itself.

---

## Self-review

**Spec coverage check.** Walking through `Docs/plans/2026-05-15-sauce-pipeline-design.md` section by section:
- Section 1 (trigger + loop wiring) → Task 2 (slash command body covers `/loop /sauce-pipeline` invocation; lives at `.claude/commands/sauce-pipeline.md` per design Section 1).
- Section 2 (5 phases) → Task 2 (each Phase A-E is its own section in the slash command body).
- Section 3 (state and persistence) → Task 2 (Phase E specifies handoff format + path; Phases B + D specify board + frontmatter writes); Task 1 (`Where state lives` table in Docs/use.md).
- Section 4 (cross-repo discipline) → Task 2 (Phase A read-order + each phase's vault-vs-workshop write list); Task 1 (cautions section).
- Section 5 (edge cases) → Task 2 ("Failure modes summary" table at the bottom of the slash command body covers all 6 cases + the 2 "not handled" deliberate omissions).

All sections covered.

**Placeholder scan.** Checked for "TBD", "TODO", "fill in", "implement later", "appropriate error handling", "add validation", "similar to". Plan has none. The slash command body uses `<Card name>`, `<W>`, `<NEW_VERSION>`, `YYYY-MM-DD`, etc. as placeholders, but these are intentional template variables that get substituted at runtime — not author-time placeholders. The design doc + slash command body explain how each is computed.

**Type / interface consistency.** No code interfaces in this work — it's all prose-as-instructions + a documentation update. The cross-references are consistent: filenames, paths, function names (`pruneClaudeSurface`, `applyLocalShadows`), tool names (`AskUserQuestion`, `ScheduleWakeup`, `Skill`, `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:subagent-driven-development`) all match real things.

**One gap surfaced during self-review:** Task 5.1 calls out a design-clarification ambiguity — the pipeline operates at the workstream-card granularity (since the project board lists workstream-cards in Planning). The design doc Section 2 Phase B says "Claude moves the picked card on the board" but doesn't explicitly clarify which board level the "card" refers to. The slash command body in Task 2 implicitly assumes workstream-card level (because that's what's actually in `## In Planning`). If the user wanted leaf-task-card granularity, the design + slash command body would need adjustment.

**Decision:** leave as-is. The dry-run smoke (Task 4) will surface this clearly to the user, and they can correct the design before running the full smoke. This is a design-time correctness issue, not a plan-time correctness issue.

---

## Open questions resolved during plan-writing

1. **Q: Will the installer prune `.claude/commands/sauce-pipeline.md`?** A: No. Verified against `platform/install.js:6210` (`pruneClaudeSurface` only deletes paths previously in the registry) and `platform/install.js:6343` (`applyLocalShadows` only walks `.local/` shadows). Unmanaged commands are untouched.

2. **Q: Should `workshop_version` bump for adding the pipeline?** A: No. The pipeline is workshop-internal tooling, not a mechanism or blueprint source change. First bump happens when the pipeline ships its first card (which is itself a normal Sauce cycle).

3. **Q: What `allowed-tools` does the slash command need?** A: `Read, Write, Edit, Bash, Glob, Grep, Skill, Agent, ScheduleWakeup, AskUserQuestion`. Read/Write/Edit for board + handoff + manifest edits. Bash for git. Glob/Grep for finding latest handoff + walking workstream sub-boards. Skill to invoke brainstorming + writing-plans + subagent-driven-development inside Phase C. Agent for subagent dispatches during Phase C. ScheduleWakeup for Phase E. AskUserQuestion for Phase B.
