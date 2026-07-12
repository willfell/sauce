# Journal multi-entry — result

**Closed:** 2026-07-11 · **Version:** journal 0.3.0 → 0.4.0 · workshop 0.211.0 → 0.213.0 (v0.212.0 was this cycle's own release; v0.213.0 landed moments later from a concurrent unrelated cycle before deploy, so brew/consumer deploy targeted the cumulative 0.213.0)

## What shipped

The `journal` blueprint moved from a single flat note per day (`type: journal`,
`Journal-YYYY-MM-DD.md`) to a 3-tier multi-entry shape mirroring `sticky-notes` (v0.10.0):

- **Global hub** — `spice/journal/Journal.md` — Days | All tabs, `doc-search` in All mode.
- **Day hub** — `spice/journal/YYYY/MM-MMMM/YYYY-MM-DD/Journal-Day-YYYY-MM-DD.md` — entry cards
  + `+ New Journal Entry` primary action.
- **Leaf entry** — `.../Journal-YYYY-MM-DD-HH-mm-ss.md` — optional title prompt at creation,
  click-to-rename title banner on the leaf.

New types `journal-hub` / `journal-day` / `journal-entry` replace the single `journal` type.
The `journal-today` nav-button now opens/creates the day-hub instead of the old flat note.

**Files touched** (12 commits on `worktree-bridge-cse_015Rbgos1MPm4SytuCiVp7JB`, PR #407):

- `platform/blueprints/journal/manifest.json` — full rewrite (new types, deps on `cards`/
  `accent-button`/`entity-create`/`platform-claude`/`breadcrumb`/`render-safe`/`doc-search`,
  new `nav_buttons`/`new_entity_buttons`/`rule_fragments`/`claude_surface`)
- `platform/blueprints/journal/templates/{Journal Entry,Journal Day Hub,Journal Hub}.md` (new;
  `Today Journal.md` retired)
- `platform/blueprints/journal/helpers/journal-day-list.js` (new — mirrors `sticky-day-list.js`)
- `platform/blueprints/journal/helpers/journal-hub-cards.js` (new — mirrors `sticky-hub-cards.js`)
- `platform/blueprints/journal/helpers/journal-chrome-bar.js` (full replace — 3-surface
  ChromeBar adapter + leaf title banner, mirrors `sticky-chrome-bar.js`)
- `platform/blueprints/journal/commands/journal.md` + `skills/new-journal-entry/SKILL.md` (new)
- `platform/install.js` — new `applyJournalMultiEntryMigration` function (structural,
  per-file-gated migration converting flat notes to the day-folder shape; wired into the
  per-item pipeline just above `applyScratchToStickyNotesMigration`; exported for tests)
- `platform/test/run-journal-chrome-bar.js` (rewritten, 10/10) + `run-journal-multi-entry.js`
  (new, 20/20) + `package.json` (`release:preflight` chain)
- `platform/test/run-helper-cases.js` — one pre-existing stale fixture fixed (`FA4-TEMPLATES`
  case hardcoded `journal/templates/Today Journal.md`; updated to the new leaf template path)

## Process

Full brainstorm → design → plan → subagent-driven-development execution. Design doc at
`Docs/plans/2026-07-11-journal-multi-entry-design.md`, plan at
`Docs/plans/2026-07-11-journal-multi-entry-plan.md`. Each of the 8 implementation tasks
(manifest, templates, JournalDayList, JournalHubCards, JournalChromeBar, install.js migration,
command+skill, tests) ran as a dedicated implementer subagent followed by a combined
spec-compliance + code-quality review subagent — all 8 approved with no changes-requested
loops. One quality nit (compact vs expanded JSON formatting on the manifest) was fixed inline
by the controller between Task 1 and Task 2 rather than round-tripping another subagent.

## Deviations from the plan

- The manifest.json's compact single-line object style (from the implementer's literal
  transcription of the plan's spec) didn't match sticky-notes' expanded multi-line convention;
  reformatted via `json.dump(indent=2)` before continuing.
- The Task 8 test-writer had to add `global.window`/`global.customJS` stubs (mirroring
  `run-sticky-notes-chrome-bar.js`'s precedent) to the JCB-DEST assertions — the plan's literal
  test text would have thrown `ReferenceError: window is not defined` in bare Node, since
  `JournalChromeBar._resolveDay`/`destinations()` call into `window.moment`. This raised the
  chrome-bar suite from the planned 8 assertions to 10 (2 additional passing, none removed).
- `run-helper-cases.js`'s `FA4-TEMPLATES` case hardcoded the OLD `journal/templates/Today
  Journal.md` path + `type: journal` — a pre-existing fixture that didn't anticipate the
  template rename. Fixed as part of Task 9 verification (own commit, before the test-suite
  commit that introduced the structural change requiring it).
- Workshop self-install reported one pre-existing, unrelated `skip` (`project`/`wiki` depend on
  `section-explorer`, which isn't subscribed in the workshop's own
  `ranch/platform-subscription.json` — confirmed present on `origin/main` before this branch via
  `git diff --stat -- platform/ Docs/ package.json` showing zero unrelated changes). Not fixed
  in this PR — out of scope, unrelated blueprint's subscription gap.
- Branch went BEHIND `origin/main` between opening the PR and merging (2 unrelated commits
  landed, including a release-pipeline chore commit); merged `origin/main` into the branch
  (clean auto-merge, no conflicts touching journal files), re-ran full preflight green, re-ran
  CI green, then merged.

## Tests

- `npm run release:preflight` — GREEN (all harnesses, including new `run-journal-multi-entry.js`
  20/20 and rewritten `run-journal-chrome-bar.js` 10/10).
- Workshop self-install — GREEN modulo the one pre-existing unrelated `section-explorer` skip
  documented above.
- CI (`preflight (macos-latest)` + `preflight (ubuntu-latest)`) — both SUCCESS, twice (before
  and after the `origin/main` sync merge).

## Deploy

- `brew upgrade sauce` → 0.213.0.
- `sauce update --bump-pins` run against all 3 consumer vaults (cwd-scoped, per vault):
  - **accuris-sauce** — journal not subscribed, correctly skipped (`(new in workshop — not
    subscribed, skipped)`); clean run, exit 0; `spice/journal/` pre-existing but empty,
    untouched.
  - **ero-sauce** — journal 0.3.0 → 0.4.0; post-install notice fired; clean run, exit 0; no
    existing journal entries, so migration was a correct no-op (only `Journal.md` global hub
    materialized).
  - **headspace-sauce** — journal 0.3.0 → 0.4.0; post-install notice fired; clean run, exit 0;
    migration converted every pre-existing flat `Journal-YYYY-MM-DD.md` note (May/June/July
    2026 entries) into the day-folder shape — verified zero flat notes remain, day-hubs +
    `-00-00-00`-suffixed leaf entries present for every migrated day.

User must Cmd+R (or restart Obsidian) per vault to pick up the new ChromeBar/hub-cards/day-list
helpers.

## Carry-forward

- Workshop's own `ranch/platform-subscription.json` is missing `section-explorer` (mechanism
  landed v0.209.0–v0.210.1 via PR #396/#398/#399), causing `project`/`wiki` to skip during
  workshop self-install. Pre-existing, unrelated to journal — candidate for a small, separate
  fix.
- `Docs/agent-guides/cycle-status.md`'s "Current" pointer and blueprint catalogue table were
  several cycles stale (last updated at v0.208.0; v0.209.0–v0.213.0 cycles were never appended)
  before this cycle's update. Only the journal row and the Current pointer were touched here —
  backfilling the missing intermediate cycle summaries is a separate, larger cleanup task.
- No shared "day-log" mechanism was extracted (per the design doc's explicit YAGNI decision) —
  sticky-notes and journal each own their file-for-file-mirrored helpers. Revisit only if a 3rd
  consumer of this exact pattern emerges.

## Commits

Branch `worktree-bridge-cse_015Rbgos1MPm4SytuCiVp7JB`, PR #407 (squash-merged as `7440708`):
design (`9f348f7e`), plan (`b92c5ad6`), manifest (`6c523aac` + reformat `b24278d1`), templates
(`e9f325a2`), JournalDayList (`f5cd91ca`), JournalHubCards (`5b0108a7`), JournalChromeBar
(`c809f356`), install.js migration (`8f94c59a`), command+skill (`f2d5327d`), tests (`5cd16860`),
FA4 fixture fix (`314bf7b3`). Release: PR #408 (v0.212.0) → tag `v0.212.0` → tap PR #370, all
auto-merged.
