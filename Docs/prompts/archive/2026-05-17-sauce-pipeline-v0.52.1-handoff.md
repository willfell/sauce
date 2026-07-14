# Sauce Pipeline Round 8 — handoff for next round

**Status:** USER PICKED SKIP-TO-DEPLOY; v0.52.1 hotfix shipped mid-deploy
**Date:** 2026-05-17
**Workshop version shipped:** v0.52.1 (PATCH hotfix)
**Card completed:** (none — off-pipeline deploy work)
**Result:** deploy chain executed; v0.52.0 bug surfaced + v0.52.1 fix shipped + tap merged + brew upgraded + headspace reinstalled clean

## What happened

User invoked round 8, picked "skip (end the loop — deploy 5 stacked tags first)" at Phase B. Free-form override: "deploy all changes to the headspace vault." Controller (me) executed the deploy chain instead of the pipeline-correct skip-handoff exit:

1. **Tap PRs:** merged #38 (v0.52.0), closed #34/35/36/37 as superseded (homebrew formula is a single version pointer, so latest-only is sufficient).
2. **brew upgrade sauce:** 0.50.3 → 0.52.0.
3. **First headspace reinstall:** install skipped project + entity-create because headspace subscription pinned old versions. Bumped pins to current (project 1.10.2 → 1.12.0, entity-create 0.3.1 → 0.3.2, workshop 0.50.3 → 0.52.0).
4. **Second headspace reinstall:** install completed clean but the `applyWikiToDocsMigration` step left empty `wiki/` dirs alongside the new `docs/` dirs.

## Bug surfaced: v0.52.0 `_rmDirRecursive` calls `adapter.rmdir` which doesn't exist on CLI-mode adapter

Per-project migration log:

```
{"event":"warning","step":"wiki_to_docs_migration","reason":"migration failed for <slug>: adapter.rmdir is not a function"}
```

Symptom: 6/6 projects with pre-existing `wiki/` dirs got partial-migration state:
- ✅ `.sauce-backup/<slug>/wiki/<ts>/` — created
- ✅ `docs/Docs.md` — created with rewritten frontmatter
- ✅ `wiki/*.md` files — removed via `adapter.remove`
- ❌ `wiki/` empty directory — not removed (adapter.rmdir threw)

The in-memory `VaultAdapter` stub used by WTD-MIG-1..3 unit tests has `rmdir: async () => {}`. Real Obsidian CLI-mode adapter (per `ranch/templater/platformInstall.js` stub) does not expose `rmdir`. Unit tests passed; integration revealed the gap — which is exactly the v0.52.0 handoff's FLN-9 surfaced live ("v0.52.0 migration has unit coverage but no integration coverage against a real Obsidian vault. First headspace reinstall after merge IS the integration test").

## v0.52.1 hot-fix (shipped same session)

Hybrid `_rmDirRecursive` with three-strategy fallback:
1. `adapter.rmdir(dir)` if available (Obsidian runtime — unchanged behavior)
2. `fs.rmSync(absDir, { recursive: true, force: true })` via Node fs against `adapter.basePath` (CLI mode — new)
3. Leave empty dir (last resort; idempotency guard skips on re-run)

NEW WTD-MIG-4 sub-asserts (4): uses a real-fs-backed adapter (tmpdir) with `.rmdir` explicitly absent, exercises the Node fs fallback path. Asserts the wiki/ dir actually removed on disk.

`project@1.12.0 → 1.12.1`; `workshop_version 0.52.0 → 0.52.1`. Preflight green (18 sub-asserts in run-wiki-to-docs-migration.js, up from 14).

## Deploy chain (final)

| Tag | Tap PR | Brew | Headspace install |
|---|---|---|---|
| v0.52.0 | #38 merged 07:38:46Z | 0.50.3 → 0.52.0 | done (with bug) |
| v0.52.1 | #39 merged 07:46:51Z | 0.52.0 → 0.52.1 | done (clean) |

Manual cleanup of the 6 empty `wiki/` leftovers ran via `find ... -type d -empty -delete` between the two installs. Backups preserved at `.sauce-backup/<slug>/wiki/20260517-013959/`.

## Final headspace state (validated)

- 0 `wiki/` directories under `spice/projects/<slug>/`
- 9 `docs/` directories: home / test / aligning-sauce-with-claude / obsidian-refinement / ya / claude-cowork / flowerbed-mouse-guard / sauce / another
- 6 backup dirs at `.sauce-backup/<slug>/wiki/20260517-013959/` containing the original wiki content
- `Cmd-R in Obsidian` needed by the user to reload CustomJS classes (`ProjectDocsCards`) before the renamed Docs Hub renders correctly

