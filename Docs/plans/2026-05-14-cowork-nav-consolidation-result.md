# cowork nav consolidation — result

**Closed:** 2026-05-14
**Cycle slot:** v0.43.0 (MINOR)
**Headline:** `cowork@0.4.0 → 0.5.0` — consolidate global nav-buttons 3 → 1; This Week / This Month relocate inside `Cowork.md` as 2 of 5 BeaconCards.
**Tag:** `v0.43.0` (annotated, pushed; release.yml preflight + bump-tap fired automatically — tap PR may need manual merge per FLN-D3).
**Spec:** `Docs/plans/2026-05-14-cowork-nav-consolidation-design.md`
**Plan:** `Docs/plans/2026-05-14-cowork-nav-consolidation-plan.md`
**Handoff:** `Docs/prompts/2026-05-14-cowork-nav-consolidation-handoff.md`
**Headspace deployed:** `/Users/willfellhoelter/notes/sauce/headspace-sauce` — `cowork@0.5.0`, `contributions.cowork[].length === 1`.

## What shipped

- **One new CustomJS class** `CoworkTimeframeButtons` at `platform/blueprints/cowork/helpers/cowork-timeframe-buttons.js` (~95 lines). Renders 5 BeaconCards inside `Cowork.md`'s Timeframes section: 3 navigation cards (Daily Hub / Weekly Hub / Monthly Hub via openLinkText) + 2 create-this-period cards (This Week → / This Month → mirroring `space-nav-buttons.js:323-382` runTemplaterTemplate dispatch — Templater plugin guard, race-tolerant `createFolder`, `templater.create_new_note_from_template`, race-tolerant exists-on-create catch).
- **Cowork.md Timeframes section rewritten** from the v0.42.0 inline 3-card BeaconCards block (which silently rendered the empty-state copy due to the `items` / `titleField` / `subtitleField` / `linkField` API mismatch) to a one-line customjs-guard delegation: `await dv.view("ranch/views/customjs-guard", { class: "CoworkTimeframeButtons" });`. Net body change: -19 lines (182 → 163). Section divider above + `## Engagements + cadences` section below preserved unchanged.
- **Cowork manifest delta**: version `0.4.0 → 0.5.0` (MINOR); `nav_buttons[]` 3 → 1 (drop `cowork-weekly-this` + `cowork-monthly-this`; keep `cowork-hub` with id/icon/label/order all unchanged); `customjs_classes[]` 3 → 4 (+`CoworkTimeframeButtons`); `files[]` 36 → 37 (+`helpers/cowork-timeframe-buttons.js → {{scripts_path}}/cowork/cowork-timeframe-buttons.js`); `description` + `post_install` notice rewritten. `claude_surface[]` (41), `rule_fragments[]` (11), `depends_on` (4), `engagement_types` (3) all unchanged.
- **Workshop catalogue + lockstep bumps**: `platform/manifest.json` `workshop_version 0.42.0 → 0.43.0`; cowork blueprint catalogue row `0.4.0 → 0.5.0`; `package.json` `0.42.0 → 0.43.0` (gated by `scripts/check-version-sync.js` first step of `release:preflight`).
- **Test harness deltas**: `run-renderer.js` -2 cases (drop `R-COWORK-WEEKLY-THIS` + `R-COWORK-MONTHLY-THIS`; renderer total 39 → 37); `run-cowork-smoke.js` +12 sub-asserts (T7 = 6 covering helper + manifest registration; T8 = 3 covering Cowork.md customjs-guard delegation + absence of broken-API call; T9 = 3 covering `nav_buttons[]` shape; smoke total 102 → 114); `run-integration-smoke.js` +2 sub-asserts (registry post-bootstrap-then-reinstall has `contributions.cowork[].length === 1` + sole entry id `cowork-hub`; total 20 → 22); `run-claude-surface.js` CS-MIG-1 stale-asset bump (0.4.0 → 0.5.0 in 1 assertion + 2 subscription pins; total still 192 / 192).
- **Headspace consumer vault deployed**: subscription `cowork: 0.4.0 → 0.5.0` + `workshop_version: 0.42.0 → 0.43.0`. Reinstall via dev pantry (FLN-N5 below). Post-deploy state confirmed: `contributions.cowork[].length === 1` (entry: `cowork-hub`), `ranch/scripts/cowork/cowork-timeframe-buttons.js` materialized (4105 bytes, class + `_dispatch` + Templater invocation present), `spice/cowork/Cowork.md` body updated to the customjs-guard one-liner shape, `ranch/platform-installed.json` shows `cowork@0.5.0` installed at 2026-05-14T19:00:41Z.

## Stage commits (origin/main)

