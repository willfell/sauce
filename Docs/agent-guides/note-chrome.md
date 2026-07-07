---
purpose: Vault-wide note-chrome standard. Locks the breadcrumb / nav grammar, the no-`## H2` / SectionLabel rule and its outline/anchor tradeoff, the breadcrumb-declaration schema, open-mode + button rules, and migration posture established across the note-chrome arc (v0.121.0 → v0.124.0). Project-specific rendering detail (section ordering, proxyDv shim, card meta-lines) stays in [`project-blueprint-ui.md`](project-blueprint-ui.md).
---

# Note-chrome standard — vault-wide

Authored across the note-chrome arc (`section-label` v0.122.0, `breadcrumb` mechanism v0.123.0, adoption wave 1 v0.124.0). Every template in an **adopted** blueprint (one declaring a `breadcrumb` block in its manifest — currently `project`, `meetings`, `scratch`, `to-do`) MUST conform. Other blueprints adopt in later waves.

When you change a template or helper that renders into an adopted-blueprint note, read this file first. For project-only conventions (section ordering, proxyDv shim, card meta-line format, naming) see [`project-blueprint-ui.md`](project-blueprint-ui.md) — note-chrome.md is the vault-wide generalization; that file remains the project-specific doc.

## 1. Chrome grammar

The chrome region sits below any `# H1` title and above the first content block. Order:

1. **Breadcrumb** (FIRST block) — `Breadcrumb` view via customjs-guard.
2. **Global nav bar** — `SpaceNavButtons` / blueprint nav-button row(s).
3. **Content.**

Rules:

- **No `---` between the breadcrumb and the nav bar.** They are one chrome unit. (Precedent: `platform/blueprints/to-do/templates/Project To-Do.md`.)
- **`SectionLabel` owns content-section dividers.** It renders its own hairline above the label, so do NOT add literal `---` between SectionLabels. The first content label may pass `top: true` to suppress its hairline directly under the nav bar.

### 1a. Divider grammar — helper-owned hairlines, never literal `---` (project blueprint; 2026-07-02)

**This reverses the earlier "chrome `---` grammar applies between nav tiers" rule.** A literal markdown `---` renders an `<hr>` with the *theme's* oversized margin (too much); removing it gives 0px (squished). Neither is tunable. So chrome dividers are now **rendered by the helper**, never by a literal `---` or blank lines.

- **The primitive:** `customJS.SectionLabel.divider(containerEl)` renders the canonical hairline — `border-top: 1px solid var(--background-modifier-border-hover); margin: 18px 0` — the single source of the divider spacing. Tune the gap in that one method. Guard it: `if (customJS?.SectionLabel?.divider) customJS.SectionLabel.divider(el);`. (History: `8px` → `12px` wiki-align 2026-07-02 → **`border-hover` + `18px` 2026-07-03** — the bare `var(--background-modifier-border)` hairline was near-invisible on dark themes so tiers read as one dense stack; `--background-modifier-border-hover` + more breathing room makes every tier boundary read as a real separator. `SectionLabel.divider` is **project-only**; `SectionLabel.render`'s labeled hairline stays `var(--background-modifier-border)` since it's shared vault-wide and reads via its uppercase label.)
- **Leading-hairline ownership:** every chrome/content block that must be separated from the block above renders the hairline as its **first element**. This yields exactly one hairline per boundary regardless of blank lines — no doubles, no squish. Blocks that lead a boundary: `ProjectNavButtons`, each action row, the search strip, and every `SectionLabel`.
- **The one exception:** the project-hub `ProjectStatusWidget` renders no leading hairline and no surrounding blank lines — it hugs tight under the nav.
- **Templates carry no literal `---` and no blank-line gaps between chrome dataviewjs blocks.** Enforced by `scripts/lint-note-chrome.js` **Rule 4** (`checkNoLiteralChromeDivider`, scoped to `opts.blueprint === 'project'`; other adopted blueprints retrofit in later cycles). Existing consumer-vault notes are healed at install by `applyProjectChromeDividerHeal` (strips the literal `---` + collapses gaps; `.sauce-backup`-first, idempotent).

### 1b. Chrome order (project surfaces) — SUPERSEDED, see §1c

> **SUPERSEDED FOR THE PROJECT BLUEPRINT (button-nav-refactor).** The stacked chrome below — Breadcrumb + SpaceNavButtons + ProjectNavButtons (core + More▾) + per-surface action rows + search strip — is replaced on project surfaces by the single `ProjectChromeBar` in §1c. It is kept here as historical reference for un-migrated notes and for the install heal that reshapes them. **Other adopted blueprints (wiki / finance / trips / meetings / scratch / to-do) still follow this stacked grammar — they did NOT change.**