## Board snapshot (unchanged from round 7)

### In Planning (top-level `sauce-board.md`)
- [[To-Do Blueprint]]
- [[Daily-Hub Blueprint]]
- [[Convenience Functionality]]
- [[Blueprint Orchestration]]
- [[Cowork Brainstorming]]
- [[Scratch Blueprint]]
- [[Bugs]]
- [[Frontmatter Alignment]]

### In Progress
(empty)

### Blocked
(empty)

### Completed (most recent at top)
- [[Projects Blueprint]] (workstream) — 2026-05-17

## Recommended next

- **Card:** [[Frontmatter Alignment]] (top-level — standing recommendation rounds 3-7)
- **Reason:** With deploy chain settled + Docs rename live, Frontmatter Alignment is the next concrete top-level card.

Alternates:
- **[[Bugs]]** — the user observed "another project has no wiki/ created at creation time" earlier this round. Worth diagnosing whether this is a pre-v0.52.0 regression on entity-create's extra_files[] handling. Could be sub-card material.
- **Cmd-R smoke first:** user should hard-reload Obsidian + click the "Docs" button on a project hub + verify the renamed Docs Hub renders + click "+ New Doc" + verify creation flow before stacking more work.

## Open questions / dependencies

- **User Cmd-R smoke is the next implicit gate.** v0.52.1 ships clean per CLI verification but the dataviewjs blocks need Obsidian's CustomJS reload to pick up `ProjectDocsCards` (the renamed class). If a regression is observed, the bug feeds back into round 9.
- **`.sauce-backup/<slug>/wiki/20260517-013959/`** dirs are intentionally preserved. User can `rm -rf` them at any time once they've validated docs/ is correct.
- **The "another project has no wiki/ at creation"** observation from the deploy session is unrelated to v0.52.0/1 — it suggests a pre-existing entity-create extra_files[] bug worth a follow-up card.

## FIX-LATER notes (carried over + new)

**New this cycle:**
- **FLN-13.** WTD-MIG harness now has both in-memory-stub (Strategy A, adapter.rmdir present) AND real-fs (Strategy B, adapter.basePath fallback) coverage. Future install.js helpers that touch fs operations should adopt the same dual-coverage pattern.
- **FLN-14.** Pre-existing bug: new project "another" created via entity-create did NOT auto-create `wiki/` (pre-v0.52.0) or `docs/` (post-v0.52.0) sidecar. `applyDocsBackfill` rescued it (created `docs/Docs.md` from template on next install), but the entity-create `extra_files[]` step should have done this at creation time. Worth a triage cycle: is `extra_files[subfolder: docs]` actually firing for new project creation?
- **FLN-15.** brew upgrade hit a sandboxing issue ("could not create work tree dir homebrew/homebrew-core"). Worked around with `HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_FROM_API=1`. Document this in `Docs/use.md` for future deploy sessions.

**Carried forward from earlier cycles:**
- **FLN-1.** SHIPPED in v0.52.0 (applyDocsBackfill unconditional + 0-byte repair).
- **FLN-2.** Tap-merged + brew-upgraded + consumer-reinstalled + smoke validation gate in `/sauce-pipeline` Phase C (v0.50.3). **Validated this round** — deploy chain executed end-to-end + bug-detect + hotfix + re-validate.
- **FLN-3.** EC-39's vault stub doesn't enforce parent-dir-exists like real Obsidian does (v0.50.4).
- **FLN-4.** AccentButton rows + other blueprints' nav-button renderers likely need wrap treatment (v0.50.5).
- **FLN-5.** Set Teams + Set Products widgets (v0.39.0 Tier-1 bundle remainder) — follow-up when needed.
- **FLN-6.** Shared `status-palette` helper for DRY across `projects-hub-cards.js` + `project-status-widget.js` — refactor when a third consumer needs the palette.
- **FLN-7.** Keyboard navigation in the picker overlay (arrow-keys + Enter).
- **FLN-8.** Status-change history log (append-only timeline).
- **FLN-9.** ADDRESSED in v0.52.1 (integration coverage added via WTD-MIG-4 real-fs case). Future migrations should follow this pattern.
- **FLN-10.** `module.exports` additive append pattern in install.js for harness consumption.
- **FLN-11.** `_rewriteWikiToDocsBody` tags-array regex theoretical over-match.
- **FLN-12.** User-authored `[[Wiki Hub]]` cross-references not auto-rewritten by migration.

## No ScheduleWakeup

User picked skip at Phase B. Loop ends here. Restart with `/loop /sauce-pipeline` after Cmd-R + smoke validation (or whenever ready).
