# Sauce Pipeline Round 7 — handoff for next round

**Date:** 2026-05-17
**Workshop version shipped:** v0.52.0
**Card completed:** (none on the project board — off-board cycle, user-typed card via Phase B "Other")
**Result doc:** (see commit trail `c5c1fe7` design → `9c66655` plan → `7e34285` S1 → `827d4da` S2 → `af7e32a` S3 → `ba4f167` S4 → `296e50a` S5 → `5f1db59` S6 → `6ab6107` S7 → tag `v0.52.0`)

## What shipped

Renamed the v0.50.0 "Wiki" surface on the project blueprint to "Docs":
- **Class:** `ProjectWikiCards` → `ProjectDocsCards`
- **Helper:** `project-wiki-cards.js` → `project-docs-cards.js`
- **Templates:** `Wiki Hub.md` → `Docs Hub.md`, `Wiki Note.md` → `Doc Note.md`
- **Subfolder:** `spice/projects/<slug>/wiki/` → `docs/`
- **Hub filename:** `Wiki.md` → `Docs.md`
- **Frontmatter types:** `wiki-hub` / `wiki-note` → `docs-hub` / `doc-note`
- **Tags:** ditto
- **Rules:** `rules/wiki-hub.json` / `wiki-note.json` → `rules/docs-hub.json` / `doc-note.json`
- **entity-create:** id `wiki-note` → `doc-note`, label `+ New Wiki Note` → `+ New Doc`
- **Installer:** `applyWikiBackfill` → `applyDocsBackfill` (FLN-1 fold-in: now repairs 0-byte `Docs.md`)
- **Project-atlas button:** existing "Wiki" button RENAMED to "Docs" (no new surface — `project-nav-buttons.js:357` already had it in the nav row)

**NEW** `applyWikiToDocsMigration` installer step: per-project backup to `.sauce-backup/<slug>/wiki/<ts>/`, copy `wiki/` → `docs/`, remove `wiki/`, rename `Wiki.md` → `Docs.md`, rewrite frontmatter (type + tags) + `customJS.ProjectWikiCards` refs in each migrated `.md`. Idempotent (skip if `docs/` exists); co-existence safety (both dirs present → warn + skip; user resolves manually).

`project@1.11.1 → 1.12.0` MINOR; `workshop_version 0.51.1 → 0.52.0`. Test harness deltas: PWC-1..5 → PDC-1..5 + new PDC-6/7; WIKI-INT-1..3 → DOCS-INT-1..3 + new DOCS-INT-4; AU-WIKI-1..4 → AU-DOCS-1..4; WIKI-1..6 → DOC-1..6 in run-entity-create.js; R-WIKI-1 body checks updated; **NEW** `run-wiki-to-docs-migration.js` harness with 14 sub-asserts (3 cases — happy-path + idempotency + co-existence — using in-memory VaultAdapter stub via `module.exports` additions to install.js). Preflight green.

## How this round happened

Off-board cycle. User invoked `/sauce-pipeline-11`, picked via Phase B's "Other" option with free-form text describing the rename + button + migration scope. Brainstorm surfaced 3 design forks (migration posture, button surface, auto-creation); user approved all three Recommended options. Design doc grounding pass discovered the "Wiki" button already existed at `project-nav-buttons.js:357` (rename rather than new surface). User directed autonomous execution via `subagent-driven-development` — 7 implementer subagents (S1-S7) + controller-direct tag (S8). 8 commits + 1 tag pushed to `origin/main`.

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
| v0.50.4 | (pending merge) | (pending) | (pending) | (pending) |
| v0.50.5 | (pending merge) | (pending) | (pending) | (pending) |
| v0.51.0 | (pending merge) | (pending) | (pending) | (pending) |
| v0.51.1 | (pending merge) | (pending) | (pending) | (pending) |
| v0.52.0 | (auto-fires on tag push) | (pending merge) | (pending) | (pending) |

