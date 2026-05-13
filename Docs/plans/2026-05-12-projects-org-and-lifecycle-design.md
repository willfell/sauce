---
title: Projects Org-Chart + Lifecycle — Design
date: 2026-05-12
version_target: v0.39.0 (foundation), v0.40.0 (polish + sharp ops)
status: design-locked
supersedes: undifferentiated card grid in `spice/projects/Projects.md`; absence of project status, archive semantics, and cross-project relationship vocabulary
---

# Projects Org-Chart + Lifecycle — Design

> [!abstract] Goal
> Make the projects hub organize-able, filterable, and grounded in a lightweight org-chart of **Products** and **Teams**. Give every Project a 7-state lifecycle (status) and the action surface to move through it. Add a per-project **Brainstorm** companion note. Handle scope creep via explicit relationship vocabulary (`parent_project`, `related_projects`, `superseded_by`) rather than destructive merge. Ship over two cycles: v0.39.0 lays the org + lifecycle foundation; v0.40.0 layers on relationships, brainstorm, rename, delete.

> [!info] Driving inputs
> - User brainstorm 2026-05-12 (this session): "better organize the data in projects, structure the hub, filter, group by teams, archive completed projects, combine/relate projects, per-project brainstorm space, action buttons"
> - Cardinality decision: a Project can consist of multiple Teams AND multiple Products; a Team belongs to exactly 1 Product
> - Packaging decision: three separate blueprints (P2) — products and teams are reusable across blueprints (meetings, finance, journal can reference them)
> - Existing precedent inside pantry: `people@0.1.1` flat-entity blueprint pattern (`spice/people/<First Last>.md`); `project@1.5.0` Templater-driven new-X flow with auto-promote folder pattern; `cards@0.2.4` shared hub-card rendering; `nav-buttons@2.6.0` action-button registry; `validator@0.1.2` rule_fragment shape (`equals`, `matches`, `contains` predicates available; `equals_one_of` NOT yet available — using regex `matches` for the status enum is sufficient and avoids a validator bump)

---

## 1. Decisions locked

| Question | Decision |
|---|---|
| **(a) Mental model** | Organize, don't capture. Focus on existing project data: structure, filter, group, lifecycle. (Idea-capture / inbox flow deferred — not this cycle.) |
| **(b) Grouping richness** | G2/G3 hybrid — first-class wikilink sub-entities for Teams and Products. Soft tag (`area:`) deferred. |
| **(c) Cardinality** | Product 1:N Team (strict, validator-enforced). Project M:N Teams (optional). Project M:N Products (optional, independent of teams). |
| **(d) Packaging** | Three separate blueprints — `products@0.1.0`, `teams@0.1.0`, `project@1.6.0` (MINOR). Each owns its own `spice/<dir>/` module directory. Honors module-directory invariant; maximizes reuse across vault. |
| **(e) Status enum** | 7 states: `idea \| planning \| in-progress \| blocked \| superseded \| cancelled \| done`. Active in hub by default: `idea \| planning \| in-progress \| blocked`. Terminal (hidden by default): `superseded \| cancelled \| done`. Default on `New Project`: `idea`. |
| **(f) Teams/Products on Project** | Both optional. A bare idea-mode project carries `teams: []`, `products: []` and the validator stays silent. |
| **(g) Hub progress signal** | Status histogram chip only (`3 in-progress · 2 planning · 1 blocked · 2 done`). No progress bar — implies a finite end-state, wrong for ongoing teams/products. |
| **(h) Default group-by on Projects.md** | `status` (gives the kanban-flavored sections directly addressing "wall-of-equal-cards" pain). Toggle: `none \| status \| team \| product \| parent_project`. |
| **(i) Rename safety** | Rename hub note via Obsidian's rename API (inbound wikilinks auto-update). Folder slug stays put — decouples display name from path so dataview-by-path queries don't break. Tradeoff: folder name can drift from display over time. Acknowledged. |
| **(j) Delete safety** | Two-step confirm modal — "Show impact" (inbound wikilink count + folder contents summary) → "Confirm delete". No silent action. |
| **(k) Cross-link validator** | Out of scope. Today's validator checks shape only; "wikilink must resolve to a `type:product` note" is a future enhancement candidate. |
| **(l) Cycle split** | Two cycles. v0.39.0 = foundation (org-chart + status + hub upgrades + Tier 1 status/team/product buttons). v0.40.0 = relationships + brainstorm + Tier 2 sharp ops. Each cycle is independently reviewable and delivers standalone user value. (Slots originally drafted as v0.37.0/v0.38.0; reslotted after discovering repo is at workshop_version 0.38.1 — three undocumented cycles closed since CLAUDE.md last refresh.) |

