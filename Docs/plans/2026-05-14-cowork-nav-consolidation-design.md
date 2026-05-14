# cowork nav consolidation — design

**Date:** 2026-05-14
**Cycle:** v0.43.0 (MINOR)
**Headline blueprint:** `cowork@0.4.0 → 0.5.0` (MINOR)
**Mode:** pure-additive UX cohesion + targeted nav-button removal
**Spec author:** brainstorm session 2026-05-14
**Handoff:** `Docs/prompts/2026-05-14-cowork-nav-consolidation-handoff.md`
**Pre-cycle context:** `Docs/plans/2026-05-13-v0.42.0-result.md` + `Docs/plans/2026-05-14-v0.42.0-headspace-deploy-result.md`

## Purpose

Reduce cowork's global nav-bar footprint from 3 buttons (`Cowork` + `This Week` + `This Month`) to 1 (`Cowork`). The `This Week` + `This Month` create-this-period actions move INSIDE `spice/cowork/Cowork.md` as inline interactive cards alongside the existing Daily Hub / Weekly Hub / Monthly Hub navigation cards.

Hard UX constraint (from real-vault testing of v0.42.0): each blueprint contributes exactly ONE button to the global nav-bar. Sub-navigation belongs inside the blueprint's hub.

## Scope

In scope:
- Remove `cowork-weekly-this` + `cowork-monthly-this` from `cowork@0.5.0`'s `nav_buttons[]`. Keep `cowork-hub` (id / icon / label / order all unchanged).
- New CustomJS class `CoworkTimeframeButtons` at `platform/blueprints/cowork/helpers/cowork-timeframe-buttons.js`.
- Replace the existing 3-card inline Timeframes block in `Cowork.md` with a one-line `customjs-guard` invocation that renders 5 cards via `CoworkTimeframeButtons`: Daily Hub | Weekly Hub | This Week → | Monthly Hub | This Month → (Candidate A layout from the handoff).
- Manifest delta on cowork: version `0.4.0 → 0.5.0`, `customjs_classes[]` +1, `nav_buttons[]` -2, `files[]` +1, `description` + `post_install` rewritten.
- Workshop catalogue bump (cowork row to 0.5.0). Workshop manifest `workshop_version` `0.42.0 → 0.43.0`. `package.json` `0.42.0 → 0.43.0` (lockstep, gated by `scripts/check-version-sync.js`).
- Test harness deltas (run-renderer drops 2 cases; run-cowork-smoke + run-helper-cases small adjustments; run-integration-smoke 1 invariant updated).
- Tag `v0.43.0` annotated; release.yml preflight + bump-tap fires automatically.
- Deploy to `/Users/willfellhoelter/notes/sauce/headspace-sauce` via `sauce reinstall --vault <path>` after bumping headspace's `ranch/platform-subscription.json` cowork pin `0.4.0 → 0.5.0` + `workshop_version` pin to `0.43.0`.

Out of scope:
- The 3 existing cowork hub-card helpers (`cowork-daily-hub-cards.js`, `cowork-weekly-hub-cards.js`, `cowork-monthly-hub-cards.js`) and the v0.42.0 inline Timeframes block in `Cowork.md` all call `BeaconCards.render(dv, { items, titleField, subtitleField, linkField })`, but the actual mechanism API reads `{ pages, title, subtitle, target }` (see `platform/mechanisms/cards/beacon-cards.js:42-65`). The mismatch means the existing hubs' card lists silently render the empty-state copy. Captured below as **FLN-N1**. NOT this cycle's job to fix the 3 pre-existing helpers (separate pure-bug PATCH on cowork). My replacement Timeframes block uses the correct API; the 3 sub-hub helpers remain on the old (broken) calling convention until that PATCH lands.
- Workshop subscription does NOT include cowork (FLN-1 from v0.42.0 result; re-confirmed at brainstorm time). Workshop subscription stays untouched in this cycle. Dogfood path is integration-smoke + cowork-smoke harnesses (which provision tmpdir vaults that DO subscribe to cowork) + manual Obsidian smoke against headspace post-deploy.
- FLN-D1..D4 from `2026-05-14-v0.42.0-headspace-deploy-result.md` are explicitly NOT addressed here. FLN-D2 (audit YAML parser inline-flow blindness) will continue to false-positive on the cowork hub notes during preflight + headspace audit; ignored, same as v0.42.0.
- No changes to `/cowork`, `/weekly`, `/monthly` slash commands; no changes to claude_surface[] entries; no changes to rule_fragments[].

