# Sauce Pipeline Round 6 — handoff for next round

**Date:** 2026-05-17
**Workshop version shipped:** v0.51.1
**Card completed:** (none on the project board — off-board hotfix, no card)
**Result doc:** (see commit trail `2056532` design+plan → `7c6ead3` template → `e4d55cc` tests → `2c7140b` lockstep → `17584ba` dogfood)

## What shipped

`platform/blueprints/project/templates/Kanban Card.md`'s `_findSourceKanbanBoard` helper now tries `app.metadataCache.getBacklinksForFile(newFile)` first (identity-based indexed lookup; no IO when the cache is warm) before falling back to v0.49.2's vault-scan. The fallback is preserved byte-for-byte for cold-cache safety — Obsidian's `MetadataCache` is event-driven and typically (but not guaranteed) current by template-run time when kanban-plugin appends `[[<title>]]` to the board just before invoking Templater.

`project@1.11.0 → 1.11.1` PATCH; `workshop_version 0.51.0 → 0.51.1`. Test harness +3 (KC-4/5/6 source-string asserts on the hybrid contract in `run-helper-cases.js`, total 715 pass). Preflight green.

## How this round happened

Off-board hotfix surfaced via `/remote-control sauce-pipeline-10` → user-directed Context7 research on Templater + obsidian-kanban APIs → brainstorm produced three options → user approved Option 1 (hybrid swap) for this PATCH; Options 2 (source-context mechanism) + 3 (`tp.hooks.on_all_templates_executed` for auto-promote) deferred to a dedicated MINOR cycle. Mirrors v0.50.1/2/3 hotfix-chain structure (no sauce-board card).

## Board snapshot (after this round)

### In Planning (top-level `sauce-board.md`)
- [[To-Do Blueprint]]
- [[Daily-Hub Blueprint]]
- [[Convenience Functionality]]
- [[Blueprint Orchestration]]
- [[Cowork Brainstorming]]
- [[Scratch Blueprint]]
- [[Bugs]]
- [[Frontmatter Alignment]]

### In Progress (top-level)
(empty)

### Blocked
(empty)

### Completed (top-level, most recent at top)
- [[Projects Blueprint]] (workstream) — 2026-05-17

## Deployment chain

| Tag | Tap PR | Brew | Headspace install | Hands-on smoke |
|---|---|---|---|---|
| v0.50.4 | (still pending merge from prior rounds) | (pending) | (pending) | (pending) |
| v0.50.5 | (still pending merge) | (pending) | (pending) | (pending) |
| v0.51.0 | (still pending merge) | (pending) | (pending) | (pending) |
| v0.51.1 | (auto-fires on tag push) | (pending merge) | (pending) | (pending) |

**Note:** **four** tags now stacked since the last brew upgrade. Merging all four tap PRs together and running `brew upgrade sauce` lands them all in one `sauce reinstall --vault <headspace>` run — v0.51.1 supersedes v0.50.4/5 + v0.51.0 in the same install. The kanban hybrid (v0.51.1) rides alongside wiki-fix (v0.50.4) + mobile-wrap (v0.50.5) + status-widget (v0.51.0).

## Recommended next

- **Card:** [[Frontmatter Alignment]] (top-level)
- **Reason:** Standing recommendation from round 5 + 4 + 3 handoffs. Earlier cycle notes reference an FA-1..FA-9 design inventory that may already exist (worth a quick scan first). Clears a long-standing top-level item.

Alternates:
- **[[Convenience Functionality]]** — top-level card; user-mentioned in v0.50.5 bug card body, suggesting interest.
- **[[Bugs]]** — top-level catch-all container; would want sub-card pick first.
- **Deploy-stack alternate:** pause card-picking, merge the 4 stacked tap PRs, run brew upgrade + headspace reinstall + hands-on smoke. Validate before stacking more work.

## Open questions / dependencies

- Four undeployed tags now. User can let the loop keep adding cycles or pause + deploy first. Either is fine; the deploy chain is idempotent.
- v0.51.1's cache path needs hands-on smoke at headspace to verify the cache hit rate is what we expect (cache-warm hit on the common kanban-add flow vs. fallback firing). The fallback is byte-identical to v0.49.2 so no functional regression risk; this is a "did the optimization actually take?" check, not a "does it still work?" check.
- The deferred MINOR cycle for source-context mechanism extraction is on the bench. Won't be useful until a second blueprint needs trigger-context detection (Lego principle 5 — need ≥2 callsites). Today only Kanban Card.md uses it.

## FIX-LATER notes (carried over + new)

**New this cycle:**
- **FLN-9.** v0.51.1's cache-path branch was added without a runtime determinism test (we have source-string asserts via KC-4/5/6, but no test that proves cache-warm vs cold actually takes the right branch). A test harness that stubs `app.metadataCache.getBacklinksForFile` would let us assert this — useful when the upstream `source-context@0.1.0` mechanism is extracted and we want to characterize cache hit rates.
- **FLN-10.** `tp.config.target_file` vs `tp.file.find_tfile(tp.file.path(true))` fallback inside `_findSourceKanbanBoard` is untested — both should resolve to the same TFile in practice but a defensive comment + sanity log on disagreement would help future debugging.

**Carried forward from earlier cycles:**
- **FLN-1.** `applyWikiBackfill` should be unconditional + repair 0-byte Wiki.md files (v0.50.3).
- **FLN-2.** Tap-merged + brew-upgraded + consumer-reinstalled + smoke validation gate in `/sauce-pipeline` Phase C (v0.50.3).
- **FLN-3.** EC-39's vault stub doesn't enforce parent-dir-exists like real Obsidian does (v0.50.4).
- **FLN-4.** AccentButton rows + other blueprints' nav-button renderers likely need wrap treatment (v0.50.5).
- **FLN-5.** Set Teams + Set Products widgets (v0.39.0 Tier-1 bundle remainder) — follow-up when needed.
- **FLN-6.** Shared `status-palette` helper for DRY across `projects-hub-cards.js` + `project-status-widget.js` — refactor when a third consumer needs the palette.
- **FLN-7.** Keyboard navigation in the picker overlay (arrow-keys + Enter). Defer until reported.
- **FLN-8.** Status-change history log (append-only timeline). Out of scope; existing `status_changed_at` stamps the latest only.
