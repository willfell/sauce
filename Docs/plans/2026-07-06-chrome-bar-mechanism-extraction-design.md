# chrome-bar mechanism — extract the ProjectChromeBar chrome system into a shared mechanism (design)

**Date:** 2026-07-06
**Type:** No-behavior-change dedupe / extraction (not a design pass — visuals + grid layout already approved and shipped via PRs #330/#332).
**Base:** `origin/main` @ v0.196.0 (this session's local main was 8 commits behind; all reference impl below is the origin/main state).

## Problem

The `Go ▾ / primary / ⋯` chrome bar — the single per-surface control introduced by the project-blueprint button-nav-refactor — lives entirely inside one blueprint helper, `platform/blueprints/project/helpers/project-chrome-bar.js`. Three pieces of it are blueprint-agnostic and will be copied verbatim the moment a second blueprint (wiki is next) wants the same bar:

1. **The button look** — `ProjectChromeBar._renderChromeButton` (32px, icon-first, hover-lift + press-scale micro-motion).
2. **The chrome glyphs** — the `compass` / `chevronDown` / `moreHorizontal` entries of `ProjectChromeBar.ICON`.
3. **The Vault-entries builder** — the `Vault` section of `ProjectChromeBar._navEntries` (every registered registry source, first-per-source, ordered by `(order, source, id)`, tagged `{ section: "Vault", layout: "grid" }`).

Additionally, (3) **duplicates the registry ordering rule** already written in `SpaceNavButtons._orderedEntries` + `_partitionEntries` ("flatten `contributions.<source>[]` → dedupe by source → sort by `(order, source, id)`"). The rule is written twice.

The whole bar-assembly (`render(dv)`: breadcrumb-left + `Go ▾`/primary/`⋯`-right + `MenuPopover` wiring) is also blueprint-agnostic except for four blueprint-specific inputs (which surface is this, what are its controls, where does each nav destination point, what does each action do).

## Goal

Every blueprint renders the identical `Go ▾ / primary / ⋯` bar from **one** place; the registry ordering rule exists in **one** place. ProjectChromeBar becomes a thin adapter. **Zero user-visible change** on project surfaces — verified by the existing PCB + MenuPopover + nav-launcher tests continuing to pass with their assertions intact (the rendered DOM stays byte-identical because the adapter supplies the same `pcb-root` / `pcb-btn` marker classes and the same SVG/label/handler inputs).

Non-goals: no visual redesign, no grid-layout change, no new surfaces, no wiki implementation this cycle (wiki adoption is **planned**, not built — see §7).

## Decisions (settled in brainstorming)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Extraction depth | **Full `render(dv, adapter)`** — the mechanism owns the whole bar | Truest to "one place, not a copy per blueprint"; makes wiki adoption a thin adapter. Still strictly no-behavior-change (PCB.render delegates faithfully). |
| Mechanism name | **`chrome-bar`** dir / **`ChromeBar`** customJS class | Mirrors `ProjectChromeBar`; reads as "the shared chrome bar". |
| Ordering owner | **`nav-buttons` (`SpaceNavButtons`)** | The nav registry is nav-buttons' domain; SpaceNavButtons already reads/orders it, and chrome-bar already delegates vault dispatch to `SpaceNavButtons._dispatchAction`. chrome-bar consumes a new pure `firstEntryPerSource(registry)`. |

## Architecture

Three components change; a fourth (MenuPopover) is unchanged and merely consumed.

### 1. `nav-buttons` — owns the single ordering rule (`SpaceNavButtons`)

Factor the comparator into one method and add the pure primitive chrome-bar needs. **Additive + refactor-in-place — SpaceNavButtons' own render behavior is unchanged.**

```js
// The ONE canonical nav comparator (null-safe; identical output to the two
// prior inline comparators for well-formed registries — every id/_source present).
_sortNavEntries(entries) {
  return (entries || []).slice().sort((a, b) =>
    (a.order ?? 100) - (b.order ?? 100)
    || String(a._source || "").localeCompare(String(b._source || ""))
    || String(a.id || "").localeCompare(String(b.id || "")));
}

// Existing: flatten ALL entries per source + sort. Now delegates the sort.
_orderedEntries(registry) {
  const entries = [];
  const contributions = (registry && registry.contributions) || {};
  for (const [source, btns] of Object.entries(contributions)) {
    if (!Array.isArray(btns)) continue;
    for (const btn of btns) entries.push({ ...btn, _source: source });
  }
  return this._sortNavEntries(entries);
}

// NEW (public, pure): ONE representative entry per source (registry list[0]),
// tagged _source, sorted by (order, source, id). This is exactly what a Go
// launcher's Vault section needs. Consumed by ChromeBar.vaultEntries.
firstEntryPerSource(registry) {
  const reps = [];
  const contributions = (registry && registry.contributions) || {};
  for (const [src, list] of Object.entries(contributions)) {
    if (!Array.isArray(list) || list.length === 0) continue;
    reps.push({ ...list[0], _source: src });
  }
  return this._sortNavEntries(reps);
}
```

Why `firstEntryPerSource` and not "reuse `_orderedEntries`": the two intents differ — SpaceNavButtons' own `rest` list wants **all** entries (including a source's 2nd+), while a launcher's Vault section wants **one** representative per source. In today's registry every source contributes exactly one entry (verified: 8 sources × 1 entry), so the two produce identical lists; the separate method keeps each intent explicit and future-proof without risking SpaceNavButtons' pin selection.

`_partitionEntries` is left exactly as-is (its `firstBySource` pin selection scans the ordered list and is not touched — zero risk to the vault-wide nav bar).

### 2. `chrome-bar` — NEW mechanism (`ChromeBar`)

New dir `platform/mechanisms/chrome-bar/` with `chrome-bar.js` + `manifest.json`. customJS class (no imports/exports; filesystem-scanned; instantiated by the plugin → **all methods are instance methods**, per the customJS static-vs-instance trap that bit MenuPopover — internal calls use `this.`).

```js
class ChromeBar {
  // The chrome-control glyphs (moved verbatim from ProjectChromeBar.ICON).
  get CHROME_ICONS() {
    return { compass: `…`, chevronDown: `…`, moreHorizontal: `…` };
  }

  // The bar's button look (moved verbatim from ProjectChromeBar._renderChromeButton).
  // opts: { cls, label?, icon?, onClick }. The CALLER supplies `cls` (its marker
  // class, e.g. 'pcb-btn pcb-btn-go') so the rendered DOM stays byte-identical
  // per blueprint. Icon-only when label is omitted; hover-lift + press-scale motion.
  renderChromeButton(parent, opts) { /* verbatim style/motion; cls from opts */ }

  // Build the Go launcher's Vault section. Reads ranch/nav-buttons-registry.json
  // (raw, like PCB does today — no cache), delegates ordering to
  // SpaceNavButtons.firstEntryPerSource, maps each rep to { label, icon, onSelect }
  // (openLink → open(target); else → SpaceNavButtons._dispatchAction), and returns
  // [{ section: "Vault", layout: "grid" }, ...dests] — or [] when empty.
  // `open(path)` is the caller's cold-cache-safe opener.
  async vaultEntries(dv, open) { /* verbatim Vault block from PCB._navEntries */ }

  // The full chrome bar. `adapter` supplies the blueprint-specific parts (below).
  // Generic pieces (RenderSafe guard, embed guard, Breadcrumb trail, MenuPopover
  // wiring, dedupe root, control assembly) live here — identical for every blueprint.
  async render(dv, adapter) { /* the PCB.render body, parameterized */ }
}
```

**The adapter contract** (what a blueprint hands `ChromeBar.render`):

```
adapter = {
  resolve(dv, page) -> { ctx, spec } | null   // classify + surface-spec; null = render nothing
  navEntries(dv, ctx) -> Promise<entry[]>     // Go launcher entries (This-project + Vault)
  dispatch(dv, ctx, id) -> void               // action router for primary + overflow ids
  openNavTarget(path, dv) -> void             // cold-cache-safe open (breadcrumb crumbs)
  rootClass: string                           // dedupe root class, e.g. 'pcb-root'
  btnClass(variant) -> string                 // marker class per control, e.g. 'pcb-btn pcb-btn-go'
}
```

`ChromeBar.render(dv, adapter)` reproduces the current `PCB.render` control flow exactly:

1. `page = customJS.RenderSafe.page(dv)`; bail if no page/file. *(generic)*
2. container guard; bail if no `createEl`. *(generic)*
3. embed guard (`.markdown-embed`); bail. *(generic)*
4. `const resolved = adapter.resolve(dv, page); if (!resolved) return;` *(blueprint-specific: the non-project/unknown bail moves into the adapter)*
5. dedupe `:scope > .${adapter.rootClass}`; create root w/ `margin-bottom: 12px`.
6. flex bar; **left** = `customJS.Breadcrumb.buildSegments` trail (ancestors → `adapter.openNavTarget`). *(generic)*
7. **right** controls:
   - `Go` — icon-only (`CHROME_ICONS.compass` + `chevronDown`), `cls = adapter.btnClass('go')`; click → `adapter.navEntries` → `MenuPopover.open(entries, { anchor, title: 'Go to' })`.
   - `primary` — when `!resolved.spec.leaf && resolved.spec.primary`; `cls = adapter.btnClass('primary')`; click → `adapter.dispatch(dv, resolved.ctx, primary.id)`.
   - `⋯` — when `resolved.spec.overflow.length`; icon `CHROME_ICONS.moreHorizontal`; `cls = adapter.btnClass('dots')`; click → `MenuPopover.open(overflow.map(...→ adapter.dispatch), { anchor })`.

Every branch never-throws + cold-load-guarded, exactly as today.

### 3. `project` blueprint — `ProjectChromeBar` becomes a thin adapter

`ProjectChromeBar` **keeps** all its project-specific logic (unchanged, so `ProjectCommandsInit` — the command mirror that reuses `_dispatch` + `navTarget` — needs no change):

- `detectContext` (+ `_isMapNote`, `_stripLinkBrackets`, `_slugify`, `_resolveProjectName`, `_resolveProjectNotes`)
- `_surfaceSpec`, `navTarget`, `_dispatch` (+ `_entityCreate`, `_docPresetsForSection`, `_createTaskNoteFlow`, `_taskBoardFlow`, `_toggleProjectsSort`)
- `_openNavTarget`
- `ICON` — **keeps only the project-destination glyphs** (`project` / `map` / `board` / `task` / `docs` / `todo` / `links` / `plus` / `minus` / `gear` / `move` / `sort`); the three chrome glyphs move to `ChromeBar.CHROME_ICONS`.
- `_navEntries` — keeps the **This project** section loop; replaces the whole **Vault** block with `for (const e of await customJS.ChromeBar.vaultEntries(dv, open)) entries.push(e);`.

`ProjectChromeBar` **loses** `_renderChromeButton` (→ `ChromeBar.renderChromeButton`) and its `render` body shrinks to:

```js
_adapter() {
  return {
    resolve: (dv, page) => {
      const ctx = this.detectContext(page.file.path, dv);
      if (ctx.context === "non-project" || ctx.context === "unknown") return null;
      return { ctx, spec: this._surfaceSpec(ctx.context) };
    },
    navEntries: (dv, ctx) => this._navEntries(dv, ctx),
    dispatch: (dv, ctx, id) => this._dispatch(dv, ctx, id),
    openNavTarget: (path, dv) => this._openNavTarget(path, dv),
    rootClass: "pcb-root",
    btnClass: (v) => `pcb-btn pcb-btn-${v}`,
  };
}

async render(dv) {
  if (!customJS.ChromeBar || typeof customJS.ChromeBar.render !== "function") return;
  return customJS.ChromeBar.render(dv, this._adapter());
}
```

Because the adapter feeds back `pcb-root` / `pcb-btn pcb-btn-<variant>` and the same icons/labels/handlers, the rendered DOM is **byte-identical** → the PCB render-cases + PCB-STYLE cases pass unchanged.

### 4. `MenuPopover` — unchanged

Already a mechanism with the `{ section, layout: "grid" }` support and instance methods (PRs #332). ChromeBar consumes `customJS.MenuPopover.open`. No change.

## Dependencies + packaging

- `platform/mechanisms/chrome-bar/manifest.json` (mirrors `menu-popover/manifest.json`): `kind: mechanism`, `version: 0.1.0`, `customjs_classes: ["ChromeBar"]`, one file → `{{scripts_path}}/chrome-bar/chrome-bar.js`, `depends_on`: `nav-buttons`, `menu-popover`, `breadcrumb`, `render-safe`, `icons`.
- `project` blueprint manifest: add `{ name: "chrome-bar", range: ">=0.1.0" }` to `depends_on`. (Bump handled automatically by the release pipeline — never hand-version.)
- `nav-buttons` version bump: automatic (adding `firstEntryPerSource` / `_sortNavEntries`).

## Tests (the contract that must survive byte-for-byte)

Kept green, assertions intact (all in `release:preflight`):

- `run-project-chrome-bar.js` — PCB-SPEC-*, PCB-OPEN-*, PCB-DISPATCH-*, PCB-NAV-1*/1g, PCB-NAV-3*, PCB-RENDER-*, PCB-STYLE-1* (finds controls by `pcb-btn-<variant>` class + `.pcb-root` — unchanged because the adapter supplies those). The render-case customJS stub gains a `ChromeBar` entry pointing at the real class (loaded via the same `new Function` loader), so `PCB.render` delegates through the actual mechanism.
- `run-menu-popover.js` — MP-1..13 unchanged (MenuPopover untouched).
- `run-nav-launcher.js` — NL-* (`_orderedEntries` / `_partitionEntries`) stay green after the comparator refactor.
- `run-project-nav-buttons.js`, `run-project-commands.js` — unchanged (PCB project logic + command mirror untouched).

New coverage:

- **run-nav-launcher.js**: add `NL-firstEntryPerSource-*` — one rep per source, `(order, source, id)` order, empty-registry → `[]`, matches `_orderedEntries` when 1/source.
- **NEW run-chrome-bar.js** (registered in `release:preflight` + `package.json`): drives the real `ChromeBar` via the `new Function` loader against DOM/customJS stubs —
  - `CB-BTN-*` `renderChromeButton`: honors caller `cls`, icon-only when no label, wires `onClick`, applies the motion handlers.
  - `CB-VAULT-*` `vaultEntries`: reads registry + delegates to a `SpaceNavButtons.firstEntryPerSource` stub, emits `{ section: "Vault", layout: "grid" }` + one entry per source, openLink → `open`, else → `_dispatchAction`, `[]` when empty.
  - `CB-RENDER-*` `render(dv, adapter)`: RenderSafe/embed guards, `adapter.resolve` null → renders nothing, dedupe root uses `adapter.rootClass`, Go/primary/⋯ use `adapter.btnClass`, clicks route to `adapter.navEntries`/`adapter.dispatch` + `MenuPopover.open`.

**Visual verification** (reuse the approved Playwright-harness pattern): render the extracted `ChromeBar` bar via the ProjectChromeBar adapter in a served HTML replica at desktop + 390px, screenshot-compare against the pre-extraction bar to confirm pixel-identical Go/primary/⋯ + grid Vault popover.

## Ship pipeline (same as the last 4 cycles)

1. Worktree off `origin/main`; subagent-driven per the plan.
2. Full `npm run release:preflight` green (+ the new chrome-bar test + visual harness).
3. Update `Docs/agent-guides/note-chrome.md` §1c (ChromeBar canonical for `Go ▾`/primary/`⋯`-shaped controls; AccentButton stays for one-off buttons) and `project-blueprint-ui.md` (pointer to the new mechanism). §7 wiki-adoption plan.
4. PR → auto-release → brew.
5. Deploy: **chrome-bar is a NEW mechanism** → add `{ name: "chrome-bar", version: … }` to all four subscriptions (workshop dogfood + accuris + ero + headspace `ranch/platform-subscription.json`) and `sauce update --bump-pins` per vault (cwd-ancestor detection; never from the workshop worktree). See `lesson_new_component_needs_consumer_subscription_brew_only` + `lesson_redeploy_version_bump_needs_pin_bump`.

## Risks / landmines

- **customjs instance-vs-static** — `ChromeBar` methods MUST be instance methods (the exact trap that made MenuPopover silently no-op). Tests drive `new ChromeBar()`.
- **Local main was behind origin** — all work branches from `origin/main`; the dirty workspace (74 dogfood-install artifacts, all `ranch/`/`.obsidian/`) is untouched by using a fresh worktree.
- **Comparator null-safety change** in `_orderedEntries` — identical output for well-formed registries; NL-* tests confirm.
- **Deploy gap for a new mechanism** — not auto-added to consumers; the subscription + `--bump-pins` step above is mandatory.

## §7 — Wiki adoption (PLAN ONLY this cycle)

Wiki is the next candidate. Its adapter mirrors ProjectChromeBar's shape:

- `WikiChromeBar` (or reuse a generic adapter) supplies `resolve(dv, page)` classifying wiki surfaces (hub / page / folder-note) → `{ ctx, spec }` where `spec` is a wiki `_surfaceSpec(context)` **mirroring ProjectChromeBar._surfaceSpec's `{ primary, overflow, leaf }` shape** (e.g. hub → primary "New Page" + overflow "New Sub-wiki" / "Move"; leaf page → nav-only).
- `navEntries` = wiki's This-wiki destinations (WikiTree roots / parent) + `ChromeBar.vaultEntries` for the shared Vault section.
- `dispatch` routes wiki action ids to the existing WikiHubActions / WikiLeafActions / WikiMove helpers.
- `rootClass: 'wiki-chrome-root'`, `btnClass: v => 'wiki-chrome-btn wiki-chrome-btn-' + v`.
- Chrome heal + `note-chrome.md` conformance updated for the wiki blueprint. Separate spec → plan → build cycle.