## Architecture

No new mechanisms. No installer changes. Pure blueprint authoring on cowork.

**The single wire:** the global nav-buttons-registry loses 2 cowork entries (`cowork-weekly-this`, `cowork-monthly-this`); `cowork-hub` stays. After `sauce reinstall` regenerates `<vault>/ranch/nav-buttons-registry.json` from the new manifest, the global nav-bar's cowork contribution shrinks from 3 → 1. The behavior the 2 deleted buttons provided (open-or-create this-period's note via Templater) re-materializes inside `Cowork.md` as 2 of 5 BeaconCards with custom `onClick` handlers.

**One new file:** `platform/blueprints/cowork/helpers/cowork-timeframe-buttons.js`. Class `CoworkTimeframeButtons`. Materialized via `files[]` to `{{scripts_path}}/cowork/cowork-timeframe-buttons.js`. Registered via the new `customjs_classes[]` entry. Sits alongside the 3 existing cowork hub-card helpers in the same `helpers/` directory.

**The class:** ~80-100 lines. Single public method `render(dv, opts)`. Internally:
1. Honors BeaconCards' embed-dedup pattern: `if (dv.container.closest(".markdown-embed")) return;` — so embedding `Cowork.md` via `![[Cowork]]` in another note doesn't double-render the Timeframes block.
2. Builds 5 synthetic-page items with `file: { name, path }` shape + per-item `_kind` + `_subtitle` + (for create-cards) `_templateSource` / `_folder` / `_filenameNoExt` metadata.
3. Computes today's `isoWeekLabel` (`YYYY-Www`), `monthLabel` (`YYYY-MM`), `year` (`YYYY`) via `window.moment()` at render time.
4. Calls `BeaconCards.render(dv, { pages, title, subtitle, target, onClick, columns: "auto" })`. Three of the 5 items default through to `app.workspace.openLinkText(targetFn(page), "")` (BeaconCards' default click behavior). Two of the 5 (`This Week →`, `This Month →`) override via `onClick` — runs the runTemplaterTemplate-equivalent: Templater plugin guard, `getAbstractFileByPath(target)` exists-check (open if exists), race-tolerant `createFolder`, `templater.create_new_note_from_template(templateFile, folder, filenameNoExt, true)`. Logic mirrored from `space-nav-buttons.js:323-382`.
5. Falls back to a markdown bullet list if `window.customJS.BeaconCards` is undefined (cards mechanism not installed). Mirrors the fallback pattern in `cowork-weekly-hub-cards.js`.

**Why `customjs-guard` invocation in Cowork.md instead of direct `customJS.X.render`:**
- Honors landmines #1–#5 (every Dataview view goes through customjs-guard). Consistent with how the 3 sub-hub notes invoke their helpers (`Daily Hub.md`'s body is `await dv.view("ranch/views/customjs-guard", { class: "CoworkDailyHubCards" })`).
- One-line delegation; zero in-markdown logic; class-load retry + double-render guard handled by customjs-guard.

**Why mirror runTemplaterTemplate logic instead of extending the cards mechanism:**
- The handoff's Route 1 (extend BeaconCards / accent-button to accept `runTemplaterTemplate` actions) touches a shared mechanism with 7+ consumers; bigger blast radius for a UX-cohesion cycle.
- The handoff's Route 3 (Templater command + dataviewjs button) requires Templater "configured templates" registration the installer would need to write; less self-contained.
- Route 2 (this design) keeps cowork-local. Duplicated logic is small (~30 lines) and bounded. If the runTemplaterTemplate semantics ever need centralizing (e.g., date-pattern handling changes), promoting Route 2 → Route 1 is a one-stage refactor.

**Why omit `_resolveActionDate` (future-date-from-active-file):**
- The renderer's `_resolveActionDate` (space-nav-buttons.js:49-58) lets users click nav-buttons on a future-dated daily note to prep that future-period's note. Useful in the global nav-bar; less relevant for cards inside `Cowork.md` which has no date in its filename. The new cards always use today.
- Dropping this means `CoworkTimeframeButtons` can't be invoked from a future-dated context to create a future weekly/monthly note. Acceptable — the global `cowork-weekly-this` / `cowork-monthly-this` nav-buttons being removed didn't carry that prep-future capability when clicked from `Cowork.md` either (they always resolved to today from a non-dated active file).

## Cowork.md rewrite

The existing Timeframes section (lines 47-69 of `platform/blueprints/cowork/content/Cowork.md`) gets replaced. The scaffold-status callout above it (lines 8-38) and everything below the section divider (Engagements + cadences, Skills, Context, Getting started) is untouched.

**Before** (3-card inline block calling BeaconCards with the wrong API → renders empty-state):

````markdown
## Timeframes

```dataviewjs
const subs = [
  { name: "Daily Hub",   path: "spice/cowork/Daily Hub.md",   blurb: "Card index of dailies (spice/daily/**/*.md)" },
  { name: "Weekly Hub",  path: "spice/cowork/Weekly Hub.md",  blurb: "Card index of weekly notes (spice/cowork/weekly/)" },
  { name: "Monthly Hub", path: "spice/cowork/Monthly Hub.md", blurb: "Card index of monthly notes (spice/cowork/monthly/)" }
];
const cardItems = subs.map(s => ({
  file: { name: s.name, path: s.path, mtime: null },
  _blurb: s.blurb
}));
if (typeof window.customJS !== "undefined" && window.customJS.BeaconCards) {
  await window.customJS.BeaconCards.render(dv, {
    items: cardItems,
    titleField: p => p.file.name,
    subtitleField: p => p._blurb,
    linkField: p => p.file.path
  });
} else {
  for (const s of subs) dv.paragraph(`- [[${s.path}|${s.name}]] — ${s.blurb}`);
}
```
````

**After** (one-line customjs-guard delegation):

````markdown
## Timeframes

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "CoworkTimeframeButtons" });
```
````

Net body change: ~22 lines removed, 3 lines added. Section divider (`---`) stays; section heading `## Timeframes` stays.