- T1 `3aa7b4b` feat(cowork): v0.43.0 T1 — author CoworkTimeframeButtons helper
- T2 `f761442` feat(cowork): v0.43.0 T2 — Cowork.md Timeframes section delegates to CoworkTimeframeButtons
- T3 `05f18a1` feat(cowork): v0.43.0 T3 — manifest delta cowork@0.4.0 → 0.5.0 MINOR
- T4 `890c28a` test(renderer): v0.43.0 T4 — drop 2 cowork runTemplaterTemplate cases
- T5 `66e9bd9` test(cowork-smoke): v0.43.0 T5 — add T7/T8/T9 nav-consolidation asserts
- T6 `10e5010` test(integration-smoke): v0.43.0 T6 — assert cowork nav contribution = 1
- T7 `609ffe1` chore(release): v0.43.0 — workshop_version + package.json lockstep + CS-MIG-1 bump

Tag: `v0.43.0` annotated.

## Whole-suite delta (final)

| Harness | Before (post-v0.42.0) | After (post-v0.43.0) | Notes |
|---|---|---|---|
| `run-claude-surface.js` | 192 / 0 | 192 / 0 | unchanged count; CS-MIG-1's hardcoded cowork-version bumped 0.4.0 → 0.5.0 (1 assertion + 2 subscription pins) |
| `run-helper-cases.js` | 635 | 635 | unchanged (TW1 lint auto-validated the new helper file with no explicit asserts added) |
| `run-renderer.js` | 39 cases | 37 cases | -2 (R-COWORK-WEEKLY-THIS + R-COWORK-MONTHLY-THIS dropped) |
| `run-audit.js` | 89 | 89 | unchanged |
| `run-cowork-smoke.js` | 102 | 114 | +12 (T7 = 6, T8 = 3, T9 = 3) |
| `run-integration-smoke.js` | 20 | 22 | +2 (smoke-cowork-nav-contributions-length-1 + smoke-cowork-nav-only-cowork-hub) |
| `run-bootstrap.js` | 58 | 58 | unchanged |
| `run-cli.js` | 100 | 100 | unchanged |
| `run-migrate.js` | 104 | 104 | unchanged |
| `run-migrate-layout.js` | 18 | 18 | unchanged |
| `run-registry.js` | 18 | 18 | unchanged |
| `run-doctor-self.js` | 3 | 3 | unchanged |
| `run-install-sh.js` | 5 | 5 | unchanged |
| `run-seed.js` | 31 | 31 | unchanged |

Whole-suite total post-cycle: **roughly +12 sub-asserts net** vs v0.42.0 baseline (net of the renderer −2 + cowork-smoke +12 + integration-smoke +2). Preflight green: `npm run release:preflight` exits 0 across all 14 harnesses.

## Cycle pacing

