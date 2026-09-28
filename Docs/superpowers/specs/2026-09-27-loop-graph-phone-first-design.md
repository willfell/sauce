# Loop graph, phone-first — the graph and the station as one narrow-width surface

**Date:** 2026-09-27
**Status:** Approved by the Director 2026-09-28 with the rail corrections recorded in §11; minted on the sauce board as epic "Loop Graph Phone-First" (PH-1..PH-8)
**Companion:** interactive comparison and mocks at https://claude.ai/artifact/HCGvS7yoM6KVtffEDfm9yT (private)
**Builds on:** `2026-08-01-graph-view-design.md` (GraphView), `2026-07-26-operator-experience-design.md` (EpicDashboard readability + Loop Station), the GraphView Readability / Blocking Lens / Visual Polish epics (shipped), GraphView Frontier Lens (FL-1c parked, FL-2..FL-5 queued)
**Sub-project 1 of 5** in the loop-cohesion program (2: onboarding to first epic, 3: engine graph rendered by GraphView, 4: marketing kit, 5: notifications and cadence). Those are separate specs.

## 1. Problem

GraphView is the most recognisable thing Sauce draws and it is desktop-shaped. Ranks run left to right and each column is as wide as its longest title, so a 390px phone shows the first rank and a sliver of the second; edges leave the screen; the rollup and the slice list are a long scroll below. The renderer never measures its container (no `clientWidth`, no `ResizeObserver`, no `matchMedia`, no mobile branch) and every size is a fixed formula tuned for desktop.

