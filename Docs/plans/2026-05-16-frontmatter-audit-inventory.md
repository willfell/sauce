---
type: workstream-audit-inventory
workstream: frontmatter-alignment
title: Frontmatter audit inventory — all 13 blueprints
status: ground-truth
date: 2026-05-16
sibling_doc: Docs/plans/2026-05-16-frontmatter-alignment-design.md
---

# Frontmatter Audit Inventory

Ground-truth snapshot of frontmatter usage across all 13 sauce blueprints at the time of the Frontmatter Alignment brainstorm (2026-05-16). This artifact captures **what is** so future cycles can verify they've migrated **what was**.

Per-blueprint columns:
- **(A)** Templates' frontmatter keys (every `.md` under `<blueprint>/content/` and `<blueprint>/templates/`)
- **(B)** `entity-create` `new_entity_buttons[].frontmatter_template` keys (where present)
- **(C)** `rule_fragments` `required_frontmatter` clauses
- **(D)** Runtime reads (`fm.<key>`, `frontmatter.<key>`, `dv.page(...).<key>`)

Cross-blueprint summary at the end: key-frequency table + semantic clashes + maturity scorecard.

---

## boards

**(A) Templates:** `created`, `source_board`, `tags`, `type`
**(B) entity-create:** none
**(C) rule_fragments:** none
**(D) Runtime reads:** `tags`, `type`

---

## cowork

**(A) Templates (~13 unique keys across 8 templates):**

| File | Keys |
|---|---|
| `content/Cowork.md` (hub) | `tags`, `cssclasses`, hub-shape (varies) |
| `content/Daily Hub.md` | hub-shape |
| `content/Weekly Hub.md` | hub-shape |
| `content/Monthly Hub.md` | hub-shape |
| `content/About Cowork.md` | content-doc shape |
| `templates/Daily Note.md` | `type: cowork-daily`, `created`, `date`, `day` (`YYYY-MM-DD`), `tags: [cowork-daily, YYYY/MM/DD]`, `month`, `month_label` (friendly string) |
| `templates/Weekly Note.md` | `type: cowork-weekly`, `created`, `week_iso` (`YYYY-Www`), `week_start`, `week_end`, `month`, `tags: [cowork-weekly]` |
| `templates/Monthly Note.md` | `type: cowork-monthly`, `created`, `month: "MMMM YYYY"` (friendly!), `month_iso: "YYYY-MM"`, `month_start`, `month_end`, `tags: [cowork-monthly]` |

**(B) entity-create:** none — uses Templater + nav-buttons
**(C) rule_fragments (14):**
1. cowork-hub — `tags: [cowork-hub]`
2. daily-hub — `tags: [cowork-daily-hub]`
3. weekly-hub — `tags: [cowork-weekly-hub]`
4. monthly-hub — `tags: [cowork-monthly-hub]`
5. cowork-daily — `type="cowork-daily"`, `day` matches `YYYY-MM-DD`
6. cowork-weekly — `type="cowork-weekly"`, `week_iso` matches `YYYY-Www`
7. cowork-monthly — `type="cowork-monthly"`, `month_iso` matches `YYYY-MM`
8. cowork-about — `tags: [cowork-about]`
9-12. four prompt-file shells: morning-briefing / eod-review / weekly-review / monthly-review
13-14. engagement-schema rules (varies)

**(D) Runtime reads:** `type`, `day`, `week_iso`, `month_iso`, `month_label`, `tags`

---

## daily

**(A) Templates:**

| File | Keys |
|---|---|
| `templates/Daily Note.md` | `created`, `tags: [daily, YYYY/MM/DD]`, `cssclasses` |

**(B) entity-create:** none — Obsidian daily-notes core plugin owns creation
**(C) rule_fragments (1):** `created` required, `tags` contains `daily`
**(D) Runtime reads:** `created`, `tags`

---

## finance

**(A) Templates (~18 unique keys across 6+ templates):**

| File | Keys |
|---|---|
| `templates/Budget.md` | `type: budget`, `created`, `month` (`YYYY-MM-01`), `categories: [...]`, `tags: [budget, finance]`, `cssclasses` |
| `templates/Paycheck.md` | `type: paycheck`, `created`, `date`, `amount`, `entries: [...]`, `start_date`, `tags: [paycheck, finance]` |
| `templates/Invoice.md` | `type: invoice`, `created`, `date`, `client`, `expenses: [...]`, `kanban-plugin`, `tags: [invoice, finance]` |
| `templates/Time-Log.md` | sub-file in invoice subfolder |
| `templates/Board.md` (invoice sub-kanban) | `kanban-plugin: board`, board-shape |
| `content/Finance.md` (hub) | hub-shape, `tags: [finance-hub]` |