**Visible effect after install:** the Cowork.md hub renders the scaffold-status callout (unchanged), then the abstract callout (unchanged), then the divider, then `## Timeframes`, then a row of 5 BeaconCards rendered by `CoworkTimeframeButtons`. The 2 deleted global nav-buttons stop appearing in the global nav-bar after `sauce reinstall` regenerates `ranch/nav-buttons-registry.json` from the new manifest.

## CoworkTimeframeButtons helper (full body)

File: `platform/blueprints/cowork/helpers/cowork-timeframe-buttons.js`. Materialized to `{{scripts_path}}/cowork/cowork-timeframe-buttons.js`.

```js
/**
 * CoworkTimeframeButtons (CustomJS)
 * Renders the inline Timeframes block on spice/cowork/Cowork.md.
 *
 * Five cards in one row (Candidate A from the v0.43.0 design):
 *   Daily Hub | Weekly Hub | This Week → | Monthly Hub | This Month →
 *
 * Behaviour:
 *   - 3 navigation cards default through BeaconCards' openLinkText to the hub.
 *   - 2 create-this-period cards mirror nav-buttons' runTemplaterTemplate
 *     semantics: if this-period's note exists, open it; otherwise Templater-create
 *     from ranch/templates/{Weekly Note,Monthly Note}.md, then open.
 *
 * Mirrors space-nav-buttons.js:323-382 (runTemplaterTemplate dispatch).
 */
class CoworkTimeframeButtons {
  async render(dv, opts) {
    if (dv.container.closest(".markdown-embed")) return;
    while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

    const now = window.moment();
    const year = now.format("YYYY");
    const isoWeekLabel = now.format("YYYY-[W]ww");
    const monthLabel   = now.format("YYYY-MM");

    const items = [
      { _kind: "openLink",      file: { name: "Daily Hub",    path: "spice/cowork/Daily Hub.md"   }, _subtitle: "Card index of dailies" },
      { _kind: "openLink",      file: { name: "Weekly Hub",   path: "spice/cowork/Weekly Hub.md"  }, _subtitle: "Card index of weekly notes" },
      { _kind: "createWeekly",  file: { name: "This Week →",  path: `spice/cowork/weekly/${year}/${isoWeekLabel}.md` }, _subtitle: `Open or create ${isoWeekLabel}.md`, _templateSource: "ranch/templates/Weekly Note.md", _folder: `spice/cowork/weekly/${year}`, _filenameNoExt: isoWeekLabel },
      { _kind: "openLink",      file: { name: "Monthly Hub",  path: "spice/cowork/Monthly Hub.md" }, _subtitle: "Card index of monthly notes" },
      { _kind: "createMonthly", file: { name: "This Month →", path: `spice/cowork/monthly/${year}/${monthLabel}.md` }, _subtitle: `Open or create ${monthLabel}.md`, _templateSource: "ranch/templates/Monthly Note.md", _folder: `spice/cowork/monthly/${year}`, _filenameNoExt: monthLabel }
    ];

    if (typeof window.customJS === "undefined" || !window.customJS.BeaconCards) {
      for (const it of items) dv.paragraph(`- [[${it.file.path}|${it.file.name}]] — ${it._subtitle}`);
      return;
    }

    await window.customJS.BeaconCards.render(dv, {
      pages: items,
      title: (p) => p.file.name,
      subtitle: (p) => p._subtitle,
      target: (p) => p.file.path,
      onClick: (p) => this._dispatch(p),
      columns: "auto"
    });
  }

  async _dispatch(item) {
    if (item._kind === "openLink") {
      app.workspace.openLinkText(item.file.path, "");
      return;
    }

    const existing = app.vault.getAbstractFileByPath(item.file.path);
    if (existing) {
      app.workspace.openLinkText(item.file.path, "");
      return;
    }

    const tpPlugin = app.plugins.plugins["templater-obsidian"];
    if (!tpPlugin || !tpPlugin.templater) {
      new Notice("cowork-timeframe-buttons: Templater plugin not enabled", 8000);
      return;
    }

    if (!app.vault.getAbstractFileByPath(item._folder)) {
      try {
        await app.vault.createFolder(item._folder);
      } catch (folderErr) {
        if (!/already exists|exists/i.test((folderErr && folderErr.message) || "")) {
          new Notice(`cowork-timeframe-buttons: cannot create folder ${item._folder} — ${folderErr.message}`, 8000);
          return;
        }
      }
    }

    const templateFile = app.vault.getAbstractFileByPath(item._templateSource);
    if (!templateFile) {
      new Notice(`cowork-timeframe-buttons: template not found at ${item._templateSource}`, 8000);
      return;
    }

    try {
      await tpPlugin.templater.create_new_note_from_template(templateFile, item._folder, item._filenameNoExt, true);
    } catch (err) {
      const msg = (err && err.message) || "";
      if (!/already exists|exists/i.test(msg)) {
        new Notice(`cowork-timeframe-buttons: Templater create failed for ${item.file.path} — ${msg}`, 8000);
        return;
      }
      app.workspace.openLinkText(item.file.path, "");
    }
  }
}
```

