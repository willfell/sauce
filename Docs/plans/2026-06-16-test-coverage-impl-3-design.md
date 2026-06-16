---
arc: test-coverage-arc
phase: phase-4-impl-3
surface: mechanism/entity-create
axis: installer_migration
archetype: seed-migrate
target_file: platform/test/run-seed-migrations.js
status: ready-for-plan
---

# Impl-3 — entity-create mechanism installer migration coverage

## Goal

Close the `installer_migration` gap on `mechanism/entity-create` by covering 2 untested `apply*` functions via direct-invocation, following the established HC-V01190 pattern from impl-1 and impl-2.

## Inventory (2 apply* functions)

| # | Function | Introduced | Purpose | Pre-shape | Idempotency |
|---|---|---|---|---|---|
| 1 | `applyNewEntityButtons` | v0.46.0 S2 | Registry materialization — writes `ranch/entity-create-registry.json` from a manifest's `new_entity_buttons[]`. Injects AccentButton blocks at hub-kind `target_path`s. | manifest declares `new_entity_buttons[]` (or registry missing entries) | File-exists + contribution-keyed merge (by `manifest.name`) |
| 2 | `applyEntityCreateGuardMigration` | v0.110.1 | Vault-wide rewrite of direct `customJS.EntityCreate.render(dv, {...})` to customjs-guard form | `.md` file under `spice/` with direct EntityCreate render call | Regex `.test()` skip — guard form doesn't match `DIRECT_CALL_RE` |