Around the graph, three surfaces tell overlapping stories with different grammars: the epic atlas (ChromeBar + GraphView + EpicDashboard, where the dashboard's Slices list repeats what the graph shows), the Loop Station (OperatorStation + project-scope GraphView), and a Board Health note whose body calls a class that does not exist. The Director's only write gestures are kanban drag and hand-editing three JSON fields inside a ratification note, neither of which is thumb-sized.

## 2. Goal

On a phone, one epic and the whole plan each read on one screen: the shape of the plan, what needs the Director, what runs next, what is blocked and by which root. The Director can decide a ratification and reorder In Planning from the station without editing JSON or dragging kanban cards. Desktop keeps what it has and gains the same list grammar, so both widths speak one language. Everything the graph renders stays zero-write, fail-soft, frontmatter-derived, sauce-core-tokened, with no new colour literals and no new frontmatter.

## 3. Decisions made

| Decision | Choice | Why |
| --- | --- | --- |
| Narrow-width layout | **C above B**: compact map (short-id pills, ranks left to right, fitted to width) with the frontier list directly beneath | The map keeps the plan's shape for orientation and screenshots; the list carries the words. A rotated-rails layout reads as a list; a list alone has no shape. |
| Desktop | Keep today's rank columns byte-identical; add the same frontier list beneath | One grammar at both widths without shrinking desktop chips for no gain. |
| Done work | Fold done rows into a count strip once an epic is past half done; a completed epic opens folded; the map still draws done pills | Attention goes to the frontier; the strip expands on tap. |
| Detail | An inline card under the map or canvas, not an overlay sheet | A body-fixed sheet fights Obsidian's reading-view scroller and the ghost-click guard; the existing popover primitive is for menus. One panel builder serves both widths. |
| Phone gestures | **Ratify** (Accept / Later) and **Reprioritize** (In Planning up / down) on the Loop Station | Both are the Director's own inputs made thumb-sized. The contract enum is `accepted \| provisionally_accepted`, but the coordinator's consume path accepts only `accepted` today, so the phone offers no provisional decision until a coordinator slice widens consume (§11). No "Send back": a refusal has no machine path. No scaffold from the phone: the artifact needs the ledger's gate HEAD, which lives in the repo. |
| Needs-you ownership on the station | OperatorStation only; project-scope GraphView marks parked pills but lists nothing | One Needs-you per note, and it is the one with the Decide gesture and ratification links. |
| Slice rows on the atlas | GraphView's frontier list owns them; EpicDashboard drops its Slices section and keeps the summary card + context tiles | One list per note; the graph's rows carry more (root cause, hops, next, ready). |
| Frontier Lens | Supersede FL-2..FL-5 at mint with carried findings into PH-2 / PH-3; FL-1c stays as PH-2's dependency | FL-2..5 are queued against the same file and blocked behind a parked card whose artifact is missing; their intent lands here. |
| Authority handle | Decide fills `authority` from an optional `platform-config.json` variable `director_handle`, falling back to `director`, shown and editable in the card | Platform code carries no personal name; the value is one tap to change. |

## 4. Non-goals

- No pan or zoom. A fitted map plus an inline card is enough at these node counts; pinch gestures fight Obsidian's own scrolling.
- No mermaid, no canvas library. The shipped SVG edge layer and DOM nodes are kept.
- No new frontmatter fields, no schema bump, no coordinator changes. The station's two writes touch Director-owned bytes only (see §7).
- No engine-graph rendering (sub-project 3), no onboarding changes (2), no notifications (5), no README rewrite (4).
- No Board Health renderer. That note's missing class is recorded as a finding for a separate coordinator-side slice.
- The park-time ratification scaffold not firing (three Needs-you items today have no artifact) is a coordinator finding, out of scope.

## 5. Architecture

**One layout result, two presentations.** GraphView keeps delegating ranks and rows to the frozen `GraphLayout` and blocking analysis to `GraphInsights`. The change is the last step: the widget resolves a container width once per render and chooses the wide presentation (today's chips, byte-identical) or the narrow one (the compact map). Both are followed by the frontier list and the done strip, and both open the same detail card inline.

**Width resolution** has a fixed order: an explicit `containerWidth` in the mounting block's args or a harness override; then the container's measured client width; then the Obsidian `is-mobile` body class when measurement returns zero on a cold load; then wide. Under 600px is narrow. A `ResizeObserver` on the root re-renders only when the width crosses the threshold, debounced, and disconnects when the root is removed. Because the harness passes the width in, geometry stays deterministic and headless.

**The station gains its first two writes.** Both route through `RenderSafe.mutate` (the gesture-write lint's authority) with `vault.process` for an atomic read-modify-write, validate against the delivery contract before writing, refuse before writing on any violation, and are no-ops on replay. The coordinator remains the only writer of board lanes, ledger, projections, and card notes.

## 6. Components

### 6.1 GraphView (`platform/blueprints/project/helpers/graph-view.js`)

- **Width resolver** `_resolveWidth(dv, overrides)` → `{ width, narrow, source }` with the order above. Pure given its inputs; never throws; unknown → wide.
- **Compact geometry** `_compactGeometry(nodes, ranks, width)` (pure): `colW = clamp(floor((W − 2·pad − (R−1)·gap) / R), 40, 140)`, pill height 26, row gap 8, `pad` 2, `gap` 10. Short ids (shared alphabetic prefix through the dash stripped, e.g. `GA-ML8` → `ML8`) when `colW < 72`. Canvas width `= min(W, natural)`; when `R·40 + (R−1)·gap + 2·pad > W` the map scrolls horizontally with 40px pills. That fallback is documented, warning-free, and pinned by a fixture.
- **Compact map** `_renderCompactMap(root, result, api, source, warnings, geometry)`: pills carry the shared status class, colour and glyph channel (via `_statusPresentation`), stub pills dashed, stuck pills a 2px error hairline on the left, parked pills the needs-you glyph. The existing `_edgeSvg` draws the edges; the existing `_selectionController` registers pills as chips so Stuck / Dim done, chain highlight, two-tap open, canvas-tap deselect, and cluster focus work unchanged. Toolbar above, legend below (BL-5 / VP-3 placement).
- **Frontier list** `_renderFrontierList(root, nodes, analysis, laneOrder, { scope })`, both widths, after the legend. Groups in order, zero-count groups omitted: **Needs you** (parked; epic scope only), **Next up** (first ready in lane order, else draw order), **In progress**, **Blocked** (planned with a stuck upstream; row says `blocked by <root> · N hops up`), **Ready**, **Queued** (planned, not ready, not stuck; row says `after <deps>`). Rows reuse EpicDashboard's row grammar (mono id chip, title link, status pill, wait line). **Done** folds into a strip (`N done · show`) when `done / live ≥ 0.5` or all done; otherwise done rows list under a Done label. Tapping a row selects the node exactly as tapping its pill does. Readiness, root causes, hop counts, and counts come from `GraphInsights` (FL-1c); grouping is widget-side set arithmetic.
- **Detail card** `_renderDetailInline(host, node, …)`: the VP-4 labeled-rows panel (WAITING ON / UNMET PREREQUISITES / OUTCOME / GATES) plus ROOT CAUSE (FL-3's block: root blocker with its own glyph, status, jump link, hop count) and an OUTCOME row on every width (the panel builder already renders it once outcomes are loaded; the compact presentation loads them the same way). Actions: Open slice, Close. Mounted directly under the map on narrow and under the canvas on wide.
- **Project scope**: narrow renders one compact map per live epic stacked under the cluster header (BL-6 focus and the FL-4 `done/total` fraction + mini bar preserved), cross-epic edges drawn between compact pills, and one union frontier list across clusters with an epic chip per row and **no Needs-you group**. Wide keeps FL-5's global per-rank width rule.

### 6.2 OperatorStation (`platform/blueprints/project/helpers/operator-station.js`)

- **Decide.** Each Needs-you item with an artifact gets a Decide button that opens an inline card: one line of plain-language context (the `why`), then Accept and Later, an authority field prefilled from `director_handle` (default `director`), and a muted line naming exactly what will be written. `_writeRatification(file, decision, authority)`:
  1. Read the note. Locate the exact section `## Ratification — <full card name>` (the heading the coordinator writes). Require exactly one fenced `delivery-ratification` block in that section. Parse its JSON. Refuse if any key is outside the allowed set or if `decision` is already non-empty (already decided → no-op, card shows "decided, waiting for the coordinator").
  2. Set `decision` to `accepted`, `accepted_at` (ISO-8601 with numeric offset, e.g. `2026-09-27T12:48:00-06:00`), `authority`. Re-serialise with the same two-space `JSON.stringify` the coordinator used, so the diff is three values.
  3. Validate `{ ...payload, artifact_path, section_heading, artifact_sha256: <64 zeros>, section_sha256: <64 zeros> }` with the delivery API's `validateRatificationReceipt` (the station already loads the contract module). Zero digests satisfy the shape only; the coordinator recomputes real digests at consume time. Any error → refuse inline with the reason, zero writes.
  4. Write via `RenderSafe.mutate({ path, mode: 'background', optimistic, write: () => vault.process(file, replaceBlock), revert })`. `replaceBlock` re-locates the block inside the freshly read content and replaces only the fenced JSON text; every other byte is preserved. Failure → one Notice, the card returns to undecided.
  Items whose `ratification` field is null (their `why` says the artifact is missing) render no Decide; they show the coordinator command to run from the repo (`backfill-ratifications --json`) with a copy button. The station never calls `parseRatificationArtifact`: its mobile load path evaluates the contract with a crypto stub that throws, and `validateRatificationReceipt` with zero digests is the only contract call it needs.
- **Priority.** A section listing In Planning epics from `<projectDir>/<slug>-board.md` (the same lane parser GraphView project scope uses) in board order with ▲ / ▼, and the painted lanes (In Progress, Blocked) read-only with `painted by the coordinator`. `_moveEpicLine(boardFile, epic, direction)` inside `RenderSafe.mutate` + `vault.process`: find the `## In Planning` heading and the next `## ` heading; collect the `- [ ] [[…]]` lines between them; refuse if the epic line is missing, appears twice, or the move would leave the lane; swap the two line strings; assert that the result differs from the input at exactly those two line indices before returning it. Optimistic reorder in the DOM; failure reverts and shows one Notice. The coordinator's candidate order is In Progress then In Planning by line order, so the swap changes what is claimed next.
- **Text.** The retired `/delivery-status` and `delivery:status` names are replaced with `/sauce:status` wherever the station prints an instruction. This lands in PH-5, which already owns the station file; in PH-7 it would push the touch zones past the six-zone cap.

### 6.3 Navigation, templates, dashboard

- `ProjectChromeBar` Go ▾ gains **Loop Station**, existence-gated like the other destinations.
- `platform/blueprints/project/templates/Epic.md` gains the GraphView block between ProjectChromeBar and EpicDashboard (today the template has no GraphView block at all; intake-minted atlases already mount it graph-first, and the shipped `applyEpicAtlasGraphFirstHeal` covers existing atlases). The seed-vault `Gamma Epic.md` stays in its old order on purpose: it is the migration input that `VP-2C-SEED-1..9` in `run-seed-migrations.js` already prove is healed once, backed up, and byte-stable on the second install, so PH-7 touches neither the seed nor the installer.
- `EpicDashboard` drops `_renderSlices`; keeps the lifecycle chip, segmented bar, count chips, and the Context pack / Runs / Lessons / Decisions / Docs tiles. Its 390px visual fixture is regenerated.

## 7. Data flow

Reads are unchanged and one-directional: slice frontmatter, epic board lanes, parent board lanes, and the station payload → layout core and analysis → DOM. Nothing is cached across renders; nothing new is stored.

| Writer | Writes | Consumer |
| --- | --- | --- |
| Director via Decide | Three values inside one JSON block of one pending ratification note under `<project>/ratifications/` | Coordinator `consume-ratification`, unchanged |
| Director via Priority | Order of checklist lines inside the In Planning lane of the parent board | Coordinator candidate selection on its next read (`resolveEpicBoardSet` reads In Progress then In Planning) |
| Coordinator | Everything it writes today | Everything that reads it today |
| GraphView, EpicDashboard | Nothing | — |

Neither write is visible to the coordinator's foreign-write detection (which hashes card notes, not the parent board or ratification artifacts) nor to board-health's lane-divergence check (which compares lanes, not order). Both are the same edits the Director already makes by hand.

## 8. Error handling

- **Render.** Any gather, layout, or width failure degrades to a warning row and the wide path, never a blank note. Without `GraphInsights` the list shows plain status groups (Needs you, In progress, Planned, Done) and omits Next up, Blocked, Ready, the fail-soft posture the Stuck toggle already has (BL5B).
- **Decide.** Refuse before write on: no section with the exact heading, zero or two fenced blocks, invalid JSON, an unexpected key, a non-empty decision, a validator error, or an invalid authority (empty or containing a newline). Refusals render inline with the reason and write nothing. A failed write shows one Notice and reverts the card. Replaying Accept on a decided artifact is a no-op.
- **Priority.** Refuse when the epic line is missing, duplicated, or outside In Planning. The write's own post-condition (exactly two lines differ) is checked before it commits.
- **Concurrency.** `vault.process` re-reads under Obsidian's file lock, so a kanban drag or a coordinator projection landing at the same moment is re-read, not overwritten. Both writes re-locate their target in the fresh content rather than reusing offsets.

## 9. Testing

Every guard ships with a named fixture that is red without the change and a documented mutant that turns it red again. Fixture names below are the binding set; each slice may add more, never fewer.

### 9.1 Pure geometry (`run-graph-view.js`, new section)

- `PH1-WIDTH-RESOLUTION`: override beats measured beats mobile class beats wide; zero measured width with `is-mobile` → narrow; zero without → wide.
- `PH1-NO-SIDEWAYS-SCROLL`: at W=390, canvas width ≤ 390 for 1, 4, and 8 ranks; column widths equal the formula exactly.
- `PH1-SHORT-ID-RULE`: ids shorten only when `colW < 72`; a mixed-prefix set never shortens.
- `PH1-FALLBACK-DOCUMENTED`: 12 ranks at 390 → 40px pills, canvas wider than W, no warning row.
- Mutants (RED): drop the column clamp; count stub nodes toward the done ratio; treat 600px as narrow.

### 9.2 Behavioral, DOM stub (`run-graph-view.js`)

- `PH1-WIDE-BYTE-IDENTICAL`: at W=1024 the canvas and chip subtree digest equals the pre-slice digest for every existing fixture; the list is appended after the legend.
- `PH1-DETAIL-INLINE-OUTCOME`: tapping a pill renders the card under the map with the Outcome text; second tap opens; canvas tap clears.
- `PH1-RESIZE-THRESHOLD-ONLY`: a stubbed observer firing 900 → 700 does not re-render; 700 → 500 does, once.
- `PH2-GROUPS-EXACT` (Mobile Load Performance fixture): `Needs you 1 · Blocked 2` with `GA-ML9 blocked by GA-ML8 · 1 hop up` and `GA-ML10 · 2 hops up`; Dataview fixture: `In progress 1`, no Next up; Perf fixture: no groups, done strip folded, "Everything shipped" line.
- `PH2-DONE-FOLD-THRESHOLD`: 6/12 done folds; 5/12 lists; 12/12 opens folded.
- `PH2-ROW-TAP-SELECTS`: tapping a row highlights the same chain as its pill.
- `PH2-INSIGHTS-ABSENT-FAIL-SOFT`: with `GraphInsights` null, plain status groups render and no Next up / Blocked / Ready label exists.
- `PH2-ZERO-WRITES`: the contract sentinel's storage / vault / coordinator write ban holds with the list present.
- `PH3-NEEDS-YOU-OWNED-BY-STATION`: project scope renders no Needs-you label; parked pills carry the needs-you glyph.
- `PH3-CROSS-EPIC-EDGES-COMPACT`: a cross-cluster `depends_on` draws one edge between compact pills with exact endpoints.
- `PH3-CLUSTER-FOCUS-PRESERVED`: BL-6 first-tap isolates, second-tap opens, byte-unchanged assertions.
- Mutants (RED): render Needs you at project scope; fold done below half; a needs-you marker on a blocked pill; a local colour literal in `graph-view.js` (source scan).

### 9.3 Visual, headless Chrome (new `platform/test/visual/graph-view.html` + `run-graph-view-visual.js`, via `chrome-cdp.js`)

- `PH4-390-NO-OVERFLOW`: with device metrics at 390 and both `body.theme-light` / `body.theme-dark` blocks, `scrollWidth ≤ clientWidth` on the note container for the Mobile Load and Perf fixtures.
- `PH4-TAP-TARGETS-44`: every pill, row, toolbar toggle, and card action has a bounding box ≥ 44px tall.
- `PH4-NO-CLIPPED-TEXT`: no pill or row has `scrollWidth > clientWidth`.
- `PH4-PILLS-DISJOINT`: no two pill boxes intersect.
- `PH4-DESKTOP-COLUMN`: at 1024 the wide canvas renders with the list beneath.
- Registered in `platform/test/preflight-manifest.json` and `package.json` (orphan-harness gate); Chrome comes from the runner image (landmine #35).
- Mutants (RED): reintroduce `overflow-x:auto` on the narrow scroller; shrink a row below 44px.

### 9.4 Station round-trip (`run-operator-station.js`)

- `PH5-ROUNDTRIP-VALIDATOR-OK`: a pending artifact in the coordinator's exact scaffold shape → station Accept → the output passes the real `delivery.parseRatificationArtifact(markdown, heading, { artifact_path })` with `ok: true`, and the coordinator's `consume-ratification` against a temp vault + fixture state consumes it.
- `PH5-BYTES-OUTSIDE-BLOCK-IDENTICAL`: full-file diff shows exactly the three value changes.
- `PH5-DECISION-ENUM-GUARD`: the gesture writes `accepted` only; a mutant writing `provisionally_accepted` or `rejected` is RED because the round-trip consume refuses it (`ratification-decision-mismatch`); Later writes nothing.
- `PH5-AUTHORITY-HANDLE`: `variables.director_handle` in `ranch/platform-config.json` prefills the authority field; absent, malformed, or unreadable config prefills `director`; the edited value is what is written.
- `PH5-REFUSE-BEFORE-WRITE`: one case each for missing heading, two blocks, invalid JSON, unexpected key, already decided, invalid authority; zero writes recorded by the vault stub.
- `PH5-REPLAY-NOOP`: Accept twice → one write.
- `PH5-RENDERSAFE-MUTATE-ROUTE`: a source scan in the station harness proves every `vault.process` sits inside the `write` property of a `RenderSafe.mutate` call (the lint's write pattern does not match `vault.process`, so this scan is the guard); `scripts/lint-gesture-writes.js` passes with zero new allowlist entries.
- `PH5-FAILURE-NOTICE-REVERT`: a rejecting `vault.process` → one Notice, card undecided.
- `PH5-MISSING-ARTIFACT-COMMAND`: an item whose `ratification` is null renders the command and no Decide button; an item naming a pending artifact renders Decide beside the existing Ratify link.
- `PH5-NO-RETIRED-COMMAND-TEXT`: source scan for printed `delivery-status` / `delivery:status` text in `operator-station.js` is empty.
- `PH5-ROUNDTRIP-VALIDATOR-OK` builds its artifact with the coordinator's exported `scaffoldPendingRatifications` against a temp vault and an in-memory parked record with a passing gate receipt, never a hand-typed fixture.
- `PH6-SWAP-ONLY-TWO-LINES`: against a byte copy of the real parent board (blank runs, `%% kanban:settings` block, EpicCreateAction block), move down → exactly two lines differ.
- `PH6-REFUSE-MISSING-OR-DUPLICATE` and `PH6-REFUSE-LANE-BOUNDARY`.
- `PH6-PAINTED-LANES-READ-ONLY`: In Progress and Blocked rows have no arrows.
- `PH6-SELECTOR-READS-NEW-ORDER`: the coordinator's lane parser over the written board yields the new In Planning order.
- Mutants (RED): write `provisionally_accepted` or `rejected`; write when already decided; skip the validator; swap across a lane boundary; move `vault.process` outside `RenderSafe.mutate` (source scan red).

### 9.5 Cohesion and hygiene

- `PH7-TEMPLATE-GRAPH-FIRST`: `Epic.md` mounts ProjectChromeBar, GraphView, EpicDashboard in that order exactly once each, asserted beside `ES2D-ENTITY-SCAFFOLD` in `run-epic-dashboard.js`; `VP-2C-SEED-1..9` stay green with the seed untouched.
- `PH7-GO-MENU-LOOP-STATION-GATED`: the destination appears only when the note exists (chrome-bar harness).
- `PH8-SUMMARY-AND-TILES-ONLY`: EpicDashboard renders no Slices label; count chips and tiles keep their assertions; the 390px fixture is regenerated and the CDP geometry proof stays green.
- Every graph slice re-pins `run-graph-view-focus-contract.js`'s digest of the harness and updates the exact-text sentinels in `run-graph-view-contract.js` in the same commit.
- `lint-display-markers`, `lint-note-chrome`, `lint-cold-load`, `lint-gesture-writes`, `lint-schemas` green with no baseline growth.
- After deploy: screenshots from the phone of Mobile Load Performance and the Loop Station at 390px, light and dark. They become the inputs to sub-project 4.

## 10. Slices

Two chains that run in parallel because their touch zones differ, then the cohesion tail. Suggested prefix `PH`. Sketch only; `/sauce:plan` owns the contract-grade decomposition.

| # | Outcome | Touch zones | Depends on | Profile |
| :--: | --- | --- | :--: | :--: |
| PH-1 | Width resolver, compact map at epic scope, inline detail card with Outcome | `graph-view.js`, `run-graph-view.js`, `run-graph-view-focus-contract.js` (re-pin) | — | standard |
| PH-2 | Frontier list and done strip, both widths, epic scope; carries FL-2 and FL-3 findings | `graph-view.js`, `run-graph-view.js`, focus-contract and contract re-pins | FL-1c, PH-1 | standard |
| PH-3 | Project scope: compact clusters, union list without Needs you, cross-epic edges; carries FL-4 and FL-5 findings | `graph-view.js`, `run-graph-view.js` | PH-2 | standard |
| PH-4 | Visual proof harness at 390 and 1024, light and dark, in preflight | `platform/test/visual/graph-view.html`, `run-graph-view-visual.js`, `preflight-manifest.json`, `package.json` | PH-3 | standard |
| PH-5 | Decide gesture with validator gate and coordinator round-trip proof; retired command text | `operator-station.js`, `run-operator-station.js`, `visual/operator-station.html` | — | heavy |
| PH-6 | Priority gesture with byte-exact swap and selector-order proof | `operator-station.js`, `run-operator-station.js` | PH-5 | heavy |
| PH-7 | Cohesion: Epic template graph-first block, Go ▾ Loop Station entry | `templates/Epic.md`, `run-epic-dashboard.js`, `project-chrome-bar.js`, `run-project-chrome-bar.js` | PH-6 | standard |
| PH-8 | EpicDashboard keeps summary and tiles, drops Slices | `epic-dashboard.js`, `run-epic-dashboard.js`, `visual/epic-dashboard.html` | PH-2 | standard |

Board position: In Planning, at the top. FL-2..FL-5 are discarded at mint with `carried_findings` naming FL-2's ready/next markers, FL-3's triage line, needs-you marker and root-cause block, FL-4's cluster progress, and FL-5's global per-rank width rule; each name must appear in a PH-2 or PH-3 fixture. A card names one `supersedes` predecessor on the rail, so PH-2 supersedes FL-2 and PH-3 supersedes FL-4 formally, and FL-3 and FL-5 are discarded with the same coordinator verb naming the same successors and carried fixtures.

## 11. Findings recorded, not fixed here

- The Board Health note's body calls a `BoardHealth` class that does not ship; it renders "not loaded" in every vault. Coordinator-side (`codex-coordinator.js` scaffold); one slice in a separate epic, or fold the health line into the station payload.
- Three Needs-you items have no ratification artifact today, so the park-time scaffold is not firing. Coordinator-side.
- Slice notes minted by intake carry only a chrome bar above raw contract frontmatter; a slim status header (chip, wait reason, back-to-graph link) belongs there. Candidate for sub-project 2 or a follow-up here.
- The sauce plugin's skill bodies that say "open the atlas GraphView" (`plan`, `block-review`) should also name the Loop Station once it is in the Go menu. Text-only; GV-R3 precedent.
- The coordinator's consume path accepts only `decision: accepted` while the contract enum also lists `provisionally_accepted`. Widening consume, then re-adding the provisional button to Decide, is one coordinator-side slice.
- `scripts/lint-gesture-writes.js` matches `processFrontMatter`, `vault.modify`, and `vault.create` but not `vault.process`; two shipped helpers already call `vault.process` inside gestures. Extending the pattern is a lint slice with its own allowlist review.

## 12. Risks

- **Two lists on one atlas until PH-8 lands.** PH-2 adds GraphView's list while EpicDashboard's Slices still renders. Mitigation: PH-8 depends only on PH-2 and runs early; the duplication is bounded to that window.
- **Width measurement on cold load.** A hidden pane measures 0. Mitigation: the mobile-class fallback and threshold-only re-render; `PH1-WIDTH-RESOLUTION` pins the order.
- **A station write that the coordinator refuses.** Mitigation: the station runs the contract's own validator before writing and the round-trip harness feeds the real consume path.
- **Harness churn.** Geometry rewrites invalidate exact-coordinate assertions. Mitigation: the wide path is asserted byte-identical, so only narrow assertions are new.
- **Chrome on the self-hosted runner.** The visual harness needs the runner image's Chromium (landmine #35); PH-4 verifies on both CI legs before merge.