Subagent-driven for T1-T6 (each task dispatched as a fresh implementer subagent with full task text + scene-setting context; T1 received full two-stage review for the new file body; T2-T6 received combined-review per the workshop's documented combined-review shortcut for low-blast-radius transcription). Controller-direct for T7 (release tag) + T8 (cross-vault deploy). All 6 implementer dispatches reported DONE on first attempt; 0 BLOCKED, 0 NEEDS_CONTEXT, 0 spec-review or code-quality-review re-review loops triggered. Each commit pushed to origin/main per the workshop's single-branch convention.

## FIX-LATER-NOTEs

Five new notes; the first 4 were forecast in the design doc, the 5th surfaced during T8 deploy:

- **FLN-N1: existing 3 cowork hub-card helpers + the v0.42.0 inline Timeframes block call BeaconCards with the wrong API.** Pre-existing v0.42.0 bug, NOT introduced by this cycle. The 3 hub-card helpers (`cowork-{daily,weekly,monthly}-hub-cards.js`) call `BeaconCards.render(dv, { items, titleField, subtitleField, linkField })` but the actual mechanism API reads `{ pages, title, subtitle, target }` (see `platform/mechanisms/cards/beacon-cards.js:42-65`). Result: the 3 sub-hubs (`Daily Hub.md`, `Weekly Hub.md`, `Monthly Hub.md`) silently render the empty-state copy instead of card lists. Discoverable only by opening one of the sub-hubs in Obsidian. **Proposed cycle shape:** PATCH on cowork (`cowork@0.5.0 → 0.5.1`) — translate the 3 helpers to the correct API + add a unit-style assertion in `run-helper-cases.js` that scans helper bodies for the canonical BeaconCards call shape. Standalone, ~3 file edits + ~1 test assertion. The v0.43.0 Timeframes section uses the correct API; my replacement repaired one of the four broken call sites by deleting the inline call.
- **FLN-N2: workshop subscription doesn't include cowork.** Re-confirmation of FLN-1 from v0.42.0 result. Means the workshop never dogfoods cowork via `sauce reinstall --vault $PWD`. Acceptable for now; tmp-vault harnesses (`run-cowork-smoke`, `run-integration-smoke`) cover the install path.
- **FLN-N3: `_resolveActionDate` not mirrored.** `CoworkTimeframeButtons` always uses today as the action date. The renderer's `_resolveActionDate` (which lets you click nav-buttons on a future-dated daily note to prep that future-period's note) is not mirrored in the helper. Acceptable per the design rationale — `Cowork.md` has no date in its filename. If a future cycle wants future-date prep from inside a hub, add it as an opt-in.
- **FLN-N4: 2 removed nav-buttons leave stale entries in any pre-v0.5.0 vault's `nav-buttons-registry.json` until reinstall.** The installer regenerates the registry from the current manifest on each install. Once reinstall runs, the 2 stale entries disappear. No data migration; bump the subscription pin + reinstall.
- **FLN-N5 (new — T8 deploy-surfaced): brew tap PR for v0.43.0 hadn't auto-merged at deploy time.** The brew-installed sauce CLI was still at v0.42.0 (Cellar/sauce/0.42.0/libexec) when T8 deploy started. Headspace's `platform-config.json` pointed at `/opt/homebrew/opt/sauce/libexec` per the v0.42.0-era FLN-D1 fix, so the initial `sauce reinstall` saw a workshop manifest with `cowork@0.4.0` while the subscription pinned `cowork@0.5.0` → `[Notice] platformInstall: skipping cowork — subscription pins cowork@0.5.0 but workshop has 0.4.0`. **Workaround used in T8:** `sauce link /Users/willfellhoelter/projects/repos/sauce` (active-pantry symlink to the dev repo) + temporarily edit headspace's `platform-config.json` `workshop_relative_path` to `/Users/willfellhoelter/projects/repos/sauce`, then `sauce reinstall`, then restore both (config back to brew path, `sauce unlink`). Deploy completed cleanly via the dev pantry. **Permanent fix:** merge the auto-opened tap PR `willfell/homebrew-sauce` (numbered after #18 from v0.42.0; check `gh pr list --repo willfell/homebrew-sauce --state open` to find it), then `brew update && brew upgrade sauce` on this machine. Once that lands, future `sauce reinstall --vault <headspace>` works through the brew path without the dev-pantry detour. This is the same FLN-D3 issue from the v0.42.0 deploy, still unresolved as of v0.43.0 close.

## What this enables for follow-on cycles

