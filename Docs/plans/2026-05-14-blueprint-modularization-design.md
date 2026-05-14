---
type: design
cycle: multi-cycle-strategy
title: blueprint modularization — Lego thesis + 3-mechanism extraction roadmap
status: approved
date: 2026-05-14
scope: spans cycles v0.46.0 / v0.47.0 / v0.48.0 + cascade
---

# Blueprint modularization — Lego thesis + 3-mechanism extraction roadmap

## Why

Sauce ships 13 blueprints and 10 mechanisms (as of v0.45.0). A cross-blueprint survey surfaced concrete duplication:

- **14 hub-of-cards CustomJS classes** (`ProjectsHubCards`, `TripsHubCards`, `MeetingsHubCards`, `PeopleHubCards`, `ProductsHubCards`, `TeamsHubCards`, `ScratchHubCards`, `CoworkDailyHubCards`, `CoworkWeeklyHubCards`, `CoworkMonthlyHubCards`, `BudgetsCards`, `PaychecksCards`, `InvoicesCards`, `FinanceHubCards`) — all do: query `type:<entity>` filtered to their own module-directory + render cards + show status/date badges.
- **~7 `New<X>Button` CustomJS classes** (`NewBudgetButton`, `NewPaycheckButton`, `NewInvoiceButton`, `NewMeetingButton`, `NewPersonButton`, plus project + scratch equivalents) — all do: prompt user → hydrate template vars → create file at date-routed or flat path.
- **Intra-blueprint hub-row pattern** (only cowork demonstrates today via `CoworkHubNav`, but finance has the same shape latent in its Budgets/Paychecks/Invoices structure) — render an AccentButton row letting users jump between sibling hubs in the same blueprint.

Each new blueprint forces re-implementation of these patterns by hand. The platform is one-off pattern proliferation away from drift becoming unmanageable. This strategy doc establishes the Lego thesis (principles), names three mechanisms to extract, sequences three cycles to ship them, and commits audit + tests as the durability layer that keeps modularization honest going forward.

## The Lego Thesis

Six numbered principles + two governing rules. Every future mechanism cycle cites these.

### Principles

1. **One mechanism = one cross-cutting concern.** A pattern earns mechanism status when ≥2 blueprints implement near-identical logic. Mechanisms MUST NOT mix concerns — if a behavior could belong to two mechanisms, it belongs in a third. (Rejects "blueprint-patterns" grab-bags; codifies the existing convention behind `validator`, `audit`, `cards`, `people-rendering`, `nav-buttons`, `accent-button`.)

2. **Manifest is the API surface; CustomJS is implementation.** Blueprints configure mechanisms through declarative JSON in their own manifest. CustomJS escape hatches exist; reaching for one is a *finding* — `/audit` surfaces it; the cycle author must justify it or extend the schema.

3. **Mechanisms own their materialization.** A new manifest field implies four sites: installer step, validator schema, audit rule, mechanism implementation. No other code knows the schema exists.

4. **Versioning is concern-scoped.** Bumping a mechanism does not churn unrelated blueprints. `platform/manifest.json` is the single source-of-truth for who consumes what.

5. **Extraction beats anticipation.** Mechanisms are extracted *after* ≥2 blueprints demonstrate the duplication — never built speculatively. This strategy doc is a current-state extraction roadmap, not futurology. **Sub-clause:** mechanisms must have ≥2 consumers AT EXTRACTION TIME, not afterwards. If only one blueprint demonstrates the pattern today, the extraction cycle adds a second consumer in the same cycle (see `hub-nav` cycle below).

