# Sauce Pipeline Round 13 — DEPLOY handoff for next round

**Date:** 2026-05-17
**Workshop version shipped:** (no new tag — deploy round only)
**Brew sauce:** 0.52.1 → **0.56.0** (4 versions in one step)
**Cards on board:** unchanged (no FA-N picked this round)

## What happened this round

User reported a project regression: "no workstream prompt when adding a card to a project board" + "no buttons inside the created task." Pivoted FA-5 selection to a deploy-only round to get v0.55.0/v0.56.0 templates onto the 4 consumer vaults (which were still running pre-v0.55.0 templates against post-FA-3 migrated frontmatter — a likely cause of the symptoms).

## Deploy chain executed

1. **Tap formula bump (direct main push):** willfell/homebrew-sauce Formula/sauce.rb → v0.56.0. The 4 release.yml-created PRs (v0.54.0, v0.55.0, v0.56.0) had merge conflicts from accumulated branches; squashed them into one main bump + closed the 3 superseded PRs.
2. **brew upgrade sauce:** 0.52.1 → 0.56.0 (clean).
3. **Consumer subscription pin bumps** at all 4 vaults — meetings 0.5.1→0.6.0, people 0.2.2→0.3.0, project 1.12.1→1.13.0, daily 0.3.0→0.4.0, journal 0.1.2→0.2.0, scratch 0.3.1→0.4.0, validator 0.2.0→0.3.0, audit 0.2.1→0.3.0. workshop_version pin 0.52.1→0.56.0.
4. **Subscription gap fix:** icons mechanism (v0.47.0+) was missing from barebones + ero + accuris subscriptions; nav-buttons + entity-create depend on it; install would skip them. Added icons@0.1.1 to all 3.
5. **workshop_relative_path patch** at ero + accuris — both were pointing to stale workshop paths (pre-v0.36.0 layout: `pantry` at ero; `../../workshop/sauce` at accuris). Patched both to `/opt/homebrew/opt/sauce/libexec` (brew-installed sauce).
6. **`sauce reinstall --vault <vault>`** on all 4 vaults — finally deployed v0.55.0+v0.56.0 templates:
   - headspace: 17 content overwrites (clean)
   - barebones: 28 content overwrites (clean after icons fix)
   - ero: 21 content overwrites (clean after icons + path fix)
   - accuris: 19 content overwrites (clean after icons + path fix)

## Verification

- All 4 vaults' `ranch/templates/Template, Kanban Card.md` matches workshop's hash byte-for-byte (4d907...85136).
- All 4 vaults' `ranch/templates/Template, Task Board Card.md` carries the FA-3 drive-by regex fix (`^spice/projects/` not `^beacon/projects/`).
- No workshop git changes this round.

## What user should test now

User should hard-reload Obsidian at any consumer vault (Cmd-R) and try:
1. **Create a kanban card on a project board** — should prompt for workstream (via ProjectTaskCreateListener subscribing at vault load).
2. **Open the created task** — buttons should render (Open Board / Create Board) based on context detection.

If the symptoms persist after Cmd-R + create-card test, restart the loop and we'll do a real diagnosis (read ProjectNavButtons.render() context detection paths; verify ProjectTaskCreateListenerInit fires at boot per the customjs startupScriptNames mechanism).

## Board snapshot (unchanged)

### In Planning (top-level)
- [[To-Do Blueprint]]
- [[Daily-Hub Blueprint]]
- [[Convenience Functionality]]
- [[Blueprint Orchestration]]
- [[Cowork Brainstorming]]
- [[Scratch Blueprint]]
- [[Bugs]]

### In Progress
- [[Frontmatter Alignment]] (FA-1..FA-4 done; FA-5..FA-9 ahead)

### FA sub-board Planning (unchanged)
- [[FA-5 · Cowork migration]]
- [[FA-6 · Domain wave]]
- [[FA-7 · Finance migration]]
- [[FA-8 · Backlink panels]]
- [[FA-9 · Activity feeds + rollups]]

## Recommended next

- **Card:** [[FA-5 · Cowork migration]] (per user's previous direction)
- **Reason:** Deploy chain landed; user can now test the project flow at any vault. If still broken, file a Bug card; otherwise proceed with FA-5.

Alternates:
- **Verify project flow first** — Cmd-R at headspace + click "+ Add a card" on a project board. If workstream picker fires + buttons render in the created task, FA-5 is safe to start. If broken, diagnose before continuing.
- **Cleanup `.sauce-backup/` dirs** — 4 vaults × multiple cycles = significant backup accumulation. Safe to `rm -rf` once migrated content is validated.

## FIX-LATER notes (new this cycle)

- **FLN-DEPLOY-1.** release.yml + auto-bump-tap workflow produces a PR per tag, but multiple tags in sequence cause merge conflicts (later PRs don't rebase on previously-merged ones). For multi-tag cycles, direct main bump on the tap is more efficient.
- **FLN-DEPLOY-2.** ero + accuris had stale `workshop_relative_path` (FLN-D1 from round 8 deploy carry-over). Sauce-cli should prefer the bin-shim's resolved sauce dir over platform-config's `workshop_relative_path` field, but currently doesn't. The bin shim's `active-pantry`/brew resolution is invisible to platform-config-based workshopPath determination.
- **FLN-DEPLOY-3.** icons mechanism (v0.47.0+) is required by nav-buttons + entity-create but barebones + ero + accuris subscriptions don't list it. Migration-layout cycles (or a `sauce reconcile-subscription` verb) should add new mechanisms to existing subscriptions automatically.
- **FLN-DEPLOY-4.** Consumer-side subscription pins drift behind workshop catalogue versions; manual bump per consumer is tedious. `sauce reinstall` could optionally upgrade pins to catalogue (with explicit --upgrade flag).

## ScheduleWakeup

270s heartbeat keeps cache warm for the next-round user pick.
