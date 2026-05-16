---
type: workstream-design
workstream: frontmatter-alignment
title: Frontmatter Alignment — multi-cycle spec
status: design-approved
date: 2026-05-16
cycles: FA-1 through FA-9
inventory_artifact: Docs/plans/2026-05-16-frontmatter-audit-inventory.md
project_board: spice/projects/sauce/tasks/Frontmatter Alignment/board/Frontmatter Alignment-board.md (in consumer vaults)
---

# Frontmatter Alignment — Design

A multi-cycle workstream that aligns frontmatter across all 13 sauce blueprints onto a canonical vocabulary, builds the migration + validation infrastructure to enforce it, and then deploys the cross-blueprint glue (backlink panels, activity feeds, project rollups) the canonical vocab unlocks.

## Why

Today the workshop has **52 distinct frontmatter keys** spread across 13 blueprints, with three classes of problems:

1. **Format drift** — `created:` is in 10/13 blueprints but uses three different formats (`YYYY-MM-DD`, `YYYY-MM-DD HH:mm`, full ISO-8601). Cross-blueprint timeline queries are impossible without coercion shims.
2. **Semantic clashes** — `month:` means a friendly label string in cowork but `YYYY-MM` in finance. `attending:` on trips and `attendees:` on meetings express the same concept (people involved) with different keys. `product:` is singular on teams but `products:` is plural on project.
3. **Tag overload** — `tags:` is used three ways at once: discriminator (`tags: [meeting]`), category (`tags: [finance, work]`), temporal bucket (`tags: [2026/05/16]`). Since `type:` is already the canonical discriminator (12/13 blueprints), the overload is pure technical debt.

The audit-inventory artifact (`Docs/plans/2026-05-16-frontmatter-audit-inventory.md`) captures the full key-by-key state per blueprint and is the ground-truth reference for the decisions below.

**End goal:** any note in any blueprint can be queried by canonical keys (`created_at`, `type`, `people`, `projects`, `teams`, `products`, `trips`, `meetings`) with predictable formats and quoted wikilink shapes. Every entity page (Person, Project, Team, Product, Trip) auto-renders a backlinks panel showing what mentions it. A "Today" surface pulls daily + meetings + scratches into one feed.

## Audit summary

Pulled from the inventory artifact:

- **Universal:** `tags:` (13/13) — overloaded across 3 roles
- **Near-universal:** `type:` (12/13 — gap is `to-do`), `created:` (10/13 — format-inconsistent)
- **Frequent:** `name:` (6), `description:` (6), `cssclasses:` (5)
- **Maturity gap:** Only 5/13 blueprints adopt `entity-create`; 8 still use nav-button + Templater. Only 8/13 have `rule_fragments` enforcing required keys. No blueprint tracks `created_by:` or `updated_at:`.
- **Glue keys partially in flight:** `attendees:` (meetings → people), `teams:` / `products:` / `workstreams:` (project), `daily_note:` (journal → daily), `task_parent:` / `source_board:` (sub-task → parent project), `product:` singular (teams → product).

## §A. Canonical frontmatter vocabulary

### 1. Discriminator (REQUIRED everywhere)

| Key | Format | Notes |
|---|---|---|
| `type` | string, kebab-case singular | Already 12/13 — backfilled by migration on `to-do`. Allowed values are the blueprint-emitted type names: `meeting`, `person`, `project`, `product`, `team`, `trip`, `budget`, `paycheck`, `invoice`, `daily`, `journal`, `scratch`, `scratch-day`, `cowork-daily`, `cowork-weekly`, `cowork-monthly`, `to-do`, `board`. New blueprints add their type to this list. |

### 2. Audit triplet

REQUIRED on every entity-create-emitted note. Optional but recommended on timeline-emitted notes (daily / scratch / cowork-daily).

| Key | Format | Notes |
|---|---|---|
| `created_at` | ISO-8601 with TZ, quoted: `"2026-05-16T08:27:00-07:00"` | Renamed from `created`. Migration verb reformats existing values. |
| `updated_at` | ISO-8601 with TZ, quoted | NEW. Optional. Future cycle may wire a Templater on-save hook to maintain. |
| `created_by` | quoted wikilink: `"[[Will Fellhoelter]]"` | NEW. Optional. Useful once multi-user vaults or AI-created notes need attribution. |