6. **Blueprints are self-contained.** A blueprint queries only its own `module_directory`. Cross-blueprint data flows via wikilinks, never via cross-directory Dataview queries. The mechanism a blueprint consumes (cards, hub-nav, etc.) can be shared — the *data* it operates over cannot be. (Codifies landmine #11 + the v0.45.0 D1 cross-reach fix where cowork stopped reading from `spice/daily/` and now owns `spice/cowork/daily/`.)

### Governing rules

**Schema-coverage rule (principle #2's teeth).** The manifest schema for any new mechanism must cover every existing blueprint instance at introduction time without anyone reaching for the escape hatch. If even one site needs JS, the schema isn't done — extend it before shipping. Validated in each mechanism cycle's design-doc Appendix A *before* writing-plans translates it into stage tickets.

**Aesthetic commitment.** AccentButton-row is the platform's canonical aesthetic for in-blueprint action rows (set by `ScratchDayActions`, ratified by `CoworkHubNav` in v0.45.0). New action-row mechanisms render as AccentButton rows. Hub-of-cards stays on BeaconCards (it's a card grid, not a button row). New mechanisms do NOT introduce a third rendering primitive without explicit cycle approval.

## Mechanisms in scope

Three mechanisms, three cycles. Listed in extraction order.

### `entity-create@0.1.0` — Cycle 1 (likely `v0.46.0`)

**Concern:** "Click a button → prompt user → create file at a date-routed or flat path with declarative frontmatter."

**Mechanism layout:**
```
platform/mechanisms/entity-create/
  manifest.json
  entity-create.js              (single CustomJS class: EntityCreate)
  schema/new-entity-buttons.json (json-schema for validator + audit)
  README.md
```

**Manifest schema added to blueprints** — new top-level `new_entity_buttons[]` array. Per-entry:

| Field | Required | Description |
|---|:---:|---|
| `id` | yes | Unique within blueprint |
| `label` | yes | Button text |
| `prompts[]` | yes (may be empty) | Ordered list of `{key, label, type: "string"\|"date"\|"select", required, options?, default?}` |
| `destination` | yes | `{folder_prefix, folder_date_pattern?, filename_prefix, filename_date_pattern?, filename_suffix?}` — SAME shape as `nav_buttons` v0.4.2 split-field schema |
| `frontmatter_template` | yes | Object literal with `{{prompts.<key>}}`, `{{now.YYYY-MM-DD}}`, `{{now.HH-mm}}` substitution tokens |
| `body_template` | no | Optional path to a Templater template body file shipped by the blueprint |
| `render_in` | yes | One of: `{kind: "nav_buttons"}` (renders in SpaceNavButtons row) OR `{kind: "hub", target_path}` where `target_path` is a path inside the blueprint's `files[]` (renders as an AccentButton block injected at install time into that specific hub note) |

**Install-time work:** installer reads `new_entity_buttons[]`, materializes either (a) a nav-buttons action entry when `render_in.kind === "nav_buttons"`, or (b) an AccentButton block injected into the file at `render_in.target_path` when `render_in.kind === "hub"`, plus generates a shim Templater template that the runtime dispatcher calls.

**Runtime:** the `EntityCreate` CustomJS class reads the per-blueprint registry, executes prompts via Obsidian's Suggester/Modal API, hydrates the frontmatter template, creates the file, opens it.

**Coverage check (the schema-coverage rule):** all 7 existing sites must fit without escape hatch — Meeting (title prompt + date), Person (name prompt), Project (name + description prompts + status default + `status_changed_at`), Budget/Paycheck/Invoice (name + amount/dates + status default), Scratch (no prompts, pure time-now). Project's mutable `status_changed_at` and the finance trio's status-enum defaults are the schema's stress tests. **Appendix A** (lands during writing-plans, not in this doc) pre-validates all 7 against the schema before S1 ships.

**Audit rules added:**
- `manual_implementation_at_risk` (HIGH) — blueprint has a CustomJS class matching `New.*Button` regex but no `new_entity_buttons[]` entry.
- `escape_hatch_used` (INFO) — blueprint has both a `new_entity_buttons[]` entry AND a CustomJS class with matching name — expected when the escape hatch is intentional; demands a justification line in the cycle's design doc.
- `dead_path` (MEDIUM) — `destination.folder_prefix` or `body_template` path doesn't resolve.

**Test harness deltas:** `run-helper-cases.js` +~10, `run-renderer.js` +~5, `run-audit.js` +~6, NEW `run-entity-create.js` ~30 sub-asserts.

### `hub-nav@0.1.0` — Cycle 2 (likely `v0.47.0`)

**Concern:** "On every hub note within a blueprint, render an AccentButton row that lets the user jump to *sibling* hubs in the same blueprint — current-hub button omitted."

**Aesthetic:** AccentButton row.

**Principle #5 compliance — ≥2 consumers AT EXTRACTION TIME:** Only cowork demonstrates the pattern today via `CoworkHubNav`. Cycle 2 ships hub-nav mechanism AND migrates cowork to use it AND adopts hub-nav in **finance** (Budgets / Paychecks / Invoices currently have no nav between them — adopting hub-nav closes a real UX gap, not just a compliance box). Boards / products / teams don't have multi-hub structure today; they're not ready.

**Mechanism layout:**
```
platform/mechanisms/hub-nav/
  manifest.json
  hub-nav.js                    (HubNav CustomJS class)
  schema/hub-nav.json
  README.md
```

**Manifest schema added to blueprints** — new top-level `hub_nav` object (singular; if a real blueprint ever needs two nav-row families, schema extends to `hub_navs[]` in a later PATCH):

```json
"hub_nav": {
  "id": "cowork-hubs",
  "hubs": [
    { "id": "cowork",  "label": "Cowork",       "target": "{{module_directory}}/Cowork.md",       "icon": "briefcase" },
    { "id": "daily",   "label": "Daily Hub",    "target": "{{module_directory}}/Daily Hub.md",    "icon": "calendar" },
    { "id": "weekly",  "label": "Weekly Hub",   "target": "{{module_directory}}/Weekly Hub.md",   "icon": "calendar-week" },
    { "id": "monthly", "label": "Monthly Hub",  "target": "{{module_directory}}/Monthly Hub.md",  "icon": "calendar-days" }
  ],
  "render_in": [
    "{{module_directory}}/Cowork.md",
    "{{module_directory}}/Daily Hub.md",
    "{{module_directory}}/Weekly Hub.md",
    "{{module_directory}}/Monthly Hub.md",
    "{{module_directory}}/About Cowork.md"
  ]
}
```

**Runtime:** each `render_in` hub note carries a one-line dataviewjs block: `await customJS.HubNav.render(dv, { instance: "cowork-hubs" })`. The class reads `dv.current().file.path`, computes which hub is current, renders an AccentButton row with the *other* hubs.

**Install-time work:** installer validates that hub `target` paths and `render_in` paths all resolve to actual `files[]` entries.

**Migration scope (this cycle):**
- **cowork** migrates: `helpers/cowork-hub-nav.js` deleted; manifest gains `hub_nav` block; 5 hub notes' dataviewjs blocks swap from `customJS.CoworkHubNav` → `customJS.HubNav`. cowork `0.7.0 → 0.8.0` MINOR.
- **finance** adopts: NEW manifest `hub_nav` block declaring Finance / Budgets / Paychecks / Invoices as siblings; 4 hub notes gain top-of-file dataviewjs block. finance `0.2.10 → 0.3.0` MINOR (new feature, no existing `FinanceHubNav` to delete).

**Audit rules added:**
- `manual_implementation_at_risk` (HIGH) — blueprint has a CustomJS class matching `.*HubNav` but no `hub_nav` entry.
- `dead_render_target` (MEDIUM) — `render_in[i]` doesn't match any path in `files[]`.
- `missing_render_target` (MEDIUM) — a hub in `hubs[]` doesn't appear in `render_in[]` for at least one render site.

**Test harness deltas:** `run-helper-cases.js` +~5, `run-audit.js` +~6, `run-cowork-smoke.js` assertions follow the rename, NEW `run-hub-nav.js` ~15 sub-asserts.

### `entity-views@0.1.0` — Cycle 3 (likely `v0.48.0`)

**Concern:** "Render a grid of cards representing entities filtered from this blueprint's own module-directory."

**Aesthetic:** BeaconCards (card grid, not a button row).

**Mechanism layout:**
```
platform/mechanisms/entity-views/
  manifest.json
  entity-views.js               (HubCardGrid CustomJS class)
  schema/hub-cards.json
  README.md
```

**Manifest schema added to blueprints** — new top-level `hub_cards[]` array. Per-entry:

| Field | Required | Description |
|---|:---:|---|
| `id` | yes | Unique within blueprint; referenced by hub-note dataviewjs blocks |
| `query` | yes | `{path_glob, frontmatter_filter?, exclude_basenames?}` — **`path_glob` MUST start with `spice/<this-blueprint's-module_directory>/`** (validator + audit enforce principle #6) |
| `card` | yes | `{title, subtitle?, badge?: {field, type: "status_pill"\|"date"\|"literal"}, fields?[]}` |
| `sort` | no | `{by: "<frontmatter-field>"\|"filename", direction: "asc"\|"desc"}` with date-aware shortcuts (`upcoming`, `recent`) |
| `empty_state` | no | `{message, cta?: {label, action}}` (replaces ad-hoc "no entities yet" copy) |

**Hub-note consumption:** the hub note's dataviewjs block is one line: `await customJS.HubCardGrid.render(dv, { instance: "projects-hub" })`.

**Pilot blueprint: cowork.** Reasons:
1. **Self-containment dogfood** — cowork v0.45.0 D1 just enforced principle #6 by moving daily-note queries into `spice/cowork/daily/`. Pilot validates the path-glob constraint against a freshly-self-contained blueprint.
2. **Multi-instance-per-blueprint stress test** — cowork ships *three* hub-cards classes (Daily/Weekly/Monthly), so the pilot proves the mechanism handles multiple `hub_cards[]` entries per blueprint cleanly.
3. **Smallest manifest surface to schema-stress** — three cowork instances query identical-shape date-routed data; exposes path-glob / sort-by-date gaps before finance's badge logic complicates things.

**Audit rules added:**
- `manual_implementation_at_risk` (HIGH) — blueprint has a CustomJS class matching `.*HubCards` but no `hub_cards[]` entry.
- `cross_blueprint_query` (HIGH) — `query.path_glob` does NOT start with `spice/<own-module_directory>/` — violates principle #6.
- `dead_path` (MEDIUM) — `query.path_glob` doesn't resolve to any actual files at install time.

**Test harness deltas (pilot cycle):** `run-helper-cases.js` +~8, `run-audit.js` +~4, NEW `run-entity-views.js` ~25 sub-asserts.

**Deferred to `entity-views`'s own per-cycle design docs:** schema extension for `badge.type: "status_pill"` (lands in Cascade-C with finance), sort-criterion edge cases that surface during the pilot, per-blueprint migration plans for cascades.

## Migration roadmap

### Cycle 1 — `entity-create` + 7-site big-bang (likely `v0.46.0`)

**Bumps:** workshop MINOR; entity-create NEW @0.1.0; 7 blueprints MINOR (meetings, people, project, scratch, plus finance for each of Budget/Paycheck/Invoice — finance bumps once with three internal migrations).

**Stage spine (≈12 stages):**
- **S1** mechanism authoring (`entity-create.js`, manifest, json-schema)
- **S2** installer support (substitution + materialization for `render_in: "nav_buttons"` and `render_in: "hub"`)
- **S3** validator + audit rules
- **S4-S10** per-blueprint migrations — one stage per `New<X>Button` class removed
- **S11** test harness deltas + NEW `run-entity-create.js`
- **S12** catalogue + subscription + workshop dogfood + tag

**Gate at S1:** Appendix A (schema-coverage validation against all 7 sites) must show every site fits without escape-hatch. If any site doesn't fit, schema extends before S1 ships.

### Cycle 2 — `hub-nav` + cowork migrate + finance adopt (likely `v0.47.0`)

**Bumps:** workshop MINOR; hub-nav NEW @0.1.0; cowork `0.7.0 → 0.8.0`; finance `0.2.10 → 0.3.0`.

**Stage spine (≈6 stages):**
- **S1** mechanism authoring
- **S2** installer support + validator + audit rules
- **S3** cowork migration (delete `cowork-hub-nav.js`; manifest `hub_nav` block; 5 hub notes' dataviewjs blocks rewired)
- **S4** finance adoption (NEW manifest `hub_nav` block; 4 hub notes gain top-of-file dataviewjs blocks)
- **S5** test harness deltas + NEW `run-hub-nav.js`
- **S6** catalogue + subscription + workshop dogfood + tag

### Cycle 3 — `entity-views` + cowork pilot (likely `v0.48.0`)

**Bumps:** workshop MINOR; entity-views NEW @0.1.0; cowork `0.8.0 → 0.9.0`.

**Stage spine (≈7 stages):**
- **S1** mechanism authoring
- **S2** installer support + validator + audit rules
- **S3-S5** cowork migrations — one stage per hub-cards class (Daily / Weekly / Monthly)
- **S6** test harness deltas + NEW `run-entity-views.js`
- **S7** catalogue + subscription + workshop dogfood + tag

### Cascade cycles (after Cycle 3)

Each is a small ~3-stage cycle. No design docs needed — they inherit from this strategy doc. Implementation plans only.

| Cascade cycle | Migrates | Notes |
|---|---|---|
| Cascade-A | scratch + project | Both single-instance, easy adopters |
| Cascade-B | trips + meetings + people + products + teams | Entity-roster archetype, all similar shape |
| Cascade-C | finance (4 instances) | Requires `entity-views@0.2.0` schema extension for `badge.type: "status_pill"` (folds the original status-badge concern into entity-views rather than spawning a 4th mechanism) |

### Out of scope (flagged for separate cycles, NOT this strategy doc)

- **claude_surface[] adoption wave 3** (already a `v0.34.0` candidate on the roadmap per CLAUDE.md Status section) — boards / finance / journal / people / to-do / trips.
- **Seed contribution coverage** for the 9 blueprints lacking `seed/` directories — boards / cowork / finance / journal / products / scratch / teams / to-do / trips. v0.38.x-style small cycles, one per blueprint.
- **Project `project-action-buttons.js` stale manifest reference** — `platform/blueprints/project/manifest.json:41` references a file that doesn't exist in source or libexec. Installer correctly degrades (Notice, not fatal) but it's a real defect. Small patch cycle candidate.
- **Headspace's literal `{{module_directory}}` directory** — cruft from an earlier botched install, predates v0.45.0. Consumer cleanup, not platform work.

### Risks (handed to writing-plans for mitigation)

1. **Schema-coverage stress at Cycle 1 S1.** The 7-site coverage is the schema's first real test. If it fails for even one site, Cycle 1 stalls until schema is extended. **Mitigation:** Appendix A in the cycle's own plan doc pre-validates all 7 sites against the schema before stage tickets are written.
2. **Finance's `renderBadge()` decision.** Migrating finance's `NewXButton` classes (Cycle 1) means the badge logic loses its current home. **Decision:** Cycle 1 migrates the create flow only; finance's existing `renderBadge` stays untouched in `helpers/finance-status.js`; the status-pill machinery moves with `entity-views`' `status_pill` schema extension in Cascade-C.
3. **Cowork's three consecutive MINORs in a short window** (0.7.0 → 0.8.0 in Cycle 2 → 0.9.0 in Cycle 3). Tolerable; consumers will need three subscription bumps in a row. Smoothing by deferring cowork pilot is rejected — cowork is the strongest pilot candidate; accept the bump churn.

## Audit + testing strategy

Once mechanisms ship, **audit becomes the modularization-drift dashboard.** Each new mechanism contributes audit rules modeled on `/audit --claude-surface`'s existing 4-level severity scheme. Three rules apply to every new mechanism (drift signals); a fourth specific to entity-views enforces principle #6:

- `manual_implementation_at_risk` (HIGH) — blueprint has a CustomJS class matching the pattern's name regex (`New.*Button`, `.*HubCards`, `.*HubNav`) but no corresponding manifest entry. Surfaces blueprints still doing it the old way.
- `dead_path` / `dead_render_target` (MEDIUM) — a manifest entry references a path that no longer exists.
- `escape_hatch_used` (INFO) — manifest entry AND custom class coexist; the escape hatch is engaged.
- `cross_blueprint_query` (HIGH; entity-views only) — `query.path_glob` reaches outside the blueprint's own `module_directory`. Enforces principle #6.

**Test posture per mechanism:** NEW dedicated harness (`run-entity-create.js`, `run-hub-nav.js`, `run-entity-views.js`) covers schema validation + substitution + edge cases. Existing harnesses gain audit / helper-case / renderer deltas. Whole-suite preflight green is the gate at every stage close — same as today.

**The `/audit` slash command becomes the maturity metric.** Running `/audit` on any consumer vault tells you "X blueprints still have manual NewButton classes, Y still have manual HubCards classes" — and that count should monotonically decrease over the cascade cycles.

## Handoff to writing-plans

**What writing-plans turns into an implementation plan, NOW:**

- *Only* Cycle 1 — `entity-create@0.1.0` + 7-site big-bang. Stage spine S1-S12, per-stage commits, test deltas, subagent dispatch boundaries, version-bump lockstep map.
- **Appendix A — schema-coverage validation** against all 7 sites is part of the cycle plan's output (it's the gate for S1). Not in this strategy doc itself.

**What's deferred to its own cycle-design-doc later** (NOT writing-plans output now):

- Cycle 2 (`hub-nav`) — fresh design + plan when Cycle 1 closes.
- Cycle 3 (`entity-views` pilot) — same.
- Cascade-A/B/C — implementation-only plans (no design docs needed; they inherit from this strategy doc).

## Open items / FIX-LATER candidates

1. **CLAUDE.md status section update** — Cycle 1's close will fold this strategy doc into CLAUDE.md's Status (live) section as "next" with a cite to this doc.
2. **The `Docs/Meta/<X>-System.md` retirement noted in CLAUDE.md** (claude_surface wave 3 / `v0.34.0`) interacts with our cycles only insofar as it's the other open wave. Sequencing decision: claude_surface wave 3 and entity-create can run in parallel since they touch disjoint manifest fields; or they can sequence as `v0.34.0 → v0.46.0` to keep cognitive load low. Recommendation: let the writing-plans output for Cycle 1 explicitly call out sequencing relative to v0.34.0.
3. **Brew-installed sauce auto-bump validation** — when each of our 3 cycles tags, `.github/workflows/release.yml` preflight → bump-tap chain must succeed. v0.45.0 demonstrated the chain works; no new risk surfaced. Worth confirming again post-Cycle 1 close.

## Links

- **Predecessor strategy doc:** [[2026-05-12-sauce-claude-cohesion-design]] (the 3-wave claude_surface adoption template this doc structurally mirrors)
- **Most-recent cycle informing this brainstorm:** [[2026-05-14-v0.45.0-cowork-self-contained-design]] (codified principle #6 + aesthetic governing rule)
- **Landmines reference:** `Docs/landmines.md` (especially #11 module-directory invariant)
- **Platform design root:** [[2026-05-02-vault-platform-design]]