```
Breadcrumb            ← no divider (one unit with nav)
SpaceNavButtons       ← global nav
──────────            ← hairline (owned by the block below)
ProjectNavButtons     ← core buttons + More▾ overflow (see §5)
──────────
[action row]          ← New Doc·New Section·Move / Add link·Manage links / New Task·Recurring — ONE full-width row
──────────
[search]              ← docs/section hubs only — simple mode (§5)
──────────
[content]             ← SectionLabel-led sections
```
Surfaces without an action row or search omit those tiers; the ownership rule keeps spacing correct.

### 1c. ProjectChromeBar — the breadcrumb-driven single bar (project blueprint; button-nav-refactor)

The project blueprint replaces the whole §1b stack with **one** `ProjectChromeBar` block per surface — a single flex row rendered from `platform/blueprints/project/helpers/project-chrome-bar.js`. It subsumes Breadcrumb + SpaceNavButtons + ProjectNavButtons + the per-surface action row into one control:

```
[ Project / Docs / <crumb> …            Go ▾   [Primary]   ⋯ ]
  └─ breadcrumb (left, up-nav)          └─ controls (right, margin-left:auto)
[content]                               ← SectionLabel-led sections, no chrome divider above
```

- **Left — breadcrumb.** The `customJS.Breadcrumb.buildSegments` trail rendered as `/`-joined clickable crumbs (ancestors link via `_openNavTarget`; the current crumb is plain muted text). This is the sole up-nav affordance.
- **Right — `Go ▾` launcher.** ONE unified launcher replacing both SpaceNavButtons and ProjectNavButtons. It opens a `MenuPopover` listing a **This project** section (the project's OTHER destinations — atlas / Board / Map / Docs / To-Do / Helpful Links, current surface omitted, each existence-gated) then a **Vault** section (the pinned registry sources home/to-do/scratch/project/meetings). There is no separate `More ▾` on the project blueprint any more.
- **Right — one primary action.** A single `AccentButton` on non-leaf surfaces (New Task / New Doc / Add workstream / New Project / Add link / …), from the pure `_surfaceSpec(context)`.
- **Right — `⋯` overflow.** A `MenuPopover` of the surface's secondary actions (New Section / Move docs / Remove workstream / Manage links / …). Suppressed when the surface declares no overflow.
- **Leaf / entity surfaces are nav-only** — doc-notes, task-notes, boards, cards: breadcrumb + `Go ▾` + optional `⋯` (e.g. a doc-note's Move), no primary button.
- **Per-row task actions use a single `⋯`** (the shared `MenuPopover`), not a spread of inline row buttons.
- A **command mirror** (`ProjectCommandsInit`) registers each `Go ▾` / primary / `⋯` action as an Obsidian command (Cmd+P + hotkey-bindable), delegating to the SAME `ProjectChromeBar._dispatch` / `navTarget`, so every action is reachable without a button.

The bar renders its own controls with no leading `SectionLabel.divider` above the first content section — it is a single unit, so the §1a leading-hairline ownership applies only between the *content* sections below it. The no-`## H2` rule (§2), breadcrumb-declaration schema (§3), open-mode rule (§4), and marker conventions stay in force. Existing project notes are migrated by `applyProjectChromeBarHeal` (`_projectChromeBarBody`; `.sauce-backup`-first, idempotent, conservative no-op when no legacy nav marker is present). For the full primitive + per-surface-spec detail see [`project-blueprint-ui.md`](project-blueprint-ui.md).

### 1d. `chrome-bar` mechanism — the bar is now shared, canonical for `Go ▾`/primary/`⋯` (chrome-bar extraction; 2026-07-06)

The §1c bar is rendered by the shared **`chrome-bar` mechanism** (`customJS.ChromeBar`), not by per-blueprint code. `ChromeBar.render(dv, adapter)` owns the whole bar — breadcrumb-left + `Go ▾`/primary/`⋯`-right, the `renderChromeButton` button look (32px icon-first, hover-lift + press-scale), the `CHROME_ICONS` glyphs (compass/chevronDown/moreHorizontal), the `MenuPopover` wiring, and the dedupe root. A blueprint adopts it by handing `render` a small **adapter** — `{ resolve(dv, page) → { ctx, spec } | null, navEntries(dv, ctx), dispatch(dv, ctx, id), openNavTarget(path, dv), rootClass, btnClass(variant) }` — that supplies only the blueprint-specific parts (which surface, its `_surfaceSpec` `{ primary, overflow, leaf }` shape, its destinations, its actions, and its own marker classes). `ProjectChromeBar` is now a thin adapter; every project surface renders byte-identically to before.

**Canonical rule:** any control shaped like the `Go ▾` / primary / `⋯` bar MUST come from `ChromeBar` — never a per-blueprint copy. `AccentButton` stays the primitive for **one-off** buttons elsewhere (it is not superseded); `ChromeBar.renderChromeButton` is only the 3 bar controls. The Go launcher's **Vault** section (every registered nav-registry source, rendered as `MenuPopover`'s 2-column grid) is built once by `ChromeBar.vaultEntries`, and the registry ordering rule (`flatten → one-per-source → sort by (order, source, id)`) lives in exactly one place: `SpaceNavButtons.firstEntryPerSource` (nav-buttons owns the registry). See [`../plans/2026-07-06-chrome-bar-mechanism-extraction-design.md`](../plans/2026-07-06-chrome-bar-mechanism-extraction-design.md).

**Adopting the bar — `ChromeBar.makeAdapter(config)` (2026-07-06).** A blueprint adopts the bar by handing `ChromeBar.render(dv, ChromeBar.makeAdapter(config))` a small config — `{ detect(dv,page)→ctx|null, surfaceSpec(ctx)→{primary,overflow,leaf}, dispatch(dv,ctx,id), destinations(dv,ctx)→entry[], rootClass, btnClass }` — and **nothing else**. The factory owns everything identical across blueprints: `resolve` (detect+spec, `null` off-surface), `navEntries` (the config's `destinations` "This <space>" section + the shared Vault grid), and the cold-cache-safe `ChromeBar.openNavTarget`. `dispatch` routes action ids to the blueprint's **existing** helpers (no new action code). **`wiki` is the 2nd adopter** (`WikiChromeBar`, after `project`): New Page / New Section → `EntityCreate`, Move → `WikiLeafActions._openMoveDialog`, up-nav → `WikiLeafActions._resolveSectionHub`; `WikiTree` stays as content below the bar; existing wiki notes migrate via `_healWikiChromeBody`. `project`'s bespoke `_adapter()` predates the factory and is equivalent (not yet refactored onto it). Remaining daily-use blueprints (to-do, meetings, scratch) adopt via `makeAdapter` next. See [`../plans/2026-07-06-chrome-bar-factory-and-wiki-design.md`](../plans/2026-07-06-chrome-bar-factory-and-wiki-design.md).

## 2. No `## H2` rule + the SectionLabel tradeoff

Content section headings use `SectionLabel` (a dataviewjs view), **NOT `## H2`** (nor `### H3`). Helpers / templates emit:

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SectionLabel", args: [{ text: "Notes" }] });
```

**The tradeoff, plainly:** `SectionLabel` renders a styled `<div>`, not a markdown heading. So a section converted from `## H2` to `SectionLabel`:

- **leaves the Obsidian outline pane** (no heading → no outline entry), and
- **breaks any `[[note#Heading]]` anchor link** that targeted the old heading, and
- **shows a dataviewjs code block in edit mode** instead of a heading.

This is the accepted, documented cost of the standard. Heals are `.sauce-backup`-reversible (see §6), and adopted-blueprint notes (meetings / scratch / daily to-do) are ephemeral and rarely heading-anchored.

**Scope:** the rule applies only to **adopted** blueprints (those with a `breadcrumb` manifest block).

**Exemption — kanban-board templates.** Board templates keep their `## Column` headings: those are obsidian-kanban plugin structure, not content headings — converting them breaks the board. The lint gate (`scripts/lint-note-chrome.js`) exempts any template with `kanban-plugin:` frontmatter.

## 3. Breadcrumb declaration schema

Each adopted blueprint declares its trails per-type in `manifest.json`:

```json
"breadcrumb": {
  "types": {
    "<type>": {
      "ancestors": [ { "when?": …, "label": "<chain>", "link?": "<template>" }, … ],
      "current?":  { "label": "<chain>", "link?": "<template>" }
    }
  }
}
```

The installer's `applyBreadcrumb` aggregates every blueprint's block into `ranch/breadcrumb-registry.json` (schema_version 1, `contributions.<blueprint>.types.<type>`). The `breadcrumb` mechanism is generic — it knows zero blueprint paths; it just consumes the registry.

**Resolver grammar** (see `platform/mechanisms/breadcrumb/breadcrumb.js`):

- **Atoms:** `fm:<field>` · `path:<n>` (0-indexed path segment) · `file:basename` / `file:stem` · `lit:<text>`.
- **Transform:** `slug:<atom>` (single-level slugify).
- **Chains:** `<atom>|<atom>|…` — first non-empty wins.
- **Link templates:** `"…{<chain>}…{<chain>}…"` — any empty slot voids the whole link (segment renders as plain bold label instead).
- **Predicates:** optional `when: { "fm:<field>": "present"|"absent"|"<literal>" }`, AND-conjoined across keys, gating a single ancestor.

**Dispatch is by frontmatter `type` ALONE** across all contributions — first-match-wins with a one-time `console.warn` on collision. So **`type` values must be globally unique** across blueprints (`meeting` / `scratch` / `scratch-day` / `to-do` / `project` / `project-todo` / … do not collide today). Top-level hubs render NO trail: either their `type` isn't in the registry, or they're tag-based hubs with no `type` field at all.

## 4. Open-mode rule

Brand-new notes open in **read / preview**, never edit-with-title-selected. The shared helper is `open-helpers`' `forceLeafPreview(leaf)` (and `forceActiveLeafPreview()`); entity-create and nav-button create paths route through it.

**Trap:** `app.commands.executeCommandById` is fire-and-forget for async Templater callbacks. Do NOT flip a leaf to preview immediately after a Templater replace-in-file command — it races the in-flight mutation. Flip only after the command's own completion path.

## 5. Button rules

- **Nav-buttons row:** `flex-wrap: wrap`, and each label gets `text-overflow: ellipsis` + `overflow: hidden` + `white-space: nowrap` + `min-width: 0` so long labels truncate instead of overflowing the button.
- **Accent-button hover:** mutate individual style props (`style.background` / `style.color`). NEVER rebuild `cssText` on hover — that caused button jitter (fixed at `accent-button` v0.1.2).
- **Core + overflow nav — SUPERSEDED for the project blueprint (button-nav-refactor).** The project blueprint no longer renders a `core row + More ▾`; the single `Go ▾` launcher in §1c is the project nav. This rule still describes the pattern on **un-migrated** project notes and the shared overlay teardown reused by `MenuPopover`. (Original: a project surface showed a few **core** destinations inline + a **`More ▾`** button opening a `document.body` overlay for the rest — never a wrapping row of 6+ buttons. `ProjectNavButtons` core = `Project · Board · Docs` (+ a context `Task: <X>`); overflow = `Map · To-Do · Helpful Links`. The overlay uses ONE `close()` that removes the node **and** the Escape keydown listener — no leak; suppress `More ▾` when overflow is empty.)
- **Action rows — SUPERSEDED for the project blueprint (button-nav-refactor).** The project blueprint folds these sibling actions into the §1c bar's one primary `AccentButton` + the `⋯` overflow menu, not a full-width row. This rule still holds for the other adopted blueprints (wiki / finance / trips / meetings / scratch) and un-migrated project notes. (Original: a set of sibling actions render as **ONE full-width row**: `display:flex; gap:8px; flex-wrap:wrap;` with each button `flex:1 1 0; min-width:96px;`; the row renders a leading hairline per §1a.)
- **Simple search (docs/section hubs):** pass `DocSearch.render(dv, { hideTags:true, hideNativeSearch:true, persist:false })` — a bare text input, no tag chips, no scoped-search button, empty on every return.

## 6. Migration posture

- **Managed adopted-blueprint TEMPLATES conform** — new notes are born correct.
- **EXISTING notes are healed at install** by `applyNoteChromeHeal` (per-vault, idempotent, `.sauce-backup` snapshot before any write, fence-aware H2 rewrite, fails loud but never throws). It keys on the dataviewjs invocation substring + frontmatter `type`, never on display markers. **Never hand-edit a note body to conform** — the heal owns it.
- **Heal scope** is notes with frontmatter `type` ∈ {`meeting`, `scratch`, `scratch-day`, `to-do`}. **Tag-based hubs without a `type` field** (e.g. Meeting Hub, `tags: meetings-hub`) are therefore NOT healed — their template is fixed for new notes, but existing hubs keep their incidental `## H2` (e.g. `## Today's Meetings`). This is an **accepted cosmetic regression**, not a bug: the cards list below the heading is unaffected, and per the registry-grammar feedback we accept a cosmetic regression over a same-cycle heal.

## 7. Cross-references

- Project-specific render conventions (section ordering, empty-state-renders-nothing, proxyDv shim, card meta-lines, naming): [`project-blueprint-ui.md`](project-blueprint-ui.md).
- Cross-blueprint non-negotiables (customjs-guard, module-directory invariant, marker regions, dispatcher contracts): [`code-conventions.md`](code-conventions.md).
- Mechanisms vs blueprints, installer, registry aggregation: [`architecture.md`](architecture.md).
- Conformance + heal traps: [`../landmines.md`](../landmines.md) (note-chrome conformance + `/Scripts/` ignore trap).
