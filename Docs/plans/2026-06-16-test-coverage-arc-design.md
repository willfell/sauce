---
arc: test-coverage-arc
phase: design
status: approved-pending-review
worktree: ../sauce-test-coverage
branch: feature/test-coverage-arc
base_workshop_version: 0.118.1
---

# Test coverage arc — design

Mega-design for the four-phase test-coverage workstream: audit, then three risk-weighted implementation cycles, all executed on one long-lived feature branch inside a dedicated worktree, landing as one PR at arc close.

## Goal

Extend the testing harness across every blueprint and every mechanism. Today's 32 harnesses concentrate coverage on the high-cycle blueprints (to-do, project, finance, cowork) and leave the low-cycle blueprints (boards, journal, meetings, people, products, teams, trips) plus several rendering mechanisms thinly covered or uncovered. The arc:

1. Produces an evidence-based **coverage matrix** scoring every blueprint and mechanism on 6 axes.
2. Ranks gaps with a **risk-weighted formula** so attention goes to high-blast-radius / high-debt / recently-buggy surfaces first.
3. Implements harnesses for the **top three gaps** following a pre-committed gap → archetype decision tree.
4. Lands as a **single PR** at arc close.

The deliverable is not just code — it is the coverage matrix and ranked queue, which any future cycle can re-run to see test-debt drift.

## Scope decisions (recorded from brainstorming)

| Decision | Resolution |
|---|---|
| Decomposition | Audit + first 3 implementation cycles, single mega-plan |
| Branch posture | One long-lived feature branch, one giant PR at arc close |
| Worktree | Dedicated worktree `../sauce-test-coverage`; never leave it |
| Coverage rubric | 6-axis scorecard (customjs / migration / manifest+schema / template / widget / smoke) |
| Prioritization signal | Risk-weighted hybrid (blast_radius × coverage_debt × incident_factor × axis_weight) |
| Gap → archetype routing | Codified in the design as a decision tree; each gap row carries archetype + target_file + estimated_asserts |
| Impl-cycle pre-pick | Deferred: audit must complete before impl-1 design is written (strict phase-gating) |
| Subagent strategy | Fan-out Explore agents one-per-surface for audit; per-step Agent fan-out during impl when independent |

## Architecture & artifacts

**Branch**: `feature/test-coverage-arc` off `main` at workshop v0.118.1.

**Worktree**: `/Users/willfellhoelter/projects/repos/sauce-test-coverage`, created via `git worktree add ../sauce-test-coverage feature/test-coverage-arc`. Stays alive across sessions. All work happens here; the main checkout stays clean. Every Bash, Read, Write, Edit, git command uses this path.

**Artifacts the arc produces** (all checked into the feature branch; no PRs until close):

| Artifact | Path | Phase |
|---|---|---|
| Mega-design (this doc) | `Docs/plans/2026-06-16-test-coverage-arc-design.md` | written now |
| Mega-plan | `Docs/plans/2026-06-16-test-coverage-arc-plan.md` | written next via writing-plans |
| Coverage matrix (machine-readable) | `platform/test/coverage-matrix.json` | Phase 1 output |
| Coverage audit (human-readable) | `Docs/plans/2026-06-16-test-coverage-audit.md` | Phase 1 output |
| Audit regen script | `scripts/regen-coverage-matrix.js` | Phase 1 output |
| Per-cycle impl specs | `Docs/plans/2026-06-16-test-coverage-impl-{1,2,3}-{design,plan}.md` | Phase 2-4 (mid-arc) |
| New / extended harnesses | `platform/test/run-*.js` (per impl cycle) | Phase 2-4 |
| Per-cycle result docs | `Docs/plans/2026-06-16-test-coverage-impl-{1,2,3}-result.md` | Phase 2-4 |
| Per-phase handoff prompts | `Docs/prompts/2026-06-16-post-<phase>-handoff.md` | each phase close |
| Arc-close result | `Docs/plans/2026-06-16-test-coverage-arc-result.md` | close |
| Mega-PR | `feature/test-coverage-arc → main` | close |

