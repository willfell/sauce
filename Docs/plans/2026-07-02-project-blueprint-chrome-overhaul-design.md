# Project blueprint — chrome / button / breadcrumb overhaul (design)

- **Date:** 2026-07-02
- **Status:** Approved (design) — pending spec review → writing-plans
- **Scope:** `project` blueprint only this cycle (+ the `to-do` `project-todo` surface + the shared `doc-search` mechanism + the standards docs). Other blueprints are documented-now / retrofit-later.
- **Worktree:** `.worktrees/project-chrome` on `feature/project-chrome-overhaul` (isolated from the active autoloop on `main`).

## Problem

The project blueprint's chrome has drifted into three recurring complaints:

1. **Inconsistent spacing.** A literal markdown `---` renders an `<hr>` with the theme's oversized margin (~24px each side = "too much"); removing it gives 0px ("squished"); blank source lines add more uneven gaps. There is no single, tunable "happy medium."
2. **Button overload.** `ProjectNavButtons` renders up to ~7 buttons in one wrap row, truncating labels to "…" on phone. Docs/Links/hub actions are laid out ad hoc.
3. **Missing chrome.** Board card notes (promoted kanban cards) carry no breadcrumb; the hub carries dead affordances (status-chip filters, group-by, "Recently active") the user wants gone.

This cycle standardizes the chrome grammar, applies it across every project surface, migrates every existing project file in all three consumer vaults (headspace, ero, accuris), and documents the standard so future work conforms.

## Decisions locked with the user

| # | Decision |
|---|----------|
| D1 | **Scope:** project blueprint only this cycle; full migration of all pre-existing projects + every file within them across headspace/ero/accuris; document the new standard for all blueprints (retrofit others later). |
| D2 | **Nav consolidation:** a few core buttons + a **More ▾** overflow. Core = **Project · Board · Docs** (+ a context `Task: <X>` when nested). Overflow = **Map · To-Do · Helpful Links**. The **Map** destination must be reachable from the project buttons (it currently is not on most surfaces). |
| D3 | **Workstreams:** remove the Workstreams section from the project hub; consolidate all workstream management into the **Project Map** note; surface **Map** in the nav buttons. |
| D4 | Sort toggle on the hub **persists** per-hub (localStorage). |
| D5 | The divider ships as a **shared primitive** so spacing is identical everywhere and lint-enforceable. |

## The standard (normative)

This is the core deliverable — the grammar every project surface (and, going forward, every blueprint) follows.

### S1 — Divider = helper-rendered hairline, never markdown `---`

The canonical divider spec (matches the existing `SectionLabel` hairline):

```
border: none; border-top: 1px solid var(--background-modifier-border); margin: 10px 0;
```

~10px above and below — more than squished, less than a theme `<hr>`. Shipped as a shared primitive (see S5). **No literal `---` and no blank lines between chrome dataviewjs blocks** in any project template.

### S2 — Leading-hairline ownership

Each chrome/content block that must be separated from the block above it renders the hairline as its **first element**. This yields exactly **one** hairline per boundary regardless of blank lines — no doubles, no squish. Blocks that lead a boundary: `ProjectNavButtons`, each action row, the search strip, and every `SectionLabel`.

**Exception:** the project-hub `ProjectStatusWidget` renders **no** leading hairline and no surrounding blank lines — it hugs tight under the nav buttons (explicit user ask).

### S3 — Chrome order (all project surfaces)

```
Breadcrumb                    ← no divider (one unit with nav)
SpaceNavButtons               ← "nav buttons"
──────────                    ← hairline
ProjectNavButtons             ← "project buttons": Project·Board·Docs + More▾ (Map in overflow)
──────────
[action row]                  ← doc / link / to-do actions — ONE full-width row (surface-specific)
──────────
[search]                      ← docs-hub + section-hubs only — simple mode
──────────
[content]                     ← SectionLabel-led sections / index / cards
```

Surfaces without an action row or search simply omit those tiers; the ownership rule keeps spacing correct.

### S4 — Action-row layout

Action rows (New Doc·New Section·Move docs / Add link·Manage links / New Task·Recurring) are **one full-width row**: `display:flex; gap:8px; flex-wrap:wrap;` with each button `flex:1 1 0; min-width:96px;` so buttons share the width evenly and only wrap when extremely narrow.