### 3. Canonical cross-ref keys

Plural-typed wikilink lists; the only 6 entity targets that get a canonical key:

| Key | Target type | Format |
|---|---|---|
| `people` | `type: person` | `["[[Alice]]", "[[Bob]]"]` |
| `projects` | `type: project` | Same shape |
| `teams` | `type: team` | Same shape |
| `products` | `type: product` | Same shape |
| `trips` | `type: trip` | Same shape |
| `meetings` | `type: meeting` | Same shape |

**Always plural lists**, even with one item (`projects: ["[[Sauce]]"]`, not `project: "[[Sauce]]"`). Uniform Dataview shape across blueprints:

```js
dv.pages().where(p =>
  p.people?.some(link => link.path === dv.current().file.path)
)
```

Timeline-shaped blueprints (daily, journal, scratch, cowork, to-do, boards) **emit** these keys but never get a canonical key pointing AT them. They're discovered via the reverse query above.

### 4. Semantic narrowings (per-blueprint, layered on top)

| Blueprint | Narrowing | Relationship to canonical |
|---|---|---|
| meetings | `attendees: ["[[X]]"]` | Subset of `people:` — those who actually came. Both keys live on the note. |
| project | `status:`, `workstreams: ["string", ...]` | Domain enum + string list. Not canonical. |
| journal | `daily_note: "[[Daily-X]]"` | Single-wikilink narrowing (1:1 by definition). |
| scratch | `day: "YYYY-MM-DD"`, `day_link: "[[Scratch-Day-X]]"` | Routing + back-link narrowings. |
| people | `aliases:`, `company:`, `location:`, `title:`, `email:`, `website:`, `phone:` | Identity & contact. Unchanged. |
| trips | `start_date:`, `end_date:`, `location:` | Date ranges in `YYYY-MM-DD` + free-text location. |
| finance | `entries:`, `categories:`, `expenses:`, `month: "YYYY-MM"` | Domain. |
| teams | (none after renames — `product:` → `products:`) | — |
| cowork | `month_label:` (cowork's friendly month string, renamed from `month`) | Separates the friendly label from the canonical `month: "YYYY-MM"`. |

### 5. Tags vocabulary

- `tags:` is **user-controlled categorization only**. Free-form.
- Migration strips: discriminator tags (`[meeting]`, `[person]`, etc.) + temporal tags (`[2026/05/16]`, `[2026/05]`, `[2026]`).
- Preserved-tags allowlist (functional markers not user-categorization): `kanban-card`, `project-card`, `task-board-card`, `task-board`, `kanban-plugin`. These are required by the Kanban plugin or by existing dataview queries.
- **Going forward**, blueprints that need a frontmatter marker should add a domain-specific key rather than a `tags:` entry. (Acknowledged exception: Obsidian Kanban plugin convention.)

### 6. Resolved clashes

| Clash | Resolution |
|---|---|
| `month:` (cowork friendly string vs finance `YYYY-MM`) | Cowork's friendly-month label moves to `month_label`. Finance keeps `month: "YYYY-MM"` as canonical. |
| `aliases:` (people vs project) | Both mean Obsidian-native alternate display names. No real clash. Keep. |
| `name:` vs `title:` | Drop `name:` where it duplicates filename. Keep where it carries data the filename can't (e.g., a person's full name distinct from a slugified file). |
| `attending:` (trips) vs `people:` | Migrate trips to canonical `people:`. `attending:` retired. |
| `product:` singular (teams) | Migrate to `products:` plural list. |
| `date:` semantics | Per-blueprint format enforcement via rule_fragments: meetings → ISO-8601 with TZ; trips/cowork → `YYYY-MM-DD`; finance → `YYYY-MM-01` (month anchor). |
| `kanban-plugin:` | UNCHANGED. Obsidian Kanban plugin owns this key. |

### 7. Retired keys (post-migration)

- `created:` → renamed to `created_at`
- `attending:` (trips) → renamed to `people:`
- `product:` (teams, singular) → renamed to `products:` (plural list)
- Discriminator entries in `tags:` → stripped
- Temporal entries in `tags:` → stripped
- `name:` where it duplicates filename → per-blueprint case-by-case

