---
arc: test-coverage-arc
phase: phase-2-impl-1
surface: blueprint/project
axis: installer_migration
archetype: seed-migrate
target_file: platform/test/run-seed-migrations.js
status: ready-for-plan
---

# Impl-1 — project blueprint installer migration coverage

## Goal

Close the `installer_migration` gap on `blueprint/project` (composite axis score 0.0 → ≥ 1.0 with all 5 untested `apply*` functions getting `HC-V01190-PROJ-SEED-MIGRATE-*` families in `platform/test/run-seed-migrations.js`).

## Background

The audit's qualitative pass identified five project-blueprint installer migrations untested at vault-level:

| # | apply* function | Introduced | Purpose |
|---|---|---|---|
| 1 | `applyProjectSectionsMigration` | v0.102.0 | Flat `docs/*.md` → `docs/knowledge/*.md` + project `sections:` frontmatter list |
| 2 | `applyProjectSectionsHubMigration` | v0.103.0 | Materialize per-section + per-sub-section hub notes, rewire `Docs.md` to `ProjectDocsIndex`, inject breadcrumb blocks, convert `sections:` to wikilinks |
| 3 | `applyProjectSectionsCloseRepair` | v0.103.0.1 | Repair malformed YAML frontmatter close `-"[[--]]"` → `---` |
| 4 | `applyEmptyProjectWikilinkRepair` | v0.105.0.2 | Rewrite empty `project: "[[]]"` → correct `project: "[[ProjectName]]"` derived from project filename |
| 5 | `applyProjectTodoBackfill` | v0.116.0 | Create `<ProjectName> To-Do.md` per project missing one |

Only static source-grep checks exist today (`HC-V01020-PSM-1`, `HC-V01030-PSHM-1`, etc.); none of these execute the migration against a vault and assert post-state.

## Architecture

Extend `platform/test/run-seed-migrations.js` with a new `HC-V01190-PROJ-SEED-MIGRATE-*` family. The harness already does the heavy lifting (copy seed → patch sentinel → run install via headless `run-install.js` → assert against post-install state). Adding asserts means: (1) extend the seed-vault with pre-migration project fixtures, (2) append assert blocks to the harness referencing each migration's post-state contract + idempotency invariants.

The seed-vault is already rebaselined to v0.119.0 — meaning the existing `Sample Project` in the seed is already in **post-migration** shape for all 5 migrations. We cannot test against the existing project because the migrations are no-ops on it.

**Approach**: Add a NEW synthetic project under `platform/test/seed-vault/spice/projects/Legacy Project/` constructed at the **pre-migration shape** of each migration. The install run during the seed-migrations harness will then exercise all 5 `apply*` functions against this fixture, and the new assert family verifies the post-install state.

## Seed-vault extensions (pre-migration shapes)

New fixture: `platform/test/seed-vault/spice/projects/Legacy Project/`

```
Legacy Project/
├── Legacy Project.md                        # project hub note; pre-shape #1, #3
├── docs/
│   ├── Docs.md                              # pre-shape #2 (no ProjectDocsIndex call)
│   ├── Old Note.md                          # pre-shape #1 (flat doc-note at docs/ root)
│   └── Custom Section/
│       └── Custom Note.md                   # pre-shape #1 (existing custom subfolder; survives as section)
└── (NO `Legacy Project To-Do.md`)           # pre-shape #5 — triggers todo-backfill
```

Additionally, to test #4 (`applyEmptyProjectWikilinkRepair`), add to the existing `Sample Project`'s docs path:

```
spice/projects/Sample Project/docs/knowledge/Empty Link Note.md   # has `project: "[[]]"` triggering #4
```