---

## 2. Data model

```
Product ◄── 1:N ── Team         (Team belongs to exactly 1 Product — validator-enforced)
Product ◄── M:N ── Project      (Project carries products: [[P]], [[Q]])
Team    ◄── M:N ── Project      (Project carries teams:    [[A]], [[B]])
Project ◄── tree ── Project     (parent_project, single, optional)
Project ◄── peer ── Project     (related_projects[], multi, optional)
Project ◄── merge ── Project    (superseded_by, single, optional; tied to status: superseded)
```

Asymmetry rationale: a Team must belong to one Product (org-chart constraint); a Project floats freely (can touch many teams AND many products, and the two sets need not be consistent — e.g., a project may use the "Sauce" product but not involve the Sauce team).

Rollup queries (the "see progress on teams" payoff):
- **Team page** → projects where `teams` contains this team
- **Product page** → two queries unioned: (a) projects where `products` contains this product (direct membership), (b) projects whose `teams` includes any team where `product == this product` (transitive membership)
- **Product page** → teams where `product == this product`

---

## 3. Three blueprints

### 3.1 NEW `products@0.1.0`

**Layout**
- `spice/products/<Name>.md` — one note per product
- `spice/products/Products.md` — hub

**Required frontmatter on a Product note**
```yaml
type: product
name: "<string>"
created: YYYY-MM-DD
tags:
  - product
```

Naming pattern (validator): `^[A-Z][\w '\-&]+\.md$`

**Hub `Products.md`**
- Card grid of all products (`type:product` query)
- Each card: name, description, **team count**, **active-project count**, last-touched recency
- Sort: by recent activity (most-recently-touched-project first); alphabetical tiebreaker
- Search-by-name input
- Action button: **New Product**

**Per-Product page rollup** (rendered below user-authored body of each `spice/products/<Name>.md`):
- **Teams under this Product** — cards
- **Projects touching this Product** — cards (direct ∪ transitive), grouped by status, respecting default-active filter

**Manifest essentials**
- `module_directory: products`, `depends_on`: nav-buttons, customjs-guard, cards
- `customjs_classes`: `ProductsHubCards`, `ProductPageCards`, `ProductActionButtons`
- `claude_surface`: `/products` command, `new-product` skill, resolvers row
- Global `nav_buttons`: "Products" jump button

### 3.2 NEW `teams@0.1.0`

**Layout**
- `spice/teams/<Name>.md`
- `spice/teams/Teams.md` — hub

**Required frontmatter on a Team note**
```yaml
type: team
name: "<string>"
created: YYYY-MM-DD
tags:
  - team
product: "[[<Product Name>]]"   # REQUIRED — validator-enforced
```

Naming pattern: same shape as products.

**Hub `Teams.md`**
- Cards **grouped by Product** (section header per product)
- Each card: team name, description, **active-project count**, **status histogram chip** (`3 in-progress · 2 planning · 1 blocked · 2 done`)
- Filter chip: by product (multi-select)
- Search-by-name input
- Action button: **New Team**

**Per-Team page rollup**:
- **Sibling Teams** — other teams under same product
- **Projects this Team is on** — cards, grouped by status

**Manifest essentials**
- `module_directory: teams`, `depends_on` adds `products>=0.1.0`
- `customjs_classes`: `TeamsHubCards`, `TeamPageCards`, `TeamActionButtons`
- `claude_surface`: `/teams` command, `new-team` skill, resolvers row
- Global `nav_buttons`: "Teams" jump button

### 3.3 `project@1.5.0 → 1.6.0` (MINOR, v0.39.0) → `1.7.0` (MINOR, v0.40.0)

`depends_on` adds `teams>=0.1.0`, `products>=0.1.0`.