## Manifest delta (`cowork@0.4.0 → 0.5.0`)

| Field | Before (0.4.0) | After (0.5.0) |
|---|---|---|
| `version` | `"0.4.0"` | `"0.5.0"` |
| `description` | mentions 3 nav-buttons | rewritten — 1 global nav-button (`cowork-hub`); inline Timeframes block in Cowork.md provides the 5-card surface (3 navigate + 2 create-this-period) |
| `customjs_classes` | `[CoworkDailyHubCards, CoworkWeeklyHubCards, CoworkMonthlyHubCards]` (3) | `[CoworkDailyHubCards, CoworkWeeklyHubCards, CoworkMonthlyHubCards, CoworkTimeframeButtons]` (4) |
| `nav_buttons` | 3 entries (`cowork-hub`, `cowork-weekly-this`, `cowork-monthly-this`) | 1 entry (`cowork-hub` only — id/icon/label/order all unchanged) |
| `files[]` | 36 entries | 37 entries (+1: `helpers/cowork-timeframe-buttons.js` → `{{scripts_path}}/cowork/cowork-timeframe-buttons.js`) |
| `claude_surface[]` | 41 entries | 41 entries (no entries reference the removed buttons) |
| `rule_fragments[]` | 11 entries | 11 entries (no fragments reference the removed buttons) |
| `depends_on` | 4 entries | 4 entries (unchanged) |
| `engagement_types` | 3 entries | 3 entries (unchanged) |
| `post_install` | mentions 3 nav-buttons | rewritten — 1 global nav-button + Timeframes section at top of Cowork.md; This Week / This Month live as cards inside the hub |

