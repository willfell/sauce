# Project Workstreams — Dedicated Hub Re-architecture Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan slice-by-slice. Each slice below is an independently shippable + testable autoloop turn (its own Planning card, its own CI-gated PR). Steps use checkbox (`- [ ]`) syntax for tracking. **Do NOT bump versions or tag** — the release pipeline owns that on merge.

**Origin card:** `spice/projects/sauce/tasks/Workstreams in Projects need updating/` (project board → In Progress). This plan is the decomposition the card's blocked-questions resolution asked for.

**Goal:** Move each project's workstreams off the project **hub** note and into a dedicated per-project **workstreams hub** — implemented by repurposing the pre-existing **Map note** — so the workstreams note becomes the single source of truth, the create/remove/update **manager** lives there (not on the hub), the hub no longer renders a workstreams section, and a project **nav button** ("Map" relabeled "Workstreams") navigates to it. Existing projects migrate via a careful, version-gated, data-preserving heal that is dry-run-verified against the real accuris + headspace vaults before it ships.

**Architecture:** Reuse existing surfaces rather than inventing new ones. The project already scaffolds a per-project **Map note** (`type: map`, frontmatter `workstreams: []`, renders `ProjectWorkstreams`, reachable via the project nav-button row). That note *becomes* the workstreams hub. The change is (a) make the Map note's `workstreams` frontmatter the sole source of truth, (b) relocate `ProjectWorkstreamManager` from the hub template onto the Map note, (c) drop the manager from the hub template, (d) relabel the nav button, (e) heal existing projects. Everything ships as small, ordered, individually-verifiable slices; the loop attempts nothing it cannot regression-test in `platform/test/run-*.js`.

**Tech Stack:** customJS helpers (`platform/blueprints/project/helpers/*.js`), Obsidian templates (`platform/blueprints/project/templates/*.md`), the blueprint manifest (`platform/blueprints/project/manifest.json`), install-time heals (`platform/install.js`), and the zero-dep Node harness (`platform/test/run-*.js`) as the gate.

---

## Resolved design decisions (from the card's user response, 2026-07-01)

These are locked by the user's answer in the origin card. Implementers MUST NOT re-litigate them; open a fresh block-with-questions only for a genuinely new sub-decision.

1. **Source of truth = the workstreams note itself, NOT the hub.** "the source of truth for a project is the actual note for Work streams." → The Map note's `workstreams` frontmatter is authoritative. The hub note stops being a workstreams data source.
2. **Repurpose the pre-existing note (the Map note), reached via the existing nav button.** "with the project NAV buttons you can even get to, so let's utilize that pre-existing note for this." → No brand-new note type; the Map note is the workstreams hub, and its existing nav button is relabeled "Workstreams."
3. **Remove the workstreams manager from the project hub** (per the card body: "their existence is removed from a project hub").
4. **Migrate existing projects with intense attention to detail; verify against real vaults.** "the migrations to ensure all existing projects are OK. You can even analyze projects with … accuris and headspace … to ensure … things will work." → The heal is dry-run analyzed against accuris + headspace real project notes before it ships; **no `workstreams` entry may ever be dropped.**
5. **Align with all blueprints and patterns of development.** Naming, icon set, marker regions, SectionLabel/no-`## H2`, `materialize_once`, version-gated heals — all follow existing conventions.

### Assumption flagged for confirmation (cheap to correct — this is a doc)

- **"That pre-existing note" = the Map note.** The Map note is the only pre-existing per-project note that already carries `workstreams` frontmatter, renders `ProjectWorkstreams`, and sits in the nav-button row — so it is the natural referent. If the user instead meant a genuinely new note, Slice 0 (below) is where that is caught **before any migration ships.** Because this plan is doc-only, correcting the referent here costs nothing.

---

## Current state (verified 2026-07-01, file:line)

- **Dual-sourced today.** `ProjectWorkstreamManager.updateWorkstreams()` writes `workstreams` to BOTH the hub (atlas) note AND the Map note (`platform/blueprints/project/helpers/project-workstream-manager.js:98-103`). So on projects touched by the manager, the Map note already mirrors the hub — but older/untouched projects may have data only on the hub.
- **Readers of `workstreams`:**
  - `ProjectWorkstreams` (Map renderer) reads `current.workstreams` — already on the Map note (`helpers/project-workstreams.js:31`).
  - `ProjectWorkstreamManager` reads `parseWorkstreams(current.workstreams)` — on the hub (`helpers/project-workstream-manager.js:30`).
  - `ProjectNavButtons` workstream widget reads `atlasCache?.frontmatter?.workstreams` — the **hub** note's cache (`helpers/project-nav-buttons.js:591`).
  - Kanban Card template reads the hub's `workstreams` via a 3-strategy read (`templates/Kanban Card.md:182-228`).