**NEW frontmatter fields on Project hub notes (v0.39.0 unless noted)**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `status` | string enum | YES | `idea` | One of 7 states (see §1e). Validator: `matches ^(idea\|planning\|in-progress\|blocked\|superseded\|cancelled\|done)$` |
| `status_changed_at` | string (YYYY-MM-DD) | YES | `{{DATE}}` at creation | Auto-stamped on every status flip via Bump Status button |
| `teams` | list of wikilinks | NO | `[]` | Empty OK |
| `products` | list of wikilinks | NO | `[]` | Empty OK |
| `parent_project` | wikilink | NO | absent | **v0.40.0**. Single. |
| `related_projects` | list of wikilinks | NO | `[]` | **v0.40.0**. |
| `superseded_by` | wikilink | NO | absent | **v0.40.0**. Single. Soft cross-field warn: if set, `status` should be `superseded` (and vice versa) — validator warns, doesn't error. |

**Existing fields unchanged**: `type`, `name`, `created`, `description`, `tags`, `workstreams` (note: `workstreams` are project-internal threads, NOT teams — naming-collision risk; calling out in §9).

**Template `Template, Project.md` updated (v0.39.0):**
```yaml
---
type: project
name: "{{NAME}}"
created: {{DATE}}
status: idea
status_changed_at: {{DATE}}
description: ""
tags:
  - project
  - project/{{SLUG}}
  - {{DATE_TAG}}
workstreams: []
teams: []
products: []
---
```

New-project Templater flow additionally materializes (v0.40.0):
- `spice/projects/<slug>/Brainstorm.md` from `Template, Project Brainstorm.md`

---

## 4. Projects hub upgrades (`spice/projects/Projects.md`)

**v0.39.0 capabilities** (rendered by upgraded `ProjectsHubCards`):
- Default scope: non-terminal statuses (`idea | planning | in-progress | blocked`); terminal (`superseded | cancelled | done`) hidden behind a chip toggle
- Filter chips at top:
  - **Status** (7 chips, multi-select; default-on: 4 active statuses)
  - **Team** (multi-select, populated from `spice/teams/`)
  - **Product** (multi-select, populated from `spice/products/`)
- **Group-by toggle**: `none | status | team | product` — default **`status`**
- Within-group sort: status-priority order (`in-progress > planning > blocked > idea > done > superseded > cancelled`), then `status_changed_at` desc
- Search-by-name input (substring filter on `name` frontmatter)
- Card layout (per card): name, **status pill**, description, team chips, product chips, last-touched recency stamp

**v0.40.0 additions**:
- Group-by toggle adds `parent_project` (sub-projects nest visually under their parent card)
- Sub-project nesting display (children indent under parent card when grouped by parent_project)

---

## 5. Project action surface (`ProjectActionButtons`)

Rendered as accent-button-styled action row on every `type:project` hub note. Split into safety tiers.

### 5.1 Tier 1 — frontmatter-only (no confirm needed)

| Button | Ships | Action |
|---|---|---|
| **Bump Status** | v0.39.0 | 7-option picker; writes `status:` + auto-stamps `status_changed_at: <today>` |
| **Set Teams** | v0.39.0 | Multi-select against `spice/teams/`; writes `teams: [[A]], [[B]]` |
| **Set Products** | v0.39.0 | Multi-select against `spice/products/`; writes `products:` |
| **Set Parent** | v0.40.0 | Single picker against other Projects (excludes self + descendants); writes `parent_project: [[X]]` |
| **Add Related** | v0.40.0 | Picker; appends to `related_projects: []` |
| **Mark Superseded By** | v0.40.0 | Picker against other Projects; writes `superseded_by: [[Y]]` AND flips `status: superseded` in one shot, stamps `status_changed_at` |
| **Open Brainstorm** | v0.40.0 | Nav-jump to `<slug>/Brainstorm.md` |

### 5.2 Tier 2 — filesystem ops (confirm modal required) — v0.40.0

