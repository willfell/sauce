---
description: Sauce Autoloop — ONE non-interactive autonomous turn against the board, then exit
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Skill, Agent, Workflow
argument-hint: "[--live] (default: dry-run)"
---

# /sauce-autoloop

Run **exactly ONE** bounded autonomous turn of the Sauce loop, then **exit**. This command
NEVER calls `ScheduleWakeup` and NEVER re-loops in-session — cadence is owned by the external
scheduler (≈ every 2h). Full design: `Docs/plans/2026-06-27-sauce-autoloop-increment-1-plan.md`
and the findings doc at
`~/notes/sauce/headspace-sauce/spice/projects/sauce/docs/workflow-loops/initial-brainstorm/Init.md`.

**Mode:** Default is **dry-run** (select + propose + write a dry-run handoff; NO implementation,
NO commits, NO PR). Pass `--live` to enable the implement→gate→PR path; `--dry-run` is also
accepted explicitly but is the default. During the assessment window, stay in dry-run.

**Repo + path facts** (same as `/sauce-pipeline`):
- Workshop repo: `~/projects/repos/sauce/`
- Project board: `~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md`
- Cards root: `~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks/`
- Kill-switch sentinel: `~/projects/repos/sauce/.autoloop-halt` (if present → halt)
- Handoff archive: `~/projects/repos/sauce/Docs/prompts/sauce-autoloop-*-handoff.md`

---

## Phase A — Orient + gate (autonomous)

1. **Halt check.** If `~/projects/repos/sauce/.autoloop-halt` exists, print "autoloop halted by sentinel" and **exit** (no handoff, no further work).
2. Run `npm run status` (workshop survey) and confirm a clean tree on `main` (or resume branch). If the working tree has uncommitted changes, or a lingering `autoloop/*` branch this turn did not create, print the state and **exit** (do not stomp).
3. Find the latest handoff: `ls -t ~/projects/repos/sauce/Docs/prompts/*sauce-autoloop*-handoff.md 2>/dev/null | head -1`. Read it if present.

## Phase B — Select (deterministic, NO AskUserQuestion)

1. Call the selector:
   ```bash
   node scripts/autoloop/select-card.js \
     --board ~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md \
     --handoff "<latest handoff path, or omit>" \
     --halt ~/projects/repos/sauce/.autoloop-halt \
     --cards-root ~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks \
     --json
   ```
2. Branch on `action` (note: `halt` is already terminal in Phase A and never reaches here):
   - `no-work` / `no-eligible-work` / `needs-attention` → write a handoff via `render-handoff.js` (Phase E), print one line, **exit cheaply** (no model-heavy work). For `needs-attention`, the handoff names the stuck In-Progress card(s) for the human. **(Deferred — Increment 2:** on `no-work`, the Scout will self-discover work instead of exiting; for Increment 1, exit.)
   - `work` → proceed with `result.card`.

## Phase C — Implement (only if `--live`; in dry-run, PROPOSE only)

- **Dry-run:** emit a single short paragraph — "Intended approach for `<card>`" (≤120 words) derived from the card body — into the handoff's Notes. Do NOT edit any workshop file. Skip to Phase E.
- **Live:**
  1. Move the card to In Progress on the three surfaces (board, workstream sub-board, card frontmatter) — same edits as `/sauce-pipeline` Phase B step 7.
  2. `git checkout -b autoloop/<card-slug>`.
  3. Implement the card with conventional commits. **Hard rule:** any behavioral change to a mechanism/blueprint MUST ship a new/strengthened `platform/test/run-*.js` harness (scaffold via `npm run scaffold-harness`). (Gate B — the separate verifier — arrives in Increment 3; until then this rule is self-enforced + reviewed on the PR.)
  4. **Gate A:** run `npm run release:preflight` AND `node platform/install.js --vault . --auto-approve`. If either is RED → discard the branch (`git checkout main && git branch -D autoloop/<card-slug>`), move the card to Blocked, write a blocked handoff, **exit**.
  5. **Do NOT bump versions or tag.** Push the branch and open a CI-gated auto-merge PR:
     ```bash
     git push -u origin autoloop/<card-slug>
     gh pr create --fill --base main --head autoloop/<card-slug>
     gh pr merge --auto --squash
     ```
     The PR auto-merges only when the `ci` required checks (macOS + Ubuntu `release:preflight`) are green; the release pipeline then bumps/tags/ships. This turn does NOT wait for the merge.

## Phase D — Close (live only)

- Leave the card In Progress with a status note "PR open, auto-merge pending"; the NEXT turn's Phase A reconciles (merged+shipped → Completed; CI failed/PR closed → Blocked). (Synchronous close + canary deploy arrive in Increment 4.)

## Deferred (NOT in Increment 1 — labeled so the gaps are visible, not silent)

- **Scout / self-discovery (Increment 2):** when Phase B yields `no-work`, a Scout agent will generate fresh work (bug hunt, coverage gaps, doc drift, tech-debt) instead of exiting. Increment 1 exits.
- **Gate B — separate adversarial verifier (Increment 3):** an independent-context agent that tries to refute each change and enforces "no behavioral change without a harness". Increment 1 relies on Gate A (`release:preflight` + dogfood install) + the PR's CI only.
- **Canary deploy + synchronous close (Increment 4):** auto-`sauce update` to the ERO vault + verify, then a promotion surface for accuris/headspace. Increment 1 stops at the merged PR.
- **Substrate hardening (Increment 5):** the launchd scheduler, `caffeinate`, fail-closed auth check, structured logging, daily-turn budget, kill-switch UX. Increment 1 ships only a minimal dry-run plist sample.

## Phase E — Handoff + EXIT

1. Determine turn number N = (count of existing `*sauce-autoloop*-handoff.md`) + 1.
2. Render the handoff with `scripts/autoloop/render-handoff.js` (call `renderHandoff()` with the gathered state: `roundN`, today's `date`, `mode`, `outcome` `{action, card, reason}`, post-turn `board` via `parseBoard`, `recommendedNext`, and `notes` = the dry-run "Intended approach" paragraph from Phase C if applicable). Write it to `~/projects/repos/sauce/Docs/prompts/<YYYY-MM-DD>-sauce-autoloop-turn-N-handoff.md` — the date prefix is matched by Phase A's `*sauce-autoloop*-handoff.md` glob.
3. **Live only:** commit + push the handoff to `main` (`docs(prompts): autoloop turn N handoff`). **Dry-run:** leave it as an uncommitted local artifact — never push to main during the assessment window.
4. **EXIT.** Do NOT call `ScheduleWakeup`. The external scheduler fires the next turn.

## Usage / cost guardrails (always)

- One card per turn. Cheap idle-exit on non-`work` actions.
- Headless invocation defaults to a cheaper model + bounded turns (`--model claude-sonnet-4-6 --max-turns 40`; see the plan's "Headless invocation").
- If you ever feel the turn ballooning past the card's scope, STOP, write a blocked handoff, and exit — small diffs only.
