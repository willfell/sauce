# Daily / Home nav modernization + Activity coverage — design

Status: approved by user (brainstorm session 2026-07-11). Proceeding autonomously through plan → subagent execution → PR → release → tap → brew → deploy per explicit user instruction (no interim check-ins).

## Problem

Audited against user's mobile screenshots (Wednesday-2026-07-08, accuris) plus the live `space-daily-dashboard.js` / `chrome-bar.js` / `activity-feed.js` source:

1. **Nav bar is stale.** Daily + Home still render the old `SpaceNavButtons` (fixed 3×2 button grid + a "Go to…" pill with a grid icon). Project + Wiki have already migrated to the newer `ChromeBar` mechanism (breadcrumb-left, compass "Go ▾" launcher + primary + "⋯" overflow, right). Daily/Home need the same treatment, plus a standing gap: no surface has a pinned Home button, so backing up a day (or drilling into wiki/project) can strand a user with no easy way back to Home.
2. **Activity panel has a real coverage gap.** `SpaceDailyDashboard._DEFAULT_DASHBOARD_BLUEPRINTS` (the Activity feed's blueprint allowlist) omits `wiki-page`, `wiki-section`, and `doc-note` (project docs) entirely. Because the allowlist filter runs before rollup logic, these types never enter the query — wiki edits and doc creation are invisible as "activity" today, confirmed against the code (not present in the allowlist array).
3. **No count-based collapse.** Every Activity group is either always-open or statically closed (`defaultClosed` is a fixed list of group-key strings) — there's no "collapse this bucket by default when it's noisy" rule, so a busy day dumps every card open on a narrow mobile screen.
4. **Verified NOT bugs (audited, no code change):** sticky-notes (renamed from "scratch") are already correctly wired into Activity — `type: sticky-note` matches the allowlist, and the `day:` field is honored per-day by the time-window logic on past days too. To-do overdue/done counts on the dashboard are byte-identical to `TaskEntity.queryToday`/`_toDateStr`. No blueprint has an undocumented per-day "hub" type leaking into Activity (journal is a single flat type, no hub wrapper; team/product/person are one-per-entity, not daily).

## Scope

In scope:
- `chrome-bar` mechanism: add a permanent Home button (left of compass Go ▾) + a trailing hairline divider under the whole bar, on every adopted surface.
- `daily` blueprint: migrate off `SpaceNavButtons` onto `ChromeBar`, with day-nav (smart grey-out) replacing the breadcrumb slot.
- `home` blueprint: migrate off `SpaceNavButtons` onto `ChromeBar`, keeping the existing bespoke greeting/quick-capture header untouched below the bar.
- `activity-feed` mechanism: add a count-based default-collapse threshold (>3 items → closed by default), applied uniformly to every group (replacing the sticky-note-specific always-open special-case).
- `daily` blueprint (`space-daily-dashboard.js`): add `wiki-page`, `wiki-section`, `doc-note` to the Activity allowlist; bucket `wiki-section` into a `wiki` group alongside `wiki-page` (mirroring the existing `project-*` → `project` bucket rule); give the new `wiki` bucket an accent color + `groupOrder` slot.
- Existing note-chrome healing: extend/adapt the daily + home per-vault heal so already-created Daily/Home notes on consumer vaults pick up the new chrome (mirroring the precedent `applyProjectChromeBarHeal` / `_healWikiChromeBody`).
- Doc-comment note on `_DEFAULT_DASHBOARD_BLUEPRINTS` reminding future blueprint authors to exclude any new per-day auto-hub type (principle audited as already-followed; no code change, just documentation).

Out of scope (explicitly deferred, not part of this cycle):
- Adding `created_at` frontmatter to wiki templates — the existing `file.mtime` fallback already satisfies "shows things edited or made," per user's own framing.
- Any change to Tasks/Meetings panel counting logic — audited as already correct, no discrepancy found.
- Any change to the sticky-notes (scratch) blueprint itself — audited as already correct.
- A dedicated capture button on the Daily note's chrome bar — user chose to keep capture exclusively on Home.

## Architecture

### 1. `chrome-bar` mechanism — Home button + trailing divider (`platform/mechanisms/chrome-bar/chrome-bar.js`)

- `render(dv, adapter)` renders a new icon-only Home button as the FIRST control in the bar's right-hand control cluster, before the existing breadcrumb-replaces-left-slot content and before the compass Go ▾ button. Click handler: `adapter.openNavTarget("spice/home/Home.md", dv)` (reuses the existing cold-cache-safe open helper already on the adapter — no new dispatch plumbing).
  - Icon: a new `home` glyph added to `CHROME_ICONS` (Lucide-style inline SVG, matching the existing compass/chevronDown/moreHorizontal glyph shape/stroke conventions).
  - Uses the existing `renderChromeButton` primitive (icon-only mode, no label) so it's visually consistent with the "⋯" overflow button.
- After the bar row (`bar` div) is appended to `root`, append one more sibling div: a trailing hairline — `border-top: 1px solid var(--background-modifier-border-hover); margin-top: 10px;` — with the existing `root` `margin-bottom: 12px` supplying the gap before content starts. This lands on every `ChromeBar` consumer automatically (project, wiki, to-do once it adopts, daily, home).
- `note-chrome.md` § 1c/1d gets an editorial update: the bar now owns a **trailing** hairline (supersedes the old "no leading hairline above content" wording — same ownership principle, opposite edge).

### 2. `daily` blueprint — ChromeBar adapter (`platform/blueprints/daily/helpers/daily-chrome-bar.js`, NEW file; `platform/blueprints/daily/content/daily-template.md` updated)

New `DailyChromeBar` class built via `ChromeBar.makeAdapter(config)` (same factory `project`/`wiki` already use):
- `detect(dv, page)`: returns a context object `{ path, name }` whenever the current file's basename matches the daily folder + `/(\d{4}-\d{2}-\d{2})/` (mirrors `SpaceNavButtons._shouldShowDayArrows`'s folder-prefix guard) — `null` otherwise (bar simply doesn't render off-surface).
- `surfaceSpec(ctx)`: `{ primary: null, overflow: [] }` — no primary/overflow actions on Daily (confirmed: capture stays Home's job).
- `destinations(dv, ctx)`: `[]` — no blueprint-specific "This <space>" section (Daily has no siblings the way a project has Board/Map/Docs); Go ▾ shows only the shared "Vault" grid.
- `dispatch`: no-op (nothing to dispatch; overflow/primary are both empty).
- Day-nav (replaces the breadcrumb-left slot): a **new** small pure static, `DailyChromeBar.resolveDayNav(currentDate, allDailyDates)`, ported 1:1 from `SpaceNavButtons.render`'s existing arrow-row logic (lines 226–253: parse basenames for `(\d{4}-\d{2}-\d{2})`, find nearest earlier/later daily by moment diff, grey out + inert when absent). Renders as plain text/inert spans wrapped around the existing pinned pattern, in the bar's LEFT slot in place of the breadcrumb — `ChromeBar.render` needs one new small branch: if `adapter.dayNav` is a function, render its returned `{ prevLabel, prevPath, nextLabel, nextPath }` descriptor as clickable/inert arrow spans instead of calling `Breadcrumb.buildSegments`. (`dayNav` absent on every other adapter ⇒ zero behavior change elsewhere.)
- `daily-template.md`: replace the `SpaceNavButtons` dataviewjs block with `await dv.view("ranch/views/customjs-guard", { class: "DailyChromeBar" });`.
- Existing prev/next-day arrow CSS/logic in `SpaceNavButtons` stays (it's still used by any note that keeps `SpaceNavButtons`, and nothing else currently depends on removing it).

### 3. `home` blueprint — ChromeBar adapter (`platform/blueprints/home/helpers/home-chrome-bar.js`, NEW file; `platform/blueprints/home/content/home-template.md` updated)

New `HomeChromeBar` class via `ChromeBar.makeAdapter(config)`:
- `detect(dv, page)`: matches only `spice/home/Home.md` exactly.
- `surfaceSpec`: `{ primary: null, overflow: [] }` — Home's own bespoke "+" quick-capture menu (in `space-home.js`, rendered below the bar) is untouched and NOT ported into the bar's primary/overflow slots.
- `destinations`: `[]` (Vault grid only, same as Daily).
- No `dayNav` (Home is a single fixed page, not a per-day note) — left slot renders nothing (empty breadcrumb array ⇒ `ChromeBar.render`'s existing `Array.isArray(segments) && segments.length > 0` guard already no-ops cleanly).
- `home-template.md`: replace `SpaceNavButtons` dataviewjs block with `await dv.view("ranch/views/customjs-guard", { class: "HomeChromeBar" });`, rendered ABOVE the existing `SpaceHome` block (unchanged).

### 4. `activity-feed` mechanism — count-based default-collapse (`platform/mechanisms/activity-feed/activity-feed.js`)

- New opt `collapseThreshold` (default `3` when omitted). At the point group-open/closed state is computed (`isClosed = defaultClosed.has(t)`), change to: `isClosed = defaultClosed.has(t) || groupPages.length > collapseThreshold` — i.e. the static list still forces a group closed regardless of count, but ANY group (not just those in the static list) now ALSO collapses once it exceeds the threshold.
- `SpaceDailyDashboard._buildActivityOpts` passes no explicit `collapseThreshold` (accepts the mechanism default of 3) and **removes** the sticky-note-specific `defaultClosed: []` special-casing comment/intent — sticky-note now collapses like everything else once it crosses 3 items; `ascendingGroups: ["sticky-note"]` (oldest-first ordering within the group) is UNCHANGED, only default open/closed state changes.

### 5. `daily` blueprint — Activity allowlist coverage (`space-daily-dashboard.js`)

- `_DEFAULT_DASHBOARD_BLUEPRINTS` gains `"wiki-page"`, `"wiki-section"`, `"doc-note"`.
- `bucketByBlueprint` / `_buildActivityOpts`'s `bucketRules` gains one rule: `{ bucketKey: "wiki", match: (t) => t === "wiki-page" || t === "wiki-section" }` (mirrors the existing inline `project`/`trip` prefix-bucket logic in `bucketByBlueprint`, and the `cowork-` `bucketRules` entry in `_buildActivityOpts`).
- `_BLUEPRINT_COLORS` gains `wiki: "var(--color-yellow)"`. Obsidian's standard palette (`--color-{red,orange,yellow,green,cyan,blue,purple,pink}`) is fully exhausted by the existing map, so — matching the existing precedent of color reuse across topically-unrelated buckets (e.g. `--color-green` already covers `project`/`budget`/`paycheck`/`invoice`) — `wiki` reuses `--color-yellow`, currently only used by `product`, the lowest-traffic existing bucket.
- `groupOrder` gains `"wiki"` (placed after `"project"`, before `"kanban"`, since wiki activity is topically similar-weight to project activity).
- `doc-note` needs NO new rollup rule — it already matches the existing `project` rollup's `childMatchTemplate: /^spice\/projects\/[^/]+\//` (doc-notes live under `spice/projects/<slug>/...`), so once allowlisted it automatically rolls into its parent project's hub card via the pre-existing rollup machinery.
- Doc-comment addition (no behavior change): a one-line reminder above `_DEFAULT_DASHBOARD_BLUEPRINTS` that any FUTURE per-day auto-hub type (the `scratch-day`/`sticky-day`/`to-do` shape) must be excluded here, citing the audit that confirmed no such gap exists today.

## Data flow / consistency notes

- Wiki pages/sections have no `created_at`; they surface via `activity-feed.js`'s existing `includeMtime` fallback (today's edits AND creations both touch `file.mtime`) — matches the user's explicit "edited or made" framing, no migration needed.
- `doc-note` rollup depends on the CHILD path matching `spice/projects/<slug>/...` — verified against the existing rule during implementation (read the project blueprint's doc-note path convention before wiring; if doc-notes ever live outside a project's own folder tree — e.g., a project-less doc — they'll surface as an ungrouped Activity row instead of rolling up, which is acceptable degrade-gracefully behavior, not a bug).
- The `ChromeBar` Home button's target path (`spice/home/Home.md`) is hardcoded, matching the existing hardcoded `spice/boards/To-Do-Board.md` rollup-root precedent in `space-daily-dashboard.js` — consistent with how this codebase already handles the "one singleton note" case.

## Testing

- New Node-testable pure statics: `DailyChromeBar.resolveDayNav`, `DailyChromeBar.detect`/`surfaceSpec` (if extracted as statics per existing `ProjectChromeBar`/`WikiChromeBar` convention — verify convention during implementation), `HomeChromeBar.detect`/`surfaceSpec`.
- `activity-feed.js`'s new `collapseThreshold` behavior: extend the existing activity-feed harness (find its `run-*.js` file) with cases for exactly-3 (stays open), exactly-4 (collapses), and an explicit `defaultClosed` override still forcing closed even under threshold.
- `space-daily-dashboard.js`: extend existing dashboard harness with cases asserting `wiki-page`/`wiki-section`/`doc-note` now appear in `_DEFAULT_DASHBOARD_BLUEPRINTS`, and that `bucketByBlueprint` folds `wiki-section` into `wiki`.
- Seed-vault / migration heal: extend `run-seed-migrations.js` with a case for the Daily/Home chrome-bar heal (mirroring the existing `applyProjectChromeBarHeal` / `_healWikiChromeBody` test pattern) — verify against real seed-vault fixtures, not just unit stubs.
- Full `npm run release:preflight` must stay green; `npm run release:preflight-bumped` run once before merge per the release-hygiene doc.

## Migration / install heal

- New `applyDailyHomeChromeBarHeal` (or extend an existing per-vault heal dispatcher) — `.sauce-backup`-first, idempotent, conservative no-op when no legacy `SpaceNavButtons` marker is present, following the exact precedent of `applyProjectChromeBarHeal` / `_healWikiChromeBody`. Rewrites existing Daily + Home notes' `SpaceNavButtons` block to the new `DailyChromeBar`/`HomeChromeBar` block. Runs at install time for every subscribed consumer vault, including this workshop's own self-install (dogfood must pass before promoting to consumers, per `build-test-verify.md`).

## Rollout

This is a MODIFICATION of already-subscribed mechanisms/blueprints (`chrome-bar`, `daily`, `home`, `activity-feed`) — no new component subscription is needed on any consumer vault. Standard flow applies: merge to `main` → automated release pipeline bumps versions, opens + auto-merges the release PR, tags, patches the homebrew tap, auto-merges the tap PR → `brew upgrade sauce` on each consumer machine → `sauce update --bump-pins` (or `--force` if a pin mismatch blocks it) picks up the new versions with zero new subscription entries required.