- **Manager renders on the hub:** `templates/Project.md:30` (`ProjectWorkstreamManager`). Hub frontmatter default `workstreams: []` (`manifest.json:235`).
- **Map note:** `templates/Project Map.md` (`type: map`, `workstreams: []`, renders `ProjectNavButtons` + `ProjectWorkstreams`); manifest entity-create entry `manifest.json:242-246`.
- **Nav buttons:** `helpers/project-nav-buttons.js:375-382` (icon set), `:442-471` (button array; "Map" button ~:450). Card workstream picker `:586-708`.
- **Existing heals:** `applyProjectHubLegacyHeadingCleanup` strips legacy `## Workstreams` H2 (`install.js:2620`, LEGACY map `:2632`). No workstreams-DATA migration exists yet.
- **Tests:** render guards `platform/test/run-project-render-guards.js:27-28`; Kanban workstream cases `platform/test/run-helper-cases.js:6492-6518`; manager source-read `:14331`.
- **Blueprint version:** `manifest.json:3` = `1.29.0` (implementers do not hand-bump).

---

## Slices (safe-ordered; each is one Planning card + one CI-gated PR)

Ordering is chosen so no intermediate state loses data or leaves a dangling surface. **Reads migrate before writes; the new home exists before the old one is removed; the heal preserves before the template deletes.**

### Slice 0 — Confirm the referent + author the migration-analysis harness (doc/test-only, non-behavioral)
- [ ] Add a read-only analysis script (`scripts/autoloop/analyze-workstreams.js` or a `platform/test/` fixture-driven check) that, given a project-notes tree, reports for each project: does the hub have `workstreams`, does the Map note have `workstreams`, do they agree, and would union-vs-map-wins differ. No writes.
- [ ] Run it against **accuris + headspace** project notes; record the divergence profile in the card. This is the "intense attention to detail" evidence the user asked for and the input to the Slice 3 merge rule.
- [ ] Confirm assumption (Map note = the pre-existing note) against real vault layout.
- **Test:** the analyzer is a pure function over a fixture tree in `run-*.js` (no behavioral product change → Gate B skipped).

### Slice 1 — Single source-of-truth read helper (pure, non-breaking)
- [ ] Add a pure helper (e.g. `resolveWorkstreams({ mapFrontmatter, hubFrontmatter })`) that returns the canonical list: **Map note wins when non-empty; hub as fallback.** Export it for the harness.
- [ ] Do NOT rewire any reader yet — this slice only lands the helper + its semantics.
- **Test:** exhaustive cases in `run-helper-cases.js` (map-only, hub-only, both-agree, both-diverge, empty/malformed) — must fail without the helper. Mutation-adequate for Gate B.

### Slice 2 — Re-point readers to the Map note as source of truth
- [ ] `ProjectNavButtons` workstream widget: read Map-note `workstreams` via the Slice-1 helper instead of `atlasCache.frontmatter.workstreams` (`project-nav-buttons.js:591`).
- [ ] Kanban Card template: read the Map note's `workstreams` (adjust the 3-strategy read target, `Kanban Card.md:182-228`).
- [ ] Each reader keeps the hub fallback so untouched/legacy projects still resolve until Slice 3 heals them.
- **Test:** render-guard + helper-case coverage asserting readers resolve from the Map note; regression tests fail without the re-point.

### Slice 3 — Relocate the manager onto the Map note + make it write Map-only
- [ ] Move `ProjectWorkstreamManager` render from `templates/Project.md:30` to `templates/Project Map.md` (below `ProjectWorkstreams`, its own SectionLabel — no `## H2`, per note-chrome).
- [ ] `updateWorkstreams()` writes ONLY the Map note (drop the dual hub write, `project-workstream-manager.js:98-103`); read from the Map note.
- [ ] Manager `current` is now the Map note, not the hub — verify `dv.current()`/cache targeting.
- **Test:** manager source/behavioral cases updated to assert single-write to the Map note; render guard on the Map note; fail without the relocation.

