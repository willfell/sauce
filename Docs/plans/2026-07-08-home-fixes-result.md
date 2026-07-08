# Home fixes + nav — result

- **Date:** 2026-07-08
- **Version:** pipeline-assigned (`home 0.4.1 → 0.4.2`, `daily 0.18.2 → 0.18.3`, workshop `0.201.4`)
- **Branch:** `worktree-bridge-cse_01Lbmv3dkznWzkbEURyLQ8WK` (PR #355, squash-merged)
- **Scope:** five small, user-reported defects/gaps in the `home`/`to-do`/`daily` surfaces. Design + plan docs written up front (`2026-07-08-home-fixes-{design,plan}.md`); executed via subagent-driven development, one implementer + one combined spec/quality reviewer per task.

## What shipped

1. **Fix: to-do page "New Task" never showed in the daily.** `todo-chrome-bar.js`'s New Task dispatch on the daily to-do page passed `surface: "today"` to `TaskDialog.open()` — an unrecognized surface that `defaultsForSurface()` silently treated as `manual`/no-scheduled-date, so the created task was excluded from Today. Changed to `surface: "daily"` (what `defaultsForSurface` actually implements). A concurrent, independent cycle (PR #353, merged just ahead of this one) found and fixed the identical bug from the other direction (adding a contract test) — the merge combined cleanly, both fixes agree.
2. **Fix: Home's Enter-key quick-capture didn't submit.** The wiring was logically correct in an isolated DOM-stub test; hardened defensively by adding `stopPropagation()` alongside the existing `preventDefault()`, in case a higher-level (Obsidian/document) keydown listener was racing the same event.
3. **Fix (best-effort mitigation): Home's ~3s load flash + pane widening.** No live Obsidian session was available to interactively reproduce the exact cause. Applied the most likely, non-regressive mitigation: `SpaceHome.render()` now defers its FIRST paint per app session to `workspace.onLayoutReady`, avoiding a race with Obsidian's own layout/cssclass settling on a cold launch. Flagged in the design doc and PR as a mitigation, not a confirmed root-cause fix — worth a user check-in after deploy.
4. **Feat: `Cmd+[` now opens Home instead of the daily note.** New `HomeCommandsInit` customJS class (mirrors `ProjectCommandsInit`) registers a `sauce-home:open` command. `daily`'s manifest no longer seeds `daily-notes`/`Mod+[` for brand-new installs; `home`'s manifest seeds `sauce-home:open`/`Mod+[` instead. For the 4 already-installed vaults (workshop + accuris + ero + headspace), a new idempotent heal `applyHomeHotkeyRemapHeal` (backed by pure `_planHomeHotkeyRemap`) moved the existing `Mod+[` binding from `daily-notes` to `sauce-home:open` in `.obsidian/hotkeys.json`, preserving any other `daily-notes` binding — verified live in all 4 vaults.
5. **Feat: "‹ Yesterday" nav button on Home.** New pure `SpaceHome._previousDailyPath(today, config)` (reuses the file's existing Hinnant day-math) computes the actual previous day's daily-note path; a new header button opens it via `openLinkText` if it exists, or shows a `Notice` (never creates a file) if it doesn't. Home itself stays pinned to today — this is pure navigation, not a re-render.

## Process note (caught mid-cycle, corrected)

The implementation plan's Task 4b instructed hand-bumping the `home`/`daily` manifest `version` fields and the `component-versions.snapshot.json` test fixture — a direct violation of this workshop's non-negotiable rule that the automated release bumper, not Claude, computes and writes every version record. Caught during the Task 4 review pass; reverted in a dedicated follow-up commit (`fix(release): revert hand-bumped manifest versions from Task 4b/4c`) before the PR was opened. **Lesson for future plans:** the writing-plans skill's "bump the version" instinct (reasonable in a generic codebase) must never be applied to a manifest/package version in this workshop — see `Docs/agent-guides/build-test-verify.md` § Release workflow.

## Verification

- `node platform/test/run-task-entity.js` — 127/127 (includes the concurrent cycle's overlapping fix + tests, merged cleanly).
- `node platform/test/run-home.js` — 127/127 (`HOME-CAP-21b`, `HOME-READY-1/2/3`, `HOME-CMD-1..6`, `HOME-HOTKEY-0..7`, `HOME-PREV-1..4`, `HOME-PREV-BTN-1..4` all new).
- `npm run lint-schemas` — 0 issues.
- `npm run release:preflight` — exit 0, twice (once pre-merge, once after merging a concurrent main-branch cycle mid-flight).
- Workshop self-install dogfood — exit 0; confirmed the hotkey heal correctly moved `Mod+[` from `daily-notes` to `sauce-home:open` on the workshop's own vault. (The dogfood run also surfaced a large amount of pre-existing, unrelated `ranch/`/`.obsidian` drift in this worktree from blueprints never previously dogfooded there — reverted, out of scope for this cycle, not committed.)
- CI (PR #355): `preflight (macos-latest)`, `preflight (ubuntu-latest)`, CodeQL — all green.
- Release pipeline: PR #356 (`chore(release): v0.201.4`) auto-merged; tag `v0.201.4` pushed; homebrew-tap PR #349 (`sauce v0.201.4`) auto-merged — no manual merges performed on either.

## Deploy notes

`brew update && brew upgrade sauce` → 0.201.4. All three consumer vaults (`accuris-sauce`, `ero-sauce`, `headspace-sauce`) resolve `workshop_relative_path` to the brew bottle (not a local clone, contrary to `vault-paths.md`'s "canonical on this machine" note — that doc is stale on this point). `sauce update --bump-pins` run in each; all reported `drift: none`. Verified directly in each vault's materialized files: the `todo-chrome-bar.js` surface fix, the `space-home.js` `sauce-home-prev-day` button + `__sauceHomeLayoutReady` gate, the new `home-commands-init.js` file, and the `hotkeys.json` remap (`sauce-home:open` → `Mod+[`, `daily-notes` → `[]`) are all present in all three vaults.

**User action required per vault:** Cmd+R (or a full restart if Cmd+R doesn't pick up the new customJS class) to load `HomeCommandsInit` and the updated `SpaceHome`/`ToDoChromeBar` classes. The hotkey change takes effect from the rewritten `hotkeys.json` — restart Obsidian if `Cmd+[` doesn't immediately open Home.

## Carry-forward

- Item #3 (load flash + pane widening) is a best-effort mitigation, not a confirmed fix — worth a follow-up check with the user after they've used it a few days.
- The `daily-notes:goto-today` (`Mod+T`) binding was intentionally left untouched, per the design doc's explicit scope.
