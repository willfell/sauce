# Sauce Pipeline Round 21 — handoff for next round

**Date:** 2026-05-18
**Workshop version shipped:** v0.62.0
**Card completed:** [[FA-9 · Activity feeds + rollups]] (FA-9a execution scope only; FA-9b deferred)
**Result doc:** `~/projects/repos/sauce/Docs/plans/2026-05-18-v0.62.0-result.md`

## What this round did

Phase B resumed with the same workstream-level carry-over as round 20 (`[[Frontmatter Alignment]]` + `[[Projects Blueprint]]` parked in top-level In Progress). User picked FA-9 — then at the scope sanity-check picked **FA-9a only** (Activity feeds), deferring **FA-9b project-rollup dashboard** to v0.62.1+.

FA-9a shipped NEW `activity-feed@0.1.0` mechanism + 3 cowork hub embeds (Daily/Weekly/Monthly) + NEW `spice/cowork/Today.md` curated landing surface (4 ActivityFeed sections). 14 commits + `v0.62.0` tag pushed.

**Frontmatter Alignment workstream:** FA-1 through FA-9 are all CLOSED in the sub-board (FA-9 closed with FA-9a scope; FA-9b is the only declared-but-unbuilt item from the original FA workstream). The top-level workstream-level `[[Frontmatter Alignment]]` card remains in In Progress on `sauce-board.md` to leave room for FA-9b decision at next-round Phase B.

**User-driven deploy not yet executed.** Tag stack accumulated: v0.60.0 + v0.61.0 + v0.62.0 (+ any unmerged pre-round-19 tags).

## Board snapshot (after this round)

### In Planning (top-level — sauce-board.md)
- [[To-Do Blueprint]]
- [[Daily-Hub Blueprint]]
- [[Convenience Functionality]]
- [[Blueprint Orchestration]]
- [[Cowork Brainstorming]]
- [[Scratch Blueprint]]
- [[Bugs]]
- [[Cleanup]]

### In Progress (top-level — workstream-level cards)
- [[Frontmatter Alignment]] (FA-1..FA-9 all closed in sub-board; FA-9b deferred — user decides whether to fire FA-9b or close the workstream)
- [[Projects Blueprint]] (1 card left in sub-board Planning: Potentially broken docs)

### Blocked
(empty)

### Frontmatter Alignment sub-board
- **Planning:** (empty)
- **In Progress:** (empty)
- **Completed:** Planning + FA-1..FA-9

### Projects Blueprint sub-board Planning
- `[[Potentially broken docs]]`

### Completed top-level (most recent at top)
- [[FA-9 · Activity feeds + rollups]] — v0.62.0 — 2026-05-18 (FA-9a scope; FA-9b deferred — sub-board only; top-level workstream card stays In Progress)
- [[FA-8 · Backlink panels]] — v0.61.0 — 2026-05-18

## Recommended next

- **Card (primary):** **FA-9b — Project-rollup dashboard** (NEW kanban card, or REOPEN FA-9 with FA-9b execution scope).
- **Reason:** Symmetric payoff to FA-9a. Every project atlas grows a multi-section rollup showing meetings/scratches/daily linking the project + workstream-task counts. Closes the Frontmatter Alignment workstream fully. NEW `ProjectRollup` class or extends `backlink-panel@0.1.0 → 0.2.0`.

- **Card (alternative):** **deploy-pause** — round 21 ships v0.62.0 atop v0.60.0 + v0.61.0 + earlier unmerged tags. Tap merge + 4-vault reinstall + manual headspace smoke before more code lands. Same pattern as round 19. Especially useful since FA-8 (v0.61.0) + FA-9a (v0.62.0) ship visible UI changes that benefit from end-to-end validation.

- **Card (orthogonal):** [[Potentially broken docs]] from the Projects Blueprint sub-board if that's been nagging.

## v0.60.0 + v0.61.0 + v0.62.0 deploy checklist (if user picks deploy at next-round Phase B)

### 1. Workshop pre-deploy sanity (already done)

- `npm run release:preflight` GREEN at v0.62.0 close (18 harnesses + version-sync)
- `git status` clean on main (one untracked: `.claude/scheduled_tasks.lock`)
- `git log --oneline -1` → `17484d6 test(claude-surface): v0.62.0 — widen CS-MIG-1 cowork version baseline`
- `v0.62.0` tag pushed

### 2. Tap formula bump (5 min)

Direct main bump on `willfell/homebrew-sauce` pointing at v0.62.0 (closes all auto-PRs). Or merge the latest auto-PR.