| Button | Action | Risk surface |
|---|---|---|
| **Rename** | Input modal → renames hub note via Obsidian's rename API (inbound wikilinks auto-update). Folder slug stays put. | Folder name drifts from display name over time. Acknowledged tradeoff (avoids dataview-by-path breakage). |
| **Delete** | Two-step: (1) "Show impact" — inbound wikilink count + folder contents summary, (2) "Confirm delete" removes folder. | Irreversible. Sauce's "ask before acting" applies; the two-step is the explicit ask. |

---

## 6. Brainstorm companion (v0.40.0)

NEW template `Template, Project Brainstorm.md` at `{{templates_path}}/`. Auto-materialized at project creation → `spice/projects/<slug>/Brainstorm.md`.

**Frontmatter**
```yaml
type: project-brainstorm
created: YYYY-MM-DD
project: "[[<HUB>]]"
```

**Default body sections**
- `## Ideas`
- `## Open Questions`
- `## Mechanisms`
- `## Constraints`
- `## Decisions Captured`

**Navigation**
- Nav-button on Project hub jumps to Brainstorm
- Nav-button on Brainstorm jumps back to hub

**Hub treatment**
- NOT rendered as a card on `Projects.md` (project-internal, not a peer project)
- Lives forever with the project; archived/deleted alongside

---

## 7. Relationship surfaces (`ProjectRelationships`, v0.40.0)

Composite renderer on every `type:project` hub, below the existing Workstreams section.

- **Parent / Children**
  - If `parent_project` set: breadcrumb `↑ [[Parent]]`
  - Always: `Children:` cards (queries projects where `parent_project == this hub`)
- **Related**
  - Chips from `related_projects[]`
  - Bidirectional in display: also shows projects whose `related_projects[]` includes this hub (no frontmatter auto-mirror; display logic only)
- **Supersession**
  - If `status: superseded` + `superseded_by` set: callout *"Superseded by [[X]] on YYYY-MM-DD"* with jump link
  - If other projects supersede into this one: section *"Absorbed:"* with cards of projects where `superseded_by == this hub`

---

## 8. Validator rules

### 8.1 NEW products rule_fragment

```json
{
  "scope": { "path_glob": "spice/products/*.md", "exclude_basenames": ["Products.md"] },
  "required_frontmatter": {
    "type":    { "required": true, "type": "string", "equals": "product" },
    "name":    { "required": true, "type": "string" },
    "created": { "required": true, "type": "string", "matches": "^\\d{4}-\\d{2}-\\d{2}$" }
  },
  "required_tags": [{ "tag": "product" }],
  "naming_pattern": "^[A-Z][\\w '\\-&]+\\.md$"
}
```

### 8.2 NEW teams rule_fragment

```json
{
  "scope": { "path_glob": "spice/teams/*.md", "exclude_basenames": ["Teams.md"] },
  "required_frontmatter": {
    "type":    { "required": true, "type": "string", "equals": "team" },
    "name":    { "required": true, "type": "string" },
    "created": { "required": true, "type": "string", "matches": "^\\d{4}-\\d{2}-\\d{2}$" },
    "product": { "required": true, "type": "string" }
  },
  "required_tags": [{ "tag": "team" }],
  "naming_pattern": "^[A-Z][\\w '\\-&]+\\.md$"
}
```

### 8.3 Extended project rule_fragment (v0.39.0 + v0.40.0 fields)

```json
{
  "scope": { "path_glob": "spice/projects/*/*.md" },
  "frontmatter_branch": [
    {
      "when": { "frontmatter": { "type": "project" } },
      "required_frontmatter": {
        "created":           { "required": true,  "type": "string" },
        "description":       { "required": true,  "type": "string" },
        "workstreams":       { "required": true,  "type": "list" },
        "status":            { "required": true,  "type": "string", "matches": "^(idea|planning|in-progress|blocked|superseded|cancelled|done)$" },
        "status_changed_at": { "required": true,  "type": "string", "matches": "^\\d{4}-\\d{2}-\\d{2}$" },
        "teams":             { "required": false, "type": "list" },
        "products":          { "required": false, "type": "list" },
        "parent_project":    { "required": false, "type": "string" },
        "related_projects":  { "required": false, "type": "list" },
        "superseded_by":     { "required": false, "type": "string" }
      },
      "required_tags": [{ "tag": "project" }]
    }
  ]
}
```

Uses today's `matches` regex predicate for the status enum — no validator bump needed. (Future `equals_one_of` predicate is a candidate enhancement but not a prerequisite.)