Existing 36 `files[]` entries unchanged. Existing 41 `claude_surface[]` entries unchanged. Existing 11 `rule_fragments[]` entries unchanged.

## Workshop self-install side effects

Per FLN-1 (re-confirmed at brainstorm time), the workshop's `ranch/platform-subscription.json` does NOT include cowork. Workshop self-install (`sauce reinstall --vault $PWD`) will not materialize any cowork artifacts. Dogfood path:
- `run-cowork-smoke.js` provisions a tmp test vault, subscribes to cowork, runs install, asserts the new manifest shape + helper materialization + Cowork.md body string. Equivalent to a self-install for the cowork blueprint.
- `run-integration-smoke.js` provisions a tmp vault, runs `sauce bootstrap` with `--mechanisms=all` then a follow-up reinstall that includes cowork, asserts `contributions.cowork[].length === 1`.
- Manual Obsidian smoke: against `/Users/willfellhoelter/notes/sauce/headspace-sauce` after S6 deploy.

## Versioning lockstep

- `cowork@0.4.0 → 0.5.0` (MINOR — pure-additive UX cohesion + targeted nav-button removal).
- `platform/manifest.json`:
  - `workshop_version` `0.42.0 → 0.43.0` (MINOR — cowork minor cascades).
  - `date` `2026-05-13 → 2026-05-14`.
  - Blueprint catalogue: cowork row bumped to `0.5.0`.