## §B. Cross-cutting infrastructure (FA-1 deliverables)

Foundation cycle ships infrastructure only. **Zero blueprint manifest changes.** After FA-1, the canonical vocab is documented + enforced + measurable, even though no blueprint has migrated yet.

### 1. `sauce migrate-frontmatter` CLI verb

**Code location:** `platform/cli/cmd-migrate-frontmatter.js`, dispatched from `sauce-cli.js`. Mirrors the v0.38.0 `sauce seed` posture (context-free branch, vault-resolved via registry).

**Migration rules location:** `platform/migrations/v<n>-frontmatter.json` (NEW central declarative spec). Schema:

```json
{
  "version": "<workshop_version_at_ship>",
  "renames": [
    { "from": "created", "to": "created_at", "coerce": "iso8601-with-tz" },
    { "from": "attending", "to": "people", "scope": { "type": "trip" } },
    { "from": "product", "to": "products",
      "scope": { "type": "team" }, "coerce": "wrap-as-list" },
    { "from": "month", "to": "month_label",
      "scope": { "type": "cowork-monthly" } }
  ],
  "date_reformat": ["created_at", "updated_at", "date",
                    "start_date", "end_date"],
  "tag_cleanup": {
    "strip_discriminator": [
      "meeting","person","project","product","team","trip",
      "budget","paycheck","invoice","daily","journal","scratch",
      "scratch-day","cowork-daily","cowork-weekly","cowork-monthly",
      "to-do","board"
    ],
    "strip_temporal_patterns": [
      "^\\d{4}/\\d{2}/\\d{2}$",
      "^\\d{4}/\\d{2}$",
      "^\\d{4}$"
    ],
    "preserve": [
      "kanban-card","project-card","task-board-card","task-board",
      "kanban-plugin"
    ]
  },
  "wikilink_quote_keys": [
    "people","projects","teams","products","trips","meetings",
    "attendees","daily_note","day_link","created_by"
  ],
  "backfill": {
    "type": { "infer_from": ["path","template-marker","tags"] },
    "created_at": { "infer_from": "file-mtime" }
  }
}
```

**Flags:**
- (default) **dry-run** → writes `<vault>/sauce-migration-report.md` with per-file proposed diffs, grouped by blueprint
- `--apply` → writes the rewrites (`.sauce-backup` sidecar per touched file)
- `--blueprint <name>` → scopes to one blueprint
- `--vault <path>` → defaults to registry-resolved current vault
- Failure-loud on YAML parse errors; one bad file halts the run

**Test surface:** NEW `platform/test/run-migrate-frontmatter.js` (~40 sub-asserts):
- Renames × 3 (created, attending, product); date coercion × 5 formats; tag strip × 8 discriminator patterns × 3 temporal patterns; tag preserve × 5 allowlist entries; wikilink quoting × 6 canonical keys + 4 narrowings; backfill type / created_at; dry-run report shape; --apply backup invariant.

### 2. Validator mechanism extension → `validator@0.2.0 → 0.3.0` MINOR

**Two new pieces:**

**(a) Shared rule template** at `platform/rules/_canonical-vocab.json` (NEW):

```json
{
  "id": "_canonical-vocab",
  "required_frontmatter": {
    "type": { "kind": "string", "pattern": "^[a-z][a-z0-9-]*$" },
    "created_at": {
      "kind": "string",
      "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}([+-]\\d{2}:\\d{2}|Z)$"
    }
  },
  "forbidden_frontmatter": ["created", "attending"],
  "wikilink_keys": ["people","projects","teams","products","trips","meetings"]
}
```

**(b)** `rule_fragments[]` gains an `extends:` field. Per-blueprint inclusion shape:

```json
{
  "id": "<bp>-canonical-vocab",
  "scope": { "path_glob": "spice/<module>/**/*.md" },
  "extends": "_canonical-vocab"
}
```

The validator runtime merges the extends-base rule with any per-blueprint overrides at validation time. Existing rule infrastructure handles 95% of this — the new piece is the `extends:` loader.

**Layer 2 install.js rule:** existing `_validateTypeFieldConvention` from v0.47.0 is extended into `_validateCanonicalVocab` — every blueprint manifest must either opt into `_canonical-vocab` via at least one rule_fragment OR explicitly declare why not (e.g., legacy blueprints in transition).