**Note:** **five** tags now stacked unreleased. Merging all five tap PRs together and running `brew upgrade sauce` lands them all in one `sauce reinstall --vault <headspace>` run. The Wiki → Docs rename + migration (v0.52.0) rides alongside the wiki-fix (v0.50.4), mobile-wrap (v0.50.5), status-widget (v0.51.0), and kanban-card hybrid (v0.51.1). **Critical:** the migration step runs at install time against existing `spice/projects/<slug>/wiki/` dirs. On the next headspace `sauce reinstall`, expect `.sauce-backup/<slug>/wiki/<ts>/` to appear and `wiki/` → `docs/` to happen automatically.

## Recommended next

- **Card:** [[Frontmatter Alignment]] (top-level)
- **Reason:** Standing recommendation rounds 3-6 (now 7). Earlier cycle notes reference an FA-1..FA-9 design inventory worth scanning before picking. Clears a long-standing top-level item.

Alternates:
- **Pause + deploy:** with 5 stacked tags, this is the natural breakpoint to merge taps + `brew upgrade sauce` + reinstall at headspace + manually smoke the Docs rename + migration. v0.52.0 has consumer-data-touching code (the migration); validating on a real vault before stacking more work is prudent.
- **[[Convenience Functionality]]** — top-level card; user-mentioned in v0.50.5 bug card body.
- **[[Bugs]]** — top-level catch-all container.

## Open questions / dependencies

- Five undeployed tags. User can let the loop keep adding cycles or pause + deploy first. Migration step has not yet run against real consumer data — recommend deploy + smoke before round 8 starts touching project blueprint internals further.
- v0.52.0's migration created NO `.sauce-backup/` on workshop dogfood (the workshop has no `spice/projects/<slug>/wiki/` dirs). The migration code is therefore unit-tested (WTD-MIG-1..3) but integration-untested against real wiki content. The headspace vault is the integration test.
- Any user-authored `[[Wiki Hub]]` cross-references in non-blueprint notes (daily notes, scratch, etc.) will dangle after migration. Use Obsidian's "Find and replace in files" or the rename-with-backlinks UX to fix. Explicitly out-of-scope for the installer migration.

## FIX-LATER notes (carried over + new)

**New this cycle:**
- **FLN-9.** v0.52.0 migration has unit coverage (WTD-MIG-1..3 via in-memory VaultAdapter stub) but no integration coverage against a real Obsidian vault. First headspace reinstall after merge IS the integration test — capture results in a follow-up note.
- **FLN-10.** v0.52.0 added `module.exports` for `applyWikiToDocsMigration` + `applyDocsBackfill` + `_rewriteWikiToDocsBody` to install.js. Future installer steps that need harness coverage should follow the same pattern (pure-additive append to the existing exports).
- **FLN-11.** `_rewriteWikiToDocsBody`'s tags-array regex (`/(\btags\s*:[\s\S]*?)(["']?)wiki-hub\2/g`) is intentionally greedy; with carefully-crafted edge-case inputs (e.g. multiple tags arrays in adjacent frontmatter blocks) it could over-match. Acceptable for the v0.52.0 migration target (single frontmatter block per .md); revisit if a future entity grows multi-block frontmatter.
- **FLN-12.** Project-atlas `[[Wiki Hub]]` cross-references in user-authored notes are NOT rewritten by the installer migration. Document this in the next release's user-facing notes / Docs/use.md.

**Carried forward from earlier cycles:**
- **FLN-1.** SHIPPED in v0.52.0 (applyDocsBackfill is now unconditional and repairs 0-byte Docs.md).
- **FLN-2.** Tap-merged + brew-upgraded + consumer-reinstalled + smoke validation gate in `/sauce-pipeline` Phase C (v0.50.3).
- **FLN-3.** EC-39's vault stub doesn't enforce parent-dir-exists like real Obsidian does (v0.50.4).
- **FLN-4.** AccentButton rows + other blueprints' nav-button renderers likely need wrap treatment (v0.50.5).
- **FLN-5.** Set Teams + Set Products widgets (v0.39.0 Tier-1 bundle remainder) — follow-up when needed.
- **FLN-6.** Shared `status-palette` helper for DRY across `projects-hub-cards.js` + `project-status-widget.js` — refactor when a third consumer needs the palette.
- **FLN-7.** Keyboard navigation in the picker overlay (arrow-keys + Enter). Defer until reported.
- **FLN-8.** Status-change history log (append-only timeline). Out of scope.
