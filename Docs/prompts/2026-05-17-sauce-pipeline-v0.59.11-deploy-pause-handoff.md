# Sauce Pipeline Round 19 — DEPLOY-PAUSE handoff

**Date:** 2026-05-17
**Round status:** PAUSED for user-driven deploy
**Workshop tip:** v0.59.11 (tag pushed; 14 tags since brew sauce v0.56.2)
**Brew sauce baseline:** v0.56.2

## What this round did

User picked "Pause for deploy" at Phase B. No card moved on the project board. No /sauce-pipeline cycle this round. User intent (verbatim):

> Let's pause for deploy — let's get everything in there that we should — from there we'll ensure that we wait and merge the tap brew PR — then from there we're going to deploy to all 4 vaults — from there we'll continue into this loop.

So: deploy now, resume the loop after deploy completes.

## Accumulated tag stack

14 tags between v0.56.2 (brew sauce) and v0.59.11 (workshop tip):

```
v0.57.0   FA-5 Cowork canonical-vocab        (cowork@0.8.0)
v0.58.0   FA-6 Domain wave                   (trips@0.2.0, to-do@0.2.0, boards@0.2.0)
v0.59.0   FA-7 Finance canonical-vocab       (finance@0.4.0)
v0.59.1   migrate-frontmatter rule additions (no blueprint bump)
v0.59.2   rule date-key regex relax          (no blueprint bump)
v0.59.3   task-board {{DATE}} substitution   (project bump)
v0.59.4   migrate cleanup verb + atlas heuristics (no blueprint bump)
v0.59.5   broaden atlas heuristic            (no blueprint bump)
v0.59.6   tag-based atlas detection          (no blueprint bump)
v0.59.7   atlas-shape keys requirement       (no blueprint bump)
v0.59.8   folder-relative one-atlas rule     (project + Templater backstop retire)
v0.59.9   materialize_once flag (boards)     (boards bump)
v0.59.10  declutter Projects.md hub list     (project + cards bump)
v0.59.11  Kanban Card name-collision fix     (project@1.13.6)
```

## Deploy checklist (user-driven)

### 1. Workshop pre-deploy sanity (5 min)

Already done at workshop tip:
- `npm run release:preflight` passes (last verified at v0.59.11 close).
- `git status` clean on `main`.
- No uncommitted work hanging around.

If anything is amiss, fix first.

### 2. Tap formula bump to v0.59.11 (5 min)

Round 13 / 17 precedent: with multiple accumulated tags, the cleanest path is one direct main bump on the tap (instead of merging 14 auto-PRs). Each tag push fires `release.yml` which auto-opens a tap PR — there may be 14 open auto-PRs by the time you start.

Option A (one direct bump — fastest):
```bash
cd ~/projects/repos/homebrew-sauce  # (or wherever the tap clone lives)
git pull
# Edit Formula/sauce.rb:
#   url   "https://github.com/willfell/sauce/archive/refs/tags/v0.59.11.tar.gz"
#   sha256 "<sha256 of the v0.59.11 tarball — fetch via curl + shasum -a 256>"
git commit -am "Sauce 0.59.11"
git push origin main
# Close the 14 open auto-PRs (gh pr close … or via web UI)
```

Option B (let the latest auto-PR merge; close the rest):
```bash
cd ~/projects/repos/homebrew-sauce
gh pr list           # confirm the v0.59.11 PR is the latest
gh pr merge <#>      # merge it
# Close the older auto-PRs
```

Both end at the same place: tap main has Formula/sauce.rb pointing at v0.59.11.

### 3. brew upgrade across machines (~2 min per machine)

```bash
brew update && brew upgrade sauce
sauce --version    # should report 0.59.11
```

If multiple machines, repeat per machine (this is the durable-sync gate — the tap distributes the binary; brew on each machine pulls the upgrade).

### 4. Consumer-vault subscription pin bumps (4 vaults, ~2 min each)

Per vault, edit `<vault>/ranch/platform-subscription.json`:

```jsonc
{
  "workshop_version": "0.59.11",   // current: typically 0.56.x or 0.59.10
  "mechanisms": [
    // v0.57-v0.59.11 didn't bump any mechanisms;
    // headspace already at the latest workshop-side pins per spot-check
  ],
  "blueprints": [
    // delta from typical pre-FA-5 state:
    { "name": "cowork",  "version": "0.8.0" },   // was 0.7.0 (FA-5)
    { "name": "trips",   "version": "0.2.0" },   // was 0.1.7 (FA-6)
    { "name": "to-do",   "version": "0.2.0" },   // was 0.1.4 (FA-6)
    { "name": "boards",  "version": "0.2.1" },   // was 0.1.0 (FA-6 + v0.59.9 materialize_once)
    { "name": "finance", "version": "0.4.0" },   // was 0.3.1 (FA-7)
    { "name": "project", "version": "1.13.6" }   // was older (v0.59.10 + v0.59.11)
    // others unchanged
  ]
}
```