### S5 — The shared divider primitive

Add a `divider(dv)` method to the **`section-label`** mechanism (already a project dependency; semantically owns hairlines). Signature: `SectionLabel.divider(dvOrContainer)` renders one hairline per S1. Rationale: no new mechanism/manifest/dep overhead; single source of truth; lint-checkable. (Alternative considered: a standalone `chrome-divider` mechanism — rejected for overhead.)

### S6 — Breadcrumb coverage

Every project element carries a `Breadcrumb` view **and** a stable frontmatter `type` in the registry (dispatch is by `type`). No project surface renders without a trail (top hubs excepted).

## Workstreams

Each workstream is independently implementable + testable. Files are under `platform/blueprints/project/` unless noted.

### WS0 — Shared primitive + lint (foundation)

- Add `SectionLabel.divider()` (`platform/mechanisms/section-label/section-label.js`) + unit test.
- Extend `scripts/lint-note-chrome.js` (or a new gate) to fail on literal `---` between chrome dataviewjs blocks in project templates, and to require the divider primitive. Keep the existing note-chrome exemptions (kanban `kanban-plugin:` templates).
- **Acceptance:** primitive renders the S1 spec; lint gate green on the rewritten templates and red on a literal-`---` fixture.

### WS1 — Projects hub (`content/Projects.md` + `helpers/projects-hub-cards.js`)

- Remove: status-chip filter bar, group-by selector, "Recently active" strip.
- Default sort = **last edited** (latestMtime desc). Add a single **Last edited ⇄ A–Z** toggle, persisted per-hub via localStorage (key `sauce.projects-hub.sort`).
- "+ New Project": its own **full-width, centered row**, hairline above + below, no blank gaps.
- Keep the project card grid (BeaconCards) and the DocSearch filter, but make it text-only + `persist:false` (empty on return), consistent with the docs search in WS4. The user did not ask to remove the hub search — only the status/group-by/recently-active affordances.
- **Acceptance:** hub shows no status buttons / group-by / recently-active; toggling sort reorders + survives reload; New Project row is full-width bracketed by hairlines.

### WS2 — Project note (`templates/Project.md` + activity/open-tasks/status helpers)

- Order: Breadcrumb → SpaceNavButtons → `ProjectNavButtons` → `ProjectStatusWidget` (tight) → Recent activity → Open tasks → Meetings → Links panel. **Remove** `ProjectWorkstreamManager`.
- `ProjectStatusWidget`: no leading hairline, no surrounding blank lines.
- `ProjectActivityPanel` + `ProjectOpenTasks`: each card shows a **type icon** (meeting / doc / task) and doc cards show **which section** they live in (e.g. `doc · Workflow Loops`). Reuse the SVG icon set already defined in `project-nav-buttons.js`.
- Vertical spacing between sections comes from each `SectionLabel`'s hairline (S1/S2); bump if needed after Playwright review.
- **Acceptance:** no Workstreams section on the hub; status tight under nav; activity/open-task cards carry icons + section labels; even section rhythm.

### WS3 — Nav-button consolidation (`helpers/project-nav-buttons.js`)

- Core row (always visible, in order): `Project · Board · Docs`, plus a leading `Task: <X>` when nested under `tasks/<X>/`. Self-hide the current surface's own button as today.
- **More ▾** overflow button opens a small `document.body` overlay/menu (mirror the nav-buttons Go-to launcher pattern) listing the remaining destinations: **Map · To-Do · Helpful Links** (only those that exist for the project). Map is always in the overflow (D2/D3).
- Row renders a **leading hairline** (S2). Preserve existing safe-open behavior (`_openNavTarget`, doubled-path guard) and the kanban-card workstream picker (unchanged — workstreams still exist, just managed on the Map).
- **Acceptance:** every project surface shows ≤4 core buttons + More ▾; overflow lists Map/To-Do/Links; no "…" truncation at 360px; Map reachable everywhere.

### WS4 — Docs hub + section hubs (`templates/Docs Hub.md`, `templates/Section Hub.md`, `helpers/project-docs-index.js`, `helpers/section-hub.js`, `platform/mechanisms/doc-search/doc-search.js`)