Cross-field warnings (logged, non-blocking, future enhancement to be wired into validator):
- `status == superseded` ⇒ `superseded_by` should be set
- `superseded_by` set ⇒ `status` should be `superseded`

---

## 9. Open questions / FIX-LATER candidates

| # | Item | Disposition |
|---|---|---|
| Q1 | Cross-link validator — confirm a Team's `product` wikilink resolves to a `type:product` note (and similar for Project's `teams`/`products`). Possible v0.40.0+ validator enhancement. | DEFERRED |
| Q2 | Stale-team / stale-product detection — `/audit` flags projects linking nonexistent `[[Team]]`. | DEFERRED |
| Q3 | Status transition constraints — should `done → idea` be disallowed? v0.39.0 allows all transitions; future tightening possible. | DEFERRED |
| Q4 | Workstream vs Team naming collision — `workstreams` (project-internal threads) and `teams` (org-chart entities) are easy to confuse. CLAUDE.md callout in v0.39.0 ship notes. | DOCUMENT |
| Q5 | Bidirectional `related_projects` auto-mirror — risks edit-loops; v0.40.0 keeps manual + display-bidirectional. | DEFERRED |
| Q6 | Brainstorm cross-project — should multiple projects share a Brainstorm? v0.40.0 = one-per-project. If demand surfaces, links back to the deferred idea-capture / inbox thread. | DEFERRED |
| Q7 | `equals_one_of` validator predicate — cleaner than regex-alternation for enums. MINOR validator bump candidate. | DEFERRED |
| Q8 | Rename: full folder rename + dataview-path audit — alternative to "rename hub-note only" if/when dataview-by-path queries become rare. | DEFERRED |
| Q9 | Inbound-link impact preview for Delete — vault-wide grep performance on 10k+ note vaults. Acceptable for v0.40.0 scope. | ACCEPT |

---

## 10. Migration

NEW CLI verb `sauce migrate-projects` ships in v0.39.0.

**Behavior**
- Walk every `spice/projects/*/*.md` matching `type:project` in the target vault
- If `status` field absent: write `status: in-progress` (most conservative — assumes pre-existing projects are live work, not idea-mode captures)
- If `status_changed_at` field absent: write `status_changed_at: <created>` (preserves history if `created` exists; else `<today>`)
- Idempotent: re-running on an already-migrated vault is a no-op
- Prints per-vault count: `"N projects migrated, M already had status."`
- Flag: `--dry-run` (preview only, no writes)

**Rollout**
- Workshop self-runs `sauce migrate-projects` as part of v0.39.0 dogfood
- Consumer flow: `git pull && sauce reinstall --vault <path> && sauce migrate-projects --vault <path>`
- Install Notice in v0.39.0 surfaces the required migration step loud-and-clear

---

## 11. Cycle decomposition

### v0.39.0 — Foundation (target close ~2026-05-14)

**NEW**
- `products@0.1.0` blueprint (manifest, templates, hub, helpers, claude_surface, nav-buttons)
- `teams@0.1.0` blueprint (manifest, templates, hub, helpers, claude_surface, nav-buttons)
- CLI verb `sauce migrate-projects` (new module `platform/cli/migrate-projects.js` + harness `platform/test/run-migrate-projects.js`)
- α-seeds for products + teams (declarative seed fixtures under `platform/seed/`, mirroring v0.38.0 project/daily/meetings α-seed pattern)

**CHANGED**
- `project@1.5.0 → 1.6.0` (MINOR) — adds `status`, `status_changed_at`, `teams[]`, `products[]` frontmatter + Tier 1 buttons (Bump Status, Set Teams, Set Products) + hub filter chips + group-by toggle + status pill + team/product chips. Re-seed project α-seed to include the new fields.
- `cards@0.2.4 → 0.2.5` (PATCH, if needed) — extends card cell renderers for status pill, chip cells, last-touched recency. Only if the current shared cell API isn't enough. (Eval during S1 of v0.39.0.)
- Workshop subscription: +products, +teams entries; bump project to 1.6.0
- `workshop_version 0.38.1 → 0.39.0`
- `package.json` version bump (gated by existing `check-version-sync.js`)
- `run-integration-smoke.js`: +N cases for products/teams roundtrip via `sauce seed` + install + validator