- **FLN-N1 fix (cowork@0.5.1).** Once the 3 sub-hub helpers are repaired, the Daily / Weekly / Monthly Hub cards actually render their card lists. Combined with this cycle's Timeframes block fix, the entire cowork hub-and-spoke navigation surface becomes fully functional in real vaults.
- **Pattern for other blueprints with global nav-button bloat.** If daily / project / scratch grow more global nav-buttons in future cycles, they can adopt this pattern: keep one `<blueprint>-hub` global button; move sub-actions inside the blueprint's hub note via a per-blueprint `<Blueprint>TimeframeButtons`-style helper (or inline dataviewjs for trivial cases). The sauce nav-bar real estate is preserved.
- **runTemplaterTemplate centralization.** If the duplicated logic in `CoworkTimeframeButtons._dispatch` ever needs to be shared across multiple blueprints' in-hub create-cards, promoting Route 2 → Route 1 (extend BeaconCards or accent-button to accept `runTemplaterTemplate` actions natively) is a small additive cycle on the cards mechanism.
- **Tap auto-merge fix (FLN-D3 from v0.42.0 + FLN-N5 from this cycle).** Two consecutive deploys have hit the same friction (brew tap PR opens but doesn't auto-merge). A standalone PATCH on `.github/workflows/release.yml` (add `--auto-merge` to the `peter-evans/create-pull-request@v6` action, or add an auto-merge GitHub action on the `homebrew-sauce` repo) would eliminate this friction permanently.

## User-facing testing checklist (for in-Obsidian smoke validation against headspace)

After opening Obsidian against `/Users/willfellhoelter/notes/sauce/headspace-sauce`, work through these checks. They mirror the v0.42.0 deploy testing checklist's shape.

### 1. Global nav-bar shape

- [ ] Open ANY note in the vault (e.g., today's daily note).
- [ ] Look at the global nav-button row at the top of the pane.
- [ ] Confirm the cowork contribution is exactly **one** button labeled `Cowork` with the `users-round` icon. The `This Week` and `This Month` buttons from v0.42.0 should NOT appear anywhere.
- [ ] Other blueprint contributions (Daily, Project actions, Scratch, etc.) still appear normally.

### 2. Cowork hub navigation

- [ ] Click `Cowork` in the global nav-bar.
- [ ] Confirm Obsidian opens `spice/cowork/Cowork.md`.
- [ ] Confirm the scaffold-status callout (top of the file) renders correctly. If you've already bootstrapped + scaffolded timeframes, no warning callout should appear; otherwise expect a `> [!warning]+ Cowork scaffold incomplete` callout listing what's missing.
- [ ] Confirm the abstract callout below the scaffold-status block renders.
- [ ] Below the `---` divider, confirm the `## Timeframes` heading appears.

### 3. Timeframes 5-card row

- [ ] Confirm 5 cards render under the `## Timeframes` heading, in a single row (or wrapping to a second row on a narrow pane). Reading left-to-right, the cards should be:
  1. **Daily Hub** — subtitle "Card index of dailies"
  2. **Weekly Hub** — subtitle "Card index of weekly notes"
  3. **This Week →** — subtitle `Open or create 2026-W20.md` (or whatever the current ISO week label is)
  4. **Monthly Hub** — subtitle "Card index of monthly notes"
  5. **This Month →** — subtitle `Open or create 2026-05.md` (or whatever the current `YYYY-MM` label is)
- [ ] Cards have hover states (background tint + border accent + slight lift).

### 4. Navigation cards (3 of 5)

- [ ] Click `Daily Hub` card → Obsidian opens `spice/cowork/Daily Hub.md`.
- [ ] Click back to Cowork (via global nav-bar `Cowork` button or breadcrumb).
- [ ] Click `Weekly Hub` card → opens `spice/cowork/Weekly Hub.md`.
- [ ] Click back to Cowork.
- [ ] Click `Monthly Hub` card → opens `spice/cowork/Monthly Hub.md`.
- [ ] **Note (cosmetic — FLN-N1):** the 3 sub-hubs themselves currently render the empty-state copy ("No daily notes yet" / "No weekly notes yet" / "No monthly notes yet") even when notes exist, because of a pre-existing v0.42.0 bug where the 3 sub-hub helpers call BeaconCards with the wrong API contract. NOT a v0.43.0 regression; will be fixed in `cowork@0.5.1`.

### 5. Create-this-period cards (2 of 5)

- [ ] Click back to Cowork.
- [ ] Click `This Week →` card.
  - If `spice/cowork/weekly/2026/2026-W20.md` (or current ISO week) doesn't exist yet: Templater creates it from `ranch/templates/Weekly Note.md` and opens it. Verify frontmatter has `week_label`, `week_start`, `week_end`, `created` populated correctly.
  - If it already exists: Templater skips creation; the card just opens the existing note.
- [ ] Click back to Cowork.
- [ ] Click `This Month →` card.
  - Same behavior as `This Week →` but for `spice/cowork/monthly/2026/2026-05.md` from `ranch/templates/Monthly Note.md`.
- [ ] If you previously created weekly / monthly notes via the deleted v0.4.0 nav-buttons (e.g., `spice/cowork/weekly/2026/2026-W19.md` from a prior week), confirm those notes still open correctly when navigated to via the Weekly Hub card list (path conventions unchanged — existing notes stay in place).

### 6. Templater plugin guard

- [ ] (Optional defensive check) If you ever disable the Templater plugin in headspace, clicking `This Week →` or `This Month →` should produce an obvious in-Obsidian Notice: `cowork-timeframe-buttons: Templater plugin not enabled` (8000ms toast). Re-enable Templater before continuing real work.

### 7. Persistence of other Cowork.md sections

- [ ] Confirm the section divider (`---`) above `## Timeframes` is preserved.
- [ ] Confirm the `## Engagements + cadences` section below renders with its bootstrap-engagement-table markers + the dataviewjs last-run block.
- [ ] Confirm the `## Skills`, `## Context`, and `## Getting started` sections at the bottom of the file are unchanged from v0.42.0.

### 8. Backup files

- [ ] Confirm `spice/cowork/Cowork.md.bak` exists alongside `Cowork.md` (the installer's pre-overwrite backup; safe to delete after this checklist passes). The pre-existing `spice/cowork/Cowork.md.user-backup-2026-05-14` from the v0.42.0 deploy also stays unless you've already cleaned it up.

If anything in this checklist FAILS, capture the failing step + a brief description (what you saw vs. what was expected) and report back. The most likely failure modes are: (a) Templater not enabled (Notice toast), (b) the `ranch/templates/Weekly Note.md` or `ranch/templates/Monthly Note.md` template being missing or malformed (would also produce a Notice with the path), (c) Obsidian needing a refresh / Cmd+R after install for the new CustomJS class to register.
