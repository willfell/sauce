# ChromeBar adapter factory + wiki adoption (design)

**Date:** 2026-07-06
**Type:** New functionality — generalize the ChromeBar bar to a second blueprint (wiki) via a reusable adapter factory. Cycle 1 of a 2-cycle rollout (cycle 2 batches to-do + meetings + scratch).
**Builds on:** the shipped `chrome-bar` mechanism (v0.199.0, `ChromeBar.render(dv, adapter)` + `renderChromeButton` / `CHROME_ICONS` / `vaultEntries`) and `SpaceNavButtons.firstEntryPerSource`.

## Problem

`ChromeBar.render(dv, adapter)` already renders the whole `Go ▾ / primary / ⋯` bar, but the only adapter is `ProjectChromeBar._adapter()` — bespoke, ~30 lines of project-specific glue. If every blueprint hand-writes that glue, the rollout is N copies of the same `resolve`/`navEntries`/`openNavTarget`/`rootClass`/`btnClass` boilerplate. We want a blueprint to adopt the bar by declaring only what actually differs.

## Goal

1. A **`ChromeBar.makeAdapter(config)`** factory so a blueprint adopts the bar with ~4 small functions + marker classes — no bar/breadcrumb/menu/vault code.
2. **Wiki** adopts it (canary): its 3 templates render one `WikiChromeBar` block; existing wiki notes are healed. Wiki behaves exactly as today (same destinations + New Page / New Section / Move), just in the unified bar.
3. Prove the factory generalizes beyond project so cycle 2 (to-do/meetings/scratch) is pure config.

Non-goals: no visual redesign of the bar; project blueprint untouched (its bespoke `_adapter` keeps working); to-do/meetings/scratch are a later cycle.

## Decisions (settled in brainstorming)

| Decision | Choice |
| --- | --- |
| Adapter construction | **Generic config-driven factory** `ChromeBar.makeAdapter(config)` |
| Scope | Daily-use core (wiki, to-do, meetings, scratch); **this spec = factory + wiki only** |
| Migration | **Heal existing notes** (`.sauce-backup`-first, idempotent), like `applyProjectChromeBarHeal` |
| Sequencing | Factory + wiki first → verify → batch the other 3 |

## Architecture

### 1. `ChromeBar.makeAdapter(config)` + `ChromeBar.openNavTarget` (chrome-bar mechanism)

Two additions to `platform/mechanisms/chrome-bar/chrome-bar.js` (instance methods; never-throw):

```js
// Cold-cache-safe absolute-path open (generalized from ProjectChromeBar._openNavTarget
// so every adapter gets it for free): resolve the TFile + getLeaf().openFile, else
// fall back to openLinkText. Never throws.
openNavTarget(path, dv) { /* verbatim from ProjectChromeBar._openNavTarget */ }

// Build a render-ready adapter from a per-blueprint config. Centralizes everything
// identical across blueprints; the config supplies only what differs.
//   config = {
//     detect(dv, page) -> ctxObject|null,      // classify surface; null = render nothing
//     surfaceSpec(ctx) -> { primary, overflow, leaf },
//     dispatch(dv, ctx, id) -> void,           // route an action id to the blueprint's helper
//     destinations(dv, ctx) -> entry[],        // the "This <space>" Go entries (before Vault)
//     rootClass: string,
//     btnClass(variant) -> string,
//   }
makeAdapter(config) {
  const self = this;
  return {
    resolve(dv, page) {
      const ctx = config.detect(dv, page);
      if (!ctx) return null;
      return { ctx, spec: config.surfaceSpec(ctx) };
    },
    async navEntries(dv, ctx) {
      const entries = [];
      try { for (const e of (config.destinations(dv, ctx) || [])) entries.push(e); } catch (_e) {}
      const open = (p) => self.openNavTarget(p, dv);
      try { for (const e of await self.vaultEntries(dv, open)) entries.push(e); } catch (_e) {}
      return entries;
    },
    dispatch: (dv, ctx, id) => config.dispatch(dv, ctx, id),
    openNavTarget: (p, dv) => self.openNavTarget(p, dv),
    rootClass: config.rootClass,
    btnClass: config.btnClass,
  };
}
```

`config.detect` returns a **context object** (not just a string) so it can carry resolved paths (e.g. the parent-section hub) the spec/dispatch/destinations need — mirroring `ProjectChromeBar.detectContext`'s `{ context, … }` shape. `destinations` entries are plain `{ label, icon, onSelect }` (the "This wiki" section header is prepended by the config as a `{ section: "This wiki" }` marker, exactly like ProjectChromeBar's This-project marker).

**ProjectChromeBar** could later be refactored onto `makeAdapter`, but this spec leaves it untouched (no churn; it already works). The factory is validated by wiki.

### 2. `WikiChromeBar` (wiki blueprint helper)

New `platform/blueprints/wiki/helpers/wiki-chrome-bar.js` — a customJS class whose `render(dv)` builds the config and delegates:

```js
class WikiChromeBar {
  render(dv) {
    if (!customJS?.ChromeBar?.makeAdapter) return;
    return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
  }
  _config() { return { detect, surfaceSpec, dispatch, destinations, rootClass, btnClass }; }
}
```

**Surfaces + spec** (from the existing WikiHubActions / WikiLeafActions):

| context (frontmatter `type`) | primary | overflow | leaf |
| --- | --- | --- | --- |
| `wiki-hub` (root `Wiki.md`) | New Page | New Section | false |
| `wiki-section` (Section Hub) | New Page | New Section | false |
| `wiki-page` (leaf) | — | Move | true |

