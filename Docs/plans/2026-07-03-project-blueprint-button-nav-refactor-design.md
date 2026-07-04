# Project Blueprint — Button & Navigation Refactor (POC) — Design

- **Date:** 2026-07-03
- **Status:** Design approved (brainstorm) → awaiting spec review → visual POC
- **Scope:** Project blueprint only. Proof-of-concept, validated visually before any real build.
- **Model chosen:** **B — Breadcrumb-driven** (see Options).

## Problem

The project blueprint has accreted **80+ distinct interactive controls across ~12 surfaces**, and every non-hub note stacks **four to five chrome tiers** before content:

```
Breadcrumb → SpaceNavButtons (6 pinned + Go-to…) → ProjectNavButtons (core + More▾) → [action row] → [search] → content
```

The user reports three co-equal pains: **(1) doubled navigation**, **(2) too many buttons**, **(3) clunky navigation flow** (getting around and back). A fleet audit ranked the structural causes:

1. **Two full nav rows on every surface** — `SpaceNavButtons` (vault-global) *and* `ProjectNavButtons` (project-scoped) both render. Two competing "where can I go" systems. #1 offender.
2. **A `More ▾` overflow on every surface** hiding the *same* three destinations (Map · To-Do · Links).
3. **Four bespoke action-row implementations** (docs / section / links / task) — no shared "actions for this container" primitive.
4. **6–8 hand-crafted modals** for add/edit/move/remove.
5. **~140 lines of fragile path-based context detection** deciding which buttons to show per surface.

## Goals / Non-goals