**(B) entity-create (3 entries):**
1. `budget` — `type: budget`, `created`, `month` (prompt), `categories: []`
2. `paycheck` — `type: paycheck`, `created`, `date`, `start_date` (prompt + validate `gte:start_date`), `amount` (`min:0`, `|number` pipe)
3. `invoice` — `type: invoice`, `created`, `date`, `client`, `expenses: []`, + `extra_files[]` for Time-Log and Board sub-kanban

**(C) rule_fragments:** none today (one of the maturity gaps)
**(D) Runtime reads:** `type`, `month`, `date`, `amount`, `entries`, `expenses`, `categories`

---

## journal

**(A) Templates:**

| File | Keys |
|---|---|
| `templates/Journal.md` | `created`, `daily_note: [[Daily-YYYY-MM-DD]]`, `tags: [journal]` |

**(B) entity-create:** none
**(C) rule_fragments:** none
**(D) Runtime reads:** `daily_note`, `tags`

---

## meetings

**(A) Templates:**

| File | Keys |
|---|---|
| `templates/Meeting.md` | `date` (ISO + HH:mm), `type: meeting`, `tags: [meeting, YYYY/MM/DD]`, `summary`, `attendees: [[Person]]`, `cssclasses` |
| `content/Meeting Hub.md` | hub-shape, `tags: [meetings-hub]` |

**(B) entity-create (1 entry):**
- `meeting` — `type: meeting`, `date`, `tags: [meeting]`, `attendees: [[Person]]`, `cssclasses` (per v0.46.0 Path C — `inline_body` + `frontmatter_template`, no body_template)

**(C) rule_fragments (2):**
1. meeting-notes — `type="meeting"`, `date` matches ISO regex
2. meetings-hub — `tags` contains `meetings-hub`

**(D) Runtime reads:** `type`, `date`, `attendees`, `summary`

---

## people

**(A) Templates:**

| File | Keys |
|---|---|
| `templates/Person.md` | `type: person`, `company`, `location`, `title`, `email`, `website`, `aliases: [...]`, `phone`, `tags: [person]` |
| `content/People.md` (hub) | hub-shape |

**(B) entity-create (1 entry):**
- `person` — `type: person` (v0.47.0 fix added this), `company`, `location`, `title`, `email`, `website`, `phone`, `tags: [person]`

Note: people has NO `created` today — one of the rare omissions. Migration will backfill.

**(C) rule_fragments (1):**
1. person-page — `tags` contains `person`

**(D) Runtime reads:** `type`, `company`, `location`, `title`, `email`, `aliases`

---

## products

**(A) Templates:**

| File | Keys |
|---|---|
| `templates/Product.md` | `type: product`, `name`, `created` (`YYYY-MM-DD`), `tags: [product]` |

**(B) entity-create:** none — folder-template only (Templater on folder-create)
**(C) rule_fragments (1):** `type="product"`, `name` required, `created` matches `YYYY-MM-DD`
**(D) Runtime reads:** `type`, `name`, `created`

---

## project

**(A) Templates (5+ template families, 8+ unique keys):**

| File | Keys |
|---|---|
| `templates/Project Atlas.md` | `type: project`, `created`, `status: planning\|...`, `status_changed_at`, `workstreams: [...]`, `teams: [[Team]]`, `products: [[Product]]`, `aliases`, `tags: [project]` |
| `templates/Project Map.md` (sidecar) | `type: project-map`, `created`, `project: [[Atlas]]` (back-ref) |
| `templates/Project Board.md` (sidecar) | `type: project-board`, `created`, `project: [[Atlas]]`, `kanban-plugin: board` |
| `templates/Task Note.md` | `type: project-task`, `created`, `task_parent: [[...]]`, `workstream` (string), `tags: [project-task]` |
| `templates/Kanban Card.md` | `type: project-card`, `created`, `source_board: <path>`, `workstream`, `tags: [kanban-card, project-card, YYYY/MM/DD]` |
| `templates/Task Board Card.md` | `type: task-board-card`, `created`, `task_parent`, `source_board`, `status: planning`, `aliases`, `tags: [task-board-card, YYYY/MM/DD]` |
| `content/Projects.md` (hub) | hub-shape |

**(B) entity-create (1 entry):**
- `project` — `type: project`, `created`, `status: planning`, `workstreams: []`, `teams: []`, `products: []`, `tags: [project]`, + `extra_files[]` for Map + Board sidecars (each gets its own `frontmatter_template`)

**(C) rule_fragments (1 complex with per-type branches):**
- project-atlas branch — `type="project"`, `status` in enum, `created`, `workstreams` is list
- project-task branch — `type="project-task"`, `task_parent` required
- project-card branch — `type="project-card"`, `source_board` required, `workstream` required

**(D) Runtime reads:** `type`, `status`, `workstreams`, `workstream`, `teams`, `products`, `task_parent`, `source_board`