**Signatures**:
- `applyNewEntityButtons(tp, manifest, variables, history, git)` — uses singular `manifest` arg
- `applyEntityCreateGuardMigration(tp, mech, variables, history, git)` — uses `mech` arg (JS doesn't care; we pass the manifest object in either case)

**Export status**:
- `applyEntityCreateGuardMigration` — already exported
- `applyNewEntityButtons` — NOT yet exported (impl-3 adds it)

## Architecture

Same direct-invocation pattern as impl-1 + impl-2:

1. Add `runEntityCreateMigrateFamily()` function in `platform/test/run-seed-migrations.js`
2. Build a tmp vault from a `Legacy EntityCreate/` fixture sub-directory
3. Invoke each migration via install.js exports
4. Use the shared `makeFsAdapter(root)` helper

Path mapping: fixture lives at `platform/test/seed-vault/spice/entity-create-legacy/`. Harness copies it into the tmp vault at `spice/entity-create-legacy/` (no canonical-path rename like finance needed — entity-create is a mechanism without a fixed vault home; the guard-migration just walks `spice/` recursively).

## Seed-vault extensions (pre-migration shapes)

New fixture root: `platform/test/seed-vault/spice/entity-create-legacy/`

| Path | Purpose | Triggers |
|---|---|---|
| `Legacy Hub.md` | Hub note with direct-call EntityCreate (no guard wrapper) | #2 guard migration |
| `Legacy Detail.md` | Doc with direct-call EntityCreate (different render instance) | #2 (second file to verify vault-walk) |
| `Already Guarded.md` | Doc with EntityCreate ALREADY in guard form | #2 idempotency — verify no double-rewrite |

The fixture also implicitly exercises `applyNewEntityButtons` via a synthetic manifest object passed to the test harness. The manifest's `new_entity_buttons[]` array carries 2-3 entries (one with `render_in: { kind: "hub", target_path: "spice/entity-create-legacy/Legacy Hub.md" }` to trigger hub injection, and one without).

### Pre-migration content sketches

**Legacy Hub.md** (no `materialize_once`, no marker):
```markdown
---
title: Legacy Hub
type: legacy-hub
created_at: 2026-01-01T00:00:00.000Z
---

# Legacy Hub

```dataviewjs
await customJS.EntityCreate.render(dv, { instance: "legacy-doc" });
```
```

**Legacy Detail.md** (same shape, different instance):
```markdown
---
title: Legacy Detail
type: legacy-detail
created_at: 2026-01-01T00:00:00.000Z
---

# Legacy Detail

```dataviewjs
await customJS.EntityCreate.render(dv, { instance: "legacy-detail-create" });
```
```

**Already Guarded.md** (in guard form — should be untouched):
```markdown
---
title: Already Guarded
type: guarded
created_at: 2026-01-01T00:00:00.000Z
---

# Already Guarded

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "EntityCreate", args: [{ instance: "already-good" }] });
```
```

## Asserts added

New sub-family `HC-V01190-EC-SEED-MIGRATE-*` in run-seed-migrations.js's new `runEntityCreateMigrateFamily()` function:

### Sub-family A — `applyNewEntityButtons` (5 asserts)

- A1: `ranch/entity-create-registry.json` exists post-invoke
- A2: registry has `schema_version: 1`
- A3: registry has `contributions["legacy-fixture-blueprint"]` keyed under the synthetic manifest's name
- A4: registry has at least 2 entries in the contribution
- A5: hub injection: `Legacy Hub.md` contains an `AccentButton` block from the hub-kind entry (or the synthesized block marker, whatever the migration emits)

### Sub-family B — `applyEntityCreateGuardMigration` (5 asserts)

- B1: `Legacy Hub.md` body NO LONGER has `customJS.EntityCreate.render(dv,` (rewritten)
- B2: `Legacy Hub.md` body HAS `dv.view("ranch/views/customjs-guard"` (guard form)
- B3: `Legacy Detail.md` body NO LONGER has direct-call form (vault-walk reached it)
- B4: `Legacy Detail.md` body HAS guard form
- B5: `Already Guarded.md` body byte-identical to fixture (idempotent on already-guarded files)

### Sub-family C — Idempotency on second invocation (3 asserts)

- C1: second invocation: `Legacy Hub.md` byte-identical pass 1 vs pass 2
- C2: second invocation: registry not duplicated (contribution count unchanged)
- C3: second invocation: history records skip event OR no-write events

### Sub-family D — History audit-trail (2 asserts)

- D1: history has at least 2 events (one per migration)
- D2: no events have populated `errors[]`

**Total: 15 sub-asserts**

## install.js export additions

Add 1 new line:
```javascript
module.exports.applyNewEntityButtons = applyNewEntityButtons;
```

Pure additive. `applyEntityCreateGuardMigration` is already exported.

## Composite-lift target

Pre-impl-3 entity-create composite: ~0.778 (from rebased v0.120.1 matrix).

Math: entity-create has 5 applicable axes (cust 1.00, mig 0.00, ms 0.92, wid 1.00, smk 1.00; template_lockstep is `null` because no templates). Mean = 3.92 / 5 = **0.784**.

If impl-3 lifts mig from 0 to 1.0 (2/2 covered with both real fns invoked + the audit denominator is likely 2 — let's verify post-impl), new mean = 4.92 / 5 = **0.984**.

**Delta: +0.20** — exceeds the design's +0.15 target. Achievable.

If the audit denominator is 1 (only one apply* attributed because the audit's heuristic might miss one), even covering 1/1 lifts the axis to 1.0 → same composite gain.

## Risks + mitigations

- **`applyNewEntityButtons` not currently exported**: must add the export. Trivial.
- **Synthetic manifest construction**: the harness must pass a manifest object with valid `new_entity_buttons[]`. Use a stripped-down version of an existing blueprint's manifest (e.g. project) or author a minimal synthetic. Mitigation: read an existing entity-create-using blueprint's `new_entity_buttons[]` for reference structure.
- **Guard-migration `.sauce-backup/` writes**: the migration creates backup snapshots. The tmp vault path will have a `.sauce-backup/<timestamp>/` directory after run — confirm the assert logic doesn't choke on it. The C2 idempotency assert (second pass) should expect a SECOND `.sauce-backup/<timestamp>/` if the migration is called twice on the same file. But idempotency means second pass should NOT re-rewrite (guard form already in place), so no second backup. Verify post-implementation.
- **`applyNewEntityButtons` hub injection**: looks at `render_in.kind === "hub"` entries and injects AccentButton block at `target_path`. If the target file doesn't exist OR has a frontmatter shape the migration doesn't expect, the injection could fail silently. Mitigation: verify Legacy Hub.md frontmatter shape against the migration's expectations.

## Out of scope

- Widget render axis on entity-create (already at 1.00; no work needed)
- Behavioral runner; extending existing harness  
- Consumer deploy
- Rubric library changes

## Done criteria

1. `spice/entity-create-legacy/` fixture committed (3 files)
2. 1 new `module.exports.applyNewEntityButtons` in install.js
3. ~15 new `HC-V01190-EC-SEED-MIGRATE-*` asserts in run-seed-migrations.js, all green
4. `npm run release:preflight` exit 0 (target ~191/191)
5. Audit shows entity-create's installer_migration axis lifted from 0.0 to 1.0
6. Result doc `Docs/plans/2026-06-16-test-coverage-impl-3-result.md` written
7. Handoff prompt `Docs/prompts/2026-06-16-post-impl-3-handoff.md` written, naming Phase 5 (arc close) as next phase
