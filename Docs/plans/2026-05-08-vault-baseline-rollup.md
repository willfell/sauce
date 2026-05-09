---
date: 2026-05-08
purpose: Vault baseline rollup — multi-session work-list for cleaning up accuris-sauce / ero-sauce / headspace-sauce to a Sauce-conformant state. Companion to v0.29.0 cycle close. NOT a workshop release cycle — no version bumps, no tag, no harness changes; sessions edit vault files in place.
status: open (post-v0.29.0)
predecessors:
  - Docs/plans/2026-05-08-v0.29.0-vault-audit-design.md (Section 12 — protocol source)
  - Docs/plans/2026-05-08-v0.29.0-vault-audit-result.md (cycle close)
  - Docs/audit.md (user guide)
done_criterion: All 3 vaults pass `sauce audit --quiet` with exit 0 (or every untracked dir is intentional + accepted as user-owned residue, which would be allowlisted in a future `audit-allowlist.json` if v0.29.1 ships that mechanism).
---

# Vault baseline rollup

> [!info] Purpose
> Track multi-session vault cleanup work for the 3 migrated consumer vaults (accuris-sauce / ero-sauce / headspace-sauce). v0.29.0 ships `sauce audit` (detection-only). This doc captures session-by-session progress: each session adds an entry below with vault, before-violation-count, after-violation-count, what-was-fixed, what-remains. The rollup ends when all 3 vaults pass `sauce audit --quiet` exit 0 (or untracked dirs are explicitly accepted per-vault).

## Protocol per session

1. **Snapshot first** — copy target vault to `<vault>.pre-cleanup-<YYYYMMDD-HHmmss>/`. Mirrors v0.28.0 `.pre-migration-<ts>/` discipline. Cheap insurance against bad edits.
2. **Run `sauce audit <vault> --output-file <vault>/ranch/audits/<YYYY-MM-DD-HHmmss>-audit.md`** to capture starting state. The report goes inside the audited vault under `ranch/audits/` so it persists across Obsidian Sync without polluting `spice/` content.
3. **Walk the audit report top-down**, fix violations one by one. Claude makes file edits directly. Each fix is committed (if vault is git-managed) or simply persisted to disk + Obsidian Sync. Untracked top-level directories are evaluated case-by-case: migrate to `spice/<bp>/`, leave as user-owned residue, or surface to user for decision.
4. **Re-run `sauce audit <vault>`** at session end. Capture the closing report alongside the opening report under `ranch/audits/`.
5. **Append delta-summary to this doc** (under "Session log" below). New entry includes: date, vault, before-violation-count, after-violation-count, before-untracked-count, after-untracked-count, what-was-fixed (bullet list), what-remains (bullet list), notes.

## "Done" criterion

All 3 vaults pass `sauce audit --quiet` with exit 0. Equivalently: zero violations and zero untracked top-level directories per vault. The `--quiet` mode prints nothing and returns the exit code only — useful for CI / scripting once a vault stabilizes.

If untracked top-level directories represent user-owned content that legitimately doesn't fit under `spice/<bp>/`, they should either be:
- moved into `spice/<bp>/` if a blueprint covers them,
- moved into a sanctioned dir (`pantry/`, `ranch/`, `assets/`, `.obsidian/`, `.claude/`) if applicable,
- accepted as-is and (future) allowlisted in `ranch/audit-allowlist.json` if v0.29.1 ships that mechanism. Until then, accepted untracked dirs are tracked here in the per-vault status as "explicitly-accepted residue".

After the rollup reaches "done" criterion, v0.30.0 opens with new functionality (journal-migrator / full Sauce-shape project ecosystem / etc.) — exercised on barebones first, then propagated to the 3 conformant vaults.

---

## Per-vault status

### accuris-sauce

- **Initial baseline:** 0 violations + 16 untracked top-level dirs + 9 rules-file missing warnings (captured 2026-05-08 09:57 UTC; opening report `ranch/audits/2026-05-08-095723-audit-opening.md`)
- **Current state:** 0 violations + 11 untracked dirs (after session 1; closing report `ranch/audits/2026-05-08-102735-audit-closing-pass2.md`; intermediate `ranch/audits/2026-05-08-100549-audit-closing.md`)
- **Sessions:** 1 (see "Session log" below)
- **Outstanding pre-rollup blockers:**
  - **Rules-file warnings (9 / 9 blueprints).** All `ranch/rules/*.json` are missing — vault hasn't pulled v0.29.0 platform updates yet. Required before required_frontmatter / required_tag / naming_pattern violations can surface. Recommended: run `sauce update` against accuris-sauce before next cleanup session so violations populate.
  - **Workshop bug — `sauce audit` exit code 0 despite untracked dirs.** Spec says exit 1 if violations OR untracked dirs > 0. Currently exits 0 when only untracked dirs are present. v0.29.1 carry candidate.
- **Deferred / accepted residue (pending v0.29.1 audit-allowlist):** `.smart-env/` (Smart Connections plugin index, plugin-managed at vault root by design), `Automation/` (user Python tooling), `Cowork/` (AI workflow user content), `Docs/` (79 .md user docs; namespace clash with workshop Docs/ noted), `Extras/` (62 .md remaining: Stories/28, Templates/25, Snippets/7, Local-Config/2 — potential user customizations of pre-migration platform shape; Features/ + People/ + Scripts/ already removed), `Files/` + `attachments/` (user assets), `MOCs/`, `Resources/`, `Planning/` (sprint planning), `lib/` (vault tooling .js)
- **Deferred for user judgment:** _(none currently — `Timestamps/` resolved in session 1 pass 2 per user direction; remaining Extras subdirs (Templates/Snippets/Stories/Local-Config) flagged below as accepted residue)_

### ero-sauce

- **Initial baseline:** pending (first cleanup session)
- **Sessions:** (none yet)

### headspace-sauce

