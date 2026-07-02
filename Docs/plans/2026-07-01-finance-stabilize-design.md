# Finance Stabilize — design

**Date:** 2026-07-01 · **Blueprint:** finance (0.16.0) · **Sub-project #1 of 4** in the finance "make it make sense" glue refactor.

## Context

This is the first of a four-part refactor of the live finance system (headspace vault), decomposed as:

1. **Stabilize** (this doc) — fix live bugs + hygiene on a clean base *before* redesign.
2. **Model rethink** — canonical debt naming, resolve the "Taco" overload, decide student-loan modeling.
3. **Setup & operating ergonomics** — one "set up the month" flow, deposit/allocation guardrails.
4. **Close the actuals loop** — Copilot Money actuals → category `actual`.

Stabilize splits into **consumer-vault DATA repairs** (headspace only, no release) and **one shippable CODE fix** (goes through the release pipeline). The data repairs are already applied; this doc's design is primarily the code fix.

## Data repairs (DONE — headspace consumer vault)

- **`Budget-2026-07.md`** categories re-serialized to clean block-style (22 rows, real groups restored, 0 `Unassigned`). YAML-validated: parses cleanly, planned sum $2,950 (= discretionary envelope).
- **Apple Card `deposit: 2`** set in `Paycheck Defaults.md` (permanent) + `Paycheck-2026-07.md` (this month) — it was untagged and silently defaulting to check 1.
- **Stale `FinanceNavRow`** dataviewjs block stripped from the three Defaults notes (superseded by `FinanceNav`; the class still exists so it was rendering a dead second nav row).
- **15 stale `.bak` files** removed from `spice/finance/` (tarballed to `.sauce-backup/<ts>-finance-bak-archive.tgz` first — the vault is not git-tracked, so deletion is otherwise irreversible).

## The code bug (root cause)

`_backfillBudgetGroupsFromText` (install.js:9119) and `_seedBudgetGroups` (9601) — called by `applyFinanceCategoriesGroupBackfill` / `applyFinanceBudgetGroupSeed` — detect a category's `group` **only** via a block-style continuation line (regex `^    group:` / `^  - group:`). But editors and the `entity-create` scaffold serialize categories as **inline flow-mappings** — `- {"group":"…","name":"…","planned":…,"actual":0}` — because Obsidian's `processFrontMatter` emits nested objects on one line.

Result: the heal walks a flow-mapping item, sees no `group:` continuation line, concludes the row lacks a group, and **splices a stray `    group: Unassigned` beneath it** → malformed frontmatter. The reassign pass then can't name-match (the `name` is inside the braces, not on a `name:` line) → the row is left `Unassigned`. `Budget-2026-07` carries the damage but **no** `__group_seed_migrated` marker, confirming the corrupting path is the backfill, not the seed.

This **recurs on every install** for any budget stored inline-flow — so every new month is exposed until fixed.

## Decisions

- **D1 — make the group backfill flow-mapping-aware.** In `_backfillBudgetGroupsFromText`, when a category item's start line is an inline flow-mapping (`- {…}`), **skip it** — never splice a block `group:` line beneath a flow item. Block-style items are unchanged (legacy backfill still works exactly as today). Rationale: scaffolded/edited budgets always carry `group` inside the flow-map (both the scaffold seed and `BudgetCategoriesEditor` write it), so a group-less flow item is a non-case; skipping is correct and non-corrupting. Avoids fragile in-brace string injection (YAGNI).
- **D2 — repair heal for existing damage.** New heal `applyFinanceBudgetMalformedGroupRepair`: **ungated, marker-guarded, snapshot-first, idempotent, per-file failure-loud.** Detects a flow-mapping item immediately followed by a stray `    group: Unassigned` continuation line where the flow-map **already** contains a `group` key, and removes the stray line. Self-applies across every vault (headspace already hand-repaired; this covers ero + any future recurrence). Ungated per the migration-lifecycle gate landmine — it's a **repair**, not a legacy reshaper (gate only reshapers; never gate backfill/ensure/inject/repair).
- **D3 — no schema change, no serialization change.** Clean block-style (May/June budgets) stays valid; inline-flow stays valid *after* the fix. The `entity-create` mechanism is untouched (keep the blast radius inside the finance install heals).

## Architecture / touch points

- `platform/install.js`:
  - `_backfillBudgetGroupsFromText` — add the flow-mapping skip (D1).
  - new pure transform `_repairMalformedBudgetGroups(body)` + async `applyFinanceBudgetMalformedGroupRepair(...)` (D2), mirroring `applyFinanceBudgetGroupSeed`'s snapshot/history/marker conventions.
  - register the new heal in the `applyFinanceMigrations` ordered block (after the group-seed heals) + add to `module.exports`.
- Tests (see below).

## Testing (TDD)

- **Write failing unit tests first** for the pure transforms:
  - `_backfillBudgetGroupsFromText`: inline-flow item **with** a group → no insertion (was: corrupts); block-style item **without** a group → still backfilled `Unassigned` (unchanged behavior); already-block-with-group → untouched.
  - `_repairMalformedBudgetGroups`: a planted `- {…group…}` + stray `    group: Unassigned` → stray line removed, flow-map intact; a clean note → no-op (idempotent); a legitimately block-Unassigned row → **not** touched (only the flow-map-plus-stray pattern).
- **Behavioral / integration:** extend the existing install-heal harness that covers the group heals; assert two consecutive install passes are idempotent and never corrupt an inline-flow budget.
- **Seed-vault regression:** add an inline-flow budget fixture under `platform/test/seed-vault/`; assert the backfill leaves it clean and the repair heal strips a planted stray line (portable-sentinel pattern).
- **Gates:** `npm run release:preflight` whole-suite green; `npm run lint-schemas` green (no schema change, run anyway); workshop self-install (`node platform/install.js --vault . --auto-approve`) green; `npm run release:preflight-bumped` on a clean tree (finance PATCH bump).

## Migrations

The repair heal **is** the migration. Ungated (runs on every install so every vault self-heals), marker-guarded (`__budget_malformed_group_repaired: <finance-version>`), snapshot-first (`.sauce-backup/<ts>/…`), idempotent, per-file failure-loud. No version gate (repair, not reshaper).

## Non-goals / YAGNI

- No model or naming changes (that's #2). No touching the discretionary envelope or `computePlanState`.
- No change to `entity-create` serialization or to the clean block-style form.
- No in-brace group injection for the (non-existent in practice) group-less flow item — skip it instead.
- No version gate on the repair heal.

## Risks

- **Frontmatter string surgery on flow-maps is fiddly** — mitigated by TDD on the pure transforms (no Obsidian runtime needed) + snapshot-first + failure-loud.
- **The repair heal touches budget files across vaults** — mitigated: acts only on the exact malformed pattern (flow-map with a group key + a stray `Unassigned` line directly beneath), snapshot-first, marker-guarded, idempotent.
- **Marker-guard regex** must not collide with the existing `__group_seed_migrated` marker — use a distinct key.
