---
purpose: Strategic analysis (not a cycle plan). What Sauce delivers today, where the glue is thin, a unified idea backlog, and a deep-dive on the "blueprint that creates blueprints" question. Fable-5-authored investigation, synthesized 2026-07-01.
load_when: Considering roadmap direction, new blueprints, cross-blueprint glue, or an in-Obsidian authoring surface.
status: analysis / not queued — this is a thinking document, not a board card.
---

# Sauce: state of the platform, the glue gaps, and the meta-blueprint

*Commissioned 2026-07-01. Three independent Fable 5 investigators read the live codebase (read-only); this is the synthesis. Nothing here has been built.*

---

## Executive summary

Sauce is a **hub-and-spoke personal operating system, not yet a mesh** — and its most important asset is that *its glue primitives are already better than its glue coverage.* The connective mechanisms (a canonical 6-key cross-ref vocabulary, a universal reverse-query `BacklinkPanel`, a vault-wide `activity-feed`, config-driven breadcrumbs, a declarative `entity-create` creation path) are genuinely good. But they're adopted on only a fraction of note types, so the vault *feels* connected in two places (the daily dashboard and the project hub) and feels like separate tools everywhere else.

On the headline question — **"what would it take to build a setup to create things inside Obsidian / a blueprint that creates blueprints?"** — the deep-dive verdict is clear and slightly contrarian:

> **A blueprint that literally emits workshop blueprints is the wrong frame.** Scaffolding a blueprint is the cheap 20% (a minimal one is ~50 lines of JSON + one template); the expensive 80% — the 60-harness preflight, the seed-vault migration net, versioning, review, and the auto-release train — *cannot and should not* move into a GUI, because that machinery exists precisely because **changing a shipped blueprint is dangerous.**
>
> **The high-leverage move is one level down: user-defined, in-vault note-types.** A new `collections` blueprint that lets a user define their own note-type from a form inside Obsidian — emitting a schema-valid `entity-create` spec into a *consumer-owned* registry file the installer never touches — answers the real wish ("create *my* things in *my* vault") instantly, on mobile, with zero release train. The literal meta-blueprint then re-appears, correctly located, as a **promotion path**: a `/promote-note-type` skill that turns a proven local type into a real workshop blueprint via the agent + CI + auto-release machinery that already exists.

The one line to hold under pressure: **users author data, never code.** Every hard-won landmine in this repo says that boundary is where the platform's safety actually lives.

A secondary finding worth acting on regardless of roadmap: **the platform's own state docs have drifted.** `Docs/agent-guides/cycle-status.md` claims workshop `0.139.0` while the live version is ~`0.158.0`, and two mechanisms are half-integrated (`task-entity` shipped with zero consumers; `cowork-reconciler` exists on disk but is absent from `platform/manifest.json`). These are the clearest markers of in-flight transitions and should be reconciled.

---

## Part 1 — What Sauce delivers today (user's-eye view)

After `brew install` + `sauce bootstrap`, a plain Obsidian vault becomes an opinionated OS: every note gets consistent chrome (a `SpaceNavButtons` row, breadcrumbs, uniform section labels, card-based hubs) rendered **live** via CustomJS + Dataview from `ranch/`-materialized scripts — so nothing rots into user notes. Every "thing" is created through a declarative **"+ New X"** dialog (`entity-create`) that prompts, writes schema-correct frontmatter, scaffolds sibling files, and opens the note. A parallel **Claude surface** (`claude_surface[]`) ships slash commands + skills, so the vault is equally operable by the user and by an agent.

**Maturity is strongly bimodal.** Six blueprints carry dozens of real-user polish iterations; four are frozen scaffolding from ~May 2026.