### Slice 4 — Version-gated, data-preserving heal over existing projects
- [ ] New heal in `install.js` (gated as a one-time reshaper — see `Docs/agent-guides/` migration-lifecycle GATE): for each existing project, **backfill the Map note `workstreams` = union of Map + hub** (never drop an entry; the Slice-0 analysis picks union vs. map-wins), then strip the workstreams manager section from the hub body (mirror `applyProjectHubLegacyHeadingCleanup`'s marker-safe, idempotent, `.sauce-backup` approach).
- [ ] Idempotent + backup + only-when-present, exactly like the existing hub-heading cleanup.
- **Test:** fixture projects (map-only, hub-only, divergent, already-migrated) in the seed-vault regression net; assert no data loss + idempotency. **Re-run the Slice-0 analyzer against accuris + headspace post-heal (dry-run) before the PR merges.**

### Slice 5 — Remove the hub workstreams surface + relabel the nav button
- [ ] Remove `ProjectWorkstreamManager` from `templates/Project.md` (hub) entirely; drop `workstreams` from the hub frontmatter default (`manifest.json:235`) once no reader depends on it.
- [ ] Relabel the "Map" nav button → "Workstreams" (`project-nav-buttons.js:~450`); add/rename a "workstreams" icon in the icon set (`:375-382`) if conventions call for a distinct glyph, else reuse `map`.
- [ ] Self-hide the button when already on the workstreams (Map) note, per existing nav-button self-hide grammar.
- **Test:** render-guard + button-label helper cases; assert the hub no longer renders the manager and the button reads "Workstreams."

### Slice 6 — Docs + convention alignment
- [ ] Update `Docs/agent-guides/project-blueprint-ui.md` (+ `note-chrome.md` if the section grammar shifts) to describe the workstreams hub, source-of-truth, and nav grammar.
- [ ] Cross-check `claude_surface[]` / directory map if any managed path changed.
- **Test:** doc-only (Gate B skipped); preflight green.

---

## Migration safety (the user's "intense attention to detail")

- **Invariant: never drop a workstream.** The Slice-4 heal takes the **union** of hub + Map entries keyed by workstream `id`; on `id` collision prefer the entry with the richer fields (name/description). The Slice-0 analyzer quantifies how often hub and Map diverge on the real vaults so the merge rule is evidence-based, not assumed.
- **Order guarantees no dangling surface:** readers gain the Map-note source (Slices 1–2) and the manager moves there (Slice 3) *before* the hub surface is removed (Slice 5); the heal (Slice 4) backfills *before* removal.
- **Version-gated, once, backed up, idempotent** — same shape as `applyProjectHubLegacyHeadingCleanup` (`install.js:2620`), classified as a one-time reshaper under the migration-lifecycle GATE.
- **Real-vault dry-run gate:** Slices 0 and 4 both run the analyzer against accuris + headspace project notes; the Slice-4 PR does not merge until the post-heal dry-run shows zero data loss on those real trees.
- **Obsidian-runtime caveat:** the manager modals are dogfood-only (not end-to-end testable in Node). Only pure helpers + source-shape + render guards are harness-covered; behavioral manager changes rely on those plus manual dogfood. Any slice that cannot be regression-tested must block-with-questions rather than ship blind.

## Testing strategy

- Pure helpers (`resolveWorkstreams`, union/merge, analyzer) → `run-helper-cases.js` with mutation-adequate cases (fail without the change).
- Render guards for `ProjectWorkstreams` + `ProjectWorkstreamManager` on their new host notes → `run-project-render-guards.js`.
- Heal → seed-vault regression net with divergent-project fixtures (`Docs/agent-guides/migration-regression-net.md`).
- Every behavioral slice ships a `platform/test/run-*.js` test that is red without the change — the Gate B Layer 1 requirement.

## Risks & open items (non-blocking)

- **Referent confirmation** (Map note) — caught in Slice 0 before any migration.
- **Kanban Card read retarget** (Slice 2) touches new-card creation; keep the hub fallback until the heal lands to avoid a gap on unmigrated projects.
- **Nav-button icon** — reuse `map` glyph unless a distinct "workstreams" icon is clearly warranted (avoid growing the icon set without need).
- **Selector + In-Progress:** the origin epic card is parked in In Progress (the selector skips In-Progress), so the loop will not auto-advance these slices. Each slice must be promoted to a **Planning card** for the loop to pick it up (or implemented by an explicit turn). Flagged in the turn handoff.