- **Initial baseline:** 0 violations + 7 untracked top-level dirs + 9 rules-file missing warnings (captured 2026-05-08 15:59 UTC; opening report `ranch/audits/2026-05-08-155904-audit-opening.md`)
- **Current state:** 0 violations + 4 untracked dirs (after session 1; closing report `ranch/audits/2026-05-08-161006-audit-closing.md`)
- **Sessions:** 1 (see "Session log" below)
- **Outstanding pre-rollup blockers:**
  - **Rules-file warnings (9 / 9 blueprints).** Same gap as accuris-sauce — vault hasn't pulled v0.29.0 platform updates yet. Run `sauce update` against headspace-sauce before next cleanup session so violations populate.
  - **Workshop wikilink-rewrite gaps (v0.29.1 carry candidates).** During session 1 we surfaced TWO migrator-table gaps that the v0.28.0 cycle's `LEGACY_PATH_SUBSTITUTIONS` didn't cover for headspace-shape source content:
    1. `Resources/Views/customjs-guard` → `ranch/views/customjs-guard` — 102 spice/ files affected, hand-rewritten this session.
    2. `boards/side-quests/<slug>` → `spice/boards/side-quests/<slug>` — 42 spice/ files affected, hand-rewritten this session.
    Both are headspace-shape paths (analogous to accuris's `Extras/Scripts/customjs-guard` and `boards/planning/`/`boards/trips/` rules already in the table). The migrator's table is accuris-centric; headspace-shape source paths need parallel rules. v0.29.1 should add: `Resources/Views/` → `ranch/views/`, `Resources/Templates/` → `ranch/templates/`, `Resources/Scripts/` → `ranch/scripts/<bp>/` (caution — names differ; one-to-many rewrite needs investigation), `boards/side-quests/` → `spice/boards/side-quests/`.
- **Deferred / accepted residue (pending v0.29.1 audit-allowlist):** `Cowork/` (AI workflow user content — same posture as accuris), `Docs/` (16 .md user docs; smaller than accuris's 79 but same namespace-clash question), `Resources/` (26 .md remaining: `Local-Config/`, `Reference/`, `Attachments/`, `Snippets/`, `Templates/`, `Scripts/`, `QuickAdd/` — `Views/` already removed; the `Templates/Scripts/QuickAdd/` subdirs are pre-migration-platform-shape but have active spice/ refs to user-customized content not present in `ranch/`, so safe deletion would require sub-migration which exceeds session-1 scope)
- **Deferred for user judgment:**
  - **`Finance/`** (19 .md substantive finance content: `Finance.md`, `Paychecks/`, `Savings/`, `Worksheets/`, `Meta/`, `Debt/`, `Budgets/`) — parallel-living with `spice/finance/` (which has only the install-time blueprint stubs: `Finance.md`, `invoices/Invoices.md`, `paychecks/Paychecks.md`, `budgets/Budgets.md`). The user has TWO finance systems coexisting; choosing which to keep + migrating data is a substantive decision exceeding session-1 cleanup scope. Pending finance-migrator (v0.30.0 carry per CLAUDE.md) OR explicit user direction.

---

## Session log

### 2026-05-08 — accuris-sauce session 1

- **Snapshot:** `accuris-sauce.pre-cleanup-20260508-095654/` (sibling of audited vault; 158M, full tree copy)
- **Before:** 0 violations, 16 untracked dirs
- **After:** 0 violations, 11 untracked dirs (-5; pass 1 removed 4 dirs, pass 2 removed Timestamps/)
- **Audit reports:** opening `ranch/audits/2026-05-08-095723-audit-opening.md` → pass 1 close `ranch/audits/2026-05-08-100549-audit-closing.md` → pass 2 close `ranch/audits/2026-05-08-102735-audit-closing-pass2.md`
- **Fixed:**
  - **Deleted `to-delete/`** — explicit kill-me-named dir; only `to-delete/test/*.js` test files (0 .md), no vault content
  - **Deleted `boards/`** — single migration residue file (`boards/to-do/card-notes/2026/05-May/Template, Task Note.md` referencing pre-migration `Extras/Scripts/customjs-guard` path; superseded by `ranch/templates/Template, Task Note.md`)
  - **Deleted `backup/`** — pre-migration copy of `adops-tickets/EPD/2026/Cyan/` (76 .md, all uniform 20:48 mtime = migration-time copy, no post-migration activity); legacy source `/Users/willfellhoelter/notes/accuris/backup/` parity-confirmed (76 .md present, read-only per landmine #20)
  - **Deleted `migration-plan.json` + `migration.log`** at vault root — v0.28.0 migration artifacts, single-use
  - **Deleted `Extras/People/`** — empty (people-migrator moved 111 .md to `spice/people/`; legacy source still has 111 .md per landmine #20)
  - **Deleted `Extras/Scripts/`** — sole content `customjs-guard/view.js` superseded by `ranch/views/customjs-guard/view.js`
  - **Moved `claude-sync/commands/audit.md` + `project.md` → `.claude/commands/`** — sanctioned dir per CLAUDE.md; empty `claude-sync/` removed
  - **Pass 2 — `Timestamps/` triage + remove + `Extras/Features/` delete (per user direction "remove Timestamps as a whole, with relevant files / dirs being moved to where they should be within the sauce ecosystem; Extras/Features can be removed").** Wrote a one-off node script at `/tmp/timestamps-cleanup.js` (deleted after run) that read each of 99 `.md` files, parsed frontmatter tags, applied `platform/migrate/wikilink-rewrite.js` `rewriteString()` (the canonical 16-rule LEGACY_PATH_SUBSTITUTIONS + WIKILINK_RE table — fixes pre-migration `Extras/Scripts/customjs-guard` → `ranch/views/customjs-guard` etc.), and routed each file to its sauce destination OR deleted as residue:
    - **91 files moved** (with rewrite applied, target dirs created):
      - `Timestamps/MeetingHubs/Planning-B-Meetings.md` → `spice/meetings/hubs/Planning-B-Meetings.md` (custom workstream-scoped meetings hub)
      - `Timestamps/ToDo/Planning-B-ToDo.md` → `spice/to-do/Planning-B-ToDo.md` (custom workstream-scoped to-do)
      - `Timestamps/Summaries/2026-04-14/eod-review-2026-04-14-tuesday.md` → `spice/daily/summaries/2026-04-14/eod-review-2026-04-14-tuesday.md`
      - `Timestamps/Summary/**` (88 daily/team/weekly summaries) → `spice/daily/summaries/**` (preserves the per-date subfolder structure)
    - **8 files deleted as residue** (not blueprint-shaped, OR superseded by migrated content):
      - `Timestamps/Audits/{2026-04-16-audit,2026-04-16-audit-pass-2,2026-04-17-audit,README}.md` (4 user vault-audit reports — historical logs, no sauce blueprint shape; user can re-run `/audit` to regenerate)
      - `Timestamps/2026/04-April/2026-04-01-Status-Dashboard.md` (one-off platform status dashboard, tag `report` not `daily`, no blueprint shape)
      - `Timestamps/2025/2026/01-January/2026-01-07-Wednesday.md` (legacy-shape duplicate of migrated `spice/daily/2026/01-January/Wednesday-2026-01-07.md`)
      - `Timestamps/Meetings/2025-06-16.md` (date-only meeting note superseded by named version `spice/meetings/notes/2025/06-June/New Relic Talk with Kevin-2025-06-16.md` — same date, same attendees, same project)
      - `Timestamps/Summary/2026-04-27-Monday.md` (legacy-shape duplicate of migrated `spice/daily/2026/04-April/Monday-2026-04-27.md`)
    - After zero residual files: `rm -rf Timestamps/` (whole tree).
    - **Deleted `Extras/Features/`** — 6 .md ADO-feature reference notes; user-directed full removal.
    - Post-pass-2 verification: `grep -rl 'Extras/Scripts/customjs-guard' spice/` returns 0 (all rewrites successful); 91 moved files all exist in their targets; `Timestamps/` and `Extras/Features/` gone.
- **Remains (untracked dirs after session):**
  - `.smart-env/` (Smart Connections plugin; defer to allowlist when v0.29.1 ships `audit-allowlist.json` mechanism)
  - `Automation/` (user Python tooling: `story-creator/`, `point-analyzer/` + 3 .md)
  - `Cowork/` (17 .md: AI workflow context + prompts; user-owned)
  - `Docs/` (79 .md user docs across AccurIAM, DevEnablement, LinkGlossary, Cursor, Meta, CRAIG, Prompts, Hawaii, Commands, ERC, Backstage, MCPConfigs, plans; needs user direction — namespace collides with workshop's `Docs/`)
  - `Extras/` (62 .md remaining after pass 2: Stories/28, Templates/25, Snippets/7, Local-Config/2 — potential user customizations of pre-migration platform shape; needs case-by-case user judgment vs `ranch/templates/` parity)
  - `Files/` (user attachments: images/PDFs/docx; `attachments/` sibling has 1 .png; both candidates for consolidation under `assets/` if v0.30.0+ ships such a sanctioned dir, OR allowlist)
  - `MOCs/` (6 .md Maps-of-Content; user-owned pattern)
  - `Planning/` (49 .md sprint planning Cyan/Bamboo; potentially board-card-shaped, user-owned)
  - `Resources/` (5 .md user notes)
  - `attachments/` (1 .png; consolidation candidate with `Files/Attachments/`)
  - `lib/` (9 .js: `azure-devops.js`, `correlate.js`, `daily-note.js`, etc.; user vault tooling)
- **Notes:**
  - Two workshop-side issues surfaced and noted in per-vault status above: (1) audit exit code 0 despite untracked dirs (spec violation; v0.29.1 carry); (2) all 9 `ranch/rules/*.json` missing in this vault (audit can't surface violations until consumer pulls v0.29.0 + runs `sauce update` — recommended pre-step for next cleanup session).
  - The 0-violations result is **misleadingly clean** while rules files are missing. Real conformance assessment requires running `sauce update` first.
  - Cleanup intentionally conservative: only deleted clearly-residue items with parity in legacy source vault (`/Users/willfellhoelter/notes/accuris`, read-only per landmine #20) AND/OR snapshot. User-owned content + ambiguous-mtime content deferred. Snapshot retained at `accuris-sauce.pre-cleanup-20260508-095654/`.
  - 11 remaining untracked dirs lean heavily toward "explicitly-accepted residue" pending v0.29.1 audit-allowlist mechanism. Aside from possibly `Extras/Templates|Snippets|Stories|Local-Config`, none look like pure migration residue.
  - **Pass 2 (Timestamps/) reused workshop migration logic by `require()`-ing `platform/migrate/wikilink-rewrite.js` directly from a one-off node script.** This proved the migrator's `rewriteString()` API is shaped well enough to drive ad-hoc cleanup tooling without re-implementing the LEGACY_PATH_SUBSTITUTIONS table — a useful generalization for future per-vault sweeps that need to migrate stragglers the migrator's blueprint scope didn't catch. Worth considering as a v0.29.x exploration: a `sauce migrate-orphans <vault> [--dry-run]` verb that finds `.md` files outside `spice/`/`ranch/`/sanctioned dirs, classifies by frontmatter tag, applies rewriteString, and routes per per-blueprint-target rules. NOT a v0.29.1 carry candidate (out of scope) — stash as a v0.30.0+ idea.

### 2026-05-08 — headspace-sauce session 1

- **Snapshot:** `headspace-sauce.pre-cleanup-20260508-155853/` (sibling of audited vault; 44M, full tree copy)
- **Before:** 0 violations, 7 untracked dirs
- **After:** 0 violations, 4 untracked dirs (-3)
- **Audit reports:** opening `ranch/audits/2026-05-08-155904-audit-opening.md` → closing `ranch/audits/2026-05-08-161006-audit-closing.md`
- **Fixed:**
  - **Phase 1 (root + claude-sync + small board residue).**
    - Deleted root `migration-plan.json` + `migration.log` (v0.28.0 migration artifacts).
    - Moved `claude-sync/commands/{audit,project}.md` → `.claude/commands/`; rmdir empty `claude-sync/`.
    - Deleted `boards/to-do-cards/2026/05-May/Template, Side Quest Card.md` (orphaned legacy template at non-canonical path; canonical Template, Side Quest Card.md still exists in `Resources/Templates/` for now); rmdir empty parent date-folders.
  - **Phase 2A — Resources/Views customjs-guard rewrite + delete.**
    - Surfaced workshop bug: `LEGACY_PATH_SUBSTITUTIONS` in `platform/migrate/wikilink-rewrite.js:52` is accuris-centric (handles `Extras/Scripts/customjs-guard` etc.) but doesn't cover the headspace-shape `Resources/Views/customjs-guard` path. 102 files in spice/ still referenced the legacy headspace path.
    - Hand-rewrote those 102 spice/ files in-place (`find -exec ... sed -i ''`) replacing `Resources/Views/customjs-guard` → `ranch/views/customjs-guard`. Verified `grep -rl 'Resources/Views/customjs-guard' spice/` returns 0 post-rewrite.
    - Deleted `Resources/Views/` (sole content was `customjs-guard/view.js`; canonical `ranch/views/customjs-guard/view.js` is the newer/better implementation).
  - **Phase 4 — boards/ tree.**
    - Surfaced second migrator-table gap: 42 spice/ files referenced `boards/side-quests/<slug>` (legacy headspace shape), unrewritten because `LEGACY_PATH_SUBSTITUTIONS` lacks a `boards/side-quests/` rule.
    - Hand-rewrote those 42 spice/ files: `boards/side-quests/` → `spice/boards/side-quests/` (target dir already exists with all 7 slugs: autumn-anniversary, find-house-cleaner-evergreen, home-automation-apple-home, Side-Quests, taxes-2025, testing-questing, yuki-gingivitis). Verified zero truly-stale refs post-rewrite.
    - Moved `boards/trips/mammoth/{mammoth_airbnb.pdf, Mammoth Trip.html}` → `spice/trips/mammoth/attachments/` (created subdir).
    - Moved `boards/trips/los-cabos-mexico-presidents-club/attachments/{SE Spa Menu.pdf, Dinner Reservation Will Fellhoelter (accuris).pdf}` → `spice/trips/los-cabos-mexico-presidents-club/attachments/` (created subdir).
    - Moved `boards/trips/attachments/TRAVELDOCUMENTS - 425946 - dab00c0c.pdf` → `spice/trips/attachments/` (general trip docs subdir).
    - Copied `boards/side-quests/taxes-2025/<entire tree>` → `spice/boards/side-quests/taxes-2025/attachments/` (preserved all subfolder structure: 2024/, docs/llc/, docs/individual/, etc. — bank statements, tax docs, EIN, invoices, 1099-NEC proof emails). 17 PDFs + 1 CSV moved.
    - Moved `boards/planning/Planning-Board.md` → `spice/boards/Planning-Board.md` with `rewriteString()` + headspace `Resources/Views/customjs-guard` rewrite applied. Internal `dv.pages('"boards/planning"')` rewrites to `dv.pages('"spice/projects"')` per LEGACY_PATH_SUBSTITUTIONS table.
    - rmdir empty `boards/`.
  - **Phase 5 — Timestamps/ via script.**
    - Wrote `/tmp/timestamps-cleanup-headspace.js` (deleted after run) extending the accuris pattern with: (a) Journal/ → spice/journal/Journal-YYYY-MM-DD.md routing per blueprint manifest convention; (b) ToDo/ → spice/to-do/<Y>/<Mo>/ToDo-YYYY-MM-DD.md routing; (c) headspace-specific `Resources/Views/customjs-guard` rewrite layered on top of workshop's `rewriteString()`.
    - 130 files triaged: **126 moved** (32 journal entries → `spice/journal/Journal-YYYY-MM-DD.md` + 2 pre-dated-convention files preserved as `Journal Entry.md` / `Journal Entry 1.md`; 10 daily todos → `spice/to-do/<YYYY>/<MM-MMMM>/ToDo-*.md`; 83 daily/team/weekly summaries → `spice/daily/summaries/**`; 1 today's daily `2026-05-08-Friday.md` → `spice/daily/2026/05-May/Friday-2026-05-08.md`); **4 deleted** (1 legacy daily duplicate of migrated, 1 status dashboard one-off report, 2 user vault-audit reports `2026-04-16-audit.md` + `2026-04-17-audit.md`); **0 skipped** after parser-fix.
    - rm -rf `Timestamps/`.
- **Remains (untracked dirs after session):**
  - `Cowork/` (16 .md AI workflow user content; same posture as accuris)
  - `Docs/` (16 .md user docs; namespace-clash question with workshop `Docs/`)
  - `Finance/` (19 .md substantive finance content; deferred — see "Deferred for user judgment" above)
  - `Resources/` (26 .md remaining; `Views/` removed this session, the rest deferred — see Outstanding pre-rollup blockers above)
- **Notes:**
  - **Two workshop wikilink-rewrite-table gaps surfaced during this session — both v0.29.1 carry candidates:** (1) `Resources/Views/customjs-guard` (102 spice/ refs); (2) `boards/side-quests/` (42 spice/ refs). The migrator's table is accuris-centric; headspace migration left these references stale. Both fixed in-vault this session via `find ... -exec sed -i ''` per-file rewrites; the canonical fix is to extend `LEGACY_PATH_SUBSTITUTIONS` in `platform/migrate/wikilink-rewrite.js:52` so future migrations of headspace-shape sources don't repeat this manual cleanup.
  - **Reused workshop's `rewriteString()` again** (Phase 4 Planning-Board move + Phase 5 Timestamps script). The pattern from accuris session — `require()` the migrator's wikilink-rewrite.js from a one-off vault-cleanup script — generalized cleanly to headspace, including layering on a vault-specific extra rewrite (Resources/Views) without modifying the workshop module. Reinforces the v0.30.0+ idea floated in the accuris session of a `sauce migrate-orphans` verb that productizes this approach.
  - **The 4 remaining untracked dirs after session 1 split into TWO classes**: (a) "explicitly accepted user-owned residue" (Cowork, Docs, Resources) — same posture as accuris session 1 — pending v0.29.1 `audit-allowlist.json`; and (b) **substantive deferred decisions**: `Finance/` (parallel finance system — needs user judgment OR finance-migrator from v0.30.0).
  - **Headspace went 7 → 4 untracked dirs** in one session (vs accuris 16 → 11). Headspace was less cluttered to begin with and got a more aggressive cleanup (smaller, more thorough). Post-session 1, headspace's remaining dirs are a tighter set of substantive items than accuris's.
- **Phase 6 — Trips blueprint full schema conformance** (per user direction "TripsBoard unavailable; need all trips migrated to fulfill the sauce schema").
    - Diagnosed: `spice/trips/Trips.md` invoked `class: "TripsBoard"` (the legacy headspace class from `Resources/Scripts/trips-board.js`) but canonical sauce class names are `TripsHubCards` / `TripNavButtons` / `TripSectionsCards` (per `platform/blueprints/trips/manifest.json` `customjs_classes`). Class-name mismatches were not in `LEGACY_PATH_SUBSTITUTIONS`, so the migrator left them stale — same pattern class as v0.29.1 path-rewrite carries above, surfaces additional **migrator gap**: per-blueprint **CustomJS class-name renames** also need a substitution table for headspace-shape sources. (v0.29.1 carry candidate.)
    - Wrote `/tmp/trips-schema-migration.js` (deleted after run) — comprehensive trips schema migration:
      - **Per-trip atlas-note rename** (6 trips, all renamed `<Custom Trip Name>.md` → `Trip Atlas.md` per `path_glob: "spice/trips/*/Trip Atlas.md"`).
      - **`type: trip` frontmatter add** for the 4 atlases that lacked it (daves-wedding, evs-wedding, grandma-betty-90th-birthday, mammoth) per rule_fragment `equals: "trip"`. los-cabos + orlando already had `type: trip`.
      - **Canonical section file rename** (5 sauce sections × the trips that had them): `Notes.md` → `Trip Notes.md`, `Stay.md` → `Trip Stay.md`, `Flights.md` → `Trip Flights.md`, `To Do.md` → `Trip To Do.md`, `Packing List.md` → `Trip Packing List.md`. evs-wedding + orlando-grandma-visit got all 5 renames; los-cabos got just `Flights.md` rename. User-added section files (los-cabos's Agenda/Day Before/Dining Reservations/Honorees/Journal/Monster Ziplines/SE Spa, mammoth's Flight Decisioning/Flight Details) preserved unchanged — TripSectionsCards auto-discovers them as sibling cards.
      - **Vault-wide wikilink rewrite** (17 file renames × ~12 vault refs): `[[<old-name>]]` / `[[<old-name>|display]]` → `[[<slug>/<new-name>|<old-name-or-display>]]` to disambiguate same-named files (`Trip Atlas.md` exists in 6 trips). 20 files touched.
      - **`Trips.md` hub replaced with canonical content** per `platform/blueprints/trips/content/Trips.md`: `type: trips-hub`, `tags: [trips-hub]`, `cssclasses: [wide, cards]` (satisfies rule_fragment requiring contains [wide, cards] — opening hub had only [wide]), 3 dataviewjs blocks: SpaceNavButtons + TripNavButtons + TripsHubCards.
    - Wrote `/tmp/trips-atlas-blocks.js` (deleted after run) — atlas dataviewjs canonicalization:
      - Inserted `TripNavButtons` block immediately after `SpaceNavButtons` in every atlas (was missing in all 6).
      - Appended `TripSectionsCards` block at end of every atlas (was missing in all 6 — auto-discovers sibling section/journal/etc files as cards).
      - For los-cabos: replaced inline `TripJournalActions` block (legacy headspace-custom class from `Resources/Scripts/trip-journal-actions.js` — single-purpose "Open Journal" button; sauce has no 1:1 replacement) with `TripSectionsCards` (canonical sibling-discovery; los-cabos's `Journal.md` now appears as a sibling card alongside Agenda/Honorees/etc).
    - Verification: every atlas has `SpaceNavButtons=1, TripNavButtons=1, TripSectionsCards=1, TripJournalActions=0`. Every atlas has `type: trip` frontmatter. All 6 trip dirs match `spice/trips/<slug>/Trip Atlas.md` glob. cssclasses on Trips.md contains [wide, cards].
    - Audit re-run: 0 violations, 4 untracked dirs (UNCHANGED — schema work is inside `spice/trips/`, doesn't affect top-level untracked count). Final report: `ranch/audits/2026-05-08-181810-audit-trips-fix.md`.
- **NEW workshop carry candidate (v0.29.1 OR v0.30.0):** A **CustomJS class-name rename table** alongside `LEGACY_PATH_SUBSTITUTIONS`. Headspace class renames surfaced this session: `TripsBoard` → `TripsHubCards`, `TripJournalActions` → `TripSectionsCards` (with caveat — TJA was a single-purpose headspace-custom class, TSC is the closer canonical equivalent). Likely more for accuris too once migrators v0.30.0 ships full Sauce-shape entity ecosystems for project/trips/etc. Needs investigation: a per-blueprint `class_renames` map in each blueprint manifest, applied during `rewrite_blueprint` plan entries. Same shape as the in-progress carry "Sub-section / task-note rule fragments" in `Carry-forward (v0.29.1+)` table.
- **Phase 7 — Trips card title fix (in-vault patch + workshop carry).**
    - **Symptom:** After Phase 6 renamed every trip's atlas to `Trip Atlas.md`, the Trips hub cards rendered every card's title as the literal string "Trip Atlas" (because `platform/blueprints/trips/helpers/trips-hub-cards.js:46` uses `title: (p) => p.file.name` — basename, which is now identical across all trips). Pre-rename this code path worked because each trip's atlas had a unique filename (`Mammoth.md`, `Ev's Wedding.md`, etc.); post-rename, that signal is gone.
    - **In-vault fix applied (immediate):**
      - **Added `name: "<display>"`** frontmatter to all 6 Trip Atlas notes in headspace-sauce, populated from the original atlas filenames captured in the migration script (e.g., `name: "Los Cabos, Mexico - President's Club"`, `name: "Dave's Wedding"`).
      - **Patched in-vault `ranch/scripts/trips/trips-hub-cards.js:46`**: `title: (p) => p.file.name` → `title: (p) => p.name || p.file.name` (one-line change; falls back to file basename for atlases without a `name:` field, idempotent + backward-compatible).
    - **Workshop trips@0.1.7 PATCH SHIPPED in this session** (per user direction "do everything you can to ensure data is filled, blueprint schema for all trips are in line and functionality is pristine. utilizing sauce commands with the vault successfully with the vault long term is the goal"):
      - Surfaced a deeper inconsistency BEFORE patching: the workshop blueprint had THREE conflicting filename conventions across files — (a) `rule_fragment path_glob: "spice/trips/*/Trip Atlas.md"` and audit fixture `2026-paris/Trip Atlas.md` aligned on the `Trip Atlas.md` filename; (b) `_createTrip` flow at `trip-nav-buttons.js:511-516` created atlas as `${name}.md` (e.g., `Mammoth.md`) with bare section names (`Flights.md`, `Stay.md`, etc.); (c) `_renderTripContext` at `trip-nav-buttons.js:87` used `DEFAULT_ORDER = ["Flights", "Stay", "Packing List", "To Do", "Notes"]` to discover canonical sections by basename. The rule_fragment was added in v0.29.0's audit cycle (rule_fragments[] shipped on 5 blueprints) but the New Trip flow + section discovery code was UNCHANGED across that cycle, so they drifted. The rule_fragment couldn't match any trip created via New Trip until vault hand-migration aligned filenames to `Trip Atlas.md` + `Trip <Section>.md`.
      - **Workshop changes applied** (full schema alignment to rule_fragment as source-of-truth):
        - `platform/blueprints/trips/templates/Trip Atlas.md` — added `name: "{{NAME}}"` after `type: trip`. Uses the existing `{{NAME}}` template variable already passed to `subs()` at `trip-nav-buttons.js:491`.
        - `platform/blueprints/trips/helpers/trips-hub-cards.js:46` — `title: (p) => p.file.name` → `title: (p) => p.name || p.file.name` (idempotent + backward-compatible).
        - `platform/blueprints/trips/helpers/trip-nav-buttons.js:87` — `DEFAULT_ORDER = ["Flights", "Stay", "Packing List", "To Do", "Notes"]` → `["Trip Flights", "Trip Stay", "Trip Packing List", "Trip To Do", "Trip Notes"]`. Plus matching `sectionIconFor` map keys updated.
        - `platform/blueprints/trips/helpers/trip-nav-buttons.js:511-516` — New Trip writeTpl calls aligned: atlas → `"Trip Atlas.md"` (was `\`${name}.md\``); sections → `"Trip Flights.md"` etc. (was `"Flights.md"` etc.). User-added sections via `_promptForSectionTitle` still use `${title}.md` (user-named, no prefix) — only the canonical 5 sections get the `Trip ` prefix.
        - `platform/blueprints/trips/manifest.json` — version `0.1.6 → 0.1.7`.
        - `platform/manifest.json` blueprint catalogue — `trips: 0.1.6 → 0.1.7`.
        - `CLAUDE.md` Status (live) — trips line updated with the v0.1.7 schema-alignment summary.
      - **Harness verification:** all 7 harnesses GREEN — bootstrap 58/0, cli 58/0, install-sh 14/0, helper-cases 429/0 (TW1 templates-no-trailing-whitespace passes the new template), migrate 104/0, audit 41/0 (audit fixtures already used `2026-paris/Trip Atlas.md` shape so the audit harness was already aligned to the rule_fragment), renderer 30 cases exit 0. **704 whole-suite sub-asserts + 30 renderer cases — UNCHANGED from v0.29.0 closing state.** No harness updates needed because the audit fixture was already on the canonical shape.
      - **In-vault headspace ranch/ patches re-applied to match v0.1.7 spec** so `sauce update` against headspace doesn't regress them: ranch/scripts/trips/trips-hub-cards.js, ranch/scripts/trips/trip-nav-buttons.js (DEFAULT_ORDER + sectionIconFor + writeTpl section creation), ranch/templates/Template, Trip Atlas.md (added `name: "{{NAME}}"`). All in-vault patches now byte-equivalent to what the workshop will materialize on next `sauce update` — patches survive the install cycle.
    - **Long-term reliability achieved:** when user runs `sauce update` against headspace-sauce, the workshop will detect trips `0.1.6 → 0.1.7` and refresh `ranch/scripts/trips/*` + `ranch/templates/Template, Trip Atlas.md` with the new canonical versions. Since the in-vault hand-patches match the workshop bytes exactly, the install is a no-op-effectively for the patched files. New trips created via the New Trip button will use the canonical schema (`Trip Atlas.md` + `name:` field + `Trip <Section>.md` filenames).
    - **Cross-vault impact:** accuris-sauce was NOT touched in this session; its `spice/trips/` content (if any) would benefit from the same migration in a future accuris session 2. The workshop fix is now the source-of-truth — accuris session 2 can do a leaner version of the trips-schema-migration script (just rename atlas + sections, add `name:` field) without needing to also hand-patch ranch/ helpers, because `sauce update` on accuris will pull the new trips@0.1.7.
- **Phase 8 — Canonical section-file fill for incomplete trips.** Per `platform/blueprints/trips/manifest.json` description "Each trip is a flat folder with an atlas note + 5 baseline sections (Flights, Stay, Packing List, To Do, Notes)." 4 of headspace's 6 trips lacked some/all canonical sections (only the New Trip flow creates them, but pre-migration trips had varying shapes). Wrote `/tmp/trips-fill-sections.js` (deleted after run) — for each trip, copies missing `ranch/templates/Template, Trip <Section>.md` to `spice/trips/<slug>/Trip <Section>.md` with `{{DATE}}` substituted from the atlas's `created` field. Idempotent: skips files that already exist.
    - **Created 19 section files** (4 trips × varying counts): daves-wedding (5/5), grandma-betty-90th-birthday (5/5), los-cabos (4/5; Trip Flights already migrated), mammoth (5/5).
    - **Skipped 11** as already-existing: evs-wedding (5/5), orlando-grandma-visit (5/5), los-cabos's Trip Flights.
    - User-added sections (los-cabos's Agenda/Day Before/Dining Reservations/Honorees/Journal/Monster Ziplines/SE Spa, mammoth's Flight Decisioning/Flight Details) preserved untouched alongside the new canonical 5. TripSectionsCards auto-discovers all siblings and TripNavButtons surfaces the canonical 5 in DEFAULT_ORDER + user-added in additional row.
- **End-state for headspace-sauce post-session-1:**
  - All 6 trips conform to rule_fragment `path_glob: "spice/trips/*/Trip Atlas.md"` with required frontmatter (type:trip, start_date, end_date, location, tag:trip).
  - All 6 atlases have `name:` field for human-readable card titles.
  - All 6 trips have the canonical 5 baseline section files (some empty pending user fill-in) — full schema-shape coverage.
  - Trips.md hub canonical (cssclasses [wide, cards] + 3 dataviewjs blocks).
  - In-vault `ranch/scripts/trips/*` + `ranch/templates/Template, Trip Atlas.md` byte-equivalent to canonical workshop trips@0.1.7 — `sauce update` will be a no-op-effectively for these files.
  - Workshop trips@0.1.7 PATCH committed + pushed to `origin/main` (`06356d1`). Long-term reliability achieved: `sauce update` durably ships the canonical schema; New Trip button henceforth creates canonical-shape trips out of the box.
- **Phase 9 — "why didn't my board items migrate?" diagnosis + project@1.3.8 PATCH + LEGACY_PATH_SUBSTITUTIONS extensions.**
  - **User question** prompted by Planning Board (`spice/boards/Planning-Board.md`) showing zero project cards despite the 12 .md from `boards/planning/` having migrated to `spice/projects/`.
  - **Root cause:** the migrated Planning-Board.md still queried `dv.pages('"boards/planning"')` — the OLD pre-migration path. The migrator's `LEGACY_PATH_SUBSTITUTIONS` rule `/[Bb]oards\/planning\//g` requires a TRAILING SLASH to match, but `dv.pages('"boards/planning"')` ends with a closing quote (no slash). So the rewrite missed it. Same shape miss for any `boards/<X>` dv.pages call. Plus the table never had rules for `boards/side-quests/` or `boards/to-do-cards/` at all (44 spice/ files were touched manually in Phase 4 to fix these).
  - **Workshop LEGACY_PATH_SUBSTITUTIONS extensions** (`platform/migrate/wikilink-rewrite.js:52`):
    - Added headspace-shape rules: `Resources/Views/customjs-guard`, `Resources/Templates/`, `Resources/Scripts/`, `Resources/Views/` (from Phase 2A's hand-rewrite work).
    - Added missing path rules: `boards/to-do-cards/` → `spice/boards/to-do-cards/`, `boards/side-quests/` → `spice/boards/side-quests/` (from Phase 4's hand-rewrite work).
    - Added **no-trailing-slash variants** for the dv.pages call shape: `boards/planning` → `spice/projects`, `boards/trips` → `spice/trips`, `boards/side-quests` → `spice/boards/side-quests` (uses lookbehind `(?<![/\w])` + lookahead `(?![/\w-])` so they only match the closing-quote/whitespace boundaries, not as substrings of longer paths).
  - **Project@1.3.8 PATCH** (parallel to trips@0.1.7 — same schema-split, same fix shape):
    - Surfaced the same internal inconsistency the trips blueprint had: rule_fragment `path_glob: "spice/projects/*/Project.md"` vs `_createProject` flow at `project-nav-buttons.js:340` creating atlas as `${name}.md`. After v0.29.0 added rule_fragments[] to project, the rule could never match.
    - `templates/Project.md` — added `type: project` + `name: "{{NAME}}"` to canonical project atlas template (existing template variable).
    - `helpers/projects-hub-cards.js:54` — `title: (p) => p.file.name` → `p.name || p.file.name`.
    - `helpers/project-nav-buttons.js:340-341` — New Project writeTpl: atlas `${name}.md` → `Project.md`; map `${name} - Map.md` → `Project Map.md`. Board file unchanged at `${slug}-board.md`.
    - `manifest.json` 1.3.7 → 1.3.8; `platform/manifest.json` catalogue + CLAUDE.md Status updated.
  - **Headspace project schema migration:**
    - Renamed both project atlases: `obsidian-refinement.md` + `Claude CoWork.md` → `Project.md` (each in their slug folder).
    - Added missing rule_fragment frontmatter: `type: project`, `name: "<display>"`, `description: ""`, `workstreams: []` (claude-cowork already had description; obsidian-refinement was missing all four).
    - Vault-wide wikilink rewrite (5 files touched): `[[obsidian-refinement]]` / `[[Claude CoWork]]` / `[[…|display]]` → `[[<slug>/Project|<original-display>]]` to disambiguate the now-shared `Project.md` filename.
    - Patched in-vault `ranch/scripts/project/projects-hub-cards.js:54`, `ranch/scripts/project/project-nav-buttons.js:340-341`, `ranch/templates/Template, Project.md` to match the new project@1.3.8 spec — same byte-equivalence pattern as trips so `sauce update` is a no-op-effectively.
    - Also fixed `spice/boards/Planning-Board.md` dv.pages call: `'"boards/planning"'` → `'"spice/projects"'` (the immediate user-visible bug).
  - **Harness verification:** all 7 harnesses GREEN — bootstrap 58/0, cli 58/0, install-sh 14/0, helper-cases 429/0, migrate 104/0, audit 41/0, renderer 30 cases. **704 whole-suite sub-asserts + 30 renderer cases preserved across this PATCH** (no rule fragments changed, no fixture content moved — the table extension is purely additive new substitution rules).
  - **Net result for headspace's projects:** Planning-Board now resolves to `spice/projects` and shows both project cards. Projects.md hub renders cards via ProjectsHubCards with display names from `name:` field. Both projects conform to rule_fragment `spice/projects/*/Project.md` requirements. Long-term `sauce update` reliability matches the trips story — workshop ships canonical schema; in-vault patches survive install cycles.
- **Phase 10 — `spice/boards/To-Do-Board.md` consolidation.**
  - **User question** prompted by the empty `spice/boards/To-Do-Board.md` after observing the canonical sauce hub showed nothing while their actual to-do items lived in `spice/boards/To-Do.md`.
  - **Root cause:** v0.29.0 boards blueprint installs `content/To-Do-Board.md` (an empty kanban-plugin board) at `spice/boards/To-Do-Board.md` per its manifest. Pre-migration headspace had its kanban content in `boards/To-Do.md` — that file migrated to `spice/boards/To-Do.md` (legacy filename preserved) coexisting with the install-time empty `To-Do-Board.md`. Two boards, one empty (canonical name) + one populated (legacy name). Plus 6 cards' `source_board` frontmatter still pointed to the legacy `boards/To-Do.md` path.
  - **Consolidation applied** (vault-only; no workshop change needed since boards blueprint is already canonical):
    - Wrote `/tmp/todo-board-consolidate.js` (deleted after run) — strips legacy frontmatter from `To-Do.md`, builds canonical `To-Do-Board.md` content with: kanban-plugin frontmatter (`kanban-plugin: board`, `title: To Do Board`, `type: kanban`, `tags: [headspace, board]`), preserves the user's column structure (To Do / In Progress / Blocked / Completed / Archive — `Blocked` is non-canonical but user-meaningful, kept), preserves all items, and adds canonical kanban settings: `new-note-folder: spice/boards/to-do-cards`, `new-note-template: ranch/templates/Template, Board Card.md`.
    - Removed stale `[[boards/to-do-cards/2026/05-May/Template, Side Quest Card]]` wikilink (template was deleted in Phase 1; left orphan ref in 1 place inside To-Do.md).
    - Deleted `spice/boards/To-Do.md` (consolidated into To-Do-Board.md).
    - Updated `source_board: boards/To-Do.md` → `source_board: spice/boards/To-Do-Board.md` in 26 to-do cards (more than the 6 I'd initially grepped — turned out many cards had this field pointing to the legacy path, and the migrator's wikilink-rewrite never touched the `source_board:` frontmatter key shape).
    - Verified: 56 items in canonical To-Do-Board.md (down 1 from the 57 in legacy due to Side Quest Card stale-ref removal), zero `Side Quest Card` refs remaining, To-Do.md gone.
  - **Folder name decision:** kept `spice/boards/to-do-cards/` instead of renaming to canonical `spice/boards/cards/`. Reason: ~9 daily summaries reference `boards/to-do-cards/` paths (already broken pre-migration since they retain the `boards/` prefix; a folder rename would compound the breakage without fixing the existing refs). Plus `to-do-cards` is more descriptive than bare `cards`. Kanban settings's `new-note-folder` updated to match. **Deviation from canonical sauce shape; documented as deliberate.** Future kanban boards (e.g., a hypothetical project-specific board) would default to a `cards/` subfolder per blueprint default; headspace's to-do board uses `to-do-cards/` as the established convention.
  - **Cross-cutting workshop carry candidate (v0.29.1+):** the migrator's wikilink-rewrite handles wikilinks `[[X]]` and body-text path refs but does NOT touch frontmatter scalar fields like `source_board: <path>`. The 26 cards' stale `source_board: boards/To-Do.md` post-migration is the symptom. Generalize: migrator should rewrite path-shaped scalar values in frontmatter using LEGACY_PATH_SUBSTITUTIONS too, or define a per-blueprint frontmatter-rewrite contribution. Out-of-scope this session.
  - **Final headspace state:** all 4 board hubs in `spice/boards/` resolve correctly — `Planning-Board.md` (queries spice/projects, shows 2 project cards), `To-Do-Board.md` (canonical kanban with 56 items + cards subfolder), `Personal Projects.md` (kanban list, user's personal projects), `Side-Quests.md` under side-quests/. Audit: 0 violations, 4 untracked dirs (UNCHANGED — Cowork/Docs/Finance/Resources still pending future sessions).

(Append entries here per session. Template:

```
### YYYY-MM-DD — <vault-name> session <N>

- **Snapshot:** `<vault>.pre-cleanup-<YYYYMMDD-HHmmss>/`
- **Before:** <V> violations, <U> untracked dirs
- **After:** <V'> violations, <U'> untracked dirs
- **Fixed:**
  - <bullet>
- **Remains:**
  - <bullet>
- **Notes:** <free-form>
```
)