**Coverage-matrix structure** (JSON shape, drives both the human audit and future re-audits):

```json
{
  "generated_at": "<workshop_version>",
  "rubric_version": "1.0.0",
  "entries": [
    {
      "kind": "blueprint" | "mechanism",
      "name": "boards",
      "current_version": "1.4.2",
      "axes": {
        "customjs_behavioral": { "score": 0.0, "covered": [], "uncovered": [], "harnesses": [] },
        "installer_migration":  { "score": 0.0, "migrations": [], "covered_in_seed": [] },
        "manifest_schema":      { "score": 0.0, "hc_families": [] },
        "template_lockstep":    { "score": 0.0, "templates": [], "lockstep_asserts": [] },
        "widget_render":        { "score": 0.0, "widgets": [], "renderer_families": [] },
        "integration_smoke":    { "score": 0.0, "smoke_paths": [] }
      },
      "composite_score": 0.0,
      "blast_radius": "high" | "med" | "low",
      "recent_incidents_30d": 0,
      "priority_score": 0.0
    }
  ]
}
```

The human audit is a markdown rendering of the same data (matrix table at top; per-blueprint deep-dive sections below; ranked queue at the bottom).

## The 6-axis scorecard rubric

Each blueprint and mechanism is scored 0.0–1.0 on each axis. Sentinel: `null` means "not applicable to this kind" (e.g. mechanisms that ship no widgets get `widget_render: null`, excluded from the composite mean); `0.0` means "applicable but zero coverage."

### Axis 1 — `customjs_behavioral`

Customjs class methods have behavioral asserts.

- **Population**: every `customjs_classes[]` entry in the blueprint/mechanism manifest. For each class, list public methods (any method not prefixed `_`) from the shipped class file.
- **Coverage signal**: a method counts as covered if `git grep -l '<ClassName>\.<method>\b' platform/test/` finds at least one assert that calls it, OR a runner whose name maps to it (e.g. `run-todo-carryover.js` covers `ToDoDailyCarryover.*`).
- **Score**: `covered_method_count / total_public_method_count`.

### Axis 2 — `installer_migration`

Install-time migrations have a seed family.

- **Population**: every `apply*` function the blueprint contributes to `platform/install.js` (parsed via `git grep "^async function apply" platform/install.js` + blueprint dir grep for installer extensions).
- **Coverage signal**: each `apply*` is covered if `run-seed-migrations.js` contains a `HC-V0XYZ-SEED-MIGRATE-<topic>` family that references it OR if its post-state is asserted by an existing `SHAPE-*` / `FM-*` family.
- **Score**: `covered_migration_count / total_migration_count`. Set to `null` (not `1.0`) if blueprint ships zero migrations — excluded from composite mean rather than vacuously inflating it.

### Axis 3 — `manifest_schema`

Manifest contract + schema registry entries have HC families.

- **Population**: blueprint's `manifest.json` top-level shape + any `schemas-index.json` entries owned by the blueprint.
- **Coverage signal**: `run-helper-cases.js` HC families that assert manifest fields (`name`, `version`, `customjs_classes[]`, `files[]`, `templates[]`, `rule_fragments[]`, `new_entity_buttons[]`, `depends_on[]`) AND `npm run lint-schemas` covers every schema-registry entry.
- **Score**: `(asserted_manifest_field_count / total_manifest_field_count + schemas_covered / schemas_owned) / 2`. Halved-and-averaged so manifest and schema each contribute equally.

### Axis 4 — `template_lockstep`

Templates and rule_fragments stay in lockstep with manifest claims.

