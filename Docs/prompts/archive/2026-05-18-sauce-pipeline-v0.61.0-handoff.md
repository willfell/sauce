# Sauce Pipeline Round 20 — handoff for next round

**Date:** 2026-05-18
**Workshop version shipped:** v0.61.0
**Card completed:** [[FA-8 · Backlink panels]] (in Frontmatter Alignment sub-board)
**Result doc:** `~/projects/repos/sauce/Docs/plans/2026-05-18-v0.61.0-result.md`

## What this round did

Phase B resumed with In Progress carry-over (workstream-level `[[Frontmatter Alignment]]` + `[[Projects Blueprint]]`) — user confirmed via `AskUserQuestion` that the carry-over was the deliberate workstream-pattern from round 19 (deploy-pause). Picked FA-8 from the Frontmatter Alignment sub-board.

FA-8 shipped a NEW `backlink-panel@0.1.0` mechanism (universal cross-blueprint backlink renderer via canonical cross-ref keys) + 5 entity-template `## Mentions` embeds (Team / Product / Trip / Person / Project). 13 commits + `v0.61.0` tag pushed.

**User-driven deploy not yet executed.** Tag chain since brew sauce baseline grows by 1 (v0.61.0 atop the v0.59.11 unmerged stack).

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
- [[Frontmatter Alignment]] (FA-1..FA-8 done; FA-9 ahead)
- [[Projects Blueprint]] (1 card left in sub-board Planning: Potentially broken docs)

### Blocked
(empty)

### Frontmatter Alignment sub-board
- **Planning:** `[[FA-9 · Activity feeds + rollups]]`
- **Completed:** Planning · FA-1..FA-8

### Projects Blueprint sub-board Planning
- `[[Potentially broken docs]]`

### Completed top-level (most recent at top)
- [[FA-8 · Backlink panels]] — v0.61.0 — 2026-05-18 (sub-board Completed; top-level workstream card stays in In Progress until FA-9 closes)

## Accumulated tag stack since brew sauce baseline

Brew sauce baseline was v0.56.2 at the round-19 deploy-pause handoff. v0.59.11 closed shortly after but the tap PR may or may not have merged + brew upgrade may or may not have run since. Tag stack now includes v0.60.0 (public-readiness follow-up) and v0.61.0 (this round). Assume the deploy queue is whatever was already pending at round 19 + 2 more tags:

```
v0.60.0   public-readiness follow-up bundle      (no blueprint deltas needing migration)
v0.61.0   FA-8 Universal Backlink Panels        (5 entity blueprints bumped MINOR)
```

If the tap was bumped to v0.59.11 already + brew sauce upgraded, then the new "live tag stack" delta is just v0.60.0 + v0.61.0. Otherwise the round-19 deploy checklist still applies for the prior cycles too.

## Recommended next

- **Card:** [[FA-9 · Activity feeds + rollups]]
- **Reason:** Final FA workstream payoff cycle (gated; depends on FA-8 closed — now done). Generalizes the BacklinkPanel reverse-query pattern across time (Today.md / cowork hubs activity feed) + adds a project-rollup dashboard. Closes the Frontmatter Alignment workstream — after FA-9, the workstream-level `[[Frontmatter Alignment]]` card can be moved from In Progress → Completed at top level.

**Alternative:** **pause for user-driven deploy** instead — same pattern as round 19. Tap merge + `brew upgrade sauce` + 4-vault reinstall + manual headspace smoke before starting FA-9. Avoids accumulating two MINORs of tap drift. User can pick either path at Phase B.

## v0.61.0 deploy checklist (if user picks deploy at next-round Phase B)

### 1. Workshop pre-deploy sanity (already done)

- `npm run release:preflight` GREEN at v0.61.0 close
- `git status` clean on main except `.claude/scheduled_tasks.lock` (untracked, harness-managed)
- `git log --oneline -1` → `02c636d chore(release): v0.61.0 — workshop_version bump + package.json lockstep (FA-8)`
- `v0.61.0` tag pushed to origin

### 2. Tap formula bump (5 min)

The `release.yml` workflow on tag push fires an auto-PR against `willfell/homebrew-sauce`. Depending on whether the round-19 deploy already happened or not:

**If the round-19 deploy ran (tap is at v0.59.11 + brew upgraded already):** new tags to land are v0.60.0 + v0.61.0. Merge the latest auto-PR (v0.61.0) and close the v0.60.0 if it auto-opened separately. Or one direct bump on tap main pointing at v0.61.0.

**If the round-19 deploy did NOT run:** the auto-PR stack now has v0.59.11 + v0.60.0 + v0.61.0 (and 11 prior). One direct bump on tap main pointing at v0.61.0 is the cleanest path; close the older auto-PRs.

