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

3. **Use `AskUserQuestion`** to ask the user. **`AskUserQuestion` has a hard 4-option max** — always present exactly 4 options, composed as follows based on Planning column size:
   - Question: "Which card should this round work on? (Planning column from sauce-board.md)"
   - Header: "Pick card"
   - Slot 1: the recommendation, labeled `<Card name> (Recommended)` with description = recommendation reason.
   - Slots 2-3: other Planning cards.
     - If Planning has 1-2 *other* cards (3 total or fewer): fill slot 2 (and slot 3 if available) with those cards; slot 4 = `skip`.
     - If Planning has 3+ *other* cards (4 total or more): slot 2 = the next most-promising other card (heuristic: first in Planning order that isn't the recommendation); slot 3 = `Other from Planning column` with description = "Pick from full list"; slot 4 = `skip`.
   - Slot 4 (always last): `skip (end the loop)` with description = "Stops the loop. No wake-up scheduled. Restart with /loop /sauce-pipeline."
   - This guarantees the first prompt is always ≤4 options. The `Other from Planning column` slot covers any overflow via a follow-up question (see Step 5).

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