---

## scratch

**(A) Templates:**

| File | Keys |
|---|---|
| `templates/Scratch.md` | `type: scratch`, `day: "YYYY-MM-DD"`, `created`, `time: "HH:mm"`, `day_link: [[Scratch-Day-YYYY-MM-DD]]`, `tags: [scratch, YYYY/MM/DD]` |
| `templates/Scratch Day Hub.md` | `type: scratch-day`, `day: "YYYY-MM-DD"`, `created`, `tags: [scratch-day, YYYY/MM/DD]` |
| `content/Scratch.md` (hub) | hub-shape |

**(B) entity-create (1 entry):**
- `scratch` — `type: scratch`, `day` (from `{{current_file.frontmatter.day}}` token), `created`, `time`, `day_link: [[...]]`, `tags: [scratch]`

**(C) rule_fragments (2):**
1. scratch — `type="scratch"`, `day` matches `YYYY-MM-DD`
2. scratch-day-hub — `type="scratch-day"`, `day` matches `YYYY-MM-DD`

**(D) Runtime reads:** `type`, `day`, `day_link`, `time`

---

## teams

**(A) Templates:**

| File | Keys |
|---|---|
| `templates/Team.md` | `type: team`, `name`, `created` (`YYYY-MM-DD`), `product: [[Product]]` (singular wikilink!), `tags: [team]` |

**(B) entity-create:** none currently
**(C) rule_fragments (1):** `type="team"`, `name`, `created` matches `YYYY-MM-DD`, `product` required wikilink
**(D) Runtime reads:** `type`, `name`, `product`

---

## to-do

**(A) Templates:**

| File | Keys |
|---|---|
| `templates/To-Do.md` | `created`, `tags`, `cssclasses` |

NOTE: **`type:` is MISSING.** Only blueprint of the 13 without a `type:` discriminator in its template. Migration will backfill `type: to-do`.

**(B) entity-create:** none
**(C) rule_fragments:** none
**(D) Runtime reads:** `tags`

---

## trips

**(A) Templates:**

| File | Keys |
|---|---|
| `templates/Trip.md` (atlas) | `type: trip`, `name`, `created`, `start_date`, `end_date`, `location`, `attending: [[Person]]` (note: NOT `people:`), `tags: [trip]`, `cssclasses` |
| `templates/Trip Board Card.md` | `type: trip-card`, `created`, `tags` |
| `content/Trips.md` (hub) | hub-shape |

**(B) entity-create:** none — uses custom `TripNavButtons` helper
**(C) rule_fragments (2):**
1. trip-atlas — `type="trip"`, `start_date` ≤ `end_date`, `attending` is list of wikilinks
2. trips-hub — `tags` contains `trips-hub`, `cssclasses` includes `wide`

**(D) Runtime reads:** `type`, `start_date`, `end_date`, `location`, `attending`

---

## Cross-blueprint key-frequency table (≥2 blueprints)

| Key | Blueprints | Count | Role | Issues |
|---|---|---|---|---|
| `tags` | all 13 | 13 | categorization | UNIVERSAL but overloaded: discriminator vs category vs temporal bucket |
| `type` | all except to-do | 12 | discriminator | Consistent posture; values are blueprint-specific kebab-case strings |
| `created` | boards, cowork, daily, finance, journal, meetings, project, scratch, teams, trips | 10 | audit | FORMAT-INCONSISTENT: `YYYY-MM-DD`, `YYYY-MM-DD HH:mm`, ISO-8601 all in use |
| `date` | cowork, finance, meetings, trips | 4 | temporal | FORMAT-INCONSISTENT: meetings ISO + HH:mm, finance `YYYY-MM-01`, trips `YYYY-MM-DD`, cowork `YYYY-MM-DD` |
| `name` | cowork, products, project, scratch, teams, trips | 6 | identity | Sometimes duplicates filename; sometimes carries data the filename can't |
| `description` | cowork, meetings, products, project, scratch, teams | 6 | metadata | Optional, no validation, used in hub-card rendering |
| `cssclasses` | daily, finance, meetings, project, trips | 5 | styling | Obsidian-specific; common values `[wide]`, `[wide,cards]` |
| `day` | cowork, scratch | 2 | temporal | CONSISTENT `YYYY-MM-DD` |
| `month` | cowork, finance | 2 | temporal | **CLASH**: cowork = friendly label string ("May 2026"), finance = `YYYY-MM` ISO |
| `aliases` | people, project | 2 | identity | Both = Obsidian-native alternate display names (no real clash — audit was overcautious) |
| `kanban-plugin` | finance, project, trips | 3 | metadata | Obsidian Kanban literal `board`. Owned by the plugin; don't touch. |
| `status` | project | 1 | workflow-state | Project-only; 7-state enum |
| `workstreams` / `workstream` | project | 1 | grouping | atlas-level (list) vs task-level (string); both mutable; not versioned |
| `attendees` | meetings | 1 | cross-ref | List of `[[Person]]` wikilinks; semantic narrowing of `people:` (post-FA) |
| `attending` | trips | 1 | cross-ref | `[[Person]]` wikilinks. **Renamed to `people:` by FA migration** |
| `product` | teams | 1 | parent-link | Singular wikilink. **Renamed to `products:` (plural list) by FA migration** |
| `products` | project | 1 | cross-ref | Plural list of `[[Product]]` wikilinks |
| `teams` | project | 1 | cross-ref | Plural list of `[[Team]]` wikilinks |
| `daily_note` | journal | 1 | cross-ref | Single `[[Daily]]` wikilink (1:1 relation) |
| `day_link` | scratch | 1 | cross-ref | Single `[[Scratch-Day-X]]` back-link |
| `task_parent` | project | 1 | parent-link | task-note → parent-task wikilink |
| `source_board` | project, boards | 2 | back-link | Kanban-card → board path string |
| `categories` | finance | 1 | structure | List of category objects; no item schema declared |
| `expenses` | finance | 1 | structure | List of expense objects; no item schema |
| `entries` | finance | 1 | structure | List of entry objects; no item schema |
| `location` | people, teams (inferred), trips | 3 | metadata | Geography; varies in semantics (office vs city vs destination) |
| `company` / `title` / `email` / `website` / `phone` | people | 1 | identity-contact | People-specific; unchanged |
| `start_date` / `end_date` | trips, finance (inferred) | 1-2 | temporal | `YYYY-MM-DD` |