**Test surface:** NEW `platform/test/run-validator.js` (promoted from helper-cases for clarity); +8 helper-cases for the extends-loader internals.

### 3. Audit mechanism extension → `audit@0.2.1 → 0.3.0` MINOR

**NEW walker** `platform/audit/frontmatter-alignment-walker.js`. Severity classifier:

| Finding | Severity | Trigger |
|---|---|---|
| `legacy_key_used` | HIGH | Note has `created:` instead of `created_at:`; or `attending:`; or `product:` (singular on team) |
| `non_iso_timestamp` | HIGH | `created_at:` exists but value doesn't match ISO-8601-with-TZ regex |
| `unquoted_wikilink` | MEDIUM | Cross-ref value is bare `[[Alice]]` instead of `"[[Alice]]"` |
| `discriminator_tag_present` | INFO | `tags:` contains a known type discriminator |
| `temporal_tag_present` | INFO | `tags:` contains `YYYY/MM/DD` or similar |
| `missing_canonical_key` | MEDIUM | Blueprint emits canonical key by template but this note omits it |

**CLI flags:**
- `sauce audit --frontmatter-alignment` runs only this walker
- `sauce audit` (default) runs all walkers including this one
- `--output-file <path>` (already exists) writes JSON for CI / external tooling

**Test surface:** +12 sub-asserts in `run-audit.js` (one happy + one violation per finding type × 6).

### 4. Audit-inventory artifact

`Docs/plans/2026-05-16-frontmatter-audit-inventory.md` (NEW). The full per-blueprint key tables + cross-blueprint frequency table + semantic-clash list. Ground-truth reference for the decisions in §A and §C.

### 5. Canonical-vocab spec doc

This doc — `Docs/plans/2026-05-16-frontmatter-alignment-design.md`. Lives alongside the inventory artifact, referenced from CLAUDE.md once FA-1 closes.

### FA-1 deliverable summary

| Component | Mechanism / version | Test surface delta |
|---|---|---|
| `sauce migrate-frontmatter` CLI | `cmd-migrate-frontmatter.js` + `migrations/v<n>-frontmatter.json` | NEW `run-migrate-frontmatter.js` (~40 asserts) |
| Shared rule template + `extends:` loader | `validator@0.2.0 → 0.3.0` | +8 helper-cases; NEW `run-validator.js` |
| Audit drift-detection walker | `audit@0.2.1 → 0.3.0` | +12 audit asserts |
| Audit-inventory doc | `Docs/plans/2026-05-16-frontmatter-audit-inventory.md` | none |
| Canonical-vocab DOC | this doc | none |

**Zero blueprint manifest changes** in FA-1. Workshop self-install stays clean. Consumer vaults get a new opt-in verb but their existing content is untouched until they run `--apply`.

## §C. Per-blueprint footprint

13 blueprints organized by wave. Each row shows the delta from current state.

### Wave 2 (FA-2): Entity wave — light

Four entity-shaped blueprints (project sits alone in FA-3).

