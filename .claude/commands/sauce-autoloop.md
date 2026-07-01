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
- Handoff archive: `~/projects/repos/sauce/Docs/prompts/<YYYY-MM-DD>-sauce-autoloop-turn-N-handoff.md` (glob `*sauce-autoloop*-handoff.md`)

---

## Phase A — Orient + reconcile (autonomous)

1. **Halt check + acquire the single-turn lock.** First, if `~/projects/repos/sauce/.autoloop-halt` exists → print "autoloop halted by sentinel" and **exit** (no handoff). Then acquire the concurrency lock with an **absolute** path (so it always targets the main-repo lock, never a worktree copy's): `node /Users/willfellhoelter/projects/repos/sauce/scripts/autoloop/turn-lock.js acquire`. A non-zero exit (`{"acquired":false}`) means another turn (your 10m `/loop` or the 2h launchd job) is already running → print that and **exit immediately** (no handoff, no work). Once acquired you hold it for the whole turn — **every exit path below MUST run `node /Users/willfellhoelter/projects/repos/sauce/scripts/autoloop/turn-lock.js release`** (Phase E does this; on any early/error exit, release it yourself first — always with that absolute path, even from inside a worktree — and remove any worktree you created). Locks older than 30 min are treated as stale and auto-overridden.
2. Run `npm run status`; confirm a clean tree on `main` (or a resume branch). If the working tree has uncommitted changes you didn't create, print the state and **exit** (do not stomp).
3. **Deploy shipped releases to the vaults (canary → promote — Increment 4) — EVERY live turn, before reconcile.** Vault-sync is independent of card flow, so it runs up-front on every live turn (not gated behind an `idle`, no-unblock turn the way it used to be). A merged fix only *ships to brew*; this is the step that actually puts it in your vaults. Run:
   ```bash
   node /Users/willfellhoelter/projects/repos/sauce/scripts/autoloop/deploy.js run
   ```
   It compares the latest shipped (installable) version to each vault and takes **at most one** deploy action per turn: if **ERO** (the canary) is behind, it `brew upgrade sauce` + `sauce update --bump-pins` on ERO only and verifies it reached the target; once ERO has held the new version for a full turn, a later turn **promotes** the protected vaults (accuris + headspace) to it. Because it is one action per turn, the canary soak is preserved wherever this step runs — canary and promote can never fall on the same turn. A canary that fails to reach the target is contained — prod never promotes past a stuck ERO. `action: none` (all vaults current) is the cheap common case. **Capture the result**: fold `deploy` (`action`, `target`, per-vault `ok`) into whatever handoff this turn writes (the reconcile branches below, or Phase E); if any `ok: false`, flag it prominently and do NOT treat the release as deployed. **Live only** (dry-run: skip — never touch the vaults during the assessment window). The user still runs Cmd+R in Obsidian to load freshly-installed scripts. *(Why up-front: as the last Phase A step it was reached only on `idle`, no-unblock turns, so during any streak of `pr-open`/`merged`/`unblock` turns the vaults fell several versions behind — running it every turn keeps prod current one hop at a time.)*
4. **Reconcile in-flight state from git/PR (the source of truth — level-triggered, idempotent):**
   ```bash
   node scripts/autoloop/reconcile-inflight.js
   ```
   Branch on `status`:
   - `unknown` → print "could not determine in-flight state (gh/git failed)" and **exit** (fail-safe — never assume idle; next fire retries).
   - `pr-open` → write a handoff ("card `<card>` — PR #`<number>` open, auto-merge pending"), **exit**.
   - `implementing` → **live:** a prior turn died mid-implementation. Its work lives in the `.worktrees/autoloop-<card>` worktree (not a branch on the main tree), so discard it cleanly: `git -C ~/projects/repos/sauce worktree remove .worktrees/autoloop-<card> --force 2>/dev/null; git -C ~/projects/repos/sauce worktree prune; git -C ~/projects/repos/sauce branch -D autoloop/<card> 2>/dev/null` (+ delete the remote branch if it was pushed), then move the card back to Planning; write a handoff; **exit**. **dry-run:** note it in a handoff and **exit** (no writes).
   - `merged` → **live:** close the card on the board (projection — move to Completed, set `completed_in_version`); **then record the PR in the reconciled ledger so the next turn skips it** (`node /Users/willfellhoelter/projects/repos/sauce/scripts/autoloop/reconcile-inflight.js record <number>`); write a handoff; **exit**. **dry-run:** note + **exit** (NEVER record in dry-run — the ledger is a live-only projection). If there is no board card (a queue/substrate PR), skip the board edit but still record the PR — recording is what breaks the merged-deadlock.
   - `failed` → **live:** move the card to Blocked (projection) with the PR number; **then record the PR** (`… reconcile-inflight.js record <number>`); write a handoff; **exit**. **dry-run:** note + **exit** (no record).
   - `idle` → continue to Phase B.

   (One reconcile action per turn — closing/blocking/waiting IS the turn's work; the next turn, now `idle`, picks fresh. The board is a *projection*: if a marker ever disagrees with git/PR, git/PR wins. The **reconciled ledger** (`.autoloop-reconciled.json`, local-only) is the record of terminal PRs already handled: `reconcile` skips ledgered PRs when judging the newest terminal state, so a merged/failed PR fires exactly once — without it the newest merged PR re-fires `merged` forever and the loop never reaches `idle`. Record **after** you act, never before, and never in dry-run.)
5. **Reconcile the Blocked column (collaborative unblock).** Read the board's `## Blocked` cards. For each (in board order), read its card note `~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks/<W>/board/<Card>/<Card>.md` and run (absolute require path so it works regardless of CWD):
   ```bash
   node -e "const{parseBlockedResponse}=require('/Users/willfellhoelter/projects/repos/sauce/scripts/autoloop/block-note.js');const fs=require('fs');console.log(JSON.stringify(parseBlockedResponse(fs.readFileSync(process.argv[1],'utf8'))))" "<card path>"
   ```
   - `hasResponse: false` → the user hasn't replied yet; leave it Blocked, check the next.
   - `hasResponse: true` → READ the response. If it genuinely resolves the blocker (gives the design decision / clarifies scope / approves a convention change), **move the card Blocked → In Progress** (board + frontmatter `status: in_progress`), append a one-line `**User resolved:** <summary>` under the block section, and **this card is the turn's work** — go to Phase C with the user's guidance folded in. If the reply is ambiguous/insufficient, leave it Blocked and check the next. **One unblock per turn.**
   - If no Blocked card unblocks → continue to the next step / Phase B.
6. Read the latest handoff (`ls -t ~/projects/repos/sauce/Docs/prompts/*sauce-autoloop*-handoff.md 2>/dev/null | head -1`) for the `Recommended next` card.
7. **Sync the Discovered lane (board mirror — Increment 2c-2).** Reflect the queue into the board's `## Discovered (autoloop)` lane and pick up any dismissals you checked off there:
   ```bash
   node /Users/willfellhoelter/projects/repos/sauce/scripts/autoloop/board-mirror.js sync \
     --board ~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md \
     --cards-root ~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks \
     --date <YYYY-MM-DD>
   ```
   It only ever manages the Discovered lane (never your other columns): adds open queue items, drops shipped/removed ones, and — for any Discovered card you ticked `[x]` — flips that queue item to `status: dismissed` (the loop skips it and the bug-hunt never re-proposes it). **Live only** (dry-run: skip — no board writes during the assessment window). (Deploy is no longer the last step here — it moved to step 3 so it runs on every live turn, not only when reconcile is `idle`.)

## Phase B — Select (deterministic, NO AskUserQuestion)

Reached only when Phase A's reconcile returned `idle`. `selectCard` ignores the board's "In Progress" (your parked workstreams) and skips `[x]`-checked Planning cards — it picks only fresh, unchecked Planning work.

1. Call the selector:
   ```bash
   node scripts/autoloop/select-card.js \
     --board ~/notes/sauce/headspace-sauce/spice/projects/sauce/sauce-board.md \
     --handoff "<latest handoff path, or omit>" \
     --cards-root ~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks \
     --json
   ```
2. Branch on `action` (`selectCard` returns only `no-work` / `no-eligible-work` / `work` — `halt` is owned by Phase A; in-flight is owned by Phase A's reconcile):
   - `no-work` / `no-eligible-work` → **consult the Scout queue before idling:**
     1. Read the queue: `node -e "const{selectFromQueue}=require('./scripts/autoloop/select-card.js');const fs=require('fs');console.log(JSON.stringify(selectFromQueue({queueMd:fs.readFileSync('autoloop-queue.md','utf8')})))"`.
     2. If it returns `work` → that queue item (`card` = its id, `fromQueue: true`) is the turn's work; proceed to Phase C. Its `category` decides the allowed change type there: `doc`/`test` (deterministic Scout) are safe-only; `bug` (model bug-hunt) may be a real behavioral fix, gated exactly like a board card by Gate B.
     3. If `no-work` (queue empty) → run the deterministic Scout: `node scripts/autoloop/scout-signals.js` (appends safe items), then re-read the queue (step 1). If now `work` → proceed.
     4. If the queue returns `no-eligible-work` (items present but all broad-scope), or still `no-work` after the deterministic Scout → **run ONE bounded model bug-hunt pass** (Increment 2c) before idling:
        - Pick this turn's code slice (rotates by turn N so the whole platform is swept over time): `node scripts/autoloop/bughunt.js next-area --turn <N>` → `{name, globs, focus}`.
        - Dispatch **one** subagent (`Agent`, cheap model) scoped to that slice: *"Read ONLY these files: `<globs>`. Find up to 5 REAL, specific, test-catchable bugs (logic errors, wrong conditionals, off-by-one, missing guards/null-checks, incorrect API usage, broken dedup). For each, return an object `{title, file, symptom, repro_hint, fix_sketch, test_sketch, severity, confidence}` where `file` is a real repo-relative path, `test_sketch` describes a regression test for `platform/test/run-*.js` that would fail today, and `confidence` is 0..1. Do NOT report style/naming/preferences or anything you can't ground in the code. Return ONLY a JSON array."* Keep it bounded — one slice, ≤5 candidates, no broad exploration.
        - Write the returned JSON array to a temp file, then filter + append: `node scripts/autoloop/bughunt.js append --candidates <tmp>` (it rejects candidates whose `file` doesn't exist or that lack a `test_sketch`, drops low-confidence, dedups against the queue, caps the batch, and appends survivors as `category: bug` items). Then mirror the freshened queue onto the board with the same `board-mirror.js sync` call as Phase A step 7 — the survivors appear in the `## Discovered (autoloop)` lane so you can see (and `[x]`-dismiss) them.
        - Re-read the queue (step 1). If now `work` → proceed to Phase C. Else write a handoff and **exit cheaply**. **One bug-hunt per turn** — discovery IS this turn's work; the next turn picks the top discovered item.
   - `work` → proceed with `result.card`.

## Phase C — Implement (only if `--live`; in dry-run, PROPOSE only)

- **Dry-run:** emit a single short paragraph — "Intended approach for `<card>`" (≤120 words) derived from the card body — into the handoff's Notes. Do NOT edit any workshop file. Skip to Phase E.
- **Live:**
  - **Queue items (`fromQueue: true`)** have no board card — skip step 1's board edits; the worktree branch is `autoloop/<id>`. Implement the item's `title` scoped by its `category`: `doc`/`test` items are a doc fix or a new `test`/harness only (never behavioral); a `bug` item (model bug-hunt) IS a behavioral fix — apply the smallest fix that resolves the `rationale`'s symptom AND add the regression test its `test_sketch` describes (it must fail without the fix; that's what Gate B Layer 1 verifies). Mark the item `status: done` in `autoloop-queue.md` as part of the change. If the bug turns out not to reproduce or the fix needs a design decision → block-with-questions is not possible (no card note), so instead mark the item `status: dismissed` with a one-line `note:` and exit cheaply.
  1. Move the card to In Progress on the three surfaces (board, workstream sub-board, card frontmatter) — same edits as `/sauce-pipeline` Phase B step 7.
  2. **Create an isolated git worktree for the change** (NEVER branch-switch the main working tree — concurrent turns / the user / other work live there):
     ```bash
     WT=~/projects/repos/sauce/.worktrees/autoloop-<card-slug>
     git -C ~/projects/repos/sauce worktree add "$WT" -b autoloop/<card-slug> origin/main
     cd "$WT"
     ```
     Do ALL of the following — implementation, commits, Gate A, Gate B, push, PR — from **inside `$WT`**. When the turn ends (PR opened) OR on any block/abort/gate-failure below, clean up: `cd ~/projects/repos/sauce && git worktree remove "$WT" --force` (the "discard the branch" steps below become this worktree removal instead of a branch delete), then continue to the handoff.
  3. Implement the card with conventional commits. **Attempt anything the card asks** — bug, feature, refactor, whatever. EVERY behavioral change still MUST ship a regression test in `platform/test/run-*.js` that fails without it (that's how Gate B verifies it). **Do NOT force it, and do NOT overturn a documented platform convention unilaterally.** If the work is genuinely too big for one bounded turn, conflicts with a convention (e.g. `project-blueprint-ui.md` / `note-chrome.md`), can't be verified, or needs a design decision only the user can make → use **block-with-questions** (below). Commit the change (fix/feature + test) before gating.

     **Block-with-questions (when you can't proceed):** call `renderBlockedSection({date, reason, needs})` from `scripts/autoloop/block-note.js` (a clear `reason` + a `needs` array of the specific questions/decisions) and **append it to the card note's body** (`~/notes/sauce/headspace-sauce/spice/projects/sauce/tasks/<W>/board/<Card>/<Card>.md`). Move the card to **Blocked** (board + frontmatter `status: blocked`). Write a handoff. **Exit.** Next turn's Phase A reconcile picks it up once the user replies in the card. (Every Blocked transition below — the Gate A/B failures included — uses this same in-card block-with-questions, so you always leave the user a concrete question.)
  4. **Gate A (deterministic suite):** run `npm run release:preflight` AND `node platform/install.js --vault . --auto-approve`. RED → discard the branch (`git checkout main && git branch -D autoloop/<id>`), card → Blocked, blocked handoff, **exit**.
  5. **Gate B Layer 1 (mutation check):** `node scripts/autoloop/gate.js verify-adequacy --json`.
     - `behavioral: false` → no source change (doc/test-only): **skip Gate B**, go to step 7 (open PR).
     - `adequate: false` → the regression test doesn't actually cover the change → discard the branch, card → Blocked (reason = the verdict), handoff, **exit**.
     - `adequate: true` → continue to Layer 2.
  6. **Gate B Layer 2 (3-lens adversarial panel):** dispatch a `Workflow` of **three** separate-context verifiers on `git diff main...HEAD`, each a distinct lens, each returning `{refuted: boolean, reason: string}`, each instructed to **default to `refuted: true` when uncertain**:
     - **correctness** — "Does this change do what the card title claims, with no logic error? Try to find a case where it's wrong."
     - **regression** — "Could this break existing behavior or other consumers? Find the regression."
     - **test-adequacy** — "Beyond red/green, does the new test assert the RIGHT thing (not a tautology that would pass for a wrong fix)?"
     Apply `gateVerdict({adequacy, votes})` (block if ≥2 refute; a missing/errored verdict counts as refuted). **block** → discard the branch, card → Blocked (reason = the gate reason + the refuting lenses), handoff, **exit**. **pass** → step 7.
  7. **Do NOT bump versions or tag.** Push the branch and open the CI-gated auto-merge PR (`git push -u origin autoloop/<id>`; `gh pr create --fill --base main`; `gh pr merge --auto --squash`). Record the Gate B result (adequacy + the 3 votes) in the handoff. The PR auto-merges only when the `ci` required checks (macOS + Ubuntu `release:preflight`) are green; the release pipeline then bumps/tags/ships. This turn does NOT wait for the merge.

## Phase D — Close (live only)

- Leave the card In Progress with a status note "PR open, auto-merge pending"; the NEXT turn's Phase A reconciles (merged+shipped → Completed; CI failed/PR closed → Blocked). Deployment to the vaults is handled separately by Phase A step 3 (canary → promote), which runs every live turn once the release tags.

## Deferred (NOT in Increment 1 — labeled so the gaps are visible, not silent)

- **Scout / self-discovery (Increment 2b):** when Phase B yields `no-work`, a Scout agent will generate fresh work (bug hunt, coverage gaps, doc drift, tech-debt) instead of exiting. (Increment 2a wired the git/PR reconciliation in Phase A; the In-Progress + `[x]`-checked findings are resolved.)
- **Gate B — ✅ Increment 3:** live Phase C runs Layer 1 (mutation check: `gate.js verify-adequacy` — the regression test must go red without the fix) then Layer 2 (a 3-lens `Workflow` panel — correctness/regression/test-adequacy, block if ≥2 refute) before opening the PR. Gate B gates **every** change; the loop now **attempts anything** on the board (bug / feature / refactor) — what it can't verify or decide, it **blocks-with-questions** in the card, and Phase A reconciles your reply next turn.
- **Canary deploy — ✅ Increment 4:** Phase A step 3 (`deploy.js run`, every live turn) auto-`sauce update`s the ERO canary to the latest shipped tag + verifies, then promotes accuris/headspace one turn later (stateless one-action-per-turn soak). A stuck canary never promotes prod.
- **Substrate hardening (Increment 5):** the launchd scheduler, `caffeinate`, fail-closed auth check, structured logging, daily-turn budget, kill-switch UX. Increment 1 ships only a minimal dry-run plist sample.

## Phase E — Handoff + EXIT

1. Determine turn number N = (count of existing `*sauce-autoloop*-handoff.md`) + 1.
2. Render the handoff with `scripts/autoloop/render-handoff.js` (call `renderHandoff()` with the gathered state: `roundN`, today's `date`, `mode`, `outcome` `{action, card, reason}`, post-turn `board` via `parseBoard`, `recommendedNext`, and `notes` = the Phase A step-3 `deploy` summary (`action`/`target`/per-vault `ok`, flagged if any `ok: false`) plus the dry-run "Intended approach" paragraph from Phase C if applicable). Write it to `~/projects/repos/sauce/Docs/prompts/<YYYY-MM-DD>-sauce-autoloop-turn-N-handoff.md` — the date prefix is matched by Phase A's `*sauce-autoloop*-handoff.md` glob.
3. **Live only:** commit + push the handoff to `main` (`docs(prompts): autoloop turn N handoff`). **Dry-run:** leave it as an uncommitted local artifact — never push to main during the assessment window.
4. **Release the single-turn lock** acquired in Phase A (absolute path, so it works even if you're still inside a worktree): `node /Users/willfellhoelter/projects/repos/sauce/scripts/autoloop/turn-lock.js release`. This MUST run on every normal turn-end; on any early/error exit above you must release it there too (the lock is the one thing that, if leaked, wedges every later turn into "another turn in progress" until the 30-min stale window expires).
5. **EXIT.** Do NOT call `ScheduleWakeup`. The external scheduler fires the next turn.

## Usage / cost guardrails (always)

- One card per turn. Cheap idle-exit on non-`work` actions.
- Headless invocation defaults to a cheaper model + bounded turns (`--model claude-sonnet-4-6 --max-turns 40`; see the plan's "Headless invocation").
- If you ever feel the turn ballooning past the card's scope, STOP, write a blocked handoff, and exit — small diffs only.