| Tier | Blueprints | State |
| --- | --- | --- |
| **Flagship** (deep, iterated) | `project` (v1.31 — atlas + kanban + docs tree + tasks), `finance` (v0.16 — budgets, per-month paychecks, avalanche payoff, planning "lever" cockpit, Copilot actuals badge), `cowork` (v0.40 — cadenced Claude agents writing briefings/reviews + a learned-preference feedback loop), `daily` (v0.15 — live 3-panel dashboard), `to-do` (v0.14), `meetings` (v0.14) | Complete, hardened, actively evolving |
| **Solid core** | `people` (v0.6 — identity spine, 4 live panels), `scratch` (v0.7 — timestamped capture) | Works well; read-only rollups, minor gaps |
| **Frozen / thin** | `trips` (v0.4 — empty section shells), `boards` (v0.2 — one hard-named kanban), `teams` (v0.3), `products` (v0.3), `journal` (v0.2 — a template + a blank page, no hub) | Coherent but minimal; untouched since v0.56–0.61 |

**The center of gravity in daily use** is the daily note + dashboard (Tasks / Meetings / Activity panels with drill-ins), fed by the three deep verticals (project, finance, cowork). The daily dashboard is *read-only*, though — you look, then click away to act.

### The mechanism layer (the real moat)

The shared primitives are what make blueprints cheap and consistent:

- **customjs-guard** — polling loader so CustomJS classes never cold-load-throw; every view routes through it.
- **entity-create** (v0.7.4) — the declarative creation path (prompts, validation, derives, dynamic selects, defaults-seeding). Replaced 7 hand-rolled button classes. **This is the load-bearing precedent for any in-Obsidian authoring.**
- **nav-buttons / breadcrumb / section-label / cards** — the chrome + wayfinding + hub-rendering signature.
- **activity-feed** (v0.8) — the time-windowed cross-blueprint aggregator behind the daily dashboard.
- **backlink-panel** (v0.1.1) — one parameterized reverse-query over 6 canonical keys; the "Mentions" panel.
- **render-safe** (v0.2) — cold-load-safe `dv.current()`, lint-enforced.
- **people-identity / people-rendering**, **task-interactions** (task-line grammar + dual-write), **smart-connections-bridge** (semantic index CLI), **validator / audit** (conform-by-construction).
- **In transition:** `task-entity` (v0.1, note-per-task core — **zero consumers**), `cowork-reconciler` (on disk, **unregistered in the manifest**).

---

## Part 2 — Is Sauce a connected system?

**Verdict: hub-and-spoke, not a mesh — but the fix is coverage, not architecture.** Two surfaces genuinely feel connected (the daily dashboard; the project hub with status + activity + open tasks + recent meetings). The meeting↔person and meeting↔project edges are the best in the vault: bidirectional, prompted at creation, rendered on both ends. Away from those, the mesh thins fast.

### The entity graph today

```
                 people:                people:
   MEETING ──────────────→ PERSON ←────────────── TRIP
      │ project:              ▲                     ▲
      ▼                       │ (BacklinkPanel)     │ trips: ← NOTHING WRITES THIS KEY (dead panel)
   PROJECT ── teams: ──→ TEAM ── products: ──→ PRODUCT
      ▲                    (no members/people leg)  ▲
      │ project:                                    │ products:
   doc-note / section-hub / project-todo

   ISLANDS (no canonical keys in or out):
   FINANCE (internal expense→debt links only) · BOARDS · JOURNAL (one-way → daily) · TASKS (source_note always "")
```

The BacklinkPanel — the flagship glue — ships on **4 of ~20 note types** (person, team, product, trip). It was *deliberately removed from Project at v1.21.0*, never added to Meeting, and is absent from all finance/boards/daily/journal notes. So "what references this note?" is unanswerable on 16 of 20 types.

### The glue gaps (highest-signal, verified in code)