Headspace is already at 0.59.10 workshop + project@1.13.5; for headspace the only delta is workshop → 0.59.11 + project → 1.13.6. Other vaults likely have larger deltas — check each vault's `ranch/platform-subscription.json` and compute the diff before editing.

The 4 vaults:
- `~/notes/sauce/headspace-sauce/`
- `~/notes/sauce/accuris-sauce/`
- `~/notes/sauce/ero-sauce/`
- `~/notes/sauce/barebones/`

### 5. Frontmatter migration (5 blueprints × 4 vaults = 20 invocations, ~30 sec each)

Skip this step on any vault that has already been migrated (round 17 noted this is per-vault state — track which vaults are caught up).

```bash
for vault in headspace-sauce accuris-sauce ero-sauce barebones; do
  for bp in cowork trips to-do boards finance; do
    sauce migrate-frontmatter --vault ~/notes/sauce/$vault --blueprint $bp --apply
  done
done
```

Each `--apply` writes per-file `.sauce-backup/` sidecars. Watch for `--apply does NOT halt on parse error` skip counts in summary — investigate any non-zero counts.

### 6. Reinstall (4 invocations, ~1 min each)

```bash
for vault in headspace-sauce accuris-sauce ero-sauce barebones; do
  sauce reinstall --vault ~/notes/sauce/$vault
done
```

Materializes v0.59.11 templates, including the updated `Template, Kanban Card.md` with Strategy 0 + suffix-disambiguation. Updates `ranch/platform-installed.json` per vault.

### 7. Audit verification (4 invocations, ~30 sec each)

```bash
for vault in headspace-sauce accuris-sauce ero-sauce barebones; do
  echo "=== $vault ==="
  sauce audit --frontmatter-alignment --vault ~/notes/sauce/$vault
done
```

Expected: zero `legacy_key_used` findings across all 4 vaults for cowork/trips/to-do/boards/finance.

### 8. Obsidian smoke (manual, ~5 min)

Open headspace-sauce, Cmd-R, verify:

**General sanity (carried from round 17):**
- Click "+ Add a card" on any project board → workstream-picker dialog fires + new card lands in correct project's `tasks/<title>/<title>.md`.
- Open a project → action buttons render (Open Board / Create Board / Bump Status / etc.).
- Open a budget note → canonical `month:` key present (post-migration).
- Open a cowork-monthly note → same canonical `month:` check.

**NEW: v0.59.11 name-collision behavioral test:**
- Open a project that already has a task named `Foo` (or create one first).
- Open ANOTHER project board (different project).
- Click "+ Add a card" and type the SAME title `Foo`.
- Expected: new card lands at `spice/projects/<second-project>/tasks/Foo-2/Foo-2.md`. Notice appears: `Task name "Foo" already exists in this project. Saved as "Foo-2".`
- If the new card lands at vault root OR at `spice/projects/<first-project>/tasks/Foo/Foo.md` → v0.59.11 fix isn't firing. Capture the symptom and queue a bug card in Projects Blueprint.

**NEW: v0.59.10 hub-list declutter check:**
- Open `spice/projects/Projects.md`.
- Hub list should render compact (no description column; long project titles wrap to 2 lines instead of being cut off).

## After deploy — restart the loop

Type `/loop /sauce-pipeline` to fire round 19 retry. Round 19 will:
1. Phase A — read THIS handoff (most recent), note the deploy-pause status.
2. Phase B — present the same 4-option pick. FA-8 still the recommendation.
3. With deploy done, "Pause for deploy" no longer applies — pick FA-8 (or whatever).

## Board snapshot (unchanged — no card closed this round)

### In Planning (top-level)
- [[To-Do Blueprint]]
- [[Daily-Hub Blueprint]]
- [[Convenience Functionality]]
- [[Blueprint Orchestration]]
- [[Cowork Brainstorming]]
- [[Scratch Blueprint]]
- [[Bugs]]

### In Progress (top-level — workstream-level)
- [[Frontmatter Alignment]] (FA-1..FA-7 done; FA-8..FA-9 ahead)
- [[Projects Blueprint]] (ongoing — 1 card left in sub-board Planning: Potentially broken docs)

### Blocked
(empty)

### Frontmatter Alignment sub-board Planning
- [[FA-8 · Backlink panels]]
- [[FA-9 · Activity feeds + rollups]]

### Projects Blueprint sub-board Planning
- [[Potentially broken docs]]

## Recommended next (after deploy)

- **Card:** [[FA-8 · Backlink panels]]
- **Reason:** Wave-5 payoff cycle from Frontmatter Alignment; materializes BacklinkPanel views off the canonical-vocab keys (people:, projects:, etc.) shipped v0.53-v0.59.1. Highest end-user-visible payoff of the remaining FA work.

## ScheduleWakeup

**Not scheduled.** This round paused at Phase B per user pick. Restart the loop with `/loop /sauce-pipeline` after deploy completes.