Icons reuse the exact `filePlus` / `folderPlus` / `moveIcon` SVGs from the wiki helpers (verbatim). `detect` returns `null` for any non-wiki note (`type` ∉ the three) so the bar renders nothing off-surface.

**dispatch** (delegates to existing, unchanged helpers — no new action code):
- `new-page` → `customJS.EntityCreate.create({ instance: "wiki-page", dv })`
- `new-section` → `customJS.EntityCreate.create({ instance: "wiki-section", dv })`
- `move` → `customJS.WikiLeafActions._openMoveDialog(dv, <currentPath>)`

**destinations** (the `Go ▾` "This wiki" section — replaces the inline Wiki/up buttons WikiHubActions/WikiLeafActions rendered):
- Always: **Wiki** home → `spice/wiki/Wiki.md` (omitted when the current surface IS the root hub).
- On `wiki-section` / `wiki-page` with a parent: **up to parent section** via the existing `_resolveSectionHub(dv, parentFolder)` logic (moved into or reused by WikiChromeBar).

**Classes:** `rootClass: "wiki-chrome-root"`, `btnClass: (v) => "wiki-chrome-btn wiki-chrome-btn-" + v`.

`WikiTree` (the search strip + page tree) is **content, not chrome** — it stays as its own block below the bar (like `ProjectWorkstreams` did on the project Map). The bar replaces only Breadcrumb + SpaceNavButtons + WikiHubActions + WikiLeafActions.

### 3. Templates (3)

`Wiki.md`, `Section Hub.md`, `Wiki Page.md`: replace the `Breadcrumb` + `SpaceNavButtons` (+ `WikiHubActions`/`WikiLeafActions`) chrome blocks with one `WikiChromeBar` dataviewjs block; keep the `WikiTree` block (hubs) / page content (pages) below it. No literal `---` (the bar owns its spacing; §1a hairline ownership).

### 4. Heal — `applyWikiChromeBarHeal`

Mirrors `applyProjectChromeBarHeal`: for every existing wiki note (`type` ∈ {wiki-hub, wiki-section, wiki-page}), rewrite the legacy chrome block(s) to the `WikiChromeBar` block. `.sauce-backup`-first, idempotent (per-note sentinel = the `WikiChromeBar` invocation substring), never throws, conservative no-op when the legacy markers are absent. Runs at install via the wiki blueprint's `post_install`.

## Tests

- **run-chrome-bar.js** gains `CB-FACTORY-*`: `makeAdapter(config)` returns an adapter whose `resolve` returns `null` when `detect`→null / `{ctx,spec}` otherwise; `navEntries` concatenates `destinations` + the Vault grid; `dispatch`/`openNavTarget`/`rootClass`/`btnClass` thread through. Driven by a stub config.
- **NEW run-wiki-chrome-bar.js**: drives the real `WikiChromeBar` config — surface→spec table (hub/section/page), dispatch routes (`new-page`/`new-section`→EntityCreate stub, `move`→WikiLeafActions stub), destinations (Wiki home + parent section, root omits Wiki). Plus a render smoke case through the real `ChromeBar` (asserts `wiki-chrome-root` + `wiki-chrome-btn-*` + breadcrumb).
- **run-wiki-chrome-bar-heal.js** (or extend run-wiki tests): `applyWikiChromeBarHeal` rewrites a legacy note, is idempotent (2nd pass byte-identical), backs up, no-ops when already migrated.
- Existing `run-wiki.js` stays green (WikiTree/WikiMove unchanged).
- Full `release:preflight` green; mechanism/harness registration updated.

## Docs

`note-chrome.md`: widen §1d (ChromeBar canonical) to note wiki is the 2nd adopter via `makeAdapter`; `wiki-blueprint.md`: replace the WikiHubActions/WikiLeafActions chrome description with the WikiChromeBar adapter (helpers still own the *actions*, ChromeBar owns the *bar*).

## Ship + deploy

Same pipeline: worktree off `origin/main`, subagent-driven, full preflight, PR → auto-release → brew → deploy. **No new mechanism** this cycle (chrome-bar already shipped + subscribed everywhere); `chrome-bar` bumps (makeAdapter/openNavTarget) and `wiki` bumps — both carried by the normal `sauce update --bump-pins` per vault. Verify wiki is subscribed in accuris/ero/headspace first (if a vault doesn't subscribe wiki, skip it there).

## Risks

- **customjs instance methods** — `makeAdapter`/`openNavTarget`/`WikiChromeBar` all instance methods (the MenuPopover trap).
- **Heal fidelity** — the wiki heal must match the real legacy block substrings (not display markers); dry-run on a real note (byte-identical 2nd pass) before shipping, like the docs-hub heal.
- **`_resolveSectionHub` reuse** — WikiChromeBar needs the parent-section resolution WikiHubActions/WikiLeafActions have; move it to a shared spot or call the existing helper rather than duplicating.
- **Breadcrumb** — wiki's `path_walk` breadcrumb already flows through `Breadcrumb.buildSegments`, so the bar's left crumb works unchanged.

## Cycle 2 (planned, not this spec)

`to-do`, `meetings`, `scratch` each = a config (surface→spec + dispatch to their existing hub/leaf-actions + destinations) + `apply<Bp>ChromeBarHeal` + template rewrites + a `run-<bp>-chrome-bar.js`. One PR, reusing the now-proven factory. `finance`/`trips`/`reader` deferred to a later wave.