1. **BacklinkPanel used at ~20%.** A generic renderer, one line to adopt, live on 4 types. *Fix:* re-add to Project (collapsed) + Meeting; add an outlinks-fallback mode so non-keyed types (journal, finance) get "mentioned by" too.
2. **The dead `trips:` edge.** `Trip Atlas.md` renders a Mentions panel keyed on `trips:`, but **no template anywhere writes that key** — empty by construction. *Fix:* a trip picker on meeting/scratch/journal creation, or date-range matching (notes falling inside a trip's dates).
3. **Person↔Team doesn't exist.** Team has `products:`; Person has no `teams:`, Team has no `members:`. The org triangle is missing its person leg, so "who attended → what team" dead-ends. *Fix:* add `teams: []` to the person template (reverse direction is free via the existing key + BacklinkPanel).
4. **`people-identity` is an orphan** — a complete alias resolver with **zero production callsites** (only tests + its own README). The attendee suggester does raw basename scans. *Fix:* wire it into the meeting pickers + an auto-linker.
5. **Meeting → project dead-ends in navigation.** Meetings carry `project:`, but the breadcrumb never renders a trail to it. *Fix:* a `when: {"fm:project": "present"}` breadcrumb ancestor — the grammar already supports this.
6. **Task origin is designed but never recorded.** `task-entity` defines `source`/`source_note`; the dual-write path populates neither. Origin is *inferred at render time by name-matching*, so unlinking a meeting silently orphans its tasks. *Fix:* an optional `[from:: [[…]]]` inline field written at append time.
7. **Three parallel task systems, no bridge:** per-project Kanban, per-project flat To-Do, and the standalone `boards` blueprint. No surface answers "everything open, everywhere."
8. **The time spine has no spine.** The daily note links to nothing temporally (no prev/next, no link to that day's journal/scratch); journal is referenced by nothing; weekly/monthly notes live **only inside cowork**, a duplicate namespace.
9. **Finance is a sealed subsystem** — no canonical keys, no link to the time spine, no invoice→project edge.
10. **Semantic glue is headless; `/correlate` is a fossil.** `sc-bridge` is consumed only by two cowork sub-skills, never rendered in a note. The user-global `/correlate` skill is hardcoded to the *pre-Sauce* legacy vault layout (`Extras/People/`, "Edward Jones", "Jamaica") and doesn't know `spice/` exists.
11. **Entity creation rarely asks for connections** — only meeting creation prompts for a link (a project). Creation is the cheapest moment to capture an edge, and Sauce spends it nowhere else.

---

## Part 3 — Unified idea backlog (ranked by leverage-per-effort)

Merged and de-duplicated across all three investigations. Effort: **S** ≈ a patch, **M** ≈ a cycle, **L** ≈ a multi-cycle arc.

### Tier 1 — highest leverage, mostly adopting primitives that already exist
| Idea | What | Effort |
| --- | --- | --- |
| **Close-the-edge-matrix wave** | A batch of pure adoptions: person↔team keys (+ roster), `trips:` writers, `[from::]` task origin, meeting→project breadcrumb, BacklinkPanel back on Project/Meeting. Highest connectivity per line of code. | S–M |
| **`related-notes` universal panel (new mechanism)** | One collapsed "Related" section on every entity: canonical-key backlinks + plain out/back-links + semantic neighbors from a cron-materialized `sc-bridge` sidecar. Converts the biggest felt gap ("I land on a note and see nothing related") into shipped chrome. | M |
| **Global "+ New…" launcher** | A command-palette command / hub listing *every* creatable thing from `entity-create-registry.json`. ~1-day patch; the registry already has id/label/icon. (This is Stage 1 of the meta-blueprint plan below.) | S |
| **Ship `cowork:doctor`** | The automation layer's failure modes (stale sidecars, dead schedules, drift) are invisible until a hub looks wrong. Queued for many cycles. | M |

### Tier 2 — structural bets
| Idea | What | Effort |
| --- | --- | --- |
| **`collections` blueprint — user-defined note-types** | **The recommended answer to the meta-blueprint question** (full design in Part 4). | M (2–3 cycles) |
| **`task-entity` graduation → unified task inbox** | Finish the note-per-task model (already shipped as an unconsumed mechanism): every capture path writes a `spice/tasks/` note with a real `source_note`, collapsing the three task systems into one "all open, everywhere" spine. | L |
| **`day-spine` mechanism** | Prev/next-day nav + same-day sibling links (daily ↔ journal ↔ scratch ↔ that day's meetings/to-do) + native weekly/monthly notes, so the time spine stops being cowork-private. | M |

### Tier 3 — depth on existing blueprints
| Idea | Blueprint | Effort |
| --- | --- | --- |
| Journal hub + month/streak view + optional prompts (best delight-per-effort in the tail) | journal | S/M |
| Finance trends/charts (MoM spend + debt curve — data already in `balance_history[]`) | finance | M |
| Calendar → meeting-note scaffolding (cowork already gathers the calendar) | meetings | M |
| "Last interaction" chip + sort on the People hub | people | M |
| Bill-due surfacing from paychecks into daily/to-do | finance × to-do | M |
| Project archive / close-out sweep | project | S/M |
| Promote-scratch action ("make this a doc / task / meeting") | scratch | M |

### Tier 4 — consistency & connective cleanup
| Idea | What | Effort |
| --- | --- | --- |
| **entity-linker heal** | Wire the orphaned `people-identity` into an install/cron heal that converts exact-match plain-text names → wikilinks (alias-aware; the safe subset of old correlate). | M |
| **`correlate` rebuilt as a platform blueprint** | Schema-aware (reads `schemas-index.json` + registries, no hardcoded folders); report as a vault note with accept buttons. Retires the legacy fossil. | M–L |
| **`vault-map` hub** | Renders the live edge matrix + orphans + dead panels + islands. A drift detector that would have caught gaps #2/#3 automatically. | L |
| **Cross-hub strips** | ActivityFeed-scoped "recently seen" strips on People/Trips/Teams hubs. ~10-line adopters. | S |
| **Cowork↔daily merge/bridge** | Fold `spice/cowork/Today.md` into the daily dashboard, or add reciprocal links. Removes the most confusing duplication. | S–M |
| **entity-create adoption for teams/trips/boards** | Three blueprints still create via Templater/bespoke dialogs; converge on the platform's own primitive (also fixes teams' missing "+ New Team"). | S each |
| **finance-links pass** | `projects:` on invoices; month-note ↔ monthly-spine links. Ends the largest island's isolation. | S |

### System-health (do regardless of roadmap)
- Reconcile `Docs/agent-guides/cycle-status.md` (claims 0.139.0 vs live ~0.158.0; known regen issue).
- Decide the fate of `task-entity` (graduate it) and `cowork-reconciler` (register or remove).
- The manifest `description` fields have become multi-thousand-word changelogs, burying the actual one-line "what is this."

---

## Part 4 — The meta-blueprint deep-dive (the centerpiece)

### How authoring works today
- **A note-type is ~50 lines of declarative JSON + one markdown template.** `journal`'s manifest (51 lines, 2 files, zero CustomJS) is the existence proof. `scratch` (244 lines) adds CustomJS + breadcrumb + `claude_surface` + a `new_entity_buttons[]` entry. `project` (827 lines, 16 CustomJS classes) is the ceiling a GUI would never need to reach.
- **End-user note *creation* is already declarative, GUI-driven, and good** via `entity-create`: a real form-builder (prompt types, `required`, `validate` predicates, a `derive` DSL, dynamic `options_source`, `presetPrompts`, `seed_from_defaults`) with an authoritative JSON Schema and machine-checked type-field conventions. **No installer involvement at creation time — it works on mobile.**
- **Two behaviors decide the design** (verified in `platform/install.js`): (1) the flattened `entries[]` is rebuilt from `contributions` on every install, so hand-added entries get clobbered; (2) `pruneEntityCreateRegistry` *deletes* any contribution not in the subscription. **There is no consumer-owned seam in this registry today** — the only sanctioned override seam is `.claude/commands.local/` + `.claude/skills.local/` (landmine #22).
- **Guardrails any authoring surface must satisfy:** the schema registry + `lint-schemas`; ~60 preflight harnesses (including `run-customjs-loadable.js`, which replicates CustomJS's one-expression `eval` loader across 179 class files); the ~376-file synthetic seed-vault migration net; the version-gated migration lifecycle; and the fully automatic workshop→brew release pipeline.

### The design space has three distinct levels
- **(a) Create any note from existing types** — ~90% shipped. Missing only a *global launcher* (Tier 1 above). Pure plumbing.
- **(b) User-defined in-vault note-types ("lite blueprint")** — **the recommendation.** A user defines a new type *within their own vault* without touching the workshop. Precedent exists: cowork's `bootstrap-vault` already lets users define engagements (fields, cadences) written to vault-owned config. Sauce has crossed the "user-defined instances of a platform concept" line once, successfully.
- **(c) The literal meta-blueprint** — an Obsidian surface that emits *workshop* blueprints. The scaffold is trivial; the pipeline tax (harnesses, seed fixtures, migrations, review, release) is 80% of the cost and *cannot move into a GUI.* A GUI here adds a lossy hop, not leverage.

### Recommended design — a two-tier type system with a promotion path

**Frame shift:** not "a blueprint that creates blueprints," but **local types** (user-owned, declarative, instant, in-vault) + **platform types** (workshop blueprints, versioned, distributed), with an **agent-mediated promotion** between them. Local types are the sandbox; the workshop stays the foundry.

**Stage 1 — "Create anything" launcher (one cycle, small).** An Obsidian command / hub block enumerating every `entity-create` entry as a searchable "+ New…" launcher. Reuses existing suggester patterns; extend `run-entity-create.js`.

**Stage 2 — the `collections` blueprint (the centerpiece, 2–3 cycles).**
- **UX:** a **Collections** nav button → hub → **"+ New Note Type"** modal wizard (type name, icon, fields = label + type from the existing prompt enum + required?, filename pattern, "show in nav row?"). On save the type appears on the hub and **"+ New Recipe" works immediately** (runtime EntityCreate, no install, mobile-safe). Editing the type re-opens the wizard and affects **new notes only** — *explicitly no retroactive migration* (that's the platform tier's job).
- **Artifacts (all data, zero code):** a **consumer-owned** `ranch/entity-create-local.json` (one contribution per type, exact `new_entity_buttons[]` schema, validated before write, `.sauce-backup` on rewrite); a `spice/collections/<Type>.md` hub invoking a generic `CollectionHub` renderer; a `spice/collections/<type>/` folder + a static (non-Templater) body template; optional local rule fragment for `/audit`.
- **Engine changes (small, bounded):** `EntityCreate._loadSpec` merges the canonical registry then the local file (~30 lines; canonical wins on id collision). **No installer/pruning change** — the local file is simply outside the installer's jurisdiction, which sidesteps the prune, the rebuild, *and* the materialize_once data-loss class in one move. `/audit` learns local types are legitimate. New `run-collections.js` harness + a seed-vault `SEED-PRESERVE-*` fixture proving installs preserve the local file byte-for-byte.
- **Distribution:** local types never ride the release train (the point). They survive `sauce update` because nothing in the install path owns their file; they sync across the user's devices via Obsidian Sync; they're per-vault by design.

**Stage 3 — the promotion path, i.e. the honest version of (c) (1–2 cycles, mostly a skill).** A `/promote-note-type <slug>` Claude Code skill (consumer intake → workshop execution via the existing board/autoloop): reads the local type, scaffolds a journal-class workshop blueprint (manifest with `materialize_once` on every module-dir dest, entity-create entry verbatim, rule fragment, `claude_surface` row, skeleton `HC-*` asserts, seed note), runs `release:preflight` + `preflight-bumped`, opens a PR. The auto-release pipeline ships it. The in-Obsidian surface is *one button* — "make this type available on my other vaults" — not a manifest editor.

### The real worry — what actually makes this hard (ranked hard → plumbing)
1. **Type *evolution*, not creation.** Creating a type is 50 lines of JSON; *changing* one that has instances is a migration problem — the reason the seed-vault, migration gate, and half of `landmines.md` exist. The GUI must draw the line at "edits affect new notes only," or it silently signs up for the migration business.
2. **The code boundary.** Everything beyond generic cards is CustomJS — the platform's most landmine-dense zone (one-expression `eval` loading, TDZ, instance-vs-static, cold-load `dv.current()`). GUI/LLM-authored code injected into a consumer vault would bypass every preflight gate. **The answer — users compose data, the workshop ships all code — is the only posture consistent with this codebase's history.**
3. **Data-loss semantics.** A *shipped* blueprint lost user data for three versions (the Recurring Tasks registry). Any authoring surface must live either fully outside the installer's write jurisdiction (Stage 2's separate file — verified necessary by reading `pruneEntityCreateRegistry`) or fully inside its safety mechanics. Half-in is where the bodies are.
4. **The auto-release pipeline as amplifier.** Generated blueprints that merge get *shipped to brew automatically* — leverage and hazard. The promote skill must run `preflight-bumped`; never let generation shortcut to `main`.
5. **Two-world identity.** A local `type: recipe` and a later platform `recipe` collide. Canonical-wins + audit-flag is workable but must be decided day one, with a namespacing convention for local slugs.
6. **Mostly plumbing:** the launcher, the local-registry merge, the schema-validator port, the `CollectionHub` renderer, the wizard modal, the promote scaffolder, wizard dependency upkeep, docs. Real work, no unknowns.

*On the horizon:* the unmerged **sauce Obsidian-plugin POC** (`poc/sauce-plugin`) would give the Stage 2 wizard a natural home as a plugin modal instead of a CustomJS dialog — same data artifacts, better UX. Build the wizard as a thin shell over pure helpers so it ports; nothing here blocks on it.

### Verdict
**"A blueprint that creates blueprints" is the wrong frame taken literally, and the right instinct one level down.** The literal version buys almost nothing (cheap scaffold, un-movable pipeline tax) and Sauce already has a working meta-layer for that tier (declarative manifests + schema registry + the agent/autoloop workflow + a hands-off release train). **Build (b): user-defined in-vault note-types via a `collections` blueprint** — it reuses the platform's best mechanism exactly as designed, needs one small engine change, zero installer-jurisdiction changes, and answers the real worry in the place the user feels it: *my* vault, *my* categories, no release train, works on mobile, instant. Then let **(c) be a promotion path, not an authoring surface.**

**Recommended sequence:** Tier-1 glue wave (immediate, cheap connectivity) → Stage 1 launcher → Stage 2 `collections` → Stage 3 promotion skill, with `cowork:doctor` and the cycle-status reconciliation slotted in for system health.

---

## Appendix — key files cited
- `platform/mechanisms/entity-create/` (+ `schema/new-entity-buttons.json`) — the authoring precedent.
- `platform/install.js` — `applyNewEntityButtons`, `pruneEntityCreateRegistry` (the pruning/rebuild behavior that forces a consumer-owned local file).
- `platform/mechanisms/backlink-panel/backlink-panel.js`, `activity-feed/activity-feed.js` — the glue renderers.
- `platform/mechanisms/people-identity/people-identity.js` — orphan resolver (zero callsites).
- `platform/mechanisms/task-entity/task-entity.js` — unconsumed note-per-task core (`source_note` never populated).
- `platform/mechanisms/smart-connections-bridge/sc-bridge.js` — headless semantic index.
- `platform/blueprints/{journal,scratch,project}/manifest.json` — the 51 / 244 / 827-line blueprint size ladder.
- `ranch/entity-create-registry.json` — the creation registry (add link-prompts here).
- `Docs/landmines.md`, `Docs/agent-guides/{architecture,build-test-verify,code-conventions,schemas,migration-regression-net,note-chrome}.md` — the guardrails any authoring surface must satisfy.
- `~/.claude/skills/correlate/SKILL.md` — the stale legacy correlation tool (hardcoded to the pre-Sauce vault).