- **Population**: every `templates[]` entry and `rule_fragments[]` entry in the manifest.
- **Coverage signal**: there's a harness assert that reads the template/rule-fragment file and checks at least one load-bearing invariant (e.g. expected `customJS.X.render(...)` call present, no banned legacy markers, version pin matches). The v0.117.0 "Write tool silent no-op" bug is the canonical thing this axis catches.
- **Score**: `lockstep_asserted_count / total_count`.

### Axis 5 — `widget_render`

Customjs widgets render without throwing under the DOM stub.

- **Population**: every customjs class with a `render(dv, ...)` method.
- **Coverage signal**: `run-renderer.js` (or a blueprint-specific extension) calls the widget against the DOM stub with at least one fixture and asserts no throw + at least one expected child element.
- **Score**: `rendered_widget_count / total_widget_count`. Set to `null` (not `1.0`) for blueprints/mechanisms that ship no widgets — excluded from composite mean rather than vacuously inflating it.

### Axis 6 — `integration_smoke`

The blueprint's primary user flow is exercised end-to-end.

- **Population**: the blueprint's primary user flow per its README/CLAUDE.md (e.g. "create a daily note → carry over yesterday's todos → mark recurring complete" for to-do; "scaffold a new project → add a doc-note → cross-link a meeting" for project).
- **Coverage signal**: `run-integration-smoke.js`, `run-cowork-smoke.js`, or a blueprint-specific behavioral runner exercises that flow.
- **Score**: `0.0` if no flow exists, `0.5` if a single happy-path is exercised, `1.0` if happy-path + at least one failure-mode is exercised.

### Composite

Simple unweighted mean of the 6 axes (`null` axes excluded from the mean). Weighting is applied in the prioritization formula, not here — keeping rubric and prioritization decoupled.

## Gap → archetype decision tree

When Phase 1 produces the matrix, each `score < 1.0` cell becomes a gap. Each gap routes to one of six archetypes derived from existing harness patterns. Pre-committing the routing so a session resuming cold doesn't relitigate.

