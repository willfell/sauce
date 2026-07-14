---
date: 2026-05-08
purpose: Onboard the next session to run vault baseline rollup session 1 against `/Users/willfellhoelter/notes/sauce/ero-sauce` — same protocol as the accuris-sauce + headspace-sauce sessions already logged in `Docs/plans/2026-05-08-vault-baseline-rollup.md`. NOT a workshop release cycle — vault-only edits + per-session delta entries appended to the rollup doc.
predecessors:
  - Docs/plans/2026-05-08-v0.29.0-vault-audit-result.md (cycle close that opened this rollup work)
  - Docs/plans/2026-05-08-vault-baseline-rollup.md (rollup work-list — accuris session 1 + headspace session 1 already logged with 10 phases of detail)
  - Docs/audit.md (sauce audit user guide)
  - Docs/landmines.md (#20 source vault read-only; #21 audit verb read-only)
  - Docs/prompts/2026-05-08-post-v0.29.0-next-cycle-handoff.md (the predecessor next-cycle handoff that pointed at Option A — vault baseline rollup — as recommended-first)
  - Docs/prompts/SESSION-START.md (canonical session-start recipe)
recent_workshop_changes_relevant_to_this_session:
  - "fix(trips): v0.1.7 PATCH — schema alignment (Trip Atlas.md filename + name: field + DEFAULT_ORDER prefix) — commit 06356d1"
  - "docs(rollup): Phase 8 — canonical section-file fill for headspace trips — commit 5b65f89"
  - "fix(project,migrate): project@1.3.8 PATCH + LEGACY_PATH_SUBSTITUTIONS extensions — commit b22c390"
  - "docs(rollup): Phase 10 — To-Do-Board consolidation in headspace — commit 0c85d2e"
gates:
  - workshop_version 0.29.0 (UNCHANGED across this rollup work; not a release cycle)
  - blueprint versions: trips@0.1.7 + project@1.3.8 SHIPPED in headspace session; daily/meetings/people@v0.29.0 PATCH; boards/journal/to-do/finance still unchanged
  - all 7 harnesses GREEN (704 sub-asserts + 30 renderer cases)
  - landmines list 21 (UNCHANGED)
  - stub md5 invariant `ea23aa812503bfca66359d3b2b239ba8` UNCHANGED
required_sub_skill: none — direct file editing per the rollup protocol; uses `sauce audit` reports + a snapshot for safety. No formal sub-skill (no design / plan / RED-GREEN cycle).
target_artifact: Append a new `### YYYY-MM-DD — ero-sauce session 1` entry to `Docs/plans/2026-05-08-vault-baseline-rollup.md` Session log + update the per-vault status block under `### ero-sauce`. Vault edits live at `/Users/willfellhoelter/notes/sauce/ero-sauce/` (NOT the workshop repo).
---

# Onboarding — ero-sauce baseline rollup session 1

> [!info] Project identity
> - **Project name:** `sauce`
> - **GitHub remote:** `git@github-personal:willfell/sauce.git`
> - **Workshop dev repo (this machine):** `/Users/willfellhoelter/projects/repos/sauce`
> - **Target vault for THIS session:** `/Users/willfellhoelter/notes/sauce/ero-sauce` (post-v0.28.0 migrated; ~56MB; 489 plan entries originally)
> - **Legacy source vault (READ-ONLY per landmine #20):** `/Users/willfellhoelter/notes/ero-sync/ero` — only ever input to `sauce migrate --from <path>`; never written to.
> - **Other migrated consumer vaults:**
>   - `accuris-sauce/` — session 1 done (16 → 11 untracked dirs; snapshot retained)
>   - `headspace-sauce/` — session 1 done (7 → 4 untracked dirs across 10 phases; snapshot retained); trips + projects fully schema-conformant; To-Do-Board consolidated
>   - `barebones/` — primary regression target (untouched; from-scratch Sauce-shape)

## What was just completed (4 commits on `origin/main`)

The headspace baseline rollup session 1 surfaced + fixed multiple workshop-side bugs that will benefit ero migration:

1. **`fix(trips): v0.1.7 PATCH`** (`06356d1`) — closed a schema split between `rule_fragment path_glob: "spice/trips/*/Trip Atlas.md"` and the New Trip flow that was creating `<TripName>.md` atlas + bare section names. Workshop now creates canonical `Trip Atlas.md` + `Trip <Section>.md` filenames; templates gain `name: "{{NAME}}"` field; `trips-hub-cards.js` falls back `p.name || p.file.name`. **Ero session: any pre-existing trips in `spice/trips/<slug>/` need the same Phase 6 + Phase 7 + Phase 8 work that headspace session 1 logged in detail.**

2. **`fix(project,migrate): project@1.3.8 + LEGACY_PATH_SUBSTITUTIONS extensions`** (`b22c390`) — same shape PATCH as trips for the project blueprint (canonical `Project.md` filename, `name: "{{NAME}}"` template field, `p.name || p.file.name` title fallback). **Plus extensive migrator wikilink-rewrite table extensions** that should already make ero's migrator behavior correct for headspace-shape sources:
   - Headspace-shape paths: `Resources/Views/customjs-guard`, `Resources/Templates/`, `Resources/Scripts/`, `Resources/Views/`, `boards/to-do-cards/`, `boards/side-quests/`
   - **No-trailing-slash variants** (the dv.pages closing-quote shape that broke headspace's Planning-Board): `boards/planning`, `boards/trips`, `boards/side-quests`
   
   **Caveat for ero session:** ero was migrated under v0.28.0 — BEFORE these LEGACY_PATH_SUBSTITUTIONS extensions shipped. So ero's `spice/` may have stale path refs that the migrator missed. Same hand-rewrite work that headspace needed in Phases 2A + 4 (sed-replace via `find -exec`) likely applies to ero. If so, document as a per-vault one-time fix; future re-migrations of ero from the legacy source would inherit the proper rewrites without manual cleanup.

3. **Phase 10 To-Do-Board consolidation** (`0c85d2e`) — surfaced that the migrator's wikilink-rewrite **doesn't touch frontmatter scalar fields** like `source_board: <path>`. 26 to-do cards in headspace had stale `source_board: boards/To-Do.md` post-migration. **Check ero's to-do cards for the same issue.**

## Three concrete things ero will likely need (informed guesses; verify on the vault)

Based on ero's top-level layout (`+Home.md`, `Boards/` (capital B), `Extras/`, `Files/`, `Finance/`, `claude-sync/`, plus root-level work files like `~$2026-05-04 Egnyte Connector - One Month In.pptx`, `2026-04-Timesheet.pdf`, several `ero-*.skill` files, `+Home.md`):

1. **Familiar residue patterns** (from accuris + headspace sessions):
   - `claude-sync/` → `.claude/commands/` (sanctioned per CLAUDE.md)
   - Root-level `migration-plan.json` + `migration.log` (v0.28.0 artifacts) → DELETE
   - Pre-migration `Boards/` (capital B; ero's variant of `boards/` lower) — capital-B is unusual, may be a macOS APFS case-collision artifact (similar to how `Beacon/` got renamed to `pantry/` in v0.23.0 per landmine #18). Investigate whether the migrator handled `[Bb]oards` variants correctly; legacy source `/Users/willfellhoelter/notes/ero-sync/ero` is the canonical to compare against.
   - `Timestamps/` (almost certainly present; same Phase 5 cleanup script pattern as accuris/headspace)

2. **Ero-specific patterns** (NOT seen in accuris/headspace):
   - **Root-level work files** (`~$2026-05-04 Egnyte Connector - One Month In.pptx` is a Microsoft Office lock file — definitely DELETE; `.pptx`/`.docx`/`.pdf`/`.jpg` belong in `assets/` or `Files/Attachments/`).
   - **`+Home.md`** at vault root — looks like a user-defined home note. Per CLAUDE.md "Sanctioned new top-level vault dirs" only `spice/`, `pantry/`, `ranch/`, `assets/`, `.obsidian/`, `.claude/` are sanctioned; root-level user notes need user direction (likely accept as residue OR move into a sanctioned dir).
   - **`ero-invoice.skill` / `ero-meeting.skill` / `ero-session.skill` / `ero-status.skill` / `ero-task.skill`** — these are Claude Code skill files. Likely need to move into `.claude/skills/` (sanctioned) or be exposed via the user's Claude Code config differently. Worth surfacing as user-decision.

3. **Finance/ same as headspace** — substantial 19+ md user finance content paralleling spice/finance/'s install-time stubs. The finance-migrator is a v0.30.0 carry per CLAUDE.md so this stays deferred to user judgment.

## Pre-flight checks (do this first)

```bash
cd /Users/willfellhoelter/projects/repos/sauce   # workshop dev repo

# 1. Verify clean state
git fetch origin && git status                    # expect: clean (or only untracked dogfood drift)
git log --oneline -6                              # latest should be 0c85d2e (To-Do-Board consolidation doc)

# 2. Verify all 7 harnesses GREEN (workshop is the source-of-truth shipping the trips@0.1.7 + project@1.3.8 fixes)
for h in run-bootstrap run-cli run-install-sh run-helper-cases run-migrate run-audit; do
  echo "--- $h ---"; node platform/test/$h.js 2>&1 | tail -2
done
node platform/test/run-renderer.js && echo "renderer exit 0"
# Expected: bootstrap 58/0, cli 58/0, install-sh 14/0, helper-cases 429/0, migrate 104/0, audit 41/0, renderer 30 cases

# 3. Verify ero-sauce + legacy source exist
ls /Users/willfellhoelter/notes/sauce/ero-sauce/ranch/platform-installed.json   # confirms it's a sauce vault
ls /Users/willfellhoelter/notes/ero-sync/ero | head -5                          # legacy source for parity checks
du -sh /Users/willfellhoelter/notes/sauce/ero-sauce                             # ~56M expected
```

If any harness FAILS or git status has unexpected mods, STOP and surface to user before proceeding.

## Per-session protocol (same as accuris + headspace sessions)

Per `Docs/plans/2026-05-08-vault-baseline-rollup.md`:

1. **Snapshot first** — `cp -R /Users/willfellhoelter/notes/sauce/ero-sauce /Users/willfellhoelter/notes/sauce/ero-sauce.pre-cleanup-$(date +%Y%m%d-%H%M%S)`. Cheap insurance against bad edits.
2. **Run opening audit** — `node /Users/willfellhoelter/projects/repos/sauce/platform/cli/sauce-cli.js audit --vault /Users/willfellhoelter/notes/sauce/ero-sauce --output-file /Users/willfellhoelter/notes/sauce/ero-sauce/ranch/audits/$(date +%Y-%m-%d-%H%M%S)-audit-opening.md`. Captures starting violation/untracked count.
3. **Walk audit report top-down**, plus inspect non-flagged ero-specific items (root-level files, .skill files, +Home.md). Make edits directly. Reuse the workshop's `rewriteString` from `platform/migrate/wikilink-rewrite.js` via `require()` for any one-off scripts that need to apply LEGACY_PATH_SUBSTITUTIONS during file moves (the accuris + headspace sessions both did this — the technique is well-validated).
4. **Run closing audit** — same flag, different output filename (`-audit-closing.md`).
5. **Append delta entry** to `Docs/plans/2026-05-08-vault-baseline-rollup.md` Session log with: snapshot path, before/after counts, what-was-fixed, what-remains, notes. Update the per-vault status block under `### ero-sauce`.
6. **Commit + push** the rollup doc update only (no workshop changes are expected in a vault-only session). Use `docs(rollup): ero-sauce session 1 — ...` conventional-commits format.

## Constraints carried forward (non-negotiables)

- **Landmine #20** — legacy source vault `/Users/willfellhoelter/notes/ero-sync/ero` is READ-ONLY. Use only as comparison parity-check input. Never write to it.
- **Landmine #21** — `sauce audit` is read-only against the audited vault. `cmd-audit.js` and `platform/audit/*` MUST NEVER write to the audited vault.
- **No workshop_version bump** — this is post-v0.29.0 vault-cleanup work, not a release cycle. If a workshop fix surfaces (like the trips/project class-rename / atlas-filename schema split that headspace surfaced), document it in the rollup as a v0.29.1 or v0.30.0 carry candidate. **Apply workshop changes only if user explicitly approves them this session** (per CLAUDE.md "Ask before acting").
- **CustomJS class names** — if ero's spice/ files reference legacy class names (similar to headspace's `TripsBoard`, `TripJournalActions`), these don't cleanly rewrite via LEGACY_PATH_SUBSTITUTIONS (string-rewrite of class names is brittle). Hand-fix per file and document as a v0.29.1 carry candidate.
- **Don't sign as Claude** — no `Co-authored-by` trailer on commits.
- **Don't skip git hooks** — no `--no-verify` unless user explicitly requests.

## Slash command for the next session

When the user is ready to start, they should paste this into a fresh Claude session:

> Read `Docs/prompts/SESSION-START.md` for canonical session-start, then `Docs/prompts/2026-05-08-ero-sauce-baseline-rollup-session-1-handoff.md` (this file) for cycle-specific carry. Begin ero-sauce baseline rollup session 1: snapshot the vault, run opening audit, walk top-down fixing residue, re-audit, append delta to `Docs/plans/2026-05-08-vault-baseline-rollup.md`. Apply trips/project schema migrations if ero has trips/projects (workshop ships canonical via trips@0.1.7 + project@1.3.8 already on origin/main). Surface workshop carry candidates without applying them unless explicitly approved.

## Stop conditions

STOP and ask the user before:

- Deleting any non-residue-named root-level file (e.g., `+Home.md`, the `.pptx`/`.docx`/`.pdf` files at root, the `ero-*.skill` files). These are user-meaningful content of unclear schema-fit.
- Renaming any folder inside `Boards/` (capital B) — verify case behavior on macOS APFS first; renaming may need the `git mv X X_tmp && git mv X_tmp x` ritual per landmine #19.
- Touching `Finance/` content beyond noting parity with `spice/finance/` — finance-migrator is a v0.30.0 carry; consolidation needs user direction.
- Modifying anything inside `.obsidian/` of ero-sauce except the 13 paths allowlisted by landmine #12.
- Bumping any blueprint version in `platform/manifest.json` (workshop release territory).
- Force-pushing or rewriting history on `origin/main`.

## Lessons from accuris + headspace sessions worth carrying

- **Always snapshot first.** Both prior sessions used `cp -R` to a `.pre-cleanup-<ts>/` sibling; cheap insurance.
- **Run opening + closing audits** with descriptive filenames; archive in `<vault>/ranch/audits/`.
- **Reuse workshop logic via `require()`.** Both accuris + headspace one-off cleanup scripts pulled in `platform/migrate/wikilink-rewrite.js` `rewriteString()` directly to fix legacy path strings during file moves. Saves re-implementing the LEGACY_PATH_SUBSTITUTIONS table.
- **First-of-its-kind shape surprises.** Ero is the third migrated consumer; expect 2-3 ero-specific patterns the prior sessions didn't see (the `+Home.md`, `Boards/` capitalization, `.skill` files at root, root-level work artifacts). Investigate before acting.
- **Defer aggressively when in doubt.** User-owned content (Cowork/, Docs/, MOCs/, Resources/, Planning/, Files/, attachments/, Automation/, lib/, .smart-env/) is appropriate "explicitly accepted residue" — don't try to force into spice/ blueprints. Pending v0.29.1 `audit-allowlist.json` mechanism.
- **Trip + Project schema migration is now a known recipe.** If ero has trips or projects, follow the headspace Phase 6/7/8 (trips) or Phase 9 (projects) approach: rename atlas to `Trip Atlas.md` / `Project.md`, add `name: "<display>"` field, add canonical dataviewjs blocks, vault-wide wikilink rewrite. The workshop now ships the canonical schema via trips@0.1.7 + project@1.3.8 so `sauce update` durably propagates the fix.

## End-of-session checklist

Before closing the session, confirm:

- [ ] Snapshot retained at `/Users/willfellhoelter/notes/sauce/ero-sauce.pre-cleanup-<timestamp>/`
- [ ] Opening audit + closing audit reports both written under `ero-sauce/ranch/audits/`
- [ ] Rollup doc `Docs/plans/2026-05-08-vault-baseline-rollup.md` has a new ero-sauce entry under "Session log" + per-vault status block populated
- [ ] Any workshop carry candidates surfaced this session are documented in the rollup (not applied unless user approved)
- [ ] Git committed + pushed: rollup doc only (no workshop changes in a vault-only session unless explicitly requested)
- [ ] Final state-of-the-3-vaults summary surfaced to the user (accuris untouched in this session; headspace untouched in this session; ero state delta)
- [ ] If ero session 1 needs a follow-up (e.g., workshop release cycle picking up surfaced carries), write the next handoff at `Docs/prompts/<date>-<topic>-handoff.md` per `Docs/prompts/_handoff-protocol.md`