**Goals**
- Collapse the two nav rows into **one breadcrumb-driven model**.
- **One visible primary action + overflow** per surface; **zero nav chrome on leaf/entity pages**.
- Consolidate per-row task actions from three controls to two.
- Register real actions as **Obsidian commands** (a mirrored accelerator).
- **Pure customjs** — no new plugin dependency on consumer vaults (respects Sauce's distribution model).
- **Mobile-first** — validated at 390px, thumb-reachable targets.

**Non-goals (this POC)**
- Adopting a plugin (Note Toolbar / Commander / Meta Bind). Evaluated and deferred — a hard consumer dependency is out of step with the platform's self-contained model.
- Touching the obsidian-kanban plugin surfaces (Board / Task Board keep native card UI).
- Data migration, install heals, or the other blueprints (finance/wiki/trips/meetings/scratch). Those come in the *real build* phase, not the POC.

## Research basis

**In-house patterns we already trust (stolen for this design):**
- **Finance / Home** — entity pages carry **zero nav buttons**; navigation lives in a dashboard + breadcrumb. This is the precedent for zero-chrome leaves.
- **Trips** — a single **"Go to…" launcher pill** consolidates all secondary nav (no per-surface `More▾` duplication).
- **Scratch** — leaf chrome is just `← Back` + `Hub`. Proof that minimal reads fine.

**External UX guidance (2023–2026):**
- **One primary action + max ~2 secondary**, rest to overflow. [Shopify Polaris](https://polaris.shopify.com/patterns/common-actions/best-practices), [Polaris page actions](https://polaris.shopify.com/components/page-actions)
- **Progressive disclosure ≤ 2 levels**; don't hide when only 1–2 actions. [NN/g](https://www.nngroup.com/articles/progressive-disclosure/), [NN/g contextual menus](https://www.nngroup.com/articles/contextual-menus-guidelines/)
- **Breadcrumbs for up-navigation, kept separate from actions** — mixing "go" and "do" is a named anti-pattern; worth adding at ≥3 hierarchy levels. [NN/g breadcrumbs](https://www.nngroup.com/articles/breadcrumbs/)
- **Command palette (Cmd-K) as a *mirrored* accelerator**, never the only path to an action. [UX Patterns for Developers](https://uxpatterns.dev/patterns/advanced/command-palette)
- **Mobile density** — 44×44px (Apple HIG) / 48×48dp (Material) touch targets, ≥8dp spacing, **bottom sheet** for on-demand action lists; >3 visible icons on mobile → overflow. [Smart Interface Design Patterns](https://smart-interface-design-patterns.com/articles/accessible-tap-target-sizes/), [Material app bars](https://m3.material.io/components/app-bars/guidelines)

## Options considered

- **A — Merge & trim (evolutionary):** one nav row; fold global destinations + `More▾` into the launcher; standardize actions to one primary + `⋯`. Lowest risk, still button-forward.
- **B — Breadcrumb-driven (CHOSEN):** breadcrumb is the primary navigator; one `Go ▾` launcher for lateral/global jumps; both button rows deleted; leaf/entity pages get zero nav chrome. Biggest cut of all three pains; reuses our own Finance/Home precedent.
- **C — App-tab strip:** persistent `Board | Docs | Map | Tasks` tabs replace both rows; actions via one primary + Cmd-K. App-like, but tabs remain always-on chrome.

## The model (B — breadcrumb-driven)

**The unified chrome bar.** Every project surface has exactly two zones:

1. **Breadcrumb (left)** — clickable ancestor trail; owns "up". Present on **every** surface, including leaves.
2. **Trailing controls (right)** — scale by surface:
   - **`Go ▾` launcher** — the *single* replacement for both `SpaceNavButtons` and `ProjectNavButtons`. Opens a sectioned sheet: **This project** (Board · Docs · Map · To-Do · Links) + **Vault** (Home · Daily · Meetings · Scratch · All Projects · …). Bottom sheet on mobile, anchored dropdown on desktop. Present on every surface (it's how you leave a leaf).
   - **Primary action** — hub surfaces only; exactly one visible `＋` button.
   - **`⋯` overflow** — secondary/rare actions, where they exist.

**Navigation vs actions stay physically separate** (per the user's choice and the web guidance): `Go ▾` is nav; `＋`/`⋯` are actions. No mixing in one cluster.

**Hub example (Connectors → Docs hub):**
```
All Projects › Connectors › Docs          ＋ New Doc   [ Go ▾ ]   ⋯
──────────────────────────────────────────────────────────────────
<search strip> <cards / widgets>
```

**Leaf example (a doc note):**
```
All Projects › Connectors › Docs › API Keys              [ Go ▾ ]  ⋯
<content immediately — zero nav rows>
```

## Per-surface spec

Breadcrumb + `Go ▾` are implicit on all rows. Table shows what is *added* per surface.

| Surface | Visible primary | `⋯` overflow | Notes |
|---|---|---|---|
| **All Projects** hub | `＋ New Project` | Sort A–Z / Recent | root breadcrumb, no "up"; `Go ▾` = Vault section only |
| **Project** hub | `＋ New Task` | New Doc · Edit project | dashboard widgets below |
| **Docs** hub | `＋ New Doc` | New Section · Move docs | simple search strip below |
| **Section** hub | `＋ New Doc` | New Sub-Section (depth-1) · Move docs | simple search strip below |
| **Doc note** (leaf) | — | Move | zero nav chrome |
| **Board** (kanban) | — | — | obsidian-kanban owns add-card |
| **Map** | `＋ Add workstream` | Remove workstream | workstream cards below |
| **Task** hub | `＋ New Note` | Create/Open Board | note tiles below |
| **Task note** (leaf) | — | — | Edit lives in the TaskNoteView card body |
| **Task board** (kanban) | — | — | native |
| **Board card** (leaf) | — | — | truly zero |
| **Links** hub | `＋ Add link` | Manage links | link grid below |

This deletes the four bespoke action rows, the per-surface `More▾`, and the second nav row. Every surface reads: **breadcrumb → (maybe one primary) → content.**

## Per-row task model

Today each task row renders `☐ ✎ 🗑` (checkbox + edit pencil + delete trash) on **every** row — a co-equal source of the button-noise.

**New:** `☐ checkbox · title · chips · ⋯` where the single per-row **`⋯`** holds **Edit · Delete · Open note**.
- Checkbox stays visible (mark-done is the one frequent tap).
- Title-click still opens the task note (unchanged from v0.184.6).
- **Three controls per row → two**, and the `⋯` language matches the chrome bar.
- Mobile: `⋯` tap → small menu / action sheet.

Applies to all shared task-row surfaces (`TaskTodayList.renderTaskRow` and its consumers: daily aggregators, `TaskMeetingList`, `TaskProjectList`).

## Command mirror

Register the real actions as Obsidian commands so `Go ▾`/`⋯` are conveniences layered over a command surface, and the mobile command palette + hotkeys reach everything without buttons:

- **Nav:** Go to Board · Go to Docs · Go to Map · Go to To-Do · Go to Links (current project, resolved from active file).
- **Create:** New Task · New Doc · New Section · New Project.
- **Manage:** Move doc · Add workstream · Add link.

## Architecture / components

Introduce a small number of shared primitives; retire the fragile per-context button machinery.

- **`ProjectChromeBar`** (new helper) — renders the trailing-controls zone (primary + `Go ▾` + `⋯`) from a **declarative per-surface config** keyed by note `type` (frontmatter), replacing `ProjectNavButtons`' ~140 lines of path-regex context detection. The breadcrumb stays the existing `Breadcrumb` mechanism.
- **`GoToLauncher`** (new / generalized) — the unified sectioned launcher. Generalize the existing Trips/`SpaceNavButtons` overlay code (single `close()` teardown, no listener leak, bottom-sheet mobile / anchored desktop) rather than writing a third copy.
- **`OverflowMenu`** (new small primitive) — the `⋯` menu, shared by the chrome bar **and** the per-row task actions, so both speak the same language.
- **Command registration module** — registers the commands above; the launcher/menus dispatch through these commands where possible.
- **Retire:** `ProjectNavButtons` core+`More▾`, and the four bespoke action-row renderers, folded into `ProjectChromeBar` config. (Real build — the POC stubs these in the harness.)
- **Chrome grammar note:** this **evolves** `Docs/agent-guides/note-chrome.md` and `project-blueprint-ui.md` (the current "core-nav + More▾ + action rows" grammar). Those guides get updated as part of the *real build*, not the POC. Flag: the no-`## H2` rule and divider-ownership conventions still hold.

## POC scope & validation plan

**Build 4 archetype surfaces** (proves hub / leaf / list / dashboard without all 12):
1. **Project hub** — dashboard + `＋ New Task` primary + `Go ▾` + `⋯`.
2. **Docs hub** — `＋ New Doc` primary + `⋯` (New Section · Move) + `Go ▾` + search strip.
3. **Doc note** — zero-chrome leaf (breadcrumb + `Go ▾` + `⋯`=Move).
4. **A task list** — the new per-row `☐ · title · chips · ⋯` model.

**Validate visually FIRST** (per the "validate before we build" requirement, and the [[lesson_verify_chrome_visually_with_playwright_harness]] precedent):
- Build a faithful HTML replica of the new bar + `Go ▾` bottom-sheet + per-row `⋯`, using the exact AccentButton / `_mobilize` / SectionLabel.divider CSS + faint dark-theme vars.
- Serve over `python3 -m http.server` (Playwright MCP blocks `file://`).
- Render at **390px (mobile) and desktop**, **light + dark**; screenshot-compare against a replica of today's stacked chrome.

**Acceptance criteria for the POC:**
- Every surface shows **≤ 1 visible primary + `Go ▾` + `⋯`** — no second nav row, no `More▾`.
- `Go ▾` reaches every project + vault destination in one tap.
- Leaf pages show **zero nav rows**.
- Per-row task actions = **2 controls** (checkbox + `⋯`).
- Nothing truncates or clips at 390px; targets ≥ 44px.

**If the visual POC lands** → real implementation behind the existing helpers, TDD (behavioral harness), ship via the normal automatic release pipeline, deploy to all 3 vaults.

## Risks & mitigations

- **Discoverability** — deleting always-visible buttons leans on `Go ▾` + breadcrumb. *Mitigate:* `Go ▾` is a prominent labeled pill (not a bare glyph); command mirror gives a second path; the visual POC is exactly where we test whether it feels findable.
- **Breadcrumb depth** — deep paths (`tasks/<Task>/board/<Card>`) could overflow on mobile. *Mitigate:* middle-ellipsis on long trails, keep first + last two crumbs.
- **customjs gotchas** — e.g. `MarkdownRenderer` is not a global ([[lesson_customjs_markdownrenderer_not_global]]); dispatch must be deterministic. *Mitigate:* reuse proven launcher/render code paths.
- **Autoloop churn on `main`** — the workshop autoloop commits to main. *Mitigate:* POC lives in a spec + harness (no code paths shipped); real build merges via a green PR and `git merge origin/main` before PR.
- **Related in-flight work** — `Docs/plans/2026-07-03-seamless-task-actions-design.md` touches task actions; reconcile the per-row `⋯` with it before the real build.

## Rollout

Visual POC harness → **design review** (this spec) → real build behind helpers (TDD) → note-chrome/project-blueprint-ui guide updates + install heal → automatic release pipeline → deploy 3 vaults.

## Deferred / open

- Sibling/lateral breadcrumb dropdowns (click a crumb → its siblings) — deferred; `Go ▾` covers lateral for now.
- Applying the breadcrumb-driven model to the other blueprints — future, once proven on project.
