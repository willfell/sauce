# GraphView — draw the plan that already exists

**Date:** 2026-08-01
**Status:** Approved by Director (brainstorm session)
**Context:** First stage ("Option A — draw what exists") of the graph-based-dev direction. Investigation report: `~/obsidian/headspace-sauce/spice/projects/sauce/docs/graph-based-dev/Graph Based Dev Report.md`. The delivery system already maintains a real dependency graph (slice cards as contracted nodes, `depends_on` as receipt-guarded edges); nothing renders it. This spec adds the rendering — nothing else.

## Goal

The Director opens one note and sees the plan: which jobs exist, which waits are real dependency arrows versus drag-order preference, where the frontier is, and why any node is waiting. Two questions, one glance.

## Non-goals (explicit)

- No coordinator, intake, or skill-body changes. No new writers.
- No new frontmatter fields, no schema bump.
- No graph-lint in `status --json` (the widget's warning strip covers view-time visibility only).
- No supersession-lineage or cross-repo decoration (deferred by Director choice).
- No mermaid. No rendering of discarded nodes — dead work stays removed.
- No parallelism, no execution-semantics change of any kind.

## Decisions made (with rationale)

| Decision | Choice | Why |
| --- | --- | --- |
| Scope of first bite | Render only ("draw what exists") | Pure projection; constitutionally safe; generates the evidence any later stage needs |
| Renderer | Live customjs widget, view-time render | Never stale; zero coordinator changes; platform-native (EpicDashboard/OperatorStation precedent) |
| Placement | Both levels: epic atlas + project overview | "Shape of this epic" and "the whole plan" are different questions; one widget, two mounts |
| v1 content | Baseline + ghosted queue-order + wait badges | The two honesty features; lineage and cross-repo stubs deferred |
| Drawing tech | Custom SVG/DOM with own layout | Clickable wikilink nodes, theme-consistent, mutation-killable pure core; mermaid clicks/styling are fought territory in-sandbox |

## Components

### 1. `platform/blueprints/project/helpers/graph-layout.js` — pure layout core

`layoutGraph(slices, options) → { nodes, edges, warnings }`

- **Input:** array of slice frontmatter objects in the shape `EpicDashboard._slicePages()` already produces (`card`, `status`, `depends_on`, `resume_condition`, `kanban_column`, `file.path`), plus options `{ laneOrder: string[] }` (card names in board-lane order, for ghost edges and rank tie-breaking).
- **Edge parsing:** `depends_on` wikilinks/bare names parsed with the same tolerance the selectors use (scalar or list, `[[Name]]` or `Name`).
- **Layout:** longest-path layering — rank 0 = no unresolved prerequisites, rank N = 1 + max(rank of prerequisites); within a rank, order by lane position. Output nodes carry `{ card, path, status, rank, row, waitReason }`.
- **Edges:** `{ from, to, kind: "depends" | "order" }`. `order` edges connect lane-adjacent siblings that share a rank and declare no dependency path between them — the ghosted honesty layer.
- **Warnings:** `{ code, card, detail }` for `dangling_dependency` (target not in the slice set and not resolvable), `cycle` (cards on a dependency cycle; the cycle members still render, at a fallback rank, flagged), `self_dependency`. Warnings never throw; the layout always returns a drawable result.
- **No Obsidian APIs, no `app`, no I/O.** This file is a pure function of its arguments.

### 2. `platform/blueprints/project/helpers/graph-view.js` — the widget

Class `GraphView`, mounted via the standard `customjs-guard` block. Constructor accepts injected dependencies (`lifecycleApi`, app accessor) exactly like `EpicDashboard`, for harness use.

- **Epic scope** (`{ scope: "epic" }`, mounted on the epic atlas beside EpicDashboard): gathers slices from the atlas's sibling `board/` directory using the same folder-is-authoritative logic as `_slicePages()`; lane order read from the epic board note's `In Planning` / `In Progress` list order.
- **Project scope** (`{ scope: "project" }`, mounted on Loop Station — the parent board note is a kanban-plugin view where dataviewjs blocks do not render, so it cannot host the widget): resolves live epics from the parent board's In Planning + In Progress lanes, renders each epic as a labeled cluster of its slices, includes cross-epic `depends_on` edges, and reads Loop Station frontmatter (`active`) to outline the active claim. Completed epics collapse to a single done-chip; the Archive section and discarded work never render.
- **Rendering:** SVG (edges, arrowheads) + positioned DOM chips (nodes) in a horizontally scrollable container. Node chip = slice id + status color from the same delivery lifecycle API + `STATUS_COLORS` the dashboard uses; click = open the card (real vault link navigation). Active claim gets a distinct outline. Parked/blocked chips carry a wait badge: `resume_condition` text (truncated, full on hover/tap) for human waits, unmet dependency names otherwise.
- **Warning strip:** `warnings[]` render as one compact warning-styled row under the graph ("GA-X3 depends on a card that doesn't exist: 'GA-X2a'"). Empty warnings render nothing.
- **Fail-soft:** any read/parse failure renders that node in an "unknown" style and adds a warning; the widget never blanks the note and never writes anything.

### 3. Mount points

- Epic atlas template + existing epic atlases gain one `customjs-guard` GraphView block beside EpicDashboard (install-heal path, same mechanism that manages existing chrome).
- Loop Station body: the stock `OperatorStation` scaffold gains the project-scope mount (coordinator body-scaffold only runs when the note is absent; existing stations are healed by the install path, never by the coordinator).

## Data flow

Vault frontmatter (slices, epic boards, Loop Station) → widget gather → `layoutGraph()` → SVG/DOM. One direction, read-only, computed on every render. The coordinator's existing projections are the only data source; no new state anywhere.

## Testing

- **`platform/test/run-graph-layout.js`** — harness over the pure core with fixtures for: linear chain (CV-1→2→3→4 shape), fan-in (OC-3 ← OC-1+OC-2), fork (PA-3 → PA-4/PA-5), ghost-order between edge-free siblings, dangling dependency, cycle, self-dependency, mixed `[[wikilink]]`/bare-name parsing, empty board. Assertions on ranks, edge kinds, and exact warning codes — real mutation-killing teeth for Gate B.
- **Widget coverage** rides the existing render-guard and customjs-contract harnesses (loadable, contract-conformant, fail-soft on empty/malformed input), following the pattern of the other project-blueprint widgets.

## Delivery path

Per repo law the board is the plan: this spec goes through `/loop:plan` to mint one epic with contracted slices through the intake rail (anticipated shape: slice 1 — layout core + harness; slice 2 — epic-scope widget + atlas mount/heal; slice 3 — project-scope mount + Loop Station heal). The superpowers `writing-plans` step is deliberately replaced by the repo's sanctioned planning rail.

## Risks

- **Clutter at project scope** — mitigated: live epics only, completed epics collapse, history never renders.
- **Trust** — a wrong map is worse than no map; mitigated by view-time rendering (no staleness class of bugs) and the warning strip surfacing exactly the degenerate states instead of hiding them.
- **Layout quality on unusual boards** — mitigated by fixture-driven harness using the real observed shapes; the layout is deliberately simple (layered ranks), not a general graph-drawing engine.