| Blueprint | Renames | Cleanups | Add | Rule fragments | Templates | entity-create entry |
|---|---|---|---|---|---|---|
| **meetings** | `date` → `created_at` (ISO+TZ) | strip `tags: [meeting]` | quote `attendees:` wikilinks; add `people:` parallel to `attendees:`; add `created_by:` (optional) | 2 existing → `extends: _canonical-vocab` | 2 (Meeting + Meeting Hub) | `meeting` — `frontmatter_template` adds `created_at`, drops `tags: [meeting]`, adds `people: []` |
| **people** | (no `created` exists today — backfill) | strip `tags: [person]` | add `created_at:`; standardize wikilink quoting on identity keys; `aliases:` unchanged | 1 existing → `extends` | 1 (Person) | `person` — adds `created_at` |
| **products** | `created` → `created_at` | strip `tags: [product]` | quote any cross-ref keys; `name:` retained (carries data the filename doesn't) | 1 existing → `extends` | 1 (Product) | none — folder-template only |
| **teams** | `created` → `created_at`; **`product` → `products`** (singular wikilink → plural list) | strip `tags: [team]` | quote `products:` wikilinks | 1 existing → `extends`; update product → products clause | 1 (Team) | none |

**Manifest bumps (baselines as of `workshop_version 0.49.2` / 2026-05-16; verify at execution):** `meetings@0.5.1 → 0.6.0`, `people@0.2.2 → 0.3.0`, `products@0.1.0 → 0.2.0`, `teams@0.1.0 → 0.2.0`. All MINOR.

### Wave 2 (FA-3): Project migration

Project alone. Heaviest entity migration — 5 template families + complex per-type rule branches.

| Field | Detail |
|---|---|
| **Renames** | `created` → `created_at` across all 5 template families |
| **Cleanups** | strip `tags: [project, project-card]` only where they're discriminators; preserve `kanban-card`, `project-card`, `task-board-card` per the allowlist (these are required by the Kanban plugin) |
| **Add** | quote `teams:` / `products:` lists; `workstreams:` stays as string list (until/unless workstreams become an entity blueprint); `status:` stays domain |
| **Rule fragments** | 1 complex rule → `extends: _canonical-vocab` + retain per-type branches (atlas / map / board / task / card all keep their type-specific frontmatter clauses) |
| **Templates** | 5+ (atlas, map, board, task notes, kanban-cards, task-board card) |
| **entity-create entry** | `project` — `frontmatter_template` + `extra_files[]` (Map + Board sidecars) all get `created_at` |
| **Manifest bump** | `project@1.9.2 → 1.10.0` MINOR (baseline 2026-05-16; verify at execution — note v0.50.0 already proposes `project@1.9.2 → 1.10.0` for Wiki Area, so FA-3 may need to coordinate or bump from whatever Wiki Area leaves) |

**Possible split:** FA-3a (atlas + map) and FA-3b (board + task + card) if the cycle gets unwieldy at execution time.

### Wave 3 (FA-4): Timeline wave

Three timeline-shaped blueprints (cowork sits alone in FA-5).

| Blueprint | Renames | Cleanups | Add | Rule fragments | Templates |
|---|---|---|---|---|---|
| **daily** | `created` → `created_at` | strip `tags: [daily]`, strip temporal `[YYYY/MM/DD]` | optional emit-slots: `people:`, `projects:`; `cssclasses:` unchanged | 1 existing → `extends` | 1 (Daily Note) |
| **journal** | `created` → `created_at` | strip `tags: [journal]` | quote `daily_note:` wikilink | NEW (canonical-vocab only) | 1 (Journal entry) |
| **scratch** | `created` → `created_at` | strip `tags: [scratch, scratch-day]`, strip `[YYYY/MM/DD]` | quote `day_link:` wikilink; `day:` already canonical (`YYYY-MM-DD`); optional emit-slots: `people:`, `projects:` | 2 existing → `extends` | 3 (Scratch + Scratch Day Hub + Scratch.md hub) |

**Manifest bumps (baselines as of 2026-05-16; verify at execution):** `daily@0.3.0 → 0.4.0`, `journal@0.1.2 → 0.2.0`, `scratch@0.3.1 → 0.4.0`. All MINOR.

### Wave 3 (FA-5): Cowork migration

Cowork alone. Heaviest timeline migration — 14 rule_fragments + 8 templates + `month` → `month_label` domain rename.

| Field | Detail |
|---|---|
| **Renames** | `created` → `created_at` on cowork-daily notes; standardize `date:` on cowork-daily to `YYYY-MM-DD`; **`month` → `month_label`** on cowork-monthly (resolves cross-blueprint `month:` clash with finance) |
| **Cleanups** | strip `tags: [cowork-daily, cowork-weekly, cowork-monthly]`; strip temporal tags |
| **Add** | introduce canonical `month: "YYYY-MM"` where queries need it (cowork-monthly notes); optional emit-slots `people:`, `projects:` on daily/weekly/monthly |
| **Rule fragments** | 14 existing rules → all `extends: _canonical-vocab` |
| **Templates** | 8 (4 hubs + 4 note templates: Daily Note, Weekly Note, Monthly Note, About Cowork) |
| **Manifest bump** | `cowork@0.7.0 → 0.8.0` MINOR |

### Wave 4 (FA-6): Domain wave — light

Three mixed blueprints (finance sits alone in FA-7).

| Blueprint | Renames | Cleanups | Add | Rule fragments | Templates |
|---|---|---|---|---|---|
| **trips** | `created` → `created_at`; **`attending` → `people`** (canonical alignment) | strip `tags: [trip]` | standardize `start_date:` / `end_date:` to `YYYY-MM-DD`; quote `people:` wikilinks; `location:` stays domain | 2 existing → `extends`; update `attending` clause → `people` | 3-5 (Trip atlas, Trip Board Card, hubs) |
| **to-do** | `created` → `created_at`; **backfill `type: "to-do"`** (audit found this is the ONE blueprint missing `type:`) | strip temporal tags | add `type: to-do` to templates; optional emit-slots `people:`, `projects:` | NEW (canonical-vocab) | 1+ |
| **boards** | `created` → `created_at` | strip `tags: [board]` | quote `source_board:` wikilink if present | NEW (canonical-vocab) | varies (board templates) |

**Manifest bumps:** `trips@0.1.7 → 0.2.0`, `to-do@0.1.4 → 0.2.0`, `boards@0.1.0 → 0.2.0`. All MINOR.

### Wave 4 (FA-7): Finance migration

Finance alone. Three sub-flows × 2-3 templates each + 3 entity-create entries.

| Field | Detail |
|---|---|
| **Renames** | `created` → `created_at` across budget / paycheck / invoice; standardize `month: "YYYY-MM"` (where today it's `YYYY-MM-01`); standardize `date:` per sub-type |
| **Cleanups** | strip `tags: [budget, paycheck, invoice, finance]` |
| **Add** | quote any wikilink keys; `categories:` / `expenses:` / `entries:` stay domain (no canonical item-schema this cycle) |
| **Rule fragments** | NEW (canonical-vocab + per-entity-type rules: budget / paycheck / invoice) |
| **Templates** | 6+ (3 entity templates + time-log + board variants + hub files) |
| **entity-create entries** | 3 (`budget`, `paycheck`, `invoice`) — each gets `created_at` |
| **Manifest bump** | `finance@0.3.1 → 0.4.0` MINOR (baseline 2026-05-16; verify at execution) |

**Possible split:** one cycle per sub-flow (FA-7a budget / FA-7b paycheck / FA-7c invoice) if the cycle gets unwieldy.

## §D. Cycle plan + kanban cards

### Cycle plan (9 cycles)

| Code | Cycle name | Scope | Splits if oversized |
|---|---|---|---|
| **FA-1** | Foundation | Migration verb + validator `extends:` loader + audit walker + audit-inventory doc + canonical-vocab spec doc. No blueprint changes. ~60 new test asserts. | No |
| **FA-2** | Entity wave (light) | meetings + people + products + teams | No |
| **FA-3** | Project migration | project alone (5 template families) | FA-3a / FA-3b |
| **FA-4** | Timeline wave | daily + journal + scratch | No |
| **FA-5** | Cowork migration | cowork alone (14 rule_fragments + 8 templates) | No |
| **FA-6** | Domain wave (light) | trips + to-do + boards | No |
| **FA-7** | Finance migration | finance alone (3 sub-flows) | FA-7a / FA-7b / FA-7c |
| **FA-8** | Universal backlink panels | NEW `BacklinkPanel` CustomJS class + materialization on Person / Project atlas / Team / Product / Trip atlas. NEW `backlink-panel@0.1.0` mechanism. Payoff cycle — stitching becomes visible. | No |
| **FA-9** | Activity feeds + project rollups | Cross-blueprint activity feed (cowork hubs / "Today" surface) + project-rollup dashboard (project atlas shows meetings/scratches/daily linking it). | FA-9a / FA-9b |

**Constraint:** FA-2 through FA-7 can ship in any order AFTER FA-1, as long as `sauce migrate-frontmatter --apply --blueprint <bp>` is run against each consumer vault BEFORE the canonical-vocab rule_fragments are extended (otherwise audit lights up with `legacy_key_used`).

**Version numbers:** assigned at execution time. Current workshop state is `v0.49.2` (closed 2026-05-16), `v0.50.0` already claimed by Projects Wiki Area. FA-1 likely lands as `v0.51.0` or later depending on queue.

### Kanban cards (Frontmatter Alignment board)

After FA-1 ships, the cycles after it can be rebatched if priorities shift. Initial planning-column population:

| # | Card title | Body summary |
|---|---|---|
| 1 | **FA-1 · Foundation cycle** | Ship migration verb + validator `extends:` loader + audit walker + canonical-vocab spec + audit-inventory doc. Zero blueprint changes. Cycle bumps: `validator@0.2.0 → 0.3.0`, `audit@0.2.1 → 0.3.0`. NEW `platform/cli/cmd-migrate-frontmatter.js`, NEW `platform/migrations/v<n>-frontmatter.json`, NEW `platform/rules/_canonical-vocab.json`. Test deltas: NEW `run-migrate-frontmatter.js` (~40), NEW `run-validator.js`, +12 `run-audit.js`. Acceptance: dry-run report works against headspace and produces sensible diffs. |
| 2 | **FA-2 · Entity wave (meetings + people + products + teams)** | 4 blueprints. Migration verb runs against headspace before tag. Per-blueprint: template canonical-vocab adoption, entity-create `frontmatter_template` updates (where present), rule_fragment `extends: _canonical-vocab` injection. Manifest bumps (2026-05-16 baselines; verify at exec): `meetings 0.5.1 → 0.6.0`, `people 0.2.2 → 0.3.0`, `products 0.1.0 → 0.2.0`, `teams 0.1.0 → 0.2.0`. Whole-suite delta: ~+20 sub-asserts. |
| 3 | **FA-3 · Project migration** | Project alone. 5 template families. `project@1.9.2 → 1.10.0` MINOR (baseline 2026-05-16; coordinate with v0.50.0 Wiki Area if that bumps project first). Heaviest rule_fragment surgery (preserve type-discriminated branches while extending canonical-vocab). ~+15 sub-asserts. Headspace migration dry-run is the acceptance gate. |
| 4 | **FA-4 · Timeline wave (daily + journal + scratch)** | 3 blueprints. Mostly template-only. `daily 0.3.0 → 0.4.0`, `journal 0.1.2 → 0.2.0`, `scratch 0.3.1 → 0.4.0`. ~+10 sub-asserts. |
| 5 | **FA-5 · Cowork migration** | Cowork alone. 14 rule_fragments + 8 templates + `month` → `month_label` rename. `cowork@0.7.0 → 0.8.0` MINOR. ~+15 sub-asserts. cowork-smoke harness extended. |
| 6 | **FA-6 · Domain wave (trips + to-do + boards)** | 3 blueprints. `attending` → `people` on trips, `type:` backfill on to-do, canonical-vocab on boards. `trips 0.1.7 → 0.2.0`, `to-do 0.1.4 → 0.2.0`, `boards 0.1.0 → 0.2.0`. ~+10 sub-asserts. |
| 7 | **FA-7 · Finance migration** | Finance alone. 3 sub-flows × 2-3 templates each + 3 entity-create entries. `finance@0.3.1 → 0.4.0` MINOR. ~+12 sub-asserts. |
| 8 | **FA-8 · Universal backlink panels** | NEW `BacklinkPanel` CustomJS class. Materialize on Person.md, Project atlas, Team.md, Product.md, Trip atlas. NEW `backlink-panel@0.1.0` mechanism. Test deltas: NEW `run-backlink-panel.js` (~20 sub-asserts), renderer cases. |
| 9 | **FA-9 · Activity feeds + project rollups** | Cross-blueprint activity feed (cowork hubs / "Today" surface) + project-rollup dashboard (project atlas shows meetings/scratches/daily linking it). May split into FA-9a + FA-9b. Full user-facing payoff lands here. |

**Card body conventions:** each card uses `Template, Task Board Card.md` (the Kanban plugin's `new-note-template`). Body embeds the cycle scope + per-blueprint checklist + acceptance criteria + test-delta budget.

## Out of scope (this workstream)

The following surfaced during the audit but are intentionally NOT addressed here. They get their own brainstorms:

1. **Entity-create migration for the 8 blueprints that still use nav-button + Templater** (boards, cowork, daily, journal, to-do, trips). Adopting entity-create is its own concern — orthogonal to canonical-vocab. The frontmatter alignment cycles touch the templates and (where present) the entity-create entries; they don't force adoption.
2. **List-item schemas for `categories:` / `expenses:` / `entries:` / `attendees:`** (finance, meetings). Today these are bag-of-objects without declared item structure. Future schema-design cycle.
3. **Workstreams as an entity blueprint.** Today `workstreams:` is a list of strings on project notes. Promoting workstreams to a `type: workstream` blueprint would make them queryable + give them their own page. Separate brainstorm.
4. **`updated_at` automation.** The vocab declares the key but doesn't wire a Templater on-save hook to maintain it. Future cycle.
5. **Multi-user `created_by` flows.** The vocab declares the key but doesn't change today's single-user posture. Future cycle.
6. **Validator `forbidden_frontmatter` enforcement strictness.** FA-1 declares `created:` and `attending:` forbidden but leaves audit-INFO severity. Stricter severity (rule fails install) could come once consumer vaults are confirmed migrated.

## Acceptance criteria

### FA-1
- `sauce migrate-frontmatter --vault <headspace>` (dry-run) produces a per-file diff report with no parse errors
- Sample diffs visually correct: `created:` renamed to `created_at:`, dates reformatted, tags cleaned
- `sauce audit --frontmatter-alignment` on a vault with zero migrated notes reports `legacy_key_used` findings for every blueprint
- Workshop self-install clean
- All 15 existing harnesses green; new harness (`run-migrate-frontmatter.js`) green

### FA-2..FA-7 (per cycle)
- Migration verb run against headspace + accuris + ero + barebones BEFORE tag; reports saved
- After --apply: `sauce audit --frontmatter-alignment` finds zero `legacy_key_used` findings in the migrated blueprint
- Templates emit canonical-vocab frontmatter on new note creation (smoke-tested)
- Whole-suite green
- Workshop self-install clean

### FA-8 / FA-9
- Person.md auto-renders a backlinks panel listing meetings + scratches + daily notes that reference it (FA-8)
- Project atlas auto-renders a rollup dashboard with meetings + scratches + daily linked via `projects: [[X]]` (FA-9)
- Activity feed surface lists today's daily + meetings + scratches in one timeline (FA-9)
- Query patterns are reusable across entity types (single Dataview query template parameterized by entity type)

## Open questions (resolved at execution time)

1. **Project migration scope** — does FA-3 split into atlas+map / board+task+card sub-cycles, or stay one cycle? Decide based on the FA-2 retrospective.
2. **Finance migration scope** — does FA-7 split per-sub-flow, or stay one cycle?
3. **Strict-severity escalation timing** — when does the audit walker promote `legacy_key_used` from HIGH to FAIL-INSTALL? After all 4 consumer vaults migrated cleanly.
4. **`updated_at` Templater hook** — separate brainstorm before or after FA-8?
5. **Workstreams as entities** — separate brainstorm; might predate FA-3 if workstream queries are valuable enough to want them as proper entity pages.
6. **Wave ordering flexibility** — if a consumer vault has heavy use of one blueprint (e.g., headspace heavily uses scratch + meetings), prioritize those waves first. The FA-2..FA-7 ordering is suggested, not enforced.

## Appendix: glossary

- **Canonical key** — a frontmatter key that's part of the platform-wide vocabulary every blueprint commits to (e.g., `type`, `created_at`, `people`).
- **Semantic narrowing** — a per-blueprint key that refines a canonical concept (e.g., `attendees:` on meetings is a subset of `people:`).
- **Domain key** — a per-blueprint key with meaning specific to that blueprint (e.g., `status:` on project, `entries:` on finance budgets).
- **Entity-shaped blueprint** — emits a `type:` value that other blueprints can point at (person, project, team, product, trip, meeting). Has a stable identity (a Person page, a Project atlas, etc.).
- **Timeline-shaped blueprint** — emits date-stamped surfaces (daily, scratch, cowork-daily, journal, to-do, boards). Has no canonical cross-ref key pointing AT it; discovered via reverse Dataview queries.
- **Migration verb** — `sauce migrate-frontmatter`, the FA-1 deliverable that one-shot rewrites existing notes onto the canonical vocab.