**Harnesses to extend / add**
- `run-helper-cases.js`: +new install paths for products/teams blueprints, +new fields on project rule_fragment
- `run-cli.js`: +M-cases (migrate-projects), +S-cases (sauce seed with products/teams kinds)
- `run-seed.js`: +α-seed sub-asserts for products + teams (mirrors existing project α-seed cases)
- `run-integration-smoke.js`: +expectation counts (new note types from products + teams seeds)
- NEW `run-migrate-projects.js` (dedicated harness — mirrors `run-migrate.js` pattern)
- `release:preflight` npm script: includes the new harness automatically (it's a wildcard expander) — verify after S1

### v0.40.0 — Lifecycle polish + brainstorm + sharp ops

**CHANGED**
- `project@1.6.0 → 1.7.0` (MINOR; new template + new customjs class + new manifest fields warrants MINOR)
  - NEW `parent_project`, `related_projects[]`, `superseded_by` frontmatter
  - NEW `Template, Project Brainstorm.md`
  - Auto-create Brainstorm at project creation
  - NEW customjs class `ProjectRelationships`
  - ProjectActionButtons extended: Set Parent, Add Related, Mark Superseded By, Open Brainstorm (Tier 1); Rename, Delete (Tier 2)
  - Group-by toggle adds `parent_project`
- `workshop_version 0.39.0 → 0.40.0`

**Why split this way**
- v0.39.0 alone makes `Projects.md` dramatically more useful — coherent standalone ship (team/product structure, status lifecycle, hub organization).
- v0.40.0 layers on relationship UX + brainstorm + the riskier filesystem buttons — best done with v0.39.0 baked in dogfood so the patterns are stable.
- Mirrors recent sauce cadence (v0.36.0 → v0.36.1 patch; v0.38.0 → v0.38.1 patch). Each cycle reviewable in one pass.

---

## 12. Non-goals (v0.39.0 + v0.40.0)

- Cross-blueprint attribute system (a future cycle could promote `status` / `teams` / `products` into a shared `attributes` registry — brainstorm-thread A, out of scope here)
- Idea-capture / inbox / triage pipeline (brainstorm-thread B, deferred)
- Multi-layout views on `Projects.md` (no table view, no calendar view; card grid + filter chips + group-by is the contract)
- Hard merge — destructive consolidation of one project into another with task migration. `superseded_by` gives the safe shape; hard merge is risky and YAGNI for now.
- Validator extension to check that a wikilink resolves to a specific note type (link_target_type rules); future enhancement candidate.
- Tag-style soft grouping (e.g., `area: "personal"`) — wikilink sub-entities are richer; tag layer can be added later if the user demand surfaces.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Existing projects fail validator until migration runs | `sauce migrate-projects` ships in v0.39.0; loud Install Notice; idempotent; dry-run preview flag |
| Folder name drifts from display name over time (Rename only touches hub note) | Acknowledged tradeoff; avoids dataview-by-path breakage. Full-folder-rename can be a future cycle if drift becomes a real problem |
| Delete impact-preview is slow on huge vaults (10k+ notes) | Acceptable for v0.40.0 scope; vault-walking happens only on explicit "Show impact" click; users can cancel |
| `workstreams` vs `teams` naming collision confuses new users | CLAUDE.md callout in v0.39.0 ship notes; install Notice flags both concepts; future cycle could rename `workstreams` to `tracks` or similar if confusion persists |
| First-time consumer install of v0.39.0 + the two new blueprints touches many files | Standard sauce install posture (failure-loud, idempotent, backup-on-edit per landmine #12); workshop dogfoods first |
| **CLAUDE.md "Status (live)" section is stale by 3 cycles** (last refresh = v0.36.1; actual repo = v0.38.1 with `sauce seed`, integration-smoke, release-preflight, version-sync gate, macOS+Linux CI matrix, people α-seed all shipped but unmentioned) | Out-of-scope for v0.39.0 itself; flag to user for a separate CLAUDE.md refresh pass — ideally before v0.39.0 close so the v0.39.0 status entry can rest on a clean baseline |
