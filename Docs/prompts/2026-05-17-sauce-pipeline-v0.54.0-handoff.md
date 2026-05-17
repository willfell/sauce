# Sauce Pipeline Round 10 — handoff for next round

**Date:** 2026-05-17
**Workshop version shipped:** v0.54.0
**Card completed:** [[FA-2 · Entity wave]] (sub-card; workstream [[Frontmatter Alignment]] remains in In Progress on top-level board)
**Result doc:** `~/projects/repos/sauce/Docs/plans/2026-05-17-v0.54.0-result.md`

## Board snapshot (after this round)

### In Planning (top-level `sauce-board.md`)
- [[To-Do Blueprint]]
- [[Daily-Hub Blueprint]]
- [[Convenience Functionality]]
- [[Blueprint Orchestration]]
- [[Cowork Brainstorming]]
- [[Scratch Blueprint]]
- [[Bugs]]

### In Progress
- [[Frontmatter Alignment]] (workstream — FA-1 + FA-2 shipped; FA-3..FA-9 ahead)

### Blocked
(empty)

### Completed (most recent at top)
- [[Frontmatter Alignment]] / [[FA-2 · Entity wave]] (sub-card) — v0.54.0 — 2026-05-17
- [[Frontmatter Alignment]] / [[FA-1 · Foundation cycle]] (sub-card) — v0.53.0 — 2026-05-17
- [[Projects Blueprint]] (workstream) — 2026-05-17 (round 8 close)

### Frontmatter Alignment sub-board

**Planning:**
- [[FA-3 · Project migration]]
- [[FA-4 · Timeline wave]]
- [[FA-5 · Cowork migration]]
- [[FA-6 · Domain wave]]
- [[FA-7 · Finance migration]]
- [[FA-8 · Backlink panels]]
- [[FA-9 · Activity feeds + rollups]]

**In Progress:** (empty)

**Completed:**
- [x] [[Planning Frontmatter Alignment]]
- [ ] [[FA-1 · Foundation cycle]] (v0.53.0)
- [ ] [[FA-2 · Entity wave]] (v0.54.0)

## What shipped in v0.54.0

Per-blueprint bumps:
- `meetings@0.5.1 → 0.6.0` — Meeting.md adds `created_at:` (ISO+TZ); `new_entity_buttons` adds `created_at` + `people: []`; rule_fragments declare `extends: "_canonical-vocab"`; discriminator tag requirements dropped.
- `people@0.2.2 → 0.3.0` — Template, People.md adds `type: person` + `created_at:`; entity-create adds `created_at`; rule_fragment uses `extends`; `tags.contains: ["person"]` requirement dropped.
- `products@0.1.0 → 0.2.0` — Template, Product.md uses `created_at:`; rule_fragment uses `extends`; old `required_frontmatter.created` + `required_tags: [product]` dropped.
- `teams@0.1.0 → 0.2.0` — Template, Team.md uses `created_at:` + `products: ["[[X]]"]` plural list (was singular `product:`); rule_fragment renames `product` → `products` (list, min_length 1).

**Consumer-vault migration** (393 files):
- `headspace-sauce`: 3 meetings + 112 people = 115 files
- `barebones`: 0 meetings + 111 people = 111 files
- `ero-sauce`: 152 meetings + 15 people = 167 files
- Backups under `<vault>/.sauce-backup/<rel-path>/<timestamp>/<basename>`

**Post-apply audit**: `sauce audit --frontmatter-alignment` reports 0 findings on meetings+people paths at all 3 vaults. Other findings remain on un-migrated blueprints (daily, scratch, projects, etc. — to be addressed in FA-3..FA-7).

**Whole-suite delta:** +20 sub-asserts (16 NEW FA-2 helper-cases + 4 retained on PROD/TEAM fixture updates).

## Recommended next

- **Card:** [[FA-3 · Project migration]]
- **Reason:** Heaviest entity migration: 5 template families on the project blueprint. `project@1.12.1 → 1.13.0` MINOR. Designed with possible FA-3a/FA-3b split if cycle gets unwieldy (atlas+map then board+task+card). After FA-3, project notes adopt canonical vocab + project becomes the single most-impactful per-blueprint migration.

Alternates:
- **FA-4 · Timeline wave** — daily + journal + scratch. Three blueprints; lighter than FA-3.
- **Pause for user smoke** — Cmd-R reload at headspace + verify Templater + entity-create new-note flows still emit canonical keys after FA-2 ship. Not strictly required since canonical keys are additive (existing notes already migrated; new notes will pick up canonical via the bumped templates after `brew upgrade sauce` + reinstall).
- **Cleanup `.sauce-backup/` dirs at consumer vaults** once user validates migrated content. Currently retained for rollback. `rm -rf <vault>/.sauce-backup/` is safe once verified.

## Open questions / dependencies

- **accuris-sauce skipped** at user direction. Will need separate migration before accuris ships canonical-vocab-extended blueprints (or it surfaces `legacy_key_used` warnings).
- **products + teams not subscribed at any consumer**. The blueprint changes ship in the catalogue but are dormant until first subscription. Audit walker handles this via workshop-fallback for the canonical-vocab template.
- **Brew tap auto-bump**: `v0.54.0` pushed; release.yml workflow should bump `Formula/sauce.rb` in `willfell/homebrew-sauce`. Verify tap PR merged + `brew upgrade sauce` against the test machine before FA-3.

## FIX-LATER notes (new this cycle)

- **FLN-FA2-1** — Templater `tp.file.creation_date` vs entity-create `{{now.X}}` substitution mismatch (both produce equivalent ISO+TZ but evaluated differently).
- **FLN-FA2-2** — `mtimeIsoWithTz` uses `Z` (UTC) not local TZ for backfill (cosmetic; audit accepts both).
- **FLN-FA2-3** — accuris-sauce migration skipped per user direction.
- **FLN-FA2-4** — products + teams not subscribed at any consumer yet.
- **FLN-FA2-5** — `tp.file.creation_date` returns blank outside Templater-managed flow (not load-bearing).
- **FLN-FA2-6** — workshop-side `ranch/rules/meetings.json` regenerated by dogfood (no test breakage).

## ScheduleWakeup pacing

Next round picks at Phase B (interactive). 270s fallback heartbeat to keep prompt cache TTL warm — typical pause-for-user-pick window.