- Reorder to S3: nav / — / project buttons / — / **doc actions (New Doc · New Section · Move docs) in one full-width row** / — / **search** / — / list.
- Search → **simple mode**: `hideTags:true`, **new** `hideNativeSearch:true` (add to `doc-search.js` — hides the scoped-search "Search" button; additive, default false so existing callers unchanged), `persist:false` (empty on every return). Same for every section/sub-section hub.
- "Move docs" opens the WS5 tree dialog. New Doc / New Section keep entity-create wiring.
- **Acceptance:** Docs.md + every section hub match the S3 order; search is a bare text input (no chips, no Search button) and starts empty on revisit.

### WS5 — Move-docs tree dialog (new `helpers/doc-move-dialog.js` or extend `helpers/doc-move.js`)

- Port the `WikiMove`/`WikiLeafActions._openMoveDialog` pattern: build a depth-ordered list of the project's sections + sub-sections (lexical folder sort → parents before children), render an indented modal overlay with `└` connectors, pick a destination, move via `app.fileManager.renameFile`, and update the doc's `section` / `sub_section` frontmatter to match the destination.
- Replace the current `DocMove` / `DocBulkMoveActions` move affordance's flow with this dialog (keep bulk-move entry point if it exists; single-doc move on doc notes via `DocLeafActions`).
- **Acceptance:** Move shows the section→sub-section hierarchy; choosing a target relocates the file and rewrites its section frontmatter; breadcrumb updates accordingly.

### WS6 — Helpful Links (`templates/Links Hub.md`, `helpers/project-links-manager.js`, `helpers/project-links-panel.js`)

- Reorder to S3: nav / — / project buttons / — / **link actions (Add link · Manage links) one full-width row** / — / helpful links.
- Render links as a **responsive card grid**: `display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:10px;` — each link a card (title + host/url), works desktop + mobile. Preserve add/edit/delete via `processFrontMatter`.
- **Acceptance:** Links Hub matches S3 order; links render as a responsive grid; add/manage still write frontmatter.

### WS7 — Breadcrumb coverage (`templates/Kanban Card.md`, `templates/Task Board.md`, `templates/Task Board Card.md`, manifest breadcrumb block)

- Confirmed gap: promoted board card notes (`Kanban Card.md` → `tasks/<X>/<X>.md`) render `SpaceNavButtons` + `ProjectNavButtons` but **no Breadcrumb** and set no stable `type`.
- Fix: the Kanban Card final body writes a `Breadcrumb` block and stamps a registry `type` (`task-note`, matching the existing breadcrumb block) so the trail resolves. Add breadcrumbs to Task Board / Task Board Card final bodies (or accept kanban-board exemption for the board note itself — board notes are kanban-plugin structure; the card notes are what need trails).
- Sweep all project `type`s against `manifest.json`'s breadcrumb block; add any missing.
- **Acceptance:** opening a promoted board card note shows a breadcrumb; every non-hub project element resolves a trail.

### WS8 — Board-card + to-do button/separator audit (`templates/Kanban Card.md`, `templates/Task Board Card.md`, `to-do` `templates/Project To-Do.md` + `helpers`)

- Kanban Card / Task Board Card final bodies: apply S2/S3 (leading hairline on `ProjectNavButtons`, no literal `---`/blank-line gaps).
- `Project To-Do.md` (in the `to-do` blueprint): hairline between `ProjectNavButtons` and the to-do actions; **New Task + Recurring in one full-width row** (S4) bracketed by hairlines, no blank lines. Adjust `ToDoLeafActions` if it owns those buttons.
- **Acceptance:** board-card + project-todo surfaces conform to the grammar; to-do actions are one full-width row.

### WS9 — Migrations (per-vault heals in `platform/install.js`)

Full migration of every existing project file across headspace/ero/accuris. New idempotent, `.sauce-backup`-first, per-note try/catch heals (follow the existing ~20-heal pattern; fail loud, never throw):