```
ROOT: What kind of gap is this?
│
├─ Axis 1 (customjs_behavioral) OR Axis 3 (manifest_schema)
│  │
│  ├─ Pure function, no DOM, no vault I/O, no `customJS.X` lookups
│  │  → ARCHETYPE: hc-family
│  │     Add to: run-helper-cases.js
│  │     Family: HC-V0XYZ-<BLUEPRINT>-<TOPIC>-N
│  │
│  └─ Method with side effects (vault read/write, Notice, dataview lookup) OR
│     manifest fields needing cross-file invariants
│     → ARCHETYPE: behavioral-runner
│        New runner if blueprint has zero dedicated runner today
│        Extension if blueprint already has one
│        File: run-<blueprint>-<topic>.js
│        Pattern: stub Obsidian app/vault/metadataCache; assert post-state
│
├─ Axis 2 (installer_migration)
│  → ARCHETYPE: seed-migrate
│     Add HC-V0XYZ-SEED-MIGRATE-<topic>-N family in run-seed-migrations.js
│     Requires: extend seed-vault/ with input data at pre-migration schema
│     If migration is too new for the seed lineage:
│       → fallback: synthetic mini-vault inline in a new runner
│
├─ Axis 4 (template_lockstep)
│  → ARCHETYPE: template-assert
│     Pattern: read template file via fs; grep for required tokens
│       (e.g. `customJS.X.render(`, version pin, banned markers);
│       assert presence/absence
│     Family: HC-V0XYZ-<BLUEPRINT>-TPL-*
│
├─ Axis 5 (widget_render)
│  │
│  ├─ Widget already reachable via existing smoke/seed paths
│  │  → ARCHETYPE: renderer-extend
│  │     Extend run-renderer.js with a new fixture row
│  │
│  └─ Widget needs more than a fixture row (multi-state, modal interactions)
│     → ARCHETYPE: behavioral-runner (with DOM stub)
│
└─ Axis 6 (integration_smoke)
   │
   ├─ Flow is < 5 steps and fits one blueprint
   │  → ARCHETYPE: smoke-extend
   │     Extend run-integration-smoke.js OR run-cowork-smoke.js
   │
   └─ Flow spans multiple blueprints OR exercises installer + customjs together
      → ARCHETYPE: behavioral-runner
         AND/OR add a HC-V0XYZ-<BLUEPRINT>-SEED-MIGRATE family
```

**Routing metadata**. Every gap row in the matrix carries:
- `archetype`: one of `{hc-family, behavioral-runner, seed-migrate, template-assert, renderer-extend, smoke-extend}`
- `target_file`: existing file to extend OR new file path
- `estimated_asserts`: rough count (informs cycle sizing)
- `prerequisites`: seed-vault extension, DOM stub gap, fixture creation

## Risk-weighted prioritization formula

Applied to every cell with `score < 1.0` to produce the ranked queue.

```
priority_score(gap) =
    blast_radius(blueprint)     ∈ {0.3, 0.6, 1.0}     # low / med / high
  × coverage_debt(gap)          ∈ [0.0, 1.0]          # = 1.0 - axis_score
  × incident_factor(blueprint)  ∈ [1.0, 2.0]
  × axis_weight(axis)           ∈ [0.5, 1.0]
```

**`blast_radius`** — manually scored per blueprint/mechanism in the audit (judgment call; documented one-liner per row):

| Tier | Surfaces (initial assessment; final scoring inside audit) |
|---|---|
| `1.0` high | cowork, to-do, finance, daily, project, scratch, meetings, platform-claude, entity-create, cowork-reconciler, validator |
| `0.6` med | people, products, journal, backlink-panel, activity-feed, nav-buttons, smart-connections-bridge |
| `0.3` low | boards, teams, trips, accent-button, cards, convenience, customjs-guard, icons, kanban-status-sync, people-identity, people-rendering, styling |

**`incident_factor`** — derived: `1.0 + min(1.0, patch_cycles_last_30d × 0.2)`. Look at `Docs/cycle-history.md` for PATCH cycle counts per blueprint over the last 30 days.

**`axis_weight`**:
- `1.0`: installer_migration, customjs_behavioral, template_lockstep (these caught the v0.117.x and v0.116.x bugs)
- `0.75`: integration_smoke, widget_render
- `0.5`: manifest_schema (schema-registry already covers most of this via `lint-schemas`)

**Output**: ranked queue, top-3 become impl-1 / impl-2 / impl-3. Ties broken by alphabetical blueprint name (deterministic, so re-runs of the audit produce stable picks).

## Phase flow + subagent strategy

```
PHASE 0 — Setup
└─ git worktree add ../sauce-test-coverage feature/test-coverage-arc
└─ Worktree becomes the operating directory for every session in the arc.
   Main checkout is never touched.

PHASE 1 — Audit (single-session preferred, multi-session-resumable)
├─ Parallel subagent fan-out: one Explore agent per blueprint + per mechanism
│  Each agent: read manifest, list customjs classes/methods, grep harnesses,
│  list installer migrations, list templates/rule_fragments, list widgets.
│  Returns structured JSON for one row of the matrix.
├─ Main thread: assemble rows → write coverage-matrix.json
├─ Main thread: render human audit markdown from JSON
├─ Main thread: compute priority_score per gap → write ranked queue section
├─ Checkpoint: commit, write Docs/prompts/2026-06-16-post-audit-handoff.md
└─ User review gate before impl-1 brainstorm

PHASE 2 — Impl-1 (the rank-1 gap)
├─ Mini-brainstorm using top-1 row from queue → impl-1-design.md
├─ writing-plans skill invocation → impl-1-plan.md
├─ Subagent execution per plan steps (one Agent per independent chunk;
│  sequential when stepwise)
├─ Run the new/extended harness; preflight stays green
├─ Commit cycle-close impl-1-result.md
└─ Write Docs/prompts/2026-06-16-post-impl-1-handoff.md

PHASE 3 — Impl-2 (rank-2 gap, same shape as Phase 2)
PHASE 4 — Impl-3 (rank-3 gap, same shape as Phase 2)

PHASE 5 — Arc close
├─ Re-run audit script → matrix.json refreshed → compare composite scores
│  before/after; the result doc embeds the delta table
├─ Commit arc-result.md
├─ Open ONE PR: feature/test-coverage-arc → main
└─ Worktree stays alive until PR merges; then `git worktree remove`
```

**Subagent contract**:

- **Audit fan-out (Phase 1)**: one `Explore` subagent per (blueprint or mechanism). Self-contained prompt with rubric definitions + target name. Returns JSON row. Run in parallel via single-message multi-Agent calls. ~31 subagents in one fan-out, well within the runtime cap.
- **Implementation chunks (Phase 2-4)**: when a plan step is independent (e.g. "write new harness file" + "extend fixture" + "wire into release:preflight"), one Agent per chunk. When stepwise (read → modify → verify), main session handles it.

**Worktree discipline**: every Bash, Read, Write, Edit, git command in the arc uses the worktree path. Never `cd` out. Slash commands or scripts that need a vault target get the worktree path explicitly.

## Handoff protocol (cold-resume from any session)

Every phase boundary produces a handoff prompt at `Docs/prompts/2026-06-16-post-<phase>-handoff.md`:

```markdown
---
phase_closed: <name>
phase_next: <name>
worktree: ../sauce-test-coverage
branch: feature/test-coverage-arc
arc_design: Docs/plans/2026-06-16-test-coverage-arc-design.md
arc_plan: Docs/plans/2026-06-16-test-coverage-arc-plan.md
---

# Next session resume

## Where you are
- Worktree: /Users/willfellhoelter/projects/repos/sauce-test-coverage
- Branch: feature/test-coverage-arc
- Just closed: <phase>
- Current preflight: <pass/fail summary>

## What just shipped (this phase)
- <bullet list>

## What's next
- Phase X — <name>
- Open the impl-<N> design at <path>
- Skill to invoke first: <brainstorming | writing-plans | executing-plans>

## Carry-forwards from this phase
- <bullet list of anything noticed but not addressed>

## Hard constraints (don't violate)
- Stay in the worktree at all costs
- Don't open per-phase PRs — one giant PR at arc close
- Re-read arc-design.md if anything feels ambiguous
- Subscribe to user-review gates between phases
```

Anything in the user's head between sessions (priorities, scope changes, blockers) lives in this prompt — not in chat history.

## Done criteria

Arc is done when:

1. `coverage-matrix.json` exists with all 13 blueprints + 18 mechanisms scored.
2. Three impl cycles closed; each contributes ≥ +0.15 composite score lift to its targeted blueprint.
3. `npm run release:preflight` passes with the new harnesses included.
4. Re-running the audit script shows the post-arc matrix delta in `arc-result.md`.
5. `Docs/prompts/2026-06-16-post-arc-handoff.md` written for follow-on cycles.

**Mega-PR shape**: title `feat(workshop): test-coverage arc — audit + 3 high-priority gaps`. Body links the design, the plan, the audit doc, and the three result docs. CI must pass; no other gating.

## Out of scope (explicitly)

- Adding any new blueprint feature beyond what the test harnesses require.
- Rewriting any existing harness; only extending.
- Closing > 3 implementation cycles (further gaps queue as v0.119.x+ work after merge).
- Touching consumer vaults during the arc; brew deploy waits until PR merges.
- Modifying the schema registry (Stage B work stays parked).

## Open questions for review

None blocking. Open to revision on:
- The `blast_radius` initial tiering — final scoring happens inside the audit, where each row's tier carries a one-liner rationale.
- The `axis_weight` calibration — set from recent-incident evidence (v0.117.x, v0.116.x); revisit if Phase 1 surfaces a different bug-pattern signal.