```bash
cd ~/projects/repos/homebrew-sauce
git pull
# Edit Formula/sauce.rb:
#   url   "https://github.com/willfell/sauce/archive/refs/tags/v0.61.0.tar.gz"
#   sha256 "<sha256 of the v0.61.0 tarball>"
# Compute sha:
curl -sL https://github.com/willfell/sauce/archive/refs/tags/v0.61.0.tar.gz | shasum -a 256
git commit -am "Sauce 0.61.0"
git push origin main
# Close any open auto-PRs (gh pr list + gh pr close)
```

### 3. brew upgrade across machines (~2 min per machine)

```bash
brew update && brew upgrade sauce
sauce --version    # should report 0.61.0
```

### 4. 4-vault subscription pin bumps + reinstall (~3 min per vault)

Per vault edit `<vault>/ranch/platform-subscription.json`:

```jsonc
{
  "workshop_version": "0.61.0",
  "mechanisms": [
    // additive: { "name": "backlink-panel", "version": "0.1.0" }
  ],
  "blueprints": [
    // v0.61.0 deltas (MINOR bumps) — depend on each vault's current pins:
    { "name": "teams",    "version": "0.3.0" },   // was 0.2.0
    { "name": "products", "version": "0.3.0" },   // was 0.2.0
    { "name": "trips",    "version": "0.3.0" },   // was 0.2.0
    { "name": "people",   "version": "0.4.0" },   // was 0.3.0
    { "name": "project",  "version": "1.14.0" }   // was 1.13.6
  ]
}
```

Then `sauce reinstall --vault ~/notes/sauce/<vault>` per vault. The 4:
- `~/notes/sauce/headspace-sauce/`
- `~/notes/sauce/accuris-sauce/`
- `~/notes/sauce/ero-sauce/`
- `~/notes/sauce/barebones/`

Expected: 5 template overwrites per vault (one per entity blueprint) + 1 new file (`ranch/scripts/backlink-panel/backlink-panel.js`).

### 5. Manual headspace smoke (~5 min)

Open `~/notes/sauce/headspace-sauce/` in Obsidian, Cmd-R, verify:

**BacklinkPanel sanity (5 templates):**

1. **Team page** — Open any `spice/teams/<TeamName>.md`. Scroll to bottom — expect a `## Mentions` H2. If no project mentions this team yet, expect "_No mentions yet._" placeholder. Create a project that references this team (`teams: ["[[<TeamName>]]"]` in frontmatter); reload the Team page → expect the project to appear in the panel.

2. **Product page** — Same pattern. Mention from a Team or Project that carries `products: ["[[<ProductName>]]"]`.

3. **Trip atlas** — Same pattern. Mention from a daily/meeting/scratch note that carries `trips: ["[[<TripName>]]"]`.

4. **Person page** — Open any `spice/people/<First Last>.md`. New `## Mentions` panel renders BELOW the existing `## Meetings` + `## Daily Mentions` panels. Universal cross-blueprint backlink (vs the scoped per-blueprint Meetings + Daily panels).

5. **Project atlas** — Open any `spice/projects/<slug>/<name>.md`. New `## Mentions` panel renders ABOVE the existing `> [!example]- Project Notes & Referenced By` callout. Uses `groupBy: "type"` — backlinks are partitioned by the referencing note's `type:` frontmatter (one H4 section per type: `meeting` / `scratch` / `daily` / etc.). Empty-state still works if no canonical-key mentions exist.

**v0.61.0 regressions to watch for:**

- Existing PeopleRendering "Meetings" + "Daily Mentions" panels should still render the same way they did pre-v0.61.0 (they're untouched in this cycle — the FLN-v61-3 latent issue with `args: [dv, ...]` predates this round). If suddenly they're showing the BacklinkPanel error Notice instead, that's a regression.
- Project page existing `ProjectReferencedByCards` panel should still render its callout. The new BacklinkPanel is ABOVE it; both render.
- Team / Product / Trip pages: no pre-v0.61.0 backlinks panel existed. The new one is purely additive.

### 6. v0.61.0 acceptance gate

- All 5 entityType embeds render either with mention pages or a clean empty-state.
- No JS errors in the dev console.
- No regressions on existing PeopleRendering / ProjectReferencedByCards panels.

## Open questions / dependencies

- **Deploy or proceed?** Round 19 paused for deploy because 14 tags had accumulated. Now 1-2 more tags depending on prior deploy state. User decides at next-round Phase B.
- **CLAUDE.md drift** (FLN-v61-2): "Workshop version: 0.49.2" claim in CLAUDE.md is many cycles stale. Not blocking. Future CLAUDE.md maintenance pass.
- **PeopleRendering double-dv FLN** (FLN-v61-3-ish): not introduced by v0.61.0 but surfaced during the cycle. Captured for the Bugs workstream.

## ScheduleWakeup

This round self-paces via the /loop dynamic mode. Next wake-up scheduled at 270s — keeps the prompt cache warm. The next round will pause at Phase B for user-pick anyway (FA-9 vs deploy-pause), so wait length matters less than freshness.