- `applyProjectChromeDividerHeal` — strip now-redundant literal `---` + blank-line chrome gaps between chrome dataviewjs blocks on every project-related note (project, project-todo, docs-hub, section-hub, doc-note, map, kanban, task-note, links-hub). The runtime helpers now own dividers, so bodies just need the stale markdown removed.
- `applyProjectHubWorkstreamRemovalHeal` — remove the `ProjectWorkstreamManager` block from existing `type:project` hubs.
- `applyDocsHubActionRowHeal` / `applyLinksHubActionRowHeal` — reshape existing Docs.md / Links Hub bodies to the S3 action-row order (idempotent; anchor on the existing view invocations).
- `applyBoardCardBreadcrumbHeal` — inject Breadcrumb + `type` into existing promoted board card notes lacking them.
- Reuse / extend existing heals where they already touch these bodies (e.g. `applyDocsHubButtonRepair`, `applyProjectNavButtonsSeparatorGap`, `applyProjectActivityPanelsHeal`) rather than duplicating.
- **Acceptance:** on a seed vault + against real accuris/headspace/ero data, every project file conforms after install; heals are idempotent (second install is a no-op) and reversible via `.sauce-backup`.

### WS10 — Documentation

- Rewrite `Docs/agent-guides/note-chrome.md` §1/§2/§5 and `Docs/agent-guides/project-blueprint-ui.md` §2/§3 to define the new **divider (S1/S2) + action-row (S4) + core-nav+overflow + breadcrumb-coverage** grammar as the standard. Note the reversal of the old "no `---`, SectionLabel owns dividers only between content" rule → now "helper-rendered hairline owns every chrome boundary via leading-hairline ownership."
- Add a one-line pointer in the root `CLAUDE.md` "What not to do" / router area so new features across all blueprints follow the grammar.
- **Acceptance:** guides describe the shipped grammar; a new-helper author can conform from the docs alone.

## Testing & verification

- **Node unit tests:** extend the relevant `test:*` harnesses — `test:doc-search` (new `hideNativeSearch` option), `test:project-doc-move` (tree dialog target-building is pure), `test:workstreams-analysis`/`test:workstream-source` (Map consolidation), plus a new divider-primitive test and nav-button core/overflow partition test. Keep `test:customjs-loadable` green (bare-class rule).
- **Lint gates:** `lint-note-chrome`, `lint-display-markers`, `lint-cold-load`, `lint-schemas` all green; extend `lint-note-chrome` for the divider rule (WS0).
- **Seed-vault migration harness:** author per-heal sentinels in `platform/test/seed-vault/`; `test:seed` + `test:seed-migrations` green.
- **Preflight:** `npm run release:preflight` green before PR.
- **Live visual check:** Playwright screenshots at 360px + desktop, light + dark, on a real project surface set (hub, project note, Docs.md, a section hub, a doc note, Links Hub, a board card, a project-todo note) — the `Docs/agent-guides/build-test-verify.md` posture.

## Migration posture & risk

- Managed templates are born correct; existing notes healed at install (`.sauce-backup` first, idempotent, fails loud). Never hand-edit note bodies to conform — heals own it.
- **Risk:** the divider-strip heal touches many bodies across three vaults. Mitigate with tight anchors (class-invocation substrings, never display markers), per-note try/catch, and seed-vault sentinels before touching real vaults.
- **Risk:** reversing the locked note-chrome `---` rule affects other blueprints' lint. Scope the new divider lint to project templates this cycle; other blueprints unchanged.
- **Risk (process):** the autoloop churns `main` and re-stales feature branches (BEHIND). Ship via green non-release PRs; use `gh pr update-branch` / zero-overlap admin-merge per the documented autoloop lessons. Never admin-merge the release PR.

## Out of scope (this cycle)

- Retrofitting meetings / scratch / daily / wiki / finance to the new grammar (documented now, follow-up cycles).
- Any change to workstream *semantics* (only the management surface moves to Map).
- Manual version bumps / tags / release-PR edits — the pipeline owns those.

## Rollout order

WS0 (foundation) → WS3 (nav) + WS1 (hub) + WS2 (project note) → WS4/WS5 (docs+move) → WS6 (links) → WS7/WS8 (breadcrumb+board/todo) → WS9 (migrations, after templates+helpers settle) → WS10 (docs). Ship in green increments where each is independently verifiable.