---

## Semantic clashes

1. **`month:`** — cowork (friendly label `"May 2026"`) vs finance (`YYYY-MM` ISO). **Resolution:** rename cowork's to `month_label`; finance's stays canonical.
2. **Date-field format drift** — `date:` exists on 4 blueprints with 4 different formats. **Resolution:** per-blueprint validator regex; document the canonical per-type format.
3. **`tags:` triple-overload** — discriminator (`[meeting]`), category (`[finance]`), temporal (`[2026/05/16]`). **Resolution:** migration strips discriminator + temporal entries; `tags:` becomes user-controlled categorization only.
4. **`name:` vs `title:`** — both exist, sometimes duplicating filename. **Resolution:** drop `name:` where it duplicates; retain where it carries data.
5. **List item schemas missing** — `categories`, `expenses`, `entries`, `attendees`, `teams`, `products` have no declared item structure in manifests. **Resolution:** OUT OF SCOPE for FA workstream; future schema-design cycle.
6. **Wikilink format unenforced** — bare `[[X]]` (YAML interprets as flow-mapping in some cases) vs quoted `"[[X]]"`. **Resolution:** migration verb quotes all canonical cross-ref values; audit walker flags `unquoted_wikilink`.
7. **`workstream` (singular task-level) vs `workstreams` (plural atlas-level)** — semantic OK but no version-tracking. **Resolution:** OUT OF SCOPE (separate brainstorm on workstreams-as-entity).
8. **`attending:` (trips) vs `people:` (canonical)** — same concept, different keys. **Resolution:** rename `attending:` → `people:` via migration.
9. **`product:` (teams singular) vs `products:` (project plural)** — same concept, different cardinality. **Resolution:** rename `product:` → `products:` (always plural list) via migration.

---

## Maturity scorecard

| Mechanism | Adoption | Blueprints |
|---|---|---|
| `entity-create` for new-note creation | 5/13 | finance, meetings, people, project, scratch |
| `rule_fragments` for frontmatter validation | 8/13 | cowork (14 rules), daily, meetings, people, products, project, scratch, teams, trips |
| `customjs_classes` (runtime helpers) | 10/13 | all except boards, daily, journal, to-do |
| Still nav-button + Templater (no entity-create) | 8/13 | boards, cowork, daily, journal, to-do, trips + boards-style fall-throughs |

**Adoption gaps that affect FA cycles:**

- finance has no `rule_fragments` — FA-7 adds them
- boards / journal / to-do have no `rule_fragments` — FA-4 (journal) and FA-6 (boards, to-do) add canonical-vocab fragments
- to-do has no `type:` — FA-6 backfills
- people has no `created:` — FA-2 backfills

---

## Where this maps in the FA workstream

- **§A canonical vocabulary** is derived from the cross-blueprint key-frequency table + semantic-clash list above.
- **§B cross-cutting infrastructure** (FA-1) builds the migration verb + validator extension + audit walker that enforce the vocab decisions.
- **§C per-blueprint footprint** (FA-2..FA-7) cites the cleanups and renames per blueprint from the inventory rows above.

See sibling design doc: `Docs/plans/2026-05-16-frontmatter-alignment-design.md`.