(Sample Project is post-migration on #1-#3 so this gets injected into its existing knowledge section.)

**Pre-migration content sketches** (exact bodies authored in the impl plan):

- `Legacy Project.md`: frontmatter with `type: project`, NO `sections:` field, content `-"[[--]]"` at frontmatter close to trigger #3.
- `Docs.md`: type `docs-hub`, body referencing legacy `ProjectDocsCards` (not `ProjectDocsIndex`), no breadcrumb.
- `docs/Old Note.md`: type `doc-note`, NO `section:` field (flat layout, triggers #1 move into knowledge/).
- `docs/Custom Section/Custom Note.md`: type `doc-note`, `section: "Custom Section"` (string, not wikilink).
- `Empty Link Note.md`: type `doc-note`, `project: "[[]]"` (empty wikilink), `section: "[[Knowledge]]"`.

## Asserts added

New family `HC-V01190-PROJ-SEED-MIGRATE-*`, organized by migration:

### Sub-family A — `applyProjectSectionsMigration` (3 asserts)

- `HC-V01190-PROJ-SEED-MIGRATE-A1`: `Legacy Project/docs/knowledge/Old Note.md` exists post-install (flat doc moved into knowledge subfolder)
- `HC-V01190-PROJ-SEED-MIGRATE-A2`: `Legacy Project/docs/Old Note.md` no longer exists (original removed)
- `HC-V01190-PROJ-SEED-MIGRATE-A3`: `Legacy Project.md` frontmatter contains `sections:` with at least `Knowledge`, `Notes`, `Custom Section` entries (custom subfolder registered)

### Sub-family B — `applyProjectSectionsHubMigration` (4 asserts)

- `HC-V01190-PROJ-SEED-MIGRATE-B1`: `Legacy Project/docs/Knowledge.md` (Section Hub for Knowledge) exists with `type: section-hub`
- `HC-V01190-PROJ-SEED-MIGRATE-B2`: `Legacy Project/docs/Custom Section.md` (Section Hub for Custom Section) exists
- `HC-V01190-PROJ-SEED-MIGRATE-B3`: `Legacy Project/docs/Docs.md` body contains `customJS.ProjectDocsIndex.render`
- `HC-V01190-PROJ-SEED-MIGRATE-B4`: `Custom Note.md` frontmatter has `section: "[[Custom Section]]"` (string → wikilink conversion)

### Sub-family C — `applyProjectSectionsCloseRepair` (1 assert)

- `HC-V01190-PROJ-SEED-MIGRATE-C1`: `Legacy Project.md` frontmatter close is `---` (the malformed `-"[[--]]"` is gone)

### Sub-family D — `applyEmptyProjectWikilinkRepair` (1 assert)

- `HC-V01190-PROJ-SEED-MIGRATE-D1`: `Sample Project/docs/knowledge/Empty Link Note.md` `project:` frontmatter is `"[[Sample Project]]"` (no longer empty)

### Sub-family E — `applyProjectTodoBackfill` (2 asserts)

- `HC-V01190-PROJ-SEED-MIGRATE-E1`: `Legacy Project/Legacy Project To-Do.md` exists post-install (backfilled)
- `HC-V01190-PROJ-SEED-MIGRATE-E2`: That file contains `customJS.ToDoDailyProjectGroups` in its body (canonical dataviewjs block)

### Sub-family F — Idempotency (4 asserts)

- `HC-V01190-PROJ-SEED-MIGRATE-F1`: Second install does not move Old Note again (idempotency on #1)
- `HC-V01190-PROJ-SEED-MIGRATE-F2`: Second install does not duplicate Section Hub creation (no `Knowledge.md.bak`)
- `HC-V01190-PROJ-SEED-MIGRATE-F3`: Second install does not re-repair already-correct frontmatter (file byte-identical)
- `HC-V01190-PROJ-SEED-MIGRATE-F4`: Second install does not overwrite the backfilled To-Do.md

**Total: 15 sub-asserts**

## Composite-lift target

Pre-impl-1 project blueprint composite ~0.617 (from rebased matrix). Post-impl-1 target: lift `installer_migration` axis from 0.0 → 1.0 (all 5/5 migrations covered), pushing composite to ~0.717. That's a **+0.10** lift — short of the design's ≥ +0.15 done-criterion.

To meet the criterion, impl-1 also adds one PROJ-SEED-MIGRATE-G assert verifying `history[]` includes one event per migration invocation on the Legacy Project — confirming each apply* fn was actually invoked and not silently skipped. This is an integration_smoke uplift (currently 1.0 for project — already maxed) so doesn't help composite. The honest call: impl-1 lifts composite by ~+0.10. The done-criterion of +0.15 is unachievable on this surface from a single axis fix and was inherited from the arc design's general heuristic. We will document this in the impl-1 result doc as a calibrated outcome, not a failure.

(Alternative: chase widget_render lift in impl-1 too. Out of scope per the design's "stay focused" rule. Carry-forward to v0.120.x.)

## Risks + mitigations

- **Seed rebaseline drift**: Fixture must remain at pre-migration shape across rebaselines. Mitigation: the seed/prev rebaseline workflow runs install on a COPY; the committed `seed-vault/` retains the pre-shape because rebaseline-seed.js patches the sentinel back. New Legacy Project files stay at pre-shape after rebaseline IF the fixture files are NOT touched by the rebaseline copy-back. Verify: rebaseline-seed.js does a full directory replace, so Legacy Project's pre-shape would be overwritten by post-install state. **Mitigation**: add the Legacy Project fixture to a sentinel-pinned subdirectory OR encode the pre-shape as a "fixture-only" marker that rebaseline skips. The simplest fix: rebaseline-seed.js needs a list of fixture-only files NOT to copy back. Will be a side-effect addition to the impl plan.

- **History-grew assert (IDEMP-5)**: each install adds history entries. The new Legacy Project triggers 5 new apply* fn events on the first install. Existing `IDEMP-5 history grew` assert checks `before < after`. Should pass naturally. Verify in the impl plan that no off-by-N issues arise.

- **Empty Link Note injection into Sample Project**: this injects test data into the seed's already-post-migration Sample Project. Risk: makes the seed feel less clean. Mitigation: localize the empty-wikilink test to a brand-new doc-note rather than altering an existing one.

## Out of scope

- Widget_render axis on project (defer to v0.120.x; carry-forward from audit).
- New behavioral runner; we're extending an existing harness.
- Schema additions to `platform/schemas-index.json` (no new schemas owned by impl-1).
- Any consumer-vault deploy or brew tap bump.
- Changing the rubric library.

## Done criteria

1. `Legacy Project/` fixture committed in `platform/test/seed-vault/`.
2. `Empty Link Note.md` fixture committed under `Sample Project/docs/knowledge/`.
3. 15 new `HC-V01190-PROJ-SEED-MIGRATE-*` asserts in `platform/test/run-seed-migrations.js`, all green.
4. `npm run release:preflight` exit 0 with new asserts wired in (preflight already invokes run-seed-migrations.js; no script changes needed).
5. `node scripts/regen-coverage-matrix.js && node scripts/render-coverage-audit.js` refresh shows project's `installer_migration` axis lifted from 0.0 to 1.0.
6. Rebaseline-seed.js does not clobber the Legacy Project pre-shape (verify or extend script).
7. Result doc `Docs/plans/2026-06-16-test-coverage-impl-1-result.md` written.
8. Handoff prompt `Docs/prompts/2026-06-16-post-impl-1-handoff.md` written, naming impl-2 as the next phase.