```bash
cd ~/projects/repos/homebrew-sauce
git pull
# Edit Formula/sauce.rb:
#   url   "https://github.com/willfell/sauce/archive/refs/tags/v0.62.0.tar.gz"
curl -sL https://github.com/willfell/sauce/archive/refs/tags/v0.62.0.tar.gz | shasum -a 256
# Paste sha into Formula/sauce.rb
git commit -am "Sauce 0.62.0"
git push origin main
gh pr list  # close older auto-PRs as needed
```

### 3. brew upgrade across machines

```bash
brew update && brew upgrade sauce
sauce --version    # should report 0.62.0
```

### 4. 4-vault subscription pin bumps + reinstall

Per vault edit `<vault>/ranch/platform-subscription.json`:

```jsonc
{
  "workshop_version": "0.62.0",
  "mechanisms": [
    // additive:
    { "name": "backlink-panel", "version": "0.1.0" },    // v0.61.0 FA-8
    { "name": "activity-feed",  "version": "0.1.0" }     // v0.62.0 FA-9a
    // ...rest unchanged
  ],
  "blueprints": [
    // v0.61.0 deltas (FA-8):
    { "name": "teams",    "version": "0.3.0" },
    { "name": "products", "version": "0.3.0" },
    { "name": "trips",    "version": "0.3.0" },
    { "name": "people",   "version": "0.4.0" },
    { "name": "project",  "version": "1.14.0" },
    // v0.62.0 deltas (FA-9a):
    { "name": "cowork",   "version": "0.9.0" }
    // ...rest unchanged
  ]
}
```

Then `sauce reinstall --vault ~/notes/sauce/<vault>` per vault.

Expected per vault:
- v0.61.0 deltas: 5 template overwrites + 1 new file (`ranch/scripts/backlink-panel/backlink-panel.js`)
- v0.62.0 deltas: 3 hub overwrites (Daily/Weekly/Monthly Hub) + 1 NEW file (`spice/cowork/Today.md`) + 1 new mechanism file (`ranch/scripts/activity-feed/activity-feed.js`)

### 5. Manual headspace smoke (~5 min)

Open `~/notes/sauce/headspace-sauce/` in Obsidian, Cmd-R, verify:

**v0.61.0 FA-8 — BacklinkPanel:**
- Open a Person / Project / Team / Product / Trip page → "## Mentions" panel renders (empty-state OK if no mentions). Mention the entity from another note → reload → expect appearance.

**v0.62.0 FA-9a — ActivityFeed:**
- Open `spice/cowork/Daily Hub.md` → "## Today's Activity" panel renders at the bottom. If you have any notes created today across blueprints, they appear grouped by hour. Empty-state ("No activity in this today.") if you haven't created anything today.
- Open `spice/cowork/Weekly Hub.md` → "## This Week's Activity" panel grouped by blueprint.
- Open `spice/cowork/Monthly Hub.md` → "## This Month's Activity" panel grouped by blueprint.
- Open the NEW `spice/cowork/Today.md` (Cmd-O → "Today" or wikilink from elsewhere) → 4 sections render: today's daily note · today's meetings · today's scratches · today's project status changes. Each section empty-state independently.
- Bonus: change a project's `status:` (Bump Status button or hand-edit) → reload Today.md → expect the project to appear in the "Today's project status changes" section.

**Regressions to watch:**
- Existing cowork Daily/Weekly/Monthly hub-card panels (`CoworkDailyHubCards` etc.) still render above the new Activity panels.
- BacklinkPanel embeds from v0.61.0 still render on Team / Product / Trip / Person / Project pages.
- No JS errors in dev console.

## Open questions / dependencies

- **FA-9b: reopen FA-9 or new card?** FA-9 sub-board card is Completed with `execution_scope: FA-9a only`. To execute FA-9b, either (a) at next-round Phase B re-pick FA-9 (it'll move back to In Progress + frontmatter status flips), or (b) add a NEW kanban card "FA-9b · Project-rollup dashboard" to the FA sub-board's Planning column.
- **Top-level [[Frontmatter Alignment]] workstream card.** Currently stays in In Progress. Decision time at the next round: if FA-9b is executed → keep In Progress. If FA-9b is dropped → move to Completed (workstream closed). If FA-9b is added as a fresh card → keep In Progress.
- **Tap drift growing.** Deploy-pause increasingly compelling.

## ScheduleWakeup

Self-paces via /loop dynamic mode. Next wake-up in 270s — cache-warm. Next round pauses at Phase B for user-pick (FA-9b / deploy / Potentially broken docs / other).