- `package.json` `0.42.0 → 0.43.0` (gated as the first step of `release:preflight` by `scripts/check-version-sync.js`).
- `ranch/platform-subscription.json`: NOT bumped (workshop doesn't subscribe to cowork; pre-existing `workshop_version: 0.41.5` skew per FLN-2 also stays — out of scope this cycle).
- `ranch/platform-installed.json` (workshop): no cowork delta to install.
- `Formula/sauce.rb` in `willfell/homebrew-sauce`: bumped automatically by release.yml's bump-tap job on `v0.43.0` tag push (per FLN-D3 the resulting tap PR may need manual merge until D3 ships).

## Headspace consumer subscription delta

Applied at S6 (deploy stage), NOT at S5 (workshop close):

In `/Users/willfellhoelter/notes/sauce/headspace-sauce/ranch/platform-subscription.json`:
- `blueprints.cowork`: `0.4.0 → 0.5.0`
- `workshop_version`: `0.42.0 → 0.43.0`

All other pins on headspace stay at v0.42.0 levels (no other blueprint or mechanism changes this cycle). After the subscription edit:
```
sauce reinstall --vault /Users/willfellhoelter/notes/sauce/headspace-sauce
```
Expected install side effects (post-install):
- `<headspace>/spice/cowork/Cowork.md` — overwritten with new body (`.bak` written by installer; pre-existing `.user-backup-2026-05-14` from v0.42.0 deploy stays).
- `<headspace>/ranch/scripts/cowork/cowork-timeframe-buttons.js` — new file.
- `<headspace>/ranch/nav-buttons-registry.json` — `contributions.cowork[]` shrinks 3 → 1 (only `cowork-hub`).
- `<headspace>/ranch/platform-installed.json` — version + file inventory updated.

## Test harness deltas

| Harness | Before (post-v0.42.0) | After (post-v0.43.0) | Delta detail |
|---|---|---|---|
| `run-cowork-smoke.js` | 102 | ~100 | -3 asserts for the 2 removed nav-buttons + their composed paths; +1 for `customjs_classes[]` includes `CoworkTimeframeButtons`; +2 for helper source file exists + `class CoworkTimeframeButtons` declaration; +2 for `Cowork.md` body contains `## Timeframes` heading + the customjs-guard one-liner with `class: "CoworkTimeframeButtons"` |
| `run-renderer.js` | 39 cases | 37 cases | drop `R-COWORK-WEEKLY-THIS` + `R-COWORK-MONTHLY-THIS` (the 2 removed nav-buttons no longer compose). Keep `R-COWORK-HUB` |
| `run-helper-cases.js` | 635 | ~640 | TW1 trailing-whitespace lint auto-picks up the new helper file (+1 from the asset itself); explicit asserts for new helper: file exists, class-name match, customjs-guard wrap convention (no top-level side effects), `_dispatch` method present (+5 to +6) |
| `run-integration-smoke.js` | 20 | ~19 | adjust the post-bootstrap-then-reinstall assertion: `contributions.cowork[].length === 1` (was `=== 3`); 3 hub-note materialization asserts stay |
| `run-claude-surface.js` | 192 | 192 | unchanged — no claude_surface entries reference the removed buttons |
| `run-audit.js` | 89 | 89 | unchanged — no rule_fragments reference the removed buttons |
| `run-bootstrap.js` `run-cli.js` `run-migrate.js` `run-seed.js` `run-claude-surface.js` `run-audit.js` `run-doctor-self.js` `run-install-sh.js` `run-migrate-layout.js` `run-registry.js` `run-seed.js` | unchanged | unchanged | |

**Whole-suite total post-cycle:** roughly **~1280 sub-asserts + 37 renderer cases** (vs v0.42.0's ~1280 + 39). Dip is dominated by the renderer drop. `npm run release:preflight` gates the full suite with version-sync first + (on macOS) brew-install-smoke.

## Implementation stages (preview — full breakdown lives in the plan doc)

Roughly **6 stages** — single-controller cadence (no subagent dispatch) given the small scope, deterministic transcription, and that the helper body is fully specified in this design doc. Per-stage commit + push to origin/main (sauce convention).

- **S1 — New helper file.** Author `platform/blueprints/cowork/helpers/cowork-timeframe-buttons.js` exactly as specified. Lint pass (no trailing whitespace, customjs-guard wrap implicit via the class declaration).
- **S2 — Cowork.md body rewrite.** Replace the existing Timeframes section (lines 47-69 of `content/Cowork.md`) with the one-line customjs-guard delegation. Keep the section heading + divider.
- **S3 — Manifest delta.** `version 0.4.0 → 0.5.0`; drop `cowork-weekly-this` + `cowork-monthly-this` from `nav_buttons[]`; add `CoworkTimeframeButtons` to `customjs_classes[]`; add `helpers/cowork-timeframe-buttons.js` `files[]` entry; rewrite `description` + `post_install` notice.
- **S4 — Test harness deltas.** run-renderer.js drops 2 cases; run-cowork-smoke.js +/- as detailed; run-helper-cases.js implicit + explicit asserts; run-integration-smoke.js invariant adjust.
- **S5 — Workshop catalogue + lockstep bumps.** `platform/manifest.json` cowork row to `0.5.0`; `workshop_version 0.42.0 → 0.43.0`; `date: "2026-05-14"`; `package.json` `0.42.0 → 0.43.0`. Run `npm run release:preflight` whole-suite green; tag `v0.43.0` annotated; push tag.
- **S6 — Headspace deploy.** Bump `<headspace>/ranch/platform-subscription.json` cowork pin `0.4.0 → 0.5.0` + workshop_version `0.42.0 → 0.43.0`. Run `sauce reinstall --vault /Users/willfellhoelter/notes/sauce/headspace-sauce`. Verify `contributions.cowork[].length === 1` + helper materialized + Cowork.md body updated. Write the result doc with user-facing testing checklist.

Cadence: controller-direct (no subagents). Deterministic transcription work; the design doc is the spec; preflight is the verification gate.

## Dogfood plan

1. After S5 commits land on origin/main, run `npm run release:preflight` from the workshop root. Expect whole-suite green.
2. Tag `v0.43.0` annotated and push the tag. release.yml preflight job runs the matrix (`macos-latest` + `ubuntu-latest`); on success, bump-tap job opens / merges the tap PR.
3. After S6 reinstall against headspace, manually open Obsidian against the headspace vault and run the testing checklist in the result doc.
4. Manual Obsidian smoke (covers system-prompt UI-change requirement):
   - Verify global nav-bar reads **Daily · Cowork** (left-to-right by order; daily-today is order 50, cowork-hub is order 51; the 2 deleted buttons no longer appear).
   - Click `Cowork` → lands on `Cowork.md`. Verify scaffold-status callout renders correctly. Verify Timeframes section renders 5 cards: Daily Hub | Weekly Hub | This Week → | Monthly Hub | This Month →.
   - Click each navigation card (Daily Hub / Weekly Hub / Monthly Hub) → lands on the respective sub-hub.
   - Click `This Week →` → if this-week's note (`spice/cowork/weekly/2026/2026-W20.md`) doesn't exist, Templater creates it from `Weekly Note.md` and opens it; if it already exists, it just opens. Verify frontmatter `week_label` / `week_start` / `week_end` populate correctly.
   - Click `This Month →` → same behavior for `spice/cowork/monthly/2026/2026-05.md` from `Monthly Note.md`.
   - Verify already-existing weekly + monthly notes (created via the deleted v0.4.0 nav-buttons) still open via the new cards (path conventions unchanged → existing notes open as-is).

## FIX-LATER-NOTE candidates

- **FLN-N1: existing 3 cowork hub-card helpers + the v0.42.0 inline Timeframes block call BeaconCards with the wrong API.** Pre-existing v0.42.0 bug, NOT introduced by this cycle. Files: `cowork-{daily,weekly,monthly}-hub-cards.js` + the `Cowork.md` Timeframes inline block (which v0.43.0 deletes; that's the only repair this cycle does for the bug class). The 3 hub-card helpers call `BeaconCards.render(dv, { items, titleField, subtitleField, linkField })` but the actual mechanism API reads `{ pages, title, subtitle, target }`. Result: the 3 sub-hubs (`Daily Hub.md`, `Weekly Hub.md`, `Monthly Hub.md`) silently render the empty-state copy instead of card lists. Discoverable only by opening one of the sub-hubs in Obsidian (manual smoke skipped per FLN-3 of v0.42.0). **Proposed cycle shape:** PATCH on cowork (`cowork@0.5.0 → 0.5.1`) — translate the 3 helpers to the correct API + add a unit-style assertion in `run-helper-cases.js` that scans helper bodies for the canonical BeaconCards call shape. Standalone, ~3 file edits + ~1 test assertion.
- **FLN-N2: workshop subscription doesn't include cowork.** Re-confirmation of FLN-1 from v0.42.0 result. Means the workshop never dogfoods cowork via `sauce reinstall --vault $PWD`. Acceptable for now; tmp-vault harnesses (`run-cowork-smoke`, `run-integration-smoke`) cover the install path. If cowork ever needs to be in the workshop's self-dogfood loop, that's a future cycle that handles the engagement-bootstrap interview pollution surface.
- **FLN-N3: `_resolveActionDate` not mirrored.** `CoworkTimeframeButtons` always uses today as the action date. The renderer's `_resolveActionDate` (which lets you click nav-buttons on a future-dated daily note to prep that future-period's note) is not mirrored. Acceptable per the design rationale — `Cowork.md` has no date in its filename. If a future cycle wants future-date prep from inside a hub, add it as an opt-in.
- **FLN-N4: 2 removed nav-buttons leave stale entries in any pre-v0.5.0 vault's `nav-buttons-registry.json` until reinstall.** Installer regenerates the registry from the current manifest on each install; once reinstall runs, the 2 stale entries disappear. Captured here so any vault that subscribed to cowork@0.4.0 + hasn't reinstalled to 0.5.0 yet still shows 3 buttons. No data migration; just bump the subscription pin + reinstall.

## What this enables for follow-on cycles

- **Pattern for other blueprints with global nav-button bloat.** If daily / project / scratch grow more global nav-buttons in future cycles, they can adopt this pattern: keep one `<blueprint>-hub` global button; move sub-actions inside the blueprint's hub note via a per-blueprint `<Blueprint>TimeframeButtons`-style helper (or inline dataviewjs for trivial cases). The sauce nav-bar real estate is preserved.
- **FLN-N1 fix (cowork@0.5.1).** Once the 3 sub-hub helpers are repaired, the Daily / Weekly / Monthly Hub cards actually render their card lists. Combined with this cycle's Timeframes block fix, the entire cowork hub-and-spoke navigation surface becomes fully functional in real vaults.
- **runTemplaterTemplate centralization.** If the duplicated logic in `CoworkTimeframeButtons._dispatch` ever needs to be shared across multiple blueprints' in-hub create-cards, promoting Route 2 → Route 1 (extend BeaconCards or accent-button to accept `runTemplaterTemplate` actions natively) is a small additive cycle on the cards mechanism.
